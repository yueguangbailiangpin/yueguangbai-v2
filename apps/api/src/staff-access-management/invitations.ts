import {
  STAFF_BINDING_INVITATION_TTL_MS,
  STAFF_ROLE_DISPLAY_NAMES,
  isStaffRoleCode,
  type CancelStaffBindingInvitationResponse,
  type CreateStaffBindingInvitationResponse,
  type SqlDatabase,
  type SqlStatement,
  type StaffBindingInvitationDto,
  type StaffRoleCode,
  type StaffAccessTeamOptionDto,
} from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  IdempotencyError,
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import {
  createOutboxStatements,
  prepareOutboxEvent,
} from '../foundation/outbox';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  generateStaffOpaqueToken,
  hashStaffOpaqueToken,
} from '../staff-auth/crypto';
import { StaffAccessManagementError } from './errors';

interface InvitationRow {
  id: string;
  display_name: string;
  role_code: string;
  team_id: string | null;
  team_name: string | null;
  department_name: string | null;
  status: 'ISSUED' | 'CONSUMED' | 'CANCELLED' | 'EXPIRED';
  version: number;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
  cancelled_at: number | null;
}

interface PersistedCreateResponse {
  invitation: StaffBindingInvitationDto;
}

export async function createStaffBindingInvitation(
  database: SqlDatabase,
  input: {
    displayName: string;
    roleCode: StaffRoleCode;
    teamId: string | null;
  },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<CreateStaffBindingInvitationResponse> {
  const displayName = cleanDisplayName(input.displayName);
  if (!isStaffRoleCode(input.roleCode)) validation();
  const team = await resolveInvitationTeam(database, input.roleCode, input.teamId);
  const now = validNow(command.now ?? Date.now());
  const requestHash = await hashCanonicalJson({
    action: 'CREATE_STAFF_BINDING_INVITATION',
    display_name: displayName,
    role_code: input.roleCode,
    team_id: team?.team_id ?? null,
  });
  let acquired;
  try {
    acquired = await acquireIdempotency<PersistedCreateResponse>(database, {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'CREATE_STAFF_BINDING_INVITATION',
      targetType: 'STAFF_BINDING_INVITATION',
      targetId: `new:${requestHash}`,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    }, { now });
  } catch (error) {
    throw normalizeIdempotency(error);
  }
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, invitation_path: null, replayed: true };
  }

  const token = generateStaffOpaqueToken();
  const tokenHash = await hashStaffOpaqueToken(token);
  const invitationId = crypto.randomUUID();
  const expiresAt = now + STAFF_BINDING_INVITATION_TTL_MS;
  const invitation = projectInvitation({
    id: invitationId,
    display_name: displayName,
    role_code: input.roleCode,
    team_id: team?.team_id ?? null,
    team_name: team?.team_name ?? null,
    department_name: team?.department_name ?? null,
    status: 'ISSUED',
    version: 1,
    created_at: now,
    expires_at: expiresAt,
    consumed_at: null,
    cancelled_at: null,
  });
  const persisted: PersistedCreateResponse = { invitation };
  const outbox = await prepareOutboxEvent({
    id: crypto.randomUUID(),
    dedupKey: `staff-binding-invitation-issued:${invitationId}`,
    eventType: 'STAFF_BINDING_INVITATION_ISSUED',
    aggregateType: 'STAFF_BINDING_INVITATION',
    aggregateId: invitationId,
    payload: {
      invitation_id: invitationId,
      display_name: displayName,
      role_code: input.roleCode,
      team_id: team?.team_id ?? null,
      expires_at: expiresAt,
    },
    createdAt: now,
  });

  const statements: SqlStatement[] = [
    database.prepare(`
      INSERT INTO staff_binding_invitations (
        id,token_hash,display_name,role_code,team_id,issued_by_staff_id,status,
        consumed_staff_id,expires_at,consumed_at,cancelled_at,version,
        created_at,updated_at
      ) VALUES (?,?,?,?,?,?,'ISSUED',NULL,?,NULL,NULL,1,?,?)
    `).bind(
      invitationId,
      tokenHash,
      displayName,
      input.roleCode,
      team?.team_id ?? null,
      command.actor.staffId,
      expiresAt,
      now,
      now,
    ),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'STAFF_BINDING_INVITATION',
      aggregateId: invitationId,
      eventType: 'STAFF_BINDING_INVITATION_ISSUED',
      actor: actor(command.actor),
      requestId: command.requestId ?? null,
      idempotencyKey: acquired.claim.idempotencyKey,
      previousState: null,
      nextState: {
        display_name: displayName,
        role_code: input.roleCode,
        team_id: team?.team_id ?? null,
        status: 'ISSUED',
        expires_at: expiresAt,
      },
      createdAt: now,
    }),
    ...createOutboxStatements(database, outbox),
    completeIdempotencyStatement(database, acquired.claim, persisted, {
      resultReferences: { invitation_id: invitationId },
      now,
    }),
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM staff_binding_invitations
        WHERE id=? AND token_hash=? AND status='ISSUED' AND version=1
          AND COALESCE(team_id,'')=COALESCE(?,'')
      ) THEN 1 ELSE 0 END
    `).bind(invitationId, tokenHash, team?.team_id ?? null),
    assertIdempotencyCompletionStatement(database, acquired.claim),
  ];
  try {
    await database.batch(statements);
  } catch (error) {
    await markIdempotencyFailed(
      database,
      acquired.claim,
      'DEPENDENCY_UNAVAILABLE',
      now,
    ).catch(() => undefined);
    throw normalizeDependency(error);
  }
  return {
    invitation,
    invitation_path: `/staff/bind?invite=${encodeURIComponent(token)}`,
    replayed: false,
  };
}

export async function cancelStaffBindingInvitation(
  database: SqlDatabase,
  input: { invitationId: string; expectedVersion: number },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<CancelStaffBindingInvitationResponse> {
  const invitationId = cleanIdentifier(input.invitationId);
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
    validation();
  }
  const now = validNow(command.now ?? Date.now());
  const requestHash = await hashCanonicalJson({
    action: 'CANCEL_STAFF_BINDING_INVITATION',
    invitation_id: invitationId,
    expected_version: input.expectedVersion,
  });
  let acquired;
  try {
    acquired = await acquireIdempotency<CancelStaffBindingInvitationResponse>(
      database,
      {
        actorType: 'STAFF', actorId: command.actor.staffId,
        action: 'CANCEL_STAFF_BINDING_INVITATION',
        targetType: 'STAFF_BINDING_INVITATION', targetId: invitationId,
        idempotencyKey: command.idempotencyKey, requestHash,
      },
      { now },
    );
  } catch (error) {
    throw normalizeIdempotency(error);
  }
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }
  const row = await readInvitation(database, invitationId);
  if (!row) return failClaim(database, acquired.claim, now, 'NOT_FOUND', 404);
  if (Number(row.version) !== input.expectedVersion) {
    return failClaim(database, acquired.claim, now, 'VERSION_CONFLICT', 409);
  }
  if (row.status !== 'ISSUED' || Number(row.expires_at) <= now) {
    return failClaim(database, acquired.claim, now, 'STATE_CONFLICT', 409);
  }
  const next = projectInvitation({
    ...row,
    status: 'CANCELLED',
    version: Number(row.version) + 1,
    cancelled_at: now,
  });
  const response: CancelStaffBindingInvitationResponse = {
    invitation: next,
    replayed: false,
  };
  const outbox = await prepareOutboxEvent({
    id: crypto.randomUUID(),
    dedupKey: `staff-binding-invitation-cancelled:${invitationId}:${next.version}`,
    eventType: 'STAFF_BINDING_INVITATION_CANCELLED',
    aggregateType: 'STAFF_BINDING_INVITATION',
    aggregateId: invitationId,
    payload: { invitation_id: invitationId, version: next.version },
    createdAt: now,
  });
  try {
    await database.batch([
      database.prepare(`
        UPDATE staff_binding_invitations
        SET status='CANCELLED',cancelled_at=?,version=version+1,updated_at=?
        WHERE id=? AND status='ISSUED' AND expires_at>?
          AND version=?
      `).bind(now, now, invitationId, now, input.expectedVersion),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'STAFF_BINDING_INVITATION',
        aggregateId: invitationId,
        eventType: 'STAFF_BINDING_INVITATION_CANCELLED',
        actor: actor(command.actor),
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: { status: 'ISSUED', version: row.version },
        nextState: { status: 'CANCELLED', version: next.version },
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(database, acquired.claim, response, { now }),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM staff_binding_invitations
          WHERE id=? AND status='CANCELLED' AND version=?
        ) THEN 1 ELSE 0 END
      `).bind(invitationId, next.version),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
    return response;
  } catch (error) {
    await markIdempotencyFailed(database, acquired.claim,
      'DEPENDENCY_UNAVAILABLE', now).catch(() => undefined);
    throw normalizeDependency(error);
  }
}

