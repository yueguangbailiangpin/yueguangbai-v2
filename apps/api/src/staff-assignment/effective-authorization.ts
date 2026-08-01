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

export interface AssignmentStaffAuthorization
  extends EffectiveStaffAuthorization {
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
interface TeamRow {
  team_id: string;
  team_status: string;
  department_status: string;
  is_leader: number;
}

export async function resolveAssignmentStaffAuthorization(
  database: SqlDatabase,
  staffId: string,
): Promise<AssignmentStaffAuthorization | null> {
  const staff = await database.prepare(`
    SELECT id, display_name, status, authorization_version
    FROM staff_users
    WHERE id=?
  `).bind(staffId).first<StaffRow>();
  if (!staff || staff.status !== 'ACTIVE') return null;

  const [roleResult, overrideResult, teamResult] = await Promise.all([
    database.prepare(`
      SELECT role_code FROM staff_role_assignments
      WHERE staff_id=? AND status='ACTIVE'
      ORDER BY role_code
    `).bind(staffId).all<RoleRow>(),
    database.prepare(`
      SELECT permission_code, effect FROM staff_permission_overrides
      WHERE staff_id=? AND status='ACTIVE'
      ORDER BY permission_code
    `).bind(staffId).all<OverrideRow>(),
    database.prepare(`
      SELECT membership.team_id,
        team.status AS team_status,
        department.status AS department_status,
        CASE WHEN leader.staff_id IS NULL THEN 0 ELSE 1 END AS is_leader
      FROM staff_team_memberships membership
      JOIN staff_teams team ON team.id=membership.team_id
      JOIN staff_departments department ON department.id=team.department_id
      LEFT JOIN staff_team_leaders leader
        ON leader.staff_id=membership.staff_id
        AND leader.team_id=membership.team_id
        AND leader.status='ACTIVE'
      WHERE membership.staff_id=? AND membership.status='ACTIVE'
      ORDER BY membership.team_id
    `).bind(staffId).all<TeamRow>(),
  ]);

  const roles = new Set<StaffRoleCode>();
  for (const row of roleResult.results) {
    if (!isStaffRoleCode(row.role_code)) return null;
    roles.add(row.role_code);
  }
  if (roles.size < 1) return null;

  const grants = new Set<StaffPermissionCode>();
  const denies = new Set<StaffPermissionCode>();
  for (const row of overrideResult.results) {
    if (!isStaffPermissionCode(row.permission_code)
      || (row.effect !== 'GRANT' && row.effect !== 'DENY')) {
      return null;
    }
    (row.effect === 'GRANT' ? grants : denies).add(row.permission_code);
  }
  const activeTeams = teamResult.results.filter(
    (row) => row.team_status === 'ACTIVE'
      && row.department_status === 'ACTIVE',
  );
  // Ordinary assignees must belong to an active Team/Department. The explicit
  // Marketplace fallback Owner is allowed to sit outside an operating team;
  // Owner Data Scope is GLOBAL and fallback validation is separately strict.
  if (activeTeams.length < 1 && !roles.has('owner')) return null;
  const effective = calculateEffectiveStaffAuthorization({
    roles,
    grants,
    denies,
    memberTeamIds: activeTeams.map((row) => row.team_id),
    leaderTeamIds: activeTeams
      .filter((row) => Number(row.is_leader) === 1)
      .map((row) => row.team_id),
  });
  return Object.freeze({
    staffId: staff.id,
    displayName: staff.display_name,
    staffStatus: 'ACTIVE' as const,
    authorizationVersion: Number(staff.authorization_version),
    ...effective,
  });
}
