import type {
  AcquisitionLeadDto,
  AcquisitionLeadType,
  AcquisitionPage,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { canonicalJson, chinaBusinessDate } from '@ygb/domain';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { createAuditEventStatement } from '../foundation/audit';
import { requireAcquisitionAdmin, requireLeadDuty, visibleLeadTypes } from './authorization';
import {
  acquireAcquisitionCommand,
  failAcquisitionCommand,
  finishAcquisitionCommand,
  type AcquisitionCommandContext,
} from './command';
import { AcquisitionError, validation } from './errors';
import { protectWechatIdentity } from './privacy';
import { addTwelveShanghaiMonths } from './time';

interface LeadRow {
  id: string; lead_type: AcquisitionLeadType; wechat_masked: string;
  display_name: string|null; note: string|null; origin_channel_id: string;
  origin_channel_name: string; origin_staff_id: string;
  current_owner_staff_id: string; status: 'ACTIVE'|'INVALIDATED'|'ANONYMIZED';
  version: number; created_business_date: string; latest_followup_at: number;
  retention_due_at: number; retention_hold_reason: 'SECURITY'|'DISPUTE'|'LEGAL'|null;
  registered: number; reservation_submitted: number; formal_order_count: number;
  seller_cooperation: number; created_at: number; updated_at: number;
}
interface BaseLeadRow {
  id: string; lead_type: AcquisitionLeadType; status: 'ACTIVE'|'INVALIDATED'|'ANONYMIZED';
  version: number; origin_staff_id: string; current_owner_staff_id: string;
}

export async function createAcquisitionLead(
  database: SqlDatabase,
  input: {
    leadType: AcquisitionLeadType; wechatId: string;
    displayName: string|null; note: string|null;
  },
  command: AcquisitionCommandContext,
  identitySecret: string,
): Promise<{ lead: AcquisitionLeadDto; replayed: boolean }> {
  requireLeadDuty(command.actor, input.leadType);
  const displayName = optionalText(input.displayName, 100);
  const note = optionalText(input.note, 1000);
  let identity;
  try { identity = await protectWechatIdentity(input.wechatId, identitySecret); }
  catch (error) {
    if (error instanceof AcquisitionError) throw error;
    validation();
  }
  const now = command.now ?? Date.now();
  const assignments = await database.prepare(`SELECT assignment.channel_id
    FROM acquisition_staff_channel_assignments assignment
    JOIN acquisition_channels channel ON channel.id=assignment.channel_id
    WHERE assignment.staff_id=? AND assignment.lead_type=?
      AND assignment.status='ACTIVE' AND channel.status='ACTIVE'
      AND assignment.effective_from<=?
      AND (assignment.effective_until IS NULL OR assignment.effective_until>?)
    ORDER BY assignment.id`).bind(command.actor.staffId, input.leadType, now, now)
    .all<{ channel_id: string }>();
  if (assignments.results.length === 0) {
    throw new AcquisitionError('CHANNEL_CONFIGURATION_MISSING', 409);
  }
  if (assignments.results.length !== 1) {
    throw new AcquisitionError('CHANNEL_CONFIGURATION_AMBIGUOUS', 409);
  }
  const channelId = assignments.results[0]!.channel_id;
  const acquired = await acquireAcquisitionCommand<{ lead_id: string }>(
    database, command, 'CREATE_ACQUISITION_LEAD', 'ACQUISITION_LEAD',
    `${input.leadType}:${identity.hash}`,
    { lead_type: input.leadType, identity_hash: identity.hash,
      display_name: displayName, note },
  );
  if (acquired.acquired.kind === 'REPLAY') {
    return { lead: await readAcquisitionLead(database, command.actor,
      acquired.acquired.response.lead_id), replayed: true };
  }
  const duplicate = await database.prepare(`SELECT id FROM acquisition_leads
    WHERE lead_type=? AND identity_hash=? AND status='ACTIVE'`)
    .bind(input.leadType, identity.hash).first<{ id: string }>();
  if (duplicate) {
    await failAcquisitionCommand(database, acquired.acquired.claim, acquired.now);
    throw new AcquisitionError('DUPLICATE_LEAD', 409);
  }
  const id = crypto.randomUUID();
  const retentionDueAt = addTwelveShanghaiMonths(acquired.now);
  const statements: SqlStatement[] = [
    database.prepare(`INSERT INTO acquisition_leads (
      id,lead_type,identity_hash,identity_ciphertext,identity_iv,wechat_masked,
      display_name,note,origin_channel_id,origin_staff_id,current_owner_staff_id,
      status,invalidation_reason,retention_hold_reason,version,
      created_business_date,latest_followup_at,retention_due_at,
      created_at,updated_at,invalidated_at,anonymized_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',NULL,NULL,1,?,?,?,?,?,NULL,NULL)`)
      .bind(id, input.leadType, identity.hash, identity.ciphertext, identity.iv,
        identity.masked, displayName, note, channelId, command.actor.staffId,
        command.actor.staffId, chinaBusinessDate(acquired.now), acquired.now,
        retentionDueAt, acquired.now, acquired.now),
    database.prepare(`INSERT INTO acquisition_lead_events (
      id,lead_id,event_type,previous_version,next_version,actor_type,actor_id,
      idempotency_key,request_hash,reason,metadata_json,created_at
    ) VALUES (?,?,'CREATED',NULL,1,'STAFF',?,?,?,?,?,?)`).bind(
      crypto.randomUUID(), id, command.actor.staffId, command.idempotencyKey,
      acquired.requestHash, null, canonicalJson({ origin_channel_id: channelId }),
      acquired.now,
    ),
    ...initialLinkStatements(database, id, input.leadType,
      identity.normalized, acquired.now),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(), aggregateType: 'ACQUISITION_LEAD',
      aggregateId: id, eventType: 'ACQUISITION_LEAD_CREATED',
      actor: auditActor(command.actor), requestId: command.requestId,
      idempotencyKey: command.idempotencyKey,
      nextState: { lead_id: id, lead_type: input.leadType,
        wechat_masked: identity.masked, origin_channel_id: channelId,
        origin_staff_id: command.actor.staffId, version: 1 },
      createdAt: acquired.now,
    }),
    ...finishAcquisitionCommand(database, acquired.acquired.claim,
      { lead_id: id }, acquired.now, { lead_id: id }),
    assertion(database, `SELECT 1 FROM acquisition_leads
      WHERE id=? AND status='ACTIVE' AND version=1
        AND origin_channel_id=? AND origin_staff_id=?`,
    [id, channelId, command.actor.staffId]),
  ];
  try {
    await database.batch(statements);
  } catch (error) {
    await failAcquisitionCommand(database, acquired.acquired.claim, acquired.now);
    if (String(error).includes('UNIQUE')) throw new AcquisitionError('DUPLICATE_LEAD', 409);
    throw error;
  }
  return { lead: await readAcquisitionLead(database, command.actor, id), replayed: false };
}

