import type {
  SqlDatabase,
  StaffAssignmentDutyCode,
  StaffPermissionCode,
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
  type AssignmentStaffAuthorization,
} from './effective-authorization';
import { StaffAssignmentError } from './errors';

interface CursorRow {
  last_assigned_staff_id: string | null;
  version: number;
}
interface CandidateRow { staff_id: string }
interface StaffStateRow { staff_status: string }
interface FallbackRow { staff_id: string }

export interface ResolvedRoundRobinCandidate {
  staff: AssignmentStaffAuthorization;
  cursor: {
    exists: boolean;
    dutyCode: StaffAssignmentDutyCode;
    marketplaceCode: string;
    candidatePoolKey: string;
    teamId: string | null;
    previousStaffId: string | null;
    expectedVersion: number;
  };
}

export async function resolveRoundRobinCandidate(
  database: SqlDatabase,
  input: {
    dutyCode: StaffAssignmentDutyCode;
    workType: StaffWorkItemType;
    marketplaceCode: string;
    excludedStaffIds?: readonly string[];
  },
): Promise<ResolvedRoundRobinCandidate | null> {
  const candidatePoolKey = 'DEFAULT';
  const cursor = await database.prepare(`
    SELECT last_assigned_staff_id, version
    FROM staff_assignment_cursors
    WHERE duty_code=? AND marketplace_code=? AND candidate_pool_key=?
  `).bind(
    input.dutyCode,
    input.marketplaceCode,
    candidatePoolKey,
  ).first<CursorRow>();
  const candidate = await selectCandidate(database, {
    eligibilityPermission: eligibilityPermissionForDuty(input.dutyCode),
    requiredBusinessPermissions: [businessPermissionForWorkItem(input.workType)],
    marketplaceCode: canonicalMarketplaceCode(input.marketplaceCode),
    lastAssignedStaffId: cursor?.last_assigned_staff_id ?? null,
    excluded: [...new Set(input.excludedStaffIds ?? [])],
  });
  if (!candidate) return null;
  const authorization = await resolveAssignmentStaffAuthorization(
    database,
    candidate.staff_id,
  );
  if (!authorization) {
    throw new StaffAssignmentError('DEPENDENCY_UNAVAILABLE', 503);
  }
  return {
    staff: authorization,
    cursor: {
      exists: cursor !== null,
      dutyCode: input.dutyCode,
      marketplaceCode: input.marketplaceCode,
      candidatePoolKey,
      teamId: null,
      previousStaffId: cursor?.last_assigned_staff_id ?? null,
      expectedVersion: Number(cursor?.version ?? 0),
    },
  };
}

export async function resolveRoundRobinFixedDutyCandidate(
  database: SqlDatabase,
  input: {
    dutyCode: StaffAssignmentDutyCode;
    marketplaceCode: string;
    excludedStaffIds?: readonly string[];
  },
): Promise<ResolvedRoundRobinCandidate | null> {
  const candidatePoolKey = 'DEFAULT';
  const cursor = await database.prepare(`
    SELECT last_assigned_staff_id, version
    FROM staff_assignment_cursors
    WHERE duty_code=? AND marketplace_code=? AND candidate_pool_key=?
  `).bind(input.dutyCode, input.marketplaceCode, candidatePoolKey)
    .first<CursorRow>();
  const candidate = await selectCandidate(database, {
    eligibilityPermission: eligibilityPermissionForDuty(input.dutyCode),
    requiredBusinessPermissions: businessPermissionsForDuty(input.dutyCode),
    marketplaceCode: canonicalMarketplaceCode(input.marketplaceCode),
    lastAssignedStaffId: cursor?.last_assigned_staff_id ?? null,
    excluded: [...new Set(input.excludedStaffIds ?? [])],
  });
  if (!candidate) return null;
  const authorization = await resolveAssignmentStaffAuthorization(
    database,
    candidate.staff_id,
  );
  if (!authorization) {
    throw new StaffAssignmentError('DEPENDENCY_UNAVAILABLE', 503);
  }
  return {
    staff: authorization,
    cursor: {
      exists: cursor !== null,
      dutyCode: input.dutyCode,
      marketplaceCode: input.marketplaceCode,
      candidatePoolKey,
      teamId: null,
      previousStaffId: cursor?.last_assigned_staff_id ?? null,
      expectedVersion: Number(cursor?.version ?? 0),
    },
  };
}

