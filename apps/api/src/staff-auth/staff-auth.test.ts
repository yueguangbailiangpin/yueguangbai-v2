import { afterEach, describe, expect, it } from 'vitest';
import {
  STAFF_LOGIN_STATE_TTL_MS,
  STAFF_SESSION_COOKIE_NAME,
  STAFF_SESSION_MAX_AGE_SECONDS,
  STAFF_SESSION_TTL_MS,
} from '@ygb/contracts';
import {
  createMigratedTestDatabase,
  SqliteDatabase,
} from '@ygb/testkit';
import app from '../index';
import {
  FakeStaffAuthProvider,
  generateStaffOpaqueToken,
  hashStaffOpaqueToken,
  isAllowedRelativeReturnTo,
  requireStaffAuthConfig,
} from './index';

let database: SqliteDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
});

function env(target: SqliteDatabase) {
  return {
    DB: target,
    STAFF_AUTH_PROVIDER: 'FEISHU' as const,
    STAFF_AUTH_FEISHU_AUTHORIZATION_ENDPOINT:
      'https://open.feishu.cn/open-apis/authen/v1/authorize',
    STAFF_AUTH_FEISHU_TOKEN_ENDPOINT:
      'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
    STAFF_AUTH_FEISHU_IDENTITY_ENDPOINT:
      'https://open.feishu.cn/open-apis/authen/v1/user_info',
    STAFF_AUTH_FEISHU_APP_ID: 'cli_wave13_test',
    STAFF_AUTH_FEISHU_APP_SECRET: 'test-only-app-secret',
    STAFF_AUTH_FEISHU_SCOPE: 'contact:user.base:readonly',
    STAFF_AUTH_FEISHU_TENANT_KEY: 'tenant-wave13',
    STAFF_AUTH_FEISHU_REDIRECT_URI:
      'https://api.example.test/api/staff-auth/feishu/callback',
    STAFF_AUTH_ALLOWED_ORIGINS: 'https://staff.example.test',
    STAFF_AUTH_ALLOWED_RETURN_TO: '/staff',
    STAFF_AUTH_HASH_SECRET: 'wave13-test-hash-secret-at-least-32-characters',
    STAFF_AUTH_PROVIDER_ADAPTER: new FakeStaffAuthProvider({
      provider: 'FEISHU',
      tenantKey: 'tenant-wave13',
      openId: 'open-wave13-owner',
      userId: 'user-wave13-owner',
    }),
  };
}

function seedOwner(target: SqliteDatabase): void {
  target.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'staff-wave13-owner','Wave 13 Owner','ACTIVE',1,1,1,1,NULL
    );
    INSERT INTO feishu_staff_identities (
      id, staff_id, tenant_key, open_id, user_id, status,
      verified_at, created_at, updated_at, revoked_at
    ) VALUES (
      'feishu-wave13-owner','staff-wave13-owner','tenant-wave13',
      'open-wave13-owner','user-wave13-owner','ACTIVE',1,1,1,NULL
    );
    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES (
      'staff-wave13-owner','owner','ACTIVE','staff-wave13-owner',
      1,NULL,1,1
    );
  `);
}

async function login(target: SqliteDatabase): Promise<{
  cookie: string;
  state: string;
}> {
  const bindings = env(target);
  const start = await app.request(
    'https://api.example.test/api/staff-auth/login/start',
    {
      method: 'POST',
      headers: {
        Origin: 'https://staff.example.test',
        'Sec-Fetch-Site': 'same-site',
        'Content-Type': 'application/json',
      },
      body: '{}',
    },
    bindings,
  );
  expect(start.status).toBe(200);
  const startJson = await start.json() as {
    data: { authorization_url: string; expires_at: number };
  };
  const state = new URL(startJson.data.authorization_url)
    .searchParams.get('state');
  expect(state).toHaveLength(43);
  const callback = await app.request(
    `https://api.example.test/api/staff-auth/feishu/callback?code=test-code&state=${state}`,
    { method: 'GET', redirect: 'manual' },
    bindings,
  );
  expect(callback.status).toBe(303);
  expect(callback.headers.get('Location')).toBe('/staff');
  const setCookie = callback.headers.get('Set-Cookie') ?? '';
  expect(setCookie).toContain(`${STAFF_SESSION_COOKIE_NAME}=`);
  expect(setCookie).toContain('HttpOnly');
  expect(setCookie).toContain('Secure');
  expect(setCookie).toContain('SameSite=Lax');
  expect(setCookie).toContain('Path=/');
  expect(setCookie).toContain(`Max-Age=${STAFF_SESSION_MAX_AGE_SECONDS}`);
  expect(setCookie).not.toContain('Domain=');
  return {
    state: state as string,
    cookie: setCookie.split(';')[0] as string,
  };
}

