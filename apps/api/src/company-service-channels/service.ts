import type {
  CompanyServiceChannelCode,
  CompanyServiceChannelDto,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { isCompanyServiceChannelCode } from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import type { AssignmentStaffAuthorization } from '../staff-assignment';

/**
 * Stage 7.5 batch 2 + 7.5R: company public service channels. Owner-only
 * mutations with idempotency, request-hash replay protection,
 * expected-version checks and audit events.
 *
 * 7.5R: the QR file travels the controlled chain — the owner uploads via the
 * SERVICE_CHANNEL_QR purpose route, then attaches it here. Attach validates
 * existence, VERIFIED status, purpose, visibility, version and an
 * entity-bound EXPLICIT_AUDIENCES link to exactly this channel; clearing
 * revokes the link without deleting the historical file facts.
 */

export class ServiceChannelError extends Error {
  constructor(
    public readonly code:
      | 'VALIDATION_ERROR'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'VERSION_CONFLICT'
      | 'IDEMPOTENCY_CONFLICT'
      | 'REQUEST_IN_PROGRESS'
      | 'DEPENDENCY_UNAVAILABLE',
    public readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = 'ServiceChannelError';
  }
}

interface ChannelRow {
  code: CompanyServiceChannelCode;
  display_name: string;
  wechat_id: string | null;
  qr_file_object_id: string | null;
  version: number;
  updated_at: number;
}

interface QrRow {
  file_object_id: string;
  version: number;
  status: string;
  purpose: string;
  visibility: string;
}

export async function listServiceChannels(
  database: SqlDatabase,
): Promise<CompanyServiceChannelDto[]> {
  const rows = await database
    .prepare(
      `SELECT channel.code, channel.display_name, channel.wechat_id,
        channel.qr_file_object_id, channel.version, channel.updated_at
      FROM company_public_service_channels channel
      LEFT JOIN file_objects qr ON qr.id=channel.qr_file_object_id
      ORDER BY channel.code`,
    )
    .all<ChannelRow & { qr_version: number | null }>();
  const dtoList: CompanyServiceChannelDto[] = [];
  for (const row of rows.results) {
    dtoList.push(await project(database, row));
  }
  return dtoList;
}

export async function readServiceChannel(
  database: SqlDatabase,
  code: CompanyServiceChannelCode,
): Promise<CompanyServiceChannelDto> {
  const row = await database
    .prepare(
      `SELECT code, display_name, wechat_id, qr_file_object_id, version, updated_at
      FROM company_public_service_channels WHERE code=?`,
    )
    .bind(code)
    .first<ChannelRow>();
  if (!row) throw new ServiceChannelError('NOT_FOUND', 404);
  return project(database, row);
}

async function project(
  database: SqlDatabase,
  row: ChannelRow,
): Promise<CompanyServiceChannelDto> {
  const qrFile = row.qr_file_object_id === null
    ? null
    : await database
      .prepare(
        `SELECT id AS file_object_id, version, status, purpose, visibility
        FROM file_objects WHERE id=?`,
      )
      .bind(row.qr_file_object_id)
      .first<QrRow>();
  return Object.freeze({
    code: row.code,
    display_name: row.display_name,
    wechat_id: row.wechat_id,
    qr_file: qrFile === null || qrFile.status !== 'VERIFIED'
      ? null
      : Object.freeze({
        file_object_id: qrFile.file_object_id,
        file_version: Number(qrFile.version),
        purpose: 'SERVICE_CHANNEL_QR' as const,
        visibility: 'BUYER_VISIBLE' as const,
      }),
    version: Number(row.version),
    updated_at: Number(row.updated_at),
  });
}

type ChannelAction =
  | 'SET_COMPANY_SERVICE_CHANNEL'
  | 'ATTACH_SERVICE_CHANNEL_QR';

async function beginIdempotency(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  action: ChannelAction,
  targetId: string,
  payload: unknown,
  idempotencyKey: string,
  now: number,
) {
  const requestHash = await hashCanonicalJson({ action, target: targetId, payload });
  try {
    return await acquireIdempotency(database, {
      actorType: 'STAFF',
      actorId: actor.staffId,
      action,
      targetType: 'SERVICE_CHANNEL',
      targetId,
      idempotencyKey,
      requestHash,
    }, { now });
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    if (message.includes('IDEMPOTENCY_CONFLICT')) {
      throw new ServiceChannelError('IDEMPOTENCY_CONFLICT', 409);
    }
    if (message.includes('REQUEST_IN_PROGRESS')) {
      throw new ServiceChannelError('REQUEST_IN_PROGRESS', 409);
    }
    throw error;
  }
}

function channelEventAudit(
  database: SqlDatabase,
  input: {
    channelCode: string;
    eventType: string;
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId: string | null;
    previousState: unknown;
    nextState: unknown;
    now: number;
  },
): SqlStatement {
  return createAuditEventStatement(database, {
    id: crypto.randomUUID(),
    aggregateType: 'SERVICE_CHANNEL',
    aggregateId: input.channelCode,
    eventType: input.eventType,
    actor: { type: 'STAFF', id: input.actor.staffId, roles: [...input.actor.roles] },
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    previousState: input.previousState,
    nextState: input.nextState,
    createdAt: input.now,
  });
}

function requireOwner(actor: AssignmentStaffAuthorization): void {
  if (!actor.roles.has('owner') || !actor.permissions.has('STAFF_MANAGE')) {
    throw new ServiceChannelError('FORBIDDEN', 403);
  }
}

export async function setServiceChannel(
  database: SqlDatabase,
  input: {
    code: unknown;
    displayName: unknown;
    wechatId: unknown;
    expectedVersion: unknown;
    reason: unknown;
  },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<{ channel: CompanyServiceChannelDto; replayed: boolean }> {
  const actor = command.actor;
  requireOwner(actor);
  if (!isCompanyServiceChannelCode(input.code)) {
    throw new ServiceChannelError('VALIDATION_ERROR', 400);
  }
  const code = input.code;
  const displayName = cleanText(input.displayName, 1, 120);
  const wechatId = input.wechatId === null ? null : cleanText(input.wechatId, 1, 120);
  const reason = cleanText(input.reason, 1, 1000);
  const expectedVersion = cleanVersion(input.expectedVersion);
  const now = command.now ?? Date.now();

  const existing = await readChannelRow(database, code);

  const requestHash = await hashCanonicalJson({
    action: 'SET_COMPANY_SERVICE_CHANNEL',
    code,
    display_name: displayName,
    wechat_id: wechatId,
    expected_version: expectedVersion,
    reason,
  });
  let acquired;
  try {
    acquired = await acquireIdempotency<{
      channel: CompanyServiceChannelDto;
      replayed: boolean;
    }>(database, {
      actorType: 'STAFF',
      actorId: actor.staffId,
      action: 'SET_COMPANY_SERVICE_CHANNEL',
      targetType: 'SERVICE_CHANNEL',
      targetId: code,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    }, { now });
  } catch (error) {
    throw normalize(error);
  }
  if (acquired.kind === 'REPLAY') {
    const replayed = acquired.response as {
      channel: CompanyServiceChannelDto;
      replayed: boolean;
    };
    return { ...replayed, replayed: true };
  }

  try {
    if (Number(existing.version) !== expectedVersion) {
      throw new ServiceChannelError('VERSION_CONFLICT', 409);
    }
    // Same-value writes are semantic replays, not version rotations.
    if (
      existing.display_name === displayName
      && existing.wechat_id === wechatId
    ) {
      const response = {
        channel: await project(database, existing),
        replayed: true,
      } as const;
      await database.batch([
        completeIdempotencyStatement(database, acquired.claim, response, {
          resultReferences: { service_channel_code: code },
          now,
        }),
        assertIdempotencyCompletionStatement(database, acquired.claim),
      ]);
      return { ...response };
    }
    const statements: SqlStatement[] = [
      database
        .prepare(
          `UPDATE company_public_service_channels
          SET display_name=?, wechat_id=?, version=version+1,
            updated_by_staff_id=?, updated_at=?
          WHERE code=? AND version=?`,
        )
        .bind(displayName, wechatId, actor.staffId, now, code, expectedVersion),
      channelEventAudit(database, {
        channelCode: code,
        eventType: 'SERVICE_CHANNEL_UPDATED',
        actor,
        idempotencyKey: command.idempotencyKey,
        requestId: command.requestId ?? null,
        previousState: {
          display_name: existing.display_name,
          wechat_id: existing.wechat_id,
          qr_file_object_id: existing.qr_file_object_id,
          version: Number(existing.version),
        },
        nextState: {
          display_name: displayName,
          wechat_id: wechatId,
          qr_file_object_id: existing.qr_file_object_id,
          version: Number(existing.version) + 1,
          reason,
        },
        now,
      }),
      completeIdempotencyStatement(database, acquired.claim, { channel: null, replayed: false }, {
        resultReferences: { service_channel_code: code },
        now,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ];
    await database.batch(statements);
    return {
      channel: await readServiceChannel(database, code),
      replayed: false,
    };
  } catch (error) {
    const normalized = normalize(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now);
    throw normalized;
  }
}

export async function attachServiceChannelQr(
  database: SqlDatabase,
  input: {
    code: unknown;
    fileObjectId: unknown;
    expectedFileVersion: unknown;
    expectedVersion: unknown;
    reason: unknown;
  },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<{ channel: CompanyServiceChannelDto; replayed: boolean }> {
  const actor = command.actor;
  requireOwner(actor);
  if (!isCompanyServiceChannelCode(input.code)) {
    throw new ServiceChannelError('VALIDATION_ERROR', 400);
  }
  const code = input.code;
  const reason = cleanText(input.reason, 1, 1000);
  const expectedVersion = cleanVersion(input.expectedVersion);
  const now = command.now ?? Date.now();
  const clearing = input.fileObjectId === null;
  const fileObjectId = clearing ? null : cleanText(input.fileObjectId, 1, 120);
  const expectedFileVersion = cleanVersion(input.expectedFileVersion);

  const existing = await readChannelRow(database, code);

  let acquired;
  try {
    acquired = await beginIdempotency(
      database,
      actor,
      'ATTACH_SERVICE_CHANNEL_QR',
      code,
      {
        file_object_id: fileObjectId,
        expected_file_version: expectedFileVersion,
        expected_version: expectedVersion,
        reason,
      },
      command.idempotencyKey,
      now,
    );
  } catch (error) {
    throw normalize(error);
  }
  if (acquired.kind === 'REPLAY') {
    const replayed = acquired.response as {
      channel: CompanyServiceChannelDto;
      replayed: boolean;
    };
    return { ...replayed, replayed: true };
  }

  try {
    if (Number(existing.version) !== expectedVersion) {
      throw new ServiceChannelError('VERSION_CONFLICT', 409);
    }
    const statements: SqlStatement[] = [];

    if (clearing) {
      if (existing.qr_file_object_id === null) {
        // Already cleared — semantic replay.
        const response = {
          channel: await project(database, existing),
          replayed: true,
        } as const;
        await database.batch([
          completeIdempotencyStatement(database, acquired.claim, response, {
            resultReferences: { service_channel_code: code },
            now,
          }),
          assertIdempotencyCompletionStatement(database, acquired.claim),
        ]);
        return { ...response };
      }
      // Revoke the active link (append-only) and drop the channel reference.
      statements.push(
        database
          .prepare(
            `UPDATE file_entity_links
            SET revoked_at=?
            WHERE entity_type='SERVICE_CHANNEL' AND entity_id=?
              AND file_object_id=? AND revoked_at IS NULL`,
          )
          .bind(now, code, existing.qr_file_object_id),
      );
    } else {
      // Full controlled-chain validation before any write.
      const file = await database
        .prepare(
          `SELECT id AS file_object_id, version, status, purpose, visibility
          FROM file_objects WHERE id=?`,
        )
        .bind(fileObjectId)
        .first<QrRow>();
      if (!file) throw new ServiceChannelError('VALIDATION_ERROR', 400);
      if (file.status !== 'VERIFIED') {
        throw new ServiceChannelError('VALIDATION_ERROR', 400);
      }
      if (file.purpose !== 'SERVICE_CHANNEL_QR') {
        throw new ServiceChannelError('VALIDATION_ERROR', 400);
      }
      if (file.visibility !== 'BUYER_VISIBLE') {
        throw new ServiceChannelError('VALIDATION_ERROR', 400);
      }
      if (Number(file.version) !== expectedFileVersion) {
        throw new ServiceChannelError('VERSION_CONFLICT', 409);
      }
      // The file must not already be bound to another business object.
      const foreign = await database
        .prepare(
          `SELECT id FROM file_entity_links
          WHERE file_object_id=? AND revoked_at IS NULL
            AND NOT (entity_type='SERVICE_CHANNEL' AND entity_id=?)`,
        )
        .bind(fileObjectId, code)
        .first();
      if (foreign) throw new ServiceChannelError('VALIDATION_ERROR', 400);
      // Revoke any previous QR link for this channel, then bind this file.
      statements.push(
        database
          .prepare(
            `UPDATE file_entity_links
            SET revoked_at=?
            WHERE entity_type='SERVICE_CHANNEL' AND entity_id=?
              AND revoked_at IS NULL AND file_object_id<>?`,
          )
          .bind(now, code, fileObjectId),
      );
      statements.push(
        database
          .prepare(
            `INSERT INTO file_entity_links(
              id,file_object_id,entity_type,entity_id,purpose,visibility,
              linked_by_actor_type,linked_by_actor_id,created_at,
              authorization_mode)
            VALUES(?,?, 'SERVICE_CHANNEL', ?, 'SERVICE_CHANNEL_QR',
              'BUYER_VISIBLE', 'STAFF', ?, ?, 'EXPLICIT_AUDIENCES')`,
          )
          .bind(
            crypto.randomUUID(),
            fileObjectId,
            code,
            actor.staffId,
            now,
          ),
      );
    }

    statements.push(
      database
        .prepare(
          `UPDATE company_public_service_channels
          SET qr_file_object_id=?, version=version+1,
            updated_by_staff_id=?, updated_at=?
          WHERE code=? AND version=?`,
        )
        .bind(fileObjectId, actor.staffId, now, code, expectedVersion),
      channelEventAudit(database, {
        channelCode: code,
        eventType: 'SERVICE_CHANNEL_QR_ATTACHED',
        actor,
        idempotencyKey: command.idempotencyKey,
        requestId: command.requestId ?? null,
        previousState: {
          qr_file_object_id: existing.qr_file_object_id,
          version: Number(existing.version),
        },
        nextState: {
          qr_file_object_id: fileObjectId,
          version: Number(existing.version) + 1,
          reason,
        },
        now,
      }),
    );
    // The post-update channel state is fully deterministic here — persist it
    // as the idempotent replay response (a replay must return the same
    // channel, not a null placeholder).
    const nextChannel: CompanyServiceChannelDto = Object.freeze({
      code,
      display_name: existing.display_name,
      wechat_id: existing.wechat_id,
      qr_file: fileObjectId === null
        ? null
        : Object.freeze({
          file_object_id: fileObjectId,
          file_version: expectedFileVersion,
          purpose: 'SERVICE_CHANNEL_QR' as const,
          visibility: 'BUYER_VISIBLE' as const,
        }),
      version: Number(existing.version) + 1,
      updated_at: now,
    });
    statements.push(
      completeIdempotencyStatement(database, acquired.claim, {
        channel: nextChannel,
        replayed: false,
      }, {
        resultReferences: { service_channel_code: code },
        now,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    );
    await database.batch(statements);
    return {
      channel: nextChannel,
      replayed: false,
    };
  } catch (error) {
    const normalized = normalize(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now);
    throw normalized;
  }
}

async function readChannelRow(
  database: SqlDatabase,
  code: CompanyServiceChannelCode,
): Promise<ChannelRow> {
  const row = await database
    .prepare(
      `SELECT code, display_name, wechat_id, qr_file_object_id, version, updated_at
      FROM company_public_service_channels WHERE code=?`,
    )
    .bind(code)
    .first<ChannelRow>();
  if (!row) throw new ServiceChannelError('NOT_FOUND', 404);
  return row;
}

function cleanText(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string') throw new ServiceChannelError('VALIDATION_ERROR', 400);
  const normalized = value.normalize('NFKC').trim();
  if (
    normalized.length < min
    || normalized.length > max
    || /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw new ServiceChannelError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

function cleanVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new ServiceChannelError('VALIDATION_ERROR', 400);
  }
  return Number(value);
}

function normalize(error: unknown): ServiceChannelError {
  const code = (error as { code?: unknown })?.code;
  if (code === 'IDEMPOTENCY_CONFLICT') {
    return new ServiceChannelError('IDEMPOTENCY_CONFLICT', 409);
  }
  if (code === 'REQUEST_IN_PROGRESS') {
    return new ServiceChannelError('REQUEST_IN_PROGRESS', 409);
  }
  if (error instanceof ServiceChannelError) return error;
  return new ServiceChannelError('DEPENDENCY_UNAVAILABLE', 503);
}