export async function followUpAcquisitionLead(
  database: SqlDatabase,
  input: { leadId: string; expectedVersion: number; note: string|null },
  command: AcquisitionCommandContext,
) {
  const existing = await mutableLead(database, command.actor, input.leadId, input.expectedVersion);
  requireLeadDuty(command.actor, existing.lead_type);
  if (existing.status === 'ANONYMIZED') throw new AcquisitionError('STATE_CONFLICT', 409);
  const note = optionalText(input.note, 1000);
  const now = command.now ?? Date.now();
  return mutateLead(database, existing, command, {
    action: 'FOLLOW_UP_ACQUISITION_LEAD', eventType: 'FOLLOWED_UP',
    reason: note,
    update: `latest_followup_at=?,retention_due_at=?,note=?,version=version+1,updated_at=?`,
    bindings: [now, addTwelveShanghaiMonths(now), note, now],
    nextState: { latest_followup_at: now, retention_due_at: addTwelveShanghaiMonths(now), note },
  });
}

export async function invalidateAcquisitionLead(
  database: SqlDatabase,
  input: { leadId: string; expectedVersion: number; reason: string },
  command: AcquisitionCommandContext,
) {
  const existing = await mutableLead(database, command.actor, input.leadId, input.expectedVersion);
  requireLeadDuty(command.actor, existing.lead_type);
  if (existing.status !== 'ACTIVE') throw new AcquisitionError('STATE_CONFLICT', 409);
  const reason = requiredText(input.reason, 1000);
  const now = command.now ?? Date.now();
  return mutateLead(database, existing, command, {
    action: 'INVALIDATE_ACQUISITION_LEAD', eventType: 'INVALIDATED', reason,
    update: `status='INVALIDATED',invalidation_reason=?,invalidated_at=?,
      version=version+1,updated_at=?`,
    bindings: [reason, now, now],
    nextState: { status: 'INVALIDATED', invalidation_reason: reason, invalidated_at: now },
  });
}

