import {
  isStaffPermissionCode,
  STAFF_ROLE_CODES,
  STAFF_ROLE_CONSOLIDATION_MAPPING_VERSION,
  STAFF_ROLE_CONSOLIDATION_PERMISSION_CATALOG_HASH,
  STAFF_ROLE_CONSOLIDATION_PERMISSION_CATALOG_VERSION,
  type SqlDatabase,
  type SqlStatement,
  type StaffPermissionCode,
  type StaffRoleCode,
} from '@ygb/contracts';
import { canonicalJson, hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  isOwnerOnlyPermission,
  leaderPermissionPack,
  roleDefaultPermissions,
} from './authorization-policy';

export type LegacyStaffRoleCode =
  | StaffRoleCode
  | 'seller_support'
  | 'after_sales'
  | 'buyer_support';

const LEGACY_ROLE_DEFAULTS: Readonly<Record<
  'seller_support' | 'after_sales' | 'buyer_support',
  readonly StaffPermissionCode[]
>> = Object.freeze({
  seller_support: [
    'TASK_VIEW_OPEN', 'TASK_CLAIM', 'SELLER_SUPPORT_VIEW',
    'SELLER_SUPPORT_NOTE', 'PRODUCT_VIEW', 'DEMAND_VIEW', 'ORDER_VIEW',
    'SELLER_SETTLEMENT_VIEW',
  ],
  after_sales: [
    'TASK_VIEW_OPEN', 'TASK_CLAIM', 'BUYER_VIEW', 'ORDER_VIEW',
    'REVIEW_VIEW', 'REVIEW_DECIDE', 'BUYER_REFUND_VIEW',
    'BUYER_REFUND_RECORD', 'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES',
    'ASSIGNMENT_ELIGIBLE_BUYER_REFUND',
  ],
  buyer_support: [
    'TASK_VIEW_OPEN', 'TASK_CLAIM', 'BUYER_SUPPORT_VIEW',
    'BUYER_SUPPORT_NOTE', 'BUYER_VIEW', 'ORDER_VIEW', 'REVIEW_VIEW',
    'BUYER_REFUND_VIEW',
  ],
});

const DIRECT_TARGETS: Readonly<Partial<Record<
  LegacyStaffRoleCode,
  StaffRoleCode
>>> = Object.freeze({
  owner: 'owner',
  pre_sales: 'pre_sales',
  seller_ops: 'seller_ops',
  after_sales: 'buyer_refund',
  buyer_support: 'pre_sales',
  seller_support: 'seller_ops',
});

interface StaffRow {
  id: string;
  authorization_version: number;
}
interface RoleRow { role_code: string }
interface OverrideRow { permission_code: string; effect: string }
interface TeamRow {
  team_id: string;
  team_status: string;
  department_status: string;
  is_leader: number;
}

export interface StaffRoleConsolidationPlan {
  staffId: string;
  mappingVersion: typeof STAFF_ROLE_CONSOLIDATION_MAPPING_VERSION;
  permissionCatalogVersion:
    typeof STAFF_ROLE_CONSOLIDATION_PERMISSION_CATALOG_VERSION;
  permissionCatalogHash:
    typeof STAFF_ROLE_CONSOLIDATION_PERMISSION_CATALOG_HASH;
  authorizationVersion: number;
  sourceRoles: readonly string[];
  targetRole: StaffRoleCode | null;
  approvalRequired: boolean;
  status: 'READY' | 'OWNER_APPROVAL_REQUIRED' | 'BLOCKED';
  blockReason:
    | 'ZERO_ACTIVE_ROLES'
    | 'UNKNOWN_ACTIVE_ROLE'
    | 'MULTI_ROLE_TARGET_REQUIRED'
    | null;
  beforePermissions: readonly StaffPermissionCode[];
  afterPermissions: readonly StaffPermissionCode[];
  addedPermissions: readonly StaffPermissionCode[];
  removedPermissions: readonly StaffPermissionCode[];
  personalDenies: readonly StaffPermissionCode[];
  scope: {
    memberTeamIds: readonly string[];
    leaderTeamIds: readonly string[];
  };
  mappingHash: string | null;
}

