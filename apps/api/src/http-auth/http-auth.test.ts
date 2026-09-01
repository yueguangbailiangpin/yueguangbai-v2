import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import { hashCustomerPassword } from '@ygb/domain';
import type { Context } from 'hono';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import { createApp } from '../app';
import { customerSessionMiddleware } from '../middleware/customer-auth';
import { registerCustomerAuthRoutes } from './routes';

const ORIGIN = 'https://portal.local.test';
const SESSION_SECRET =
  'phase4a-test-session-secret-with-at-least-thirty-two-bytes';
const SECURITY_SECRET =
  'phase4a-test-security-secret-with-at-least-thirty-two-bytes';
const TEMPORARY_PASSWORD = 'Temporary-Password-2026!';
const NEW_PASSWORD = 'Changed-Password-2026!';

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('Phase 4A customer HTTP authentication', () => {
  it('logs in with a secure host cookie and preserves forced password change', async () => {
    database = await createPhase4aDatabase();
    await seedBuyerAccount(database, {
      loginIdentifier: 'buyer_http_01',
      password: TEMPORARY_PASSWORD,
      passwordChangeRequired: true,
    });
    const app = testApp();

    const response = await request(app, '/api/customer-auth/buyer/login', {
      method: 'POST',
      headers: stateHeaders('203.0.113.19'),
      body: JSON.stringify({
        login_identifier: ' BUYER_HTTP_01 ',
        password: TEMPORARY_PASSWORD,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const setCookie = requiredHeader(response, 'set-cookie');
    expect(setCookie).toContain('__Host-ygb_customer_session=');
    expect(setCookie).toMatch(/HttpOnly/iu);
    expect(setCookie).toMatch(/Secure/iu);
    expect(setCookie).toMatch(/SameSite=Lax/iu);
    expect(setCookie).toMatch(/Path=\//u);
    expect(setCookie).toMatch(/Max-Age=604800/iu);

    const body = await json<Record<string, unknown>>(response);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(TEMPORARY_PASSWORD);
    expect(serialized).not.toContain(SESSION_SECRET);
    expect(serialized).not.toContain('v1.');
    expect(body).toMatchObject({
      data: {
        session: {
          account_type: 'BUYER',
          session_version: 1,
          password_change_required: true,
        },
      },
    });

    const cookie = cookiePair(setCookie);
    const sessionResponse = await request(
      app,
      '/api/customer-auth/session',
      { headers: { Cookie: cookie } },
    );
    expect(sessionResponse.status).toBe(200);
    await expect(json(sessionResponse)).resolves.toMatchObject({
      data: {
        session: {
          password_change_required: true,
        },
      },
    });

    const protectedResponse = await request(
      app,
      '/api/test-protected',
      { headers: { Cookie: cookie } },
    );
    expect(protectedResponse.status).toBe(403);
    await expect(json(protectedResponse)).resolves.toMatchObject({
      error: { code: 'PASSWORD_CHANGE_REQUIRED' },
    });
  });

  it('changes the password, rotates session_version, and issues a replacement cookie', async () => {
    database = await createPhase4aDatabase();
    await seedBuyerAccount(database, {
      loginIdentifier: 'buyer_change_01',
      password: TEMPORARY_PASSWORD,
      passwordChangeRequired: true,
    });
    const app = testApp();
    const loginResponse = await login(
      app,
      'buyer_change_01',
      TEMPORARY_PASSWORD,
      '203.0.113.20',
    );
    const oldCookie = cookiePair(
      requiredHeader(loginResponse, 'set-cookie'),
    );

    const passwordBody = {
      current_password: TEMPORARY_PASSWORD,
      new_password: NEW_PASSWORD,
    };
    const missingOrigin = await request(
      app,
      '/api/customer-auth/change-password',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: oldCookie,
          'Idempotency-Key': 'customer-password-http-missing-origin',
        },
        body: JSON.stringify(passwordBody),
      },
    );
    expect(missingOrigin.status).toBe(403);

    const foreignOrigin = await request(
      app,
      '/api/customer-auth/change-password',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://attacker.invalid',
          'Sec-Fetch-Site': 'cross-site',
          Cookie: oldCookie,
          'Idempotency-Key': 'customer-password-http-foreign-origin',
        },
        body: JSON.stringify(passwordBody),
      },
    );
    expect(foreignOrigin.status).toBe(403);

    const extraBodyKey = await request(
      app,
      '/api/customer-auth/change-password',
      {
        method: 'POST',
        headers: {
          ...stateHeaders('203.0.113.20'),
          Cookie: oldCookie,
          'Idempotency-Key': 'customer-password-http-extra-body',
        },
        body: JSON.stringify({
          ...passwordBody,
          revoke_other_sessions: false,
        }),
      },
    );
    expect(extraBodyKey.status).toBe(400);

    const changed = await request(
      app,
      '/api/customer-auth/change-password',
      {
        method: 'POST',
        headers: {
          ...stateHeaders('203.0.113.20'),
          Cookie: oldCookie,
          'Idempotency-Key': 'customer-password-http-0001',
        },
        body: JSON.stringify(passwordBody),
      },
    );
    expect(changed.status).toBe(200);
    const newCookie = cookiePair(
      requiredHeader(changed, 'set-cookie'),
    );
    expect(newCookie).not.toBe(oldCookie);
    await expect(json(changed)).resolves.toMatchObject({
      data: {
        session: {
          session_version: 2,
          password_change_required: false,
        },
      },
    });

    const oldSession = await request(
      app,
      '/api/customer-auth/session',
      { headers: { Cookie: oldCookie } },
    );
    expect(oldSession.status).toBe(401);
    expect(requiredHeader(oldSession, 'set-cookie'))
      .toMatch(/Max-Age=0/iu);

    const newSession = await request(
      app,
      '/api/customer-auth/session',
      { headers: { Cookie: newCookie } },
    );
    expect(newSession.status).toBe(200);
    await expect(json(newSession)).resolves.toMatchObject({
      data: {
        session: {
          session_version: 2,
          password_change_required: false,
        },
      },
    });

    const oldPasswordLogin = await login(
      app,
      'buyer_change_01',
      TEMPORARY_PASSWORD,
      '203.0.113.21',
    );
    expect(oldPasswordLogin.status).toBe(401);
    const newPasswordLogin = await login(
      app,
      'buyer_change_01',
      NEW_PASSWORD,
      '203.0.113.22',
    );
    expect(newPasswordLogin.status).toBe(200);
  });

  it('requires same-origin state changes and keeps login failures generic', async () => {
    database = await createPhase4aDatabase();
    const app = testApp();

    const missingOrigin = await request(
      app,
      '/api/customer-auth/buyer/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      },
    );
    expect(missingOrigin.status).toBe(403);

    const crossOrigin = await request(
      app,
      '/api/customer-auth/buyer/login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://attacker.invalid',
          'Sec-Fetch-Site': 'cross-site',
        },
        body: '{}',
      },
    );
    expect(crossOrigin.status).toBe(403);

    for (const payload of [
      {},
      {
        login_identifier: 'unknown_account_01',
        password: 'Wrong-Password-2026!',
      },
    ]) {
      const response = await request(
        app,
        '/api/customer-auth/buyer/login',
        {
          method: 'POST',
          headers: stateHeaders('198.51.100.30'),
          body: JSON.stringify(payload),
        },
      );
      expect(response.status).toBe(401);
      await expect(json(response)).resolves.toMatchObject({
        error: { code: 'INVALID_CREDENTIALS' },
      });
    }
  });

  it('binds login identity to the controlled endpoint and rejects the legacy generic endpoint', async () => {
    database = await createPhase4aDatabase();
    await seedBuyerAccount(database, {
      loginIdentifier: 'buyer_route_01',
      password: TEMPORARY_PASSWORD,
      passwordChangeRequired: false,
    });
    const app = testApp();
    const buyer = await request(app, '/api/customer-auth/buyer/login', {
      method: 'POST', headers: stateHeaders('198.51.100.90'), body: JSON.stringify({
        login_identifier: 'buyer_route_01', password: TEMPORARY_PASSWORD,
      }),
    });
    expect(buyer.status).toBe(200);
    await expect(json(buyer)).resolves.toMatchObject({
      data: { session: { account_type: 'BUYER' } },
    });
    const rejected = await request(app, '/api/customer-auth/buyer/login', {
      method: 'POST', headers: stateHeaders('198.51.100.91'), body: JSON.stringify({
        login_identifier: 'buyer_route_01', password: TEMPORARY_PASSWORD, persona: 'SELLER_MEMBER',
      }),
    });
    expect(rejected.status).toBe(401);
    const legacy = await request(app, '/api/customer-auth/login', {
      method: 'POST', headers: stateHeaders('198.51.100.92'), body: JSON.stringify({
        login_identifier: 'buyer_route_01', password: TEMPORARY_PASSWORD,
      }),
    });
    expect(legacy.status).toBe(404);
  });

  it('clears only the browser cookie on ordinary logout', async () => {
    database = await createPhase4aDatabase();
    await seedBuyerAccount(database, {
      loginIdentifier: 'buyer_logout_01',
      password: TEMPORARY_PASSWORD,
      passwordChangeRequired: false,
    });
    const app = testApp();
    const loginResponse = await login(
      app,
      'buyer_logout_01',
      TEMPORARY_PASSWORD,
      '203.0.113.31',
    );
    const cookie = cookiePair(
      requiredHeader(loginResponse, 'set-cookie'),
    );
    const before = await accountSessionVersion(database);

    const logoutResponse = await request(
      app,
      '/api/customer-auth/logout',
      {
        method: 'POST',
        headers: {
          ...stateHeaders('203.0.113.31'),
          Cookie: cookie,
        },
      },
    );
    expect(logoutResponse.status).toBe(200);
    expect(requiredHeader(logoutResponse, 'set-cookie'))
      .toMatch(/Max-Age=0/iu);
    await expect(json(logoutResponse)).resolves.toMatchObject({
      data: {
        logged_out: true,
        all_devices_logged_out: false,
      },
    });
    expect(await accountSessionVersion(database)).toBe(before);
  });

  it('limits identifier and network dimensions without storing raw values', async () => {
    database = await createPhase4aDatabase();
    const app = testApp();
    const loginIdentifier = 'rate_limit_target_01';
    const sourceIp = '192.0.2.77';

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const response = await login(
        app,
        loginIdentifier,
        'Wrong-Password-2026!',
        sourceIp,
      );
      expect(response.status).toBe(401);
    }
    const blocked = await login(
      app,
      loginIdentifier,
      'Wrong-Password-2026!',
      sourceIp,
    );
    expect(blocked.status).toBe(429);
    expect(Number(requiredHeader(blocked, 'retry-after'))).toBeGreaterThan(0);
    await expect(json(blocked)).resolves.toMatchObject({
      error: { code: 'RATE_LIMITED' },
    });

    const rows = database.raw.prepare(`
      SELECT scope_type, scope_hash, attempt_count
      FROM customer_login_rate_limits
      ORDER BY scope_type
    `).all() as Array<{
      scope_type: string;
      scope_hash: string;
      attempt_count: number;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => /^[0-9a-f]{64}$/u.test(row.scope_hash)))
      .toBe(true);
    expect(JSON.stringify(rows)).not.toContain(loginIdentifier);
    expect(JSON.stringify(rows)).not.toContain(sourceIp);

    const events = database.raw.prepare(`
      SELECT login_identifier_hash, network_source_hash
      FROM customer_auth_security_events
    `).all();
    expect(JSON.stringify(events)).not.toContain(loginIdentifier);
    expect(JSON.stringify(events)).not.toContain(sourceIp);
  });

  it('rate limits password change independently before credential or idempotency mutation', async () => {
    database = await createPhase4aDatabase();
    await seedBuyerAccount(database, {
      loginIdentifier: 'buyer_password_rate_01',
      password: TEMPORARY_PASSWORD,
      passwordChangeRequired: false,
    });
    const app = testApp();
    const loginResponse = await login(
      app,
      'buyer_password_rate_01',
      TEMPORARY_PASSWORD,
      '192.0.2.91',
    );
    const cookie = cookiePair(requiredHeader(loginResponse, 'set-cookie'));

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const response = await request(
        app,
        '/api/customer-auth/change-password',
        {
          method: 'POST',
          headers: {
            ...stateHeaders('192.0.2.91'),
            Cookie: cookie,
            'Idempotency-Key': `password-rate-${attempt}-0001`,
          },
          body: JSON.stringify({
            current_password: 'Wrong-Current-Password-2026!',
            new_password: NEW_PASSWORD,
          }),
        },
      );
      expect(response.status).toBe(401);
    }

    const beforeBlocked = await database.prepare(`
      SELECT
        (SELECT password_version FROM customer_password_credentials
          WHERE account_id='buyer-http-account-1') AS password_version,
        (SELECT session_version FROM customer_login_accounts
          WHERE id='buyer-http-account-1') AS session_version,
        (SELECT COUNT(*) FROM command_idempotency_records) AS commands
    `).first();
    const blocked = await request(
      app,
      '/api/customer-auth/change-password',
      {
        method: 'POST',
        headers: {
          ...stateHeaders('192.0.2.91'),
          Cookie: cookie,
          'Idempotency-Key': 'password-rate-blocked-0001',
        },
        body: JSON.stringify({
          current_password: TEMPORARY_PASSWORD,
          new_password: NEW_PASSWORD,
        }),
      },
    );
    expect(blocked.status).toBe(429);
    expect(Number(requiredHeader(blocked, 'retry-after'))).toBeGreaterThan(0);
    await expect(json(blocked)).resolves.toMatchObject({
      error: { code: 'RATE_LIMITED' },
    });
    expect(await database.prepare(`
      SELECT
        (SELECT password_version FROM customer_password_credentials
          WHERE account_id='buyer-http-account-1') AS password_version,
        (SELECT session_version FROM customer_login_accounts
          WHERE id='buyer-http-account-1') AS session_version,
        (SELECT COUNT(*) FROM command_idempotency_records) AS commands
    `).first()).toEqual(beforeBlocked);

    const rateRows = await database.prepare(`
      SELECT scope_type,scope_hash,attempt_count
      FROM customer_security_rate_limits
      WHERE operation='PASSWORD_CHANGE'
      ORDER BY scope_type
    `).all<{ scope_type: string; scope_hash: string; attempt_count: number }>();
    expect(rateRows.results.map((row) => row.scope_type)).toEqual([
      'ACCOUNT_ID', 'DEVICE', 'NETWORK_SOURCE',
    ]);
    expect(rateRows.results.every((row) => row.attempt_count === 9)).toBe(true);
    expect(rateRows.results.every((row) => /^[0-9a-f]{64}$/u.test(row.scope_hash)))
      .toBe(true);
    expect(JSON.stringify(rateRows.results)).not.toContain('buyer-http-account-1');
    expect(JSON.stringify(rateRows.results)).not.toContain('192.0.2.91');
    expect(JSON.stringify(rateRows.results)).not.toContain('device-http-test');

    const event = await database.prepare(`
      SELECT event_type,outcome,account_id,login_identifier_hash,
        network_source_hash,metadata_json
      FROM customer_auth_security_events
      WHERE event_type='PASSWORD_CHANGE_RATE_LIMITED'
    `).first();
    expect(event).toMatchObject({
      event_type: 'PASSWORD_CHANGE_RATE_LIMITED',
      outcome: 'BLOCKED',
      account_id: 'buyer-http-account-1',
      login_identifier_hash: null,
      metadata_json: '{}',
    });
    expect(event).not.toHaveProperty('current_password');
  });

  it(
    're-reads D1 and rejects revoked buyer and seller organization sessions',
    { timeout: 20_000 },
    async () => {
    database = await createPhase4aDatabase();
    await seedBuyerAccount(database, {
      loginIdentifier: 'buyer_revoke_01',
      password: TEMPORARY_PASSWORD,
      passwordChangeRequired: false,
    });
    const buyerApp = testApp();
    const buyerLogin = await login(
      buyerApp,
      'buyer_revoke_01',
      TEMPORARY_PASSWORD,
      '203.0.113.41',
    );
    const buyerCookie = cookiePair(
      requiredHeader(buyerLogin, 'set-cookie'),
    );
    database.exec(`
      UPDATE buyer_customers
      SET access_status='DISABLED', disabled_at=9000, updated_at=9000
      WHERE id='buyer-http-1';
    `);
    const buyerSession = await request(
      buyerApp,
      '/api/customer-auth/session',
      { headers: { Cookie: buyerCookie } },
    );
    expect(buyerSession.status).toBe(401);
    await expect(json(buyerSession)).resolves.toMatchObject({
      error: { code: 'SESSION_INVALID' },
    });

    database.close();
    database = await createPhase4aDatabase();
    await seedSellerAccount(database, {
      loginIdentifier: 'seller_revoke_01',
      password: TEMPORARY_PASSWORD,
    });
    const sellerApp = testApp();
    const sellerLogin = await login(
      sellerApp,
      'seller_revoke_01',
      TEMPORARY_PASSWORD,
      '203.0.113.42',
      'seller',
    );
    const sellerCookie = cookiePair(
      requiredHeader(sellerLogin, 'set-cookie'),
    );
    database.exec(`
      UPDATE seller_organizations
      SET status='DISABLED', disabled_at=9000, updated_at=9000
      WHERE id='seller-http-org-1';
    `);
    const sellerSession = await request(
      sellerApp,
      '/api/customer-auth/session',
      { headers: { Cookie: sellerCookie } },
    );
    expect(sellerSession.status).toBe(401);
  });

  it('fails closed when the Worker session secret is shorter than 32 bytes', async () => {
    database = await createPhase4aDatabase();
    const app = testApp();
    const response = await app.request(
      `${ORIGIN}/api/customer-auth/buyer/login`,
      {
        method: 'POST',
        headers: stateHeaders('203.0.113.50'),
        body: JSON.stringify({
          login_identifier: 'anything',
          password: 'anything',
        }),
      },
      {
        DB: database,
        CUSTOMER_SESSION_SECRET: 'too-short',
      } as any,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toBeNull();
    await expect(json(response)).resolves.toMatchObject({
      error: { code: 'DEPENDENCY_UNAVAILABLE' },
    });
  });
});