export async function transferAcquisitionLead(
  database: SqlDatabase,
  input: {
    leadId: string; expectedVersion: number; newOwnerStaffId: string; reason: string;
  },
  command: AcquisitionCommandContext,
) {
  const existing = await mutableLead(database, command.actor, input.leadId, input.expectedVersion);
  requireLeadDuty(command.actor, existing.lead_type);
  if (existing.status !== 'ACTIVE') throw new AcquisitionError('STATE_CONFLICT', 409);
  const target = identifier(input.newOwnerStaffId);
  const reason = requiredText(input.reason, 1000);
  const targetValid = await database.prepare(`SELECT 1 AS present
    FROM staff_users staff JOIN staff_role_assignments role ON role.staff_id=staff.id
    WHERE staff.id=? AND staff.status='ACTIVE' AND role.status='ACTIVE'
      AND (role.role_code='owner'
        OR (?='BUYER' AND role.role_code='pre_sales')
        OR (?='SELLER' AND role.role_code='seller_ops'))`)
    .bind(target, existing.lead_type, existing.lead_type).first();
  if (!targetValid) throw new AcquisitionError('VALIDATION_ERROR', 400);
  return mutateLead(database, existing, command, {
    action: 'TRANSFER_ACQUISITION_LEAD', eventType: 'TRANSFERRED', reason,
    update: `current_owner_staff_id=?,version=version+1,updated_at=?`,
    bindings: [target, command.now ?? Date.now()],
    nextState: { current_owner_staff_id: target },
  });
}

export async function setAcquisitionRetentionHold(
  database: SqlDatabase,
  input: {
    leadId: string; expectedVersion: number;
    holdReason: 'SECURITY'|'DISPUTE'|'LEGAL'|null; reason: string;
  },
  command: AcquisitionCommandContext,
) {
  requireAcquisitionAdmin(command.actor);
  const existing = await mutableLead(database, command.actor, input.leadId, input.expectedVersion);
  if (existing.status === 'ANONYMIZED') throw new AcquisitionError('STATE_CONFLICT', 409);
  const reason = requiredText(input.reason, 1000);
  return mutateLead(database, existing, command, {
    action: 'SET_ACQUISITION_RETENTION_HOLD',
    eventType: input.holdReason === null ? 'RETENTION_HOLD_CLEARED' : 'RETENTION_HOLD_SET',
    reason, update: `retention_hold_reason=?,version=version+1,updated_at=?`,
    bindings: [input.holdReason, command.now ?? Date.now()],
    nextState: { retention_hold_reason: input.holdReason },
  });
}

export async function readAcquisitionLead(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  leadId: string,
): Promise<AcquisitionLeadDto> {
  const id = identifier(leadId);
  const row = await database.prepare(leadProjectionSql('lead.id=?'))
    .bind(id).first<LeadRow>();
  if (!row || !await canSeeLead(database, actor, row)) {
    throw new AcquisitionError('NOT_FOUND', 404);
  }
  requireLeadDuty(actor, row.lead_type);
  return toLead(row);
}

