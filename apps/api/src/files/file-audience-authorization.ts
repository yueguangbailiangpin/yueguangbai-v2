import {
  isStaffPermissionCode,
  isStaffRoleCode,
  type FileActor,
  type FileReadPrincipal,
  type SqlDatabase,
  type StaffPermissionCode,
  type StaffRoleCode,
} from '@ygb/contracts';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import type {
  FileAuthorizationResource,
  FileAuthorizationService,
} from './authorization';
import { FileStorageError } from './file-error';
import { cleanFileIdentifier } from './file-records';

interface StaffGrantRow {
  staff_permission_code: string;
  staff_scope_type: 'GLOBAL' | 'TEAM';
  staff_team_id: string | null;
}

interface RoleRow {
  role_code: string;
}

interface OverrideRow {
  permission_code: string;
  effect: string;
}

interface TeamRow {
  team_id: string;
  team_status: string;
  department_status: string;
  is_leader: number;
}

/**
 * Routes legacy links to the pre-existing authorization service unchanged and
 * evaluates explicit links only from verified session authority identifiers.
 */
export async function authorizeFileRead(
  database: SqlDatabase,
  legacyAuthorization: FileAuthorizationService,
  actor: FileActor,
  principal: FileReadPrincipal | undefined,
  resource: FileAuthorizationResource,
  now: number,
): Promise<void> {
  if ((resource.linkAuthorizationMode ?? 'LEGACY_VISIBILITY')
    === 'LEGACY_VISIBILITY') {
    await legacyAuthorization.assertCanRead(actor, resource);
    return;
  }
  if (!principal) throw new FileStorageError('FORBIDDEN', 403);
  await authorizeExplicitAudienceRead(
    database,
    principal,
    actor,
    resource,
    now,
  );
}

export async function authorizeExplicitAudienceRead(
  database: SqlDatabase,
  principal: FileReadPrincipal,
  actor: FileActor,
  resource: FileAuthorizationResource,
  now = Date.now(),
): Promise<void> {
  if (!Number.isSafeInteger(now) || now < 0
    || resource.linkAuthorizationMode !== 'EXPLICIT_AUDIENCES'
    || !resource.fileEntityLinkId) {
    throw new FileStorageError('FORBIDDEN', 403);
  }
  const linkId = cleanFileIdentifier(resource.fileEntityLinkId, 120);

  if (principal.type === 'BUYER_SESSION') {
    if (actor.type !== 'BUYER_CUSTOMER') deny();
    const allowed = await activeBuyerGrantExists(
      database,
      linkId,
      principal,
      now,
    );
    if (!allowed) deny();
    return;
  }

  if (principal.type === 'SELLER_SESSION') {
    if (actor.type !== 'SELLER_MEMBER') deny();
    const allowed = await activeSellerGrantExists(
      database,
      linkId,
      principal,
      now,
    );
    if (!allowed) deny();
    return;
  }

  if (actor.type !== 'STAFF' || actor.id !== principal.staffId) deny();
  const allowed = await activeStaffGrantExists(
    database,
    linkId,
    principal.staffId,
    now,
  );
  if (!allowed) deny();
}

async function activeBuyerGrantExists(
  database: SqlDatabase,
  linkId: string,
  principal: Extract<FileReadPrincipal, { type: 'BUYER_SESSION' }>,
  now: number,
): Promise<boolean> {
  const accountId = cleanFileIdentifier(principal.accountId, 120);
  const subjectId = cleanFileIdentifier(principal.identitySubjectId, 120);
  const row = await database.prepare(`
    SELECT 1 AS allowed
    FROM customer_login_accounts account
    JOIN buyer_customers buyer
      ON buyer.identity_subject_id=account.identity_subject_id
    JOIN file_entity_audience_grants grant
      ON grant.buyer_customer_id=buyer.id
      AND grant.subject_type='BUYER'
    JOIN file_entity_links link
      ON link.id=grant.file_entity_link_id
    WHERE account.id=?
      AND account.identity_subject_id=?
      AND account.account_type='BUYER'
      AND account.status='ACTIVE'
      AND buyer.access_status='ACTIVE'
      AND link.id=?
      AND link.authorization_mode='EXPLICIT_AUDIENCES'
      AND link.revoked_at IS NULL
      AND (link.expires_at IS NULL OR link.expires_at>?)
      AND grant.revoked_at IS NULL
      AND (grant.expires_at IS NULL OR grant.expires_at>?)
    LIMIT 1
  `).bind(
    accountId,
    subjectId,
    linkId,
    now,
    now,
  ).first<{ allowed: number }>();
  return Number(row?.allowed) === 1;
}

