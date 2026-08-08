import type {
  CanonicalMarketplaceCode,
  SqlDatabase,
  SqlStatement,
  StaffBuyerInvitationView,
} from '@ygb/contracts';
import {
  canonicalJson,
  deriveOneTimeToken,
  hashCanonicalJson,
  hashCustomerPassword,
  hashOneTimeToken,
  validateCustomerPassword,
  normalizeWechatId,
} from '@ygb/domain';
import { registrationPrivacyHash } from '../buyer-self-registration/privacy-hash';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { CustomerSecurityError } from './errors';

export const BUYER_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

interface InvitationSafeResult {
  invitation_id: string;
  wechat_id: string;
  marketplace_code: CanonicalMarketplaceCode;
  version: number;
  expires_at: number;
}

export async function issueBuyerInvitation(
  database: SqlDatabase,
  input: { wechatId: string; marketplaceCode: CanonicalMarketplaceCode },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId: string;
    tokenSecret: string;
    now?: number;
  },
) {
  requireActiveStaff(command.actor);
  const now = command.now ?? Date.now();
  const wechat = normalizeWechatId(input.wechatId);
  await requireActiveMarketplace(database, input.marketplaceCode);
  const requestHash = await hashCanonicalJson({
    action: 'ISSUE_BUYER_INVITATION',
    normalized_wechat: wechat.normalized,
    marketplace_code: input.marketplaceCode,
  });
  const token = await deriveOneTimeToken(
    command.tokenSecret,
    'BUYER_INVITATION',
    command.actor.staffId,
    command.idempotencyKey,
    requestHash,
  );
  const tokenHash = await hashOneTimeToken(token);
  const acquired = await acquireIdempotency<InvitationSafeResult>(database, {
    actorType: 'STAFF',
    actorId: command.actor.staffId,
    action: 'ISSUE_BUYER_INVITATION',
    targetType: 'WECHAT_MARKETPLACE',
    targetId: `${wechat.normalized}:${input.marketplaceCode}`,
    idempotencyKey: command.idempotencyKey,
    requestHash,
  }, { now });
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, registration_token: token, replayed: true };
  }

  const invitationId = crypto.randomUUID();
  const expiresAt = now + BUYER_INVITATION_TTL_MS;
  const safe: InvitationSafeResult = {
    invitation_id: invitationId,
    wechat_id: wechat.display,
    marketplace_code: input.marketplaceCode,
    version: 1,
    expires_at: expiresAt,
  };
  try {
    await database.batch([
      database.prepare(`
        INSERT INTO customer_buyer_invitations (
          id, token_hash, wechat_display, normalized_wechat, wechat_hash,
          marketplace_code, issued_by_staff_id, status, version,
          issued_at, expires_at, consumed_at, consumed_by_account_id,
          revoked_at, revoked_by_staff_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?, NULL, NULL,
          NULL, NULL, ?, ?)
      `).bind(
        invitationId,
        tokenHash,
        wechat.display,
        wechat.normalized,
        await registrationPrivacyHash(
          command.tokenSecret, 'WECHAT_ID', wechat.normalized,
        ),
        input.marketplaceCode,
        command.actor.staffId,
        now,
        expiresAt,
        now,
        now,
      ),
      invitationEvent(database, {
        invitationId,
        type: 'ISSUED',
        outcome: 'SUCCESS',
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        reason: null,
        requestId: command.requestId,
        idempotencyKey: command.idempotencyKey,
        tokenHash,
        now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'CUSTOMER_BUYER_INVITATION',
        aggregateId: invitationId,
        eventType: 'BUYER_INVITATION_ISSUED',
        actor: staffAuditActor(command.actor),
        requestId: command.requestId,
        idempotencyKey: command.idempotencyKey,
        nextState: {
          status: 'ACTIVE',
          marketplace_code: input.marketplaceCode,
          expires_at: expiresAt,
        },
        metadata: { wechat_hash: await registrationPrivacyHash(
          command.tokenSecret, 'WECHAT_ID', wechat.normalized,
        ) },
        createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, safe, {
        resultReferences: { invitation_id: invitationId },
        now,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
  } catch (error) {
    await markIdempotencyFailed(database, acquired.claim, 'ISSUE_FAILED', now);
    throw error;
  }
  return { ...safe, registration_token: token, replayed: false };
}

export async function readBuyerInvitation(
  database: SqlDatabase,
  invitationId: string,
  now = Date.now(),
): Promise<StaffBuyerInvitationView> {
  const row = await database.prepare(`
    SELECT id, wechat_display, marketplace_code, issued_by_staff_id,
      status, version, issued_at, expires_at, consumed_at, revoked_at
    FROM customer_buyer_invitations WHERE id=?
  `).bind(cleanId(invitationId)).first<any>();
  if (!row) throw new CustomerSecurityError('NOT_FOUND', 404);
  return {
    invitation_id: row.id,
    wechat_id: row.wechat_display,
    marketplace_code: row.marketplace_code,
    issued_by_staff_id: row.issued_by_staff_id,
    status: row.status === 'ACTIVE' && Number(row.expires_at) <= now
      ? 'EXPIRED'
      : row.status,
    version: Number(row.version),
    issued_at: Number(row.issued_at),
    expires_at: Number(row.expires_at),
    consumed_at: row.consumed_at === null ? null : Number(row.consumed_at),
    revoked_at: row.revoked_at === null ? null : Number(row.revoked_at),
  };
}

export async function revokeBuyerInvitation(
  database: SqlDatabase,
  input: { invitationId: string; expectedVersion: number },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId: string;
    now?: number;
  },
) {
  requireActiveStaff(command.actor);
  const now = command.now ?? Date.now();
  const invitationId = cleanId(input.invitationId);
  validateExpectedVersion(input.expectedVersion);
  const requestHash = await hashCanonicalJson({
    action: 'REVOKE_BUYER_INVITATION',
    invitation_id: invitationId,
    expected_version: input.expectedVersion,
  });
  const acquired = await acquireIdempotency<any>(database, {
    actorType: 'STAFF', actorId: command.actor.staffId,
    action: 'REVOKE_BUYER_INVITATION', targetType: 'BUYER_INVITATION',
    targetId: invitationId, idempotencyKey: command.idempotencyKey, requestHash,
  }, { now });
  if (acquired.kind === 'REPLAY') return { ...acquired.response, replayed: true };
  const result = {
    invitation_id: invitationId,
    status: 'REVOKED' as const,
    version: input.expectedVersion + 1,
    revoked_at: now,
  };
  try {
    await database.batch([
      database.prepare(`
        UPDATE customer_buyer_invitations
        SET status='REVOKED', version=version+1, revoked_at=?,
          revoked_by_staff_id=?, updated_at=?
        WHERE id=? AND status='ACTIVE' AND expires_at>?
          AND version=?
      `).bind(now, command.actor.staffId, now, invitationId, now,
        input.expectedVersion),
      database.prepare(`
        INSERT INTO customer_buyer_invitation_events (
          id, invitation_id, event_type, outcome, actor_type, actor_id,
          reason_code, request_id, idempotency_key, token_hash,
          metadata_json, created_at
        ) SELECT ?, ?, 'REVOKED', 'SUCCESS', 'STAFF', ?, NULL, ?, ?, NULL,
          '{}', ? WHERE EXISTS (
            SELECT 1 FROM customer_buyer_invitations
            WHERE id=? AND status='REVOKED' AND version=?
          )
      `).bind(crypto.randomUUID(), invitationId, command.actor.staffId,
        command.requestId, command.idempotencyKey, now, invitationId,
        input.expectedVersion + 1),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(), aggregateType: 'CUSTOMER_BUYER_INVITATION',
        aggregateId: invitationId, eventType: 'BUYER_INVITATION_REVOKED',
        actor: staffAuditActor(command.actor), requestId: command.requestId,
        idempotencyKey: command.idempotencyKey,
        previousState: { status: 'ACTIVE', version: input.expectedVersion },
        nextState: result, createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, result, { now }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM customer_buyer_invitations
          WHERE id=? AND status='REVOKED' AND version=?
        ) THEN 1 ELSE 0 END
      `).bind(invitationId, input.expectedVersion + 1),
    ]);
  } catch (error) {
    await markIdempotencyFailed(database, acquired.claim, 'REVOKE_FAILED', now);
    throw error;
  }
  return { ...result, replayed: false };
}

interface PasswordResetSafeResult {
  reset_id: string;
  expires_at: number;
}

export async function issuePasswordReset(
  database: SqlDatabase,
  input: {
    wechatId: string;
    manualVerificationConfirmed: boolean;
    verificationNote: string;
  },
  command: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestId: string;
    tokenSecret: string;
    now?: number;
  },
) {
  requireActiveStaff(command.actor);
  if (!input.manualVerificationConfirmed
    || input.verificationNote.trim().length < 8
    || input.verificationNote.trim().length > 1000) {
    throw new CustomerSecurityError('VALIDATION_ERROR', 400);
  }
  const now = command.now ?? Date.now();
  const wechat = normalizeWechatId(input.wechatId);
  const account = await database.prepare(`
    SELECT account.id AS account_id, account.identity_subject_id
    FROM wechat_identity_claims claim
    JOIN customer_login_accounts account
      ON account.identity_subject_id=claim.identity_subject_id
    WHERE claim.normalized_wechat=? AND claim.status='ACTIVE'
      AND account.status='ACTIVE'
  `).bind(wechat.normalized).first<{
    account_id: string; identity_subject_id: string;
  }>();
  if (!account) throw new CustomerSecurityError('NOT_FOUND', 404);
  const requestHash = await hashCanonicalJson({
    action: 'ISSUE_CUSTOMER_PASSWORD_RESET',
    account_id: account.account_id,
    verification_note: input.verificationNote.trim(),
  });
  const token = await deriveOneTimeToken(
    command.tokenSecret, 'PASSWORD_RESET', command.actor.staffId,
    command.idempotencyKey, requestHash,
  );
  const tokenHash = await hashOneTimeToken(token);
  const acquired = await acquireIdempotency<PasswordResetSafeResult>(database, {
    actorType: 'STAFF', actorId: command.actor.staffId,
    action: 'ISSUE_CUSTOMER_PASSWORD_RESET', targetType: 'CUSTOMER_LOGIN_ACCOUNT',
    targetId: account.account_id, idempotencyKey: command.idempotencyKey,
    requestHash,
  }, { now });
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, reset_token: token, replayed: true };
  }
  const resetId = crypto.randomUUID();
  const expiresAt = now + PASSWORD_RESET_TTL_MS;
  const safe = { reset_id: resetId, expires_at: expiresAt };
  const wechatHash = await registrationPrivacyHash(
    command.tokenSecret, 'WECHAT_ID', wechat.normalized,
  );
  try {
    await database.batch([
      database.prepare(`
        INSERT INTO customer_password_reset_events (
          id, reset_token_id, account_id, event_type, outcome,
          actor_type, actor_id, reason_code, request_id,
          idempotency_key, metadata_json, created_at
        )
        SELECT ?, id, account_id, 'REVOKED', 'SUCCESS', 'STAFF', ?,
          'SUPERSEDED', ?, ?, '{}', ?
        FROM customer_password_reset_tokens
        WHERE account_id=? AND status='ACTIVE'
      `).bind(crypto.randomUUID(), command.actor.staffId, command.requestId,
        command.idempotencyKey, now, account.account_id),
      database.prepare(`
        UPDATE customer_password_reset_tokens
        SET status='REVOKED', version=version+1, revoked_at=?,
          revoked_by_staff_id=?, updated_at=?
        WHERE account_id=? AND status='ACTIVE'
      `).bind(now, command.actor.staffId, now, account.account_id),
      database.prepare(`
        INSERT INTO customer_password_reset_tokens (
          id, token_hash, account_id, identity_subject_id, wechat_hash,
          issued_by_staff_id, verification_note, status, version,
          issued_at, expires_at, consumed_at, revoked_at,
          revoked_by_staff_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?, NULL, NULL,
          NULL, ?, ?)
      `).bind(resetId, tokenHash, account.account_id,
        account.identity_subject_id, wechatHash, command.actor.staffId,
        input.verificationNote.trim(), now, expiresAt, now, now),
      passwordResetEvent(database, {
        resetId, accountId: account.account_id, type: 'ISSUED',
        actorType: 'STAFF', actorId: command.actor.staffId,
        requestId: command.requestId, idempotencyKey: command.idempotencyKey,
        reason: null, now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(), aggregateType: 'CUSTOMER_PASSWORD_RESET',
        aggregateId: resetId, eventType: 'CUSTOMER_PASSWORD_RESET_ISSUED',
        actor: staffAuditActor(command.actor), requestId: command.requestId,
        idempotencyKey: command.idempotencyKey,
        nextState: { status: 'ACTIVE', account_id: account.account_id,
          expires_at: expiresAt },
        metadata: { wechat_hash: wechatHash }, createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, safe, {
        resultReferences: { reset_id: resetId }, now,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);
  } catch (error) {
    await markIdempotencyFailed(database, acquired.claim, 'RESET_ISSUE_FAILED', now);
    throw error;
  }
  return { ...safe, reset_token: token, replayed: false };
}

export async function completePasswordReset(
  database: SqlDatabase,
  input: { token: string; newPassword: string; passwordConfirmation: string },
  command: { requestId: string; idempotencyKey: string; now?: number },
) {
  if (input.newPassword !== input.passwordConfirmation) {
    throw new CustomerSecurityError('VALIDATION_ERROR', 400);
  }
  try { validateCustomerPassword(input.newPassword); }
  catch { throw new CustomerSecurityError('VALIDATION_ERROR', 400); }
  const now = command.now ?? Date.now();
  const tokenHash = await hashOneTimeToken(input.token);
  const reset = await database.prepare(`
    SELECT reset.id, reset.account_id, reset.identity_subject_id,
      reset.status, reset.version, reset.expires_at,
      account.account_type, account.session_version, account.version AS account_version
    FROM customer_password_reset_tokens reset
    JOIN customer_login_accounts account ON account.id=reset.account_id
    WHERE reset.token_hash=?
  `).bind(tokenHash).first<any>();
  if (!reset) {
    throw new CustomerSecurityError('CONFLICT', 409);
  }
  if (reset.status !== 'ACTIVE' || Number(reset.expires_at) <= now) {
    await passwordResetEvent(database, {
      resetId: reset.id, accountId: reset.account_id, type: 'REJECTED',
      outcome: 'FAILURE', actorType: 'CUSTOMER', actorId: null,
      requestId: command.requestId, idempotencyKey: command.idempotencyKey,
      reason: reset.status !== 'ACTIVE'
        ? 'RESET_TOKEN_ALREADY_USED_OR_REVOKED'
        : 'RESET_TOKEN_EXPIRED',
      now,
    }).run();
    throw new CustomerSecurityError('CONFLICT', 409);
  }
  const credential = await hashCustomerPassword(input.newPassword);
  const requestHash = await hashCanonicalJson({
    action: 'COMPLETE_CUSTOMER_PASSWORD_RESET', token_hash: tokenHash,
    new_password_hash: await hashCanonicalJson(input.newPassword),
  });
  const acquired = await acquireIdempotency<any>(database, {
    actorType: 'PUBLIC_RECOVERY_TOKEN', actorId: tokenHash,
    action: 'COMPLETE_CUSTOMER_PASSWORD_RESET', targetType: 'CUSTOMER_LOGIN_ACCOUNT',
    targetId: reset.account_id, idempotencyKey: command.idempotencyKey,
    requestHash,
  }, { now });
  if (acquired.kind === 'REPLAY') return { ...acquired.response, replayed: true };
  let nextPath: '/buyer/login' | '/seller/login';
  if (reset.account_type === 'BUYER') nextPath = '/buyer/login';
  else if (reset.account_type === 'SELLER_MEMBER') nextPath = '/seller/login';
  else throw new CustomerSecurityError('CONFLICT', 409);
  const result = {
    password_reset: true as const,
    all_previous_sessions_revoked: true as const,
    next_path: nextPath,
    session_version: Number(reset.session_version) + 1,
  };
  try {
    await database.batch([
      database.prepare(`
        UPDATE customer_password_reset_tokens
        SET status='CONSUMED', version=version+1, consumed_at=?, updated_at=?
        WHERE id=? AND status='ACTIVE' AND expires_at>?
          AND version=?
      `).bind(now, now, reset.id, now, reset.version),
      database.prepare(`
        UPDATE customer_password_credentials
        SET algorithm=?, iterations=?, salt_base64url=?, hash_base64url=?,
          password_version=password_version+1, updated_at=?
        WHERE account_id=?
      `).bind(credential.algorithm, credential.iterations,
        credential.saltBase64Url, credential.hashBase64Url, now,
        reset.account_id),
      database.prepare(`
        UPDATE customer_login_accounts
        SET session_version=session_version+1, version=version+1,
          password_change_required=0, updated_at=?
        WHERE id=? AND status='ACTIVE' AND session_version=? AND version=?
      `).bind(now, reset.account_id, reset.session_version,
        reset.account_version),
      database.prepare(`
        INSERT INTO customer_access_events (
          id, account_id, identity_subject_id, event_type, actor_type,
          actor_id, previous_state_json, next_state_json, request_id,
          idempotency_key, created_at
        ) VALUES (?, ?, ?, 'PASSWORD_CHANGED', 'CUSTOMER_ACCOUNT', ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), reset.account_id,
        reset.identity_subject_id, reset.account_id,
        canonicalJson({ session_version: reset.session_version }),
        canonicalJson({ session_version: Number(reset.session_version) + 1,
          all_sessions_revoked: true }), command.requestId,
        command.idempotencyKey, now),
      passwordResetEvent(database, {
        resetId: reset.id, accountId: reset.account_id, type: 'CONSUMED',
        actorType: 'CUSTOMER', actorId: reset.account_id,
        requestId: command.requestId, idempotencyKey: command.idempotencyKey,
        reason: null, now,
      }),
      passwordResetEvent(database, {
        resetId: reset.id, accountId: reset.account_id,
        type: 'SESSIONS_REVOKED', actorType: 'SYSTEM', actorId: null,
        requestId: command.requestId, idempotencyKey: command.idempotencyKey,
        reason: null, now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(), aggregateType: 'CUSTOMER_LOGIN_ACCOUNT',
        aggregateId: reset.account_id,
        eventType: 'CUSTOMER_PASSWORD_RESET_COMPLETED',
        actor: { type: 'CUSTOMER_ACCOUNT', id: reset.account_id, roles: [] },
        requestId: command.requestId, idempotencyKey: command.idempotencyKey,
        previousState: { session_version: reset.session_version },
        nextState: { session_version: Number(reset.session_version) + 1,
          all_sessions_revoked: true }, createdAt: now,
      }),
      completeIdempotencyStatement(database, acquired.claim, result, { now }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM customer_password_reset_tokens
          WHERE id=? AND status='CONSUMED' AND version=?
        ) AND EXISTS (
          SELECT 1 FROM customer_login_accounts
          WHERE id=? AND session_version=? AND version=?
        ) THEN 1 ELSE 0 END
      `).bind(reset.id, Number(reset.version) + 1, reset.account_id,
        Number(reset.session_version) + 1, Number(reset.account_version) + 1),
    ]);
  } catch (error) {
    await markIdempotencyFailed(database, acquired.claim, 'RESET_COMPLETE_FAILED', now);
    await passwordResetEvent(database, {
      resetId: reset.id, accountId: reset.account_id, type: 'REJECTED',
      outcome: 'FAILURE', actorType: 'CUSTOMER', actorId: null,
      requestId: command.requestId, idempotencyKey: command.idempotencyKey,
      reason: 'RESET_CONCURRENT_OR_TRANSACTION_CONFLICT', now,
    }).run();
    throw error;
  }
  return { ...result, replayed: false };
}

async function requireActiveMarketplace(
  database: SqlDatabase,
  code: CanonicalMarketplaceCode,
): Promise<void> {
  const row = await database.prepare(`
    SELECT status, adapter_status FROM marketplace_registry WHERE code=?
  `).bind(code).first<{ status: string; adapter_status: string }>();
  if (!row || row.status !== 'ACTIVE' || row.adapter_status !== 'AVAILABLE') {
    throw new CustomerSecurityError('VALIDATION_ERROR', 400);
  }
}

function invitationEvent(database: SqlDatabase, input: {
  invitationId: string;
  type: 'ISSUED' | 'REVOKED' | 'CONSUMED' | 'REJECTED';
  outcome: 'SUCCESS' | 'FAILURE' | 'BLOCKED';
  actorType: 'STAFF' | 'CUSTOMER' | 'SYSTEM';
  actorId: string | null;
  reason: string | null;
  requestId: string;
  idempotencyKey: string | null;
  tokenHash: string | null;
  now: number;
}): SqlStatement {
  return database.prepare(`
    INSERT INTO customer_buyer_invitation_events (
      id, invitation_id, event_type, outcome, actor_type, actor_id,
      reason_code, request_id, idempotency_key, token_hash,
      metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)
  `).bind(crypto.randomUUID(), input.invitationId, input.type,
    input.outcome, input.actorType, input.actorId, input.reason,
    input.requestId, input.idempotencyKey, input.tokenHash, input.now);
}

function passwordResetEvent(database: SqlDatabase, input: {
  resetId: string; accountId: string;
  type: 'ISSUED' | 'REVOKED' | 'CONSUMED' | 'REJECTED' | 'SESSIONS_REVOKED';
  outcome?: 'SUCCESS' | 'FAILURE' | 'BLOCKED';
  actorType: 'STAFF' | 'CUSTOMER' | 'SYSTEM'; actorId: string | null;
  requestId: string; idempotencyKey: string | null;
  reason: string | null; now: number;
}): SqlStatement {
  return database.prepare(`
    INSERT INTO customer_password_reset_events (
      id, reset_token_id, account_id, event_type, outcome,
      actor_type, actor_id, reason_code, request_id,
      idempotency_key, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)
  `).bind(crypto.randomUUID(), input.resetId, input.accountId, input.type,
    input.outcome ?? 'SUCCESS', input.actorType, input.actorId, input.reason, input.requestId,
    input.idempotencyKey, input.now);
}

function staffAuditActor(actor: AssignmentStaffAuthorization) {
  return { type: 'STAFF', id: actor.staffId, roles: [...actor.roles] };
}

function requireActiveStaff(actor: AssignmentStaffAuthorization): void {
  if (actor.staffStatus !== 'ACTIVE') {
    throw new CustomerSecurityError('FORBIDDEN', 403);
  }
}

function cleanId(value: string): string {
  const id = value.normalize('NFKC').trim();
  if (id.length < 1 || id.length > 200
    || /[\u0000-\u001f\u007f]/u.test(id)) {
    throw new CustomerSecurityError('VALIDATION_ERROR', 400);
  }
  return id;
}

function validateExpectedVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CustomerSecurityError('VALIDATION_ERROR', 400);
  }
}