async function readInvitation(
  database: SqlDatabase,
  invitationId: string,
): Promise<InvitationRow | null> {
  return database.prepare(`
    SELECT invitation.id,invitation.display_name,invitation.role_code,
      invitation.team_id,team.name AS team_name,
      department.name AS department_name,invitation.status,
      invitation.version,invitation.created_at,invitation.expires_at,
      invitation.consumed_at,invitation.cancelled_at
    FROM staff_binding_invitations invitation
    LEFT JOIN staff_teams team ON team.id=invitation.team_id
    LEFT JOIN staff_departments department ON department.id=team.department_id
    WHERE invitation.id=?
  `).bind(invitationId).first<InvitationRow>();
}

function projectInvitation(row: InvitationRow): StaffBindingInvitationDto {
  if (!isStaffRoleCode(row.role_code)) {
    throw new StaffAccessManagementError('DEPENDENCY_UNAVAILABLE', 503);
  }
  return Object.freeze({
    invitation_id: row.id,
    display_name: row.display_name,
    role: Object.freeze({
      code: row.role_code,
      display_name: STAFF_ROLE_DISPLAY_NAMES[row.role_code],
    }),
    team: row.team_id === null ? null : Object.freeze({
      team_id: row.team_id,
      team_name: row.team_name ?? '',
      department_name: row.department_name ?? '',
    }),
    status: row.status,
    version: Number(row.version),
    issued_at: Number(row.created_at),
    expires_at: Number(row.expires_at),
    consumed_at: row.consumed_at === null ? null : Number(row.consumed_at),
    cancelled_at: row.cancelled_at === null ? null : Number(row.cancelled_at),
  });
}

