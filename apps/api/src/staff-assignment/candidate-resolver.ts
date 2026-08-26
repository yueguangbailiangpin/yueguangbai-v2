import type {
  SqlDatabase,
  StaffAssignmentDutyCode,
  StaffWorkItemType,
} from '@ygb/contracts';
import {
  businessPermissionForWorkItem,
  businessPermissionsForDuty,
  canonicalMarketplaceCode,
  eligibilityPermissionForDuty,
} from '@ygb/domain';
import {
  resolveAssignmentStaffAuthorization,
} from './effective-authorization';

interface StaffStateRow { staff_status: string }

/**
 * Fixed-duty eligibility: a staff member can hold a duty binding only while
 * they are ACTIVE, carry the duty eligibility permission plus every duty
 * business permission, and own the marketplace scope (or are the owner).
 * There is no pool, round-robin or fallback: these checks gate the fixed
 * duty owner bindings only.
 */
export async function isStaffEligibleForFixedDuty(
  database: SqlDatabase,
  input: {
    staffId: string;
    dutyCode: StaffAssignmentDutyCode;
    marketplaceCode: string;
  },
): Promise<boolean> {
  const state = await database.prepare(`
    SELECT staff.status AS staff_status
    FROM staff_users staff
    WHERE staff.id=?
  `).bind(input.staffId).first<StaffStateRow>();
  if (!state || state.staff_status !== 'ACTIVE') return false;
  const authorization = await resolveAssignmentStaffAuthorization(database, input.staffId);
  const requiredPermissions = businessPermissionsForDuty(input.dutyCode);
  const hasPrimaryScope = authorization?.roles.has('owner') || Boolean(
    await database.prepare(`SELECT 1 AS allowed
      FROM staff_marketplace_scopes
      WHERE staff_id=? AND marketplace_code=?
        AND status='ACTIVE' AND scope_kind='PRIMARY'
      LIMIT 1`).bind(
        input.staffId,
        canonicalMarketplaceCode(input.marketplaceCode),
      ).first<{allowed:number}>(),
  );
  return Boolean(authorization && hasPrimaryScope
    && authorization.permissions.has(eligibilityPermissionForDuty(input.dutyCode))
    && requiredPermissions.every((permission) => authorization.permissions.has(permission)));
}

export async function isStaffEligibleForDuty(
  database: SqlDatabase,
  input: {
    staffId: string;
    dutyCode: StaffAssignmentDutyCode;
    workType: StaffWorkItemType;
    marketplaceCode: string;
  },
): Promise<boolean> {
  if (!await isStaffEligibleForFixedDuty(database, {
    staffId: input.staffId,
    dutyCode: input.dutyCode,
    marketplaceCode: input.marketplaceCode,
  })) {
    return false;
  }
  const authorization = await resolveAssignmentStaffAuthorization(database, input.staffId);
  return Boolean(authorization
    && authorization.permissions.has(businessPermissionForWorkItem(input.workType)));
}
