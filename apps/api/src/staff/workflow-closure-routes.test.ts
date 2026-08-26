import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import type { AppBindings, AppEnv } from '../app';
import { registerStaffWorkflowClosureRoutes } from './workflow-closure-routes';
import {
  submitReservation as submitReservationService,
} from '../reservations/submit-reservation';
import { decideReservation } from '../reservations/decide-reservation';
import type { BuyerReservationActor } from '../reservations/reservation-shared';
import { isStaffPermissionCode, type StaffPermissionCode } from '@ygb/contracts';

let database: SqliteDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
});

function submitReservation(
  db: SqliteDatabase,
  input: { demandBatchId: string; expectedDemandVersion?: number },
  command: Parameters<typeof submitReservationService>[2],
): ReturnType<typeof submitReservationService> {
  return submitReservationService(db, {
    ...input,
    expectedDemandVersion: input.expectedDemandVersion ?? 2,
    acceptedBuyerSelfPayBps: 1000,
  }, command);
}

function createTestApp() {
  const app = new Hono<AppEnv>();
  app.use('*', async (context, next) => {
    context.set('requestId', 'request-closure-http');
    const permission = context.req.header('X-Test-Permission');
    if (permission) {
      const permissionCodes = permission
        .split(',')
        .filter(isStaffPermissionCode);
      context.set('staffAuthorization', {
        staffId: 'zz-phase3h-test-owner',
        displayName: '总管理员',
        staffStatus: 'ACTIVE',
        authorizationVersion: 1,
        roles: new Set(['owner']),
        permissions: new Set(permissionCodes),
        memberTeamIds: [],
        leaderTeamIds: [],
      });
    }
    await next();
  });
  registerStaffWorkflowClosureRoutes(app);
  return app;
}

function buyerActor(buyerCustomerId: string): BuyerReservationActor {
  return {
    buyerCustomerId,
    marketplaceCode: 'AMAZON_JP',
    accessStatus: 'ACTIVE',
    identityReviewStatus: 'CLEAR',
  };
}

