import { afterEach, describe, expect, it } from 'vitest';
import { STAFF_SESSION_COOKIE_NAME } from '@ygb/contracts';
import {
  createMigratedTestDatabase,
  SqliteDatabase,
} from '@ygb/testkit';
import app from '../index';
import { readCommittedLogoutAllReplay } from './logout-all-replay';
import { FakeStaffAuthProvider } from './provider';

let database: SqliteDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
});

function bindings(target: SqliteDatabase) {
  return {
    DB: target,
    STAFF_AUTH_PROVIDER: 'FEISHU' as const,
    STAFF_AUTH_FEISHU_AUTHORIZATION_ENDPOINT:
      'https://open.feishu.cn/open-apis/authen/v1/authorize',
    STAFF_AUTH_FEISHU_TOKEN_ENDPOINT:
      'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
    STAFF_AUTH_FEISHU_IDENTITY_ENDPOINT:
      'https://open.feishu.cn/open-apis/authen/v1/user_info',
    STAFF_AUTH_FEISHU_APP_ID: 'cli_logout_all_replay',
    STAFF_AUTH_FEISHU_APP_SECRET: 'test-only-app-secret',
    STAFF_AUTH_FEISHU_SCOPE: 'contact:user.base:readonly',
    STAFF_AUTH_FEISHU_TENANT_KEY: 'tenant-logout-all',
    STAFF_AUTH_FEISHU_REDIRECT_URI:
      'https://api.example.test/api/staff-auth/feishu/callback',
    STAFF_AUTH_ALLOWED_ORIGINS: 'https://staff.example.test',
    STAFF_AUTH_ALLOWED_RETURN_TO: '/staff',
    STAFF_AUTH_HASH_SECRET:
      'logout-all-replay-test-secret-at-least-32-characters',
    STAFF_AUTH_PROVIDER_ADAPTER: new FakeStaffAuthProvider({
      provider: 'FEISHU',
      tenantKey: 'tenant-logout-all',
      openId: 'open-logout-all-owner',
      userId: 'user-logout-all-owner',
    }),
  };
}

function seedOwner(target: SqliteDatabase): void {
  target.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'staff-logout-all-owner','Logout All Owner','ACTIVE',1,1,1,1,NULL
    );
    INSERT INTO feishu_staff_identities (
      id, staff_id, tenant_key, open_id, user_id, status,
      verified_at, created_at, updated_at, revoked_at
    ) VALUES (
      'feishu-logout-all-owner','staff-logout-all-owner','tenant-logout-all',
      'open-logout-all-owner','user-logout-all-owner','ACTIVE',1,1,1,NULL
    );
    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES (
      'staff-logout-all-owner','owner','ACTIVE','staff-logout-all-owner',
      1,NULL,1,1
    );
  `);
}

async function login(target: SqliteDatabase): Promise<string> {
  const env = bindings(target);
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
    env,
  );
  expect(start.status).toBe(200);
  const body = await start.json() as {
    data: { authorization_url: string };
  };
  const state = new URL(body.data.authorization_url)
    .searchParams.get('state');
  expect(state).toHaveLength(43);
  const callback = await app.request(
    `https://api.example.test/api/staff-auth/feishu/callback?code=test&state=${state}`,
    { method: 'GET', redirect: 'manual' },
    env,
  );
  expect(callback.status).toBe(303);
  const setCookie = callback.headers.getSetCookie().find((header) => (
    header.startsWith(`${STAFF_SESSION_COOKIE_NAME}=`)
      && !header.startsWith(`${STAFF_SESSION_COOKIE_NAME}=;`)
  )) ?? '';
  expect(setCookie).toContain(`${STAFF_SESSION_COOKIE_NAME}=`);
  return setCookie.split(';')[0] as string;
}

function logoutAllRequest(cookie: string, key: string): Request {
  return new Request(
    'https://api.example.test/api/staff-auth/logout-all',
    {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: 'https://staff.example.test',
        'Sec-Fetch-Site': 'same-site',
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: '{}',
    },
  );
}

