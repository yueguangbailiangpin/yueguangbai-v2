import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { StaffPermissionCode } from '@ygb/contracts';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { chinaBusinessDate } from '@ygb/domain';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import { registerStaffAssignmentRoutes } from '../staff-assignment';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { seedConfirmedColdArchiveOrder } from '../../test-support/cold-archive-fixture';
import { registerStaffOrderDetailRoutes } from './routes';

/**
 * Stage 7.5 batch 1 request-level coverage for the staff formal-order cursor
 * list, the fixed-assignment visibility model, the authoritative
 * responsibility projection and the workbench summary endpoint.
 */

const ORIGIN = 'https://api.example.test';
const AT = Date.UTC(2026, 7, 1, 0, 0, 0);

let database: SqliteDatabase | null = null;

interface SeededOrder {
  orderId: string;
  buyerId: string;
  sellerOrganizationId: string;
  amazonOrderNumber: string;
}

let orderRefundOpen: SeededOrder;
let orderSettlement: SeededOrder;
let orderCompleted: SeededOrder;
/** All fixture orders share confirmed_at, so list order is id DESC. */
let expectedAllOrder: string[];
let expectedVisibleOrder: string[];

beforeEach(async () => {
  database = createMigratedTestDatabase();
  const a = await seedConfirmedColdArchiveOrder(database, 'stage75-list-alpha-order');
  const b = await seedConfirmedColdArchiveOrder(database, 'stage75-list-beta-order');
  const c = await seedConfirmedColdArchiveOrder(database, 'stage75-list-gamma-order');
  const read = async (seeded: { formalOrderId: string; sellerOrganizationId: string }): Promise<SeededOrder> => {
    const row = (await database!.prepare(
      `SELECT amazon_order_number_normalized AS n, buyer_customer_id AS b
       FROM formal_orders WHERE id=?`,
    ).bind(seeded.formalOrderId).first<{ n: string; b: string }>())!;
    return {
      orderId: seeded.formalOrderId,
      buyerId: row.b,
      sellerOrganizationId: seeded.sellerOrganizationId,
      amazonOrderNumber: row.n,
    };
  };
  orderRefundOpen = await read(a);
  orderSettlement = await read(b);
  orderCompleted = await read(c);
  await seedStaffAndAssignments();
  await openRefundObligation(orderRefundOpen.orderId, orderRefundOpen.buyerId);
  await openException(orderRefundOpen.orderId, '平台取消测试');
  await settleRefundFully(orderSettlement.orderId, orderSettlement.buyerId);
  await settleRefundFully(orderCompleted.orderId, orderCompleted.buyerId);
  await settleAllPayables(orderCompleted.sellerOrganizationId);
  expectedAllOrder = [orderRefundOpen, orderSettlement, orderCompleted]
    .map((order) => order.orderId)
    .sort()
    .reverse();
  expectedVisibleOrder = [orderRefundOpen.orderId, orderSettlement.orderId]
    .sort()
    .reverse();
});

afterEach(() => {
  database?.close();
  database = null;
});