function testApp() {
  const app = createApp();
  registerCustomerAuthRoutes(app);
  app.get(
    '/api/test-protected',
    customerSessionMiddleware(),
    (context: Context<any>) => context.json({ ok: true }),
  );
  return app;
}

async function createPhase4aDatabase(): Promise<SqliteDatabase> {
  const result = createMigratedTestDatabase();
  return result;
}

async function seedBuyerAccount(
  target: SqliteDatabase,
  input: {
    loginIdentifier: string;
    password: string;
    passwordChangeRequired: boolean;
  },
): Promise<void> {
  const credential = await hashCustomerPassword(
    input.password,
    {
      iterations: 10_000,
      salt: new Uint8Array(16).fill(7),
    },
  );
  target.exec(`
    INSERT INTO customer_identity_subjects (
      id, subject_type, created_at
    ) VALUES (
      'buyer-http-subject-1', 'BUYER_CUSTOMER', 1000
    );

    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code,
      buyer_channel_id, buyer_customer_no, buyer_sequence,
      display_name,
      access_status, identity_review_status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES (
      'buyer-http-1', 'buyer-http-subject-1', 'AMAZON_JP',
      'buyer-channel-wechat-b', '19700101B0001', 1, 'HTTP buyer',
      'ACTIVE', 'CLEAR', 1,
      1000, 1000, 1000, NULL
    );
  `);
  await target.prepare(`
    INSERT INTO customer_login_accounts (
      id, identity_subject_id, account_type,
      login_identifier_display, login_identifier_normalized,
      status, session_version, password_change_required,
      version, created_at, updated_at, activated_at, disabled_at
    ) VALUES (
      'buyer-http-account-1', 'buyer-http-subject-1', 'BUYER',
      ?, ?, 'ACTIVE', 1, ?, 1, 1000, 1000, 1000, NULL
    )
  `).bind(
    input.loginIdentifier,
    input.loginIdentifier.toLocaleLowerCase('en-US'),
    input.passwordChangeRequired ? 1 : 0,
  ).run();
  await insertCredential(target, 'buyer-http-account-1', credential);
}