export async function listAcquisitionLeads(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  input: { leadType: AcquisitionLeadType|null; cursor: string|null; limit: number },
): Promise<AcquisitionPage<AcquisitionLeadDto>> {
  const allowed = visibleLeadTypes(actor);
  if (input.leadType !== null && !allowed.includes(input.leadType)) {
    throw new AcquisitionError('FORBIDDEN', 403);
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) validation();
  const cursor = decodeCursor(input.cursor);
  const types = input.leadType === null ? allowed : [input.leadType];
  const typePlaceholders = types.map(() => '?').join(',');
  const visibility = visibilitySql(actor, 'lead');
  const rows = await database.prepare(`${leadProjectionSql(`lead.lead_type IN (${typePlaceholders})
    AND (? IS NULL OR lead.created_at<? OR (lead.created_at=? AND lead.id<?))
    AND ${visibility.sql}`)}
    ORDER BY lead.created_at DESC,lead.id DESC LIMIT ?`).bind(
      ...types, cursor?.createdAt ?? null, cursor?.createdAt ?? null,
      cursor?.createdAt ?? null, cursor?.id ?? null, ...visibility.bindings,
      input.limit + 1,
    ).all<LeadRow>();
  const visible = rows.results.map(toLead);
  const items = visible.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items,
    next_cursor: visible.length > input.limit && last
      ? encodeCursor({ createdAt: last.created_at, id: last.lead_id }) : null,
  };
}

function visibilitySql(actor: AssignmentStaffAuthorization, alias: string) {
  if (actor.roles.has('owner')) return { sql: '1=1', bindings: [] as unknown[] };
  const teamIds = actor.permissions.has('TASK_VIEW_TEAM') ? actor.leaderTeamIds : [];
  const placeholders = teamIds.length ? teamIds.map(() => '?').join(',') : "''";
  return {
    sql: `(${alias}.origin_staff_id=? OR ${alias}.current_owner_staff_id=?
      OR EXISTS (SELECT 1 FROM staff_team_memberships membership
        WHERE membership.staff_id IN (${alias}.origin_staff_id,${alias}.current_owner_staff_id)
          AND membership.status='ACTIVE' AND membership.team_id IN (${placeholders})))`,
    bindings: [actor.staffId, actor.staffId, ...teamIds] as unknown[],
  };
}

async function mutateLead(
  database: SqlDatabase,
  existing: BaseLeadRow,
  command: AcquisitionCommandContext,
  mutation: {
    action: string; eventType: string; reason: string|null;
    update: string; bindings: unknown[]; nextState: Record<string, unknown>;
  },
) {
  const acquired = await acquireAcquisitionCommand<{ lead_id: string }>(
    database, command, mutation.action, 'ACQUISITION_LEAD', existing.id,
    { expected_version: existing.version, ...mutation.nextState,
      reason: mutation.reason },
  );
  if (acquired.acquired.kind === 'REPLAY') {
    return { lead: await readAcquisitionLead(database, command.actor, existing.id), replayed: true };
  }
  const nextVersion = existing.version + 1;
  try {
    await database.batch([
      database.prepare(`UPDATE acquisition_leads SET ${mutation.update}
        WHERE id=? AND version=?`).bind(...mutation.bindings, existing.id, existing.version),
      database.prepare(`INSERT INTO acquisition_lead_events (
        id,lead_id,event_type,previous_version,next_version,actor_type,actor_id,
        idempotency_key,request_hash,reason,metadata_json,created_at
      ) VALUES (?,?,?,?,?,'STAFF',?,?,?,?,?,?)`).bind(
        crypto.randomUUID(), existing.id, mutation.eventType,
        existing.version, nextVersion, command.actor.staffId,
        command.idempotencyKey, acquired.requestHash, mutation.reason,
        canonicalJson(mutation.nextState), acquired.now,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(), aggregateType: 'ACQUISITION_LEAD',
        aggregateId: existing.id, eventType: `ACQUISITION_LEAD_${mutation.eventType}`,
        actor: auditActor(command.actor), requestId: command.requestId,
        idempotencyKey: command.idempotencyKey,
        previousState: { status: existing.status, version: existing.version,
          current_owner_staff_id: existing.current_owner_staff_id },
        nextState: { ...mutation.nextState, version: nextVersion },
        reason: mutation.reason, createdAt: acquired.now,
      }),
      ...finishAcquisitionCommand(database, acquired.acquired.claim,
        { lead_id: existing.id }, acquired.now, { lead_id: existing.id }),
      assertion(database, `SELECT 1 FROM acquisition_leads WHERE id=? AND version=?`,
        [existing.id, nextVersion]),
    ]);
  } catch {
    await failAcquisitionCommand(database, acquired.acquired.claim, acquired.now);
    throw new AcquisitionError('VERSION_CONFLICT', 409);
  }
  return { lead: await readAcquisitionLead(database, command.actor, existing.id), replayed: false };
}