describe('legacy order-number lookup is preserved', () => {
  it('returns the detail aggregate when amazon_order_number is the only parameter', async () => {
    const response = await requestList(
      owner(),
      `?amazon_order_number=${encodeURIComponent(orderRefundOpen.amazonOrderNumber)}`,
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { data: Record<string, unknown> };
    expect(body.data['order']).toMatchObject({
      formal_order_id: orderRefundOpen.orderId,
    });
    expect(body.data['items']).toBeUndefined();
  });

  it('conceals 404 for unknown numbers', async () => {
    const response = await requestList(owner(), '?amazon_order_number=000-0000000-0000000');
    expect(response.status).toBe(404);
  });
});

describe('list mode keyset pagination', () => {
  it('returns all visible orders newest-first and reports no more pages', async () => {
    const body = await listJson(owner(), '');
    expect(body.data.items.map((item) => item.formal_order_id)).toEqual(expectedAllOrder);
    expect(body.data.next_cursor).toBeNull();
  });

  it('pages without duplicates or gaps', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 6; page += 1) {
      const query = cursor === null ? '?limit=1' : `?limit=1&cursor=${encodeURIComponent(cursor)}`;
      const body = await listJson(owner(), query);
      seen.push(...body.data.items.map((item) => item.formal_order_id));
      cursor = body.data.next_cursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual(expectedAllOrder);
  });

  it('rejects a cursor replayed under different filters', async () => {
    const first = await listJson(owner(), '?limit=1');
    const cursor = first.data.next_cursor!;
    const response = await requestList(
      owner(),
      `?limit=1&stage=COMPLETED&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(response.status).toBe(400);
  });

  it('rejects unknown parameters and out-of-range limits', async () => {
    expect((await requestList(owner(), '?page=1')).status).toBe(400);
    expect((await requestList(owner(), '?limit=0')).status).toBe(400);
    expect((await requestList(owner(), '?limit=101')).status).toBe(400);
    expect((await requestList(owner(), '?stage=WAT')).status).toBe(400);
    expect((await requestList(owner(), '?limit=1&limit=2')).status).toBe(400);
  });
});

describe('list filters', () => {
  it('filters by stage', async () => {
    const body = await listJson(owner(), '?stage=BUYER_REFUND');
    expect(body.data.items.map((item) => item.formal_order_id))
      .toEqual([orderRefundOpen.orderId]);
  });

  it('filters by exception state and exposes the authoritative reason', async () => {
    const body = await listJson(owner(), '?exception_state=OPEN');
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].responsibility).toMatchObject({
      exception_state: 'OPEN',
      exception_reason: '平台取消测试',
      next_action: 'RESOLVE_EXCEPTION',
    });
  });

  it('filters by buyer customer number', async () => {
    const row = (await database!.prepare(
      'SELECT buyer_customer_no FROM formal_orders WHERE id=?',
    ).bind(orderSettlement.orderId).first<{ buyer_customer_no: string }>())!;
    const body = await listJson(owner(), `?buyer_customer_no=${row.buyer_customer_no}`);
    expect(body.data.items.map((item) => item.formal_order_id))
      .toEqual([orderSettlement.orderId]);
  });

  it('filters by amazon order number prefix', async () => {
    const prefix = orderSettlement.amazonOrderNumber;
    const body = await listJson(
      owner(),
      `?amazon_order_number_prefix=${encodeURIComponent(prefix)}`,
    );
    expect(body.data.items.map((item) => item.formal_order_id))
      .toEqual([orderSettlement.orderId]);
  });

  it('filters by responsible staff', async () => {
    const body = await listJson(owner(), '?responsible_staff_id=list-refund');
    expect(body.data.items.map((item) => item.formal_order_id))
      .toEqual([orderRefundOpen.orderId]);
  });

  it('filters by confirmed range', async () => {
    const body = await listJson(owner(), `?confirmed_from=${AT}`);
    expect(body.data.items.map((item) => item.formal_order_id)).toEqual(expectedAllOrder);
    const empty = await listJson(owner(), `?confirmed_from=${AT}&confirmed_to=${AT - 1}`);
    expect(empty.data.items).toEqual([]);
  });
});

describe('fixed-assignment visibility', () => {
  it('pre_sales sees only assigned buyers; other buyers conceal 404', async () => {
    const body = await listJson(preSales('list-pre'), '');
    expect(body.data.items.map((item) => item.formal_order_id)).toEqual(expectedVisibleOrder);
    expect((await requestDetail(preSales('list-pre'), orderCompleted.orderId)).status)
      .toBe(404);
  });

  it('buyer_refund sees only assigned buyers', async () => {
    const body = await listJson(refundStaff(), '');
    expect(body.data.items.map((item) => item.formal_order_id)).toEqual(expectedVisibleOrder);
  });

  it('seller_ops sees only assigned seller organizations', async () => {
    const body = await listJson(sellerOps(), '');
    expect(body.data.items.map((item) => item.formal_order_id)).toEqual(expectedVisibleOrder);
  });

  it('owner sees all orders', async () => {
    const body = await listJson(owner(), '');
    expect(body.data.items).toHaveLength(3);
  });

  it('unassigned staff of an eligible role sees an empty list and concealed 404', async () => {
    const body = await listJson(preSales('list-pre-2'), '');
    expect(body.data.items).toEqual([]);
    expect((await requestDetail(preSales('list-pre-2'), orderRefundOpen.orderId)).status)
      .toBe(404);
  });

  it('blocks ORDER_VIEW when denied by Personal DENY', async () => {
    expect((await requestList(withDeny(preSales('list-pre'), 'ORDER_VIEW'), '')).status)
      .toBe(403);
  });
});

describe('authoritative responsibility projection', () => {
  it('follows refund → settlement → completed with the fixed-assignment owner', async () => {
    const refundBody = await detailJson(owner(), orderRefundOpen.orderId);
    expect(refundBody.data['responsibility']).toMatchObject({
      stage: 'BUYER_REFUND',
      responsible_role: 'buyer_refund',
      // Order A carries an open exception, which takes priority over the
      // stage default (PROCESS_BUYER_REFUND).
      next_action: 'RESOLVE_EXCEPTION',
      responsible_staff: { staff_id: 'list-refund' },
    });
    const settlementBody = await detailJson(owner(), orderSettlement.orderId);
    expect(settlementBody.data['responsibility']).toMatchObject({
      stage: 'SELLER_SETTLEMENT',
      responsible_role: 'seller_ops',
      next_action: 'FOLLOW_SELLER_SETTLEMENT',
      responsible_staff: { staff_id: 'list-ops' },
    });
    const completedBody = await detailJson(owner(), orderCompleted.orderId);
    expect(completedBody.data['responsibility']).toMatchObject({
      stage: 'COMPLETED',
      responsible_role: 'owner',
      next_action: 'REVIEW_COMPLETED_ORDER',
      next_action_due_at: null,
    });
  });

  it('marks overdue from the authoritative deadline', async () => {
    const body = await detailJson(owner(), orderRefundOpen.orderId);
    const responsibility = body.data['responsibility'] as {
      next_action_due_at: number;
      is_overdue: boolean;
      overdue_since: number | null;
    };
    expect(responsibility.next_action_due_at).toBeLessThan(Date.now());
    expect(responsibility.is_overdue).toBe(true);
    expect(responsibility.overdue_since).toBe(responsibility.next_action_due_at);
  });

  it('returns NONE exception state after RESOLVED', async () => {
    await resolveException(orderRefundOpen.orderId, '已恢复');
    const body = await detailJson(owner(), orderRefundOpen.orderId);
    expect(body.data['responsibility']).toMatchObject({
      exception_state: 'NONE',
      exception_reason: null,
    });
  });

  it('carries list rows with the same authoritative projection', async () => {
    const body = await listJson(owner(), '?stage=SELLER_SETTLEMENT');
    expect(body.data.items[0].responsibility.stage).toBe('SELLER_SETTLEMENT');
  });
});

describe('workbench summary endpoint', () => {
  it('returns authoritative counts and the role-gated refund amount', async () => {
    await seedWorkItem(
      orderRefundOpen.buyerId,
      'list-refund',
      'BUYER_REFUND_PROCESSING',
      AT - 100 * 3600 * 1000,
    );
    const response = await requestSummary(refundStaff());
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { summary: Record<string, unknown> } };
    expect(body.data.summary['open_count']).toBeGreaterThanOrEqual(1);
    expect(body.data.summary['overdue_count']).toBeGreaterThanOrEqual(1);
    expect(body.data.summary['exception_order_count']).toBeGreaterThanOrEqual(1);
    expect(typeof body.data.summary['refund_due_today_cny_fen']).toBe('string');
    expect(Array.isArray(body.data.summary['recent'])).toBe(true);
  });

  it('returns a null refund amount for pre_sales and seller_ops', async () => {
    for (const actor of [preSales('list-pre'), sellerOps()]) {
      const response = await requestSummary(actor);
      expect(response.status).toBe(200);
      const body = await response.json() as { data: { summary: Record<string, unknown> } };
      expect(body.data.summary['refund_due_today_cny_fen']).toBeNull();
    }
  });

  it('rejects query parameters', async () => {
    expect((await requestSummary(owner(), '?x=1')).status).toBe(400);
  });
});

describe('work item SLA metadata', () => {
  it('projects sla fields on the work item endpoints', async () => {
    await seedWorkItem(
      orderRefundOpen.buyerId,
      'list-refund',
      'BUYER_REFUND_PROCESSING',
      AT - 100 * 3600 * 1000,
    );
    const response = await request(refundStaff(), '/api/staff/me/work-items');
    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: { work_items: Array<Record<string, unknown>> };
    };
    const item = body.data.work_items.find(
      (candidate) => candidate['work_type'] === 'BUYER_REFUND_PROCESSING',
    );
    expect(item).toMatchObject({
      sla_due_at: expect.any(Number),
      is_overdue: true,
      overdue_since: expect.any(Number),
      next_action: 'PROCESS_BUYER_REFUND',
      responsible_role: 'buyer_refund',
      responsible_staff_name: '列表返款',
      priority: 'OVERDUE',
    });
  });
});

describe('work item cursor pagination', () => {
  it('traverses all visible work items with the stable created-at/id order', async () => {
    const createdAt = [AT + 4000, AT + 3000, AT + 2000];
    for (const value of createdAt) {
      await seedWorkItem(
        orderRefundOpen.buyerId,
        'list-refund',
        'BUYER_REFUND_PROCESSING',
        value,
      );
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 4; page += 1) {
      const query = cursor === null
        ? '?limit=1'
        : `?limit=1&cursor=${encodeURIComponent(cursor)}`;
      const response = await request(refundStaff(), `/api/staff/me/work-items${query}`);
      expect(response.status).toBe(200);
      const body = await response.json() as {
        data: { work_items: Array<{ work_item_id: string }>; next_cursor: string | null };
      };
      seen.push(...body.data.work_items.map((item) => item.work_item_id));
      cursor = body.data.next_cursor;
      if (cursor === null) break;
    }

    expect(seen).toEqual([...createdAt].reverse().map(
      (value) => `stage75-workitem-list-refund-${value}`,
    ));
    expect(new Set(seen).size).toBe(seen.length);
    expect(cursor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function requestList(
  actor: AssignmentStaffAuthorization,
  query: string,
): Promise<Response> {
  return request(actor, `/api/staff/formal-orders${query}`);
}

async function requestDetail(
  actor: AssignmentStaffAuthorization,
  orderId: string,
): Promise<Response> {
  return request(actor, `/api/staff/formal-orders/${orderId}`);
}

async function requestSummary(
  actor: AssignmentStaffAuthorization,
  query = '',
): Promise<Response> {
  return request(actor, `/api/staff/me/work-items/summary${query}`);
}

async function request(actor: AssignmentStaffAuthorization, path: string): Promise<Response> {
  const app = new Hono<any>();
  app.use('*', async (context, next) => {
    context.set('requestId', `list75-${crypto.randomUUID()}`);
    context.set('staffAuthorization', actor);
    await next();
  });
  registerStaffOrderDetailRoutes(app);
  registerStaffAssignmentRoutes(app);
  return app.request(`${ORIGIN}${path}`, {}, { DB: database! });
}

async function listJson(
  actor: AssignmentStaffAuthorization,
  query: string,
): Promise<{ data: { items: any[]; next_cursor: string | null } }> {
  const response = await requestList(actor, query);
  expect(response.status).toBe(200);
  return await response.json() as { data: { items: any[]; next_cursor: string | null } };
}

async function detailJson(
  actor: AssignmentStaffAuthorization,
  orderId: string,
): Promise<{ data: Record<string, any> }> {
  const response = await requestDetail(actor, orderId);
  expect(response.status).toBe(200);
  return await response.json() as { data: Record<string, any> };
}

function actor(
  role: 'owner' | 'pre_sales' | 'buyer_refund' | 'seller_ops',
  staffId: string,
  denies: StaffPermissionCode[] = [],
): AssignmentStaffAuthorization {
  const effective = calculateEffectiveStaffAuthorization({
    roles: new Set([role]),
    grants: new Set<StaffPermissionCode>(),
    denies: new Set(denies),
    memberTeamIds: [],
    leaderTeamIds: [],
  });
  return {
    staffId,
    displayName: staffId,
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: effective.roles,
    permissions: effective.permissions,
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}

function owner(): AssignmentStaffAuthorization {
  return actor('owner', 'list-owner');
}
function preSales(staffId: string): AssignmentStaffAuthorization {
  return actor('pre_sales', staffId);
}
function refundStaff(): AssignmentStaffAuthorization {
  return actor('buyer_refund', 'list-refund');
}
function sellerOps(): AssignmentStaffAuthorization {
  return actor('seller_ops', 'list-ops');
}
function withDeny(
  base: AssignmentStaffAuthorization,
  code: StaffPermissionCode,
): AssignmentStaffAuthorization {
  return actor(
    [...base.roles][0] as 'owner' | 'pre_sales' | 'buyer_refund' | 'seller_ops',
    base.staffId,
    [code],
  );
}

async function seedStaffAndAssignments(): Promise<void> {
  const d = database!;
  d.exec(`
    INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at) VALUES
      ('list-owner','List Owner','ACTIVE',1,1,1000,1000,NULL),
      ('list-pre','列表售前','ACTIVE',1,1,1000,1000,NULL),
      ('list-pre-2','列表售前二','ACTIVE',1,1,1000,1000,NULL),
      ('list-refund','列表返款','ACTIVE',1,1,1000,1000,NULL),
      ('list-ops','列表卖家对接','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO staff_role_assignments(id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at) VALUES
      ('list-owner-role','list-owner','owner','ACTIVE',NULL,1000,NULL,1000,1000),
      ('list-pre-role','list-pre','pre_sales','ACTIVE','list-owner',1000,NULL,1000,1000),
      ('list-pre2-role','list-pre-2','pre_sales','ACTIVE','list-owner',1000,NULL,1000,1000),
      ('list-refund-role','list-refund','buyer_refund','ACTIVE','list-owner',1000,NULL,1000,1000),
      ('list-ops-role','list-ops','seller_ops','ACTIVE','list-owner',1000,NULL,1000,1000);
    INSERT INTO staff_marketplace_scopes(id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,assigned_at,
      revoked_at,reason,created_at,updated_at,scope_kind) VALUES
      ('list-pre-scope-amazonjp','list-pre','pre_sales','AMAZON_JP','ACTIVE','list-owner',1000,NULL,'T',1000,1000,'PRIMARY'),
      ('list-pre2-scope-amazonjp','list-pre-2','pre_sales','AMAZON_JP','ACTIVE','list-owner',1000,NULL,'T',1000,1000,'SUPPORT'),
      ('list-refund-scope-amazonjp','list-refund','buyer_refund','AMAZON_JP','ACTIVE','list-owner',1000,NULL,'T',1000,1000,'PRIMARY'),
      ('list-ops-scope-amazonjp','list-ops','seller_ops','AMAZON_JP','ACTIVE','list-owner',1000,NULL,'T',1000,1000,'PRIMARY');
  `);
  // The cold fixture auto-binds each buyer's pre-sales duty to the confirming
  // owner; revoke those rows and rebind buyers A/B to the dedicated actors.
  // Buyer C stays unassigned (concealed visibility proof).
  const buyers = [orderRefundOpen.buyerId, orderSettlement.buyerId];
  let index = 0;
  for (const buyerId of buyers) {
    index += 1;
    console.log('SEED75 guard-check', JSON.stringify(d.raw.prepare(`
      SELECT
        (SELECT COUNT(*) FROM staff_users WHERE id='list-pre' AND status='ACTIVE') AS pre_active,
        (SELECT COUNT(*) FROM staff_role_assignments WHERE staff_id='list-pre' AND role_code='pre_sales' AND status='ACTIVE') AS pre_role,
        (SELECT COUNT(*) FROM staff_marketplace_scopes WHERE staff_id='list-pre' AND status='ACTIVE' AND scope_kind='PRIMARY' AND marketplace_code='AMAZON_JP') AS pre_scope,
        (SELECT COUNT(*) FROM staff_effective_assignment_permissions WHERE staff_id='list-pre' AND permission_code='ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES') AS pre_eligible,
        (SELECT COUNT(DISTINCT permission_code) FROM staff_effective_assignment_permissions WHERE staff_id='list-pre' AND permission_code IN ('BUYER_VIEW','RESERVATION_VIEW','RESERVATION_DECIDE','ORDER_VIEW','ORDER_CONFIRM')) AS pre_five,
        (SELECT COUNT(*) FROM buyer_marketplace_assignments WHERE buyer_customer_id=?) AS buyer_market
    `).get(buyerId)));
    d.prepare(`
      UPDATE buyer_staff_assignments
      SET status='REVOKED', revoked_at=?, updated_at=?, version=2
      WHERE buyer_customer_id=? AND duty_code='BUYER_PRE_SALES_OWNER' AND status='ACTIVE'
    `).bind(AT + 1, AT + 1, buyerId).run();
    try {
      d.prepare(`
        INSERT INTO buyer_staff_assignments(id,buyer_customer_id,duty_code,staff_id,status,source,
          assigned_by_actor_type,assigned_by_actor_id,reason,version,created_at,updated_at,revoked_at)
        VALUES(?,?,'BUYER_PRE_SALES_OWNER','list-pre','ACTIVE','MANUAL_REASSIGN','STAFF','list-owner','stage75',1,?,?,NULL)
      `).bind(`list-pre-assign-${index}`, buyerId, AT + 2, AT + 2).run();
        d.prepare(`
        INSERT INTO buyer_staff_assignments(id,buyer_customer_id,duty_code,staff_id,status,source,
          assigned_by_actor_type,assigned_by_actor_id,reason,version,created_at,updated_at,revoked_at)
        VALUES(?,?,'BUYER_REFUND_OWNER','list-refund','ACTIVE','MANUAL_REASSIGN','STAFF','list-owner','stage75',1,?,?,NULL)
      `).bind(`list-refund-assign-${index}`, buyerId, AT + 2, AT + 2).run();
      } catch (error) {
      console.log('SEED75 insert failed', index, (error as Error).message);
      console.log('SEED75 whole-when', JSON.stringify(d.raw.prepare(`
        SELECT EXISTS (
          SELECT 1
          FROM staff_users staff
          JOIN buyer_marketplace_assignments market
            ON market.buyer_customer_id=?
          JOIN staff_effective_assignment_permissions permission
            ON permission.staff_id=staff.id
            AND permission.permission_code='ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES'
          WHERE staff.id='list-pre' AND staff.status='ACTIVE'
            AND (
              EXISTS (SELECT 1 FROM staff_role_assignments role
                WHERE role.staff_id=staff.id AND role.status='ACTIVE' AND role.role_code='owner')
              OR EXISTS (SELECT 1 FROM staff_marketplace_scopes scope
                WHERE scope.staff_id=staff.id AND scope.status='ACTIVE'
                AND scope.scope_kind='PRIMARY'
                AND scope.marketplace_code=market.marketplace_code)
            )
            AND 5=(
              SELECT COUNT(DISTINCT required.permission_code)
              FROM staff_effective_assignment_permissions required
              WHERE required.staff_id=staff.id AND required.permission_code IN (
                'BUYER_VIEW','RESERVATION_VIEW','RESERVATION_DECIDE','ORDER_VIEW','ORDER_CONFIRM'))
        ) AS passes
      `).get(buyerId)));
      throw error;
    }
  }
  // Seller orgs A/B get the seller-ops manager; org C stays unassigned.
  for (const [organizationId, suffix] of [
    [orderRefundOpen.sellerOrganizationId, 'a'],
    [orderSettlement.sellerOrganizationId, 'b'],
  ] as const) {
    d.prepare(`
      INSERT INTO seller_staff_assignments(id,seller_organization_id,duty_code,staff_id,status,source,
        assigned_by_actor_type,assigned_by_actor_id,reason,version,created_at,updated_at,revoked_at)
      VALUES(?,?, 'SELLER_ACCOUNT_MANAGER', 'list-ops','ACTIVE','AUTO_INITIAL','STAFF','list-owner',NULL,1,?,?,NULL)
    `).bind(`list-ops-assign-${suffix}`, organizationId, AT, AT).run();
  }
}

async function openException(orderId: string, reason: string): Promise<void> {
  database!.prepare(`
    INSERT INTO formal_order_operational_events(id,formal_order_id,event_type,reason,actor_staff_id,created_at)
    VALUES(?,?,'PLATFORM_CANCELLED',?,'list-owner',?)
  `).bind(`stage75-exc-${orderId.slice(0, 8)}`, orderId, reason, AT + 5000).run();
}

async function resolveException(orderId: string, reason: string): Promise<void> {
  database!.prepare(`
    INSERT INTO formal_order_operational_events(id,formal_order_id,event_type,reason,actor_staff_id,created_at)
    VALUES(?,?,'RESOLVED',?,'list-owner',?)
  `).bind(`stage75-res-${orderId.slice(0, 8)}`, orderId, reason, AT + 6000).run();
}

async function openRefundObligation(orderId: string, buyerId: string): Promise<string> {
  const caseId = `stage75-review-${orderId.slice(0, 8)}`;
  const evidenceId = `stage75-evidence-${orderId.slice(0, 8)}`;
  const dueEventId = `stage75-due-${orderId.slice(0, 8)}`;
  const obligationId = `stage75-obligation-${orderId.slice(0, 8)}`;
  const reviewRow = await database!.prepare(
    'SELECT review_type FROM formal_orders WHERE id=?',
  ).bind(orderId).first<{ review_type: string }>();
  const reviewType = reviewRow === null ? 'IMAGE' : reviewRow.review_type;
  database!.prepare(`
    INSERT INTO review_cases(id,formal_order_id,buyer_customer_id,seller_organization_id,review_type,status,
      current_evidence_version_no,version,public_change_reason,internal_review_note,submitted_at,updated_at,
      decided_by_staff_id,decided_at,withdrawn_at,created_at)
    VALUES(?,?,?,(SELECT seller_organization_id FROM formal_orders WHERE id=?),
      ?,'PENDING_REVIEW',1,1,NULL,NULL,?,?,NULL,NULL,NULL,?)
  `).bind(caseId, orderId, buyerId, orderId, reviewType, AT, AT, AT).run();
  database!.prepare(`
    UPDATE review_cases SET status='APPROVED', version=2, updated_at=?, decided_by_staff_id='list-owner', decided_at=?
    WHERE id=?
  `).bind(AT + 1, AT + 1, caseId).run();
  database!.prepare(`
    INSERT INTO review_evidence_versions(id,review_case_id,formal_order_id,version_no,review_type,submitted_by_buyer_id,
      buyer_note,created_at,review_url)
    VALUES(?,?,?,1,(SELECT review_type FROM formal_orders WHERE id=?),?,NULL,?,'https://example.test/review')
  `).bind(evidenceId, caseId, orderId, orderId, buyerId, AT).run();
  database!.prepare(`
    INSERT INTO review_events(id,review_case_id,formal_order_id,evidence_version_id,event_type,actor_type,actor_id,
      previous_status,next_status,case_version,amount_cny_fen,formal_order_financial_snapshot_id,public_reason,
      internal_note,metadata_json,idempotency_key,created_at)
    VALUES(?,?,?,?,'BUYER_REFUND_BECAME_DUE','STAFF','list-owner',
      'PENDING_REVIEW','APPROVED',2,10890,(SELECT id FROM formal_order_financial_snapshots WHERE formal_order_id=?),
      NULL,NULL,'{}',?,?)
  `).bind(dueEventId, caseId, orderId, evidenceId, orderId, `stage75-due-${orderId.slice(0, 8)}`, AT + 1).run();
  database!.prepare(`
    INSERT INTO buyer_refund_obligations(id,source_review_event_id,review_case_id,formal_order_id,buyer_customer_id,
      due_amount_cny_fen,version,created_at,updated_at)
    VALUES(?,?,?,?,?,10890,1,?,?)
  `).bind(obligationId, dueEventId, caseId, orderId, buyerId, AT + 1, AT + 1).run();
  return obligationId;
}

async function settleRefundFully(
  orderId: string,
  buyerId: string,
): Promise<void> {
  const obligationId = await openRefundObligation(orderId, buyerId);
  database!.prepare(`
    INSERT INTO buyer_refund_payment_entries(id,obligation_id,entry_type,original_payment_entry_id,amount_cny_fen,
      paid_at,reversed_at,china_business_date,payment_channel,recorded_by_staff_id,public_note,internal_note,
      idempotency_key,request_hash,created_at)
    VALUES(?,?,'PAYMENT',NULL,10890,?,NULL,?,?,'list-refund',NULL,NULL,?,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',?)
  `).bind(`stage75-payment-${orderId.slice(0, 8)}`,
    obligationId,
    AT + 2,
    chinaBusinessDate(AT + 2),
    'WECHAT',
    `stage75-pay-${orderId.slice(0, 8)}`,
    AT + 2,
  ).run();
}

async function settleAllPayables(sellerOrganizationId: string): Promise<void> {
  const rows = await database!.prepare(`
    SELECT payable_id, amount_cny_fen FROM seller_payable_balances
    WHERE seller_organization_id=? AND outstanding_amount_cny_fen>0
  `).bind(sellerOrganizationId)
    .all<{ payable_id: string; amount_cny_fen: number }>();
  let index = 0;
  for (const row of rows.results) {
    index += 1;
    const paymentId = `stage75-spayment-${index}-${sellerOrganizationId.slice(-6)}`;
    database!.prepare(`
      INSERT INTO seller_payments(id,seller_organization_id,amount_cny_fen,paid_at,recorded_at,recorded_by_staff_id,
        version,created_at,updated_at)
      VALUES(?,?,?,?,?,'list-owner',1,?,?)
    `).bind(paymentId, sellerOrganizationId, row.amount_cny_fen, AT + 3000, AT + 3000, AT + 3000, AT + 3000).run();
    database!.prepare(`
      INSERT INTO seller_payment_allocations(id,payment_id,payable_id,seller_organization_id,amount_cny_fen,
        allocated_by_staff_id,allocated_at,created_at)
      VALUES(?,?,?,?,?,'list-owner',?,?)
    `).bind(`stage75-alloc-${index}-${sellerOrganizationId.slice(-6)}`,
      paymentId,
      row.payable_id,
      sellerOrganizationId,
      row.amount_cny_fen,
      AT + 3001,
      AT + 3001,).run();
  }
}

async function seedWorkItem(
  buyerCustomerId: string,
  staffId: string,
  workType: 'RESERVATION_DECISION' | 'BUYER_REFUND_PROCESSING',
  createdAt: number,
): Promise<void> {
  const assignmentRow = (await database!.prepare(`
    SELECT id, duty_code FROM buyer_staff_assignments
    WHERE buyer_customer_id=? AND staff_id=? AND status='ACTIVE' LIMIT 1
  `).bind(buyerCustomerId, staffId).first<{ id: string; duty_code: string }>());
  if (!assignmentRow) throw new Error(`no assignment for ${staffId}/${buyerCustomerId}`);
  database!.prepare(`
    INSERT INTO staff_work_items(id,work_type,source_entity_type,source_entity_id,buyer_customer_id,
      seller_organization_id,store_id,duty_code,fixed_assignment_type,fixed_assignment_id,assigned_staff_id,
      status,version,created_at,updated_at,completed_at,cancelled_at,marketplace_code)
    VALUES(?,?, ?,?,?,NULL,NULL,?,'BUYER',?,?,'OPEN',1,?,?,NULL,NULL,'AMAZON_JP')
  `).bind(`stage75-workitem-${staffId}-${createdAt}`,
    workType,
    workType === 'BUYER_REFUND_PROCESSING' ? 'BUYER_REFUND_OBLIGATION' : 'RESERVATION',
    `stage75-resv-${createdAt}`,
    buyerCustomerId,
    assignmentRow.duty_code,
    assignmentRow.id,
    staffId,
    createdAt,
    createdAt,).run();
}