async function seedSellerAccount(
  target: SqliteDatabase,
  input: {
    loginIdentifier: string;
    password: string;
  },
): Promise<void> {
  const credential = await hashCustomerPassword(
    input.password,
    {
      iterations: 10_000,
      salt: new Uint8Array(16).fill(8),
    },
  );
  target.exec(`
    INSERT INTO customer_identity_subjects (
      id, subject_type, created_at
    ) VALUES (
      'seller-http-subject-1', 'SELLER_ORG_MEMBER', 1000
    );

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id, seller_sequence,
      organization_name, status, version,
      created_at, updated_at, activated_at, disabled_at,
      next_member_number
    ) VALUES (
      'seller-http-org-1', 'AMAZON_JP', 'ido-mango-http-1',
      'seller-channel-ido-mango', 'seller-channel-ido-mango', 9001,
      'HTTP seller', 'ACTIVE', 1,
      1000, 1000, 1000, NULL, 2
    );

    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id,
      member_number, username_fallback, display_name,
      role, primary_owner, status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES (
      'seller-http-member-1', 'seller-http-subject-1',
      'seller-http-org-1', 1, 'ido-mango-http-1-001',
      'HTTP owner', 'OWNER', 1, 'ACTIVE', 1,
      1000, 1000, 1000, NULL
    );
  `);
  await target.prepare(`
    INSERT INTO customer_login_accounts (
      id, identity_subject_id, account_type,
      login_identifier_display, login_identifier_normalized,
      status, session_version, password_change_required,
      version, created_at, updated_at, activated_at, disabled_at
    ) VALUES (
      'seller-http-account-1', 'seller-http-subject-1',
      'SELLER_MEMBER', ?, ?, 'ACTIVE', 1, 0,
      1, 1000, 1000, 1000, NULL
    )
  `).bind(
    input.loginIdentifier,
    input.loginIdentifier.toLocaleLowerCase('en-US'),
  ).run();
  await insertCredential(target, 'seller-http-account-1', credential);
}

