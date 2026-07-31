import {
  isStaffPermissionCode,
  isStaffRoleCode,
  type SqlDatabase,
  type SqlStatement,
  type StaffPermissionCode,
  type StaffRoleCode,
} from '@ygb/contracts';
import {
  canonicalJson,
  hashCanonicalJson,
} from '@ygb/domain';
import {
  createAuditEventStatement,
} from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
  type IdempotencyClaim,
} from '../foundation/idempotency';
import {
  createOutboxStatements,
  prepareOutboxEvent,
} from '../foundation/outbox';

export class ProvisionStaffError extends Error {
  constructor(
    public readonly code:
      | 'VALIDATION_ERROR'
      | 'FORBIDDEN'
      | 'IDENTITY_CONFLICT'
      | 'TEAM_NOT_FOUND'
      | 'DEPENDENCY_UNAVAILABLE',
    public readonly status: 400 | 403 | 409 | 503,
  ) {
    super(code);
    this.name = 'ProvisionStaffError';
  }
}

export interface ProvisionStaffInput {
  displayName: string;
  feishu: {
    tenantKey: string;
    openId: string;
    userId: string | null;
  };
  roles: readonly StaffRoleCode[];
  teamIds: readonly string[];
  leaderTeamIds: readonly string[];
  permissionOverrides: readonly {
    permission: StaffPermissionCode;
    effect: 'GRANT' | 'DENY';
    reason: string | null;
  }[];
}

export interface ProvisionStaffActor {
  staffId: string;
  displayName: string;
  roles: readonly StaffRoleCode[];
}

export interface ProvisionStaffResult {
  staff_id: string;
  identity_id: string;
  authorization_version: number;
  replayed: boolean;
}

