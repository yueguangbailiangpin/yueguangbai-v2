import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import {
  deriveOneTimeToken,
  hashCanonicalJson,
  hashCustomerPassword,
  hashOneTimeToken,
  normalizeWechatId,
  validateCustomerPassword,
  verifyCustomerPassword,
} from '@ygb/domain';
import { hashNormalizedWechat } from '../acquisition/privacy';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class SellerRegistrationError extends Error {
  constructor(
    public readonly code:
      | 'VALIDATION_ERROR'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'DEPENDENCY_UNAVAILABLE',
    public readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
  }
}

type Kind = 'NEW_CUSTOMER' | 'HISTORICAL_ACCOUNT_ONLY';
interface InvitationRow {
  id: string;
  token_hash: string;
  normalized_wechat: string;
  wechat_display: string;
  marketplace_code: string;
  acquisition_lead_id: string | null;
  seller_organization_id: string;
  seller_member_id: string | null;
  onboarding_kind: Kind;
  status: 'ACTIVE' | 'CONSUMED' | 'REVOKED' | 'EXPIRED';
  version: number;
  issued_at: number;
  expires_at: number;
  consumed_at: number | null;
  revoked_at: number | null;
  issued_by_staff_id: string;
}
interface OrgRow {
  id: string;
  seller_code: string;
  organization_name: string;
  marketplace_code: string;
  status: string;
  next_member_number: number;
}
interface MemberRow {
  id: string;
  identity_subject_id: string;
  display_name: string;
  member_number: number;
  primary_owner: number;
}
interface ExistingIdentityRow {
  claim_id: string;
  identity_subject_id: string;
  claim_status: 'ACTIVE' | 'RESERVED';
  account_id: string | null;
  account_status: string | null;
  session_version: number | null;
  algorithm: 'PBKDF2_SHA256' | null;
  iterations: number | null;
  salt_base64url: string | null;
  hash_base64url: string | null;
}
interface InvitationTarget {
  organizationId: string;
  organizationName: string;
  memberId: string | null;
  leadId: string | null;
  kind: Kind;
}

