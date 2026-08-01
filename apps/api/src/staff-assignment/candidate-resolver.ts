import type {
  SqlDatabase,
  StaffAssignmentDutyCode,
  StaffPermissionCode,
  StaffWorkItemType,
} from '@ygb/contracts';
import {
  businessPermissionForWorkItem,
  businessPermissionsForDuty,
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
interface AvailabilityRow {
  staff_status: string;
  availability_status: string | null;
}
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
    teamId?: string | null;
    excludedStaffIds?: readonly string[];
  },
): Promise<ResolvedRoundRobinCandidate | null> {
  const teamId = input.teamId ?? null;
  const candidatePoolKey = teamId ?? 'DEFAULT';
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
    lastAssignedStaffId: cursor?.last_assigned_staff_id ?? null,
    teamId,
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
      teamId,
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
    teamId?: string | null;
    excludedStaffIds?: readonly string[];
  },
): Promise<ResolvedRoundRobinCandidate | null> {
  const teamId = input.teamId ?? null;
  const candidatePoolKey = teamId ?? 'DEFAULT';
  const cursor = await database.prepare(`
    SELECT last_assigned_staff_id, version
    FROM staff_assignment_cursors
    WHERE duty_code=? AND marketplace_code=? AND candidate_pool_key=?
  `).bind(input.dutyCode, input.marketplaceCode, candidatePoolKey)
    .first<CursorRow>();
  const candidate = await selectCandidate(database, {
    eligibilityPermission: eligibilityPermissionForDuty(input.dutyCode),
    requiredBusinessPermissions: businessPermissionsForDuty(input.dutyCode),
    lastAssignedStaffId: cursor?.last_assigned_staff_id ?? null,
    teamId,
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
      teamId,
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
    lastAssignedStaffId: string | null;
    teamId: string | null;
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
    JOIN staff_team_memberships membership
      ON membership.staff_id=staff.id
      AND membership.status='ACTIVE'
    JOIN staff_teams team
      ON team.id=membership.team_id
      AND team.status='ACTIVE'
    JOIN staff_departments department
      ON department.id=team.department_id
      AND department.status='ACTIVE'
    LEFT JOIN staff_availability availability
      ON availability.staff_id=staff.id
    WHERE staff.status='ACTIVE'
      AND COALESCE(availability.availability_status, 'AVAILABLE')='AVAILABLE'
      AND (? IS NULL OR membership.team_id=?)
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
    input.teamId,
    input.teamId,
    ...input.excluded,
    ...input.requiredBusinessPermissions,
    input.requiredBusinessPermissions.length,
    input.lastAssignedStaffId,
    input.lastAssignedStaffId,
  ).first<CandidateRow>();
}

export async function isStaffAvailableForDuty(
  database: SqlDatabase,
  input: {
    staffId: string;
    dutyCode: StaffAssignmentDutyCode;
    workType: StaffWorkItemType;
  },
): Promise<boolean> {
  const state = await database.prepare(`
    SELECT staff.status AS staff_status,
      availability.availability_status
    FROM staff_users staff
    LEFT JOIN staff_availability availability
      ON availability.staff_id=staff.id
    WHERE staff.id=?
  `).bind(input.staffId).first<AvailabilityRow>();
  if (!state
    || state.staff_status !== 'ACTIVE'
    || (state.availability_status ?? 'AVAILABLE') !== 'AVAILABLE') {
    return false;
  }
  const authorization = await resolveAssignmentStaffAuthorization(
    database,
    input.staffId,
  );
  const requiredPermissions = businessPermissionsForDuty(input.dutyCode);
  return Boolean(authorization
    && authorization.permissions.has(
      eligibilityPermissionForDuty(input.dutyCode),
    )
    && requiredPermissions.every((permission) => authorization.permissions.has(permission)));
}

export async function isStaffAvailableForFixedDuty(
  database: SqlDatabase,
  input: { staffId: string; dutyCode: StaffAssignmentDutyCode },
): Promise<boolean> {
  const state = await database.prepare(`
    SELECT staff.status AS staff_status, availability.availability_status
    FROM staff_users staff
    LEFT JOIN staff_availability availability ON availability.staff_id=staff.id
    WHERE staff.id=?
  `).bind(input.staffId).first<AvailabilityRow>();
  if (!state || state.staff_status !== 'ACTIVE'
    || (state.availability_status ?? 'AVAILABLE') !== 'AVAILABLE') return false;
  const authorization = await resolveAssignmentStaffAuthorization(database, input.staffId);
  const requiredPermissions = businessPermissionsForDuty(input.dutyCode);
  return Boolean(authorization
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
    || !await isStaffAvailableForFixedDuty(database, {
      staffId: fallback.staff_id,
      dutyCode: input.dutyCode,
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
    || !await isStaffAvailableForFixedDuty(database, {
      staffId: fallback.staff_id,
      dutyCode: input.dutyCode,
    })
    || !authorization.permissions.has(businessPermissionForWorkItem(input.workType))) {
    throw new StaffAssignmentError('OWNER_FALLBACK_INVALID', 503);
  }
  return authorization;
}
