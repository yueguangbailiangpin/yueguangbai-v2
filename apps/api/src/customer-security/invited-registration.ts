import type {
  BuyerSupportedMarketplaceCode,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import {
  hashCanonicalJson,
  hashCustomerPassword,
  hashOneTimeToken,
  normalizeWechatId,
  validateCustomerPassword,
  verifyCustomerPassword,
} from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import { CustomerSecurityError } from './errors';

interface InvitationRow {
  id: string;
  token_hash: string;
  normalized_wechat: string;
  wechat_display: string;
  marketplace_code: BuyerSupportedMarketplaceCode;
  status: string;
  version: number;
  expires_at: number;
}

interface IdentityRow {
  claim_id: string;
  identity_subject_id: string;
  claim_status: string;
  buyer_customer_id: string | null;
  buyer_access_status: string | null;
  buyer_identity_review_status: string | null;
  buyer_customer_no: string | null;
  buyer_marketplace_code: string | null;
  account_id: string | null;
  account_status: string | null;
  account_session_version: number | null;
  account_version: number | null;
  algorithm: 'PBKDF2_SHA256' | null;
  iterations: number | null;
  salt_base64url: string | null;
  hash_base64url: string | null;
  seller_member_id: string | null;
  seller_member_status: string | null;
  seller_organization_status: string | null;
}

export interface InvitedRegistrationResult {
  buyerNumber: string | null;
  wechatDisplay: string;
  authenticated: {
    accountId: string;
    identitySubjectId: string;
    accountType: 'BUYER';
    availablePersonas: readonly ('BUYER' | 'SELLER_MEMBER')[];
    sessionVersion: number;
    passwordChangeRequired: false;
  };
  replayed: boolean;
}

type InvitedRegistrationSafeResult = Omit<InvitedRegistrationResult, 'replayed'>;

export async function readInvitationContext(
  database: SqlDatabase,
  token: string,
  now = Date.now(),
) {
  const hash = await hashOneTimeToken(token);
  const row = await database.prepare(`
    SELECT invitation.id, invitation.marketplace_code,
      invitation.wechat_display, invitation.expires_at,
      marketplace.display_name_zh
    FROM customer_buyer_invitations invitation
    JOIN marketplace_registry marketplace
      ON marketplace.code=invitation.marketplace_code
    WHERE invitation.token_hash=? AND invitation.status='ACTIVE'
      AND invitation.expires_at>?
      AND marketplace.status='ACTIVE' AND marketplace.adapter_status='AVAILABLE'
  `).bind(hash, now).first<any>();
  if (!row) throw new CustomerSecurityError('CONFLICT', 409);
  return {
    invitation_valid: true as const,
    marketplace_code: row.marketplace_code,
    marketplace_name: row.display_name_zh,
    wechat_hint: maskWechat(row.wechat_display),
    expires_at: Number(row.expires_at),
  };
}

export async function registerInvitedBuyer(
  database: SqlDatabase,
  input: {
    invitationToken: string;
    wechatId: string;
    marketplaceCode: BuyerSupportedMarketplaceCode;
    password: string;
    passwordConfirmation: string;
    buyerChannelId: string;
  },
  command: {
    idempotencyKey: string;
    requestId: string;
    sessionId: string;
    sessionExpiresAt: number;
    networkSourceHash: string;
    deviceHash: string;
    now?: number;
  },
): Promise<InvitedRegistrationResult> {
  if (input.password !== input.passwordConfirmation) throw validation();
  try { validateCustomerPassword(input.password); }
  catch { throw validation(); }
  const now = command.now ?? Date.now();
  const tokenHash = await hashOneTimeToken(input.invitationToken);
  const wechat = normalizeWechatId(input.wechatId);
  const invitation = await database.prepare(`
    SELECT id, token_hash, normalized_wechat, wechat_display,
      marketplace_code, status, version, expires_at
    FROM customer_buyer_invitations WHERE token_hash=?
  `).bind(tokenHash).first<InvitationRow>();
  if (!invitation) {
    throw new CustomerSecurityError('CONFLICT', 409);
  }

  const requestHash = await hashCanonicalJson({
    action: 'REGISTER_INVITED_BUYER', token_hash: tokenHash,
    normalized_wechat: wechat.normalized,
    marketplace_code: input.marketplaceCode,
    password_hash: await hashCanonicalJson(input.password),
  });
  const acquired = await acquireIdempotency<InvitedRegistrationSafeResult>(database, {
    actorType: 'BUYER_INVITATION', actorId: tokenHash,
    action: 'REGISTER_INVITED_BUYER', targetType: 'BUYER_INVITATION',
    targetId: invitation.id, idempotencyKey: command.idempotencyKey,
    requestHash,
  }, { now });
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  if (invitation.status !== 'ACTIVE'
    || Number(invitation.expires_at) <= now
    || invitation.normalized_wechat !== wechat.normalized
    || invitation.marketplace_code !== input.marketplaceCode) {
    await rejectRegistration(database, invitation, acquired.claim, command,
      'INVITATION_INVALID_OR_BINDING_MISMATCH', tokenHash, now);
    throw new CustomerSecurityError('CONFLICT', 409);
  }

  let identity: IdentityRow | null;
  try {
    identity = await loadIdentity(database, wechat.normalized);
  } catch (error) {
    await rejectRegistration(database, invitation, acquired.claim, command,
      'IDENTITY_CONFLICT', tokenHash, now);
    throw error;
  }
  if (identity && identity.claim_status !== 'ACTIVE') {
    await rejectRegistration(database, invitation, acquired.claim, command,
      'IDENTITY_CONFLICT', tokenHash, now);
    throw new CustomerSecurityError('CONFLICT', 409);
  }
  if (identity?.buyer_customer_id
    && (identity.buyer_identity_review_status !== 'CLEAR'
      || (identity.buyer_marketplace_code !== invitation.marketplace_code))) {
    await rejectRegistration(database, invitation, acquired.claim, command,
      'BUYER_PERSONA_CONFLICT', tokenHash, now);
    throw new CustomerSecurityError('CONFLICT', 409);
  }
  if (identity?.buyer_customer_id
    && identity.buyer_access_status !== 'ACTIVE') {
    await rejectRegistration(database, invitation, acquired.claim, command,
      'BUYER_PERSONA_NOT_ACTIVE', tokenHash, now);
    throw new CustomerSecurityError('CONFLICT', 409);
  }
  if (identity?.account_id && identity.account_status !== 'ACTIVE') {
    await rejectRegistration(database, invitation, acquired.claim, command,
      'ACCOUNT_NOT_ACTIVE', tokenHash, now);
    throw new CustomerSecurityError('CONFLICT', 409);
  }
  if (identity?.account_id && identity.buyer_customer_id) {
    await rejectRegistration(database, invitation, acquired.claim, command,
      'BUYER_PERSONA_ALREADY_EXISTS', tokenHash, now);
    throw new CustomerSecurityError('CONFLICT', 409);
  }
  if (identity?.account_id) {
    if (!identity.algorithm || !identity.iterations || !identity.salt_base64url
      || !identity.hash_base64url) {
      await rejectRegistration(database, invitation, acquired.claim, command,
        'ACCOUNT_CREDENTIAL_UNAVAILABLE', tokenHash, now);
      throw new CustomerSecurityError('CONFLICT', 409);
    }
    const valid = await verifyCustomerPassword(input.password, {
      algorithm: identity.algorithm,
      iterations: Number(identity.iterations),
      saltBase64Url: identity.salt_base64url,
      hashBase64Url: identity.hash_base64url,
    });
    if (!valid) {
      await rejectRegistration(database, invitation, acquired.claim, command,
        'ACCOUNT_CREDENTIAL_MISMATCH', tokenHash, now);
      throw new CustomerSecurityError('CONFLICT', 409);
    }
  }
  if (identity && !identity.account_id && !identity.buyer_customer_id) {
    await rejectRegistration(database, invitation, acquired.claim, command,
      'IDENTITY_CONFLICT', tokenHash, now);
    throw new CustomerSecurityError('CONFLICT', 409);
  }

  const needsSubject = identity === null;
  const needsBuyer = !identity?.buyer_customer_id;
  const needsAccount = !identity?.account_id;
  const identitySubjectId = identity?.identity_subject_id ?? crypto.randomUUID();
  const buyerCustomerId = identity?.buyer_customer_id ?? crypto.randomUUID();
  const accountId = identity?.account_id ?? crypto.randomUUID();
  const credential = needsAccount
    ? await hashCustomerPassword(input.password)
    : null;
  const availablePersonas: ('BUYER' | 'SELLER_MEMBER')[] = [
    'BUYER',
    ...(identity?.seller_member_id
      && identity.seller_member_status === 'ACTIVE'
      && identity.seller_organization_status === 'ACTIVE'
      ? ['SELLER_MEMBER' as const]
      : []),
  ];
  const addsSecondPersona = Boolean(identity?.account_id && needsBuyer
    && await database.prepare(`
      SELECT 1 AS present FROM customer_account_personas
      WHERE account_id=? AND persona_type<>'BUYER' LIMIT 1
    `).bind(accountId).first<{ present: number }>());
  // Migration 0062 revokes older devices in the same transaction when this
  // Buyer persona is inserted. The current registration response and issuance
  // must use that committed version, otherwise the newly issued cookie is
  // invalid before it reaches the browser.
  const sessionVersion = Number(identity?.account_session_version ?? 1)
    + (addsSecondPersona ? 1 : 0);
  const safeResult = {
    buyerNumber: identity?.buyer_customer_no ?? null,
    wechatDisplay: wechat.display,
    authenticated: {
      accountId,
      identitySubjectId,
      accountType: 'BUYER' as const,
      availablePersonas,
      sessionVersion,
      passwordChangeRequired: false as const,
    },
  };
  const statements: SqlStatement[] = [];
  if (needsSubject) {
    const claimId = crypto.randomUUID();
    statements.push(
      database.prepare(`
        INSERT INTO customer_identity_subjects (id, subject_type, created_at)
        VALUES (?, 'BUYER_CUSTOMER', ?)
      `).bind(identitySubjectId, now),
      database.prepare(`
        INSERT INTO wechat_identity_claims (
          id, identity_subject_id, display_wechat, normalized_wechat,
          status, version, acquired_at, reserved_at, released_at,
          created_at, updated_at, identity_subject_type
        ) VALUES (?, ?, ?, ?, 'ACTIVE', 1, ?, NULL, NULL, ?, ?, 'BUYER_CUSTOMER')
      `).bind(claimId, identitySubjectId, wechat.display,
        wechat.normalized, now, now, now),
      database.prepare(`
        INSERT INTO customer_identity_claim_events (
          id, claim_id, identity_subject_id, event_type, previous_status,
          next_status, actor_type, actor_id, reason, idempotency_key, created_at
        ) VALUES (?, ?, ?, 'CLAIMED', NULL, 'ACTIVE',
          'CUSTOMER_INVITATION', NULL, NULL, ?, ?)
      `).bind(crypto.randomUUID(), claimId, identitySubjectId,
        command.idempotencyKey, now),
    );
  }
  if (needsBuyer) {
    statements.push(
      database.prepare(`
        INSERT INTO buyer_customers (
          id, identity_subject_id, marketplace_code, buyer_channel_id,
          buyer_customer_no, buyer_sequence, first_valid_order_business_date,
          display_name, access_status, identity_review_status,
          version, created_at, updated_at, activated_at, disabled_at
        ) VALUES (?, ?, 'JP', ?, NULL, NULL, NULL, ?, 'ACTIVE', 'CLEAR',
          1, ?, ?, ?, NULL)
      `).bind(buyerCustomerId, identitySubjectId, input.buyerChannelId,
        wechat.display.slice(0, 100), now, now, now),
      database.prepare(`
        UPDATE buyer_marketplace_assignments
        SET marketplace_code=?, version=version+1, updated_at=?
        WHERE buyer_customer_id=? AND marketplace_code='AMAZON_JP'
      `).bind(invitation.marketplace_code, now, buyerCustomerId),
    );
  }
  if (needsAccount && credential) {
    statements.push(
      database.prepare(`
        INSERT INTO customer_login_accounts (
          id, identity_subject_id, account_type,
          login_identifier_display, login_identifier_normalized,
          status, session_version, password_change_required,
          version, created_at, updated_at, activated_at, disabled_at,
          registration_source
        ) VALUES (?, ?, 'BUYER', ?, ?, 'ACTIVE', 1, 0,
          1, ?, ?, ?, NULL, 'SELF_REGISTRATION_CLAIM')
      `).bind(accountId, identitySubjectId, wechat.display,
        wechat.normalized, now, now, now),
      database.prepare(`
        INSERT INTO customer_password_credentials (
          account_id, algorithm, iterations, salt_base64url, hash_base64url,
          password_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `).bind(accountId, credential.algorithm, credential.iterations,
        credential.saltBase64Url, credential.hashBase64Url, now, now),
    );
  }
  statements.push(
    database.prepare(`
      UPDATE customer_buyer_invitations
      SET status='CONSUMED', version=version+1, consumed_at=?,
        consumed_by_account_id=?, updated_at=?
      WHERE id=? AND token_hash=? AND normalized_wechat=?
        AND marketplace_code=? AND status='ACTIVE' AND expires_at>?
        AND version=?
    `).bind(now, accountId, now, invitation.id, tokenHash,
      wechat.normalized, invitation.marketplace_code, now, invitation.version),
    database.prepare(`
      INSERT INTO customer_buyer_invitation_events (
        id, invitation_id, event_type, outcome, actor_type, actor_id,
        reason_code, request_id, idempotency_key, token_hash,
        metadata_json, created_at
      ) VALUES (?, ?, 'CONSUMED', 'SUCCESS', 'CUSTOMER', ?, NULL,
        ?, ?, ?, '{}', ?)
    `).bind(crypto.randomUUID(), invitation.id, accountId,
      command.requestId, command.idempotencyKey, tokenHash, now),
    database.prepare(`
      INSERT INTO buyer_registration_session_issuances (
        id, account_id, session_version, request_id,
        network_source_hash, device_hash, issued_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(command.sessionId, accountId, sessionVersion,
      command.requestId, command.networkSourceHash, command.deviceHash,
      now, command.sessionExpiresAt),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(), aggregateType: 'BUYER_CUSTOMER',
      aggregateId: buyerCustomerId, eventType: 'INVITED_BUYER_REGISTERED',
      actor: { type: 'CUSTOMER_INVITATION', id: invitation.id, roles: [] },
      requestId: command.requestId, idempotencyKey: command.idempotencyKey,
      previousState: needsBuyer ? null : { buyer_access_status:
        identity?.buyer_access_status },
      nextState: { account_id: accountId, identity_subject_id: identitySubjectId,
        marketplace_code: invitation.marketplace_code,
        available_personas: availablePersonas,
        invitation_consumed: true }, createdAt: now,
    }),
    completeIdempotencyStatement(database, acquired.claim, safeResult, {
      resultReferences: { invitation_id: invitation.id,
        buyer_customer_id: buyerCustomerId, account_id: accountId }, now,
    }),
    assertIdempotencyCompletionStatement(database, acquired.claim),
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM customer_buyer_invitations
        WHERE id=? AND status='CONSUMED' AND consumed_by_account_id=?
          AND version=?
      ) AND EXISTS (
        SELECT 1 FROM customer_account_personas
        WHERE account_id=? AND identity_subject_id=?
          AND persona_type='BUYER' AND buyer_customer_id=?
      ) AND EXISTS (
        SELECT 1 FROM buyer_marketplace_assignments
        WHERE buyer_customer_id=? AND marketplace_code=?
      ) THEN 1 ELSE 0 END
    `).bind(invitation.id, accountId, Number(invitation.version) + 1,
      accountId, identitySubjectId, buyerCustomerId, buyerCustomerId,
      invitation.marketplace_code),
  );
  try {
    await database.batch(statements);
  } catch (error) {
    await rejectRegistration(database, invitation, acquired.claim, command,
      'CONCURRENT_OR_TRANSACTION_CONFLICT', tokenHash, now);
    throw error;
  }
  return { ...safeResult, replayed: false };
}

async function rejectRegistration(
  database: SqlDatabase,
  invitation: InvitationRow,
  claim: Parameters<typeof markIdempotencyFailed>[1],
  command: Pick<Parameters<typeof registerInvitedBuyer>[2],
    'requestId' | 'idempotencyKey'>,
  reasonCode: string,
  tokenHash: string,
  now: number,
) {
  await database.prepare(`
    INSERT INTO customer_buyer_invitation_events (
      id, invitation_id, event_type, outcome, actor_type, actor_id,
      reason_code, request_id, idempotency_key, token_hash,
      metadata_json, created_at
    ) VALUES (?, ?, 'REJECTED', 'FAILURE', 'CUSTOMER', NULL,
      ?, ?, ?, ?, '{}', ?)
  `).bind(crypto.randomUUID(), invitation.id, reasonCode,
    command.requestId, command.idempotencyKey, tokenHash, now).run();
  await markIdempotencyFailed(database, claim,
    'INVITED_REGISTRATION_FAILED', now);
}

async function loadIdentity(
  database: SqlDatabase,
  normalizedWechat: string,
): Promise<IdentityRow | null> {
  const rows = await database.prepare(`
    SELECT claim.id AS claim_id, claim.identity_subject_id,
      claim.status AS claim_status,
      buyer.id AS buyer_customer_id,
      buyer.access_status AS buyer_access_status,
      buyer.identity_review_status AS buyer_identity_review_status,
      buyer.buyer_customer_no,
      assignment.marketplace_code AS buyer_marketplace_code,
      account.id AS account_id, account.status AS account_status,
      account.session_version AS account_session_version,
      account.version AS account_version,
      credential.algorithm, credential.iterations,
      credential.salt_base64url, credential.hash_base64url,
      member.id AS seller_member_id, member.status AS seller_member_status,
      organization.status AS seller_organization_status
    FROM wechat_identity_claims claim
    LEFT JOIN buyer_customers buyer
      ON buyer.identity_subject_id=claim.identity_subject_id
    LEFT JOIN buyer_marketplace_assignments assignment
      ON assignment.buyer_customer_id=buyer.id
    LEFT JOIN customer_login_accounts account
      ON account.identity_subject_id=claim.identity_subject_id
    LEFT JOIN customer_password_credentials credential
      ON credential.account_id=account.id
    LEFT JOIN seller_organization_members member
      ON member.identity_subject_id=claim.identity_subject_id
    LEFT JOIN seller_organizations organization
      ON organization.id=member.organization_id
    WHERE claim.normalized_wechat=? AND claim.status IN ('ACTIVE','RESERVED')
  `).bind(normalizedWechat).all<IdentityRow>();
  if (rows.results.length > 1) throw new CustomerSecurityError('CONFLICT', 409);
  return rows.results[0] ?? null;
}

function maskWechat(value: string): string {
  const chars = [...value];
  if (chars.length <= 4) return `${chars[0] ?? '*'}***`;
  return `${chars.slice(0, 2).join('')}***${chars.slice(-2).join('')}`;
}

function validation() {
  return new CustomerSecurityError('VALIDATION_ERROR', 400);
}