export async function provisionStaff(
  database: SqlDatabase,
  input: ProvisionStaffInput,
  command: {
    actor: ProvisionStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<ProvisionStaffResult> {
  if (!command.actor.roles.includes('owner')) {
    throw new ProvisionStaffError('FORBIDDEN', 403);
  }

  const normalized = normalizeInput(input);
  const now = command.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new ProvisionStaffError('VALIDATION_ERROR', 400);
  }

  const requestHash = await hashCanonicalJson({
    action: 'PROVISION_STAFF',
    input: normalized,
  });
  const identityTargetHash = await hashCanonicalJson({
    tenant_key: normalized.feishu.tenantKey,
    open_id: normalized.feishu.openId,
  });

  const acquired = await acquireIdempotency<ProvisionStaffResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'PROVISION_STAFF',
      targetType: 'FEISHU_IDENTITY',
      targetId: `feishu:${identityTargetHash}`,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );

  if (acquired.kind === 'REPLAY') {
    return {
      ...acquired.response,
      replayed: true,
    };
  }

  try {
    await assertIdentityAvailable(database, normalized);
    await assertTeamsAvailable(database, normalized);

    const staffId = crypto.randomUUID();
    const identityId = crypto.randomUUID();
    const authorizationVersion = 1;
    const response: ProvisionStaffResult = {
      staff_id: staffId,
      identity_id: identityId,
      authorization_version: authorizationVersion,
      replayed: false,
    };

    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `staff-provisioned:${staffId}`,
      eventType: 'STAFF_PROVISIONED',
      aggregateType: 'STAFF',
      aggregateId: staffId,
      payload: {
        staff_id: staffId,
        display_name: normalized.displayName,
        authorization_version: authorizationVersion,
      },
      createdAt: now,
    });

    const statements: SqlStatement[] = [
      database.prepare(`
        INSERT INTO staff_users (
          id, display_name, status, authorization_version,
          version, created_at, updated_at, disabled_at
        ) VALUES (?, ?, 'ACTIVE', ?, 1, ?, ?, NULL)
      `).bind(
        staffId,
        normalized.displayName,
        authorizationVersion,
        now,
        now,
      ),
      database.prepare(`
        INSERT INTO feishu_staff_identities (
          id, staff_id, tenant_key, open_id, user_id,
          status, verified_at, created_at, updated_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, NULL)
      `).bind(
        identityId,
        staffId,
        normalized.feishu.tenantKey,
        normalized.feishu.openId,
        normalized.feishu.userId,
        now,
        now,
        now,
      ),
      ...normalized.roles.map((role) => database.prepare(`
        INSERT INTO staff_role_assignments (
          staff_id, role_code, status, assigned_by_staff_id,
          assigned_at, revoked_at, created_at, updated_at
        ) VALUES (?, ?, 'ACTIVE', ?, ?, NULL, ?, ?)
      `).bind(
        staffId,
        role,
        command.actor.staffId,
        now,
        now,
        now,
      )),
      ...normalized.teamIds.map((teamId) => database.prepare(`
        INSERT INTO staff_team_memberships (
          staff_id, team_id, status, joined_at, ended_at,
          created_at, updated_at
        ) VALUES (?, ?, 'ACTIVE', ?, NULL, ?, ?)
      `).bind(
        staffId,
        teamId,
        now,
        now,
        now,
      )),
      ...normalized.leaderTeamIds.map((teamId) => database.prepare(`
        INSERT INTO staff_team_leaders (
          staff_id, team_id, status, assigned_by_staff_id,
          assigned_at, revoked_at, created_at, updated_at
        ) VALUES (?, ?, 'ACTIVE', ?, ?, NULL, ?, ?)
      `).bind(
        staffId,
        teamId,
        command.actor.staffId,
        now,
        now,
        now,
      )),
      ...normalized.permissionOverrides.map((override) =>
        database.prepare(`
          INSERT INTO staff_permission_overrides (
            staff_id, permission_code, effect, status, reason,
            assigned_by_staff_id, assigned_at, revoked_at,
            created_at, updated_at
          ) VALUES (
            ?, ?, ?, 'ACTIVE', ?, ?, ?, NULL, ?, ?
          )
        `).bind(
          staffId,
          override.permission,
          override.effect,
          override.reason,
          command.actor.staffId,
          now,
          now,
          now,
        )),
      database.prepare(`
        INSERT INTO staff_authorization_events (
          id, staff_id, authorization_version, event_type,
          actor_staff_id, request_id, idempotency_key,
          change_summary_json, created_at
        ) VALUES (?, ?, ?, 'STAFF_PROVISIONED', ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        staffId,
        authorizationVersion,
        command.actor.staffId,
        command.requestId ?? null,
        acquired.claim.idempotencyKey,
        canonicalJson({
          roles: normalized.roles,
          team_ids: normalized.teamIds,
          leader_team_ids: normalized.leaderTeamIds,
          permission_overrides: normalized.permissionOverrides,
          feishu_identity: {
            tenant_key: normalized.feishu.tenantKey,
            open_id: normalized.feishu.openId,
            user_id: normalized.feishu.userId,
          },
        }),
        now,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'STAFF',
        aggregateId: staffId,
        eventType: 'STAFF_PROVISIONED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: null,
        nextState: {
          staff_id: staffId,
          display_name: normalized.displayName,
          authorization_version: authorizationVersion,
          roles: normalized.roles,
          team_ids: normalized.teamIds,
          leader_team_ids: normalized.leaderTeamIds,
        },
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        {
          resultReferences: {
            staff_id: staffId,
            identity_id: identityId,
          },
          now,
        },
      ),
      assertProvisionedStatement(
        database,
        acquired.claim,
        staffId,
        identityId,
        normalized,
      ),
      assertIdempotencyCompletionStatement(
        database,
        acquired.claim,
      ),
    ];

    await database.batch(statements);
    return response;
  } catch (error) {
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalizeFailureCode(error),
      now,
    );
    throw normalizeError(error);
  }
}

function assertProvisionedStatement(
  database: SqlDatabase,
  claim: IdempotencyClaim,
  staffId: string,
  identityId: string,
  input: NormalizedProvisionStaffInput,
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM staff_users
        WHERE id=?
          AND status='ACTIVE'
          AND authorization_version=1
      )
      AND EXISTS (
        SELECT 1
        FROM feishu_staff_identities
        WHERE id=?
          AND staff_id=?
          AND status='ACTIVE'
      )
      AND (
        SELECT COUNT(*)
        FROM staff_role_assignments
        WHERE staff_id=?
          AND status='ACTIVE'
      )=?
      AND (
        SELECT COUNT(*)
        FROM staff_team_memberships
        WHERE staff_id=?
          AND status='ACTIVE'
      )=?
      AND (
        SELECT COUNT(*)
        FROM staff_team_leaders
        WHERE staff_id=?
          AND status='ACTIVE'
      )=?
      AND (
        SELECT COUNT(*)
        FROM staff_permission_overrides
        WHERE staff_id=?
          AND status='ACTIVE'
      )=?
      AND EXISTS (
        SELECT 1
        FROM command_idempotency_records
        WHERE actor_type=?
          AND actor_id=?
          AND idempotency_key=?
          AND status='COMMITTED'
          AND lease_token=?
      )
    THEN 1 ELSE 0 END
  `).bind(
    staffId,
    identityId,
    staffId,
    staffId,
    input.roles.length,
    staffId,
    input.teamIds.length,
    staffId,
    input.leaderTeamIds.length,
    staffId,
    input.permissionOverrides.length,
    claim.actorType,
    claim.actorId,
    claim.idempotencyKey,
    claim.leaseToken,
  );
}