async function counts(target: SqliteDatabase) {
  const staff = await target.prepare(`
    SELECT session_version FROM staff_users
    WHERE id='staff-logout-all-owner'
  `).first<{ session_version: number }>();
  const audit = await target.prepare(`
    SELECT COUNT(*) AS count FROM audit_events
    WHERE aggregate_type='STAFF_USER'
      AND aggregate_id='staff-logout-all-owner'
      AND event_type='STAFF_LOGOUT_ALL'
  `).first<{ count: number }>();
  const idempotency = await target.prepare(`
    SELECT COUNT(*) AS count FROM command_idempotency_records
    WHERE actor_type='STAFF'
      AND actor_id='staff-logout-all-owner'
      AND action='STAFF_LOGOUT_ALL'
  `).first<{ count: number }>();
  return {
    sessionVersion: Number(staff?.session_version),
    audit: Number(audit?.count),
    idempotency: Number(idempotency?.count),
  };
}

describe('Staff logout-all replay safety', () => {
  it('returns the committed response for the same revoked Cookie and key', async () => {
    database = createMigratedTestDatabase();
    seedOwner(database);
    const env = bindings(database);
    const cookie = await login(database);
    const key = 'logout-all-replay-key-0001';

    const first = await app.request(logoutAllRequest(cookie, key), undefined, env);
    expect(first.status).toBe(200);
    const firstBody = await first.json() as {
      data: {
        logged_out: boolean;
        all_devices_logged_out: boolean;
        session_version: number;
      };
    };
    expect(firstBody.data).toEqual({
      logged_out: true,
      all_devices_logged_out: true,
      session_version: 2,
    });

    const replay = await app.request(logoutAllRequest(cookie, key), undefined, env);
    expect(replay.status).toBe(200);
    const replayBody = await replay.json() as typeof firstBody;
    expect(replayBody.data).toEqual(firstBody.data);
    expect(replay.headers.get('Set-Cookie')).toContain(
      `${STAFF_SESSION_COOKIE_NAME}=`,
    );

    expect(await counts(database)).toEqual({
      sessionVersion: 2,
      audit: 1,
      idempotency: 1,
    });
    const oldSessionRoute = await app.request(
      'https://api.example.test/api/staff/me/assignments',
      { headers: { Cookie: cookie } },
      env,
    );
    expect(oldSessionRoute.status).toBe(401);

    const token = cookie.slice(cookie.indexOf('=') + 1);
    expect(await readCommittedLogoutAllReplay(database, {
      sessionToken: token,
      idempotencyKey: key,
      now: Date.now() + 13 * 60 * 60 * 1000,
    })).toBeNull();
  });

  it('rejects different keys, forged Cookies and non-LOGOUT_ALL revocations', async () => {
    database = createMigratedTestDatabase();
    seedOwner(database);
    const env = bindings(database);
    const cookie = await login(database);
    const first = await app.request(
      logoutAllRequest(cookie, 'logout-all-replay-key-0002'),
      undefined,
      env,
    );
    expect(first.status).toBe(200);
    expect((await app.request(
      logoutAllRequest(cookie, 'logout-all-replay-key-other'),
      undefined,
      env,
    )).status).toBe(401);
    expect((await app.request(
      logoutAllRequest(
        `${STAFF_SESSION_COOKIE_NAME}=forged-session-token-value-0000000000000`,
        'logout-all-forged-cookie-key',
      ),
      undefined,
      env,
    )).status).toBe(401);

    const secondCookie = await login(database);
    const normalLogout = await app.request(
      'https://api.example.test/api/staff-auth/logout',
      {
        method: 'POST',
        headers: { Cookie: secondCookie },
      },
      env,
    );
    expect(normalLogout.status).toBe(200);
    expect((await app.request(
      logoutAllRequest(secondCookie, 'logout-all-after-normal-logout'),
      undefined,
      env,
    )).status).toBe(401);
    expect((await counts(database)).sessionVersion).toBe(2);
  });

  it('commits concurrent same-key requests at most once', async () => {
    database = createMigratedTestDatabase();
    seedOwner(database);
    const env = bindings(database);
    const cookie = await login(database);
    const key = 'logout-all-concurrent-key-0001';
    const [left, right] = await Promise.all([
      app.request(logoutAllRequest(cookie, key), undefined, env),
      app.request(logoutAllRequest(cookie, key), undefined, env),
    ]);
    expect([left.status, right.status]).toContain(200);
    expect([200, 409]).toContain(left.status);
    expect([200, 409]).toContain(right.status);
    expect(await counts(database)).toEqual({
      sessionVersion: 2,
      audit: 1,
      idempotency: 1,
    });
  });
});
