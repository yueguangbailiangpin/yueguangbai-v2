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
import { resolveAssignmentStaffAuthorization } from '../staff-assignment';
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

interface SellerSettlementProofAuthorityRow {
  payment_id: string;
  seller_organization_id: string;
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
  const settlementProof = isSellerSettlementProofResource(resource);

  // Seller settlement proofs are never customer-readable, even if a malformed
  // or compromised audience graph contains a customer grant.
  if (settlementProof && principal.type !== 'STAFF_SESSION') deny();

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
      actor.id,
      resource,
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

  // GLOBAL is only an internal audience marker for settlement proofs. It is
  // never sufficient authority. Resolve the current Staff authorization and
  // current Seller Account Manager / Team Manager / Owner scope on every
  // create and consume operation.
  if (settlementProof) {
    const scoped = await activeSellerSettlementProofScopeExists(
      database,
      linkId,
      resource.fileObjectId,
      principal.staffId,
      now,
    );
    if (!scoped) deny();
  }
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
    JOIN customer_account_personas persona
      ON persona.account_id=account.id AND persona.persona_type='BUYER'
    JOIN buyer_customers buyer
      ON buyer.id=persona.buyer_customer_id
      AND buyer.identity_subject_id=account.identity_subject_id
    JOIN file_entity_audience_grants grant
      ON grant.buyer_customer_id=buyer.id
      AND grant.subject_type='BUYER'
    JOIN file_entity_links link
      ON link.id=grant.file_entity_link_id
    WHERE account.id=?
      AND account.identity_subject_id=?
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
  actorMemberId: string,
  resource: FileAuthorizationResource,
  now: number,
): Promise<boolean> {
  const accountId = cleanFileIdentifier(principal.accountId, 120);
  const subjectId = cleanFileIdentifier(principal.identitySubjectId, 120);
  const memberId = cleanFileIdentifier(actorMemberId, 120);
  const chatScreenshot = resource.purpose === 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
    && resource.entityType === 'ORDER_EVIDENCE_SUBMISSION';
  const row = await database.prepare(`
    SELECT 1 AS allowed
    FROM customer_login_accounts account
    JOIN customer_account_personas persona
      ON persona.account_id=account.id AND persona.persona_type='SELLER_MEMBER'
    JOIN seller_organization_members member
      ON member.id=persona.seller_member_id
      AND member.identity_subject_id=account.identity_subject_id
    JOIN seller_organizations organization
      ON organization.id=member.organization_id
    JOIN file_entity_audience_grants grant
      ON grant.seller_organization_id=organization.id
      AND grant.subject_type='SELLER_ORGANIZATION'
    JOIN file_entity_links link
      ON link.id=grant.file_entity_link_id
    ${chatScreenshot ? `
    JOIN (
      SELECT
        attachment.file_entity_link_id,
        formal_order.seller_organization_id,
        formal_order.store_id AS seller_store_id,
        formal_order.order_evidence_submission_id AS evidence_entity_id
      FROM order_evidence_internal_files attachment
      JOIN formal_orders formal_order
        ON formal_order.order_evidence_submission_id=
          attachment.order_evidence_submission_id
        AND formal_order.status='CONFIRMED'
      UNION ALL
      SELECT
        attachment.file_entity_link_id,
        formal_order.seller_organization_id,
        formal_order.seller_store_id,
        evidence.id AS evidence_entity_id
      FROM platform_order_evidence_internal_files attachment
      JOIN platform_formal_orders formal_order
        ON formal_order.id=attachment.platform_formal_order_id
        AND formal_order.status='CONFIRMED'
      JOIN platform_order_evidence_records evidence
        ON evidence.id=attachment.platform_order_evidence_record_id
        AND evidence.platform_order_identity_id=
          formal_order.platform_order_identity_id
        AND evidence.platform_product_identity_id=
          formal_order.platform_product_identity_id
        AND evidence.marketplace_code=formal_order.marketplace_code
        AND evidence.seller_organization_id=
          formal_order.seller_organization_id
        AND evidence.seller_store_id=formal_order.seller_store_id
        AND evidence.evidence_type=
          'ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
        AND evidence.status='VERIFIED'
    ) chat_scope ON chat_scope.file_entity_link_id=link.id
    JOIN seller_stores store
      ON store.id=chat_scope.seller_store_id
      AND store.organization_id=chat_scope.seller_organization_id
    ` : ''}
    WHERE account.id=?
      AND account.identity_subject_id=?
      AND member.id=?
      AND account.status='ACTIVE'
      AND member.status='ACTIVE'
      AND organization.status='ACTIVE'
      AND link.id=?
      AND link.authorization_mode='EXPLICIT_AUDIENCES'
      ${chatScreenshot ? `
      AND link.entity_type='ORDER_EVIDENCE_SUBMISSION'
      AND link.entity_id=chat_scope.evidence_entity_id
      AND link.purpose='ORDER_EVIDENCE_INTERNAL_COMMUNICATION'
      AND link.visibility='SELLER_VISIBLE'
      AND chat_scope.seller_organization_id=organization.id
      AND store.status='ACTIVE'
      AND (
        member.role='OWNER'
        OR EXISTS (
          SELECT 1
          FROM seller_member_store_scopes scope
          WHERE scope.member_id=member.id
            AND scope.organization_id=organization.id
            AND scope.store_id=chat_scope.seller_store_id
            AND scope.status='ACTIVE'
            AND scope.revoked_at IS NULL
        )
      )
      ` : ''}
      AND link.revoked_at IS NULL
      AND (link.expires_at IS NULL OR link.expires_at>?)
      AND grant.revoked_at IS NULL
      AND (grant.expires_at IS NULL OR grant.expires_at>?)
    LIMIT 1
  `).bind(
    accountId,
    subjectId,
    memberId,
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
  if (roles.size !== 1) return false;

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

async function activeSellerSettlementProofScopeExists(
  database: SqlDatabase,
  linkId: string,
  fileObjectId: string,
  untrustedStaffId: string,
  now: number,
): Promise<boolean> {
  const staffId = cleanFileIdentifier(untrustedStaffId, 120);
  const objectId = cleanFileIdentifier(fileObjectId, 120);
  const authority = await database.prepare(`
    SELECT
      payment.id AS payment_id,
      payment.seller_organization_id
    FROM seller_payment_proofs proof
    JOIN seller_payments payment
      ON payment.id=proof.payment_id
      AND payment.seller_organization_id=proof.seller_organization_id
    JOIN seller_organizations organization
      ON organization.id=payment.seller_organization_id
      AND organization.status='ACTIVE'
    JOIN file_objects object
      ON object.id=proof.file_object_id
      AND object.status='VERIFIED'
      AND object.purpose='SELLER_SETTLEMENT_PROOF'
      AND object.visibility='INTERNAL_ONLY'
    JOIN file_upload_intents intent
      ON intent.id=object.upload_intent_id
      AND intent.status='VERIFIED'
      AND intent.purpose='SELLER_SETTLEMENT_PROOF'
      AND intent.visibility='INTERNAL_ONLY'
    JOIN file_entity_links link
      ON link.id=proof.file_entity_link_id
      AND link.file_object_id=object.id
      AND link.entity_type='SELLER_SETTLEMENT'
      AND link.entity_id=payment.id
      AND link.purpose='SELLER_SETTLEMENT_PROOF'
      AND link.visibility='INTERNAL_ONLY'
      AND link.authorization_mode='EXPLICIT_AUDIENCES'
      AND link.revoked_at IS NULL
      AND (link.expires_at IS NULL OR link.expires_at>?)
    WHERE proof.file_entity_link_id=?
      AND proof.file_object_id=?
      AND (
        SELECT COUNT(*)
        FROM seller_payment_proofs current_proof
        WHERE current_proof.payment_id=payment.id
      )=1
    LIMIT 1
  `).bind(
    now,
    linkId,
    objectId,
  ).first<SellerSettlementProofAuthorityRow>();
  if (!authority) return false;

  const authorization = await resolveAssignmentStaffAuthorization(
    database,
    staffId,
  );
  if (!authorization
    || !authorization.permissions.has('SELLER_SETTLEMENT_VIEW')) {
    return false;
  }
  if (authorization.roles.has('owner')) return true;

  const direct = await database.prepare(`
    SELECT 1 AS allowed
    FROM seller_staff_assignments assignment
    WHERE assignment.seller_organization_id=?
      AND assignment.duty_code='SELLER_ACCOUNT_MANAGER'
      AND assignment.staff_id=?
      AND assignment.status='ACTIVE'
    LIMIT 1
  `).bind(
    authority.seller_organization_id,
    staffId,
  ).first<{ allowed: number }>();
  if (Number(direct?.allowed) === 1) return true;

  if (!authorization.permissions.has('TASK_VIEW_TEAM')
    || authorization.leaderTeamIds.length === 0) {
    return false;
  }
  const placeholders = authorization.leaderTeamIds
    .map(() => '?')
    .join(', ');
  const team = await database.prepare(`
    SELECT 1 AS allowed
    FROM seller_staff_assignments assignment
    JOIN staff_users assigned_staff
      ON assigned_staff.id=assignment.staff_id
      AND assigned_staff.status='ACTIVE'
    JOIN staff_team_memberships assignee_membership
      ON assignee_membership.staff_id=assignment.staff_id
      AND assignee_membership.status='ACTIVE'
    JOIN staff_teams team
      ON team.id=assignee_membership.team_id
      AND team.status='ACTIVE'
    JOIN staff_departments department
      ON department.id=team.department_id
      AND department.status='ACTIVE'
    WHERE assignment.seller_organization_id=?
      AND assignment.duty_code='SELLER_ACCOUNT_MANAGER'
      AND assignment.status='ACTIVE'
      AND assignee_membership.team_id IN (${placeholders})
    LIMIT 1
  `).bind(
    authority.seller_organization_id,
    ...authorization.leaderTeamIds,
  ).first<{ allowed: number }>();
  return Number(team?.allowed) === 1;
}

function isSellerSettlementProofResource(
  resource: FileAuthorizationResource,
): resource is FileAuthorizationResource & { fileObjectId: string } {
  return resource.entityType === 'SELLER_SETTLEMENT'
    && resource.purpose === 'SELLER_SETTLEMENT_PROOF'
    && resource.visibility === 'INTERNAL_ONLY'
    && typeof resource.fileObjectId === 'string';
}

function deny(): never {
  throw new FileStorageError('FORBIDDEN', 403);
}
