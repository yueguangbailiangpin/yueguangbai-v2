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
 * Stage 7.5 batch 2: company public service channels. Owner-only mutations
 * with idempotency, request-hash replay protection, expected-version checks
 * and audit events; reads are available to every active staff member and to
 * logged-in buyers through the public projection.
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

export async function listServiceChannels(
  database: SqlDatabase,
): Promise<CompanyServiceChannelDto[]> {
  const rows = await database
    .prepare(
      `SELECT code, display_name, wechat_id, qr_file_object_id, version, updated_at
      FROM company_public_service_channels ORDER BY code`,
    )
    .all<ChannelRow>();
  return rows.results.map(project);
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
  return project(row);
}

function project(row: ChannelRow): CompanyServiceChannelDto {
  return Object.freeze({
    code: row.code,
    display_name: row.display_name,
    wechat_id: row.wechat_id,
    qr_file_object_id: row.qr_file_object_id,
    version: Number(row.version),
    updated_at: Number(row.updated_at),
  });
}

export async function setServiceChannel(
  database: SqlDatabase,
  input: {
    code: unknown;
    displayName: unknown;
    wechatId: unknown;
    qrFileObjectId: unknown;
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
  // Only the owner may change the public channel configuration.
  if (!actor.roles.has('owner') || !actor.permissions.has('STAFF_MANAGE')) {
    throw new ServiceChannelError('FORBIDDEN', 403);
  }
  if (!isCompanyServiceChannelCode(input.code)) {
    throw new ServiceChannelError('VALIDATION_ERROR', 400);
  }
  const code = input.code;
  const displayName = cleanText(input.displayName, 1, 120);
  const wechatId = input.wechatId === null ? null : cleanText(input.wechatId, 1, 120);
  const qrFileObjectId = input.qrFileObjectId === null
    ? null
    : cleanText(input.qrFileObjectId, 1, 200);
  const reason = cleanText(input.reason, 1, 1000);
  const expectedVersion = cleanVersion(input.expectedVersion);
  const now = command.now ?? Date.now();

  const existing = await database
    .prepare(
      `SELECT code, display_name, wechat_id, qr_file_object_id, version, updated_at
      FROM company_public_service_channels WHERE code=?`,
    )
    .bind(code)
    .first<ChannelRow>();
  if (!existing) throw new ServiceChannelError('NOT_FOUND', 404);

  if (qrFileObjectId !== null) {
    const file = await database
      .prepare(
        `SELECT id FROM file_objects WHERE id=? AND status='VERIFIED' LIMIT 1`,
      )
      .bind(qrFileObjectId)
      .first();
    if (!file) throw new ServiceChannelError('VALIDATION_ERROR', 400);
  }

  const requestHash = await hashCanonicalJson({
    action: 'SET_COMPANY_SERVICE_CHANNEL',
    code,
    display_name: displayName,
    wechat_id: wechatId,
    qr_file_object_id: qrFileObjectId,
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
    return { ...acquired.response, replayed: true };
  }

  try {
    if (Number(existing.version) !== expectedVersion) {
      throw new ServiceChannelError('VERSION_CONFLICT', 409);
    }
    // Same-value writes are semantic replays, not version rotations.
    if (
      existing.display_name === displayName
      && existing.wechat_id === wechatId
      && existing.qr_file_object_id === qrFileObjectId
    ) {
      const response = {
        channel: project(existing),
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
    const updated: CompanyServiceChannelDto = Object.freeze({
      code,
      display_name: displayName,
      wechat_id: wechatId,
      qr_file_object_id: qrFileObjectId,
      version: Number(existing.version) + 1,
      updated_at: now,
    });
    const response = { channel: updated, replayed: false };
    const statements: SqlStatement[] = [
      database
        .prepare(
          `UPDATE company_public_service_channels
          SET display_name=?, wechat_id=?, qr_file_object_id=?, version=version+1,
            updated_by_staff_id=?, updated_at=?
          WHERE code=? AND version=?`,
        )
        .bind(
          displayName,
          wechatId,
          qrFileObjectId,
          actor.staffId,
          now,
          code,
          expectedVersion,
        ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'SERVICE_CHANNEL',
        aggregateId: code,
        eventType: 'SERVICE_CHANNEL_UPDATED',
        actor: { type: 'STAFF', id: actor.staffId, roles: [...actor.roles] },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          display_name: existing.display_name,
          wechat_id: existing.wechat_id,
          qr_file_object_id: existing.qr_file_object_id,
          version: Number(existing.version),
        },
        nextState: {
          display_name: displayName,
          wechat_id: wechatId,
          qr_file_object_id: qrFileObjectId,
          version: Number(existing.version) + 1,
          reason,
        },
        createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { service_channel_code: code },
        now,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ];
    await database.batch(statements);
    return response;
  } catch (error) {
    const normalized = normalize(error);
    await markIdempotencyFailed(database, acquired.claim, normalized.code, now);
    throw normalized;
  }
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
