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

  it('sets and transfers the buyer refund owner with reason, replay and audit', async () => {
    database = createMigratedTestDatabase();
    const app = routeApp(owner());
    const refundOwner = (await (
      await createEmployee(app, database, '返款负责人', 'refund-a@example.test', 'buyer_refund')
    ).json()) as { data: { employee: { staff_id: string } } };
    const replacement = (await (
      await createEmployee(app, database, '返款接替', 'refund-b@example.test', 'buyer_refund')
    ).json()) as { data: { employee: { staff_id: string } } };
    seedBuyer(database, 'buyer-r1', 'Buyer R1');

    const list = await app.request(
      'https://api.example.test/api/staff/access-management/buyer-assignments',
      undefined,
      { DB: database },
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      data: { buyers: Array<{ buyer_customer_id: string; refund_owner: unknown }> };
    };
    const before = listBody.data.buyers.find((buyer) => buyer.buyer_customer_id === 'buyer-r1');
    expect(before?.refund_owner).toBeNull();

    const assign = await app.request(
      'https://api.example.test/api/staff/access-management/buyer-assignments',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'buyer-refund-owner-set-1',
        },
        body: JSON.stringify({
          buyer_customer_id: 'buyer-r1',
          assigned_staff_id: refundOwner.data.employee.staff_id,
          expected_assignment_version: 0,
          reason: 'first binding',
        }),
      },
      { DB: database },
    );
    expect(assign.status).toBe(200);
    const assignBody = (await assign.json()) as {
      data: { buyer: { refund_owner: { staff_id: string; version: number } }; replayed: boolean };
    };
    expect(assignBody.data.buyer.refund_owner.staff_id).toBe(refundOwner.data.employee.staff_id);
    expect(assignBody.data.replayed).toBe(false);
    expect(
      database.raw
        .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='BUYER_REFUND_OWNER_CHANGED'")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database.raw
        .prepare(
          `SELECT COUNT(*) AS count FROM buyer_staff_assignments
          WHERE buyer_customer_id='buyer-r1' AND duty_code='BUYER_REFUND_OWNER' AND status='ACTIVE'`,
        )
        .get(),
    ).toEqual({ count: 1 });

    const replay = await app.request(
      'https://api.example.test/api/staff/access-management/buyer-assignments',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'buyer-refund-owner-set-1',
        },
        body: JSON.stringify({
          buyer_customer_id: 'buyer-r1',
          assigned_staff_id: refundOwner.data.employee.staff_id,
          expected_assignment_version: 0,
          reason: 'first binding',
        }),
      },
      { DB: database },
    );
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { data: { replayed: boolean } }).data.replayed).toBe(true);

    // The replacement buyer_refund staff starts as SUPPORT (one PRIMARY per
    // marketplace); disabling the first holder promotes it, mirroring the
    // real remediation flow before a fixed-duty transfer.
    const firstEmployee = (await (
      await app.request(
        'https://api.example.test/api/staff/access-management',
        undefined,
        { DB: database },
      )
    ).json()) as { data: { employees: Array<{ staff_id: string; version: number }> } };
    const firstVersion = firstEmployee.data.employees.find(
      (employee) => employee.staff_id === refundOwner.data.employee.staff_id,
    )?.version;
    const disableFirst = await app.request(
      `https://api.example.test/api/staff/access-management/employees/${refundOwner.data.employee.staff_id}/status`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'DISABLED', expected_version: firstVersion }),
      },
      { DB: database },
    );
    expect(disableFirst.status).toBe(200);

    const transfer = await app.request(
      'https://api.example.test/api/staff/access-management/buyer-assignments',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'buyer-refund-owner-set-2',
        },
        body: JSON.stringify({
          buyer_customer_id: 'buyer-r1',
          assigned_staff_id: replacement.data.employee.staff_id,
          expected_assignment_version: assignBody.data.buyer.refund_owner.version,
          reason: 'owner on leave',
        }),
      },
      { DB: database },
    );
    expect(transfer.status).toBe(200);
    expect(
      database.raw
        .prepare(
          `SELECT COUNT(*) AS count FROM buyer_staff_assignments
          WHERE buyer_customer_id='buyer-r1' AND duty_code='BUYER_REFUND_OWNER' AND status='ACTIVE'`,
        )
        .get(),
    ).toEqual({ count: 1 });

    const staleVersion = await app.request(
      'https://api.example.test/api/staff/access-management/buyer-assignments',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'buyer-refund-owner-set-3',
        },
        body: JSON.stringify({
          buyer_customer_id: 'buyer-r1',
          assigned_staff_id: replacement.data.employee.staff_id,
          expected_assignment_version: 0,
          reason: 'stale version',
        }),
      },
      { DB: database },
    );
    expect(staleVersion.status).toBe(409);
  });

  it('rejects buyer refund owner binding to an ineligible role', async () => {
    database = createMigratedTestDatabase();
    const app = routeApp(owner());
    const notRefundStaff = (await (
      await createEmployee(app, database, '售前员工', 'pre-a@example.test', 'pre_sales')
    ).json()) as { data: { employee: { staff_id: string } } };
    seedBuyer(database, 'buyer-r2', 'Buyer R2');
    const response = await app.request(
      'https://api.example.test/api/staff/access-management/buyer-assignments',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'buyer-refund-owner-invalid-role',
        },
        body: JSON.stringify({
          buyer_customer_id: 'buyer-r2',
          assigned_staff_id: notRefundStaff.data.employee.staff_id,
          expected_assignment_version: 0,
          reason: 'wrong role',
        }),
      },
      { DB: database },
    );
    expect(response.status).toBe(409);
  });
});

function createEmployee(
  app: Hono<any>,
  db: SqliteDatabase,
  name: string,
  email: string,
  roleCode: 'pre_sales' | 'buyer_refund' = 'pre_sales',
) {
  return app.request(
    'https://api.example.test/api/staff/access-management/employees',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: name,
        email,
        role_code: roleCode,
        marketplace_codes: ['AMAZON_JP'],
      }),
    },
    { DB: db },
  );
}
function seedBuyer(db: SqliteDatabase, id: string, displayName: string): void {
  db.exec(`
    INSERT INTO customer_identity_subjects (id, subject_type, created_at)
    VALUES ('${id}-subject','BUYER_CUSTOMER',1);
    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code, buyer_channel_id,
      buyer_customer_no, buyer_sequence, display_name, access_status,
      identity_review_status, version, created_at, updated_at, disabled_at
    ) VALUES ('${id}','${id}-subject','AMAZON_JP','buyer-channel-wechat-b',
      '19700101B0099', 99, '${displayName}','DISABLED','CLEAR',1,1,1,1);
  `);
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
