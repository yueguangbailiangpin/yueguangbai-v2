import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { createApp } from '../app';
import { allocateBuyerCustomerNumber } from '../customers/allocate-buyer-number';
import { registerBuyerSelfRegistrationRoutes } from './routes';
import { consumeBuyerRegistrationRateLimit } from './rate-limit';
import { registerBuyerSelf } from './register-buyer';
import { hashOneTimeToken } from '@ygb/domain';
import { rebindBuyerAuthAccount, revokeAllBuyerSessions } from './recovery';

const SECRET = 'phase4a2-session-secret-with-at-least-thirty-two-bytes';
const ORIGIN = 'https://api.local.test';
const NOW = Date.UTC(2026, 7, 1, 9, 0, 0);
let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('Phase 4A2 buyer self registration', () => {
  it('closes direct registration when no Staff invitation is supplied', async () => {
    database = createDb();
    const app = createApp();
    registerBuyerSelfRegistrationRoutes(app);
    const response = await app.request(
      'https://api.local.test/api/buyer-auth/register',
      {
        method: 'POST',
        headers: headers('register-new-0001'),
        body: JSON.stringify({
          wechat_id: ' New_Buyer_01 ',
          password: 'Strong-Password-2026!',
          password_confirmation: 'Strong-Password-2026!',
        }),
      },
      env(),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    const facts = await database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM buyer_customers) AS buyers,
        (SELECT COUNT(*) FROM formal_orders) AS orders,
        (SELECT COUNT(*) FROM customer_login_accounts
          WHERE password_change_required=0
            AND registration_source='SELF_REGISTRATION_NEW') AS accounts,
        (SELECT COUNT(*) FROM buyer_preorder_number_allocations) AS numbers,
        (SELECT COUNT(*) FROM buyer_registration_session_issuances) AS sessions
    `).first();
    expect(facts).toEqual({ buyers: 0, orders: 0, accounts: 0, numbers: 0, sessions: 0 });
    expect(JSON.stringify(facts)).not.toContain('Strong-Password-2026!');
  });

  it('claims one eligible historical buyer without copying its relationships', async () => {
    database = createDb();
    seedBuyer(database, 'buyer-existing', 'subject-existing', 'claim-existing',
      'existing_wx', 'ACTIVE');
    const before = await database.prepare(`
      SELECT COUNT(*) AS count FROM buyer_customers
    `).first<{ count: number }>();
    await registerCore('existing_wx', 'claim-existing-key');
    const after = await database.prepare(`
      SELECT COUNT(*) AS count FROM buyer_customers
    `).first<{ count: number }>();
    expect(after?.count).toBe(before?.count);
    const account = await database.prepare(`
      SELECT identity_subject_id, registration_source
      FROM customer_login_accounts
    `).first();
    expect(account).toEqual({
      identity_subject_id: 'subject-existing',
      registration_source: 'SELF_REGISTRATION_CLAIM',
    });
  });

  it('rejects duplicate account generically and does not replace password', async () => {
    database = createDb();
    const first = await registerCore('duplicate_wx', 'duplicate-first');
    const credential = await database.prepare(`
      SELECT hash_base64url FROM customer_password_credentials
      WHERE account_id=?
    `).bind(first.authenticated.accountId).first<{ hash_base64url: string }>();
    await expect(registerCore('duplicate_wx', 'duplicate-second'))
      .rejects.toMatchObject({ reason: 'ACCOUNT_ALREADY_EXISTS' });
    const after = await database.prepare(`
      SELECT hash_base64url FROM customer_password_credentials
      WHERE account_id=?
    `).bind(first.authenticated.accountId).first<{ hash_base64url: string }>();
    expect(after).toEqual(credential);
  });

  it('records ambiguous historical identity conflict and creates no account', async () => {
    database = createDb();
    seedBuyer(database, 'buyer-a', 'subject-a', 'claim-a', 'same_wx', 'RELEASED');
    seedBuyer(database, 'buyer-b', 'subject-b', 'claim-b', 'same_wx', 'RELEASED');
    await expect(registerCore('same_wx', 'conflict-key'))
      .rejects.toMatchObject({ reason: 'REGISTRATION_CONFLICT' });
    const facts = await database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM buyer_registration_conflicts) AS conflicts,
        (SELECT COUNT(*) FROM customer_login_accounts) AS accounts,
        (SELECT COUNT(*) FROM buyer_registration_session_issuances) AS sessions
    `).first();
    expect(facts).toEqual({ conflicts: 1, accounts: 0, sessions: 0 });
  });

  it('allows only one winner for the same normalized WeChat', async () => {
    database = createDb();
    const results = await Promise.allSettled([
      registerCore('Concurrent_WX', 'concurrent-key-a'),
      registerCore(' concurrent_wx ', 'concurrent-key-b'),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    const counts = await database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM buyer_customers) AS buyers,
        (SELECT COUNT(*) FROM customer_login_accounts) AS accounts
    `).first();
    expect(counts).toEqual({ buyers: 1, accounts: 1 });
  });

  it('promotes the preorder number on first formal-order number allocation', async () => {
    database = createDb();
    const registered = await registerCore('preorder_wx', 'preorder-register');
    const buyer = await database.prepare(`
      SELECT buyer_customer_id, buyer_customer_no, buyer_sequence
      FROM buyer_preorder_number_allocations
      WHERE buyer_customer_no=?
    `).bind(registered.buyerNumber).first<any>();
    const allocated = await allocateBuyerCustomerNumber(database, {
      buyerCustomerId: buyer.buyer_customer_id,
      firstValidOrderBusinessDate: '2026-08-02',
    }, {
      actor: staffActor(),
      idempotencyKey: 'preorder-promote-0001',
      now: NOW + 1000,
    });
    expect(allocated.buyer_customer_no).toBe(registered.buyerNumber);
    expect(allocated.buyer_sequence).toBe(buyer.buyer_sequence);
    expect(allocated.first_valid_order_business_date).toBe('2026-08-02');
  });

  it('revokes sessions and rebinds atomically with owner-only permission', async () => {
    database = createDb();
    const registered = await registerCore('source_wx', 'source-register');
    seedBuyer(database, 'buyer-target', 'subject-target', 'claim-target',
      'target_wx', 'ACTIVE');
    const revoked = await revokeAllBuyerSessions(database, {
      accountId: registered.authenticated.accountId,
      expectedVersion: 1,
      reason: 'suspected claim problem',
    }, {
      actor: ownerActor(),
      idempotencyKey: 'revoke-sessions-0001',
      now: NOW + 2000,
    });
    expect(revoked.session_version).toBe(2);
    const rebound = await rebindBuyerAuthAccount(database, {
      accountId: registered.authenticated.accountId,
      targetBuyerCustomerId: 'buyer-target',
      expectedVersion: 2,
      reason: 'verified historical owner',
    }, {
      actor: ownerActor(),
      idempotencyKey: 'rebind-account-0001',
      now: NOW + 3000,
    });
    expect(rebound.new_buyer_customer_id).toBe('buyer-target');
    const row = await database.prepare(`
      SELECT identity_subject_id, session_version, registration_source
      FROM customer_login_accounts WHERE id=?
    `).bind(registered.authenticated.accountId).first();
    expect(row).toEqual({
      identity_subject_id: 'subject-target',
      session_version: 3,
      registration_source: 'RECOVERY_REBIND',
    });
  });

  it('fails closed when feature flag is disabled', async () => {
    database = createDb();
    const app = createApp();
    registerBuyerSelfRegistrationRoutes(app);
    const response = await app.request(
      'https://api.local.test/api/buyer-auth/register',
      {
        method: 'POST',
        headers: headers('disabled-key-0001'),
        body: JSON.stringify({
          wechat_id: 'disabled_wx',
          password: 'Strong-Password-2026!',
          password_confirmation: 'Strong-Password-2026!',
        }),
      },
      { ...env(), BUYER_SELF_REGISTRATION_ENABLED: 'false' },
    );
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('disabled_wx');
  });

  it('rejects disabled historical buyers without creating account or session', async () => {
    database = createDb();
    seedBuyer(database, 'buyer-disabled', 'subject-disabled', 'claim-disabled',
      'disabled_history_wx', 'ACTIVE');
    database.exec(`
      UPDATE buyer_customers
      SET access_status='DISABLED', disabled_at=1100
      WHERE id='buyer-disabled'
    `);
    await expect(registerCore('disabled_history_wx', 'disabled-history'))
      .rejects.toMatchObject({ reason: 'BUYER_NOT_ELIGIBLE' });
    const counts = await database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM customer_login_accounts) AS accounts,
        (SELECT COUNT(*) FROM buyer_registration_session_issuances) AS sessions
    `).first();
    expect(counts).toEqual({ accounts: 0, sessions: 0 });
  });

  it('reuses password confirmation and strength rules', async () => {
    database = createDb();
    await expect(registerBuyerSelf(database, {
      wechatId: 'password_mismatch_wx',
      password: 'Strong-Password-2026!',
      passwordConfirmation: 'different-password',
      defaultBuyerChannelId: 'buyer-channel-self',
    }, coreCommand('password-mismatch')))
      .rejects.toMatchObject({ reason: 'INVALID_REQUEST' });
    await expect(registerBuyerSelf(database, {
      wechatId: 'weak_password_wx',
      password: 'short',
      passwordConfirmation: 'short',
      defaultBuyerChannelId: 'buyer-channel-self',
    }, coreCommand('weak-password'))).rejects.toThrow();
    expect((await database.prepare(`
      SELECT COUNT(*) AS count FROM customer_login_accounts
    `).first<{ count: number }>())?.count).toBe(0);
  });

  it('stores no plaintext password in credentials, audit, attempts or outbox', async () => {
    database = createDb();
    const plaintext = 'Never-Store-This-2026!';
    await registerBuyerSelf(database, {
      wechatId: 'secret_storage_wx',
      password: plaintext,
      passwordConfirmation: plaintext,
      defaultBuyerChannelId: 'buyer-channel-self',
    }, coreCommand('secret-storage'));
    const credential = await database.prepare(`
      SELECT salt_base64url, hash_base64url
      FROM customer_password_credentials
    `).first<{ salt_base64url: string; hash_base64url: string }>();
    expect(credential?.salt_base64url).not.toContain(plaintext);
    expect(credential?.hash_base64url).not.toContain(plaintext);
    for (const query of [
      `SELECT previous_state_json || next_state_json || metadata_json AS text
       FROM audit_events ORDER BY created_at DESC LIMIT 1`,
      `SELECT reason_code || metadata_json AS text
       FROM buyer_registration_attempts ORDER BY created_at DESC LIMIT 1`,
      `SELECT payload_json AS text
       FROM integration_outbox ORDER BY created_at DESC LIMIT 1`,
    ]) {
      const row = await database.prepare(query).first<{ text: string | null }>();
      expect(row?.text ?? '').not.toContain(plaintext);
    }
  });

  it('ignores an attacker cookie and establishes a fresh session token', async () => {
    database = createDb();
    const app = createApp();
    registerBuyerSelfRegistrationRoutes(app);
    const invitationToken = await seedInvitation(database, 'fixation_wx', 'fixation');
    const response = await app.request(
      'https://api.local.test/api/buyer-auth/register',
      {
        method: 'POST',
        headers: {
          ...headers('fixation-key'),
          Cookie: '__Host-ygb_customer_session=attacker-session-id',
        },
        body: JSON.stringify({
          invitation_token: invitationToken,
          marketplace_code: 'AMAZON_JP',
          wechat_id: 'fixation_wx',
          password: 'Strong-Password-2026!',
          password_confirmation: 'Strong-Password-2026!',
        }),
      },
      env(),
    );
    expect(response.status).toBe(201);
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).not.toContain('attacker-session-id');
    expect((await response.json() as any).meta.request_id).toEqual(expect.any(String));
  });

  it('returns the same generic public error for duplicate and conflict paths', async () => {
    database = createDb();
    const app = createApp();
    registerBuyerSelfRegistrationRoutes(app);
    const duplicateToken = await seedInvitation(database, 'public_duplicate_wx', 'public');
    const first = await app.request('https://api.local.test/api/buyer-auth/register', {
      method: 'POST',
      headers: headers('public-first'),
      body: JSON.stringify({
        invitation_token: duplicateToken,
        marketplace_code: 'AMAZON_JP',
        wechat_id: 'public_duplicate_wx',
        password: 'Strong-Password-2026!',
        password_confirmation: 'Strong-Password-2026!',
      }),
    }, env());
    expect(first.status).toBe(201);
    const duplicate = await app.request('https://api.local.test/api/buyer-auth/register', {
      method: 'POST',
      headers: headers('public-second'),
      body: JSON.stringify({
        invitation_token: duplicateToken,
        marketplace_code: 'AMAZON_JP',
        wechat_id: 'public_duplicate_wx',
        password: 'Other-Strong-Password-2026!',
        password_confirmation: 'Other-Strong-Password-2026!',
      }),
    }, env());
    const conflict = await app.request('https://api.local.test/api/buyer-auth/register', {
      method: 'POST',
      headers: headers('public-conflict'),
      body: JSON.stringify({
        invitation_token: 'z'.repeat(43),
        marketplace_code: 'AMAZON_JP',
        wechat_id: 'public_conflict_wx',
        password: 'Strong-Password-2026!',
        password_confirmation: 'Strong-Password-2026!',
      }),
    }, env());
    const duplicateBody = await duplicate.json() as any;
    const conflictBody = await conflict.json() as any;
    expect(duplicate.status).toBe(409);
    expect(conflict.status).toBe(409);
    expect(duplicateBody.error.message).toBe(conflictBody.error.message);
    expect(JSON.stringify(duplicateBody)).not.toContain('public_duplicate_wx');
    expect(JSON.stringify(conflictBody)).not.toContain('public_conflict_wx');
  });

  it('enforces WeChat, network and device attempt limits with Retry-After basis', async () => {
    database = createDb();
    let result = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      result = await consumeBuyerRegistrationRateLimit(database, {
        wechatId: 'rate_limit_wx',
        networkSource: '203.0.113.55',
        deviceId: 'device-rate-0001',
        secret: SECRET,
        now: NOW,
      });
    }
    expect(result).toMatchObject({ limited: true });
    expect(result!.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('fails closed for required human verification, wrong content type and oversized body', async () => {
    database = createDb();
    const app = createApp();
    registerBuyerSelfRegistrationRoutes(app);
    const humanToken = await seedInvitation(database, 'human_required_wx', 'human');
    const human = await app.request('https://api.local.test/api/buyer-auth/register', {
      method: 'POST',
      headers: headers('human-required'),
      body: JSON.stringify({
        invitation_token: humanToken,
        marketplace_code: 'AMAZON_JP',
        wechat_id: 'human_required_wx',
        password: 'Strong-Password-2026!',
        password_confirmation: 'Strong-Password-2026!',
      }),
    }, {
      ...env(),
      BUYER_SELF_REGISTRATION_HUMAN_VERIFICATION_REQUIRED: 'true',
    });
    expect(human.status).toBe(409);

    const wrongType = await app.request('https://api.local.test/api/buyer-auth/register', {
      method: 'POST',
      headers: {
        ...headers('wrong-type'),
        'Content-Type': 'text/plain',
      },
      body: '{}',
    }, env());
    expect(wrongType.status).toBe(400);

    const oversized = await app.request('https://api.local.test/api/buyer-auth/register', {
      method: 'POST',
      headers: headers('oversized-body'),
      body: JSON.stringify({
        wechat_id: 'oversized_wx',
        password: `Strong-Password-2026!${'x'.repeat(9000)}`,
        password_confirmation: `Strong-Password-2026!${'x'.repeat(9000)}`,
      }),
    }, env());
    expect(oversized.status).toBe(400);
  });

  it('allows only one concurrent claim of the same historical buyer', async () => {
    database = createDb();
    seedBuyer(database, 'buyer-claim-race', 'subject-claim-race',
      'claim-claim-race', 'claim_race_wx', 'ACTIVE');
    const results = await Promise.allSettled([
      registerCore('claim_race_wx', 'claim-race-a'),
      registerCore('claim_race_wx', 'claim-race-b'),
    ]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect((await database.prepare(`
      SELECT COUNT(*) AS count FROM customer_login_accounts
      WHERE identity_subject_id='subject-claim-race'
    `).first<{ count: number }>())?.count).toBe(1);
  });

  it('rejects rebind target-account and version conflicts without partial binding', async () => {
    database = createDb();
    const source = await registerCore('rebind_source_wx', 'rebind-source');
    const target = await registerCore('rebind_target_wx', 'rebind-target');
    const before = await database.prepare(`
      SELECT identity_subject_id, version, session_version
      FROM customer_login_accounts WHERE id=?
    `).bind(source.authenticated.accountId).first();
    await expect(rebindBuyerAuthAccount(database, {
      accountId: source.authenticated.accountId,
      targetBuyerCustomerId: (await database.prepare(`
        SELECT id FROM buyer_customers WHERE identity_subject_id=?
      `).bind(target.authenticated.identitySubjectId)
        .first<{ id: string }>())!.id,
      expectedVersion: 1,
      reason: 'must fail because target has account',
    }, {
      actor: ownerActor(),
      idempotencyKey: 'rebind-target-conflict',
      now: NOW + 4000,
    })).rejects.toMatchObject({ code: 'CONFLICT' });
    const after = await database.prepare(`
      SELECT identity_subject_id, version, session_version
      FROM customer_login_accounts WHERE id=?
    `).bind(source.authenticated.accountId).first();
    expect(after).toEqual(before);

    await expect(revokeAllBuyerSessions(database, {
      accountId: source.authenticated.accountId,
      expectedVersion: 99,
      reason: 'stale command',
    }, {
      actor: ownerActor(),
      idempotencyKey: 'revoke-version-conflict',
      now: NOW + 5000,
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('enforces owner-effective permission including personal deny', async () => {
    database = createDb();
    const registered = await registerCore('permission_wx', 'permission-register');
    await expect(revokeAllBuyerSessions(database, {
      accountId: registered.authenticated.accountId,
      expectedVersion: 1,
      reason: 'forbidden actor',
    }, {
      actor: {
        staffId: 'staff-owner',
        displayName: 'Owner with personal deny',
        roles: ['owner'],
        permissions: new Set(),
      },
      idempotencyKey: 'permission-denied',
      now: NOW + 6000,
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

});

function createDb(): SqliteDatabase {
  const db = createMigratedTestDatabase();
  db.exec(`
    INSERT INTO buyer_channels (
      id, code, name, status, next_sequence, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'buyer-channel-self', 'SELF', 'Self registration',
      'ACTIVE', 1, 1, 1000, 1000, NULL
    );
  `);
  db.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'staff-owner', 'Owner', 'ACTIVE', 1, 1,
      1000, 1000, NULL
    );
  `);
  return db;
}

async function registerCore(wechatId: string, key: string) {
  return registerBuyerSelf(database!, {
    wechatId,
    password: 'Strong-Password-2026!',
    passwordConfirmation: 'Strong-Password-2026!',
    defaultBuyerChannelId: 'buyer-channel-self',
  }, {
    requestId: `request-${key}`,
    idempotencyKey: key.padEnd(8, '0'),
    wechatIdHash: 'a'.repeat(64),
    networkSourceHash: 'b'.repeat(64),
    deviceHash: 'c'.repeat(64),
    sessionId: crypto.randomUUID(),
    sessionExpiresAt: NOW + 604_800_000,
    now: NOW,
    passwordIterations: 10_000,
  });
}


function coreCommand(key: string) {
  return {
    requestId: `request-${key}`,
    idempotencyKey: key.padEnd(8, '0'),
    wechatIdHash: 'a'.repeat(64),
    networkSourceHash: 'b'.repeat(64),
    deviceHash: 'c'.repeat(64),
    sessionId: crypto.randomUUID(),
    sessionExpiresAt: NOW + 604_800_000,
    now: NOW,
    passwordIterations: 10_000,
  };
}

function seedBuyer(
  db: SqliteDatabase,
  buyerId: string,
  subjectId: string,
  claimId: string,
  wechat: string,
  claimStatus: 'ACTIVE' | 'RELEASED',
): void {
  const reserved = claimStatus === 'RELEASED' ? 900 : null;
  const released = claimStatus === 'RELEASED' ? 950 : null;
  db.raw.prepare(`
    INSERT INTO customer_identity_subjects (id, subject_type, created_at)
    VALUES (?, 'BUYER_CUSTOMER', 1000)
  `).run(subjectId);
  db.raw.prepare(`
    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code, buyer_channel_id,
      buyer_customer_no, buyer_sequence, first_valid_order_business_date,
      display_name, access_status, identity_review_status,
      version, created_at, updated_at, activated_at, disabled_at
    ) VALUES (?, ?, 'AMAZON_JP', 'buyer-channel-self', NULL, NULL, NULL,
      ?, 'ACTIVE', 'CLEAR', 1, 1000, 1000, 1000, NULL)
  `).run(buyerId, subjectId, wechat);
  db.raw.prepare(`
    INSERT INTO wechat_identity_claims (
      id, identity_subject_id, display_wechat, normalized_wechat,
      status, version, acquired_at, reserved_at, released_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, 1000, ?, ?, 1000, 1000)
  `).run(claimId, subjectId, wechat, wechat.toLowerCase(),
    claimStatus, reserved, released);
}

function headers(key: string) {
  return {
    'Content-Type': 'application/json',
    Origin: ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
    'X-Device-ID': 'device-test-0001',
    'CF-Connecting-IP': '203.0.113.10',
    'Idempotency-Key': key.padEnd(8, '0'),
  };
}
function env() {
  return {
    DB: database!,
    CUSTOMER_SESSION_SECRET: SECRET,
    CUSTOMER_SECURITY_TOKEN_SECRET: SECRET,
    BUYER_SELF_REGISTRATION_ENABLED: 'true',
    BUYER_SELF_REGISTRATION_CHANNEL_ID: 'buyer-channel-self',
    BUYER_SELF_REGISTRATION_HUMAN_VERIFICATION_REQUIRED: 'false',
  };
}

async function seedInvitation(
  db: SqliteDatabase,
  wechat: string,
  suffix: string,
): Promise<string> {
  const token = suffix.slice(0, 1).padEnd(43, 'a');
  const now = Date.now();
  db.raw.prepare(`
    INSERT INTO customer_buyer_invitations (
      id, token_hash, wechat_display, normalized_wechat, wechat_hash,
      marketplace_code, issued_by_staff_id, status, version,
      issued_at, expires_at, consumed_at, consumed_by_account_id,
      revoked_at, revoked_by_staff_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'AMAZON_JP', 'staff-owner', 'ACTIVE', 1,
      ?, ?, NULL, NULL, NULL, NULL, ?, ?)
  `).run(`invitation-${suffix}`, await hashOneTimeToken(token), wechat,
    wechat.toLowerCase(), 'd'.repeat(64), now,
    now + 7 * 24 * 60 * 60 * 1000, now, now);
  return token;
}
function ownerActor() {
  return {
    staffId: 'staff-owner',
    displayName: 'Owner',
    roles: ['owner'] as const,
    permissions: new Set(['BUYER_IDENTITY_HIGH_RISK_MANAGE'] as const),
  };
}
function staffActor() {
  return {
    staffId: 'staff-owner',
    displayName: 'Owner',
    roles: ['owner'] as const,
    permissions: new Set(['ORDER_CONFIRM'] as const),
  };
}