async function activeSellerGrantExists(
  database: SqlDatabase,
  linkId: string,
  principal: Extract<FileReadPrincipal, { type: 'SELLER_SESSION' }>,
  now: number,
): Promise<boolean> {
  const accountId = cleanFileIdentifier(principal.accountId, 120);
  const subjectId = cleanFileIdentifier(principal.identitySubjectId, 120);
  const row = await database.prepare(`
    SELECT 1 AS allowed
    FROM customer_login_accounts account
    JOIN seller_organization_members member
      ON member.identity_subject_id=account.identity_subject_id
    JOIN seller_organizations organization
      ON organization.id=member.organization_id
    JOIN file_entity_audience_grants grant
      ON grant.seller_organization_id=organization.id
      AND grant.subject_type='SELLER_ORGANIZATION'
    JOIN file_entity_links link
      ON link.id=grant.file_entity_link_id
    WHERE account.id=?
      AND account.identity_subject_id=?
      AND account.account_type='SELLER_MEMBER'
      AND account.status='ACTIVE'
      AND member.status='ACTIVE'
      AND organization.status='ACTIVE'
      AND link.id=?
      AND link.authorization_mode='EXPLICIT_AUDIENCES'
      AND link.revoked_at IS NULL
      AND (link.expires_at IS NULL OR link.expires_at>?)
      AND grant.revoked_at IS NULL
      AND (grant.expires_at IS NULL OR grant.expires_at>?)
    LIMIT 1
  `).bind(
    accountId,
    subjectId,
    linkId,
    now,
    now,
  ).first<{ allowed: number }>();
  return Number(row?.allowed) === 1;
}

async function activeStaffGrantExists(
  database: SqlDatabase,
  linkId: string,
  untrustedStaffId: string,
  now: number,
): Promise<boolean> {
  const staffId = cleanFileIdentifier(untrustedStaffId, 120);
  const staff = await database.prepare(`
    SELECT status
    FROM staff_users
    WHERE id=?
  `).bind(staffId).first<{ status: string }>();
  if (staff?.status !== 'ACTIVE') return false;

  const [rolesResult, overridesResult, teamsResult, grantsResult] =
    await Promise.all([
      database.prepare(`
        SELECT role_code
        FROM staff_role_assignments
        WHERE staff_id=? AND status='ACTIVE'
      `).bind(staffId).all<RoleRow>(),
      database.prepare(`
        SELECT permission_code, effect
        FROM staff_permission_overrides
        WHERE staff_id=? AND status='ACTIVE'
      `).bind(staffId).all<OverrideRow>(),
      database.prepare(`
        SELECT
          membership.team_id,
          team.status AS team_status,
          department.status AS department_status,
          CASE WHEN leader.staff_id IS NULL THEN 0 ELSE 1 END AS is_leader
        FROM staff_team_memberships membership
        JOIN staff_teams team ON team.id=membership.team_id
        JOIN staff_departments department
          ON department.id=team.department_id
        LEFT JOIN staff_team_leaders leader
          ON leader.staff_id=membership.staff_id
          AND leader.team_id=membership.team_id
          AND leader.status='ACTIVE'
        WHERE membership.staff_id=?
          AND membership.status='ACTIVE'
      `).bind(staffId).all<TeamRow>(),
      database.prepare(`
        SELECT
          grant.staff_permission_code,
          grant.staff_scope_type,
          grant.staff_team_id
        FROM file_entity_audience_grants grant
        JOIN file_entity_links link
          ON link.id=grant.file_entity_link_id
        WHERE grant.file_entity_link_id=?
          AND grant.subject_type='STAFF_INTERNAL'
          AND grant.revoked_at IS NULL
          AND (grant.expires_at IS NULL OR grant.expires_at>?)
          AND link.authorization_mode='EXPLICIT_AUDIENCES'
          AND link.revoked_at IS NULL
          AND (link.expires_at IS NULL OR link.expires_at>?)
      `).bind(linkId, now, now).all<StaffGrantRow>(),
    ]);

  const roles = new Set<StaffRoleCode>();
  for (const row of rolesResult.results) {
    if (!isStaffRoleCode(row.role_code)) return false;
    roles.add(row.role_code);
  }
  if (roles.size < 1) return false;

  const grants = new Set<StaffPermissionCode>();
  const denies = new Set<StaffPermissionCode>();
  for (const row of overridesResult.results) {
    if (!isStaffPermissionCode(row.permission_code)
      || (row.effect !== 'GRANT' && row.effect !== 'DENY')) {
      return false;
    }
    if (row.effect === 'GRANT') grants.add(row.permission_code);
    else denies.add(row.permission_code);
  }

  const activeTeams = teamsResult.results.filter(
    (row) => row.team_status === 'ACTIVE'
      && row.department_status === 'ACTIVE',
  );
  const effective = calculateEffectiveStaffAuthorization({
    roles,
    grants,
    denies,
    memberTeamIds: activeTeams.map((row) => row.team_id),
    leaderTeamIds: activeTeams
      .filter((row) => Number(row.is_leader) === 1)
      .map((row) => row.team_id),
  });

  return grantsResult.results.some((grant) => {
    if (!isStaffPermissionCode(grant.staff_permission_code)
      || !effective.permissions.has(grant.staff_permission_code)) {
      return false;
    }
    return grant.staff_scope_type === 'GLOBAL'
      || (grant.staff_scope_type === 'TEAM'
        && grant.staff_team_id !== null
        && effective.memberTeamIds.includes(grant.staff_team_id));
  });
}

function deny(): never {
  throw new FileStorageError('FORBIDDEN', 403);
}
