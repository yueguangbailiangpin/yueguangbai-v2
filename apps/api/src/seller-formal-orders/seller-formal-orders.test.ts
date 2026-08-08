import { readdirSync } from 'node:fs';
import path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import type {
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import { createApp } from '../app';
import { issueCustomerSession } from '../customer-auth/authenticate-customer';
import { confirmFormalOrder } from '../formal-orders/confirm-formal-order';
import type { FormalOrderStaffActor } from '../formal-orders/formal-order-shared';
import {
  bindPhase3GEvidenceFixture,
  seedPhase3GInstructionFixture,
} from '../../test-support/phase3g-test-fixtures';
import { registerSellerFormalOrderRoutes } from './routes';

const ORIGIN = 'https://portal.local.test';
const SESSION_SECRET =
  'phase4c2-seller-formal-order-secret-at-least-thirty-two-bytes';
const BUSINESS_DATE = '2026-08-01';
const FIRST_CONFIRMED_AT = Date.UTC(2026, 7, 1, 0, 0, 0);
const SECOND_CONFIRMED_AT = FIRST_CONFIRMED_AT;
const OTHER_CONFIRMED_AT = FIRST_CONFIRMED_AT + 2_000;

interface FixtureOrders {
  storeOne: string;
  storeTwo: string;
  otherOrganization: string;
}

let database: SqliteDatabase | null = null;
let orders: FixtureOrders | null = null;

beforeEach(async () => {
  database = createMigratedTestDatabase();
  await seedFixture(database);
  const storeOne = await confirmFormalOrder(
    database,
    {
      orderEvidenceSubmissionId: 'evidence-portal-1',
      expectedVersion: 2,
    },
    command('portal-confirm-store-1', FIRST_CONFIRMED_AT),
  );
  const storeTwo = await confirmFormalOrder(
    database,
    {
      orderEvidenceSubmissionId: 'evidence-portal-2',
      expectedVersion: 2,
    },
    command('portal-confirm-store-2', SECOND_CONFIRMED_AT),
  );
  const otherOrganization = await confirmFormalOrder(
    database,
    {
      orderEvidenceSubmissionId: 'evidence-portal-other',
      expectedVersion: 2,
    },
    command('portal-confirm-other-org', OTHER_CONFIRMED_AT),
  );
  orders = {
    storeOne: storeOne.formal_order_id,
    storeTwo: storeTwo.formal_order_id,
    otherOrganization: otherOrganization.formal_order_id,
  };
});

afterEach(() => {
  database?.close();
  database = null;
  orders = null;
});

describe('Phase 4C2 seller formal order HTTP API', () => {
  it('requires a seller session and rejects forced or inactive account trees', async () => {
    const app = testApp();
    const anonymous = await request(app, '/api/seller-portal/formal-orders');
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('cache-control')).toBe('no-store');
    expect(anonymous.headers.get('x-request-id')).toEqual(expect.any(String));
    await expect(json(anonymous)).resolves.toMatchObject({
      error: { code: 'UNAUTHENTICATED' },
      meta: { request_id: expect.any(String) },
    });

    const buyer = await request(app, '/api/seller-portal/formal-orders', {
      headers: { Cookie: await cookie('buyer') },
    });
    expect(buyer.status).toBe(403);
    await expect(json(buyer)).resolves.toMatchObject({
      error: { code: 'FORBIDDEN' },
    });

    const forced = await request(app, '/api/seller-portal/formal-orders', {
      headers: { Cookie: await cookie('forced') },
    });
    expect(forced.status).toBe(403);
    await expect(json(forced)).resolves.toMatchObject({
      error: { code: 'PASSWORD_CHANGE_REQUIRED' },
    });

    database!.exec(`
      UPDATE customer_login_accounts
      SET status='DISABLED', disabled_at=9000, updated_at=9000
      WHERE id='account-owner';
    `);
    const disabledAccount = await request(
      app,
      '/api/seller-portal/formal-orders',
      { headers: { Cookie: await cookie('owner') } },
    );
    expect(disabledAccount.status).toBe(401);

    database!.exec(`
      UPDATE customer_login_accounts
      SET status='ACTIVE', disabled_at=NULL, updated_at=9001
      WHERE id='account-owner';
      UPDATE seller_organization_members
      SET status='DISABLED', disabled_at=9001, updated_at=9001
      WHERE id='member-owner';
    `);
    const disabledMember = await request(
      app,
      '/api/seller-portal/formal-orders',
      { headers: { Cookie: await cookie('owner') } },
    );
    expect(disabledMember.status).toBe(401);

    database!.exec(`
      UPDATE seller_organization_members
      SET status='ACTIVE', disabled_at=NULL, updated_at=9002
      WHERE id='member-owner';
      UPDATE seller_organizations
      SET status='DISABLED', disabled_at=9002, updated_at=9002
      WHERE id='org-portal';
    `);
    const disabledOrganization = await request(
      app,
      '/api/seller-portal/formal-orders',
      { headers: { Cookie: await cookie('owner') } },
    );
    expect(disabledOrganization.status).toBe(401);
  });

  it('applies organization and explicit store scope to all four read roles', async () => {
    const app = testApp();
    const owner = await list(app, 'owner');
    expect(ids(owner)).toEqual(expectedOwnerOrder());
    expect(JSON.stringify(owner)).not.toContain(
      requiredOrders().otherOrganization,
    );

    for (const actor of ['ops', 'finance', 'viewer'] as const) {
      const body = await list(app, actor);
      expect(ids(body)).toEqual([requiredOrders().storeOne]);
      const outside = await request(
        app,
        `/api/seller-portal/formal-orders/${requiredOrders().storeTwo}`,
        { headers: { Cookie: await cookie(actor) } },
      );
      expect(outside.status).toBe(404);
      await expect(json(outside)).resolves.toMatchObject({
        error: { code: 'FORMAL_ORDER_NOT_FOUND' },
      });
    }

    const otherOwner = await list(app, 'other-owner');
    expect(ids(otherOwner)).toEqual([
      requiredOrders().otherOrganization,
    ]);
    const crossOrganization = await request(
      app,
      `/api/seller-portal/formal-orders/${requiredOrders().storeOne}`,
      { headers: { Cookie: await cookie('other-owner') } },
    );
    expect(crossOrganization.status).toBe(404);
  });

  it('uses bounded stable paging and supports every declared filter', async () => {
    const app = testApp();
    const first = await request(
      app,
      '/api/seller-portal/formal-orders?limit=1',
      { headers: { Cookie: await cookie('owner') } },
    );
    expect(first.status).toBe(200);
    const firstBody = await json<any>(first);
    expect(firstBody.data.items).toHaveLength(1);
    expect(firstBody.data.items[0].formal_order_id)
      .toBe(expectedOwnerOrder()[0]);
    expect(firstBody.data.page.limit).toBe(1);
    expect(firstBody.data.page.next_cursor).toEqual(expect.any(String));

    const second = await request(
      app,
      '/api/seller-portal/formal-orders?limit=1&cursor='
        + encodeURIComponent(firstBody.data.page.next_cursor),
      { headers: { Cookie: await cookie('owner') } },
    );
    const secondBody = await json<any>(second);
    expect(secondBody.data.items[0].formal_order_id)
      .toBe(expectedOwnerOrder()[1]);
    expect(secondBody.data.page.next_cursor).toBeNull();

    const cases: readonly [string, string][] = [
      ['store_id=store-portal-1', requiredOrders().storeOne],
      ['marketplace_code=JP', requiredOrders().storeTwo],
      ['asin=B0PORT0001', requiredOrders().storeOne],
      ['product_name=' + encodeURIComponent('Portal 产品二'),
        requiredOrders().storeTwo],
      ['review_type=IMAGE', requiredOrders().storeOne],
      [`confirmed_business_date=${BUSINESS_DATE}`,
        requiredOrders().storeTwo],
      [`formal_order_id=${encodeURIComponent(requiredOrders().storeOne)}`,
        requiredOrders().storeOne],
      ['amazon_order_number=111-1234567-1234567',
        requiredOrders().storeOne],
    ];
    for (const [query, expectedId] of cases) {
      const response = await request(
        app,
        `/api/seller-portal/formal-orders?${query}`,
        { headers: { Cookie: await cookie('owner') } },
      );
      expect(response.status).toBe(200);
      const body = await json<any>(response);
      expect(body.data.items.map(
        (item: { formal_order_id: string }) => item.formal_order_id,
      )).toContain(expectedId);
    }

    for (const query of [
      'limit=0',
      'limit=101',
      'cursor=not-base64',
      'marketplace_code=US',
      'asin=bad',
      'review_type=UNKNOWN',
      'confirmed_business_date=2026-02-30',
      'amazon_order_number=bad',
    ]) {
      const invalid = await request(
        app,
        `/api/seller-portal/formal-orders?${query}`,
        { headers: { Cookie: await cookie('owner') } },
      );
      expect(invalid.status).toBe(400);
      await expect(json(invalid)).resolves.toMatchObject({
        error: { code: 'VALIDATION_ERROR' },
      });
    }
  });

  it('returns only the seller-safe immutable order and snapshot projection', async () => {
    const app = testApp();
    const response = await request(
      app,
      `/api/seller-portal/formal-orders/${requiredOrders().storeOne}`,
      { headers: { Cookie: await cookie('owner') } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json<any>(response);
    expect(body).toMatchObject({
      data: {
        formal_order: {
          formal_order_id: requiredOrders().storeOne,
          status: 'CONFIRMED',
          marketplace_code: 'JP',
          canonical_marketplace_code: 'AMAZON_JP',
          amazon_order_number: '111-1234567-1234567',
          platform_order_identifier: '111-1234567-1234567',
          store: {
            id: 'store-portal-1',
            display_name: 'Portal Alpha 店铺',
          },
          asin: 'B0PORT0001',
          platform_product_identifier: 'B0PORT0001',
          product_name: 'Portal 产品一',
          product_version: {
            id: 'product-portal-1-v1',
            version_no: 1,
          },
          review_type: 'IMAGE',
          final_paid_jpy: '8880',
          payment: {
            amount_minor: '8880',
            currency_code: 'JPY',
            currency_exponent: 0,
          },
          seller_expected_principal_cny_fen: '53280',
          seller_agreement_rate_snapshot: {
            rate_version_id: 'seller-rate-portal-v1',
            version_no: 1,
            cny_per_jpy_e8: '6000000',
            source_currency_code: 'JPY',
            quote_currency_code: 'CNY',
            rate_value: '6000000',
            rate_scale: '100000000',
            rounding_rule: 'HALF_UP',
          },
          locked_service_fee_snapshot: {
            fee_version_id: 'service-fee-portal-image-v1',
            version_no: 1,
            review_type: 'IMAGE',
            service_fee_cny_fen: '2500',
            marketplace_code: 'AMAZON_JP',
            currency_code: 'CNY',
            currency_exponent: 2,
          },
          business_completion: {
            status: 'IN_PROGRESS',
            review: 'PENDING',
            buyer_refund: 'PENDING',
            seller_principal: 'PENDING',
            seller_service_fee: 'PENDING',
          },
          confirmed_at: FIRST_CONFIRMED_AT,
          confirmed_business_date: BUSINESS_DATE,
        },
      },
      meta: { request_id: expect.any(String) },
    });

    const serialized = JSON.stringify(body);
    for (const forbidden of [
      'buyer_customer',
      'buyer-portal-1',
      'buyer_customer_no',
      'buyer_rate',
      'buyer_cny_per_jpy_e8',
      'buyer_expected_principal_cny_fen',
      'staff-confirm',
      'internal_review_note',
      'internal product secret',
      'idempotency',
      'audit',
      'profit',
      'settlement',
      'settled',
      'cash_difference',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('keeps historical values unchanged after product and pricing rules change', async () => {
    database!.exec(`
      INSERT INTO product_versions (
        id, product_id, version_no, product_name,
        search_keywords_json, product_url,
        buyer_visible_notes, internal_notes,
        created_by_staff_id, created_at
      ,
          ordering_guide_expected_amount_jpy,
          color_spec_mode) VALUES (
        'product-portal-1-v2', 'product-portal-1', 2,
        'Portal 产品一新规则名称', '[]', NULL, NULL,
        'new internal secret', 'staff-confirm', 9900
      ,
          1980, 'MAIN_IMAGE_VARIANT');
      UPDATE products
      SET current_version_no=2, version=2, updated_at=9900
      WHERE id='product-portal-1';

      INSERT INTO seller_agreement_rate_versions (
        id, organization_id, review_type, version_no,
        status, cny_per_jpy_e8, effective_from,
        submitted_by_staff_id, submitted_at, decision_version,
        confirmed_by_staff_id, confirmed_at,
        rejected_by_staff_id, rejected_at, rejection_reason
      ) VALUES (
        'seller-rate-portal-v2', 'org-portal', NULL, 2,
        'SUBMITTED', 9000000, 9800,
        'staff-confirm', 9700, 1,
        NULL, NULL, NULL, NULL, NULL
      );
      UPDATE seller_agreement_rate_versions
      SET status='CONFIRMED', decision_version=2,
          confirmed_by_staff_id='staff-confirm', confirmed_at=9750
      WHERE id='seller-rate-portal-v2';

      INSERT INTO seller_service_fee_versions (
        id, organization_id, review_type, version_no,
        status, fee_cny_fen, effective_from,
        submitted_by_staff_id, submitted_at, decision_version,
        confirmed_by_staff_id, confirmed_at,
        rejected_by_staff_id, rejected_at, rejection_reason
      ) VALUES (
        'service-fee-portal-image-v2', 'org-portal', 'IMAGE', 2,
        'SUBMITTED', 9999, 9800,
        'staff-confirm', 9700, 1,
        NULL, NULL, NULL, NULL, NULL
      );
      UPDATE seller_service_fee_versions
      SET status='CONFIRMED', decision_version=2,
          confirmed_by_staff_id='staff-confirm', confirmed_at=9750
      WHERE id='service-fee-portal-image-v2';
    `);

    const app = testApp();
    const response = await request(
      app,
      `/api/seller-portal/formal-orders/${requiredOrders().storeOne}`,
      { headers: { Cookie: await cookie('owner') } },
    );
    const body = await json<any>(response);
    expect(body.data.formal_order).toMatchObject({
      product_name: 'Portal 产品一',
      product_version: {
        id: 'product-portal-1-v1',
        version_no: 1,
      },
      seller_expected_principal_cny_fen: '53280',
      seller_agreement_rate_snapshot: {
        rate_version_id: 'seller-rate-portal-v1',
        cny_per_jpy_e8: '6000000',
      },
      locked_service_fee_snapshot: {
        fee_version_id: 'service-fee-portal-image-v1',
        service_fee_cny_fen: '2500',
      },
    });
    expect(body.data.formal_order.product_name)
      .not.toBe('Portal 产品一新规则名称');
    expect(
      body.data.formal_order.seller_agreement_rate_snapshot
        .cny_per_jpy_e8,
    ).not.toBe('9000000');
    expect(
      body.data.formal_order.locked_service_fee_snapshot
        .service_fee_cny_fen,
    ).not.toBe('9999');
  });

  it('registers no write operation and leaves formal order facts unchanged', async () => {
    const app = testApp();
    const before = await formalOrderCounts();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await request(
        app,
        '/api/seller-portal/formal-orders',
        {
          method,
          headers: {
            Cookie: await cookie('owner'),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ status: 'SETTLED' }),
        },
      );
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(await formalOrderCounts()).toEqual(before);
  });

  it('retains the schema 26 history beneath current schema 28', async () => {
    const state = await database!.prepare(`
      SELECT schema_version
      FROM app_schema_state
      WHERE singleton_id=1
    `).first<{ schema_version: number }>();
    expect(Number(state?.schema_version)).toBe(35);

    const root = path.resolve(import.meta.dirname, '../../../..');
    const migrations = readdirSync(path.join(root, 'migrations'))
      .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
      .sort();
    expect(migrations).toHaveLength(35);
    expect(migrations[0]?.startsWith('0001_')).toBe(true);
    expect(migrations[18]?.startsWith('0019_')).toBe(true);
    expect(migrations[25]).toBe('0026_financial_export_audit.sql');
    expect(migrations.at(-4)).toBe('0032_google_drive_cold_image_archive.sql');
    expect(migrations.at(-3)).toBe('0033_feishu_staff_workbench_poc.sql');
    expect(migrations.at(-2)).toBe('0034_feishu_sync_dead_letter_categories.sql');
    expect(migrations.at(-1)).toBe('0035_staff_four_role_consolidation.sql');
  });
});

function testApp() {
  const app = createApp();
  registerSellerFormalOrderRoutes(app);
  return app;
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
    } as any,
  );
}

type SessionActor =
  | 'owner'
  | 'ops'
  | 'finance'
  | 'viewer'
  | 'forced'
  | 'other-owner'
  | 'buyer';

async function cookie(actor: SessionActor): Promise<string> {
  const definition = SESSION_ACTORS[actor];
  const token = await issueCustomerSession(
    {
      accountId: definition.accountId,
      identitySubjectId: definition.identitySubjectId,
      accountType: definition.accountType,
      sessionVersion: 1,
      passwordChangeRequired: definition.passwordChangeRequired,
    },
    SESSION_SECRET,
    { now: Date.now() },
  );
  return `__Host-ygb_customer_session=${token}`;
}

const SESSION_ACTORS = Object.freeze({
  owner: {
    accountId: 'account-owner',
    identitySubjectId: 'subject-owner',
    accountType: 'SELLER_MEMBER' as const,
    passwordChangeRequired: false,
  },
  ops: {
    accountId: 'account-ops',
    identitySubjectId: 'subject-ops',
    accountType: 'SELLER_MEMBER' as const,
    passwordChangeRequired: false,
  },
  finance: {
    accountId: 'account-finance',
    identitySubjectId: 'subject-finance',
    accountType: 'SELLER_MEMBER' as const,
    passwordChangeRequired: false,
  },
  viewer: {
    accountId: 'account-viewer',
    identitySubjectId: 'subject-viewer',
    accountType: 'SELLER_MEMBER' as const,
    passwordChangeRequired: false,
  },
  forced: {
    accountId: 'account-forced',
    identitySubjectId: 'subject-forced',
    accountType: 'SELLER_MEMBER' as const,
    passwordChangeRequired: true,
  },
  'other-owner': {
    accountId: 'account-other-owner',
    identitySubjectId: 'subject-other-owner',
    accountType: 'SELLER_MEMBER' as const,
    passwordChangeRequired: false,
  },
  buyer: {
    accountId: 'account-buyer',
    identitySubjectId: 'subject-buyer-1',
    accountType: 'BUYER' as const,
    passwordChangeRequired: false,
  },
});

async function list(
  app: ReturnType<typeof testApp>,
  actor: SessionActor,
): Promise<any> {
  const response = await request(
    app,
    '/api/seller-portal/formal-orders',
    { headers: { Cookie: await cookie(actor) } },
  );
  expect(response.status).toBe(200);
  return json<any>(response);
}

function ids(body: any): string[] {
  return body.data.items.map(
    (item: { formal_order_id: string }) => item.formal_order_id,
  );
}

function requiredOrders(): FixtureOrders {
  if (!orders) throw new Error('fixture_orders_missing');
  return orders;
}

function expectedOwnerOrder(): string[] {
  const fixture = requiredOrders();
  return [fixture.storeOne, fixture.storeTwo].sort().reverse();
}

async function formalOrderCounts(): Promise<{
  orders: number;
  snapshots: number;
  events: number;
}> {
  const row = await database!.prepare(`
    SELECT
      (SELECT COUNT(*) FROM formal_orders) AS orders,
      (SELECT COUNT(*) FROM formal_order_financial_snapshots) AS snapshots,
      (SELECT COUNT(*) FROM formal_order_events) AS events
  `).first<{
    orders: number;
    snapshots: number;
    events: number;
  }>();
  if (!row) throw new Error('formal_order_counts_missing');
  return {
    orders: Number(row.orders),
    snapshots: Number(row.snapshots),
    events: Number(row.events),
  };
}

function command(idempotencyKey: string, now: number) {
  return {
    actor: staffActor(),
    idempotencyKey,
    requestId: `request:${idempotencyKey}`,
    now,
  };
}

function staffActor(): FormalOrderStaffActor {
  const roles: readonly StaffRoleCode[] = ['pre_sales'];
  const permissions: readonly StaffPermissionCode[] = ['ORDER_CONFIRM'];
  return {
    staffId: 'staff-confirm',
    displayName: '正式订单确认员工',
    roles,
    permissions: new Set(permissions),
  };
}

async function seedFixture(db: SqliteDatabase): Promise<void> {
  db.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'staff-confirm', '正式订单确认员工', 'ACTIVE', 1,
      1, 1000, 1000, NULL
    );

    INSERT INTO customer_identity_subjects (id, subject_type, created_at)
    VALUES
      ('subject-owner', 'SELLER_ORG_MEMBER', 1000),
      ('subject-ops', 'SELLER_ORG_MEMBER', 1000),
      ('subject-finance', 'SELLER_ORG_MEMBER', 1000),
      ('subject-viewer', 'SELLER_ORG_MEMBER', 1000),
      ('subject-forced', 'SELLER_ORG_MEMBER', 1000),
      ('subject-other-owner', 'SELLER_ORG_MEMBER', 1000),
      ('subject-buyer-1', 'BUYER_CUSTOMER', 1000),
      ('subject-buyer-2', 'BUYER_CUSTOMER', 1000),
      ('subject-buyer-other', 'BUYER_CUSTOMER', 1000);

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id, seller_sequence,
      organization_name, status, version,
      created_at, updated_at, activated_at, disabled_at,
      next_member_number
    ) VALUES
      (
        'org-portal', 'JP', 'ido-mango-portal-c2',
        'seller-channel-ido-mango', 'seller-channel-ido-mango', 9301,
        'Portal 卖家组织', 'ACTIVE', 1,
        1000, 1000, 1000, NULL, 6
      ),
      (
        'org-other', 'JP', 'ido-mango-portal-other',
        'seller-channel-ido-mango', 'seller-channel-ido-mango', 9302,
        '其他卖家组织', 'ACTIVE', 1,
        1000, 1000, 1000, NULL, 2
      );

    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id,
      member_number, username_fallback, display_name,
      role, primary_owner, status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES
      ('member-owner', 'subject-owner', 'org-portal', 1,
       'portal-c2-owner', '负责人', 'OWNER', 1, 'ACTIVE', 1,
       1000, 1000, 1000, NULL),
      ('member-ops', 'subject-ops', 'org-portal', 2,
       'portal-c2-ops', '运营', 'OPERATIONS', 0, 'ACTIVE', 1,
       1000, 1000, 1000, NULL),
      ('member-finance', 'subject-finance', 'org-portal', 3,
       'portal-c2-finance', '财务', 'FINANCE', 0, 'ACTIVE', 1,
       1000, 1000, 1000, NULL),
      ('member-viewer', 'subject-viewer', 'org-portal', 4,
       'portal-c2-viewer', '只读', 'VIEWER', 0, 'ACTIVE', 1,
       1000, 1000, 1000, NULL),
      ('member-forced', 'subject-forced', 'org-portal', 5,
       'portal-c2-forced', '需改密', 'VIEWER', 0, 'ACTIVE', 1,
       1000, 1000, 1000, NULL),
      ('member-other-owner', 'subject-other-owner', 'org-other', 1,
       'portal-c2-other-owner', '其他负责人', 'OWNER', 1, 'ACTIVE', 1,
       1000, 1000, 1000, NULL);

    INSERT INTO seller_stores (
      id, organization_id, marketplace_code,
      display_name, normalized_name, status, version,
      created_at, updated_at, disabled_at
    ) VALUES
      ('store-portal-1', 'org-portal', 'JP',
       'Portal Alpha 店铺', 'portal alpha 店铺',
       'ACTIVE', 1, 1000, 1000, NULL),
      ('store-portal-2', 'org-portal', 'JP',
       'Portal Beta 店铺', 'portal beta 店铺',
       'ACTIVE', 1, 1000, 1000, NULL),
      ('store-other', 'org-other', 'JP',
       'Other 店铺', 'other 店铺',
       'ACTIVE', 1, 1000, 1000, NULL);

    INSERT INTO seller_member_store_scopes (
      member_id, store_id, organization_id, status,
      assigned_by_staff_id, assigned_at, revoked_at,
      created_at, updated_at
    ) VALUES
      ('member-ops', 'store-portal-1', 'org-portal', 'ACTIVE',
       'staff-confirm', 1000, NULL, 1000, 1000),
      ('member-finance', 'store-portal-1', 'org-portal', 'ACTIVE',
       'staff-confirm', 1000, NULL, 1000, 1000),
      ('member-viewer', 'store-portal-1', 'org-portal', 'ACTIVE',
       'staff-confirm', 1000, NULL, 1000, 1000),
      ('member-forced', 'store-portal-1', 'org-portal', 'ACTIVE',
       'staff-confirm', 1000, NULL, 1000, 1000);

    INSERT INTO customer_login_accounts (
      id, identity_subject_id, account_type,
      login_identifier_display, login_identifier_normalized,
      status, session_version, password_change_required,
      version, created_at, updated_at, activated_at, disabled_at
    ) VALUES
      ('account-owner', 'subject-owner', 'SELLER_MEMBER',
       'owner-c2', 'owner-c2', 'ACTIVE', 1, 0,
       1, 1000, 1000, 1000, NULL),
      ('account-ops', 'subject-ops', 'SELLER_MEMBER',
       'ops-c2', 'ops-c2', 'ACTIVE', 1, 0,
       1, 1000, 1000, 1000, NULL),
      ('account-finance', 'subject-finance', 'SELLER_MEMBER',
       'finance-c2', 'finance-c2', 'ACTIVE', 1, 0,
       1, 1000, 1000, 1000, NULL),
      ('account-viewer', 'subject-viewer', 'SELLER_MEMBER',
       'viewer-c2', 'viewer-c2', 'ACTIVE', 1, 0,
       1, 1000, 1000, 1000, NULL),
      ('account-forced', 'subject-forced', 'SELLER_MEMBER',
       'forced-c2', 'forced-c2', 'ACTIVE', 1, 1,
       1, 1000, 1000, 1000, NULL),
      ('account-other-owner', 'subject-other-owner', 'SELLER_MEMBER',
       'other-owner-c2', 'other-owner-c2', 'ACTIVE', 1, 0,
       1, 1000, 1000, 1000, NULL),
      ('account-buyer', 'subject-buyer-1', 'BUYER',
       'buyer-c2', 'buyer-c2', 'ACTIVE', 1, 0,
       1, 1000, 1000, 1000, NULL);

    INSERT INTO buyer_channels (
      id, code, name, status, next_sequence, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'buyer-channel-portal-c2', 'K', 'Portal C2 buyers',
      'ACTIVE', 1, 1, 1000, 1000, NULL
    );

    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code,
      buyer_channel_id, buyer_customer_no, buyer_sequence,
      first_valid_order_business_date, display_name,
      access_status, identity_review_status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES
      ('buyer-portal-1', 'subject-buyer-1', 'JP',
       'buyer-channel-portal-c2', NULL, NULL, NULL, 'Portal buyer 1',
       'ACTIVE', 'CLEAR', 1, 1000, 1000, 1000, NULL),
      ('buyer-portal-2', 'subject-buyer-2', 'JP',
       'buyer-channel-portal-c2', NULL, NULL, NULL, 'Portal buyer 2',
       'ACTIVE', 'CLEAR', 1, 1000, 1000, 1000, NULL),
      ('buyer-other', 'subject-buyer-other', 'JP',
       'buyer-channel-portal-c2', NULL, NULL, NULL, 'Other buyer',
       'ACTIVE', 'CLEAR', 1, 1000, 1000, 1000, NULL);

    INSERT INTO products (
      id, organization_id, store_id, marketplace_code,
      asin_display, asin_normalized, status,
      current_version_no, version,
      created_at, updated_at, disabled_at
    ) VALUES
      ('product-portal-1', 'org-portal', 'store-portal-1', 'JP',
       'B0PORT0001', 'B0PORT0001', 'ACTIVE', 1, 1,
       1000, 1000, NULL),
      ('product-portal-2', 'org-portal', 'store-portal-2', 'JP',
       'B0PORT0002', 'B0PORT0002', 'ACTIVE', 1, 1,
       1000, 1000, NULL),
      ('product-other', 'org-other', 'store-other', 'JP',
       'B0PORT0003', 'B0PORT0003', 'ACTIVE', 1, 1,
       1000, 1000, NULL);

    INSERT INTO product_versions (
      id, product_id, version_no, product_name,
      search_keywords_json, product_url,
      buyer_visible_notes, internal_notes,
      created_by_staff_id, created_at
    ,
          ordering_guide_expected_amount_jpy,
          color_spec_mode) VALUES
      ('product-portal-1-v1', 'product-portal-1', 1,
       'Portal 产品一', '[]', NULL, NULL,
       'internal product secret', 'staff-confirm', 1000,
          1980, 'MAIN_IMAGE_VARIANT'),
      ('product-portal-2-v1', 'product-portal-2', 1,
       'Portal 产品二', '[]', NULL, NULL,
       'internal product secret two', 'staff-confirm', 1000,
          1980, 'MAIN_IMAGE_VARIANT'),
      ('product-other-v1', 'product-other', 1,
       'Other 产品', '[]', NULL, NULL,
       'other internal secret', 'staff-confirm', 1000,
          1980, 'MAIN_IMAGE_VARIANT');

    INSERT INTO demand_batches (
      id, organization_id, store_id, marketplace_code,
      product_id, product_version_no, submitted_by_member_id,
      task_type, target_quantity, buyer_visible_notes, seller_notes,
      open_at, reservation_deadline, order_deadline,
      status, review_reason, close_reason,
      reviewed_by_staff_id, closed_by_staff_id,
      version, submitted_at, updated_at,
      reviewed_at, published_at, withdrawn_at, closed_at,
      held_reservation_count, approved_reservation_count
    ) VALUES
      ('demand-portal-1', 'org-portal', 'store-portal-1', 'JP',
       'product-portal-1', 1, 'member-owner', 'IMAGE',
       10, NULL, 'seller note secret', 1000, 5000, 20000,
       'PUBLISHED', NULL, NULL, 'staff-confirm', NULL,
       2, 1000, 2000, 2000, 2000, NULL, NULL, 0, 1),
      ('demand-portal-2', 'org-portal', 'store-portal-2', 'JP',
       'product-portal-2', 1, 'member-owner', 'TEXT',
       10, NULL, 'seller note secret two', 1000, 5000, 20000,
       'PUBLISHED', NULL, NULL, 'staff-confirm', NULL,
       2, 1000, 2000, 2000, 2000, NULL, NULL, 0, 1),
      ('demand-other', 'org-other', 'store-other', 'JP',
       'product-other', 1, 'member-other-owner', 'VIDEO',
       10, NULL, 'other seller secret', 1000, 5000, 20000,
       'PUBLISHED', NULL, NULL, 'staff-confirm', NULL,
       2, 1000, 2000, 2000, 2000, NULL, NULL, 0, 1);

    INSERT INTO product_reservations (
      id, demand_batch_id, buyer_customer_id,
      organization_id, store_id, product_id,
      product_version_no, marketplace_code,
      status, precheck_snapshot_json,
      hold_expires_at, order_deadline_snapshot,
      version, submitted_at, updated_at,
      decided_by_staff_id, decision_reason, decided_at,
      cancelled_at, expired_at, reopened_count,
      buyer_self_pay_bps_snapshot,
      reference_order_amount_jpy_snapshot,
      estimated_self_pay_jpy_snapshot,
      estimated_refundable_principal_jpy_snapshot,
      buyer_self_pay_accepted_at,
      buyer_self_pay_accepted_demand_version
    ) VALUES
      ('reservation-portal-1', 'demand-portal-1', 'buyer-portal-1',
       'org-portal', 'store-portal-1', 'product-portal-1', 1, 'JP',
       'APPROVED', '{}', 5000, 20000, 2, 3000, 4000,
       'staff-confirm', NULL, 4000, NULL, NULL, 0,
       0, 1980, 0, 1980, 3000, 2),
      ('reservation-portal-2', 'demand-portal-2', 'buyer-portal-2',
       'org-portal', 'store-portal-2', 'product-portal-2', 1, 'JP',
       'APPROVED', '{}', 5000, 20000, 2, 3000, 4000,
       'staff-confirm', NULL, 4000, NULL, NULL, 0,
       0, 1980, 0, 1980, 3000, 2),
      ('reservation-other', 'demand-other', 'buyer-other',
       'org-other', 'store-other', 'product-other', 1, 'JP',
       'APPROVED', '{}', 5000, 20000, 2, 3000, 4000,
       'staff-confirm', NULL, 4000, NULL, NULL, 0,
       0, 1980, 0, 1980, 3000, 2);
  `);

  const instructionOne = await seedPhase3GInstructionFixture(db, {
    suffix: 'seller-portal-1',
    reservationId: 'reservation-portal-1',
    buyerCustomerId: 'buyer-portal-1',
    productId: 'product-portal-1',
    productVersionId: 'product-portal-1-v1',
    staffId: 'staff-confirm',
    publishedAt: 4_000,
  });
  const instructionTwo = await seedPhase3GInstructionFixture(db, {
    suffix: 'seller-portal-2',
    reservationId: 'reservation-portal-2',
    buyerCustomerId: 'buyer-portal-2',
    productId: 'product-portal-2',
    productVersionId: 'product-portal-2-v1',
    staffId: 'staff-confirm',
    publishedAt: 4_000,
  });
  const instructionOther = await seedPhase3GInstructionFixture(db, {
    suffix: 'seller-portal-other',
    reservationId: 'reservation-other',
    buyerCustomerId: 'buyer-other',
    productId: 'product-other',
    productVersionId: 'product-other-v1',
    staffId: 'staff-confirm',
    publishedAt: 4_000,
  });

  db.exec(`

    INSERT INTO order_evidence_submissions (
      id, reservation_id, buyer_customer_id, marketplace_code,
      status, current_version_no, version,
      public_change_reason, internal_review_note,
      submitted_at, updated_at,
      verified_by_staff_id, verified_at,
      withdrawn_at, consumed_at, created_at
    ) VALUES
      ('evidence-portal-1', 'reservation-portal-1',
       'buyer-portal-1', 'JP', 'PENDING_VERIFICATION', 1, 1,
       NULL, 'internal review secret one', 5000, 5000,
       NULL, NULL, NULL, NULL, 5000),
      ('evidence-portal-2', 'reservation-portal-2',
       'buyer-portal-2', 'JP', 'PENDING_VERIFICATION', 1, 1,
       NULL, 'internal review secret two', 5000, 5000,
       NULL, NULL, NULL, NULL, 5000),
      ('evidence-portal-other', 'reservation-other',
       'buyer-other', 'JP', 'PENDING_VERIFICATION', 1, 1,
       NULL, 'other internal review secret', 5000, 5000,
       NULL, NULL, NULL, NULL, 5000);

    INSERT INTO order_evidence_versions (
      id, submission_id, reservation_id, buyer_customer_id,
      marketplace_code, version_no,
      amazon_order_number_raw, amazon_order_number_normalized,
      amazon_order_date,
      final_paid_jpy, submitted_by_buyer_id, buyer_note,
      order_instruction_id, order_instruction_version_id,
      instruction_deadline_snapshot,
      reference_order_amount_jpy_snapshot,
      buyer_self_pay_bps_snapshot, buyer_self_pay_jpy,
      buyer_refundable_principal_jpy, price_mismatch,
      price_difference_jpy, submitted_before_deadline,
      evidence_file_object_id, created_at
    ) VALUES
      ('evidence-portal-1-v1', 'evidence-portal-1',
       'reservation-portal-1', 'buyer-portal-1', 'JP', 1,
       '111-1234567-1234567', '111-1234567-1234567',
       '2026-08-01',
       8880, 'buyer-portal-1', 'buyer note secret one',
       '${instructionOne.instructionId}',
       '${instructionOne.instructionVersionId}',
       ${instructionOne.deadlineAt}, 1980, 0, 0, 8880, 1, 6900, 1,
       '${instructionOne.evidenceFileObjectId}', 5000),
      ('evidence-portal-2-v1', 'evidence-portal-2',
       'reservation-portal-2', 'buyer-portal-2', 'JP', 1,
       '222-1234567-1234567', '222-1234567-1234567',
       '2026-08-02',
       5000, 'buyer-portal-2', 'buyer note secret two',
       '${instructionTwo.instructionId}',
       '${instructionTwo.instructionVersionId}',
       ${instructionTwo.deadlineAt}, 1980, 0, 0, 5000, 1, 3020, 1,
       '${instructionTwo.evidenceFileObjectId}', 5000),
      ('evidence-portal-other-v1', 'evidence-portal-other',
       'reservation-other', 'buyer-other', 'JP', 1,
       '333-1234567-1234567', '333-1234567-1234567',
       '2026-08-03',
       7000, 'buyer-other', 'other buyer note secret',
       '${instructionOther.instructionId}',
       '${instructionOther.instructionVersionId}',
       ${instructionOther.deadlineAt}, 1980, 0, 0, 7000, 1, 5020, 1,
       '${instructionOther.evidenceFileObjectId}', 5000);

    UPDATE order_evidence_submissions
    SET status='VERIFIED', version=2,
        verified_by_staff_id='staff-confirm',
        verified_at=6000, updated_at=6000
    WHERE id IN (
      'evidence-portal-1',
      'evidence-portal-2',
      'evidence-portal-other'
    );

    INSERT INTO buyer_daily_exchange_rates (
      id, business_date, version_no, status, cny_per_jpy_e8,
      submitted_by_staff_id, submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at,
      rejected_by_staff_id, rejected_at, rejection_reason
    ) VALUES (
      'buyer-rate-portal-v1', '${BUSINESS_DATE}', 1,
      'SUBMITTED', 5500000,
      'staff-confirm', 1000, 1,
      NULL, NULL, NULL, NULL, NULL
    );
    UPDATE buyer_daily_exchange_rates
    SET status='CONFIRMED', decision_version=2,
        confirmed_by_staff_id='staff-confirm', confirmed_at=2000
    WHERE id='buyer-rate-portal-v1';
  `);

  await bindPhase3GEvidenceFixture(db, {
    suffix: 'seller-portal-1',
    submissionId: 'evidence-portal-1',
    evidenceVersionId: 'evidence-portal-1-v1',
    reservationId: 'reservation-portal-1',
    buyerCustomerId: 'buyer-portal-1',
    evidenceFileObjectId: instructionOne.evidenceFileObjectId,
    amazonOrderNumber: '111-1234567-1234567',
    at: 5_000,
  });
  await bindPhase3GEvidenceFixture(db, {
    suffix: 'seller-portal-2',
    submissionId: 'evidence-portal-2',
    evidenceVersionId: 'evidence-portal-2-v1',
    reservationId: 'reservation-portal-2',
    buyerCustomerId: 'buyer-portal-2',
    evidenceFileObjectId: instructionTwo.evidenceFileObjectId,
    amazonOrderNumber: '222-1234567-1234567',
    at: 5_000,
  });
  await bindPhase3GEvidenceFixture(db, {
    suffix: 'seller-portal-other',
    submissionId: 'evidence-portal-other',
    evidenceVersionId: 'evidence-portal-other-v1',
    reservationId: 'reservation-other',
    buyerCustomerId: 'buyer-other',
    evidenceFileObjectId: instructionOther.evidenceFileObjectId,
    amazonOrderNumber: '333-1234567-1234567',
    at: 5_000,
  });

  seedSellerRate(db, 'org-portal', 'seller-rate-portal-v1', 6_000_000);
  seedSellerRate(db, 'org-other', 'seller-rate-other-v1', 6_200_000);
  seedServiceFee(
    db,
    'org-portal',
    'IMAGE',
    'service-fee-portal-image-v1',
    2_500,
  );
  seedServiceFee(
    db,
    'org-portal',
    'TEXT',
    'service-fee-portal-text-v1',
    1_800,
  );
  seedServiceFee(
    db,
    'org-other',
    'VIDEO',
    'service-fee-other-video-v1',
    3_500,
  );
}

function seedSellerRate(
  db: SqliteDatabase,
  organizationId: string,
  id: string,
  cnyPerJpyE8: number,
): void {
  db.exec(`
    INSERT INTO seller_agreement_rate_versions (
      id, organization_id, review_type, version_no,
      status, cny_per_jpy_e8, effective_from,
      submitted_by_staff_id, submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at,
      rejected_by_staff_id, rejected_at, rejection_reason
    ) VALUES (
      '${id}', '${organizationId}', NULL, 1,
      'SUBMITTED', ${cnyPerJpyE8}, 3000,
      'staff-confirm', 1000, 1,
      NULL, NULL, NULL, NULL, NULL
    );
    UPDATE seller_agreement_rate_versions
    SET status='CONFIRMED', decision_version=2,
        confirmed_by_staff_id='staff-confirm', confirmed_at=2000
    WHERE id='${id}';
  `);
}

function seedServiceFee(
  db: SqliteDatabase,
  organizationId: string,
  reviewType: 'RATING' | 'TEXT' | 'IMAGE' | 'VIDEO',
  id: string,
  feeCnyFen: number,
): void {
  db.exec(`
    INSERT INTO seller_service_fee_versions (
      id, organization_id, review_type, version_no,
      status, fee_cny_fen, effective_from,
      submitted_by_staff_id, submitted_at, decision_version,
      confirmed_by_staff_id, confirmed_at,
      rejected_by_staff_id, rejected_at, rejection_reason
    ) VALUES (
      '${id}', '${organizationId}', '${reviewType}', 1,
      'SUBMITTED', ${feeCnyFen}, 3000,
      'staff-confirm', 1000, 1,
      NULL, NULL, NULL, NULL, NULL
    );
    UPDATE seller_service_fee_versions
    SET status='CONFIRMED', decision_version=2,
        confirmed_by_staff_id='staff-confirm', confirmed_at=2000
    WHERE id='${id}';
  `);
}

async function json<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}
