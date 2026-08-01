import {
  STAFF_PERMISSION_CODES,
  type StaffPermissionCode,
  type StaffRoleCode,
} from '@ygb/contracts';

const ALL_PERMISSIONS = new Set<StaffPermissionCode>(
  STAFF_PERMISSION_CODES,
);

const LEADER_PERMISSION_PACK = Object.freeze([
  'TASK_VIEW_TEAM',
  'TASK_ASSIGN_TEAM',
  'TASK_REASSIGN_TEAM',
  'TASK_TAKEOVER_TEAM',
  'TASK_COLLABORATE_TEAM',
] as const satisfies readonly StaffPermissionCode[]);

const OWNER_ONLY_PERMISSIONS = new Set<StaffPermissionCode>([
  'BUYER_IDENTITY_HIGH_RISK_MANAGE',
  'FINANCIAL_CORRECT',
  'FINANCIAL_EXPORT',
  'STAFF_MANAGE',
  'PERMISSION_MANAGE',
  'AUDIT_VIEW',
]);

const ROLE_DEFAULT_PERMISSIONS: Readonly<
  Record<StaffRoleCode, readonly StaffPermissionCode[]>
> = Object.freeze({
  owner: STAFF_PERMISSION_CODES,
  pre_sales: [
    'TASK_VIEW_OPEN',
    'TASK_CLAIM',
    'BUYER_VIEW',
    'BUYER_CREATE',
    'BUYER_ACTIVATE_STANDARD',
    'PRODUCT_VIEW',
    'DEMAND_VIEW',
    'RESERVATION_VIEW',
    'RESERVATION_DECIDE',
    'ORDER_VIEW',
    'ORDER_CONFIRM',
    'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES',
  ],
  seller_ops: [
    'TASK_VIEW_OPEN',
    'TASK_CLAIM',
    'SELLER_VIEW',
    'SELLER_MANAGE',
    'PRODUCT_VIEW',
    'PRODUCT_REVIEW',
    'DEMAND_VIEW',
    'DEMAND_PUBLISH',
    'ORDER_VIEW',
    'SELLER_SETTLEMENT_VIEW',
    'SELLER_SETTLEMENT_RECORD',
    'ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT',
  ],
  seller_support: [
    'TASK_VIEW_OPEN',
    'TASK_CLAIM',
    'SELLER_SUPPORT_VIEW',
    'SELLER_SUPPORT_NOTE',
    'PRODUCT_VIEW',
    'DEMAND_VIEW',
    'ORDER_VIEW',
    'SELLER_SETTLEMENT_VIEW',
  ],
  after_sales: [
    'TASK_VIEW_OPEN',
    'TASK_CLAIM',
    'BUYER_VIEW',
    'ORDER_VIEW',
    'REVIEW_VIEW',
    'REVIEW_DECIDE',
    'BUYER_REFUND_VIEW',
    'BUYER_REFUND_RECORD',
    'ASSIGNMENT_ELIGIBLE_BUYER_AFTER_SALES',
    'ASSIGNMENT_ELIGIBLE_BUYER_REFUND',
  ],
  buyer_support: [
    'TASK_VIEW_OPEN',
    'TASK_CLAIM',
    'BUYER_SUPPORT_VIEW',
    'BUYER_SUPPORT_NOTE',
    'BUYER_VIEW',
    'ORDER_VIEW',
    'REVIEW_VIEW',
    'BUYER_REFUND_VIEW',
  ],
});

export interface StaffAuthorizationInput {
  roles: ReadonlySet<StaffRoleCode>;
  grants: ReadonlySet<StaffPermissionCode>;
  denies: ReadonlySet<StaffPermissionCode>;
  memberTeamIds: readonly string[];
  leaderTeamIds: readonly string[];
}

export interface EffectiveStaffAuthorization {
  roles: ReadonlySet<StaffRoleCode>;
  permissions: ReadonlySet<StaffPermissionCode>;
  memberTeamIds: readonly string[];
  leaderTeamIds: readonly string[];
}

export function calculateEffectiveStaffAuthorization(
  input: StaffAuthorizationInput,
): EffectiveStaffAuthorization {
  const permissions = new Set<StaffPermissionCode>();

  for (const role of input.roles) {
    for (const permission of ROLE_DEFAULT_PERMISSIONS[role]) {
      permissions.add(permission);
    }
  }

  for (const permission of input.grants) {
    assertPublishedPermission(permission);
    permissions.add(permission);
  }

  if (input.leaderTeamIds.length > 0) {
    for (const permission of LEADER_PERMISSION_PACK) {
      permissions.add(permission);
    }
  }

  if (!input.roles.has('owner')) {
    for (const permission of OWNER_ONLY_PERMISSIONS) {
      permissions.delete(permission);
    }
  }

  for (const permission of input.denies) {
    assertPublishedPermission(permission);
    permissions.delete(permission);
  }

  return Object.freeze({
    roles: new Set(input.roles),
    permissions,
    memberTeamIds: Object.freeze(uniqueSorted(input.memberTeamIds)),
    leaderTeamIds: Object.freeze(uniqueSorted(input.leaderTeamIds)),
  });
}

export function roleDefaultPermissions(
  role: StaffRoleCode,
): ReadonlySet<StaffPermissionCode> {
  return new Set(ROLE_DEFAULT_PERMISSIONS[role]);
}

export function leaderPermissionPack(): ReadonlySet<StaffPermissionCode> {
  return new Set(LEADER_PERMISSION_PACK);
}

export function isOwnerOnlyPermission(
  permission: StaffPermissionCode,
): boolean {
  return OWNER_ONLY_PERMISSIONS.has(permission);
}

function assertPublishedPermission(
  permission: StaffPermissionCode,
): void {
  if (!ALL_PERMISSIONS.has(permission)) {
    throw new Error('unknown_staff_permission');
  }
}

function uniqueSorted(values: readonly string[]): string[] {
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => value.length < 1)) {
    throw new Error('invalid_team_scope');
  }
  return [...new Set(normalized)].sort();
}
