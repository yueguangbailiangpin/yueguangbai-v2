import {
  isStaffPermissionCode,
  isStaffRoleCode,
  type SqlDatabase,
  type StaffPermissionCode,
  type StaffRoleCode,
} from '@ygb/contracts';
import {
  calculateEffectiveStaffAuthorization,
  type EffectiveStaffAuthorization,
} from '../staff/authorization-policy';

export interface AssignmentStaffAuthorization extends EffectiveStaffAuthorization {
  staffId: string;
  displayName: string;
  staffStatus: 'ACTIVE';
  authorizationVersion: number;
}

interface StaffRow {
  id: string;
  display_name: string;
  status: string;
  authorization_version: number;
}
interface RoleRow { role_code: string }
interface OverrideRow { permission_code: string; effect: string }

export async function resolveAssignmentStaffAuthorization(
  database: SqlDatabase,
  staffId: string,
): Promise<AssignmentStaffAuthorization | null> {
  const staff = await database.prepare(`
    SELECT id,display_name,status,authorization_version
    FROM staff_users WHERE id=?
  `).bind(staffId).first<StaffRow>();
  if (!staff || staff.status !== 'ACTIVE') return null;

  const [roleResult, overrideResult] = await Promise.all([
    database.prepare(`SELECT role_code FROM staff_role_assignments
      WHERE staff_id=? AND status='ACTIVE' ORDER BY role_code`).bind(staffId).all<RoleRow>(),
    database.prepare(`SELECT permission_code,effect FROM staff_permission_overrides
      WHERE staff_id=? AND status='ACTIVE' ORDER BY permission_code`).bind(staffId).all<OverrideRow>(),
  ]);

  const roles = new Set<StaffRoleCode>();
  for (const row of roleResult.results) {
    if (!isStaffRoleCode(row.role_code)) return null;
    roles.add(row.role_code);
  }
  if (roles.size !== 1) return null;

  const denies = new Set<StaffPermissionCode>();
  const legacyGrants = new Set<StaffPermissionCode>();
  for (const row of overrideResult.results) {
    if (!isStaffPermissionCode(row.permission_code)
      || (row.effect !== 'GRANT' && row.effect !== 'DENY')) return null;
    if (row.effect === 'DENY') denies.add(row.permission_code);
    else legacyGrants.add(row.permission_code);
  }

  const effective = calculateEffectiveStaffAuthorization({
    roles,
    grants: legacyGrants,
    denies,
    memberTeamIds: [],
    leaderTeamIds: [],
  });
  return Object.freeze({
    staffId: staff.id,
    displayName: staff.display_name,
    staffStatus: 'ACTIVE' as const,
    authorizationVersion: Number(staff.authorization_version),
    ...effective,
  });
}
