import {
  STAFF_ROLE_DISPLAY_NAMES,
  isStaffRoleCode,
  type SqlDatabase,
  type SqlStatement,
  type StaffAccessEmployeeDto,
  type StaffAccessMutationResponse,
  type StaffAccessStatus,
  type StaffRoleCode,
} from '@ygb/contracts';
import { canonicalJson, hashCanonicalJson } from '@ygb/domain';
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
import { StaffAccessManagementError } from './errors';

interface TargetRow {
  staff_id: string;
  display_name: string;
  status: 'ACTIVE' | 'DISABLED';
  authorization_version: number;
  session_version: number;
  version: number;
  updated_at: number;
  role_code: string | null;
  active_role_count: number;
  active_identity_count: number;
  identity_count: number;
  verified_at: number | null;
  active_team_count: number;
}

type MutationKind =
  | { kind: 'STATUS'; status: StaffAccessStatus }
  | { kind: 'ROLE'; roleCode: StaffRoleCode };

export async function changeStaffAccessStatus(
  database: SqlDatabase,
  input: {
    staffId: string;
    status: StaffAccessStatus;
    expectedVersion: number;
  },
  command: Command,
): Promise<StaffAccessMutationResponse> {
  if (input.status !== 'ACTIVE' && input.status !== 'DISABLED') validation();
  return mutate(database, input.staffId, input.expectedVersion, {
    kind: 'STATUS', status: input.status,
  }, command);
}

export async function changeStaffRole(
  database: SqlDatabase,
  input: {
    staffId: string;
    roleCode: StaffRoleCode;
    expectedVersion: number;
  },
  command: Command,
): Promise<StaffAccessMutationResponse> {
  if (!isStaffRoleCode(input.roleCode)) validation();
  return mutate(database, input.staffId, input.expectedVersion, {
    kind: 'ROLE', roleCode: input.roleCode,
  }, command);
}

interface Command {
  actor: AssignmentStaffAuthorization;
  idempotencyKey: string;
  requestId?: string | null;
  now?: number;
}