async function selectCandidate(
  database: SqlDatabase,
  input: {
    eligibilityPermission: StaffPermissionCode;
    requiredBusinessPermissions: readonly StaffPermissionCode[];
    marketplaceCode: string;
    lastAssignedStaffId: string | null;
    excluded: readonly string[];
  },
): Promise<CandidateRow | null> {
  const excludedSql = input.excluded.length > 0
    ? `AND staff.id NOT IN (${input.excluded.map(() => '?').join(', ')})`
    : '';
  const businessPlaceholders = input.requiredBusinessPermissions
    .map(() => '?').join(', ');
  return database.prepare(`
    SELECT DISTINCT staff.id AS staff_id
    FROM staff_users staff
    JOIN staff_effective_assignment_permissions permission
      ON permission.staff_id=staff.id
      AND permission.permission_code=?
    JOIN staff_marketplace_scopes scope
      ON scope.staff_id=staff.id
      AND scope.status='ACTIVE'
      AND scope.scope_kind='PRIMARY'
      AND scope.marketplace_code=?
    WHERE staff.status='ACTIVE'
      ${excludedSql}
      AND (
        SELECT COUNT(DISTINCT business_permission.permission_code)
        FROM staff_effective_assignment_permissions business_permission
        WHERE business_permission.staff_id=staff.id
          AND business_permission.permission_code IN (${businessPlaceholders})
      )=?
    ORDER BY
      CASE
        WHEN ? IS NULL THEN 0
        WHEN staff.id>? THEN 0
        ELSE 1
      END,
      staff.id
    LIMIT 1
  `).bind(
    input.eligibilityPermission,
    input.marketplaceCode,
    ...input.excluded,
    ...input.requiredBusinessPermissions,
    input.requiredBusinessPermissions.length,
    input.lastAssignedStaffId,
    input.lastAssignedStaffId,
  ).first<CandidateRow>();
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
  const state = await database.prepare(`
    SELECT staff.status AS staff_status
    FROM staff_users staff
    WHERE staff.id=?
  `).bind(input.staffId).first<StaffStateRow>();
  if (!state || state.staff_status !== 'ACTIVE') {
    return false;
  }
  const authorization = await resolveAssignmentStaffAuthorization(
    database,
    input.staffId,
  );
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
    && authorization.permissions.has(
      eligibilityPermissionForDuty(input.dutyCode),
    )
    && requiredPermissions.every((permission) => authorization.permissions.has(permission)));
}

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

export async function resolveOwnerFallbackForFixedDuty(
  database: SqlDatabase,
  input: { marketplaceCode: string; dutyCode: StaffAssignmentDutyCode },
): Promise<AssignmentStaffAuthorization> {
  const fallback = await database.prepare(`
    SELECT staff_id FROM staff_assignment_fallbacks WHERE marketplace_code=?
  `).bind(input.marketplaceCode).first<FallbackRow>();
  if (!fallback) throw new StaffAssignmentError('OWNER_FALLBACK_NOT_CONFIGURED', 503);
  const authorization = await resolveAssignmentStaffAuthorization(database, fallback.staff_id);
  if (!authorization || !authorization.roles.has('owner')
    || !await isStaffEligibleForFixedDuty(database, {
      staffId: fallback.staff_id,
      dutyCode: input.dutyCode,
      marketplaceCode: input.marketplaceCode,
    })) throw new StaffAssignmentError('OWNER_FALLBACK_INVALID', 503);
  return authorization;
}

export async function resolveOwnerFallback(
  database: SqlDatabase,
  input: {
    marketplaceCode: string;
    dutyCode: StaffAssignmentDutyCode;
    workType: StaffWorkItemType;
  },
): Promise<AssignmentStaffAuthorization> {
  const fallback = await database.prepare(`
    SELECT staff_id
    FROM staff_assignment_fallbacks
    WHERE marketplace_code=?
  `).bind(input.marketplaceCode).first<FallbackRow>();
  if (!fallback) {
    throw new StaffAssignmentError(
      'OWNER_FALLBACK_NOT_CONFIGURED',
      503,
    );
  }
  const authorization = await resolveAssignmentStaffAuthorization(
    database,
    fallback.staff_id,
  );
  if (!authorization
    || !authorization.roles.has('owner')
    || !await isStaffEligibleForFixedDuty(database, {
      staffId: fallback.staff_id,
      dutyCode: input.dutyCode,
      marketplaceCode: input.marketplaceCode,
    })
    || !authorization.permissions.has(businessPermissionForWorkItem(input.workType))) {
    throw new StaffAssignmentError('OWNER_FALLBACK_INVALID', 503);
  }
  return authorization;
}