export async function issueSellerRegistrationInvitation(
  database: SqlDatabase,
  input: {
    leadId: string | null;
    sellerOrganizationId: string | null;
    wechatId: string;
    marketplaceCode: string;
  },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId: string;
    tokenSecret: string;
    now?: number;
  },
) {
  requireSellerDuty(command.actor);
  if (input.marketplaceCode !== 'AMAZON_JP')
    throw new SellerRegistrationError('VALIDATION_ERROR', 400);
  await requireStaffMarket(database, command.actor, input.marketplaceCode);
  const hasLead = input.leadId !== null && input.leadId.trim() !== '';
  const hasOrg = input.sellerOrganizationId !== null && input.sellerOrganizationId.trim() !== '';
  if (hasLead === hasOrg) throw new SellerRegistrationError('VALIDATION_ERROR', 400);
  const now = command.now ?? Date.now();
  const wechat = normalizeWechatId(input.wechatId);
  const target = hasLead
    ? await requireFormalizedNewSeller(
        database,
        input.leadId!,
        wechat.normalized,
        command.tokenSecret,
      )
    : await ensureHistoricalSellerOrganization(
        database,
        input.sellerOrganizationId!,
        wechat.normalized,
      );
  if (await hasSellerPortalAccount(database, target.organizationId))
    throw new SellerRegistrationError('CONFLICT', 409);
  await expireOldInvitation(database, target.organizationId, now);
  const requestHash = await hashCanonicalJson({
    action: 'ISSUE_SELLER_REGISTRATION_INVITATION',
    kind: target.kind,
    seller_organization_id: target.organizationId,
    seller_member_id: target.memberId,
    normalized_wechat: wechat.normalized,
  });
  const token = await deriveOneTimeToken(
    command.tokenSecret,
    'SELLER_INVITATION',
    command.actor.staffId,
    command.idempotencyKey,
    requestHash,
  );
  const tokenHash = await hashOneTimeToken(token);
  const acquired = await acquireIdempotency<any>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'ISSUE_SELLER_REGISTRATION_INVITATION',
      targetType: 'SELLER_ORGANIZATION',
      targetId: target.organizationId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY')
    return { ...acquired.response, registration_token: token, replayed: true };
  const invitationId = crypto.randomUUID();
  const expiresAt = now + INVITATION_TTL_MS;
  const safe = {
    invitation_id: invitationId,
    seller_organization_id: target.organizationId,
    seller_name: target.organizationName,
    marketplace_code: input.marketplaceCode,
    onboarding_kind: target.kind,
    wechat_id: wechat.display,
    version: 1,
    expires_at: expiresAt,
  };
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO customer_seller_invitations(
        id,token_hash,normalized_wechat,wechat_display,marketplace_code,acquisition_lead_id,
        seller_organization_id,seller_member_id,onboarding_kind,issued_by_staff_id,status,version,
        issued_at,expires_at,consumed_at,consumed_by_account_id,revoked_at,revoked_by_staff_id,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,'ACTIVE',1,?,?,NULL,NULL,NULL,NULL,?,?)`,
        )
        .bind(
          invitationId,
          tokenHash,
          wechat.normalized,
          wechat.display,
          input.marketplaceCode,
          target.leadId,
          target.organizationId,
          target.memberId,
          target.kind,
          command.actor.staffId,
          now,
          expiresAt,
          now,
          now,
        ),
      event(
        database,
        invitationId,
        'ISSUED',
        'STAFF',
        command.actor.staffId,
        command.requestId,
        command.idempotencyKey,
        now,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'CUSTOMER_SELLER_INVITATION',
        aggregateId: invitationId,
        eventType: 'SELLER_INVITATION_ISSUED',
        actor: { type: 'STAFF', id: command.actor.staffId, roles: [...command.actor.roles] },
        requestId: command.requestId,
        idempotencyKey: command.idempotencyKey,
        nextState: { ...safe, status: 'ACTIVE' },
        createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, safe, {
        resultReferences: {
          invitation_id: invitationId,
          seller_organization_id: target.organizationId,
        },
        now,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
  } catch (error) {
    await markIdempotencyFailed(database, acquired.claim, 'SELLER_INVITATION_ISSUE_FAILED', now);
    throw error;
  }
  return { ...safe, registration_token: token, replayed: false };
}

export async function readSellerInvitationForStaff(
  database: SqlDatabase,
  invitationId: string,
  actor: AssignmentStaffAuthorization,
  now = Date.now(),
) {
  requireSellerDuty(actor);
  const row = await database
    .prepare(
      `SELECT id,normalized_wechat,wechat_display,marketplace_code,acquisition_lead_id,
      seller_organization_id,seller_member_id,onboarding_kind,issued_by_staff_id,status,version,issued_at,expires_at,
      consumed_at,revoked_at FROM customer_seller_invitations WHERE id=?`,
    )
    .bind(cleanId(invitationId))
    .first<InvitationRow>();
  if (!row) throw new SellerRegistrationError('NOT_FOUND', 404);
  await requireStaffMarket(database, actor, row.marketplace_code);
  return projectInvitation(row, now);
}

export async function revokeSellerRegistrationInvitation(
  database: SqlDatabase,
  input: { invitationId: string; expectedVersion: number },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId: string;
    now?: number;
  },
) {
  requireSellerDuty(command.actor);
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1)
    throw new SellerRegistrationError('VALIDATION_ERROR', 400);
  const current = await readSellerInvitationForStaff(
    database,
    input.invitationId,
    command.actor,
    command.now ?? Date.now(),
  );
  if (current.status !== 'ACTIVE' || current.version !== input.expectedVersion)
    throw new SellerRegistrationError('CONFLICT', 409);
  const now = command.now ?? Date.now();
  const requestHash = await hashCanonicalJson({
    action: 'REVOKE_SELLER_INVITATION',
    invitation_id: input.invitationId,
    expected_version: input.expectedVersion,
  });
  const acquired = await acquireIdempotency<any>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'REVOKE_SELLER_INVITATION',
      targetType: 'SELLER_INVITATION',
      targetId: input.invitationId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') return { ...acquired.response, replayed: true };
  const safe = {
    invitation_id: input.invitationId,
    status: 'REVOKED' as const,
    version: input.expectedVersion + 1,
    revoked_at: now,
  };
  try {
    await database.batch([
      database
        .prepare(
          `UPDATE customer_seller_invitations SET status='REVOKED',version=version+1,
        revoked_at=?,revoked_by_staff_id=?,updated_at=?
        WHERE id=? AND status='ACTIVE' AND expires_at>? AND version=?`,
        )
        .bind(now, command.actor.staffId, now, input.invitationId, now, input.expectedVersion),
      event(
        database,
        input.invitationId,
        'REVOKED',
        'STAFF',
        command.actor.staffId,
        command.requestId,
        command.idempotencyKey,
        now,
      ),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'CUSTOMER_SELLER_INVITATION',
        aggregateId: input.invitationId,
        eventType: 'SELLER_INVITATION_REVOKED',
        actor: { type: 'STAFF', id: command.actor.staffId, roles: [...command.actor.roles] },
        requestId: command.requestId,
        idempotencyKey: command.idempotencyKey,
        previousState: { status: 'ACTIVE', version: input.expectedVersion },
        nextState: safe,
        createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, safe, { now }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
      database
        .prepare(
          `INSERT INTO transaction_assertions(assertion_value)
        SELECT CASE WHEN EXISTS(SELECT 1 FROM customer_seller_invitations WHERE id=? AND status='REVOKED' AND version=?)
        THEN 1 ELSE 0 END`,
        )
        .bind(input.invitationId, input.expectedVersion + 1),
    ]);
  } catch (error) {
    await markIdempotencyFailed(database, acquired.claim, 'SELLER_INVITATION_REVOKE_FAILED', now);
    throw error;
  }
  return { ...safe, replayed: false };
}

export async function readSellerInvitationContext(
  database: SqlDatabase,
  token: string,
  now = Date.now(),
) {
  const hash = await hashOneTimeToken(token);
  const row = await database
    .prepare(
      `SELECT invitation.id,invitation.normalized_wechat,invitation.wechat_display,
      invitation.marketplace_code,invitation.onboarding_kind,invitation.expires_at,organization.organization_name
    FROM customer_seller_invitations invitation
    JOIN seller_organizations organization ON organization.id=invitation.seller_organization_id
    WHERE invitation.token_hash=? AND invitation.status='ACTIVE' AND invitation.expires_at>?
      AND organization.status='ACTIVE'`,
    )
    .bind(hash, now)
    .first<any>();
  if (!row) throw new SellerRegistrationError('CONFLICT', 409);
  const identity = await loadWechatIdentity(database, String(row.normalized_wechat));
  return {
    invitation_valid: true as const,
    seller_name: String(row.organization_name),
    marketplace_code: String(row.marketplace_code),
    wechat_hint: maskWechat(String(row.wechat_display)),
    onboarding_kind: row.onboarding_kind as Kind,
    existing_moonwhite_account:
      identity?.account_id !== null && identity?.account_status === 'ACTIVE',
    expires_at: Number(row.expires_at),
  };
}

export async function completeSellerRegistration(
  database: SqlDatabase,
  input: { token: string; wechatId: string; password: string; passwordConfirmation: string },
  command: { requestId: string; idempotencyKey: string; now?: number },
) {
  if (input.password !== input.passwordConfirmation)
    throw new SellerRegistrationError('VALIDATION_ERROR', 400);
  try {
    validateCustomerPassword(input.password);
  } catch {
    throw new SellerRegistrationError('VALIDATION_ERROR', 400);
  }
  const now = command.now ?? Date.now();
  const wechat = normalizeWechatId(input.wechatId);
  const tokenHash = await hashOneTimeToken(input.token);
  const invitation = await database
    .prepare(
      `SELECT id,token_hash,normalized_wechat,wechat_display,marketplace_code,
      acquisition_lead_id,seller_organization_id,seller_member_id,onboarding_kind,status,version,issued_at,expires_at,
      consumed_at,revoked_at,issued_by_staff_id FROM customer_seller_invitations WHERE token_hash=?`,
    )
    .bind(tokenHash)
    .first<InvitationRow>();
  if (
    !invitation ||
    invitation.status !== 'ACTIVE' ||
    invitation.expires_at <= now ||
    invitation.normalized_wechat !== wechat.normalized
  )
    throw new SellerRegistrationError('CONFLICT', 409);
  if (await hasSellerPortalAccount(database, invitation.seller_organization_id))
    throw new SellerRegistrationError('CONFLICT', 409);
  const organization = await database
    .prepare(
      `SELECT id,seller_code,organization_name,marketplace_code,status,next_member_number
    FROM seller_organizations WHERE id=?`,
    )
    .bind(invitation.seller_organization_id)
    .first<OrgRow>();
  if (!organization || organization.status !== 'ACTIVE' || organization.marketplace_code !== 'AMAZON_JP')
    throw new SellerRegistrationError('CONFLICT', 409);
  const identity = await loadWechatIdentity(database, wechat.normalized);
  if (identity?.claim_status === 'RESERVED') throw new SellerRegistrationError('CONFLICT', 409);
  if (identity?.account_id !== null && identity?.account_id !== undefined) {
    if (
      identity.account_status !== 'ACTIVE' ||
      !identity.algorithm ||
      !identity.iterations ||
      !identity.salt_base64url ||
      !identity.hash_base64url
    )
      throw new SellerRegistrationError('CONFLICT', 409);
    const valid = await verifyCustomerPassword(input.password, {
      algorithm: identity.algorithm,
      iterations: Number(identity.iterations),
      saltBase64Url: identity.salt_base64url,
      hashBase64Url: identity.hash_base64url,
    });
    if (!valid) throw new SellerRegistrationError('CONFLICT', 409);
  }
  const memberPlan = await planSellerMember(
    database,
    organization,
    invitation.seller_member_id,
    wechat,
    identity,
    now,
  );
  const accountId = identity?.account_id ?? crypto.randomUUID();
  const sessionVersion = Number(identity?.session_version ?? 1);
  const needsAccount = identity?.account_id === null || identity === null;
  const credential = needsAccount ? await hashCustomerPassword(input.password) : null;
  const requestHash = await hashCanonicalJson({
    action: 'COMPLETE_SELLER_REGISTRATION',
    invitation_id: invitation.id,
    normalized_wechat: wechat.normalized,
    account_id: accountId,
    member_id: memberPlan.memberId,
    password_hash: await hashCanonicalJson(input.password),
  });
  const acquired = await acquireIdempotency<any>(
    database,
    {
      actorType: 'CUSTOMER_INVITATION',
      actorId: invitation.id,
      action: 'COMPLETE_SELLER_REGISTRATION',
      targetType: 'SELLER_INVITATION',
      targetId: invitation.id,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') return { ...acquired.response, replayed: true };
  const safe = {
    account_id: accountId,
    identity_subject_id: memberPlan.identitySubjectId,
    seller_organization_id: invitation.seller_organization_id,
    seller_member_id: memberPlan.memberId,
    session_version: sessionVersion,
    onboarding_kind: invitation.onboarding_kind,
  };
  const statements: SqlStatement[] = [...memberPlan.statements];
  if (needsAccount && credential) {
    statements.push(
      database
        .prepare(
          `INSERT INTO customer_login_accounts(
        id,identity_subject_id,account_type,login_identifier_display,login_identifier_normalized,
        status,session_version,password_change_required,version,created_at,updated_at,activated_at,disabled_at,registration_source
      ) VALUES(?,?,'SELLER_MEMBER',?,?,'ACTIVE',1,0,1,?,?,?,NULL,'SELF_REGISTRATION_CLAIM')`,
        )
        .bind(
          accountId,
          memberPlan.identitySubjectId,
          wechat.display,
          wechat.normalized,
          now,
          now,
          now,
        ),
      database
        .prepare(
          `INSERT INTO customer_password_credentials(
        account_id,algorithm,iterations,salt_base64url,hash_base64url,password_version,created_at,updated_at
      ) VALUES(?,?,?,?,?,1,?,?)`,
        )
        .bind(
          accountId,
          credential.algorithm,
          credential.iterations,
          credential.saltBase64Url,
          credential.hashBase64Url,
          now,
          now,
        ),
    );
  }
  statements.push(
    database
      .prepare(
        `INSERT OR IGNORE INTO customer_account_personas(
      account_id,identity_subject_id,persona_type,buyer_customer_id,seller_member_id,created_at
    ) VALUES(?,?,'SELLER_MEMBER',NULL,?,?)`,
      )
      .bind(accountId, memberPlan.identitySubjectId, memberPlan.memberId, now),
    database
      .prepare(
        `UPDATE customer_seller_invitations SET status='CONSUMED',version=version+1,
      seller_member_id=?,consumed_at=?,consumed_by_account_id=?,updated_at=?
      WHERE id=? AND status='ACTIVE' AND expires_at>? AND version=?`,
      )
      .bind(memberPlan.memberId, now, accountId, now, invitation.id, now, invitation.version),
    event(
      database,
      invitation.id,
      'CONSUMED',
      'CUSTOMER',
      accountId,
      command.requestId,
      command.idempotencyKey,
      now,
    ),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'SELLER_ORGANIZATION',
      aggregateId: invitation.seller_organization_id,
      eventType: 'SELLER_PORTAL_ACCOUNT_ACTIVATED',
      actor: { type: 'CUSTOMER_INVITATION', id: invitation.id, roles: [] },
      requestId: command.requestId,
      idempotencyKey: command.idempotencyKey,
      nextState: {
        account_id: accountId,
        seller_member_id: memberPlan.memberId,
        onboarding_kind: invitation.onboarding_kind,
      },
      createdAt: now,
    }),
    completeIdempotencyStatement(database, acquired.claim, safe, {
      resultReferences: {
        account_id: accountId,
        seller_organization_id: invitation.seller_organization_id,
        seller_member_id: memberPlan.memberId,
      },
      now,
    }),
    assertIdempotencyCompletionStatement(database, acquired.claim),
    database
      .prepare(
        `INSERT INTO transaction_assertions(assertion_value)
      SELECT CASE WHEN EXISTS(SELECT 1 FROM customer_login_accounts WHERE id=? AND status='ACTIVE')
        AND EXISTS(SELECT 1 FROM customer_account_personas WHERE account_id=? AND persona_type='SELLER_MEMBER' AND seller_member_id=?)
        AND EXISTS(SELECT 1 FROM seller_organization_members WHERE id=? AND organization_id=? AND status='ACTIVE')
      THEN 1 ELSE 0 END`,
      )
      .bind(
        accountId,
        accountId,
        memberPlan.memberId,
        memberPlan.memberId,
        invitation.seller_organization_id,
      ),
  );
  try {
    await database.batch(statements);
  } catch (error) {
    await markIdempotencyFailed(database, acquired.claim, 'SELLER_REGISTRATION_FAILED', now);
    throw error;
  }
  return { ...safe, replayed: false };
}

async function requireFormalizedNewSeller(
  database: SqlDatabase,
  leadId: string,
  normalizedWechat: string,
  identitySecret: string,
): Promise<InvitationTarget> {
  const lead = await database
    .prepare(
      `SELECT id,marketplace_code,status,identity_hash FROM acquisition_leads
    WHERE id=? AND lead_type='SELLER'`,
    )
    .bind(cleanId(leadId))
    .first<{
      id: string;
      marketplace_code: string;
      status: string;
      identity_hash: string | null;
    }>();
  if (!lead || lead.status !== 'ACTIVE' || lead.marketplace_code !== 'AMAZON_JP')
    throw new SellerRegistrationError('NOT_FOUND', 404);
  const expectedHash = await hashNormalizedWechat(normalizedWechat, identitySecret);
  if (lead.identity_hash === null || lead.identity_hash !== expectedHash)
    throw new SellerRegistrationError('CONFLICT', 409);
  const link = await database
    .prepare(
      `SELECT link.target_id,organization.organization_name
    FROM acquisition_lead_links link JOIN seller_organizations organization ON organization.id=link.target_id
    WHERE link.lead_id=? AND link.link_type='SELLER_ORGANIZATION' AND organization.status='ACTIVE' LIMIT 2`,
    )
    .bind(lead.id)
    .all<{ target_id: string; organization_name: string }>();
  if (link.results.length !== 1) throw new SellerRegistrationError('DEPENDENCY_UNAVAILABLE', 503);
  return ensureHistoricalSellerOrganization(
    database,
    link.results[0]!.target_id,
    normalizedWechat,
    { leadId: lead.id, kind: 'NEW_CUSTOMER' },
  );
}

async function ensureHistoricalSellerOrganization(
  database: SqlDatabase,
  organizationIdRaw: string,
  normalizedWechat: string,
  override?: { leadId: string; kind: Kind },
): Promise<InvitationTarget> {
  const organizationId = cleanId(organizationIdRaw);
  const org = await database
    .prepare(
      `SELECT id,seller_code,organization_name,marketplace_code,status,next_member_number
    FROM seller_organizations WHERE id=?`,
    )
    .bind(organizationId)
    .first<OrgRow>();
  if (!org || org.status !== 'ACTIVE' || org.marketplace_code !== 'AMAZON_JP')
    throw new SellerRegistrationError('NOT_FOUND', 404);
  const matching = await matchingSellerMember(database, organizationId, normalizedWechat);
  if (matching.length > 1) throw new SellerRegistrationError('CONFLICT', 409);
  let memberId = matching[0]?.id ?? null;
  if (memberId === null) {
    const primary = await database
      .prepare(
        `SELECT id,identity_subject_id,display_name,member_number,primary_owner
      FROM seller_organization_members WHERE organization_id=? AND primary_owner=1 AND status='ACTIVE'
      ORDER BY member_number,id LIMIT 2`,
      )
      .bind(organizationId)
      .all<MemberRow>();
    if (primary.results.length > 1) throw new SellerRegistrationError('CONFLICT', 409);
    if (primary.results.length === 1) {
      const owner = primary.results[0]!;
      const claims = await database
        .prepare(
          `SELECT normalized_wechat FROM wechat_identity_claims
        WHERE identity_subject_id=? AND status IN('ACTIVE','RESERVED')`,
        )
        .bind(owner.identity_subject_id)
        .all<{ normalized_wechat: string }>();
      if (
        claims.results.length > 1 ||
        claims.results.some((row) => row.normalized_wechat !== normalizedWechat)
      )
        throw new SellerRegistrationError('CONFLICT', 409);
      memberId = owner.id;
    }
  }
  return {
    organizationId,
    organizationName: org.organization_name,
    memberId,
    leadId: override?.leadId ?? null,
    kind: override?.kind ?? 'HISTORICAL_ACCOUNT_ONLY',
  };
}

async function planSellerMember(
  database: SqlDatabase,
  organization: OrgRow,
  invitedMemberId: string | null,
  wechat: { display: string; normalized: string },
  identity: ExistingIdentityRow | null,
  now: number,
): Promise<{ memberId: string; identitySubjectId: string; statements: SqlStatement[] }> {
  const statements: SqlStatement[] = [];
  if (invitedMemberId !== null) {
    const member = await database
      .prepare(
        `SELECT id,identity_subject_id,display_name,member_number,primary_owner
      FROM seller_organization_members WHERE id=? AND organization_id=? AND status='ACTIVE'`,
      )
      .bind(invitedMemberId, organization.id)
      .first<MemberRow>();
    if (!member) throw new SellerRegistrationError('CONFLICT', 409);
    if (identity && identity.identity_subject_id !== member.identity_subject_id)
      throw new SellerRegistrationError('CONFLICT', 409);
    const claims = await database
      .prepare(
        `SELECT normalized_wechat FROM wechat_identity_claims
      WHERE identity_subject_id=? AND status IN('ACTIVE','RESERVED')`,
      )
      .bind(member.identity_subject_id)
      .all<{ normalized_wechat: string }>();
    if (
      claims.results.length > 1 ||
      claims.results.some((row) => row.normalized_wechat !== wechat.normalized)
    )
      throw new SellerRegistrationError('CONFLICT', 409);
    if (claims.results.length === 0) {
      statements.push(
        database
          .prepare(
            `INSERT INTO wechat_identity_claims(
        id,identity_subject_id,display_wechat,normalized_wechat,status,version,acquired_at,reserved_at,released_at,
        created_at,updated_at,identity_subject_type
      ) VALUES(?,?,?,?,'ACTIVE',1,?,NULL,NULL,?,?,'SELLER_ORG_MEMBER')`,
          )
          .bind(
            crypto.randomUUID(),
            member.identity_subject_id,
            wechat.display,
            wechat.normalized,
            now,
            now,
            now,
          ),
      );
    }
    return { memberId: member.id, identitySubjectId: member.identity_subject_id, statements };
  }
  const currentPrimary = await database
    .prepare(
      `SELECT id FROM seller_organization_members
    WHERE organization_id=? AND primary_owner=1 AND status='ACTIVE' LIMIT 1`,
    )
    .bind(organization.id)
    .first();
  if (currentPrimary) throw new SellerRegistrationError('CONFLICT', 409);
  const identitySubjectId = identity?.identity_subject_id ?? crypto.randomUUID();
  if (identity === null) {
    statements.push(
      database
        .prepare(
          `INSERT INTO customer_identity_subjects(id,subject_type,created_at) VALUES(?,'SELLER_ORG_MEMBER',?)`,
        )
        .bind(identitySubjectId, now),
      database
        .prepare(
          `INSERT INTO wechat_identity_claims(
        id,identity_subject_id,display_wechat,normalized_wechat,status,version,acquired_at,reserved_at,released_at,
        created_at,updated_at,identity_subject_type
      ) VALUES(?,?,?,?,'ACTIVE',1,?,NULL,NULL,?,?,'SELLER_ORG_MEMBER')`,
        )
        .bind(
          crypto.randomUUID(),
          identitySubjectId,
          wechat.display,
          wechat.normalized,
          now,
          now,
          now,
        ),
    );
  } else {
    const sellerMembership = await database
      .prepare(
        `SELECT id FROM seller_organization_members
      WHERE identity_subject_id=? AND status='ACTIVE' LIMIT 1`,
      )
      .bind(identity.identity_subject_id)
      .first();
    if (sellerMembership) throw new SellerRegistrationError('CONFLICT', 409);
  }
  const number = Number(organization.next_member_number);
  if (!Number.isSafeInteger(number) || number < 1)
    throw new SellerRegistrationError('DEPENDENCY_UNAVAILABLE', 503);
  const memberId = crypto.randomUUID();
  statements.push(
    database
      .prepare(
        `INSERT INTO seller_organization_members(
      id,identity_subject_id,organization_id,member_number,username_fallback,display_name,role,primary_owner,status,version,
      created_at,updated_at,activated_at,disabled_at
    ) VALUES(?,?,?,?,?,?,'OWNER',1,'ACTIVE',1,?,?,?,NULL)`,
      )
      .bind(
        memberId,
        identitySubjectId,
        organization.id,
        number,
        `${organization.seller_code}-owner-${number}`,
        organization.organization_name.slice(0, 100),
        now,
        now,
        now,
      ),
    database
      .prepare(
        `UPDATE seller_organizations SET next_member_number=next_member_number+1,version=version+1,updated_at=?
      WHERE id=? AND next_member_number=?`,
      )
      .bind(now, organization.id, number),
  );
  return { memberId, identitySubjectId, statements };
}

async function loadWechatIdentity(
  database: SqlDatabase,
  normalizedWechat: string,
): Promise<ExistingIdentityRow | null> {
  const rows = await database
    .prepare(
      `SELECT claim.id AS claim_id,claim.identity_subject_id,claim.status AS claim_status,
      account.id AS account_id,account.status AS account_status,account.session_version,
      credential.algorithm,credential.iterations,credential.salt_base64url,credential.hash_base64url
    FROM wechat_identity_claims claim
    LEFT JOIN customer_login_accounts account ON account.identity_subject_id=claim.identity_subject_id
    LEFT JOIN customer_password_credentials credential ON credential.account_id=account.id
    WHERE claim.normalized_wechat=? AND claim.status IN('ACTIVE','RESERVED')`,
    )
    .bind(normalizedWechat)
    .all<ExistingIdentityRow>();
  if (rows.results.length > 1) throw new SellerRegistrationError('CONFLICT', 409);
  return rows.results[0] ?? null;
}
async function matchingSellerMember(
  database: SqlDatabase,
  organizationId: string,
  normalizedWechat: string,
): Promise<MemberRow[]> {
  const rows = await database
    .prepare(
      `SELECT member.id,member.identity_subject_id,member.display_name,member.member_number,member.primary_owner
    FROM seller_organization_members member JOIN wechat_identity_claims claim ON claim.identity_subject_id=member.identity_subject_id
    WHERE member.organization_id=? AND member.status='ACTIVE' AND claim.status='ACTIVE' AND claim.normalized_wechat=?
    ORDER BY member.primary_owner DESC,member.member_number,member.id`,
    )
    .bind(organizationId, normalizedWechat)
    .all<MemberRow>();
  return rows.results;
}
async function hasSellerPortalAccount(
  database: SqlDatabase,
  organizationId: string,
): Promise<boolean> {
  const row = await database
    .prepare(
      `SELECT account.id FROM seller_organization_members member
    JOIN customer_account_personas persona ON persona.seller_member_id=member.id AND persona.persona_type='SELLER_MEMBER'
    JOIN customer_login_accounts account ON account.id=persona.account_id
    WHERE member.organization_id=? AND member.status='ACTIVE' AND account.status='ACTIVE' LIMIT 1`,
    )
    .bind(organizationId)
    .first();
  return Boolean(row);
}
async function expireOldInvitation(database: SqlDatabase, organizationId: string, now: number) {
  const rows = await database
    .prepare(
      `SELECT id FROM customer_seller_invitations
    WHERE seller_organization_id=? AND status='ACTIVE' AND expires_at<=?`,
    )
    .bind(organizationId, now)
    .all<{ id: string }>();
  for (const row of rows.results) {
    await database.batch([
      database
        .prepare(
          `UPDATE customer_seller_invitations SET status='EXPIRED',version=version+1,updated_at=? WHERE id=? AND status='ACTIVE'`,
        )
        .bind(now, row.id),
      event(database, row.id, 'EXPIRED', 'SYSTEM', null, null, null, now),
    ]);
  }
  const active = await database
    .prepare(
      `SELECT id FROM customer_seller_invitations WHERE seller_organization_id=? AND status='ACTIVE' LIMIT 1`,
    )
    .bind(organizationId)
    .first();
  if (active) throw new SellerRegistrationError('CONFLICT', 409);
}
function projectInvitation(row: InvitationRow, now: number) {
  const status = row.status === 'ACTIVE' && row.expires_at <= now ? 'EXPIRED' : row.status;
  return Object.freeze({
    invitation_id: row.id,
    wechat_id: row.wechat_display,
    marketplace_code: row.marketplace_code,
    seller_organization_id: row.seller_organization_id,
    seller_member_id: row.seller_member_id,
    onboarding_kind: row.onboarding_kind,
    issued_by_staff_id: row.issued_by_staff_id,
    status,
    version: Number(row.version),
    issued_at: Number(row.issued_at),
    expires_at: Number(row.expires_at),
    consumed_at: row.consumed_at === null ? null : Number(row.consumed_at),
    revoked_at: row.revoked_at === null ? null : Number(row.revoked_at),
  });
}
function event(
  database: SqlDatabase,
  id: string,
  type: 'ISSUED' | 'CONSUMED' | 'REVOKED' | 'EXPIRED',
  actorType: 'STAFF' | 'CUSTOMER' | 'SYSTEM',
  actorId: string | null,
  requestId: string | null,
  key: string | null,
  now: number,
) {
  return database
    .prepare(
      `INSERT INTO customer_seller_invitation_events(
    id,invitation_id,event_type,actor_type,actor_id,request_id,idempotency_key,created_at
  ) VALUES(?,?,?,?,?,?,?,?)`,
    )
    .bind(crypto.randomUUID(), id, type, actorType, actorId, requestId, key, now);
}
function requireSellerDuty(actor: AssignmentStaffAuthorization) {
  if (
    (!actor.roles.has('owner') && !actor.roles.has('seller_ops')) ||
    !actor.permissions.has('SELLER_MANAGE')
  )
    throw new SellerRegistrationError('FORBIDDEN', 403);
}
async function requireStaffMarket(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  market: string,
) {
  if (actor.roles.has('owner')) return;
  const markets = await resolveStaffMarketplaceCodes(database, actor);
  if (!markets.includes(market)) throw new SellerRegistrationError('FORBIDDEN', 403);
}
function cleanId(value: string) {
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1 || normalized.length > 200 || /[\u0000-\u001f\u007f]/u.test(normalized))
    throw new SellerRegistrationError('VALIDATION_ERROR', 400);
  return normalized;
}
function maskWechat(value: string) {
  if (value.length <= 4) return '***';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}
