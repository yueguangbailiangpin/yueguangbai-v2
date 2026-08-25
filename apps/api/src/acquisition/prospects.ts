import type {
  AcquisitionLeadType,
  AcquisitionPage,
  AcquisitionProspectDto,
  AcquisitionProspectStatus,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';
import { createAuditEventStatement } from '../foundation/audit';
import { createOutboxStatements, prepareOutboxEvent } from '../foundation/outbox';
import { requireAcquisitionOperator } from './authorization';
import {
  acquireAcquisitionCommand,
  failAcquisitionCommand,
  finishAcquisitionCommand,
  type AcquisitionCommandContext,
} from './command';
import { AcquisitionError, validation } from './errors';

interface ProspectRow {
  id: string;
  lead_type: AcquisitionLeadType;
  marketplace_code: string;
  origin_channel_id: string;
  origin_channel_name: string;
  display_name: string;
  contact_value: string | null;
  source_url: string | null;
  status: AcquisitionProspectStatus;
  note: string | null;
  discovered_at: number;
  converted_lead_id: string | null;
  version: number;
  created_at: number;
  updated_at: number;
}
interface ChannelRow {
  id: string;
  lead_type: 'BUYER' | 'SELLER' | 'BOTH';
  marketplace_code: string;
  status: 'ACTIVE' | 'DISABLED';
}

export async function createAcquisitionProspect(
  database: SqlDatabase,
  input: {
    leadType: AcquisitionLeadType;
    marketplaceCode: string;
    channelId: string;
    displayName: string;
    contactValue: string | null;
    sourceUrl: string | null;
    note: string | null;
  },
  command: AcquisitionCommandContext,
): Promise<{ prospect: AcquisitionProspectDto; replayed: boolean }> {
  requireAcquisitionOperator(command.actor);
  await assertStaffMarketplace(database, command.actor, input.marketplaceCode);
  const normalized = await validateProspectInput(database, input);
  const target = `${normalized.leadType}:${normalized.marketplaceCode}:${normalized.channelId}:${normalized.displayName}`;
  const acquired = await acquireAcquisitionCommand<{ prospect_id: string }>(
    database,
    command,
    'CREATE_ACQUISITION_PROSPECT',
    'ACQUISITION_PROSPECT',
    target,
    normalized,
  );
  if (acquired.acquired.kind === 'REPLAY')
    return {
      prospect: await readAcquisitionProspect(
        database,
        command.actor,
        acquired.acquired.response.prospect_id,
      ),
      replayed: true,
    };
  const id = crypto.randomUUID();
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO acquisition_prospects(
        id,lead_type,marketplace_code,origin_channel_id,display_name,contact_value,source_url,status,
        note,created_by_actor_type,created_by_actor_id,discovered_at,converted_lead_id,version,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?, 'NEW',?, 'STAFF', ?, ?, NULL,1,?,?)`,
        )
        .bind(
          id,
          normalized.leadType,
          normalized.marketplaceCode,
          normalized.channelId,
          normalized.displayName,
          normalized.contactValue,
          normalized.sourceUrl,
          normalized.note,
          command.actor.staffId,
          acquired.now,
          acquired.now,
          acquired.now,
        ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'ACQUISITION_PROSPECT',
        aggregateId: id,
        eventType: 'ACQUISITION_PROSPECT_CREATED',
        actor: { type: 'STAFF', id: command.actor.staffId, roles: [...command.actor.roles] },
        requestId: command.requestId,
        idempotencyKey: command.idempotencyKey,
        nextState: { ...normalized, status: 'NEW', version: 1 },
        createdAt: acquired.now,
      }),
      ...finishAcquisitionCommand(
        database,
        acquired.acquired.claim,
        { prospect_id: id },
        acquired.now,
        { prospect_id: id },
      ),
    ]);
  } catch (error) {
    await failAcquisitionCommand(database, acquired.acquired.claim, acquired.now);
    throw error;
  }
  return { prospect: await readAcquisitionProspect(database, command.actor, id), replayed: false };
}

export async function listAcquisitionProspects(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  input: {
    leadType: AcquisitionLeadType | null;
    status: AcquisitionProspectStatus | null;
    cursor: string | null;
    limit: number;
  },
): Promise<AcquisitionPage<AcquisitionProspectDto>> {
  requireAcquisitionOperator(actor);
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) validation();
  const markets = actor.roles.has('owner')
    ? []
    : await resolveStaffMarketplaceCodes(database, actor);
  if (!actor.roles.has('owner') && markets.length === 0) return { items: [], next_cursor: null };
  const cursor = decodeCursor(input.cursor);
  const clauses = ['1=1'];
  const bindings: unknown[] = [];
  if (markets.length) {
    clauses.push(`prospect.marketplace_code IN (${markets.map(() => '?').join(',')})`);
    bindings.push(...markets);
  }
  if (input.leadType) {
    clauses.push('prospect.lead_type=?');
    bindings.push(input.leadType);
  }
  if (input.status) {
    clauses.push('prospect.status=?');
    bindings.push(input.status);
  }
  if (cursor) {
    clauses.push('(prospect.discovered_at<? OR (prospect.discovered_at=? AND prospect.id<?))');
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const rows = await database
    .prepare(
      `${prospectSql(clauses.join(' AND '))} ORDER BY prospect.discovered_at DESC,prospect.id DESC LIMIT ?`,
    )
    .bind(...bindings, input.limit + 1)
    .all<ProspectRow>();
  const all = rows.results.map(toProspect);
  const items = all.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items,
    next_cursor:
      all.length > input.limit && last
        ? encodeCursor({ createdAt: last.discovered_at, id: last.prospect_id })
        : null,
  };
}

export async function readAcquisitionProspect(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  prospectId: string,
): Promise<AcquisitionProspectDto> {
  requireAcquisitionOperator(actor);
  const prospect = await readProspectById(database, prospectId);
  if (!actor.roles.has('owner')) {
    const markets = await resolveStaffMarketplaceCodes(database, actor);
    if (!markets.includes(prospect.marketplace_code)) throw new AcquisitionError('NOT_FOUND', 404);
  }
  return prospect;
}

export async function updateAcquisitionProspect(
  database: SqlDatabase,
  prospectId: string,
  input: {
    expectedVersion: number;
    status: AcquisitionProspectStatus;
    note: string | null;
  },
  command: AcquisitionCommandContext,
): Promise<{ prospect: AcquisitionProspectDto; replayed: boolean }> {
  requireAcquisitionOperator(command.actor);
  const id = identifier(prospectId);
  const current = await readAcquisitionProspect(database, command.actor, id);
  const expected = input.expectedVersion;
  if (!Number.isSafeInteger(expected) || expected < 1) validation();
  const note = optionalText(input.note, 4000);
  const acquired = await acquireAcquisitionCommand<{ prospect: AcquisitionProspectDto }>(
    database,
    command,
    'UPDATE_ACQUISITION_PROSPECT',
    'ACQUISITION_PROSPECT',
    id,
    { expected_version: expected, status: input.status, note },
  );
  if (acquired.acquired.kind === 'REPLAY') return { ...acquired.acquired.response, replayed: true };
  try {
    if (current.version !== expected) throw new AcquisitionError('VERSION_CONFLICT', 409);
    if (current.status === 'CONVERTED' || input.status === 'CONVERTED')
      throw new AcquisitionError('STATE_CONFLICT', 409);
    const prospect: AcquisitionProspectDto = {
      ...current,
      status: input.status,
      note,
      version: expected + 1,
      updated_at: acquired.now,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `acquisition-prospect-updated:${id}:${expected + 1}`,
      eventType: 'ACQUISITION_PROSPECT_UPDATED',
      aggregateType: 'ACQUISITION_PROSPECT',
      aggregateId: id,
      payload: {
        prospect_id: id,
        status: input.status,
        note,
        version: expected + 1,
      },
      createdAt: acquired.now,
    });
    await database.batch([
      database
        .prepare(
          `UPDATE acquisition_prospects SET status=?,note=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status<>'CONVERTED'`,
        )
        .bind(input.status, note, acquired.now, id, expected),
      changedOnce(database),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'ACQUISITION_PROSPECT',
        aggregateId: id,
        eventType: 'ACQUISITION_PROSPECT_UPDATED',
        actor: auditActor(command.actor),
        requestId: command.requestId,
        idempotencyKey: command.idempotencyKey,
        previousState: {
          status: current.status,
          note: current.note,
          version: expected,
        },
        nextState: { status: input.status, note, version: expected + 1 },
        createdAt: acquired.now,
      }),
      ...createOutboxStatements(database, outbox),
      ...finishAcquisitionCommand(database, acquired.acquired.claim, { prospect }, acquired.now, {
        prospect_id: id,
      }),
      database
        .prepare(
          `INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN (SELECT COUNT(*) FROM acquisition_prospects WHERE id=? AND version=? AND status=? AND note IS ?)=1 THEN 1 ELSE 0 END`,
        )
        .bind(id, expected + 1, input.status, note),
    ]);
    return { prospect, replayed: false };
  } catch (error) {
    await failAcquisitionCommand(database, acquired.acquired.claim, acquired.now);
    if (error instanceof AcquisitionError) throw error;
    if (String(error).includes('transaction_assertion_failed')) {
      const latest = await database
        .prepare(`SELECT version FROM acquisition_prospects WHERE id=?`)
        .bind(id)
        .first<{ version: number }>()
        .catch(() => null);
      if (latest && Number(latest.version) !== expected)
        throw new AcquisitionError('VERSION_CONFLICT', 409);
    }
    throw error;
  }
}

async function validateProspectInput(
  database: SqlDatabase,
  input: {
    leadType: AcquisitionLeadType;
    marketplaceCode: string;
    channelId: string;
    displayName: string;
    contactValue: string | null;
    sourceUrl: string | null;
    note: string | null;
  },
) {
  if (input.leadType !== 'BUYER' && input.leadType !== 'SELLER') validation();
  const marketplaceCode = identifier(input.marketplaceCode),
    channelId = identifier(input.channelId),
    displayName = text(input.displayName, 200),
    contactValue = optionalText(input.contactValue, 320),
    sourceUrl = optionalUrl(input.sourceUrl),
    note = optionalText(input.note, 4000);
  const channel = await database
    .prepare(`SELECT id,lead_type,marketplace_code,status FROM acquisition_channels WHERE id=?`)
    .bind(channelId)
    .first<ChannelRow>();
  if (
    !channel ||
    channel.status !== 'ACTIVE' ||
    channel.marketplace_code !== marketplaceCode ||
    !(channel.lead_type === input.leadType || channel.lead_type === 'BOTH')
  )
    throw new AcquisitionError('VALIDATION_ERROR', 400);
  return {
    leadType: input.leadType,
    marketplaceCode,
    channelId,
    displayName,
    contactValue,
    sourceUrl,
    note,
  };
}
async function assertStaffMarketplace(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  market: string,
) {
  if (actor.roles.has('owner')) return;
  const markets = await resolveStaffMarketplaceCodes(database, actor);
  if (!markets.includes(market)) throw new AcquisitionError('FORBIDDEN', 403);
}
async function readProspectById(
  database: SqlDatabase,
  id: string,
): Promise<AcquisitionProspectDto> {
  const row = await database
    .prepare(prospectSql('prospect.id=?'))
    .bind(identifier(id))
    .first<ProspectRow>();
  if (!row) throw new AcquisitionError('NOT_FOUND', 404);
  return toProspect(row);
}
function prospectSql(where: string) {
  return `SELECT prospect.id,prospect.lead_type,prospect.marketplace_code,prospect.origin_channel_id,channel.display_name AS origin_channel_name,prospect.display_name,prospect.contact_value,prospect.source_url,prospect.status,prospect.note,prospect.discovered_at,prospect.converted_lead_id,prospect.version,prospect.created_at,prospect.updated_at FROM acquisition_prospects prospect JOIN acquisition_channels channel ON channel.id=prospect.origin_channel_id WHERE ${where}`;
}
function toProspect(row: ProspectRow): AcquisitionProspectDto {
  return {
    prospect_id: row.id,
    lead_type: row.lead_type,
    marketplace_code: row.marketplace_code,
    origin_channel_id: row.origin_channel_id,
    origin_channel_name: row.origin_channel_name,
    display_name: row.display_name,
    contact_value: row.contact_value,
    source_url: row.source_url,
    status: row.status,
    note: row.note,
    discovered_at: Number(row.discovered_at),
    converted_lead_id: row.converted_lead_id,
    version: Number(row.version),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  };
}
function changedOnce(database: SqlDatabase): SqlStatement {
  return database.prepare(
    `INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END`,
  );
}
function auditActor(actor: AssignmentStaffAuthorization) {
  return { type: 'STAFF', id: actor.staffId, roles: [...actor.roles] };
}
function optionalUrl(value: string | null): string | null {
  const textValue = optionalText(value, 2000);
  if (textValue === null) return null;
  try {
    const url = new URL(textValue);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') validation();
    return url.toString();
  } catch {
    validation();
  }
}
function optionalText(value: string | null, maximum: number): string | null {
  if (value === null) return null;
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) validation();
  return normalized;
}
function text(value: string, maximum: number): string {
  const normalized = optionalText(value, maximum);
  if (normalized === null) validation();
  return normalized;
}
function identifier(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    validation();
  return value;
}
function encodeCursor(value: { createdAt: number; id: string }): string {
  return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
function decodeCursor(value: string | null): { createdAt: number; id: string } | null {
  if (value === null) return null;
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const parsed = JSON.parse(
      atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')),
    ) as Record<string, unknown>;
    if (!Number.isSafeInteger(parsed['createdAt']) || typeof parsed['id'] !== 'string')
      validation();
    return { createdAt: Number(parsed['createdAt']), id: String(parsed['id']) };
  } catch {
    validation();
  }
}
