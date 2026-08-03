import { afterEach, describe, expect, it } from 'vitest';
import {
  STAFF_LOGIN_STATE_TTL_MS,
  STAFF_SESSION_COOKIE_NAME,
  STAFF_SESSION_MAX_AGE_SECONDS,
  STAFF_SESSION_TTL_MS,
  type SqlDatabase,
  type SqlRunResult,
  type SqlStatement,
} from '@ygb/contracts';
import {
  createMigratedTestDatabase,
  SqliteDatabase,
} from '@ygb/testkit';
import app from '../index';
import {
  FakeStaffAuthProvider,
  STAFF_AUTH_CLEANUP_DELETE_LIMIT_PER_TABLE,
  STAFF_AUTH_EPHEMERAL_RETENTION_MS,
  cleanupExpiredStaffAuthEphemeralRecords,
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

function env(target: SqlDatabase) {
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
  const setCookie = callback.headers.getSetCookie().find((header) => (
    header.startsWith(`${STAFF_SESSION_COOKIE_NAME}=`)
      && !header.startsWith(`${STAFF_SESSION_COOKIE_NAME}=;`)
  )) ?? '';
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

  it('cleans only Staff Auth ephemeral rows older than the retention window', async () => {
    database = createMigratedTestDatabase();
    seedOwner(database);
    const now = 3 * STAFF_AUTH_EPHEMERAL_RETENTION_MS;
    const retainedAfter = now - STAFF_AUTH_EPHEMERAL_RETENTION_MS;
    insertLoginState(database, {
      id: 'cleanup-state-old-0001',
      hash: '1'.repeat(64),
      status: 'EXPIRED',
      expiresAt: retainedAfter - 2,
      updatedAt: retainedAfter - 1,
    });
    insertLoginState(database, {
      id: 'cleanup-state-recent-01',
      hash: '2'.repeat(64),
      status: 'EXPIRED',
      expiresAt: retainedAfter + 1,
      updatedAt: retainedAfter + 1,
    });
    insertLoginState(database, {
      id: 'cleanup-state-issued-01',
      hash: '3'.repeat(64),
      status: 'ISSUED',
      expiresAt: now + 1,
      updatedAt: 1,
    });
    insertRateLimit(database, {
      id: 'cleanup-rate-old-00001',
      hash: '4'.repeat(64),
      windowEndsAt: retainedAfter - 1,
      blockedUntil: null,
    });
    insertRateLimit(database, {
      id: 'cleanup-rate-current-01',
      hash: '5'.repeat(64),
      windowEndsAt: now + 1,
      blockedUntil: null,
    });
    insertRateLimit(database, {
      id: 'cleanup-rate-blocked-01',
      hash: '6'.repeat(64),
      windowEndsAt: retainedAfter - 1,
      blockedUntil: now + 1,
    });
    database.exec(`
      INSERT INTO staff_auth_security_events (
        id,event_type,outcome,provider,metadata_json,created_at
      ) VALUES (
        'cleanup-security-event-01','STATE_INVALID','REJECTED',
        'FEISHU','{}',1
      );
      INSERT INTO staff_sessions (
        id,token_hash,staff_id,issued_session_version,
        issued_authorization_version,status,expires_at,
        created_at,updated_at
      ) VALUES (
        'cleanup-staff-session-01','${'7'.repeat(64)}',
        'staff-wave13-owner',1,1,'ACTIVE',${now + 1000},1,1
      );
    `);

    expect(await cleanupExpiredStaffAuthEphemeralRecords(database, now))
      .toEqual({
        staffLoginStatesDeleted: 1,
        staffAuthRateLimitsDeleted: 1,
      });
    expect(ids(database, 'staff_login_states')).toEqual([
      'cleanup-state-issued-01',
      'cleanup-state-recent-01',
    ]);
    expect(ids(database, 'staff_auth_rate_limits')).toEqual([
      'cleanup-rate-blocked-01',
      'cleanup-rate-current-01',
    ]);
    expect(count(database, 'staff_auth_security_events')).toBe(1);
    expect(count(database, 'staff_sessions')).toBe(1);
  });

  it('deletes at most 100 rows per table and continues on the next call', async () => {
    database = createMigratedTestDatabase();
    const now = 3 * STAFF_AUTH_EPHEMERAL_RETENTION_MS;
    const retainedAfter = now - STAFF_AUTH_EPHEMERAL_RETENTION_MS;
    for (let index = 0; index < 102; index += 1) {
      const suffix = index.toString().padStart(4, '0');
      insertLoginState(database, {
        id: `cleanup-batch-state-${suffix}`,
        hash: index.toString(16).padStart(64, '0'),
        status: 'EXPIRED',
        expiresAt: retainedAfter - 2,
        updatedAt: retainedAfter - 1,
      });
      insertRateLimit(database, {
        id: `cleanup-batch-rate-${suffix}`,
        hash: (index + 1024).toString(16).padStart(64, '0'),
        windowEndsAt: retainedAfter - 1,
        blockedUntil: null,
      });
    }
    expect(STAFF_AUTH_CLEANUP_DELETE_LIMIT_PER_TABLE).toBe(100);
    expect(await cleanupExpiredStaffAuthEphemeralRecords(database, now))
      .toEqual({
        staffLoginStatesDeleted: 100,
        staffAuthRateLimitsDeleted: 100,
      });
    expect(count(database, 'staff_login_states')).toBe(2);
    expect(count(database, 'staff_auth_rate_limits')).toBe(2);
    expect(await cleanupExpiredStaffAuthEphemeralRecords(database, now))
      .toEqual({
        staffLoginStatesDeleted: 2,
        staffAuthRateLimitsDeleted: 2,
      });
    expect(count(database, 'staff_login_states')).toBe(0);
    expect(count(database, 'staff_auth_rate_limits')).toBe(0);
  });

  it('rejects an unsafe cleanup clock without deleting records', async () => {
    database = createMigratedTestDatabase();
    await expect(cleanupExpiredStaffAuthEphemeralRecords(database, -1))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    await expect(cleanupExpiredStaffAuthEphemeralRecords(
      database,
      Number.MAX_SAFE_INTEGER + 1,
    )).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('fails login/start closed before creating State or Rate Limit rows', async () => {
    database = createMigratedTestDatabase();
    const response = await app.request(
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
      env(new FailFirstBatchDatabase(database)),
    );
    expect(response.status).toBe(503);
    expect(count(database, 'staff_login_states')).toBe(0);
    expect(count(database, 'staff_auth_rate_limits')).toBe(0);
  });

  it('fails callback closed before consuming State or creating Session', async () => {
    database = createMigratedTestDatabase();
    seedOwner(database);
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
      env(database),
    );
    const body = await start.json() as {
      data: { authorization_url: string };
    };
    const state = new URL(body.data.authorization_url)
      .searchParams.get('state');
    expect(state).toHaveLength(43);
    const response = await app.request(
      `https://api.example.test/api/staff-auth/feishu/callback?code=test&state=${state}`,
      { method: 'GET', redirect: 'manual' },
      env(new FailFirstBatchDatabase(database)),
    );
    expect(response.status).toBe(503);
    expect(database.raw.prepare(`
      SELECT status FROM staff_login_states
    `).get()).toEqual({ status: 'ISSUED' });
    expect(count(database, 'staff_sessions')).toBe(0);
  });
});

interface LoginStateFixture {
  id: string;
  hash: string;
  status: 'ISSUED' | 'EXPIRED';
  expiresAt: number;
  updatedAt: number;
}

function insertLoginState(
  target: SqliteDatabase,
  fixture: LoginStateFixture,
): void {
  target.raw.prepare(`
    INSERT INTO staff_login_states (
      id,state_hash,provider,tenant_key,callback_purpose,return_to,status,
      expires_at,consumed_at,cancelled_at,created_at,updated_at
    ) VALUES (?,?,'FEISHU','cleanup-tenant','STAFF_LOGIN','/staff',?,
      ?,NULL,NULL,1,?)
  `).run(
    fixture.id,
    fixture.hash,
    fixture.status,
    fixture.expiresAt,
    fixture.updatedAt,
  );
}

interface RateLimitFixture {
  id: string;
  hash: string;
  windowEndsAt: number;
  blockedUntil: number | null;
}

function insertRateLimit(
  target: SqliteDatabase,
  fixture: RateLimitFixture,
): void {
  target.raw.prepare(`
    INSERT INTO staff_auth_rate_limits (
      id,action,scope_type,scope_hash,window_started_at,window_ends_at,
      attempt_count,blocked_until,created_at,updated_at
    ) VALUES (?,'LOGIN_START','NETWORK',?,1,?,1,?,1,1)
  `).run(
    fixture.id,
    fixture.hash,
    fixture.windowEndsAt,
    fixture.blockedUntil,
  );
}

function ids(target: SqliteDatabase, table: string): string[] {
  if (table !== 'staff_login_states' && table !== 'staff_auth_rate_limits') {
    throw new Error('invalid_cleanup_table');
  }
  return target.raw.prepare(`SELECT id FROM ${table} ORDER BY id`)
    .all().map((row) => String(row['id']));
}

function count(target: SqliteDatabase, table: string): number {
  const allowed = new Set([
    'staff_login_states',
    'staff_auth_rate_limits',
    'staff_auth_security_events',
    'staff_sessions',
  ]);
  if (!allowed.has(table)) throw new Error('invalid_cleanup_table');
  const row = target.raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`)
    .get() as { count: number };
  return Number(row.count);
}

class FailFirstBatchDatabase implements SqlDatabase {
  private failed = false;

  constructor(private readonly target: SqlDatabase) {}

  prepare(sql: string): SqlStatement {
    return this.target.prepare(sql);
  }

  batch(statements: readonly SqlStatement[]): Promise<SqlRunResult[]> {
    if (!this.failed) {
      this.failed = true;
      return Promise.reject(new Error('injected_cleanup_failure'));
    }
    return this.target.batch(statements);
  }
}