export async function buildStaffRoleConsolidationPlans(
  database: SqlDatabase,
  targetSelections: Readonly<Record<string, StaffRoleCode>> = {},
): Promise<readonly StaffRoleConsolidationPlan[]> {
  const staff = await database.prepare(`
    SELECT id,authorization_version
    FROM staff_users
    WHERE status='ACTIVE'
    ORDER BY id
  `).all<StaffRow>();
  const plans: StaffRoleConsolidationPlan[] = [];
  for (const row of staff.results) {
    plans.push(await buildPlan(database, row, targetSelections[row.id]));
  }
  return Object.freeze(plans);
}

export class StaffRoleConsolidationApprovalError extends Error {
  constructor(
    public readonly code:
      | 'FORBIDDEN'
      | 'PLAN_NOT_APPROVABLE'
      | 'PLAN_HASH_CHANGED'
      | 'DEPENDENCY_UNAVAILABLE',
    public readonly status: 403 | 409 | 503,
  ) {
    super(code);
    this.name = 'StaffRoleConsolidationApprovalError';
  }
}

export async function approveStaffRoleConsolidationPlan(
  database: SqlDatabase,
  input: {
    staffId: string;
    targetRole: StaffRoleCode;
    expectedMappingHash: string;
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<{ approval_audit_event_id: string; mapping_hash: string }> {
  if (input.actor.roles.size !== 1
    || !input.actor.roles.has('owner')
    || !input.actor.permissions.has('STAFF_MANAGE')
    || !input.actor.permissions.has('PERMISSION_MANAGE')) {
    throw new StaffRoleConsolidationApprovalError('FORBIDDEN', 403);
  }
  const plans = await buildStaffRoleConsolidationPlans(database, {
    [input.staffId]: input.targetRole,
  });
  const plan = plans.find((candidate) => candidate.staffId === input.staffId);
  if (!plan || plan.status !== 'OWNER_APPROVAL_REQUIRED'
    || plan.targetRole !== input.targetRole || !plan.mappingHash) {
    throw new StaffRoleConsolidationApprovalError('PLAN_NOT_APPROVABLE', 409);
  }
  if (plan.mappingHash !== input.expectedMappingHash) {
    throw new StaffRoleConsolidationApprovalError('PLAN_HASH_CHANGED', 409);
  }
  const now = input.now ?? Date.now();
  const requestHash = await hashCanonicalJson({
    action: 'APPROVE_STAFF_ROLE_CONSOLIDATION',
    staff_id: plan.staffId,
    mapping_hash: plan.mappingHash,
  });
  const acquired = await acquireIdempotency<{
    approval_audit_event_id: string;
    mapping_hash: string;
  }>(database, {
    actorType: 'STAFF',
    actorId: input.actor.staffId,
    action: 'APPROVE_STAFF_ROLE_CONSOLIDATION',
    targetType: 'STAFF_ROLE_CONSOLIDATION',
    targetId: plan.staffId,
    idempotencyKey: input.idempotencyKey,
    requestHash,
  }, { now });
  if (acquired.kind === 'REPLAY') return acquired.response;

  const approvalId = crypto.randomUUID();
  const response = {
    approval_audit_event_id: approvalId,
    mapping_hash: plan.mappingHash,
  };
  const statements: SqlStatement[] = [
    createAuditEventStatement(database, {
      id: approvalId,
      aggregateType: 'STAFF_ROLE_CONSOLIDATION',
      aggregateId: plan.staffId,
      eventType: 'STAFF_ROLE_MAPPING_APPROVED',
      actor: {
        type: 'STAFF',
        id: input.actor.staffId,
        roles: ['owner'],
      },
      requestId: input.requestId ?? null,
      idempotencyKey: acquired.claim.idempotencyKey,
      previousState: {
        authorization_version: plan.authorizationVersion,
        active_roles: plan.sourceRoles,
        effective_permissions: plan.beforePermissions,
      },
      nextState: {
        mapping_version: plan.mappingVersion,
        permission_catalog_version: plan.permissionCatalogVersion,
        permission_catalog_hash: plan.permissionCatalogHash,
        staff_id: plan.staffId,
        authorization_version: plan.authorizationVersion,
        source_roles: plan.sourceRoles,
        target_role: plan.targetRole,
        effective_permissions: plan.afterPermissions,
        added_permissions: plan.addedPermissions,
        removed_permissions: plan.removedPermissions,
        personal_denies: plan.personalDenies,
        scope: plan.scope,
        mapping_hash: plan.mappingHash,
      },
      reason: 'STAFF_ROLE_CONSOLIDATION_OWNER_APPROVAL',
      metadata: {
        mapping_version: plan.mappingVersion,
        permission_catalog_hash: plan.permissionCatalogHash,
      },
      createdAt: now,
    }),
    completeIdempotencyStatement(database, acquired.claim, response, { now }),
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM audit_events
        WHERE id=?
          AND aggregate_type='STAFF_ROLE_CONSOLIDATION'
          AND aggregate_id=?
          AND event_type='STAFF_ROLE_MAPPING_APPROVED'
          AND actor_id=?
      ) THEN 1 ELSE 0 END
    `).bind(approvalId, plan.staffId, input.actor.staffId),
    assertIdempotencyCompletionStatement(database, acquired.claim),
  ];
  try {
    await database.batch(statements);
    return response;
  } catch (error) {
    await markIdempotencyFailed(
      database,
      acquired.claim,
      'DEPENDENCY_UNAVAILABLE',
      now,
    );
    throw new StaffRoleConsolidationApprovalError(
      'DEPENDENCY_UNAVAILABLE',
      503,
    );
  }
}

async function buildPlan(
  database: SqlDatabase,
  staff: StaffRow,
  selectedTarget: StaffRoleCode | undefined,
): Promise<StaffRoleConsolidationPlan> {
  const [roleResult, overrideResult, teamResult] = await Promise.all([
    database.prepare(`
      SELECT role_code FROM staff_role_assignments
      WHERE staff_id=? AND status='ACTIVE'
      ORDER BY role_code
    `).bind(staff.id).all<RoleRow>(),
    database.prepare(`
      SELECT permission_code,effect FROM staff_permission_overrides
      WHERE staff_id=? AND status='ACTIVE'
      ORDER BY permission_code
    `).bind(staff.id).all<OverrideRow>(),
    database.prepare(`
      SELECT membership.team_id,team.status AS team_status,
        department.status AS department_status,
        CASE WHEN leader.staff_id IS NULL THEN 0 ELSE 1 END AS is_leader
      FROM staff_team_memberships membership
      JOIN staff_teams team ON team.id=membership.team_id
      JOIN staff_departments department ON department.id=team.department_id
      LEFT JOIN staff_team_leaders leader
        ON leader.staff_id=membership.staff_id
        AND leader.team_id=membership.team_id AND leader.status='ACTIVE'
      WHERE membership.staff_id=? AND membership.status='ACTIVE'
      ORDER BY membership.team_id
    `).bind(staff.id).all<TeamRow>(),
  ]);
  const sourceRoles = roleResult.results.map((row) => row.role_code);
  const knownRoles = sourceRoles.every(isLegacyRoleCode);
  const targetRole = !knownRoles || sourceRoles.length === 0
    ? null
    : sourceRoles.length === 1
      ? DIRECT_TARGETS[sourceRoles[0] as LegacyStaffRoleCode] ?? null
      : isCanonicalRole(selectedTarget) ? selectedTarget : null;
  const approvalRequired = sourceRoles.length > 1
    || sourceRoles[0] === 'buyer_support'
    || sourceRoles[0] === 'seller_support';
  const blockReason = sourceRoles.length === 0
    ? 'ZERO_ACTIVE_ROLES' as const
    : !knownRoles
      ? 'UNKNOWN_ACTIVE_ROLE' as const
      : targetRole === null
        ? 'MULTI_ROLE_TARGET_REQUIRED' as const
        : null;
  const grants = new Set<StaffPermissionCode>();
  const denies = new Set<StaffPermissionCode>();
  for (const row of overrideResult.results) {
    if (!isStaffPermissionCode(row.permission_code)
      || (row.effect !== 'GRANT' && row.effect !== 'DENY')) {
      throw new Error('invalid_staff_permission_dependency');
    }
    (row.effect === 'GRANT' ? grants : denies).add(row.permission_code);
  }
  const activeTeams = teamResult.results.filter((row) =>
    row.team_status === 'ACTIVE' && row.department_status === 'ACTIVE');
  const memberTeamIds = activeTeams.map((row) => row.team_id);
  const leaderTeamIds = activeTeams.filter((row) => Number(row.is_leader) === 1)
    .map((row) => row.team_id);
  const before = knownRoles
    ? layeredPermissions(
        sourceRoles as LegacyStaffRoleCode[],
        grants,
        denies,
        leaderTeamIds,
      )
    : [];
  const after = targetRole
    ? layeredPermissions([targetRole], grants, denies, leaderTeamIds)
    : [];
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const base = {
    staffId: staff.id,
    mappingVersion: STAFF_ROLE_CONSOLIDATION_MAPPING_VERSION,
    permissionCatalogVersion:
      STAFF_ROLE_CONSOLIDATION_PERMISSION_CATALOG_VERSION,
    permissionCatalogHash: STAFF_ROLE_CONSOLIDATION_PERMISSION_CATALOG_HASH,
    authorizationVersion: Number(staff.authorization_version),
    sourceRoles: Object.freeze(sourceRoles),
    targetRole,
    approvalRequired,
    status: blockReason
      ? 'BLOCKED' as const
      : approvalRequired
        ? 'OWNER_APPROVAL_REQUIRED' as const
        : 'READY' as const,
    blockReason,
    beforePermissions: Object.freeze(before),
    afterPermissions: Object.freeze(after),
    addedPermissions: Object.freeze(after.filter((value) => !beforeSet.has(value))),
    removedPermissions: Object.freeze(before.filter((value) => !afterSet.has(value))),
    personalDenies: Object.freeze([...denies].sort()),
    scope: Object.freeze({
      memberTeamIds: Object.freeze([...memberTeamIds].sort()),
      leaderTeamIds: Object.freeze([...leaderTeamIds].sort()),
    }),
  };
  const mappingHash = blockReason ? null : await hashCanonicalJson(base);
  return Object.freeze({ ...base, mappingHash });
}

function layeredPermissions(
  roles: readonly LegacyStaffRoleCode[],
  grants: ReadonlySet<StaffPermissionCode>,
  denies: ReadonlySet<StaffPermissionCode>,
  leaderTeamIds: readonly string[],
): StaffPermissionCode[] {
  const permissions = new Set<StaffPermissionCode>();
  for (const role of roles) {
    const defaults = isCanonicalRole(role)
      ? roleDefaultPermissions(role)
      : LEGACY_ROLE_DEFAULTS[role];
    for (const permission of defaults) permissions.add(permission);
  }
  for (const permission of grants) permissions.add(permission);
  if (leaderTeamIds.length > 0) {
    for (const permission of leaderPermissionPack()) permissions.add(permission);
  }
  if (!roles.includes('owner')) {
    for (const permission of [...permissions]) {
      if (isOwnerOnlyPermission(permission)) permissions.delete(permission);
    }
  }
  for (const permission of denies) permissions.delete(permission);
  return [...permissions].sort();
}

function isCanonicalRole(value: unknown): value is StaffRoleCode {
  return typeof value === 'string'
    && (STAFF_ROLE_CODES as readonly string[]).includes(value);
}

function isLegacyRoleCode(value: unknown): value is LegacyStaffRoleCode {
  return isCanonicalRole(value)
    || value === 'seller_support'
    || value === 'after_sales'
    || value === 'buyer_support';
}

export function serializeStaffRoleConsolidationPlan(
  plan: StaffRoleConsolidationPlan,
): string {
  return canonicalJson(plan);
}
