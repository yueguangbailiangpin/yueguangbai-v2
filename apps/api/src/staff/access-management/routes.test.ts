import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { StaffPermissionCode } from '@ygb/contracts';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { calculateEffectiveStaffAuthorization } from '../../staff/authorization-policy';
import type { AssignmentStaffAuthorization } from '../../staff-assignment';
import { registerStaffAccessManagementRoutes } from './routes';

let database: SqliteDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
});

describe('staff access management HTTP boundary', () => {
  it('creates email accounts and assigns PRIMARY then SUPPORT per role and Marketplace', async () => {
    database = createMigratedTestDatabase();
    const app = routeApp(owner());
    const first = await createEmployee(app, database, '员工甲', 'staff-a@example.test');
    const second = await createEmployee(app, database, '员工乙', 'staff-b@example.test');
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = (await first.json()) as {
      data: {
        employee: {
          staff_id: string;
          marketplace_scopes: Array<{ code: string; scope_kind: string }>;
        };
      };
    };
    const secondBody = (await second.json()) as {
      data: {
        employee: {
          staff_id: string;
          marketplace_scopes: Array<{ code: string; scope_kind: string }>;
        };
      };
    };
    expect(firstBody.data.employee.marketplace_scopes).toEqual([
      { code: 'AMAZON_JP', scope_kind: 'PRIMARY' },
    ]);
    expect(secondBody.data.employee.marketplace_scopes).toEqual([
      { code: 'AMAZON_JP', scope_kind: 'SUPPORT' },
    ]);

    const overview = await app.request(
      'https://api.example.test/api/staff/access-management',
      undefined,
      { DB: database },
    );
    expect(overview.status).toBe(200);
    expect(overview.headers.get('Cache-Control')).toBe('no-store');
    const text = await overview.text();
    expect(text).toContain('staff-a@example.test');
    expect(text).not.toMatch(/open_id|tenant_key|token_hash|feishu/iu);
  });

  it('promotes SUPPORT when the PRIMARY account is disabled and revokes its sessions', async () => {
    database = createMigratedTestDatabase();
    const app = routeApp(owner());
    const primary = (await (
      await createEmployee(app, database, '员工甲', 'staff-a@example.test')
    ).json()) as { data: { employee: { staff_id: string; version: number } } };
    const support = (await (
      await createEmployee(app, database, '员工乙', 'staff-b@example.test')
    ).json()) as { data: { employee: { staff_id: string } } };
    database.raw
      .prepare(
        `INSERT INTO staff_sessions(id,token_hash,staff_id,issued_session_version,issued_authorization_version,status,expires_at,created_at,updated_at)
      VALUES('staff-access-session',? ,?,1,1,'ACTIVE',9999999999999,1,1)`,
      )
      .run('a'.repeat(64), primary.data.employee.staff_id);
    const response = await app.request(
      `https://api.example.test/api/staff/access-management/employees/${primary.data.employee.staff_id}/status`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'DISABLED',
          expected_version: primary.data.employee.version,
        }),
      },
      { DB: database },
    );
    expect(response.status).toBe(200);
    expect(
      database.raw
        .prepare("SELECT status,revoked_reason FROM staff_sessions WHERE id='staff-access-session'")
        .get(),
    ).toEqual({ status: 'REVOKED', revoked_reason: 'STAFF_ACCESS_STATUS_CHANGED' });
    expect(
      database.raw
        .prepare(
          "SELECT scope_kind FROM staff_marketplace_scopes WHERE staff_id=? AND status='ACTIVE'",
        )
        .get(support.data.employee.staff_id),
    ).toEqual({ scope_kind: 'PRIMARY' });
  });

  it('fails closed for non-owner, Personal DENY and non-exact bodies', async () => {
    database = createMigratedTestDatabase();
    for (const actor of [preSales(), owner(new Set(['STAFF_MANAGE']))]) {
      const response = await routeApp(actor).request(
        'https://api.example.test/api/staff/access-management',
        undefined,
        { DB: database },
      );
      expect(response.status).toBe(403);
    }
    const malformed = await routeApp(owner()).request(
      'https://api.example.test/api/staff/access-management/employees',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: '多余字段',
          email: 'bad@example.test',
          role_code: 'pre_sales',
          marketplace_codes: ['AMAZON_JP'],
          permissions: ['STAFF_MANAGE'],
        }),
      },
      { DB: database },
    );
    expect(malformed.status).toBe(400);
  });
});

function createEmployee(app: Hono<any>, db: SqliteDatabase, name: string, email: string) {
  return app.request(
    'https://api.example.test/api/staff/access-management/employees',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: name,
        email,
        role_code: 'pre_sales',
        marketplace_codes: ['AMAZON_JP'],
      }),
    },
    { DB: db },
  );
}
function routeApp(actor: AssignmentStaffAuthorization): Hono<any> {
  const app = new Hono<any>();
  app.use('*', async (context, next) => {
    context.set('requestId', 'staff-access-route-request');
    context.set('staffAuthorization', actor);
    await next();
  });
  registerStaffAccessManagementRoutes(app);
  return app;
}
function owner(denies: ReadonlySet<StaffPermissionCode> = new Set()): AssignmentStaffAuthorization {
  return authorization('owner', denies);
}
function preSales(): AssignmentStaffAuthorization {
  return authorization('pre_sales', new Set());
}
function authorization(
  role: 'owner' | 'pre_sales',
  denies: ReadonlySet<StaffPermissionCode>,
): AssignmentStaffAuthorization {
  const effective = calculateEffectiveStaffAuthorization({
    roles: new Set([role]),
    grants: new Set(),
    denies: new Set(denies),
    memberTeamIds: [],
    leaderTeamIds: [],
  });
  return {
    staffId: 'zz-phase3h-test-owner',
    displayName: 'Phase 3H Test Owner',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    ...effective,
  };
}
