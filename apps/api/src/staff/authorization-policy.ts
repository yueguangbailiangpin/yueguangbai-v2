import {
  STAFF_PERMISSION_CODES,
  type StaffPermissionCode,
  type StaffRoleCode,
} from '@ygb/contracts';

const ALL_PERMISSIONS = new Set<StaffPermissionCode>(STAFF_PERMISSION_CODES);

const OWNER_ONLY_PERMISSIONS = new Set<StaffPermissionCode>([
  'BUYER_IDENTITY_HIGH_RISK_MANAGE',
  'FINANCIAL_VIEW',
  'FINANCIAL_CORRECT',
  'FINANCIAL_EXPORT',
  'STAFF_MANAGE',
  'PERMISSION_MANAGE',
  'AUDIT_VIEW',
  'SCHEDULED_OPERATIONS_RUN',
]);

const ROLE_DEFAULT_PERMISSIONS: Readonly<Record<StaffRoleCode, readonly StaffPermissionCode[]>> = Object.freeze({
  owner: STAFF_PERMISSION_CODES,
  pre_sales: [
    'BUYER_VIEW','BUYER_CREATE','BUYER_ACTIVATE_STANDARD',
    'PRODUCT_VIEW','DEMAND_VIEW','RESERVATION_VIEW','RESERVATION_DECIDE',
    'ORDER_INSTRUCTION_VIEW','ORDER_INSTRUCTION_PUBLISH','ORDER_VIEW','ORDER_CONFIRM',
    'ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES',
  ],
  seller_ops: [
    'SELLER_VIEW','SELLER_MANAGE','PRODUCT_VIEW','PRODUCT_REVIEW',
    'DEMAND_VIEW','DEMAND_PUBLISH','ORDER_VIEW','SELLER_SETTLEMENT_VIEW','SELLER_SETTLEMENT_RECORD',
    'ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT',
  ],
  buyer_refund: [
    'BUYER_VIEW','ORDER_VIEW','REVIEW_VIEW','REVIEW_DECIDE',
    'BUYER_REFUND_VIEW','BUYER_REFUND_RECORD',
    'ASSIGNMENT_ELIGIBLE_BUYER_REFUND',
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

/**
 * Frozen Staff authority: role decides capability; Marketplace decides data scope.
 * Historical personal GRANTs and Team-leader packs are deliberately ignored so
 * legacy assignment data can never expand the current role authority. Explicit
 * DENY remains supported as the only per-user override.
 */
export function calculateEffectiveStaffAuthorization(input: StaffAuthorizationInput): EffectiveStaffAuthorization {
  if (input.roles.size !== 1) throw new Error('invalid_active_staff_role_count');

  for (const permission of input.grants) assertPublishedPermission(permission);
  for (const permission of input.denies) assertPublishedPermission(permission);

  const permissions = new Set<StaffPermissionCode>();
  for (const role of input.roles) {
    for (const permission of ROLE_DEFAULT_PERMISSIONS[role]) permissions.add(permission);
  }

  if (!input.roles.has('owner')) {
    for (const permission of OWNER_ONLY_PERMISSIONS) permissions.delete(permission);
  }
  for (const permission of input.denies) permissions.delete(permission);

  return Object.freeze({
    roles: new Set(input.roles),
    permissions,
    // Kept only for compatibility with old DTOs/audit readers. These arrays are
    // no longer permission authority and must not be used to expand access.
    memberTeamIds: Object.freeze(uniqueSorted(input.memberTeamIds)),
    leaderTeamIds: Object.freeze(uniqueSorted(input.leaderTeamIds)),
  });
}

export function roleDefaultPermissions(role: StaffRoleCode): ReadonlySet<StaffPermissionCode> {
  return new Set(ROLE_DEFAULT_PERMISSIONS[role]);
}

export function leaderPermissionPack(): ReadonlySet<StaffPermissionCode> {
  return new Set<StaffPermissionCode>();
}

export function isOwnerOnlyPermission(permission: StaffPermissionCode): boolean {
  return OWNER_ONLY_PERMISSIONS.has(permission);
}

function assertPublishedPermission(permission: StaffPermissionCode): void {
  if (!ALL_PERMISSIONS.has(permission)) throw new Error('unknown_staff_permission');
}

function uniqueSorted(values: readonly string[]): string[] {
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => value.length < 1)) throw new Error('invalid_team_scope');
  return [...new Set(normalized)].sort();
}
