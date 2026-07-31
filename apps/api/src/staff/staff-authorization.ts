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
} from './authorization-policy';

export interface StaffAuthorizationContext
  extends EffectiveStaffAuthorization {
  staffId: string;
  displayName: string;
  authorizationVersion: number;
  feishu: {
    identityId: string;
    tenantKey: string;
    openId: string;
    userId: string | null;
    verifiedAt: number;
  };
}

interface StaffIdentityRow {
  identity_id: string;
  staff_id: string;
  display_name: string;
  staff_status: string;
  authorization_version: number;
  tenant_key: string;
  open_id: string;
  user_id: string | null;
  identity_status: string;
  verified_at: number;
}

interface RoleRow {
  role_code: string;
}

interface OverrideRow {
  permission_code: string;
  effect: string;
}

interface TeamScopeRow {
  team_id: string;
  team_status: string;
  department_status: string;
  is_leader: number;
}

export async function resolveStaffAuthorizationByFeishu(
  database: SqlDatabase,
  input: {
    tenantKey: string;
    openId: string;
  },
): Promise<StaffAuthorizationContext | null> {
  const tenantKey = normalizeIdentityPart(input.tenantKey);
  const openId = normalizeIdentityPart(input.openId);
  if (!tenantKey || !openId) return null;

  const identity = await database.prepare(`
    SELECT
      identity.id AS identity_id,
      staff.id AS staff_id,
      staff.display_name,
      staff.status AS staff_status,
      staff.authorization_version,
      identity.tenant_key,
      identity.open_id,
      identity.user_id,
      identity.status AS identity_status,
      identity.verified_at
    FROM feishu_staff_identities identity
    JOIN staff_users staff
      ON staff.id=identity.staff_id
    WHERE identity.tenant_key=?
      AND identity.open_id=?
  `).bind(
    tenantKey,
    openId,
  ).first<StaffIdentityRow>();

  if (!identity
    || identity.staff_status !== 'ACTIVE'
    || identity.identity_status !== 'ACTIVE') {
    return null;
  }

  const [rolesResult, overridesResult, teamsResult] =
    await Promise.all([
      database.prepare(`
        SELECT role_code
        FROM staff_role_assignments
        WHERE staff_id=?
          AND status='ACTIVE'
        ORDER BY role_code
      `).bind(identity.staff_id).all<RoleRow>(),
      database.prepare(`
        SELECT permission_code, effect
        FROM staff_permission_overrides
        WHERE staff_id=?
          AND status='ACTIVE'
        ORDER BY permission_code
      `).bind(identity.staff_id).all<OverrideRow>(),
      database.prepare(`
        SELECT
          membership.team_id,
          team.status AS team_status,
          department.status AS department_status,
          CASE WHEN leader.staff_id IS NULL THEN 0 ELSE 1 END AS is_leader
        FROM staff_team_memberships membership
        JOIN staff_teams team
          ON team.id=membership.team_id
        JOIN staff_departments department
          ON department.id=team.department_id
        LEFT JOIN staff_team_leaders leader
          ON leader.staff_id=membership.staff_id
          AND leader.team_id=membership.team_id
          AND leader.status='ACTIVE'
        WHERE membership.staff_id=?
          AND membership.status='ACTIVE'
        ORDER BY membership.team_id
      `).bind(identity.staff_id).all<TeamScopeRow>(),
    ]);

  const roles = parseRoles(rolesResult.results);
  if (roles.size < 1) return null;

  const {
    grants,
    denies,
  } = parseOverrides(overridesResult.results);

  const activeTeams = teamsResult.results.filter(
    (team) => team.team_status === 'ACTIVE'
      && team.department_status === 'ACTIVE',
  );
  const memberTeamIds = activeTeams.map((team) => team.team_id);
  const leaderTeamIds = activeTeams
    .filter((team) => Number(team.is_leader) === 1)
    .map((team) => team.team_id);

  const effective = calculateEffectiveStaffAuthorization({
    roles,
    grants,
    denies,
    memberTeamIds,
    leaderTeamIds,
  });

  return Object.freeze({
    staffId: identity.staff_id,
    displayName: identity.display_name,
    authorizationVersion: Number(identity.authorization_version),
    ...effective,
    feishu: Object.freeze({
      identityId: identity.identity_id,
      tenantKey: identity.tenant_key,
      openId: identity.open_id,
      userId: identity.user_id,
      verifiedAt: Number(identity.verified_at),
    }),
  });
}

function parseRoles(
  rows: readonly RoleRow[],
): ReadonlySet<StaffRoleCode> {
  const roles = new Set<StaffRoleCode>();
  for (const row of rows) {
    if (!isStaffRoleCode(row.role_code)) {
      throw new Error('invalid_staff_role_dependency');
    }
    roles.add(row.role_code);
  }
  return roles;
}

function parseOverrides(
  rows: readonly OverrideRow[],
): {
  grants: ReadonlySet<StaffPermissionCode>;
  denies: ReadonlySet<StaffPermissionCode>;
} {
  const grants = new Set<StaffPermissionCode>();
  const denies = new Set<StaffPermissionCode>();

  for (const row of rows) {
    if (!isStaffPermissionCode(row.permission_code)
      || (row.effect !== 'GRANT' && row.effect !== 'DENY')) {
      throw new Error('invalid_staff_permission_dependency');
    }
    if (row.effect === 'GRANT') grants.add(row.permission_code);
    else denies.add(row.permission_code);
  }

  return { grants, denies };
}

function normalizeIdentityPart(value: string): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > 200
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    return null;
  }
  return normalized;
}
