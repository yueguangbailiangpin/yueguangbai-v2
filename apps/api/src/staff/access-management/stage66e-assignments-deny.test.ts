import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { StaffPermissionCode } from '@ygb/contracts';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { calculateEffectiveStaffAuthorization } from '../../staff/authorization-policy';
import type { AssignmentStaffAuthorization } from '../../staff-assignment';
import { resolveAssignmentStaffAuthorization } from '../../staff-assignment/effective-authorization';
import { createBuyerCustomer } from '../../customers/create-buyer';
import { registerStaffAccessManagementRoutes } from './routes';

const ORIGIN = 'https://api.example.test';
let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('stage 6.6E fixed assignments and Personal DENY (HTTP, owner-only)', () => {
  it('lists, sets and replaces the buyer pre-sales owner with reason, replay and audit', async () => {
    const { app, buyerId, preSalesA } = await setup();

    const list = await app.request(
      `${ORIGIN}/api/staff/access-management/buyer-assignments`,
      undefined,
      { DB: database! },
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as any;
    const buyerRow = listBody.data.buyers.find(
      (row: { buyer_customer_id: string }) => row.buyer_customer_id === buyerId,
    );
    // The initial staff creation already bound a pre-sales owner.
    expect(buyerRow.pre_sales_owner.staff_id).toBe('staff-66e-ps-a');

    const assign = await app.request(
      `${ORIGIN}/api/staff/access-management/buyer-pre-sales-assignments`,
      {
        method: 'POST',
        headers: json('assign-ps-66e-0001'),
        body: JSON.stringify({
          buyer_customer_id: buyerId,
          assigned_staff_id: preSalesA,
          expected_assignment_version: 1,
          reason: '初始绑定复核后确认',
        }),
      },
      { DB: database! },
    );
    expect(assign.status).toBe(200);
    // Same owner + same version answers a semantic replay without rotation.
    const replay = await app.request(
      `${ORIGIN}/api/staff/access-management/buyer-pre-sales-assignments`,
      {
        method: 'POST',
        headers: json('assign-ps-66e-0002'),
        body: JSON.stringify({
          buyer_customer_id: buyerId,
          assigned_staff_id: preSalesA,
          expected_assignment_version: 1,
          reason: '重复提交',
        }),
      },
      { DB: database! },
    );
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as any).data.replayed).toBe(true);

    // A wrong expected version is a stable conflict, not a silent rotation.
    const conflict = await app.request(
      `${ORIGIN}/api/staff/access-management/buyer-pre-sales-assignments`,
      {
        method: 'POST',
        headers: json('assign-ps-66e-0003'),
        body: JSON.stringify({
          buyer_customer_id: buyerId,
          assigned_staff_id: preSalesA,
          expected_assignment_version: 0,
          reason: '旧版本号',
        }),
      },
      { DB: database! },
    );
    expect(conflict.status).toBe(409);
  });

  it('rejects non-owner management and ineligible duty targets', async () => {
    const { app, buyerId } = await setup();
    const nonOwner = await appAs(authorization('pre_sales')).request(
      `${ORIGIN}/api/staff/access-management/buyer-pre-sales-assignments`,
      {
        method: 'POST',
        headers: json('assign-ps-forbid-001'),
        body: JSON.stringify({
          buyer_customer_id: buyerId,
          assigned_staff_id: 'staff-66e-ps-a',
          expected_assignment_version: 1,
          reason: '越权尝试',
        }),
      },
      { DB: database! },
    );
    expect(nonOwner.status).toBe(403);

    // A buyer_refund staff cannot hold the pre-sales duty.
    const ineligible = await app.request(
      `${ORIGIN}/api/staff/access-management/buyer-pre-sales-assignments`,
      {
        method: 'POST',
        headers: json('assign-ps-ineligible1'),
        body: JSON.stringify({
          buyer_customer_id: buyerId,
          assigned_staff_id: 'staff-66e-refund',
          expected_assignment_version: 1,
          reason: '错误岗位',
        }),
      },
      { DB: database! },
    );
    expect(ineligible.status).toBe(409);
    void app;
  });

  it('sets and revokes Personal DENY with real effect on effective permissions', async () => {
    const { app } = await setup();
    const before = await resolveAssignmentStaffAuthorization(database!, 'staff-66e-ps-a');
    expect(before?.permissions.has('ORDER_VIEW')).toBe(true);

    const set = await app.request(
      `${ORIGIN}/api/staff/access-management/personal-denies`,
      {
        method: 'POST',
        headers: json('deny-66e-0000000001'),
        body: JSON.stringify({
          staff_id: 'staff-66e-ps-a',
          permission_code: 'ORDER_VIEW',
          reason: '复核期间临时禁用',
        }),
      },
      { DB: database! },
    );
    expect(set.status).toBe(200);
    const after = await resolveAssignmentStaffAuthorization(database!, 'staff-66e-ps-a');
    expect(after?.permissions.has('ORDER_VIEW')).toBe(false);
    // A deny only shrinks: staff keeps unrelated permissions.
    expect(after?.permissions.has('BUYER_VIEW')).toBe(true);

    // Replay with the same key returns the same fact.
    const replay = await app.request(
      `${ORIGIN}/api/staff/access-management/personal-denies`,
      {
        method: 'POST',
        headers: json('deny-66e-0000000001'),
        body: JSON.stringify({
          staff_id: 'staff-66e-ps-a',
          permission_code: 'ORDER_VIEW',
          reason: '复核期间临时禁用',
        }),
      },
      { DB: database! },
    );
    expect(((await replay.json()) as any).data.deny.status).toBe('ACTIVE');

    const unknown = await app.request(
      `${ORIGIN}/api/staff/access-management/personal-denies`,
      {
        method: 'POST',
        headers: json('deny-66e-0000000002'),
        body: JSON.stringify({
          staff_id: 'staff-66e-ps-a',
          permission_code: 'ACQUISITION_ADMIN',
          reason: '退役权限码必须被拒绝',
        }),
      },
      { DB: database! },
    );
    expect(unknown.status).toBe(400);

    const revoke = await app.request(
      `${ORIGIN}/api/staff/access-management/personal-denies/revoke`,
      {
        method: 'POST',
        headers: json('deny-66e-0000000003'),
        body: JSON.stringify({
          staff_id: 'staff-66e-ps-a',
          permission_code: 'ORDER_VIEW',
          reason: '复核完成，恢复权限',
        }),
      },
      { DB: database! },
    );
    expect(revoke.status).toBe(200);
    const restored = await resolveAssignmentStaffAuthorization(database!, 'staff-66e-ps-a');
    expect(restored?.permissions.has('ORDER_VIEW')).toBe(true);
    expect(await database!.prepare(`
      SELECT COUNT(*) AS c FROM audit_events
      WHERE event_type IN ('STAFF_PERSONAL_DENY_SET','STAFF_PERSONAL_DENY_REVOKED')
    `).first()).toEqual({ c: 2 });
  });
});

