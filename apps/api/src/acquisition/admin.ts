import type {
  AcquisitionChannelAssignmentDto,
  AcquisitionChannelDto,
  AcquisitionChannelType,
  AcquisitionDailyConsultationDto,
  AcquisitionConsultationEventDto,
  AcquisitionLeadType,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { chinaBusinessDateStartEpoch, parseChinaBusinessDate } from '@ygb/domain';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { createAuditEventStatement } from '../foundation/audit';
import { requireAcquisitionAdmin } from './authorization';
import {
  acquireAcquisitionCommand,
  failAcquisitionCommand,
  finishAcquisitionCommand,
  type AcquisitionCommandContext,
} from './command';
import { AcquisitionError, validation } from './errors';

interface ChannelRow {
  id: string; code: string; channel_type: AcquisitionChannelType;
  display_name: string; status: 'ACTIVE'|'DISABLED'; version: number;
  created_at: number; updated_at: number;
}
interface AssignmentRow {
  id: string; staff_id: string; lead_type: AcquisitionLeadType;
  channel_id: string; channel_name: string; effective_from: number;
  effective_until: number|null; status: 'ACTIVE'|'REVOKED'; version: number;
}
interface ConsultationRow {
  id: string; channel_id: string; lead_type: AcquisitionLeadType;
  business_date: string; person_count: number;
  version: number; updated_by_staff_id: string; updated_at: number;
  created_at: number;
}

type Result<T> = T & { replayed: boolean };

export async function createAcquisitionChannel(
  database: SqlDatabase,
  input: { code: string; channelType: AcquisitionChannelType; displayName: string },
  command: AcquisitionCommandContext,
): Promise<Result<{ channel: AcquisitionChannelDto }>> {
  requireAcquisitionAdmin(command.actor);
  const code = normalizedCode(input.code);
  const displayName = text(input.displayName, 100);
  const payload = { code, channel_type: input.channelType, display_name: displayName };
  const acquired = await acquireAcquisitionCommand<{ channel: AcquisitionChannelDto }>(
    database, command, 'CREATE_ACQUISITION_CHANNEL', 'ACQUISITION_CHANNEL', code, payload,
  );
  if (acquired.acquired.kind === 'REPLAY') {
    return { ...acquired.acquired.response, replayed: true };
  }
  const id = crypto.randomUUID();
  const channel: AcquisitionChannelDto = {
    channel_id: id, code, channel_type: input.channelType,
    display_name: displayName, status: 'ACTIVE', version: 1,
    created_at: acquired.now, updated_at: acquired.now,
  };
  try {
    await database.batch([
      database.prepare(`INSERT INTO acquisition_channels (
        id,code,channel_type,display_name,status,version,created_by_staff_id,
        created_at,updated_at,disabled_at
      ) VALUES (?,?,?,?, 'ACTIVE',1,?,?,?,NULL)`).bind(
        id, code, input.channelType, displayName, command.actor.staffId,
        acquired.now, acquired.now,
      ),
      database.prepare(`INSERT INTO acquisition_channel_events (
        id,channel_id,event_type,previous_version,next_version,actor_staff_id,
        idempotency_key,request_hash,reason,created_at
      ) VALUES (?,?,'CREATED',NULL,1,?,?,?,?,?)`).bind(
        crypto.randomUUID(), id, command.actor.staffId,
        command.idempotencyKey, acquired.requestHash, null, acquired.now,
      ),
      audit(database, command, 'ACQUISITION_CHANNEL', id,
        'ACQUISITION_CHANNEL_CREATED', null, channel, null, acquired.now),
      ...finishAcquisitionCommand(database, acquired.acquired.claim,
        { channel }, acquired.now, { channel_id: id }),
      assertion(database, `SELECT 1 FROM acquisition_channels
        WHERE id=? AND status='ACTIVE' AND version=1`, [id]),
    ]);
    return { channel, replayed: false };
  } catch (error) {
    await failAcquisitionCommand(database, acquired.acquired.claim, acquired.now);
    if (String(error).includes('UNIQUE')) throw new AcquisitionError('CONFLICT', 409);
    throw error;
  }
}

export async function disableAcquisitionChannel(
  database: SqlDatabase,
  input: { channelId: string; expectedVersion: number; reason: string },
  command: AcquisitionCommandContext,
): Promise<Result<{ channel: AcquisitionChannelDto }>> {
  requireAcquisitionAdmin(command.actor);
  const channelId = identifier(input.channelId);
  const expectedVersion = version(input.expectedVersion);
  const reason = text(input.reason, 1000);
  const existing = await readChannel(database, channelId);
  if (!existing) throw new AcquisitionError('NOT_FOUND', 404);
  if (existing.status !== 'ACTIVE') throw new AcquisitionError('STATE_CONFLICT', 409);
  if (existing.version !== expectedVersion) throw new AcquisitionError('VERSION_CONFLICT', 409);
  const acquired = await acquireAcquisitionCommand<{ channel: AcquisitionChannelDto }>(
    database, command, 'DISABLE_ACQUISITION_CHANNEL',
    'ACQUISITION_CHANNEL', channelId, { expected_version: expectedVersion, reason },
  );
  if (acquired.acquired.kind === 'REPLAY') return { ...acquired.acquired.response, replayed: true };
  const channel: AcquisitionChannelDto = {
    ...toChannel(existing), status: 'DISABLED', version: expectedVersion + 1,
    updated_at: acquired.now,
  };
  try {
    await database.batch([
      database.prepare(`UPDATE acquisition_channels
        SET status='DISABLED',version=version+1,updated_at=?,disabled_at=?
        WHERE id=? AND status='ACTIVE' AND version=?`).bind(
        acquired.now, acquired.now, channelId, expectedVersion,
      ),
      database.prepare(`INSERT INTO acquisition_channel_events (
        id,channel_id,event_type,previous_version,next_version,actor_staff_id,
        idempotency_key,request_hash,reason,created_at
      ) VALUES (?,?,'DISABLED',?,?,?,?,?,?,?)`).bind(
        crypto.randomUUID(), channelId, expectedVersion, expectedVersion + 1,
        command.actor.staffId, command.idempotencyKey, acquired.requestHash,
        reason, acquired.now,
      ),
      audit(database, command, 'ACQUISITION_CHANNEL', channelId,
        'ACQUISITION_CHANNEL_DISABLED', toChannel(existing), channel,
        reason, acquired.now),
      ...finishAcquisitionCommand(database, acquired.acquired.claim,
        { channel }, acquired.now, { channel_id: channelId }),
      assertion(database, `SELECT 1 FROM acquisition_channels
        WHERE id=? AND status='DISABLED' AND version=?`,
      [channelId, expectedVersion + 1]),
    ]);
    return { channel, replayed: false };
  } catch (error) {
    await failAcquisitionCommand(database, acquired.acquired.claim, acquired.now);
    throw new AcquisitionError('VERSION_CONFLICT', 409);
  }
}

export async function createAcquisitionAssignment(
  database: SqlDatabase,
  input: {
    staffId: string; leadType: AcquisitionLeadType; channelId: string;
    effectiveFrom: number; effectiveUntil: number|null;
  },
  command: AcquisitionCommandContext,
): Promise<Result<{ assignment: AcquisitionChannelAssignmentDto }>> {
  requireAcquisitionAdmin(command.actor);
  const staffId = identifier(input.staffId);
  const channelId = identifier(input.channelId);
  const effectiveFrom = epoch(input.effectiveFrom);
  const effectiveUntil = input.effectiveUntil === null ? null : epoch(input.effectiveUntil);
  if (effectiveUntil !== null && effectiveUntil <= effectiveFrom) validation();
  const payload = { staff_id: staffId, lead_type: input.leadType,
    channel_id: channelId, effective_from: effectiveFrom,
    effective_until: effectiveUntil };
  const acquired = await acquireAcquisitionCommand<{ assignment: AcquisitionChannelAssignmentDto }>(
    database, command, 'CREATE_ACQUISITION_CHANNEL_ASSIGNMENT',
    'STAFF_ACQUISITION_ASSIGNMENT', `${staffId}:${input.leadType}:${effectiveFrom}`, payload,
  );
  if (acquired.acquired.kind === 'REPLAY') return { ...acquired.acquired.response, replayed: true };
  const channel = await readChannel(database, channelId);
  if (!channel || channel.status !== 'ACTIVE') {
    await failAcquisitionCommand(database, acquired.acquired.claim, acquired.now);
    throw new AcquisitionError('NOT_FOUND', 404);
  }
  const id = crypto.randomUUID();
  const assignment: AcquisitionChannelAssignmentDto = {
    assignment_id: id, staff_id: staffId, lead_type: input.leadType,
    channel_id: channelId, channel_name: channel.display_name,
    effective_from: effectiveFrom, effective_until: effectiveUntil,
    status: 'ACTIVE', version: 1,
  };
  try {
    await database.batch([
      database.prepare(`INSERT INTO acquisition_staff_channel_assignments (
        id,staff_id,lead_type,channel_id,effective_from,effective_until,
        status,version,created_by_staff_id,created_at,updated_at,
        revoked_at,revoke_reason
      ) VALUES (?,?,?,?,?,?,'ACTIVE',1,?,?,?,NULL,NULL)`).bind(
        id, staffId, input.leadType, channelId, effectiveFrom, effectiveUntil,
        command.actor.staffId, acquired.now, acquired.now,
      ),
      database.prepare(`INSERT INTO acquisition_assignment_events (
        id,assignment_id,event_type,actor_staff_id,idempotency_key,
        request_hash,reason,created_at
      ) VALUES (?,?,'CREATED',?,?,?,?,?)`).bind(
        crypto.randomUUID(), id, command.actor.staffId,
        command.idempotencyKey, acquired.requestHash, null, acquired.now,
      ),
      audit(database, command, 'STAFF_ACQUISITION_ASSIGNMENT', id,
        'ACQUISITION_ASSIGNMENT_CREATED', null, assignment, null, acquired.now),
      ...finishAcquisitionCommand(database, acquired.acquired.claim,
        { assignment }, acquired.now, { assignment_id: id }),
      assertion(database, `SELECT 1 FROM acquisition_staff_channel_assignments
        WHERE id=? AND status='ACTIVE' AND version=1`, [id]),
    ]);
    return { assignment, replayed: false };
  } catch (error) {
    await failAcquisitionCommand(database, acquired.acquired.claim, acquired.now);
    if (String(error).includes('overlapping')) throw new AcquisitionError('CONFLICT', 409);
    throw new AcquisitionError('VALIDATION_ERROR', 400);
  }
}

export async function revokeAcquisitionAssignment(
  database: SqlDatabase,
  input: { assignmentId: string; expectedVersion: number; reason: string },
  command: AcquisitionCommandContext,
): Promise<Result<{ assignment: AcquisitionChannelAssignmentDto }>> {
  requireAcquisitionAdmin(command.actor);
  const assignmentId = identifier(input.assignmentId);
  const expectedVersion = version(input.expectedVersion);
  const reason = text(input.reason, 1000);
  const existing = await readAssignment(database, assignmentId);
  if (!existing) throw new AcquisitionError('NOT_FOUND', 404);
  if (existing.status !== 'ACTIVE') throw new AcquisitionError('STATE_CONFLICT', 409);
  if (existing.version !== expectedVersion) throw new AcquisitionError('VERSION_CONFLICT', 409);
  const acquired = await acquireAcquisitionCommand<{ assignment: AcquisitionChannelAssignmentDto }>(
    database, command, 'REVOKE_ACQUISITION_CHANNEL_ASSIGNMENT',
    'STAFF_ACQUISITION_ASSIGNMENT', assignmentId,
    { expected_version: expectedVersion, reason },
  );
  if (acquired.acquired.kind === 'REPLAY') return { ...acquired.acquired.response, replayed: true };
  const assignment: AcquisitionChannelAssignmentDto = {
    ...toAssignment(existing), status: 'REVOKED', version: expectedVersion + 1,
  };
  try {
    await database.batch([
      database.prepare(`UPDATE acquisition_staff_channel_assignments
        SET status='REVOKED',version=version+1,updated_at=?,revoked_at=?,revoke_reason=?
        WHERE id=? AND status='ACTIVE' AND version=?`).bind(
        acquired.now, acquired.now, reason, assignmentId, expectedVersion,
      ),
      database.prepare(`INSERT INTO acquisition_assignment_events (
        id,assignment_id,event_type,actor_staff_id,idempotency_key,
        request_hash,reason,created_at
      ) VALUES (?,?,'REVOKED',?,?,?,?,?)`).bind(
        crypto.randomUUID(), assignmentId, command.actor.staffId,
        command.idempotencyKey, acquired.requestHash, reason, acquired.now,
      ),
      audit(database, command, 'STAFF_ACQUISITION_ASSIGNMENT', assignmentId,
        'ACQUISITION_ASSIGNMENT_REVOKED', toAssignment(existing), assignment,
        reason, acquired.now),
      ...finishAcquisitionCommand(database, acquired.acquired.claim,
        { assignment }, acquired.now, { assignment_id: assignmentId }),
      assertion(database, `SELECT 1 FROM acquisition_staff_channel_assignments
        WHERE id=? AND status='REVOKED' AND version=?`,
      [assignmentId, expectedVersion + 1]),
    ]);
    return { assignment, replayed: false };
  } catch {
    await failAcquisitionCommand(database, acquired.acquired.claim, acquired.now);
    throw new AcquisitionError('VERSION_CONFLICT', 409);
  }
}

export async function recordAcquisitionConsultation(
  database: SqlDatabase,
  input: {
    channelId: string; businessDate: string; personCount: number;
    expectedVersion: number; reason: string;
  },
  command: AcquisitionCommandContext,
): Promise<Result<{ consultation: AcquisitionDailyConsultationDto }>> {
  requireAcquisitionAdmin(command.actor);
  const channelId = identifier(input.channelId);
  let businessDate: string;
  try { businessDate = parseChinaBusinessDate(input.businessDate); }
  catch { validation(); }
  const personCount = count(input.personCount);
  const expectedVersion = input.expectedVersion;
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) validation();
  const reason = text(input.reason, 1000);
  const existing = await database.prepare(`SELECT id,channel_id,lead_type,business_date,
    person_count,version,updated_by_staff_id,created_at,updated_at
    FROM acquisition_daily_consultations
    WHERE channel_id=? AND business_date=?`).bind(channelId, businessDate)
    .first<ConsultationRow>();
  if ((!existing && expectedVersion !== 0)
    || (existing && Number(existing.version) !== expectedVersion)) {
    throw new AcquisitionError('VERSION_CONFLICT', 409);
  }
  const leadType = existing?.lead_type
    ?? await resolveConsultationLeadType(database, channelId, businessDate);
  const targetId = `${channelId}:${businessDate}`;
  const acquired = await acquireAcquisitionCommand<{ consultation: AcquisitionDailyConsultationDto }>(
    database, command, 'RECORD_ACQUISITION_CONSULTATION',
    'ACQUISITION_DAILY_CONSULTATION', targetId,
    { channel_id: channelId, lead_type: leadType, business_date: businessDate,
      person_count: personCount, expected_version: expectedVersion, reason },
  );
  if (acquired.acquired.kind === 'REPLAY') return { ...acquired.acquired.response, replayed: true };
  const id = existing?.id ?? crypto.randomUUID();
  const nextVersion = expectedVersion + 1;
  const consultation: AcquisitionDailyConsultationDto = {
    consultation_id: id, channel_id: channelId, lead_type: leadType,
    business_date: businessDate,
    person_count: personCount, version: nextVersion,
    updated_by_staff_id: command.actor.staffId, updated_at: acquired.now,
  };
  const mutation: SqlStatement = existing
    ? database.prepare(`UPDATE acquisition_daily_consultations
        SET person_count=?,version=version+1,updated_by_staff_id=?,updated_at=?
        WHERE id=? AND version=?`).bind(personCount, command.actor.staffId,
        acquired.now, id, expectedVersion)
    : database.prepare(`INSERT INTO acquisition_daily_consultations (
        id,channel_id,lead_type,business_date,person_count,version,updated_by_staff_id,
        created_at,updated_at
      ) VALUES (?,?,?,?,?,1,?,?,?)`).bind(id, channelId, leadType, businessDate,
        personCount, command.actor.staffId, acquired.now, acquired.now);
  try {
    await database.batch([
      mutation,
      database.prepare(`INSERT INTO acquisition_daily_consultation_events (
        id,consultation_id,event_type,previous_count,next_count,
        previous_version,next_version,actor_staff_id,idempotency_key,
        request_hash,reason,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        crypto.randomUUID(), id, existing ? 'CORRECTED' : 'RECORDED',
        existing?.person_count ?? null, personCount,
        existing?.version ?? null, nextVersion, command.actor.staffId,
        command.idempotencyKey, acquired.requestHash, reason, acquired.now,
      ),
      audit(database, command, 'ACQUISITION_DAILY_CONSULTATION', id,
        existing ? 'ACQUISITION_CONSULTATION_CORRECTED' : 'ACQUISITION_CONSULTATION_RECORDED',
        existing ? toConsultation(existing) : null, consultation, reason, acquired.now),
      ...finishAcquisitionCommand(database, acquired.acquired.claim,
        { consultation }, acquired.now, { consultation_id: id }),
      assertion(database, `SELECT 1 FROM acquisition_daily_consultations
        WHERE id=? AND version=? AND person_count=?`,
      [id, nextVersion, personCount]),
    ]);
    return { consultation, replayed: false };
  } catch {
    await failAcquisitionCommand(database, acquired.acquired.claim, acquired.now);
    throw new AcquisitionError('VERSION_CONFLICT', 409);
  }
}

export async function listAcquisitionChannels(database: SqlDatabase, actor: AssignmentStaffAuthorization) {
  if (!actor.roles.has('owner')) throw new AcquisitionError('FORBIDDEN', 403);
  requireAcquisitionAdmin(actor);
  const rows = await database.prepare(`SELECT id,code,channel_type,display_name,
    status,version,created_at,updated_at FROM acquisition_channels
    ORDER BY status,display_name,id`).all<ChannelRow>();
  return rows.results.map(toChannel);
}

export async function listAcquisitionAssignments(database: SqlDatabase, actor: AssignmentStaffAuthorization) {
  requireAcquisitionAdmin(actor);
  const rows = await database.prepare(`SELECT assignment.id,assignment.staff_id,
    assignment.lead_type,assignment.channel_id,channel.display_name AS channel_name,
    assignment.effective_from,assignment.effective_until,assignment.status,
    assignment.version FROM acquisition_staff_channel_assignments assignment
    JOIN acquisition_channels channel ON channel.id=assignment.channel_id
    ORDER BY assignment.effective_from DESC,assignment.id DESC`)
    .all<AssignmentRow>();
  return rows.results.map(toAssignment);
}

export async function listAcquisitionConsultations(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  fromDate: string,
  toDate: string,
) {
  requireAcquisitionAdmin(actor);
  let from: string; let to: string;
  try { from = parseChinaBusinessDate(fromDate); to = parseChinaBusinessDate(toDate); }
  catch { validation(); }
  if (from > to) validation();
  const rows = await database.prepare(`SELECT id,channel_id,lead_type,business_date,
    person_count,version,updated_by_staff_id,created_at,updated_at
    FROM acquisition_daily_consultations
    WHERE business_date BETWEEN ? AND ?
    ORDER BY business_date DESC,channel_id`).bind(from, to).all<ConsultationRow>();
  return rows.results.map(toConsultation);
}

export async function listAcquisitionConsultationHistory(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  consultationId: string,
): Promise<AcquisitionConsultationEventDto[]> {
  requireAcquisitionAdmin(actor);
  const id = identifier(consultationId);
  const exists = await database.prepare(`SELECT 1 AS present
    FROM acquisition_daily_consultations WHERE id=?`).bind(id).first();
  if (!exists) throw new AcquisitionError('NOT_FOUND', 404);
  const rows = await database.prepare(`SELECT id,event_type,previous_count,
    next_count,previous_version,next_version,actor_staff_id,reason,created_at
    FROM acquisition_daily_consultation_events WHERE consultation_id=?
    ORDER BY created_at,id`).bind(id).all<{
      id: string; event_type: 'RECORDED'|'CORRECTED'; previous_count: number|null;
      next_count: number; previous_version: number|null; next_version: number;
      actor_staff_id: string; reason: string; created_at: number;
    }>();
  return rows.results.map((row) => ({
    event_id: row.id, event_type: row.event_type,
    previous_count: row.previous_count === null ? null : Number(row.previous_count),
    next_count: Number(row.next_count),
    previous_version: row.previous_version === null ? null : Number(row.previous_version),
    next_version: Number(row.next_version), actor_staff_id: row.actor_staff_id,
    reason: row.reason, created_at: Number(row.created_at),
  }));
}

function audit(
  database: SqlDatabase,
  command: AcquisitionCommandContext,
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  previousState: unknown,
  nextState: unknown,
  reason: string|null,
  createdAt: number,
) {
  return createAuditEventStatement(database, {
    id: crypto.randomUUID(), aggregateType, aggregateId, eventType,
    actor: actor(command.actor), requestId: command.requestId,
    idempotencyKey: command.idempotencyKey, previousState, nextState,
    reason, createdAt,
  });
}

function actor(value: AssignmentStaffAuthorization) {
  return { type: 'STAFF', id: value.staffId, roles: [...value.roles] };
}

function assertion(database: SqlDatabase, query: string, bindings: unknown[]) {
  return database.prepare(`INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN EXISTS (${query}) THEN 1 ELSE 0 END`).bind(...bindings);
}

async function readChannel(database: SqlDatabase, id: string) {
  return database.prepare(`SELECT id,code,channel_type,display_name,status,
    version,created_at,updated_at FROM acquisition_channels WHERE id=?`)
    .bind(id).first<ChannelRow>();
}

async function readAssignment(database: SqlDatabase, id: string) {
  return database.prepare(`SELECT assignment.id,assignment.staff_id,
    assignment.lead_type,assignment.channel_id,channel.display_name AS channel_name,
    assignment.effective_from,assignment.effective_until,assignment.status,
    assignment.version FROM acquisition_staff_channel_assignments assignment
    JOIN acquisition_channels channel ON channel.id=assignment.channel_id
    WHERE assignment.id=?`).bind(id).first<AssignmentRow>();
}

function toChannel(row: ChannelRow): AcquisitionChannelDto {
  return { channel_id: row.id, code: row.code, channel_type: row.channel_type,
    display_name: row.display_name, status: row.status, version: Number(row.version),
    created_at: Number(row.created_at), updated_at: Number(row.updated_at) };
}

function toAssignment(row: AssignmentRow): AcquisitionChannelAssignmentDto {
  return { assignment_id: row.id, staff_id: row.staff_id,
    lead_type: row.lead_type, channel_id: row.channel_id,
    channel_name: row.channel_name, effective_from: Number(row.effective_from),
    effective_until: row.effective_until === null ? null : Number(row.effective_until),
    status: row.status, version: Number(row.version) };
}

function toConsultation(row: ConsultationRow): AcquisitionDailyConsultationDto {
  return { consultation_id: row.id, channel_id: row.channel_id,
    lead_type: row.lead_type, business_date: row.business_date,
    person_count: Number(row.person_count),
    version: Number(row.version), updated_by_staff_id: row.updated_by_staff_id,
    updated_at: Number(row.updated_at) };
}

async function resolveConsultationLeadType(
  database: SqlDatabase,
  channelId: string,
  businessDate: string,
): Promise<AcquisitionLeadType> {
  const dayStart = chinaBusinessDateStartEpoch(businessDate);
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const rows = await database.prepare(`SELECT DISTINCT lead_type
    FROM acquisition_staff_channel_assignments
    WHERE channel_id=? AND status='ACTIVE'
      AND effective_from<? AND COALESCE(effective_until,9223372036854775807)>?`)
    .bind(channelId, dayEnd, dayStart).all<{ lead_type: AcquisitionLeadType }>();
  if (rows.results.length === 0) {
    throw new AcquisitionError('CHANNEL_CONFIGURATION_MISSING', 409);
  }
  if (rows.results.length > 1) {
    throw new AcquisitionError('CHANNEL_CONFIGURATION_AMBIGUOUS', 409);
  }
  return rows.results[0]!.lead_type;
}

function identifier(value: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200
    || /[\u0000-\u001f\u007f]/u.test(value)) validation();
  return value;
}
function normalizedCode(value: string): string {
  const code = value.normalize('NFKC').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,40}$/u.test(code)) validation();
  return code;
}
function text(value: string, maximum: number): string {
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1 || normalized.length > maximum
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) validation();
  return normalized;
}
function version(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) validation();
  return value;
}
function epoch(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) validation();
  return value;
}
function count(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) validation();
  return value;
}