async function resolveInvitationTeam(
  database: SqlDatabase,
  roleCode: StaffRoleCode,
  rawTeamId: string | null,
): Promise<StaffAccessTeamOptionDto | null> {
  if (roleCode === 'owner') {
    if (rawTeamId !== null) validation();
    return null;
  }
  if (typeof rawTeamId !== 'string') validation();
  const teamId = cleanIdentifier(rawTeamId);
  const row = await database.prepare(`
    SELECT team.id AS team_id,team.name AS team_name,
      department.name AS department_name
    FROM staff_teams team
    JOIN staff_departments department ON department.id=team.department_id
    WHERE team.id=? AND team.status='ACTIVE' AND department.status='ACTIVE'
  `).bind(teamId).first<StaffAccessTeamOptionDto>();
  if (!row) validation();
  return row;
}

function actor(value: AssignmentStaffAuthorization) {
  return { type: 'STAFF', id: value.staffId, roles: [...value.roles] };
}

function cleanDisplayName(value: string): string {
  if (typeof value !== 'string') validation();
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1 || normalized.length > 100
    || /[\u0000-\u001f\u007f]/u.test(normalized)) validation();
  return normalized;
}

function cleanIdentifier(value: string): string {
  if (typeof value !== 'string') validation();
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 120
    || /[\u0000-\u001f\u007f]/u.test(normalized)) validation();
  return normalized;
}

function validNow(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) validation();
  return value;
}

function validation(): never {
  throw new StaffAccessManagementError('VALIDATION_ERROR', 400);
}

function normalizeIdempotency(error: unknown): StaffAccessManagementError {
  if (error instanceof IdempotencyError) {
    return new StaffAccessManagementError(error.code, error.status);
  }
  return new StaffAccessManagementError('DEPENDENCY_UNAVAILABLE', 503);
}

function normalizeDependency(error: unknown): StaffAccessManagementError {
  if (error instanceof StaffAccessManagementError) return error;
  return new StaffAccessManagementError('DEPENDENCY_UNAVAILABLE', 503);
}

async function failClaim(
  database: SqlDatabase,
  claim: Parameters<typeof markIdempotencyFailed>[1],
  now: number,
  code: 'NOT_FOUND' | 'VERSION_CONFLICT' | 'STATE_CONFLICT',
  status: 404 | 409,
): Promise<never> {
  await markIdempotencyFailed(database, claim, code, now).catch(() => undefined);
  throw new StaffAccessManagementError(code, status);
}