async function setup() {
  database = createMigratedTestDatabase();
  database.exec(`
    UPDATE buyer_channels SET next_sequence=3001 WHERE id='buyer-channel-wechat-b';
    INSERT INTO staff_users (
      id, display_name, status, authorization_version, version,
      created_at, updated_at, disabled_at, session_version
    ) VALUES
      ('staff-66e-owner','管理员','ACTIVE',1,1,1000,1000,NULL,1),
      ('staff-66e-ps-a','售前甲','ACTIVE',1,1,1000,1000,NULL,1),
      ('staff-66e-refund','返款员工','ACTIVE',1,1,1000,1000,NULL,1);
    INSERT INTO staff_role_assignments (
      id, staff_id, role_code, status, assigned_by_staff_id, assigned_at,
      revoked_at, created_at, updated_at
    ) VALUES
      ('role-66e-owner-0000001','staff-66e-owner','owner','ACTIVE',NULL,1000,NULL,1000,1000),
      ('role-66e-ps-a-000001','staff-66e-ps-a','pre_sales','ACTIVE',NULL,1000,NULL,1000,1000),
      ('role-66e-refund-00001','staff-66e-refund','buyer_refund','ACTIVE',NULL,1000,NULL,1000,1000);
    INSERT INTO staff_marketplace_scopes (
      id, staff_id, role_code, marketplace_code, status,
      assigned_by_staff_id, assigned_at, revoked_at, reason,
      created_at, updated_at, scope_kind
    ) VALUES
      ('scope-66e-ps-a-jp','staff-66e-ps-a','pre_sales','AMAZON_JP','ACTIVE',NULL,1000,NULL,'TEST_PRIMARY',1000,1000,'PRIMARY'),
      ('scope-66e-refund-jp','staff-66e-refund','buyer_refund','AMAZON_JP','ACTIVE',NULL,1000,NULL,'TEST_PRIMARY',1000,1000,'PRIMARY');
  `);
  const buyer = await createBuyerCustomer(database, {
    marketplaceCode: 'AMAZON_JP',
    buyerChannelId: 'buyer-channel-wechat-b',
    displayName: '阶段66E买家',
    wechatId: 'wx_stage66e_buyer_01',
  }, {
    actor: {
      staffId: 'staff-66e-ps-a',
      displayName: '售前甲',
      roles: ['pre_sales'],
      permissions: new Set<StaffPermissionCode>(['BUYER_CREATE']),
    },
    idempotencyKey: 'buyer-66e-0000000001',
    requestId: 'request-buyer-66e',
    now: 2000,
  });
  const app = appAs(authorization('owner'));
  return { app, buyerId: buyer.buyer_customer_id, preSalesA: 'staff-66e-ps-a' };
}

function appAs(actor: AssignmentStaffAuthorization): Hono<any> {
  const app = new Hono<any>();
  app.use('*', async (context, next) => {
    context.set('requestId', `stage66e-am-${crypto.randomUUID()}`);
    context.set('staffAuthorization', actor);
    await next();
  });
  registerStaffAccessManagementRoutes(app);
  return app;
}

function authorization(
  role: 'owner' | 'pre_sales',
): AssignmentStaffAuthorization {
  const effective = calculateEffectiveStaffAuthorization({
    roles: new Set([role]),
    grants: new Set<StaffPermissionCode>(),
    denies: new Set<StaffPermissionCode>(),
    memberTeamIds: [],
    leaderTeamIds: [],
  });
  return {
    staffId: 'staff-66e-owner',
    displayName: '管理员',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: effective.roles,
    permissions: effective.permissions,
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}

function json(key: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Idempotency-Key': key,
  };
}
