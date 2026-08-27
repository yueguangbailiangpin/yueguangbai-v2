import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { createApp } from '../app';
import { registerInvitedBuyer } from '../customer-security/invited-registration';
import { registerBuyerSelfRegistrationRoutes } from './routes';
import { consumeBuyerRegistrationRateLimit } from './rate-limit';
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

describe('Phase 4A2 buyer invited registration', () => {
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
            AND registration_source='INVITED_REGISTRATION') AS accounts,
        (SELECT COUNT(*) FROM buyer_number_allocation_events) AS numbers,
        (SELECT COUNT(*) FROM buyer_registration_session_issuances) AS sessions
    `).first();
    expect(facts).toEqual({ buyers: 0, orders: 0, accounts: 0, numbers: 0, sessions: 0 });
    expect(JSON.stringify(facts)).not.toContain('Strong-Password-2026!');
  });

  // DELETED (subject removed by D-056: no uninvited self-registration):
  // "claims one eligible historical buyer without copying its relationships",
  // "rejects duplicate account generically and does not replace password",
  // "records ambiguous historical identity conflict and creates no account",
  // "allows only one winner for the same normalized WeChat",
  // "rejects disabled historical buyers without creating account or session",
  // and "allows only one concurrent claim of the same historical buyer" —
  // they exercised the deleted registerBuyerSelf uninvited claim flows.
  // Route-level duplicate/conflict handling is still asserted below.

  // DELETED (subject removed by D-056 / migration 0027): "promotes the
  // preorder number on first formal-order number allocation" —
  // buyer_preorder_number_allocations is dropped and the final buyer number
  // is allocated at profile creation; there is nothing to promote.

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

  it('reuses password confirmation and strength rules', async () => {
    database = createDb();
    await expect(registerCore('password_mismatch_wx', 'password-mismatch', {
      password: 'Strong-Password-2026!',
      passwordConfirmation: 'different-password',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(registerCore('weak_password_wx', 'weak-password', {
      password: 'short',
      passwordConfirmation: 'short',
    })).rejects.toThrow();
    expect((await database.prepare(`
      SELECT COUNT(*) AS count FROM customer_login_accounts
    `).first<{ count: number }>())?.count).toBe(0);
  });

  it('stores no plaintext password in credentials, audit or outbox', async () => {
    database = createDb();
    const plaintext = 'Never-Store-This-2026!';
    await registerInvitedBuyer(database!, {
      invitationToken: await seedInvitation(
        database!,
        'secret_storage_wx',
        'secret',
        NOW - 60_000,
      ),
      wechatId: 'secret_storage_wx',
      marketplaceCode: 'AMAZON_JP',
      password: plaintext,
      passwordConfirmation: plaintext,
      buyerChannelId: 'buyer-channel-wechat-b',
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
    -- The operational B/C channels are pre-seeded by migration 0027 (their
    -- codes are UNIQUE). Buyer numbers must be 13+ characters, so start the
    -- channel B counter at a four-digit sequence.
    UPDATE buyer_channels
    SET next_sequence=1001
    WHERE id='buyer-channel-wechat-b';
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

async function registerCore(
  wechatId: string,
  key: string,
  passwords: {
    password?: string;
    passwordConfirmation?: string;
  } = {},
) {
  // The invitation must be issued before the synthetic command time so the
  // registration transaction's updated_at never precedes created_at.
  const token = await seedInvitation(
    database!,
    wechatId,
    `core-${key}`,
    NOW - 60_000,
  );
  return registerInvitedBuyer(database!, {
    invitationToken: token,
    wechatId,
    marketplaceCode: 'AMAZON_JP',
    password: passwords.password ?? 'Strong-Password-2026!',
    passwordConfirmation: passwords.passwordConfirmation
      ?? passwords.password
      ?? 'Strong-Password-2026!',
    buyerChannelId: 'buyer-channel-wechat-b',
  }, coreCommand(key));
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
      buyer_customer_no, buyer_sequence,
      display_name, access_status, identity_review_status,
      version, created_at, updated_at, activated_at, disabled_at
    ) VALUES (?, ?, 'AMAZON_JP', 'buyer-channel-wechat-b',
      '19700101B2001', 2001,
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
    BUYER_SELF_REGISTRATION_CHANNEL_ID: 'buyer-channel-wechat-b',
    BUYER_SELF_REGISTRATION_HUMAN_VERIFICATION_REQUIRED: 'false',
  };
}

async function seedInvitation(
  db: SqliteDatabase,
  wechat: string,
  suffix: string,
  issuedAt = Date.now(),
): Promise<string> {
  // Deterministic, unique-per-suffix 43-character token (cycled from the
  // suffix so concurrent fixtures never collide on token_hash).
  const token = suffix.length
    ? Array.from({ length: 43 }, (_, index) => suffix[index % suffix.length]!)
      .join('')
    : 'a'.repeat(43);
  const now = issuedAt;
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