async function insertCredential(
  target: SqliteDatabase,
  accountId: string,
  credential: {
    algorithm: string;
    iterations: number;
    saltBase64Url: string;
    hashBase64Url: string;
  },
): Promise<void> {
  await target.prepare(`
    INSERT INTO customer_password_credentials (
      account_id, algorithm, iterations,
      salt_base64url, hash_base64url,
      password_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, 1000, 1000)
  `).bind(
    accountId,
    credential.algorithm,
    credential.iterations,
    credential.saltBase64Url,
    credential.hashBase64Url,
  ).run();
}

async function accountSessionVersion(
  target: SqliteDatabase,
): Promise<number> {
  const row = await target.prepare(`
    SELECT session_version
    FROM customer_login_accounts
    LIMIT 1
  `).first<{ session_version: number }>();
  if (!row) throw new Error('missing_test_account');
  return Number(row.session_version);
}

function stateHeaders(sourceIp: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Origin: ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
    'CF-Connecting-IP': sourceIp,
    'X-Device-ID': 'device-http-test',
  };
}

async function login(
  app: ReturnType<typeof testApp>,
  loginIdentifier: string,
  password: string,
  sourceIp: string,
  target: 'buyer' | 'seller' = 'buyer',
): Promise<Response> {
  return request(app, `/api/customer-auth/${target}/login`, {
    method: 'POST',
    headers: stateHeaders(sourceIp),
    body: JSON.stringify({
      login_identifier: loginIdentifier,
      password,
    }),
  });
}

async function request(
  app: ReturnType<typeof testApp>,
  pathname: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!database) throw new Error('test_database_missing');
  return app.request(
    `${ORIGIN}${pathname}`,
    init,
    {
      DB: database,
      CUSTOMER_SESSION_SECRET: SESSION_SECRET,
      CUSTOMER_SECURITY_TOKEN_SECRET: SECURITY_SECRET,
    } as any,
  );
}

function cookiePair(setCookie: string): string {
  const pair = setCookie.split(';', 1)[0];
  if (!pair) throw new Error('set_cookie_missing_pair');
  return pair;
}

function requiredHeader(response: Response, name: string): string {
  const value = response.headers.get(name);
  if (!value) throw new Error(`missing_header:${name}`);
  return value;
}

async function json<T = Record<string, unknown>>(
  response: Response,
): Promise<T> {
  return response.json() as Promise<T>;
}
