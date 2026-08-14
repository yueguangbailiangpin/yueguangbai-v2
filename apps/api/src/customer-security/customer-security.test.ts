import { afterEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import { hashCustomerPassword } from '@ygb/domain';
import {
  authenticateCustomerPassword,
  issueCustomerSession,
  resolveCustomerSession,
  selectCustomerPersona,
} from '../customer-auth/authenticate-customer';
import { registerInvitedBuyer } from './invited-registration';
import {
  completePasswordReset,
  issueBuyerInvitation,
  issuePasswordReset,
  revokeBuyerInvitation,
} from './service';
import type { AssignmentStaffAuthorization } from '../staff-assignment';

const NOW = Date.UTC(2026, 7, 7, 8, 0, 0);
const TOKEN_SECRET = 'customer-security-test-secret-at-least-32-bytes';
const SESSION_SECRET = 'customer-session-test-secret-at-least-32-bytes';
const PASSWORD = 'Strong-Password-2026!';
let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('customer multi-persona invitation and recovery', () => {
  it('backfills old account persona authority and keeps event facts immutable', async () => {
    database = createDb();
    expect(await database.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).first()).toEqual({ schema_version: 68 });
    const triggerNames = (await database.prepare(`
      SELECT name FROM sqlite_schema WHERE type='trigger'
        AND name LIKE 'trg_customer_account_persona%'
      ORDER BY name
    `).all<{ name: string }>()).results.map((row) => row.name);
    expect(triggerNames).toContain('trg_customer_account_persona_source_guard');
    await invite('immutable_wx', 'AMAZON_JP', 'invite-immutable-0001');
    expect(() => database!.exec(`
      UPDATE customer_buyer_invitation_events SET outcome='FAILURE'
    `)).toThrow(/immutable/iu);
  });

  it('registers a new invited Buyer once and stores only the token digest', async () => {
    database = createDb();
    const issued = await invite('new_buyer_wx', 'AMAZON_US', 'invite-new-0001');
    const registered = await register(issued.registration_token,
      'new_buyer_wx', 'AMAZON_US', 'register-new-0001');
    expect(registered).toMatchObject({
      buyerNumber: null,
      authenticated: {
        accountType: 'BUYER', availablePersonas: ['BUYER'],
      },
    });
    await expect(register(issued.registration_token,
      'new_buyer_wx', 'AMAZON_US', 'register-new-0001'))
      .resolves.toMatchObject({
        buyerNumber: null,
        authenticated: { accountId: registered.authenticated.accountId },
        replayed: true,
      });
    expect(await database.prepare(`
      SELECT invitation.status, invitation.consumed_by_account_id,
        assignment.marketplace_code,
        (SELECT COUNT(*) FROM customer_account_personas
          WHERE account_id=invitation.consumed_by_account_id) AS personas
      FROM customer_buyer_invitations invitation
      JOIN buyer_customers buyer
        ON buyer.identity_subject_id=(SELECT identity_subject_id
          FROM customer_login_accounts WHERE id=invitation.consumed_by_account_id)
      JOIN buyer_marketplace_assignments assignment
        ON assignment.buyer_customer_id=buyer.id
    `).first()).toMatchObject({
      status: 'CONSUMED', marketplace_code: 'AMAZON_US', personas: 1,
    });
    const dump = JSON.stringify((await database.prepare(`
      SELECT customer_buyer_invitations.token_hash, metadata_json
      FROM customer_buyer_invitations
      JOIN customer_buyer_invitation_events
        ON invitation_id=customer_buyer_invitations.id
    `).all()).results);
    expect(dump).not.toContain(issued.registration_token);
    await expect(register(issued.registration_token,
      'new_buyer_wx', 'AMAZON_US', 'register-new-0002'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('adds Buyer to the same Seller credential account and isolates active personas', async () => {
    database = createDb();
    const seller = await seedSellerAccount(database, 'dual_wx');
    const issued = await invite('dual_wx', 'AMAZON_JP', 'invite-dual-0001');
    const registered = await register(issued.registration_token,
      'dual_wx', 'AMAZON_JP', 'register-dual-0001');
    expect(registered.authenticated).toMatchObject({
      accountId: seller.accountId,
      identitySubjectId: seller.subjectId,
      availablePersonas: ['BUYER', 'SELLER_MEMBER'],
    });
    expect(await database.prepare(`
      SELECT COUNT(*) AS count FROM customer_login_accounts
      WHERE identity_subject_id=?
    `).bind(seller.subjectId).first()).toEqual({ count: 1 });
    const personas = await database.prepare(`
      SELECT persona_type FROM customer_account_personas
      WHERE account_id=? ORDER BY persona_type
    `).bind(seller.accountId).all();
    expect(personas.results).toEqual([
      { persona_type: 'BUYER' }, { persona_type: 'SELLER_MEMBER' },
    ]);

    const buyerLogin = await authenticateCustomerPassword(database, {
      loginIdentifier: 'dual_wx', password: PASSWORD, persona: 'BUYER',
    });
    const sellerLogin = await authenticateCustomerPassword(database, {
      loginIdentifier: 'dual_wx', password: PASSWORD, persona: 'SELLER_MEMBER',
    });
    expect(buyerLogin).toMatchObject({ accountType: 'BUYER',
      accountId: seller.accountId });
    expect(sellerLogin).toMatchObject({ accountType: 'SELLER_MEMBER',
      accountId: seller.accountId });
    await expect(selectCustomerPersona(database, {
      ...sellerLogin!, availablePersonas: sellerLogin!.availablePersonas ?? [],
      issuedAt: NOW, expiresAt: NOW + 60_000,
    }, 'BUYER'))
      .resolves.toMatchObject({ accountType: 'BUYER',
        accountId: seller.accountId });

    const buyerToken = await issueCustomerSession(registered.authenticated,
      SESSION_SECRET, { now: NOW, ttlMs: 60_000 });
    const buyerSession = await resolveCustomerSession(database, buyerToken,
      SESSION_SECRET, NOW + 1);
    expect(buyerSession?.accountType).toBe('BUYER');
    expect(buyerSession?.availablePersonas).toEqual(['BUYER', 'SELLER_MEMBER']);
  });

  it('fails closed for wrong WeChat, wrong Marketplace, expiry, revocation and concurrent replay', async () => {
    database = createDb();
    const wrong = await invite('bound_wx', 'AMAZON_JP', 'invite-bound-0001');
    await expect(register(wrong.registration_token,
      'other_wx', 'AMAZON_JP', 'register-wrong-wechat'))
      .rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(register(wrong.registration_token,
      'bound_wx', 'AMAZON_US', 'register-wrong-market'))
      .rejects.toMatchObject({ code: 'CONFLICT' });

    const revoked = await invite('revoked_wx', 'AMAZON_JP', 'invite-revoke-0001');
    await revokeBuyerInvitation(database, {
      invitationId: revoked.invitation_id, expectedVersion: 1,
    }, {
      actor: staffActor(), idempotencyKey: 'revoke-invite-0001',
      requestId: 'request-revoke', now: NOW + 1,
    });
    await expect(register(revoked.registration_token,
      'revoked_wx', 'AMAZON_JP', 'register-revoked'))
      .rejects.toMatchObject({ code: 'CONFLICT' });

    const expired = await invite('expired_wx', 'AMAZON_JP', 'invite-expire-0001',
      NOW - 8 * 24 * 60 * 60 * 1000);
    await expect(register(expired.registration_token,
      'expired_wx', 'AMAZON_JP', 'register-expired'))
      .rejects.toMatchObject({ code: 'CONFLICT' });

    const concurrent = await invite('race_wx', 'AMAZON_JP', 'invite-race-0001');
    const outcomes = await Promise.allSettled([
      register(concurrent.registration_token, 'race_wx', 'AMAZON_JP', 'race-a'),
      register(concurrent.registration_token, 'race_wx', 'AMAZON_JP', 'race-b'),
    ]);
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(await database.prepare(`
      SELECT COUNT(*) AS count FROM buyer_customers
      WHERE display_name='race_wx'
    `).first()).toEqual({ count: 1 });
    expect(Number((await database.prepare(`
      SELECT COUNT(*) AS count FROM customer_buyer_invitation_events
      WHERE event_type='REJECTED' AND outcome='FAILURE'
    `).first<{ count: number }>())?.count ?? 0)).toBeGreaterThanOrEqual(4);
  });

  it('replays Staff issuance without a second fact or plaintext DB token', async () => {
    database = createDb();
    const first = await invite('replay_wx', 'AMAZON_JP', 'invite-replay-0001');
    const replay = await invite('replay_wx', 'AMAZON_JP', 'invite-replay-0001');
    expect(replay).toMatchObject({
      invitation_id: first.invitation_id,
      registration_token: first.registration_token,
      replayed: true,
    });
    expect(await database.prepare(`
      SELECT COUNT(*) AS count FROM customer_buyer_invitations
    `).first()).toEqual({ count: 1 });
  });

  it('resets one credential, consumes once, and invalidates every old persona session', async () => {
    database = createDb();
    const seller = await seedSellerAccount(database, 'reset_wx');
    const oldAuthenticated = {
      accountId: seller.accountId,
      identitySubjectId: seller.subjectId,
      accountType: 'SELLER_MEMBER' as const,
      availablePersonas: ['SELLER_MEMBER' as const],
      sessionVersion: 1,
      passwordChangeRequired: false,
    };
    const oldToken = await issueCustomerSession(oldAuthenticated,
      SESSION_SECRET, { now: NOW, ttlMs: 60_000 });
    const reset = await issuePasswordReset(database, {
      wechatId: 'reset_wx', manualVerificationConfirmed: true,
      verificationNote: '北京时间人工微信视频核验通过',
    }, {
      actor: staffActor(), idempotencyKey: 'password-reset-issue-0001',
      requestId: 'request-reset-issue', tokenSecret: TOKEN_SECRET, now: NOW,
    });
    await expect(completePasswordReset(database, {
      token: reset.reset_token, newPassword: 'short',
      passwordConfirmation: 'short',
    }, {
      requestId: 'request-reset-weak',
      idempotencyKey: 'password-reset-weak-0001', now: NOW + 500,
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await database.prepare(`
      SELECT status FROM customer_password_reset_tokens WHERE id=?
    `).bind(reset.reset_id).first()).toEqual({ status: 'ACTIVE' });
    const completed = await completePasswordReset(database, {
      token: reset.reset_token, newPassword: 'New-Strong-Password-2026!',
      passwordConfirmation: 'New-Strong-Password-2026!',
    }, {
      requestId: 'request-reset-complete',
      idempotencyKey: 'password-reset-complete-0001', now: NOW + 1000,
    });
    expect(completed).toMatchObject({
      password_reset: true, all_previous_sessions_revoked: true,
      next_path: '/seller/login',
      session_version: 2,
    });
    await expect(resolveCustomerSession(database, oldToken, SESSION_SECRET,
      NOW + 1001)).resolves.toBeNull();
    await expect(completePasswordReset(database, {
      token: reset.reset_token, newPassword: 'Another-Strong-Password!',
      passwordConfirmation: 'Another-Strong-Password!',
    }, {
      requestId: 'request-reset-replay',
      idempotencyKey: 'password-reset-replay-0001', now: NOW + 2000,
    })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await database.prepare(`
      SELECT status, version FROM customer_password_reset_tokens
      WHERE id=?
    `).bind(reset.reset_id).first()).toEqual({ status: 'CONSUMED', version: 2 });
    expect(await database.prepare(`
      SELECT event_type, outcome, reason_code
      FROM customer_password_reset_events
      WHERE reset_token_id=? AND event_type='REJECTED'
    `).bind(reset.reset_id).first()).toEqual({
      event_type: 'REJECTED', outcome: 'FAILURE',
      reason_code: 'RESET_TOKEN_ALREADY_USED_OR_REVOKED',
    });
  });

  it('prevents a second Seller Organization membership at the database boundary', async () => {
    database = createDb();
    const seller = await seedSellerAccount(database, 'one_seller_wx');
    seedSellerOrganization(database, 'seller-org-second');
    expect(() => database!.raw.prepare(`
      INSERT INTO seller_organization_members (
        id, identity_subject_id, organization_id, member_number,
        username_fallback, display_name, role, primary_owner, status,
        version, created_at, updated_at, activated_at, disabled_at
      ) VALUES ('member-second', ?, 'seller-org-second', 1,
        'second-owner', '第二组织', 'OWNER', 1, 'ACTIVE',
        1, 1000, 1000, 1000, NULL)
    `).run(seller.subjectId)).toThrow(/UNIQUE/iu);
  });
});

function createDb(): SqliteDatabase {
  const db = createMigratedTestDatabase();
  db.exec(`
    INSERT INTO buyer_channels (
      id, code, name, status, next_sequence, version,
      created_at, updated_at, disabled_at
    ) VALUES ('buyer-channel-invite', 'INV', '邀请买家', 'ACTIVE',
      1, 1, 1000, 1000, NULL);
    INSERT INTO staff_users (
      id, display_name, status, authorization_version, version,
      created_at, updated_at, disabled_at, session_version
    ) VALUES ('staff-security', '安全员工', 'ACTIVE', 1, 1,
      1000, 1000, NULL, 1);
  `);
  return db;
}

async function invite(
  wechatId: string,
  marketplaceCode: 'AMAZON_JP' | 'AMAZON_US',
  idempotencyKey: string,
  now = NOW,
) {
  return issueBuyerInvitation(database!, { wechatId, marketplaceCode }, {
    actor: staffActor(), idempotencyKey, requestId: `request-${idempotencyKey}`,
    tokenSecret: TOKEN_SECRET, now,
  });
}

async function register(
  token: string,
  wechatId: string,
  marketplaceCode: 'AMAZON_JP' | 'AMAZON_US',
  idempotencyKey: string,
) {
  return registerInvitedBuyer(database!, {
    invitationToken: token, wechatId, marketplaceCode,
    password: PASSWORD, passwordConfirmation: PASSWORD,
    buyerChannelId: 'buyer-channel-invite',
  }, {
    idempotencyKey: idempotencyKey.padEnd(8, '0'),
    requestId: `request-${idempotencyKey}`, sessionId: crypto.randomUUID(),
    sessionExpiresAt: NOW + 60_000,
    networkSourceHash: 'a'.repeat(64), deviceHash: 'b'.repeat(64), now: NOW,
  });
}

function staffActor(): AssignmentStaffAuthorization {
  return {
    staffId: 'staff-security', displayName: '安全员工', staffStatus: 'ACTIVE',
    authorizationVersion: 1, roles: new Set(['pre_sales']),
    permissions: new Set(), memberTeamIds: ['team-test'], leaderTeamIds: [],
  };
}

async function seedSellerAccount(db: SqliteDatabase, wechat: string) {
  const subjectId = `subject-${wechat}`;
  const accountId = `account-${wechat}`;
  const organizationId = `seller-org-${wechat}`;
  seedSellerOrganization(db, organizationId);
  const credential = await hashCustomerPassword(PASSWORD, { iterations: 10_000 });
  await db.batch([
    db.prepare(`
      INSERT INTO customer_identity_subjects (id, subject_type, created_at)
      VALUES (?, 'SELLER_ORG_MEMBER', 1000)
    `).bind(subjectId),
    db.prepare(`
      INSERT INTO seller_organization_members (
        id, identity_subject_id, organization_id, member_number,
        username_fallback, display_name, role, primary_owner, status,
        version, created_at, updated_at, activated_at, disabled_at
      ) VALUES (?, ?, ?, 1, ?, ?, 'OWNER', 1, 'ACTIVE',
        1, 1000, 1000, 1000, NULL)
    `).bind(`member-${wechat}`, subjectId, organizationId,
      `fallback-${wechat}`, wechat),
    db.prepare(`
      INSERT INTO wechat_identity_claims (
        id, identity_subject_id, display_wechat, normalized_wechat,
        status, version, acquired_at, reserved_at, released_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'ACTIVE', 1, 1000, NULL, NULL, 1000, 1000)
    `).bind(`claim-${wechat}`, subjectId, wechat, wechat.toLowerCase()),
    db.prepare(`
      INSERT INTO customer_login_accounts (
        id, identity_subject_id, account_type,
        login_identifier_display, login_identifier_normalized,
        status, session_version, password_change_required, version,
        created_at, updated_at, activated_at, disabled_at, registration_source
      ) VALUES (?, ?, 'SELLER_MEMBER', ?, ?, 'ACTIVE', 1, 0, 1,
        1000, 1000, 1000, NULL, 'STAFF_ACTIVATION')
    `).bind(accountId, subjectId, wechat, wechat.toLowerCase()),
    db.prepare(`
      INSERT INTO customer_password_credentials (
        account_id, algorithm, iterations, salt_base64url, hash_base64url,
        password_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, 1000, 1000)
    `).bind(accountId, credential.algorithm, credential.iterations,
      credential.saltBase64Url, credential.hashBase64Url),
  ]);
  return { subjectId, accountId, organizationId };
}

function seedSellerOrganization(db: SqliteDatabase, id: string): void {
  const sequence = Number(db.raw.prepare(`
    SELECT COUNT(*) AS count FROM seller_organizations
  `).get()?.['count'] ?? 0) + 1;
  db.raw.prepare(`
    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code, origin_channel_id,
      current_channel_id, seller_sequence, organization_name,
      status, version, created_at, updated_at, activated_at, disabled_at
    ) VALUES (?, 'JP', ?, 'seller-channel-ido-mango',
      'seller-channel-ido-mango', ?, ?, 'ACTIVE', 1,
      1000, 1000, 1000, NULL)
  `).run(id, `code-${id}`, sequence, id);
}