async function mutableLead(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  leadId: string,
  expectedVersion: number,
): Promise<BaseLeadRow> {
  const id = identifier(leadId);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) validation();
  const row = await database.prepare(`SELECT id,lead_type,status,version,
    origin_staff_id,current_owner_staff_id FROM acquisition_leads WHERE id=?`)
    .bind(id).first<BaseLeadRow>();
  if (!row || !await canSeeLead(database, actor, row)) throw new AcquisitionError('NOT_FOUND', 404);
  if (Number(row.version) !== expectedVersion) throw new AcquisitionError('VERSION_CONFLICT', 409);
  return { ...row, version: Number(row.version) };
}

async function canSeeLead(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  lead: Pick<BaseLeadRow,'origin_staff_id'|'current_owner_staff_id'>,
): Promise<boolean> {
  if (actor.roles.has('owner')) return true;
  if (lead.origin_staff_id === actor.staffId || lead.current_owner_staff_id === actor.staffId) return true;
  if (actor.leaderTeamIds.length === 0 || !actor.permissions.has('TASK_VIEW_TEAM')) return false;
  const placeholders = actor.leaderTeamIds.map(() => '?').join(',');
  const row = await database.prepare(`SELECT 1 AS present
    FROM staff_team_memberships membership
    WHERE membership.staff_id IN (?,?) AND membership.status='ACTIVE'
      AND membership.team_id IN (${placeholders}) LIMIT 1`).bind(
      lead.origin_staff_id, lead.current_owner_staff_id, ...actor.leaderTeamIds,
    ).first();
  return Boolean(row);
}

function initialLinkStatements(
  database: SqlDatabase,
  leadId: string,
  leadType: AcquisitionLeadType,
  normalizedWechat: string,
  now: number,
): SqlStatement[] {
  const insert = (linkType: string, targetSql: string, bindings: unknown[]) =>
    database.prepare(`INSERT OR IGNORE INTO acquisition_lead_links (
      id,lead_id,link_type,target_id,linked_at
    ) SELECT lower(hex(randomblob(16))),?, '${linkType}',target.id,?
      FROM (${targetSql}) target`).bind(leadId, now, ...bindings);
  return [
    insert('IDENTITY_SUBJECT', `SELECT identity_subject_id AS id
      FROM wechat_identity_claims WHERE normalized_wechat=? AND status='ACTIVE'`,
    [normalizedWechat]),
    ...(leadType === 'BUYER' ? [
      insert('BUYER_CUSTOMER', `SELECT buyer.id FROM buyer_customers buyer
        JOIN wechat_identity_claims claim
          ON claim.identity_subject_id=buyer.identity_subject_id
        WHERE claim.normalized_wechat=? AND claim.status='ACTIVE'`, [normalizedWechat]),
      insert('RESERVATION', `SELECT reservation.id FROM product_reservations reservation
        JOIN buyer_customers buyer ON buyer.id=reservation.buyer_customer_id
        JOIN wechat_identity_claims claim
          ON claim.identity_subject_id=buyer.identity_subject_id
        WHERE claim.normalized_wechat=? AND claim.status='ACTIVE'`, [normalizedWechat]),
      insert('FORMAL_ORDER', `SELECT formal_order.id FROM formal_orders formal_order
        JOIN buyer_customers buyer ON buyer.id=formal_order.buyer_customer_id
        JOIN wechat_identity_claims claim
          ON claim.identity_subject_id=buyer.identity_subject_id
        WHERE claim.normalized_wechat=? AND claim.status='ACTIVE'`, [normalizedWechat]),
    ] : [
      insert('SELLER_MEMBER', `SELECT member.id FROM seller_organization_members member
        JOIN wechat_identity_claims claim
          ON claim.identity_subject_id=member.identity_subject_id
        WHERE claim.normalized_wechat=? AND claim.status='ACTIVE'`, [normalizedWechat]),
      insert('SELLER_ORGANIZATION', `SELECT organization.id
        FROM seller_organization_members member
        JOIN seller_organizations organization ON organization.id=member.organization_id
        JOIN wechat_identity_claims claim
          ON claim.identity_subject_id=member.identity_subject_id
        WHERE claim.normalized_wechat=? AND claim.status='ACTIVE'
          AND member.status='ACTIVE' AND organization.status='ACTIVE'`, [normalizedWechat]),
    ]),
  ];
}