describe('Wave 13 Staff authentication and production entry', () => {
  it('uses 256-bit opaque tokens and fixed absolute TTLs', async () => {
    const token = generateStaffOpaqueToken();
    expect(token).toHaveLength(43);
    expect(await hashStaffOpaqueToken(token)).toMatch(/^[0-9a-f]{64}$/u);
    expect(await hashStaffOpaqueToken(token)).not.toContain(token);
    expect(STAFF_LOGIN_STATE_TTL_MS).toBe(10 * 60 * 1000);
    expect(STAFF_SESSION_TTL_MS).toBe(12 * 60 * 60 * 1000);
    expect(STAFF_SESSION_MAX_AGE_SECONDS).toBe(43_200);
  });

  it('fails closed on missing configuration and only allows allowlisted relative return paths', () => {
    expect(() => requireStaffAuthConfig({})).toThrow();
    expect(isAllowedRelativeReturnTo('/staff')).toBe(true);
    expect(isAllowedRelativeReturnTo('//evil.example')).toBe(false);
    expect(isAllowedRelativeReturnTo('https://evil.example')).toBe(false);
    expect(isAllowedRelativeReturnTo('/staff\\evil')).toBe(false);
  });

  it('runs Fake Feishu start -> callback -> Cookie -> real Staff route', async () => {
    database = createMigratedTestDatabase();
    seedOwner(database);
    const bindings = env(database);
    const { cookie } = await login(database);
    const session = await app.request(
      'https://api.example.test/api/staff-auth/session',
      { headers: { Cookie: cookie } },
      bindings,
    );
    expect(session.status).toBe(200);
    const sessionText = await session.text();
    expect(sessionText).toContain('staff-wave13-owner');
    for (const forbidden of [
      'token_hash', 'access_token', 'app_secret', 'object_key',
    ]) expect(sessionText).not.toContain(forbidden);

    const staffRoute = await app.request(
      'https://api.example.test/api/staff/me/assignments',
      { headers: { Cookie: cookie } },
      bindings,
    );
    expect(staffRoute.status).toBe(200);
  });

  it('rejects missing Cookie and never trusts Feishu headers', async () => {
    database = createMigratedTestDatabase();
    seedOwner(database);
    const response = await app.request(
      'https://api.example.test/api/staff/me/assignments',
      {
        headers: {
          'X-Feishu-Open-Id': 'open-wave13-owner',
          'X-Staff-Id': 'staff-wave13-owner',
        },
      },
      env(database),
    );
    expect(response.status).toBe(401);
  });

  it('rejects callback state replay before Provider exchange', async () => {
    database = createMigratedTestDatabase();
    seedOwner(database);
    const bindings = env(database);
    const { state } = await login(database);
    const replay = await app.request(
      `https://api.example.test/api/staff-auth/feishu/callback?code=other&state=${state}`,
      { method: 'GET', redirect: 'manual' },
      bindings,
    );
    expect(replay.status).toBe(409);
  });

  it('logout-all revokes every session and increments session_version', async () => {
    database = createMigratedTestDatabase();
    seedOwner(database);
    const bindings = env(database);
    const { cookie } = await login(database);
    const response = await app.request(
      'https://api.example.test/api/staff-auth/logout-all',
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: 'https://staff.example.test',
          'Sec-Fetch-Site': 'same-site',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'logout-all-wave13-0001',
        },
        body: '{}',
      },
      bindings,
    );
    expect(response.status).toBe(200);
    expect(await database.prepare(`
      SELECT session_version FROM staff_users
      WHERE id='staff-wave13-owner'
    `).first()).toEqual({ session_version: 2 });
    expect((await database.prepare(`
      SELECT COUNT(*) AS count FROM staff_sessions
      WHERE staff_id='staff-wave13-owner' AND status='ACTIVE'
    `).first<{ count: number }>())?.count).toBe(0);
    const after = await app.request(
      'https://api.example.test/api/staff/me/assignments',
      { headers: { Cookie: cookie } },
      bindings,
    );
    expect(after.status).toBe(401);
  });
});