async function mutate(
  database: SqlDatabase,
  rawStaffId: string,
  expectedVersion: number,
  mutation: MutationKind,
  command: Command,
): Promise<StaffAccessMutationResponse> {
  const staffId = cleanIdentifier(rawStaffId);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) validation();
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) validation();
  const action = mutation.kind === 'STATUS'
    ? 'CHANGE_STAFF_ACCESS_STATUS'
    : 'CHANGE_STAFF_ROLE';
  const requestHash = await hashCanonicalJson({
    action,
    staff_id: staffId,
    expected_version: expectedVersion,
    ...(mutation.kind === 'STATUS'
      ? { status: mutation.status }
      : { role_code: mutation.roleCode }),
  });
  let acquired;
  try {
    acquired = await acquireIdempotency<StaffAccessMutationResponse>(database, {
      actorType: 'STAFF', actorId: command.actor.staffId, action,
      targetType: 'STAFF_USER', targetId: staffId,
      idempotencyKey: command.idempotencyKey, requestHash,
    }, { now });
  } catch (error) {
    throw normalizeIdempotency(error);
  }
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  const target = await readTarget(database, staffId);
  if (!target) return fail(database, acquired.claim, now, 'NOT_FOUND', 404);
  if (Number(target.version) !== expectedVersion) {
    return fail(database, acquired.claim, now, 'VERSION_CONFLICT', 409);
  }
  if (Number(target.active_role_count) !== 1
    || !isStaffRoleCode(target.role_code)
    || Number(target.active_identity_count) > 1) {
    return fail(database, acquired.claim, now,
      'DEPENDENCY_UNAVAILABLE', 503);
  }
  if (target.staff_id === command.actor.staffId) {
    return fail(database, acquired.claim, now, 'STATE_CONFLICT', 409);
  }
  if (mutation.kind === 'STATUS') {
    if (target.status === mutation.status) {
      return fail(database, acquired.claim, now, 'STATE_CONFLICT', 409);
    }
    if (mutation.status === 'ACTIVE'
      && Number(target.active_identity_count) !== 1) {
      return fail(database, acquired.claim, now, 'STATE_CONFLICT', 409);
    }
    if (mutation.status === 'ACTIVE' && target.role_code !== 'owner'
      && Number(target.active_team_count) < 1) {
      return fail(database, acquired.claim, now, 'STATE_CONFLICT', 409);
    }
  } else if (target.role_code === mutation.roleCode) {
    return fail(database, acquired.claim, now, 'STATE_CONFLICT', 409);
  }
  if (mutation.kind === 'ROLE' && mutation.roleCode !== 'owner'
    && Number(target.active_team_count) < 1) {
    return fail(database, acquired.claim, now, 'STATE_CONFLICT', 409);
  }

  const removesActiveOwner = target.status === 'ACTIVE'
    && target.role_code === 'owner'
    && (mutation.kind === 'STATUS'
      ? mutation.status === 'DISABLED'
      : mutation.roleCode !== 'owner');
  if (removesActiveOwner && await activeOwnerCount(database) <= 1) {
    return fail(database, acquired.claim, now, 'STATE_CONFLICT', 409);
  }

  const nextVersion = Number(target.version) + 1;
  const nextAuthorizationVersion = Number(target.authorization_version) + 1;
  const nextSessionVersion = Number(target.session_version) + 1;
  const nextStatus = mutation.kind === 'STATUS' ? mutation.status : target.status;
  const nextRole = mutation.kind === 'ROLE' ? mutation.roleCode : target.role_code;
  const employee = projectEmployee(target, {
    status: nextStatus,
    roleCode: nextRole,
    version: nextVersion,
    updatedAt: now,
  });
  const response: StaffAccessMutationResponse = { employee, replayed: false };
  const eventType = mutation.kind === 'STATUS'
    ? 'STAFF_ACCESS_STATUS_CHANGED'
    : 'STAFF_ROLE_CHANGED';
  const outbox = await prepareOutboxEvent({
    id: crypto.randomUUID(),
    dedupKey: `${eventType.toLowerCase()}:${staffId}:${nextVersion}`,
    eventType,
    aggregateType: 'STAFF',
    aggregateId: staffId,
    payload: {
      staff_id: staffId,
      status: nextStatus,
      role_code: nextRole,
      authorization_version: nextAuthorizationVersion,
      version: nextVersion,
    },
    createdAt: now,
  });
  const statements: SqlStatement[] = [
    database.prepare(`
      UPDATE staff_users
      SET status=?,disabled_at=?,authorization_version=authorization_version+1,
        session_version=session_version+1,version=version+1,updated_at=?
      WHERE id=? AND version=? AND status=?
        AND authorization_version=? AND session_version=?
    `).bind(
      nextStatus,
      nextStatus === 'DISABLED' ? now : null,
      now,
      staffId,
      expectedVersion,
      target.status,
      target.authorization_version,
      target.session_version,
    ),
  ];
  if (mutation.kind === 'ROLE') {
    statements.push(
      database.prepare(`
        UPDATE staff_role_assignments
        SET status='REVOKED',revoked_at=?,revoked_by_staff_id=?,
          revoked_reason='STAFF_ACCESS_MANAGEMENT_ROLE_CHANGE',updated_at=?
        WHERE staff_id=? AND role_code=? AND status='ACTIVE'
      `).bind(now, command.actor.staffId, now, staffId, target.role_code),
    );
    statements.push(database.prepare(`
      INSERT INTO staff_role_assignments (
        id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,
        revoked_at,revoked_by_staff_id,revoked_reason,created_at,updated_at
      ) VALUES (?, ?, ?, 'ACTIVE', ?, ?, NULL, NULL, NULL, ?, ?)
    `).bind(
      crypto.randomUUID(), staffId, mutation.roleCode,
      command.actor.staffId, now, now, now,
    ));
  }
  statements.push(
    database.prepare(`
      UPDATE staff_sessions
      SET status='REVOKED',revoked_at=?,
        revoked_reason='STAFF_ACCESS_CHANGED',updated_at=?
      WHERE staff_id=? AND status='ACTIVE'
    `).bind(now, now, staffId),
    database.prepare(`
      INSERT INTO staff_authorization_events (
        id,staff_id,authorization_version,event_type,actor_staff_id,
        request_id,idempotency_key,change_summary_json,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?)
    `).bind(
      crypto.randomUUID(), staffId, nextAuthorizationVersion, eventType,
      command.actor.staffId, command.requestId ?? null,
      acquired.claim.idempotencyKey,
      canonicalJson({
        previous: { status: target.status, role_code: target.role_code },
        next: { status: nextStatus, role_code: nextRole },
      }),
      now,
    ),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'STAFF',
      aggregateId: staffId,
      eventType,
      actor: {
        type: 'STAFF', id: command.actor.staffId,
        roles: [...command.actor.roles],
      },
      requestId: command.requestId ?? null,
      idempotencyKey: acquired.claim.idempotencyKey,
      previousState: {
        status: target.status,
        role_code: target.role_code,
        version: target.version,
        authorization_version: target.authorization_version,
        session_version: target.session_version,
      },
      nextState: {
        status: nextStatus,
        role_code: nextRole,
        version: nextVersion,
        authorization_version: nextAuthorizationVersion,
        session_version: nextSessionVersion,
      },
      createdAt: now,
    }),
    ...createOutboxStatements(database, outbox),
    completeIdempotencyStatement(database, acquired.claim, response, {
      resultReferences: { staff_id: staffId }, now,
    }),
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN
        EXISTS (SELECT 1 FROM staff_users
          WHERE id=? AND status=? AND version=?
            AND authorization_version=? AND session_version=?)
        AND (SELECT COUNT(*) FROM staff_role_assignments
          WHERE staff_id=? AND status='ACTIVE')=1
        AND EXISTS (SELECT 1 FROM staff_role_assignments
          WHERE staff_id=? AND role_code=? AND status='ACTIVE')
        AND NOT EXISTS (SELECT 1 FROM staff_sessions
          WHERE staff_id=? AND status='ACTIVE')
        AND (SELECT COUNT(*)
          FROM staff_users owner_staff
          JOIN staff_role_assignments owner_role
            ON owner_role.staff_id=owner_staff.id
            AND owner_role.status='ACTIVE'
            AND owner_role.role_code='owner'
          WHERE owner_staff.status='ACTIVE')>=1
      THEN 1 ELSE 0 END
    `).bind(
      staffId, nextStatus, nextVersion, nextAuthorizationVersion,
      nextSessionVersion, staffId, staffId, nextRole, staffId,
    ),
    assertIdempotencyCompletionStatement(database, acquired.claim),
  );
  try {
    await database.batch(statements);
    return response;
  } catch {
    await markIdempotencyFailed(database, acquired.claim,
      'DEPENDENCY_UNAVAILABLE', now).catch(() => undefined);
    throw new StaffAccessManagementError('DEPENDENCY_UNAVAILABLE', 503);
  }
}

async function readTarget(
  database: SqlDatabase,
  staffId: string,
): Promise<TargetRow | null> {
  return database.prepare(`
    SELECT staff.id AS staff_id,staff.display_name,staff.status,
      staff.authorization_version,staff.session_version,staff.version,
      staff.updated_at,
      (SELECT role.role_code FROM staff_role_assignments role
        WHERE role.staff_id=staff.id AND role.status='ACTIVE'
        ORDER BY role.role_code LIMIT 1) AS role_code,
      (SELECT COUNT(*) FROM staff_role_assignments role
        WHERE role.staff_id=staff.id AND role.status='ACTIVE')
        AS active_role_count,
      (SELECT COUNT(*) FROM feishu_staff_identities identity
        WHERE identity.staff_id=staff.id AND identity.status='ACTIVE')
        AS active_identity_count,
      (SELECT COUNT(*) FROM feishu_staff_identities identity
        WHERE identity.staff_id=staff.id) AS identity_count,
      (SELECT MAX(identity.verified_at) FROM feishu_staff_identities identity
        WHERE identity.staff_id=staff.id AND identity.status='ACTIVE')
        AS verified_at,
      (SELECT COUNT(*) FROM staff_team_memberships membership
        JOIN staff_teams team ON team.id=membership.team_id
          AND team.status='ACTIVE'
        JOIN staff_departments department ON department.id=team.department_id
          AND department.status='ACTIVE'
        WHERE membership.staff_id=staff.id AND membership.status='ACTIVE')
        AS active_team_count
    FROM staff_users staff WHERE staff.id=?
  `).bind(staffId).first<TargetRow>();
}

async function activeOwnerCount(database: SqlDatabase): Promise<number> {
  const row = await database.prepare(`
    SELECT COUNT(*) AS total
    FROM staff_users staff
    JOIN staff_role_assignments role ON role.staff_id=staff.id
      AND role.status='ACTIVE' AND role.role_code='owner'
    WHERE staff.status='ACTIVE'
  `).first<{ total: number }>();
  return Number(row?.total ?? 0);
}

function projectEmployee(
  row: TargetRow,
  next: {
    status: StaffAccessStatus;
    roleCode: StaffRoleCode;
    version: number;
    updatedAt: number;
  },
): StaffAccessEmployeeDto {
  const bindingStatus = Number(row.active_identity_count) === 1
    ? 'ACTIVE' as const
    : Number(row.identity_count) > 0 ? 'REVOKED' as const : 'MISSING' as const;
  return Object.freeze({
    staff_id: row.staff_id,
    display_name: row.display_name,
    status: next.status,
    version: next.version,
    role: Object.freeze({
      code: next.roleCode,
      display_name: STAFF_ROLE_DISPLAY_NAMES[next.roleCode],
    }),
    feishu_binding: Object.freeze({
      status: bindingStatus,
      verified_at: bindingStatus === 'ACTIVE'
        ? Number(row.verified_at)
        : null,
    }),
    updated_at: next.updatedAt,
  });
}

function cleanIdentifier(value: string): string {
  if (typeof value !== 'string') validation();
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 120
    || /[\u0000-\u001f\u007f]/u.test(normalized)) validation();
  return normalized;
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

async function fail(
  database: SqlDatabase,
  claim: Parameters<typeof markIdempotencyFailed>[1],
  now: number,
  code: 'NOT_FOUND' | 'VERSION_CONFLICT' | 'STATE_CONFLICT'
    | 'DEPENDENCY_UNAVAILABLE',
  status: 404 | 409 | 503,
): Promise<never> {
  await markIdempotencyFailed(database, claim, code, now).catch(() => undefined);
  throw new StaffAccessManagementError(code, status);
}