function leadProjectionSql(where: string): string {
  return `SELECT lead.id,lead.lead_type,lead.wechat_masked,lead.display_name,
    lead.note,lead.origin_channel_id,channel.display_name AS origin_channel_name,
    lead.origin_staff_id,lead.current_owner_staff_id,lead.status,lead.version,
    lead.created_business_date,lead.latest_followup_at,lead.retention_due_at,
    lead.retention_hold_reason,lead.created_at,lead.updated_at,
    EXISTS(SELECT 1 FROM acquisition_lead_links link
      WHERE link.lead_id=lead.id AND link.link_type='BUYER_CUSTOMER') AS registered,
    EXISTS(SELECT 1 FROM acquisition_lead_links link
      WHERE link.lead_id=lead.id AND link.link_type='RESERVATION') AS reservation_submitted,
    (SELECT COUNT(*) FROM acquisition_lead_links link
      WHERE link.lead_id=lead.id AND link.link_type='FORMAL_ORDER') AS formal_order_count,
    EXISTS(SELECT 1 FROM acquisition_lead_links link
      WHERE link.lead_id=lead.id AND link.link_type='SELLER_ORGANIZATION') AS seller_cooperation
    FROM acquisition_leads lead
    JOIN acquisition_channels channel ON channel.id=lead.origin_channel_id
    WHERE ${where}`;
}

function toLead(row: LeadRow): AcquisitionLeadDto {
  const reservationSubmitted = Number(row.reservation_submitted) === 1;
  return {
    lead_id: row.id, lead_type: row.lead_type,
    wechat_masked: row.wechat_masked, display_name: row.display_name,
    note: row.note, origin_channel_id: row.origin_channel_id,
    origin_channel_name: row.origin_channel_name,
    origin_staff_id: row.origin_staff_id,
    current_owner_staff_id: row.current_owner_staff_id,
    status: row.status, version: Number(row.version),
    created_business_date: row.created_business_date,
    latest_followup_at: Number(row.latest_followup_at),
    retention_due_at: Number(row.retention_due_at),
    retention_hold_reason: row.retention_hold_reason,
    registered: Number(row.registered) === 1,
    reservation_submitted: reservationSubmitted,
    no_participation: row.lead_type === 'BUYER' && row.status === 'ACTIVE'
      && !reservationSubmitted,
    formal_order_count: Number(row.formal_order_count),
    seller_cooperation: Number(row.seller_cooperation) === 1,
    created_at: Number(row.created_at), updated_at: Number(row.updated_at),
  };
}

function auditActor(actor: AssignmentStaffAuthorization) {
  return { type: 'STAFF', id: actor.staffId, roles: [...actor.roles] };
}
function assertion(database: SqlDatabase, query: string, bindings: unknown[]) {
  return database.prepare(`INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN EXISTS (${query}) THEN 1 ELSE 0 END`).bind(...bindings);
}
function identifier(value: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200
    || /[\u0000-\u001f\u007f]/u.test(value)) validation();
  return value;
}
function optionalText(value: string|null, maximum: number): string|null {
  if (value === null) return null;
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maximum
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) validation();
  return normalized;
}
function requiredText(value: string, maximum: number): string {
  const normalized = optionalText(value, maximum);
  if (normalized === null) validation();
  return normalized;
}
function encodeCursor(value: { createdAt: number; id: string }): string {
  return btoa(JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/u,'');
}
function decodeCursor(value: string|null): { createdAt: number; id: string }|null {
  if (value === null) return null;
  try {
    const normalized = value.replaceAll('-','+').replaceAll('_','/');
    const parsed = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,'='))) as Record<string,unknown>;
    if (!Number.isSafeInteger(parsed['createdAt']) || Number(parsed['createdAt']) < 0
      || typeof parsed['id'] !== 'string' || parsed['id'].length < 1) validation();
    return { createdAt: Number(parsed['createdAt']), id: parsed['id'] };
  } catch { validation(); }
}