function seedWorkflowFixture(database: SqliteDatabase): void {
  // open_at uses the synthetic timeline; deadlines must stay in the real
  // future because the HTTP route uses the real clock.
  const openAt = 4000;
  const reservationDeadline = Date.now() + 3600_000;
  const orderDeadline = Date.now() + 7200_000;
  database.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'staff-pre-sales', '售前', 'ACTIVE', 1, 1, 1000, 1000, NULL
    );

    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES (
      'staff-pre-sales', 'pre_sales', 'ACTIVE', 'zz-phase3h-test-owner',
      1000, NULL, 1000, 1000
    );

    INSERT INTO staff_marketplace_scopes (
      id, staff_id, role_code, marketplace_code, status,
      assigned_by_staff_id, assigned_at, revoked_at, reason,
      created_at, updated_at, scope_kind
    ) VALUES (
      'scope-reservation-reopen-jp', 'staff-pre-sales', 'pre_sales',
      'AMAZON_JP', 'ACTIVE', 'zz-phase3h-test-owner',
      1000, NULL, 'TEST_PRIMARY', 1000, 1000, 'PRIMARY'
    );

    INSERT INTO staff_assignment_fallbacks (
      marketplace_code, staff_id, version, configured_by_staff_id,
      created_at, updated_at
    ) VALUES (
      'AMAZON_JP', 'zz-phase3h-test-owner', 1, 'zz-phase3h-test-owner',
      1000, 1000
    );

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status,
      version, created_at, updated_at,
      activated_at, disabled_at, next_member_number
    ) VALUES (
      'seller-org-1', 'AMAZON_JP', 'ido-mango-9001',
      'seller-channel-ido-mango',
      'seller-channel-ido-mango',
      9001, '预约卖家', 'ACTIVE',
      1, 1000, 1000, 1000, NULL, 2
    );

    INSERT INTO customer_identity_subjects (
      id, subject_type, created_at
    ) VALUES
      ('seller-owner-subject', 'SELLER_ORG_MEMBER', 1000),
      ('buyer-subject-1', 'BUYER_CUSTOMER', 1000);

    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id,
      member_number, username_fallback, display_name,
      role, primary_owner, status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES (
      'seller-owner', 'seller-owner-subject',
      'seller-org-1', 1, 'ido-mango-9001-1',
      '负责人', 'OWNER', 1, 'ACTIVE', 1,
      1000, 1000, 1000, NULL
    );

    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code,
      buyer_channel_id, buyer_customer_no,
      buyer_sequence,
      display_name, access_status,
      identity_review_status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES (
      'buyer-1', 'buyer-subject-1', 'AMAZON_JP',
      'buyer-channel-wechat-b', '19700101B0001', 1,
      '买家一', 'ACTIVE', 'CLEAR', 1,
      1000, 1000, 1000, NULL
    );

    INSERT INTO wechat_identity_claims (
      id, identity_subject_id, display_wechat, normalized_wechat,
      status, version, acquired_at, reserved_at, released_at,
      created_at, updated_at, identity_subject_type
    ) VALUES (
      'buyer-wechat-1', 'buyer-subject-1', 'buyer_wechat_001',
      'buyer_wechat_001', 'ACTIVE', 1, 1000, NULL, NULL,
      1000, 1000, 'BUYER_CUSTOMER'
    );

    INSERT INTO seller_stores (
      id, organization_id, marketplace_code,
      display_name, normalized_name, status,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'store-1', 'seller-org-1', 'AMAZON_JP',
      '预约店铺', '预约店铺', 'ACTIVE',
      1, 1000, 1000, NULL
    );

    INSERT INTO products (
      id, organization_id, store_id, marketplace_code,
      asin_display, asin_normalized, status,
      current_version_no, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'product-1', 'seller-org-1', 'store-1', 'AMAZON_JP',
      'B0RESERVE1', 'B0RESERVE1', 'ACTIVE',
      1, 1, 1000, 1000, NULL
    );

    INSERT INTO product_versions (
      id, product_id, version_no, product_name,
      search_keywords_json, product_url,
      buyer_visible_notes, internal_notes,
      created_by_staff_id, created_at,
      ordering_guide_expected_amount_jpy,
      color_spec_mode,
      default_buyer_self_pay_bps,
      order_interval_days, orders_per_run
    ) VALUES (
      'product-1-v1', 'product-1', 1,
      '预约产品一', '["关键词一"]',
      'https://www.amazon.co.jp/reservation-one',
      '公开说明一', '内部说明一',
      'staff-pre-sales', 1000,
      1980, 'MAIN_IMAGE_VARIANT', 1000, 1, 3
    );

    INSERT INTO demand_batches (
      id, organization_id, store_id, marketplace_code,
      product_id, product_version_no,
      submitted_by_member_id, task_type,
      target_quantity, buyer_visible_notes,
      seller_notes, open_at,
      reservation_deadline, order_deadline,
      status, review_reason, close_reason,
      reviewed_by_staff_id, closed_by_staff_id,
      version, submitted_at, updated_at,
      reviewed_at, published_at,
      withdrawn_at, closed_at,
      held_reservation_count,
      approved_reservation_count,
      buyer_self_pay_bps_snapshot,
      buyer_self_pay_source,
      buyer_self_pay_override_reason
    ) VALUES (
      'demand-1', 'seller-org-1', 'store-1', 'AMAZON_JP',
      'product-1', 1, 'seller-owner', 'IMAGE',
      3, '公开说明', '内部说明',
      ${openAt}, ${reservationDeadline}, ${orderDeadline},
      'PUBLISHED', NULL, NULL,
      'staff-pre-sales', NULL,
      2, 1000, 3000, 3000, 3000, NULL, NULL,
      0, 0, 1000, 'PRODUCT_DEFAULT', NULL
    );
  `);
}

describe('staff workflow closure HTTP contract', () => {
  it('returns assigned buyer identity facts with the creation-allocated customer number', async () => {
    database = createMigratedTestDatabase();
    seedWorkflowFixture(database);
    const submitted = await submitReservation(database, {
      demandBatchId: 'demand-1',
    }, {
      actor: buyerActor('buyer-1'),
      idempotencyKey: 'reservation:http:review-context:submit',
      now: 5000,
    });
    const app = createTestApp();
    const response = await app.request(
      `http://local/api/staff/reservations/${submitted.reservation_id}/review-context`,
      { headers: { 'X-Test-Permission': 'RESERVATION_DECIDE' } },
      { DB: database },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        review_context: {
          reservation_id: submitted.reservation_id,
          buyer: {
            id: 'buyer-1',
            customer_no: '19700101B0001',
            name: '买家一',
            wechat: 'buyer_wechat_001',
          },
        },
      },
    });
  });

  it('reopens a terminal reservation and recreates an OPEN decision work item', async () => {
    database = createMigratedTestDatabase();
    seedWorkflowFixture(database);

    const submitted = await submitReservation(database, {
      demandBatchId: 'demand-1',
    }, {
      actor: buyerActor('buyer-1'),
      idempotencyKey: 'reservation:http:reopen:submit',
      now: 5000,
    });
    await decideReservation(database, {
      reservationId: submitted.reservation_id,
      expectedVersion: 1,
      decision: 'REJECT',
      rejectionReason: '首次资料不完整',
    }, {
      actor: {
        staffId: 'zz-phase3h-test-owner',
        displayName: '总管理员',
        roles: ['owner'] as const,
        permissions: new Set<StaffPermissionCode>(['RESERVATION_DECIDE']),
      },
      idempotencyKey: 'reservation:http:reopen:reject',
      now: 5500,
    });

    const app = createTestApp();
    const bindings: AppBindings = { DB: database };
    const response = await app.request(
      `http://local/api/staff/reservations/${submitted.reservation_id}/reopen`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'reservation:http:reopen:command',
          'X-Test-Permission': 'RESERVATION_DECIDE',
        },
        body: JSON.stringify({
          expected_version: 2,
          reason: '买家已补充资料',
        }),
      },
      bindings,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: { reservation_reopen: {
        reservation_id: string;
        status: string;
        version: number;
        reopened_count: number;
        reason: string;
      } };
    };
    expect(body.data.reservation_reopen).toMatchObject({
      reservation_id: submitted.reservation_id,
      status: 'PENDING_REVIEW',
      version: 3,
      reopened_count: 1,
      reason: '买家已补充资料',
    });

    const workItems = await database.prepare(`
      SELECT work_type, status, source_entity_type, source_entity_id
      FROM staff_work_items
      WHERE source_entity_id=?
      ORDER BY created_at, id
    `).bind(submitted.reservation_id).all<{
      work_type: string;
      status: string;
      source_entity_type: string;
      source_entity_id: string;
    }>();
    expect(workItems.results.map((row) =>
      [row.work_type, row.status])).toEqual([
        ['RESERVATION_DECISION', 'COMPLETED'],
        ['RESERVATION_DECISION', 'OPEN'],
      ]);

    const events = await database.prepare(`
      SELECT event_type
      FROM reservation_events
      WHERE reservation_id=?
      ORDER BY created_at, id
    `).bind(submitted.reservation_id).all<{ event_type: string }>();
    expect(events.results.map((event) =>
      event.event_type)).toEqual([
        'RESERVATION_SUBMITTED',
        'RESERVATION_REJECTED',
        'RESERVATION_REOPENED',
      ]);
  });

  it('requires staff authorization and the decision permission', async () => {
    database = createMigratedTestDatabase();
    seedWorkflowFixture(database);
    const app = createTestApp();
    const bindings: AppBindings = { DB: database };
    const base = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'reservation:http:reopen:unauth',
      },
      body: JSON.stringify({ expected_version: 1, reason: '补充资料' }),
    };
    expect((await app.request(
      'http://local/api/staff/reservations/whatever/reopen',
      base,
      bindings,
    )).status).toBe(401);
    expect((await app.request(
      'http://local/api/staff/reservations/whatever/reopen',
      { ...base, headers: {
        ...base.headers,
        'X-Test-Permission': 'PRODUCT_VIEW',
      } },
      bindings,
    )).status).toBe(403);
  });

  it('validates the reopen body strictly', async () => {
    database = createMigratedTestDatabase();
    seedWorkflowFixture(database);
    const app = createTestApp();
    const bindings: AppBindings = { DB: database };
    const headers = {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'reservation:http:reopen:body',
      'X-Test-Permission': 'RESERVATION_DECIDE',
    };
    expect((await app.request(
      'http://local/api/staff/reservations/whatever/reopen',
      { method: 'POST', headers, body: JSON.stringify({ expected_version: 1 }) },
      bindings,
    )).status).toBe(400);
    expect((await app.request(
      'http://local/api/staff/reservations/whatever/reopen',
      { method: 'POST', headers, body: JSON.stringify({
        expected_version: 1, reason: '补充资料', extra: true,
      }) },
      bindings,
    )).status).toBe(400);
    expect((await app.request(
      'http://local/api/staff/reservations/whatever/reopen',
      { method: 'POST', headers, body: JSON.stringify({
        expected_version: '1', reason: '补充资料',
      }) },
      bindings,
    )).status).toBe(400);
  });

  it('returns 404 for an unknown reservation and 409 for a non-terminal one', async () => {
    database = createMigratedTestDatabase();
    seedWorkflowFixture(database);

    const submitted = await submitReservation(database, {
      demandBatchId: 'demand-1',
    }, {
      actor: buyerActor('buyer-1'),
      idempotencyKey: 'reservation:http:reopen:conflict:submit',
      now: 5000,
    });

    const app = createTestApp();
    const bindings: AppBindings = { DB: database };
    const headers = {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'reservation:http:reopen:conflict',
      'X-Test-Permission': 'RESERVATION_DECIDE',
    };
    const missing = await app.request(
      'http://local/api/staff/reservations/unknown-reservation/reopen',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ expected_version: 1, reason: '补充资料' }),
      },
      bindings,
    );
    expect(missing.status).toBe(404);

    const conflict = await app.request(
      `http://local/api/staff/reservations/${submitted.reservation_id}/reopen`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ expected_version: 1, reason: '补充资料' }),
      },
      bindings,
    );
    expect(conflict.status).toBe(409);
  });
});
