import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { createApp } from '../app';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  registerPublicCustomerSecurityRoutes,
  registerStaffCustomerSecurityRoutes,
} from './routes';

const ORIGIN = 'https://api.local.test';
const SECRET = 'route-customer-security-secret-at-least-32-bytes';
let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('customer security HTTP authorization and concealment', () => {
  it('rejects cross-site Staff invitation writes before any security fact', async () => {
    database = createDb();
    const app = staffApp();
    const response = await app.request(
      `${ORIGIN}/api/staff/customer-security/buyer-invitations`, {
        method: 'POST', headers: {
          ...headers('staff-cross-site-0001'),
          Origin: 'https://evil.example.test',
          'Sec-Fetch-Site': 'cross-site',
        },
        body: JSON.stringify({
          wechat_id: 'route_wx', marketplace_code: 'AMAZON_JP',
        }),
      }, env(),
    );
    expect(response.status).toBe(403);
    expect(await database.prepare(`
      SELECT COUNT(*) AS count FROM customer_buyer_invitations
    `).first()).toEqual({ count: 0 });
  });

  it('allows an ordinary ACTIVE Staff to issue, read and revoke an invitation', async () => {
    database = createDb();
    const app = staffApp();
    const issuedResponse = await app.request(`${ORIGIN}/api/staff/customer-security/buyer-invitations`, {
      method: 'POST', headers: headers('staff-invite-route-0001'),
      body: JSON.stringify({ wechat_id: 'route_wx', marketplace_code: 'AMAZON_JP' }),
    }, env());
    expect(issuedResponse.status).toBe(201);
    const issued = await issuedResponse.json() as any;
    expect(issued.data.invitation.registration_token).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const id = issued.data.invitation.invitation_id;
    const read = await app.request(`${ORIGIN}/api/staff/customer-security/buyer-invitations/${id}`, {}, env());
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      data: { invitation: { status: 'ACTIVE', wechat_id: 'route_wx' } },
    });

    const revoked = await app.request(
      `${ORIGIN}/api/staff/customer-security/buyer-invitations/${id}/revoke`,
      { method: 'POST', headers: headers('staff-revoke-route-0001'),
        body: JSON.stringify({ expected_version: 1 }) }, env(),
    );
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({
      data: { invitation: { status: 'REVOKED', version: 2 } },
    });
  });

  it('rejects Staff-supplied passwords and requires explicit manual verification', async () => {
    database = createDb();
    const app = staffApp();
    const response = await app.request(`${ORIGIN}/api/staff/customer-security/password-resets`, {
      method: 'POST', headers: headers('staff-reset-bad-0001'),
      body: JSON.stringify({
        wechat_id: 'route_wx', manual_verification_confirmed: true,
        verification_note: '已通过人工微信核验', new_password: 'staff-must-not-set',
      }),
    }, env());
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain('staff-must-not-set');
  });

  it('returns the same public recovery error without account enumeration', async () => {
    database = createDb();
    const app = createApp();
    registerPublicCustomerSecurityRoutes(app);
    const request = (token: string, key: string) => app.request(
      `${ORIGIN}/api/customer-auth/password-reset/complete`, {
        method: 'POST', headers: headers(key), body: JSON.stringify({
          token, new_password: 'New-Strong-Password-2026!',
          password_confirmation: 'New-Strong-Password-2026!',
        }),
      }, env(),
    );
    const first = await request('a'.repeat(43), 'public-reset-a-0001');
    const second = await request('b'.repeat(43), 'public-reset-b-0001');
    expect(first.status).toBe(409);
    expect(second.status).toBe(409);
    expect((await first.json() as any).error.message)
      .toBe((await second.json() as any).error.message);
  });

  it('rate limits public recovery by hashed token, network and device keys', async () => {
    database = createDb();
    const app = createApp();
    registerPublicCustomerSecurityRoutes(app);
    const token = 'rate-limit-token'.padEnd(43, 'x');
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const response = await app.request(
        `${ORIGIN}/api/customer-auth/password-reset/complete`, {
          method: 'POST', headers: headers(`public-rate-${attempt}-0001`),
          body: JSON.stringify({
            token, new_password: 'New-Strong-Password-2026!',
            password_confirmation: 'New-Strong-Password-2026!',
          }),
        }, env(),
      );
      statuses.push(response.status);
    }
    expect(statuses).toEqual([409, 409, 409, 409, 409, 409, 409, 409, 429]);
    const rows = await database.prepare(`
      SELECT scope_hash FROM customer_security_rate_limits
      WHERE operation='PASSWORD_RESET'
    `).all<{ scope_hash: string }>();
    expect(rows.results).toHaveLength(3);
    expect(rows.results.every((row) => /^[0-9a-f]{64}$/u.test(row.scope_hash)))
      .toBe(true);
    expect(JSON.stringify(rows.results)).not.toContain(token);
  });
});

function staffApp() {
  const app = createApp();
  app.use('/api/staff/*', async (context, next) => {
    context.set('staffAuthorization', actor());
    await next();
  });
  registerStaffCustomerSecurityRoutes(app);
  return app;
}

function createDb() {
  const db = createMigratedTestDatabase();
  db.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version, version,
      created_at, updated_at, disabled_at, session_version
    ) VALUES ('staff-route', '普通客服', 'ACTIVE', 1, 1,
      1000, 1000, NULL, 1);
  `);
  return db;
}

function actor(): AssignmentStaffAuthorization {
  return {
    staffId: 'staff-route', displayName: '普通客服', staffStatus: 'ACTIVE',
    authorizationVersion: 1, roles: new Set(['pre_sales']),
    permissions: new Set(), memberTeamIds: ['team-route'], leaderTeamIds: [],
  };
}

function env() {
  return { DB: database!, CUSTOMER_SECURITY_TOKEN_SECRET: SECRET };
}

function headers(key: string) {
  return {
    'Content-Type': 'application/json', Origin: ORIGIN,
    'Sec-Fetch-Site': 'same-origin', 'Idempotency-Key': key,
    'X-Device-ID': 'device-route-test', 'CF-Connecting-IP': '203.0.113.20',
  };
}
