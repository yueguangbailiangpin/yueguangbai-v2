import { readdirSync } from 'node:fs';
import path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import { createApp } from '../app';
import { issueCustomerSession } from '../customer-auth/authenticate-customer';
import { registerSellerPortalRoutes } from './routes';

const ORIGIN = 'https://portal.local.test';
const SESSION_SECRET =
  'phase4c1-seller-portal-test-secret-at-least-thirty-two-bytes';

let database: SqliteDatabase | null = null;

beforeEach(() => {
  database = createMigratedTestDatabase();
  seedSellerPortalFixture(database);
});

afterEach(() => {
  database?.close();
  database = null;
});

describe('Phase 4C1 seller portal HTTP API', () => {
  it('rejects buyer sessions and forced-password-change seller sessions', async () => {
    const app = testApp();
    const buyer = await request(app, '/api/seller-portal/me', {
      headers: { Cookie: await cookie('buyer') },
    });
    expect(buyer.status).toBe(403);
    await expect(json(buyer)).resolves.toMatchObject({
      error: { code: 'FORBIDDEN' },
    });

    const forced = await request(app, '/api/seller-portal/me', {
      headers: { Cookie: await cookie('forced') },
    });
    expect(forced.status).toBe(403);
    await expect(json(forced)).resolves.toMatchObject({
      error: { code: 'PASSWORD_CHANGE_REQUIRED' },
    });

    const mismatchedToken = await issueCustomerSession(
      {
        accountId: 'account-owner',
        identitySubjectId: 'subject-ops',
        accountType: 'SELLER_MEMBER',
        sessionVersion: 1,
        passwordChangeRequired: false,
      },
      SESSION_SECRET,
      { now: Date.now() },
    );
    const mismatched = await request(app, '/api/seller-portal/me', {
      headers: {
        Cookie: `__Host-ygb_customer_session=${mismatchedToken}`,
      },
    });
    expect(mismatched.status).toBe(401);
    await expect(json(mismatched)).resolves.toMatchObject({
      error: { code: 'SESSION_INVALID' },
    });
  });

  it('derives member and organization only from the session subject', async () => {
    const app = testApp();
    const response = await request(app, '/api/seller-portal/me', {
      headers: { Cookie: await cookie('ops') },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await json<any>(response);
    expect(body).toMatchObject({
      data: {
        me: {
          account_id: 'account-ops',
          member: {
            id: 'member-ops',
            role: 'OPERATIONS',
          },
          organization: {
            id: 'org-1',
            seller_code: 'ido-mango-portal-1',
          },
          access: {
            read_scope: 'ASSIGNED_STORES',
            store_ids: ['store-1'],
            can_submit_product_applications: true,
            can_submit_demand_batches: true,
          },
        },
      },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('org-2');
    expect(serialized).not.toContain('member-owner-2');
  });

  it('enforces organization and store scope with 404-style resource handling', async () => {
    const app = testApp();
    const ownerProduct = await request(
      app,
      '/api/seller-portal/products/product-2',
      { headers: { Cookie: await cookie('owner') } },
    );
    expect(ownerProduct.status).toBe(200);

    const opsProduct = await request(
      app,
      '/api/seller-portal/products/product-2',
      { headers: { Cookie: await cookie('ops') } },
    );
    expect(opsProduct.status).toBe(404);
    await expect(json(opsProduct)).resolves.toMatchObject({
      error: { code: 'PRODUCT_NOT_FOUND' },
    });

    const otherOrg = await request(
      app,
      '/api/seller-portal/products/product-other',
      { headers: { Cookie: await cookie('owner') } },
    );
    expect(otherOrg.status).toBe(404);

    for (const role of ['finance', 'viewer'] as const) {
      const readable = await request(
        app,
        '/api/seller-portal/products/product-1',
        { headers: { Cookie: await cookie(role) } },
      );
      expect(readable.status).toBe(200);
    }
  });

  it('projects product fields and versions without internal fields', async () => {
    const app = testApp();
    const response = await request(
      app,
      '/api/seller-portal/products/product-1',
      { headers: { Cookie: await cookie('owner') } },
    );
    expect(response.status).toBe(200);
    const body = await json<Record<string, unknown>>(response);
    expect(body).toMatchObject({
      data: {
        product: {
          id: 'product-1',
          status: 'ACTIVE',
          current_version_no: 2,
          seller_code: 'ido-mango-portal-1',
          current_version: {
            product_name: '产品一新版',
            search_keywords: ['新关键词'],
            ordering_guide_expected_amount_jpy: 1980,
            color_spec_mode: 'MAIN_IMAGE_VARIANT',
            main_image: null,
          },
        },
      },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('内部秘密');
    expect(serialized).not.toContain('internal_notes');
    expect(serialized).not.toContain('created_by_staff_id');
    expect(serialized).not.toContain('object_key');
    expect(serialized).not.toContain('signed_url');
    expect(serialized).not.toContain('public_url');
    expect(serialized).not.toContain('wechat');

    const versions = await request(
      app,
      '/api/seller-portal/products/product-1/versions?limit=1',
      { headers: { Cookie: await cookie('owner') } },
    );
    expect(versions.status).toBe(200);
    const versionBody = await json<any>(versions);
    expect(versionBody.data.items).toHaveLength(1);
    expect(versionBody.data.items[0].version_no).toBe(2);
    expect(typeof versionBody.data.page.next_cursor).toBe('string');

    const next = await request(
      app,
      `/api/seller-portal/products/product-1/versions?limit=1&cursor=${encodeURIComponent(versionBody.data.page.next_cursor)}`,
      { headers: { Cookie: await cookie('owner') } },
    );
    const nextBody = await json<any>(next);
    expect(nextBody.data.items[0].version_no).toBe(1);
  });

  it('uses bounded stable pagination and rejects malformed cursors', async () => {
    const app = testApp();
    const first = await request(
      app,
      '/api/seller-portal/stores?limit=1',
      { headers: { Cookie: await cookie('owner') } },
    );
    const firstBody = await json<any>(first);
    expect(firstBody.data.items).toHaveLength(1);
    expect(firstBody.data.page.limit).toBe(1);
    expect(typeof firstBody.data.page.next_cursor).toBe('string');

    const second = await request(
      app,
      `/api/seller-portal/stores?limit=1&cursor=${encodeURIComponent(firstBody.data.page.next_cursor)}`,
      { headers: { Cookie: await cookie('owner') } },
    );
    const secondBody = await json<any>(second);
    expect(secondBody.data.items[0].id)
      .not.toBe(firstBody.data.items[0].id);

    for (const query of ['limit=101', 'limit=0', 'cursor=not-base64']) {
      const invalid = await request(
        app,
        `/api/seller-portal/stores?${query}`,
        { headers: { Cookie: await cookie('owner') } },
      );
      expect(invalid.status).toBe(400);
    }
  });

  it('submits and withdraws product applications idempotently', async () => {
    const app = testApp();
    const headers = await stateHeaders('ops', 'application-submit-0001');
    const payload = {
      store_id: 'store-1',
      asin: 'B000000010',
      product_name: '申请产品',
      search_keywords: ['关键词一'],
      product_url: 'https://www.amazon.co.jp/dp/B000000010',
      buyer_visible_notes: '买家可见说明',
      seller_notes: '卖家备注',
    };
    const first = await request(
      app,
      '/api/seller-portal/product-applications',
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      },
    );
    expect(first.status).toBe(201);
    const firstBody = await json<any>(first);
    expect(firstBody.data.application).toMatchObject({
      store: { id: 'store-1' },
      asin: 'B000000010',
      status: 'SUBMITTED',
      version: 1,
    });
    const applicationId = firstBody.data.application.id as string;

    const replay = await request(
      app,
      '/api/seller-portal/product-applications',
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      },
    );
    expect(replay.status).toBe(200);
    await expect(json(replay)).resolves.toMatchObject({
      data: { replayed: true },
    });

    const stale = await request(
      app,
      `/api/seller-portal/product-applications/${applicationId}/withdraw`,
      {
        method: 'POST',
        headers: await stateHeaders('ops', 'application-stale-0001'),
        body: JSON.stringify({ expected_version: 99 }),
      },
    );
    expect(stale.status).toBe(409);
    await expect(json(stale)).resolves.toMatchObject({
      error: { code: 'VERSION_CONFLICT' },
    });

    const withdrawn = await request(
      app,
      `/api/seller-portal/product-applications/${applicationId}/withdraw`,
      {
        method: 'POST',
        headers: await stateHeaders('ops', 'application-withdraw-0001'),
        body: JSON.stringify({ expected_version: 1 }),
      },
    );
    expect(withdrawn.status).toBe(200);
    await expect(json(withdrawn)).resolves.toMatchObject({
      data: {
        application: {
          id: applicationId,
          status: 'WITHDRAWN',
          version: 2,
        },
      },
    });

    const hidden = await request(
      app,
      '/api/seller-portal/product-applications/application-store-2/withdraw',
      {
        method: 'POST',
        headers: await stateHeaders('ops', 'application-hidden-0001'),
        body: JSON.stringify({ expected_version: 1 }),
      },
    );
    expect(hidden.status).toBe(404);
  });

  it('submits and withdraws demand batches idempotently', async () => {
    const app = testApp();
    const payload = {
      product_id: 'product-1',
      task_type: 'IMAGE',
      target_quantity: 8,
      buyer_visible_notes: '公开任务说明',
      seller_notes: '内部卖家备注',
      open_at: 10000,
      reservation_deadline: 20000,
      order_deadline: 30000,
    };
    const headers = await stateHeaders('ops', 'demand-submit-0001');
    const first = await request(
      app,
      '/api/seller-portal/demand-batches',
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      },
    );
    expect(first.status).toBe(201);
    const firstBody = await json<any>(first);
    expect(firstBody.data.demand_batch).toMatchObject({
      product: { id: 'product-1', version_no: 2 },
      target_quantity: 8,
      held_quantity: 0,
      approved_quantity: 0,
      remaining_quantity: 8,
      status: 'SUBMITTED',
    });
    const demandId = firstBody.data.demand_batch.id as string;

    const replay = await request(
      app,
      '/api/seller-portal/demand-batches',
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      },
    );
    expect(replay.status).toBe(200);
    await expect(json(replay)).resolves.toMatchObject({
      data: { replayed: true },
    });

    const stale = await request(
      app,
      `/api/seller-portal/demand-batches/${demandId}/withdraw`,
      {
        method: 'POST',
        headers: await stateHeaders('ops', 'demand-stale-0001'),
        body: JSON.stringify({ expected_version: 99 }),
      },
    );
    expect(stale.status).toBe(409);
    await expect(json(stale)).resolves.toMatchObject({
      error: { code: 'VERSION_CONFLICT' },
    });

    const withdrawn = await request(
      app,
      `/api/seller-portal/demand-batches/${demandId}/withdraw`,
      {
        method: 'POST',
        headers: await stateHeaders('ops', 'demand-withdraw-0001'),
        body: JSON.stringify({ expected_version: 1 }),
      },
    );
    expect(withdrawn.status).toBe(200);
    await expect(json(withdrawn)).resolves.toMatchObject({
      data: {
        demand_batch: {
          id: demandId,
          status: 'WITHDRAWN',
          version: 2,
        },
      },
    });
  });

  it('shows target/held/approved/remaining without buyer identity leakage', async () => {
    const app = testApp();
    const response = await request(
      app,
      '/api/seller-portal/demand-batches/demand-existing',
      { headers: { Cookie: await cookie('owner') } },
    );
    expect(response.status).toBe(200);
    const body = await json<any>(response);
    expect(body.data.demand_batch).toMatchObject({
      target_quantity: 10,
      held_quantity: 1,
      approved_quantity: 2,
      remaining_quantity: 7,
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('buyer-secret-1');
    expect(serialized).not.toContain('buyer_customer_id');
    expect(serialized).not.toContain('submitted_by_member_id');
    expect(serialized).not.toContain('reviewed_by_staff_id');
  });

  it('makes FINANCE and VIEWER read-only and protects writes with Origin Guard', async () => {
    const app = testApp();
    const payload = JSON.stringify({
      store_id: 'store-1',
      asin: 'B000000011',
      product_name: '只读角色申请',
      search_keywords: [],
      product_url: null,
      buyer_visible_notes: null,
      seller_notes: null,
    });
    for (const role of ['finance', 'viewer'] as const) {
      const blocked = await request(
        app,
        '/api/seller-portal/product-applications',
        {
          method: 'POST',
          headers: await stateHeaders(role, `readonly-${role}-0001`),
          body: payload,
        },
      );
      expect(blocked.status).toBe(403);
    }

    const missingOrigin = await request(
      app,
      '/api/seller-portal/product-applications',
      {
        method: 'POST',
        headers: {
          Cookie: await cookie('owner'),
          'Content-Type': 'application/json',
          'Idempotency-Key': 'missing-origin-0001',
        },
        body: payload,
      },
    );
    expect(missingOrigin.status).toBe(403);

    const crossOrigin = await request(
      app,
      '/api/seller-portal/product-applications',
      {
        method: 'POST',
        headers: {
          Cookie: await cookie('owner'),
          'Content-Type': 'application/json',
          'Idempotency-Key': 'cross-origin-0001',
          Origin: 'https://attacker.invalid',
          'Sec-Fetch-Site': 'cross-site',
        },
        body: payload,
      },
    );
    expect(crossOrigin.status).toBe(403);
  });

  it('retains the schema 26 history beneath current schema 27', async () => {
    if (!database) throw new Error('test_database_missing');
    const state = await database.prepare(`
      SELECT schema_version
      FROM app_schema_state
      WHERE singleton_id=1
    `).first<{ schema_version: number }>();
    expect(Number(state?.schema_version)).toBe(29);

    const root = path.resolve(import.meta.dirname, '../../../..');
    const migrations = readdirSync(path.join(root, 'migrations'))
      .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
      .sort();
    expect(migrations).toHaveLength(29);
    expect(migrations[0]?.startsWith('0001_')).toBe(true);
    expect(migrations[18]?.startsWith('0019_')).toBe(true);
    expect(migrations[25]).toBe('0026_financial_export_audit.sql');
    expect(migrations.at(-1)).toBe('0029_multi_marketplace_multicurrency_foundation.sql');
  });
});

function testApp() {
  const app = createApp();
  registerSellerPortalRoutes(app);
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

async function stateHeaders(
  actor: SessionActor,
  idempotencyKey: string,
): Promise<Record<string, string>> {
  return {
    Cookie: await cookie(actor),
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
    Origin: ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
  };
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
    accountId: 'account-owner-2',
    identitySubjectId: 'subject-owner-2',
    accountType: 'SELLER_MEMBER' as const,
    passwordChangeRequired: false,
  },
  buyer: {
    accountId: 'account-buyer',
    identitySubjectId: 'subject-buyer',
    accountType: 'BUYER' as const,
    passwordChangeRequired: false,
  },
});

function seedSellerPortalFixture(target: SqliteDatabase): void {
  target.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'staff-portal', 'Portal staff', 'ACTIVE', 1,
      1, 1000, 1000, NULL
    );

    INSERT INTO buyer_channels (
      id, code, name, status, next_sequence, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'buyer-channel-portal', 'P', 'Portal buyers', 'ACTIVE',
      1, 1, 1000, 1000, NULL
    );

    INSERT INTO customer_identity_subjects (id, subject_type, created_at)
    VALUES
      ('subject-owner', 'SELLER_ORG_MEMBER', 1000),
      ('subject-ops', 'SELLER_ORG_MEMBER', 1000),
      ('subject-finance', 'SELLER_ORG_MEMBER', 1000),
      ('subject-viewer', 'SELLER_ORG_MEMBER', 1000),
      ('subject-forced', 'SELLER_ORG_MEMBER', 1000),
      ('subject-owner-2', 'SELLER_ORG_MEMBER', 1000),
      ('subject-buyer', 'BUYER_CUSTOMER', 1000),
      ('subject-buyer-secret', 'BUYER_CUSTOMER', 1000);

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id, seller_sequence,
      organization_name, status, version,
      created_at, updated_at, activated_at, disabled_at,
      next_member_number
    ) VALUES
      (
        'org-1', 'JP', 'ido-mango-portal-1',
        'seller-channel-ido-mango', 'seller-channel-ido-mango', 8101,
        '卖家组织一', 'ACTIVE', 1,
        1000, 1000, 1000, NULL, 6
      ),
      (
        'org-2', 'JP', 'ido-mango-portal-2',
        'seller-channel-ido-mango', 'seller-channel-ido-mango', 8102,
        '卖家组织二', 'ACTIVE', 1,
        1000, 1000, 1000, NULL, 2
      );

    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id,
      member_number, username_fallback, display_name,
      role, primary_owner, status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES
      ('member-owner', 'subject-owner', 'org-1', 1,
       'portal-owner-001', '负责人', 'OWNER', 1, 'ACTIVE', 1,
       1000, 1000, 1000, NULL),
      ('member-ops', 'subject-ops', 'org-1', 2,
       'portal-ops-002', '运营', 'OPERATIONS', 0, 'ACTIVE', 1,
       1000, 1000, 1000, NULL),
      ('member-finance', 'subject-finance', 'org-1', 3,
       'portal-finance-003', '财务', 'FINANCE', 0, 'ACTIVE', 1,
       1000, 1000, 1000, NULL),
      ('member-viewer', 'subject-viewer', 'org-1', 4,
       'portal-viewer-004', '只读', 'VIEWER', 0, 'ACTIVE', 1,
       1000, 1000, 1000, NULL),
      ('member-forced', 'subject-forced', 'org-1', 5,
       'portal-forced-005', '需改密', 'VIEWER', 0, 'ACTIVE', 1,
       1000, 1000, 1000, NULL),
      ('member-owner-2', 'subject-owner-2', 'org-2', 1,
       'portal-owner2-001', '其他负责人', 'OWNER', 1, 'ACTIVE', 1,
       1000, 1000, 1000, NULL);

    INSERT INTO seller_stores (
      id, organization_id, marketplace_code,
      display_name, normalized_name, status, version,
      created_at, updated_at, disabled_at
    ) VALUES
      ('store-1', 'org-1', 'JP', 'Alpha 店铺', 'alpha 店铺',
       'ACTIVE', 1, 1000, 3000, NULL),
      ('store-2', 'org-1', 'JP', 'Beta 店铺', 'beta 店铺',
       'ACTIVE', 1, 1000, 2000, NULL),
      ('store-3', 'org-1', 'JP', 'Gamma 店铺', 'gamma 店铺',
       'DISABLED', 2, 1000, 4000, 4000),
      ('store-other', 'org-2', 'JP', 'Other 店铺', 'other 店铺',
       'ACTIVE', 1, 1000, 1000, NULL);

    INSERT INTO seller_member_store_scopes (
      member_id, store_id, organization_id, status,
      assigned_by_staff_id, assigned_at, revoked_at,
      created_at, updated_at
    ) VALUES
      ('member-ops', 'store-1', 'org-1', 'ACTIVE',
       'staff-portal', 1000, NULL, 1000, 1000),
      ('member-finance', 'store-1', 'org-1', 'ACTIVE',
       'staff-portal', 1000, NULL, 1000, 1000),
      ('member-viewer', 'store-1', 'org-1', 'ACTIVE',
       'staff-portal', 1000, NULL, 1000, 1000),
      ('member-forced', 'store-1', 'org-1', 'ACTIVE',
       'staff-portal', 1000, NULL, 1000, 1000);

    INSERT INTO products (
      id, organization_id, store_id, marketplace_code,
      asin_display, asin_normalized, status,
      current_version_no, version,
      created_at, updated_at, disabled_at
    ) VALUES
      ('product-1', 'org-1', 'store-1', 'JP',
       'B000000001', 'B000000001', 'ACTIVE', 2, 2,
       1000, 5000, NULL),
      ('product-2', 'org-1', 'store-2', 'JP',
       'B000000002', 'B000000002', 'ACTIVE', 1, 1,
       1000, 4000, NULL),
      ('product-other', 'org-2', 'store-other', 'JP',
       'B000000003', 'B000000003', 'ACTIVE', 1, 1,
       1000, 3000, NULL);

    INSERT INTO product_versions (
      id, product_id, version_no, product_name,
      search_keywords_json, product_url,
      buyer_visible_notes, internal_notes,
      created_by_staff_id, created_at
    ,
          ordering_guide_expected_amount_jpy,
          color_spec_mode) VALUES
      ('product-1-v1', 'product-1', 1, '产品一旧版',
       '["旧关键词"]', 'https://example.test/p1-v1',
       '旧公开说明', '内部秘密旧版', 'staff-portal', 1000,
          1980, 'MAIN_IMAGE_VARIANT'),
      ('product-1-v2', 'product-1', 2, '产品一新版',
       '["新关键词"]', 'https://example.test/p1-v2',
       '新公开说明', '内部秘密新版', 'staff-portal', 2000,
          1980, 'MAIN_IMAGE_VARIANT'),
      ('product-2-v1', 'product-2', 1, '产品二',
       '[]', NULL, NULL, '内部秘密二', 'staff-portal', 1000,
          1980, 'MAIN_IMAGE_VARIANT'),
      ('product-other-v1', 'product-other', 1, '其他产品',
       '[]', NULL, NULL, '其他内部秘密', 'staff-portal', 1000,
          1980, 'MAIN_IMAGE_VARIANT');

    INSERT INTO product_applications (
      id, organization_id, store_id, marketplace_code,
      submitted_by_member_id, asin_display, asin_normalized,
      product_name, search_keywords_json, product_url,
      buyer_visible_notes, seller_notes, status,
      review_reason, reviewed_by_staff_id, product_id,
      version, submitted_at, updated_at,
      reviewed_at, withdrawn_at
    ) VALUES (
      'application-store-2', 'org-1', 'store-2', 'JP',
      'member-owner', 'B000000004', 'B000000004',
      '范围外申请', '[]', NULL, NULL, NULL, 'SUBMITTED',
      NULL, NULL, NULL, 1, 2000, 2000, NULL, NULL
    );

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
    ) VALUES (
      'demand-existing', 'org-1', 'store-1', 'JP',
      'product-1', 1, 'member-owner',
      'TEXT', 10, '公开说明', '卖家说明',
      1000, 400000, 500000,
      'PUBLISHED', NULL, NULL,
      'staff-portal', NULL,
      2, 1000, 2000,
      2000, 2000, NULL, NULL,
      1, 2
    );

    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code,
      buyer_channel_id, buyer_customer_no, buyer_sequence,
      first_valid_order_business_date, display_name,
      access_status, identity_review_status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES
      ('buyer-session', 'subject-buyer', 'JP',
       'buyer-channel-portal', NULL, NULL, NULL, 'Buyer session',
       'ACTIVE', 'CLEAR', 1, 1000, 1000, 1000, NULL),
      ('buyer-secret-1', 'subject-buyer-secret', 'JP',
       'buyer-channel-portal', NULL, NULL, NULL, 'Secret buyer',
       'ACTIVE', 'CLEAR', 1, 1000, 1000, 1000, NULL);

    INSERT INTO product_reservations (
      id, demand_batch_id, buyer_customer_id,
      organization_id, store_id, product_id,
      product_version_no, marketplace_code,
      status, precheck_snapshot_json,
      hold_expires_at, order_deadline_snapshot,
      version, submitted_at, updated_at,
      decided_by_staff_id, decision_reason, decided_at,
      cancelled_at, expired_at, reopened_count
    ) VALUES (
      'reservation-secret', 'demand-existing', 'buyer-secret-1',
      'org-1', 'store-1', 'product-1', 1, 'JP',
      'PENDING_REVIEW', '{}', 300000, 500000,
      1, 2000, 2000,
      NULL, NULL, NULL, NULL, NULL, 0
    );

    INSERT INTO customer_login_accounts (
      id, identity_subject_id, account_type,
      login_identifier_display, login_identifier_normalized,
      status, session_version, password_change_required,
      version, created_at, updated_at, activated_at, disabled_at
    ) VALUES
      ('account-owner', 'subject-owner', 'SELLER_MEMBER',
       'owner', 'owner', 'ACTIVE', 1, 0, 1, 1000, 1000, 1000, NULL),
      ('account-ops', 'subject-ops', 'SELLER_MEMBER',
       'ops', 'ops', 'ACTIVE', 1, 0, 1, 1000, 1000, 1000, NULL),
      ('account-finance', 'subject-finance', 'SELLER_MEMBER',
       'finance', 'finance', 'ACTIVE', 1, 0, 1, 1000, 1000, 1000, NULL),
      ('account-viewer', 'subject-viewer', 'SELLER_MEMBER',
       'viewer', 'viewer', 'ACTIVE', 1, 0, 1, 1000, 1000, 1000, NULL),
      ('account-forced', 'subject-forced', 'SELLER_MEMBER',
       'forced', 'forced', 'ACTIVE', 1, 1, 1, 1000, 1000, 1000, NULL),
      ('account-owner-2', 'subject-owner-2', 'SELLER_MEMBER',
       'owner2', 'owner2', 'ACTIVE', 1, 0, 1, 1000, 1000, 1000, NULL),
      ('account-buyer', 'subject-buyer', 'BUYER',
       'buyer', 'buyer', 'ACTIVE', 1, 0, 1, 1000, 1000, 1000, NULL);
  `);
}

async function json<T = Record<string, unknown>>(
  response: Response,
): Promise<T> {
  return response.json() as Promise<T>;
}