interface NormalizedProvisionStaffInput {
  displayName: string;
  feishu: {
    tenantKey: string;
    openId: string;
    userId: string | null;
  };
  roles: StaffRoleCode[];
  teamIds: string[];
  leaderTeamIds: string[];
  permissionOverrides: {
    permission: StaffPermissionCode;
    effect: 'GRANT' | 'DENY';
    reason: string | null;
  }[];
}

function normalizeInput(
  input: ProvisionStaffInput,
): NormalizedProvisionStaffInput {
  const displayName = clean(input.displayName, 100);
  const tenantKey = clean(input.feishu.tenantKey, 200);
  const openId = clean(input.feishu.openId, 200);
  const userId = input.feishu.userId === null
    ? null
    : clean(input.feishu.userId, 200);

  if (!Array.isArray(input.roles)
    || input.roles.some((role) => !isStaffRoleCode(role))) {
    throw new ProvisionStaffError('VALIDATION_ERROR', 400);
  }
  const roles = uniqueSorted(input.roles);

  const teamIds = uniqueSorted(input.teamIds.map(
    (teamId) => clean(teamId, 120),
  ));
  const leaderTeamIds = uniqueSorted(input.leaderTeamIds.map(
    (teamId) => clean(teamId, 120),
  ));
  const membershipSet = new Set(teamIds);
  if (leaderTeamIds.some((teamId) => !membershipSet.has(teamId))) {
    throw new ProvisionStaffError('VALIDATION_ERROR', 400);
  }

  if (roles.length < 1) {
    throw new ProvisionStaffError('VALIDATION_ERROR', 400);
  }

  const overrideByPermission = new Map<
    StaffPermissionCode,
    {
      permission: StaffPermissionCode;
      effect: 'GRANT' | 'DENY';
      reason: string | null;
    }
  >();
  for (const override of input.permissionOverrides) {
    if (!isStaffPermissionCode(override.permission)
      || (override.effect !== 'GRANT' && override.effect !== 'DENY')
      || overrideByPermission.has(override.permission)) {
      throw new ProvisionStaffError('VALIDATION_ERROR', 400);
    }
    overrideByPermission.set(override.permission, {
      permission: override.permission,
      effect: override.effect,
      reason: override.reason === null
        ? null
        : clean(override.reason, 1000),
    });
  }

  return {
    displayName,
    feishu: {
      tenantKey,
      openId,
      userId,
    },
    roles,
    teamIds,
    leaderTeamIds,
    permissionOverrides: [...overrideByPermission.values()]
      .sort((left, right) =>
        left.permission.localeCompare(right.permission, 'en-US')),
  };
}

async function assertIdentityAvailable(
  database: SqlDatabase,
  input: NormalizedProvisionStaffInput,
): Promise<void> {
  const row = await database.prepare(`
    SELECT id
    FROM feishu_staff_identities
    WHERE tenant_key=?
      AND (
        open_id=?
        OR (? IS NOT NULL AND user_id=?)
      )
    LIMIT 1
  `).bind(
    input.feishu.tenantKey,
    input.feishu.openId,
    input.feishu.userId,
    input.feishu.userId,
  ).first<{ id: string }>();

  if (row) {
    throw new ProvisionStaffError('IDENTITY_CONFLICT', 409);
  }
}

async function assertTeamsAvailable(
  database: SqlDatabase,
  input: NormalizedProvisionStaffInput,
): Promise<void> {
  if (input.teamIds.length === 0) return;
  const placeholders = input.teamIds.map(() => '?').join(',');
  const row = await database.prepare(`
    SELECT COUNT(*) AS total
    FROM staff_teams team
    JOIN staff_departments department
      ON department.id=team.department_id
    WHERE team.id IN (${placeholders})
      AND team.status='ACTIVE'
      AND department.status='ACTIVE'
  `).bind(...input.teamIds).first<{ total: number }>();

  if (Number(row?.total ?? 0) !== input.teamIds.length) {
    throw new ProvisionStaffError('TEAM_NOT_FOUND', 409);
  }
}

function normalizeError(error: unknown): ProvisionStaffError {
  if (error instanceof ProvisionStaffError) return error;

  const message = String(error);
  if (message.includes('feishu_staff_identities.tenant_key')
    || message.includes('uq_feishu_staff_identity_tenant_user')) {
    return new ProvisionStaffError('IDENTITY_CONFLICT', 409);
  }
  if (message.includes('FOREIGN KEY constraint failed')) {
    return new ProvisionStaffError('TEAM_NOT_FOUND', 409);
  }
  return new ProvisionStaffError('DEPENDENCY_UNAVAILABLE', 503);
}

function normalizeFailureCode(error: unknown): string {
  return normalizeError(error).code;
}

function clean(value: string, maximum: number): string {
  if (typeof value !== 'string') {
    throw new ProvisionStaffError('VALIDATION_ERROR', 400);
  }
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new ProvisionStaffError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(
    (left, right) => left.localeCompare(right, 'en-US'),
  );
}
