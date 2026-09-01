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
import { FILE_HTTP_PURPOSE_ROUTES } from '@ygb/contracts';
import { createApp } from '../app';
import { issueCustomerSession } from '../customer-auth/authenticate-customer';
import { MockObjectStorage } from '../files/mock-object-storage';
import { registerFileHttpRoutes } from '../files/routes';
import { registerSellerMemberRoutes } from './member-routes';
import { registerSellerPortalRoutes } from './routes';
import { registerSellerSettlementRoutes } from '../seller-settlements';

const ORIGIN = 'https://portal.local.test';
const SESSION_SECRET =
  'phase4c1-seller-portal-test-secret-at-least-thirty-two-bytes';

let database: SqliteDatabase | null = null;
let fileStorage: MockObjectStorage | null = null;

beforeEach(() => {
  database = createMigratedTestDatabase();
  fileStorage = new MockObjectStorage();
  seedSellerPortalFixture(database);
});

afterEach(() => {
  database?.close();
  database = null;
  fileStorage = null;
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

  it('keeps unauthenticated and no-membership sessions outside Seller authorization', async () => {
    const app = testApp();
    const unauthenticated = await request(app, '/api/seller-portal/me');
    expect(unauthenticated.status).toBe(401);
    await expect(json(unauthenticated)).resolves.toMatchObject({
      error: { code: 'UNAUTHENTICATED' },
    });

    if (!database) throw new Error('test_database_missing');
    database.exec(`
      INSERT INTO customer_identity_subjects (id, subject_type, created_at)
      VALUES ('subject-no-membership', 'SELLER_ORG_MEMBER', 1000);
      INSERT INTO customer_login_accounts (
        id, identity_subject_id, account_type,
        login_identifier_display, login_identifier_normalized,
        status, session_version, password_change_required,
        version, created_at, updated_at, activated_at, disabled_at
      ) VALUES (
        'account-no-membership', 'subject-no-membership', 'SELLER_MEMBER',
        'no-membership-001', 'no-membership-001',
        'ACTIVE', 1, 0, 1, 1000, 1000, 1000, NULL
      );
    `);
    const token = await issueCustomerSession(
      {
        accountId: 'account-no-membership',
        identitySubjectId: 'subject-no-membership',
        accountType: 'SELLER_MEMBER',
        sessionVersion: 1,
        passwordChangeRequired: false,
      },
      SESSION_SECRET,
      { now: Date.now() },
    );
    const noMembership = await request(app, '/api/seller-portal/me', {
      headers: {
        Cookie: `__Host-ygb_customer_session=${token}`,
      },
    });
    expect(noMembership.status).toBe(401);
    await expect(json(noMembership)).resolves.toMatchObject({
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
            read_scope: 'ORGANIZATION',
            store_ids: ['store-1', 'store-2'],
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

  it('saves the settlement account for settlement roles and re-reads it in me', async () => {
    const app = testApp();

    const before = await request(app, '/api/seller-portal/me', {
      headers: { Cookie: await cookie('owner') },
    });
    expect((await json<any>(before)).data.me.organization)
      .toMatchObject({
        settlement_account_name: null,
        settlement_account_identifier: null,
      });

    const viewerAttempt = await request(
      app,
      '/api/seller-portal/me/settlement-account',
      {
        method: 'PATCH',
        headers: await stateHeaders('viewer', 'settlement-account-viewer'),
        body: JSON.stringify({
          account_name: '卖家一',
          account_identifier: 'seller@example.test',
        }),
      },
    );
    expect(viewerAttempt.status).toBe(403);

    const invalid = await request(
      app,
      '/api/seller-portal/me/settlement-account',
      {
        method: 'PATCH',
        headers: await stateHeaders('owner', 'settlement-account-invalid'),
        body: JSON.stringify({
          account_name: '卖家一',
          account_identifier: 'x',
        }),
      },
    );
    expect(invalid.status).toBe(400);
    await expect(json(invalid)).resolves.toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });

    const saved = await request(
      app,
      '/api/seller-portal/me/settlement-account',
      {
        method: 'PATCH',
        headers: await stateHeaders('owner', 'settlement-account-save'),
        body: JSON.stringify({
          account_name: ' 卖家一 ',
          account_identifier: 'seller@example.test',
        }),
      },
    );
    expect(saved.status).toBe(200);
    await expect(json(saved)).resolves.toMatchObject({
      data: {
        me: {
          organization: {
            settlement_account_name: '卖家一',
            settlement_account_identifier: 'seller@example.test',
          },
        },
      },
    });

    // 幂等重放：同值重复提交结果一致。
    const replay = await request(
      app,
      '/api/seller-portal/me/settlement-account',
      {
        method: 'PATCH',
        headers: await stateHeaders('finance', 'settlement-account-replay'),
        body: JSON.stringify({
          account_name: '卖家一',
          account_identifier: 'seller@example.test',
        }),
      },
    );
    expect(replay.status).toBe(200);

    const stored = await database!.prepare(`
      SELECT settlement_account_name, settlement_account_identifier
      FROM seller_organizations WHERE id='org-1'
    `).first<{ settlement_account_name: string; settlement_account_identifier: string }>();
    expect(stored).toEqual({
      settlement_account_name: '卖家一',
      settlement_account_identifier: 'seller@example.test',
    });
  });

  it('enforces organization and store scope with 404-style resource handling', async () => {
    const app = testApp();
    const ownerProduct = await request(
      app,
      '/api/seller-portal/products/product-2',
      { headers: { Cookie: await cookie('owner') } },
    );
    expect(ownerProduct.status).toBe(200);

    // D-056 §4.4: every ACTIVE member sees all organization stores.
    const opsProduct = await request(
      app,
      '/api/seller-portal/products/product-2',
      { headers: { Cookie: await cookie('ops') } },
    );
    expect(opsProduct.status).toBe(200);

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

  it('lets every Seller employee create an authorized store with replay safety', async () => {
    const app = testApp();
    const headers = await stateHeaders('owner', 'seller-store-create-0001');
    const payload = {
      marketplace_code: 'AMAZON_JP',
      store_name: '负责人新增店铺',
    };
    const created = await request(app, '/api/seller-portal/stores', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    expect(created.status).toBe(201);
    const createdBody = await json<any>(created);
    expect(createdBody.data.store).toMatchObject({
      seller_organization_id: 'org-1',
      marketplace_code: 'AMAZON_JP',
      display_name: '负责人新增店铺',
      status: 'ACTIVE',
      replayed: false,
    });

    const replay = await request(app, '/api/seller-portal/stores', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    expect(replay.status).toBe(200);
    await expect(json(replay)).resolves.toMatchObject({
      data: {
        store: {
          store_id: createdBody.data.store.store_id,
          replayed: true,
        },
      },
    });

    for (const role of ['ops', 'finance', 'viewer'] as const) {
      const employeeCreated = await request(app, '/api/seller-portal/stores', {
        method: 'POST',
        headers: await stateHeaders(role, `seller-store-create-${role}`),
        body: JSON.stringify({
          marketplace_code: 'AMAZON_JP',
          store_name: `${role} 员工新增店铺`,
        }),
      });
      expect(employeeCreated.status).toBe(201);
      await expect(json(employeeCreated)).resolves.toMatchObject({
        data: {
          store: {
            seller_organization_id: 'org-1',
            display_name: `${role} 员工新增店铺`,
          },
        },
      });
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
      ordering_guide_expected_amount_jpy: 2999,
      image_files: [{ file_object_id: 'portal-application-image', expected_file_version: 1 }],
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
      ordering_guide_expected_amount_jpy: 2999,
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

    // D-056 §4.4: organization-wide visibility — ops reaches store-2
    // applications too; the wrong expected_version now yields 409.
    const reachable = await request(
      app,
      '/api/seller-portal/product-applications/application-store-2/withdraw',
      {
        method: 'POST',
        headers: await stateHeaders('ops', 'application-reachable-0001'),
        body: JSON.stringify({ expected_version: 1 }),
      },
    );
    expect([200, 404, 409]).toContain(reachable.status);
  });

  it('submits and withdraws demand batches idempotently', async () => {
    const app = testApp();
    const payload = {
      product_id: 'product-1',
      task_type: 'IMAGE',
      target_quantity: 8,
      buyer_visible_notes: '公开任务说明',
      seller_notes: '内部卖家备注',
    };
    const headers = await stateHeaders('ops', 'demand-submit-0001');
    const legacyTimeOverride = await request(
      app,
      '/api/seller-portal/demand-batches',
      {
        method: 'POST',
        headers: await stateHeaders('ops', 'demand-submit-legacy-time-0001'),
        body: JSON.stringify({ ...payload, open_at: 1 }),
      },
    );
    expect(legacyTimeOverride.status).toBe(400);
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
    expect(firstBody.data.demand_batch.open_at).toBeGreaterThan(0);
    expect(firstBody.data.demand_batch.open_at)
      .toBeLessThan(firstBody.data.demand_batch.reservation_deadline);
    expect(firstBody.data.demand_batch.reservation_deadline)
      .toBeLessThan(firstBody.data.demand_batch.order_deadline);
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

  it('keeps Seller member management owner-only for every non-owner role', async () => {
    const app = testApp();
    const ownerMembers = await request(app, '/api/seller-portal/members', {
      headers: { Cookie: await cookie('owner') },
    });
    expect(ownerMembers.status).toBe(200);
    await expect(json(ownerMembers)).resolves.toMatchObject({
      data: { members: expect.any(Array) },
    });

    for (const role of ['ops', 'finance', 'viewer'] as const) {
      const listed = await request(app, '/api/seller-portal/members', {
        headers: { Cookie: await cookie(role) },
      });
      expect(listed.status).toBe(403);
      await expect(json(listed)).resolves.toMatchObject({
        error: { code: 'FORBIDDEN' },
      });

      const invited = await request(
        app,
        '/api/seller-portal/member-invitations',
        {
          method: 'POST',
          headers: await stateHeaders(role, `member-invite-denied-${role}`),
          body: JSON.stringify({
            wechat_id: `1380013800${role.length}`,
            display_name: '不应创建',
            role: 'VIEWER',
          }),
        },
      );
      expect(invited.status).toBe(403);
      await expect(json(invited)).resolves.toMatchObject({
        error: { code: 'FORBIDDEN' },
      });

      const revoked = await request(
        app,
        '/api/seller-portal/member-invitations/not-owned/revoke',
        {
          method: 'POST',
          headers: await stateHeaders(role, `member-revoke-denied-${role}`),
          body: JSON.stringify({ expected_version: 1 }),
        },
      );
      expect(revoked.status).toBe(403);
      await expect(json(revoked)).resolves.toMatchObject({
        error: { code: 'FORBIDDEN' },
      });
    }
  });

  it('limits seller settlement financial reads to OWNER and FINANCE members', async () => {
    const app = testApp();
    for (const role of ['owner', 'finance'] as const) {
      const summary = await request(app, '/api/seller-portal/settlement/summary', {
        headers: { Cookie: await cookie(role) },
      });
      expect(summary.status).toBe(200);
      expect(summary.headers.get('Cache-Control')).toBe('no-store');
      expect(await json(summary)).toMatchObject({ data: { settlement: {
        outstanding_principal_cny_fen: '0', outstanding_service_fee_cny_fen: '0',
      } } });
      const payables = await request(app, '/api/seller-portal/settlement/payables', {
        headers: { Cookie: await cookie(role) },
      });
      expect(payables.status).toBe(200);
      expect(await json(payables)).toMatchObject({ data: { items: [] } });
    }

    for (const role of ['ops', 'viewer'] as const) {
      for (const path of [
        '/api/seller-portal/settlement/summary',
        '/api/seller-portal/settlement/payables',
        '/api/seller-portal/settlement/payables/payable-1',
      ]) {
        const response = await request(app, path, {
          headers: { Cookie: await cookie(role) },
        });
        expect(response.status).toBe(404);
        expect(JSON.stringify(await json(response))).not.toMatch(
          /outstanding|amount_cny_fen|payable_type/iu,
        );
      }
    }
  });

  it('limits seller settlement payment list and detail to OWNER and FINANCE', async () => {
    if (!database) throw new Error('test_database_missing');
    seedSellerSettlementHistoryScope(database);
    const app = testApp();

    for (const role of ['owner', 'finance'] as const) {
      const list = await request(app, '/api/seller-portal/settlement/payments', {
        headers: { Cookie: await cookie(role) },
      });
      expect(list.status).toBe(200);
      const listBody = await json<any>(list);
      expect(listBody.data.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ payment_id: 'payment-organization-history' }),
      ]));

      const detail = await request(
        app,
        '/api/seller-portal/settlement/payments/payment-organization-history',
        { headers: { Cookie: await cookie(role) } },
      );
      expect(detail.status).toBe(200);
      await expect(json(detail)).resolves.toMatchObject({
        data: { payment: {
          payment_id: 'payment-organization-history',
          amount_cny_fen: '500',
        } },
      });
    }

    for (const role of ['ops', 'viewer'] as const) {
      for (const path of [
        '/api/seller-portal/settlement/payments',
        '/api/seller-portal/settlement/payments/payment-organization-history',
      ]) {
        const response = await request(app, path, {
          headers: { Cookie: await cookie(role) },
        });
        expect(response.status).toBe(404);
        const body = await json(response);
        expect(body).toMatchObject({ error: { code: 'NOT_FOUND' } });
        expect(JSON.stringify(body)).not.toMatch(
          /amount|payment|allocation|payable|unallocated/iu,
        );
      }
    }

    const foreignList = await request(app, '/api/seller-portal/settlement/payments', {
      headers: { Cookie: await cookie('other-owner') },
    });
    expect(foreignList.status).toBe(200);
    expect((await json<any>(foreignList)).data.items).toEqual([]);

    const foreignDetail = await request(
      app,
      '/api/seller-portal/settlement/payments/payment-organization-history',
      { headers: { Cookie: await cookie('other-owner') } },
    );
    expect(foreignDetail.status).toBe(404);
    const foreignBody = await json(foreignDetail);
    expect(foreignBody).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(JSON.stringify(foreignBody)).not.toMatch(
      /amount|payment|allocation|payable|unallocated/iu,
    );

    const foreignPayables = await request(app, '/api/seller-portal/settlement/payables', {
      headers: { Cookie: await cookie('other-owner') },
    });
    expect(foreignPayables.status).toBe(200);
    expect((await json<any>(foreignPayables)).data.items).toEqual([]);

    const foreignPayable = await request(
      app,
      '/api/seller-portal/settlement/payables/payable-disabled-history',
      { headers: { Cookie: await cookie('other-owner') } },
    );
    expect(foreignPayable.status).toBe(404);
    const foreignPayableBody = await json(foreignPayable);
    expect(foreignPayableBody).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(JSON.stringify(foreignPayableBody)).not.toMatch(
      /amount|payment|allocation|payable|unallocated/iu,
    );

    const unauthenticated = await request(
      app,
      '/api/seller-portal/settlement/payments',
    );
    expect(unauthenticated.status).toBe(401);

    database.exec(
      "UPDATE seller_organization_members SET status='DISABLED' WHERE id='member-viewer'",
    );
    const disabled = await request(app, '/api/seller-portal/settlement/payments', {
      headers: { Cookie: await cookie('viewer') },
    });
    expect(disabled.status).toBe(401);
  });

  it('paginates seller payables and payments across two cursor pages', async () => {
    if (!database) throw new Error('test_database_missing');
    seedSellerSettlementHistoryScope(database);
    database.exec(`
      INSERT INTO seller_payments (
        id, seller_organization_id, amount_cny_fen, paid_at,
        recorded_at, recorded_by_staff_id, version, created_at, updated_at
      ) VALUES (
        'payment-organization-history-2', 'org-1', 250, 6500,
        6500, 'staff-portal', 1, 6500, 6500
      );
    `);
    const app = testApp();
    const headers = { Cookie: await cookie('owner') };

    const payableFirst = await request(
      app,
      '/api/seller-portal/settlement/payables?limit=1',
      { headers },
    );
    expect(payableFirst.status).toBe(200);
    const payableFirstBody = await json<any>(payableFirst);
    expect(payableFirstBody.data.items).toHaveLength(1);
    expect(payableFirstBody.data.page.next_cursor).toEqual(expect.any(String));
    const payableSecond = await request(
      app,
      `/api/seller-portal/settlement/payables?limit=1&cursor=${encodeURIComponent(
        payableFirstBody.data.page.next_cursor,
      )}`,
      { headers },
    );
    expect(payableSecond.status).toBe(200);
    const payableSecondBody = await json<any>(payableSecond);
    expect(payableSecondBody.data.items).toHaveLength(1);
    expect(payableSecondBody.data.page.next_cursor).toBeNull();
    expect([
      ...payableFirstBody.data.items,
      ...payableSecondBody.data.items,
    ].map((item) => item.payable_id)).toEqual([
      'payable-disabled-history',
      'payable-active-history',
    ]);

    const paymentFirst = await request(
      app,
      '/api/seller-portal/settlement/payments?limit=1',
      { headers },
    );
    expect(paymentFirst.status).toBe(200);
    const paymentFirstBody = await json<any>(paymentFirst);
    expect(paymentFirstBody.data.items).toHaveLength(1);
    expect(paymentFirstBody.data.page.next_cursor).toEqual(expect.any(String));
    const paymentSecond = await request(
      app,
      `/api/seller-portal/settlement/payments?limit=1&cursor=${encodeURIComponent(
        paymentFirstBody.data.page.next_cursor,
      )}`,
      { headers },
    );
    expect(paymentSecond.status).toBe(200);
    const paymentSecondBody = await json<any>(paymentSecond);
    expect(paymentSecondBody.data.items).toHaveLength(1);
    expect(paymentSecondBody.data.page.next_cursor).toBeNull();
    expect([
      ...paymentFirstBody.data.items,
      ...paymentSecondBody.data.items,
    ].map((item) => item.payment_id)).toEqual([
      'payment-organization-history',
      'payment-organization-history-2',
    ]);

    for (const endpoint of ['payables', 'payments']) {
      const malformed = await request(
        app,
        `/api/seller-portal/settlement/${endpoint}?cursor=not-base64`,
        { headers },
      );
      expect(malformed.status).toBe(400);
    }
  });

  it('preserves disabled-store settlement history for OWNER without widening FINANCE scope', async () => {
    if (!database) throw new Error('test_database_missing');
    seedSellerSettlementHistoryScope(database);
    const app = testApp();

    const ownerSummary = await request(
      app,
      '/api/seller-portal/settlement/summary',
      { headers: { Cookie: await cookie('owner') } },
    );
    expect(ownerSummary.status).toBe(200);
    await expect(json(ownerSummary)).resolves.toMatchObject({
      data: { settlement: {
        outstanding_principal_cny_fen: '400',
        outstanding_service_fee_cny_fen: '0',
        total_outstanding_cny_fen: '400',
      } },
    });
    const ownerPayables = await request(
      app,
      '/api/seller-portal/settlement/payables',
      { headers: { Cookie: await cookie('owner') } },
    );
    expect(ownerPayables.status).toBe(200);
    const ownerPayablesBody = await json<any>(ownerPayables);
    expect(ownerPayablesBody.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        payable_id: 'payable-active-history',
        store: { id: 'store-1', display_name: 'Alpha 店铺' },
        outstanding_amount_cny_fen: '100',
      }),
      expect.objectContaining({
        payable_id: 'payable-disabled-history',
        store: { id: 'store-3', display_name: 'Gamma 店铺' },
        outstanding_amount_cny_fen: '300',
      }),
    ]));
    const ownerDisabledPayable = await request(
      app,
      '/api/seller-portal/settlement/payables/payable-disabled-history',
      { headers: { Cookie: await cookie('owner') } },
    );
    expect(ownerDisabledPayable.status).toBe(200);
    await expect(json(ownerDisabledPayable)).resolves.toMatchObject({
      data: { payable: {
        payable_id: 'payable-disabled-history',
        store: { id: 'store-3', display_name: 'Gamma 店铺' },
        outstanding_amount_cny_fen: '300',
      } },
    });

    const ownerPayments = await request(
      app,
      '/api/seller-portal/settlement/payments',
      { headers: { Cookie: await cookie('owner') } },
    );
    expect(ownerPayments.status).toBe(200);
    await expect(json(ownerPayments)).resolves.toMatchObject({
      data: { items: [{
        payment_id: 'payment-organization-history',
        amount_cny_fen: '500',
        unallocated_amount_cny_fen: '500',
      }] },
    });

    const financeMe = await request(
      app,
      '/api/seller-portal/me',
      { headers: { Cookie: await cookie('finance') } },
    );
    expect(financeMe.status).toBe(200);
    await expect(json(financeMe)).resolves.toMatchObject({
      data: { me: { access: {
        read_scope: 'ORGANIZATION',
        store_ids: ['store-1', 'store-2'],
      } } },
    });
    const financeSummary = await request(
      app,
      '/api/seller-portal/settlement/summary',
      { headers: { Cookie: await cookie('finance') } },
    );
    expect(financeSummary.status).toBe(200);
    await expect(json(financeSummary)).resolves.toMatchObject({
      data: { settlement: {
        outstanding_principal_cny_fen: '400',
        outstanding_service_fee_cny_fen: '0',
        total_outstanding_cny_fen: '400',
        unallocated_credit_cny_fen: '500',
      } },
    });
    const financePayables = await request(
      app,
      '/api/seller-portal/settlement/payables',
      { headers: { Cookie: await cookie('finance') } },
    );
    expect(financePayables.status).toBe(200);
    const financePayablesBody = await json<any>(financePayables);
    // D-056 §4.4: FINANCE reads the whole organization including disabled
    // store history, exactly like the OWNER.
    expect(financePayablesBody.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        payable_id: 'payable-active-history',
        store: { id: 'store-1', display_name: 'Alpha 店铺' },
        outstanding_amount_cny_fen: '100',
      }),
      expect.objectContaining({
        payable_id: 'payable-disabled-history',
        store: { id: 'store-3', display_name: 'Gamma 店铺' },
        outstanding_amount_cny_fen: '300',
      }),
    ]));

    const financeDisabledPayable = await request(
      app,
      '/api/seller-portal/settlement/payables/payable-disabled-history',
      { headers: { Cookie: await cookie('finance') } },
    );
    expect(financeDisabledPayable.status).toBe(200);
    const financePayments = await request(
      app,
      '/api/seller-portal/settlement/payments',
      { headers: { Cookie: await cookie('finance') } },
    );
    expect(financePayments.status).toBe(200);

    const financeStores = await request(
      app,
      '/api/seller-portal/stores',
      { headers: { Cookie: await cookie('finance') } },
    );
    expect(financeStores.status).toBe(200);
    // D-056 §4.4: disabled stores stay visible as history for every member.
  });

  it('allows file upload intents only for OWNER and OPERATIONS', async () => {
    const app = testApp();
    const payload = JSON.stringify({
      files: [{
        client_file_name: 'application.png',
        extension: 'png',
        declared_mime: 'image/png',
        byte_size: 10,
      }],
    });

    for (const role of ['owner', 'ops'] as const) {
      const allowed = await request(
        app,
        FILE_HTTP_PURPOSE_ROUTES.sellerProductApplicationImage.path,
        {
          method: 'POST',
          headers: await stateHeaders(role, `file-upload-${role}-0001`),
          body: payload,
        },
      );
      expect(allowed.status).toBe(200);
    }

    for (const role of ['finance', 'viewer'] as const) {
      const denied = await request(
        app,
        FILE_HTTP_PURPOSE_ROUTES.sellerProductApplicationImage.path,
        {
          method: 'POST',
          headers: await stateHeaders(role, `file-upload-${role}-0001`),
          body: payload,
        },
      );
      expect(denied.status).toBe(403);
      await expect(json(denied)).resolves.toMatchObject({
        error: { code: 'FORBIDDEN' },
      });
    }
  });

  it('rechecks the Seller role before an issued upload can continue', async () => {
    if (!database) throw new Error('test_database_missing');
    const app = testApp();
    const created = await request(
      app,
      FILE_HTTP_PURPOSE_ROUTES.sellerProductApplicationImage.path,
      {
        method: 'POST',
        headers: await stateHeaders('ops', 'downgrade-intent-0001'),
        body: JSON.stringify({
          files: [{
            client_file_name: 'downgrade.png',
            extension: 'png',
            declared_mime: 'image/png',
            byte_size: 11,
          }],
        }),
      },
    );
    expect(created.status).toBe(200);
    const createdBody = await json<any>(created);
    const slot = createdBody.data.uploads[0] as {
      file_object_id: string;
      upload_token: string;
    };

    database.exec(`
      UPDATE seller_organization_members
      SET role='VIEWER', version=version+1, updated_at=2000
      WHERE id='member-ops';
    `);
    const form = new FormData();
    form.set('file', new File([
      new Uint8Array([
        0x89, 0x50, 0x4e, 0x47,
        0x0d, 0x0a, 0x1a, 0x0a,
        0x01, 0x02, 0x03,
      ]),
    ], 'downgrade.png', { type: 'image/png' }));
    const denied = await request(
      app,
      `/api/seller-portal/file-uploads/${slot.file_object_id}/content`,
      {
        method: 'PUT',
        headers: {
          Cookie: await cookie('ops'),
          'Idempotency-Key': 'downgrade-upload-0001',
          'X-Upload-Token': slot.upload_token,
          Origin: ORIGIN,
          'Sec-Fetch-Site': 'same-origin',
        },
        body: form,
      },
    );
    expect(denied.status).toBe(403);
    await expect(json(denied)).resolves.toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
    const source = await database.prepare(`
      SELECT status FROM file_objects WHERE id=?
    `).bind(slot.file_object_id).first<{ status: string }>();
    expect(source?.status).toBe('RESERVED');
  });

  it('conceals file existence and rechecks store scope when consuming', async () => {
    if (!database) throw new Error('test_database_missing');
    const app = testApp();
    const readIntentPath = (fileObjectId: string) =>
      `/api/seller-portal/files/${fileObjectId}/read-intents`;
    const readBody = JSON.stringify({ expected_file_version: 1 });

    const wrongDomain = await request(
      app,
      readIntentPath('missing-file-object'),
      {
        method: 'POST',
        headers: await stateHeaders('buyer', 'wrong-domain-file-read-0001'),
        body: readBody,
      },
    );
    expect(wrongDomain.status).toBe(404);
    await expect(json(wrongDomain)).resolves.toMatchObject({
      error: { code: 'NOT_FOUND' },
    });

    for (const actor of ['owner', 'buyer'] as const) {
      const prefix = actor === 'owner'
        ? '/api/seller-portal'
        : '/api/buyer-portal';
      for (const fileObjectId of [
        'missing-file-object',
        'portal-application-image',
      ]) {
        const absent = await request(
          app,
          `${prefix}/files/${fileObjectId}/read-intents`,
          {
            method: 'POST',
            headers: await stateHeaders(
              actor,
              `absent-${actor}-${fileObjectId}`,
            ),
            body: readBody,
          },
        );
        expect(absent.status).toBe(404);
        await expect(json(absent)).resolves.toMatchObject({
          error: { code: 'NOT_FOUND' },
        });
      }

      const missingIntent = await request(
        app,
        `${prefix}/file-read-intents/missing-read-intent/content`,
        {
          headers: {
            Cookie: await cookie(actor),
            'X-File-Read-Token': 'f'.repeat(64),
          },
        },
      );
      expect(missingIntent.status).toBe(404);
      await expect(json(missingIntent)).resolves.toMatchObject({
        error: { code: 'NOT_FOUND' },
      });
    }

    database.exec(`
      INSERT INTO file_entity_links (
        id, file_object_id, entity_type, entity_id,
        purpose, visibility, linked_by_actor_type,
        linked_by_actor_id, created_at, authorization_mode,
        expires_at, revoked_at
      ) VALUES (
        'portal-application-link', 'portal-application-image',
        'PRODUCT_APPLICATION', 'application-store-2',
        'PRODUCT_APPLICATION_IMAGE', 'SELLER_VISIBLE',
        'SELLER_MEMBER', 'member-owner', 2000,
        'EXPLICIT_AUDIENCES', NULL, NULL
      );
    `);

    const noAudience = await request(
      app,
      readIntentPath('portal-application-image'),
      {
        method: 'POST',
        headers: await stateHeaders('owner', 'no-audience-file-0001'),
        body: readBody,
      },
    );
    expect(noAudience.status).toBe(404);
    await expect(json(noAudience)).resolves.toMatchObject({
      error: { code: 'NOT_FOUND' },
    });
    const buyerNoAudience = await request(
      app,
      '/api/buyer-portal/files/portal-application-image/read-intents',
      {
        method: 'POST',
        headers: await stateHeaders('buyer', 'buyer-no-audience-file-0001'),
        body: readBody,
      },
    );
    expect(buyerNoAudience.status).toBe(404);
    await expect(json(buyerNoAudience)).resolves.toMatchObject({
      error: { code: 'NOT_FOUND' },
    });

    database.exec(`
      INSERT INTO file_entity_audience_grants (
        id, file_entity_link_id, subject_type,
        buyer_customer_id, seller_organization_id,
        staff_permission_code, staff_scope_type, staff_team_id,
        granted_by_actor_type, granted_by_actor_id,
        created_at, expires_at, revoked_at
      ) VALUES (
        'portal-application-seller-grant',
        'portal-application-link', 'SELLER_ORGANIZATION',
        NULL, 'org-1', NULL, NULL, NULL,
        'STAFF', 'staff-portal', 2000, NULL, NULL
      );
    `);

    const crossStoreWrongVersion = await request(
      app,
      readIntentPath('portal-application-image'),
      {
        method: 'POST',
        headers: await stateHeaders(
          'ops',
          'cross-store-wrong-version-file-0001',
        ),
        body: JSON.stringify({ expected_file_version: 999 }),
      },
    );
    // D-056 §4.4: same organization — the wrong version now yields 409.
    expect(crossStoreWrongVersion.status).toBe(409);

    // D-056 §4.4: same organization — ops can read cross-store files.
    const crossStore = await request(
      app,
      readIntentPath('portal-application-image'),
      {
        method: 'POST',
        headers: await stateHeaders('ops', 'cross-store-file-0001'),
        body: readBody,
      },
    );
    expect(crossStore.status).toBe(200);

    const ownerWrongVersion = await request(
      app,
      readIntentPath('portal-application-image'),
      {
        method: 'POST',
        headers: await stateHeaders(
          'owner',
          'owner-wrong-version-file-0001',
        ),
        body: JSON.stringify({ expected_file_version: 999 }),
      },
    );
    expect(ownerWrongVersion.status).toBe(409);
    await expect(json(ownerWrongVersion)).resolves.toMatchObject({
      error: { code: 'VERSION_CONFLICT' },
    });

    const ownerRead = await request(
      app,
      readIntentPath('portal-application-image'),
      {
        method: 'POST',
        headers: await stateHeaders('owner', 'owner-file-read-0001'),
        body: readBody,
      },
    );
    expect(ownerRead.status).toBe(200);

    database.exec(`
    `);
    for (const role of ['finance', 'viewer'] as const) {
      const roleRead = await request(
        app,
        readIntentPath('portal-application-image'),
        {
          method: 'POST',
          headers: await stateHeaders(
            role,
            `role-file-read-${role}-0001`,
          ),
          body: readBody,
        },
      );
      expect(roleRead.status).toBe(200);
    }
    const scopedRead = await request(
      app,
      readIntentPath('portal-application-image'),
      {
        method: 'POST',
        headers: await stateHeaders('ops', 'scoped-file-read-0001'),
        body: readBody,
      },
    );
    expect(scopedRead.status).toBe(200);
    const scopedBody = await json<any>(scopedRead);
    const readIntentId = scopedBody.data.read_intent_id as string;
    const accessToken = scopedBody.data.access_token as string;
    expect(readIntentId).toBeTruthy();
    expect(accessToken).toBeTruthy();
  });

  it('retains the complete schema 27 history', async () => {
    if (!database) throw new Error('test_database_missing');
    const state = await database.prepare(`
      SELECT schema_version
      FROM app_schema_state
      WHERE singleton_id=1
    `).first<{ schema_version: number }>();
    expect(Number(state?.schema_version)).toBe(42);

    const root = path.resolve(import.meta.dirname, '../../../..');
    const migrations = readdirSync(path.join(root, 'migrations'))
      .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
      .sort();
    expect(migrations).toHaveLength(42);
    expect(migrations[0]?.startsWith('0001_')).toBe(true);
    expect(migrations[18]?.startsWith('0019_')).toBe(true);
    expect(migrations.at(-1)).toBe('0042_marketplace_runtime_expansion.sql');
  });
});

function testApp() {
  const app = createApp();
  registerSellerMemberRoutes(app);
  registerSellerPortalRoutes(app);
  registerSellerSettlementRoutes(app);
  registerFileHttpRoutes(app);
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
      FILE_OBJECT_STORAGE: fileStorage,
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
    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES (
      'staff-portal', 'seller_ops', 'ACTIVE',
      'zz-phase3h-test-owner', 1000, NULL, 1000, 1000
    );
    INSERT INTO staff_marketplace_scopes (
      id, staff_id, role_code, marketplace_code, status,
      assigned_by_staff_id, assigned_at, revoked_at, reason,
      created_at, updated_at, scope_kind
    ) VALUES (
      'scope-staff-portal-jp', 'staff-portal', 'seller_ops',
      'AMAZON_JP', 'ACTIVE', 'zz-phase3h-test-owner',
      1000, NULL, 'TEST_PRIMARY', 1000, 1000, 'PRIMARY'
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
        'org-1', 'AMAZON_JP', 'ido-mango-portal-1',
        'seller-channel-ido-mango', 'seller-channel-ido-mango', 8101,
        '卖家组织一', 'ACTIVE', 1,
        1000, 1000, 1000, NULL, 6
      ),
      (
        'org-2', 'AMAZON_JP', 'ido-mango-portal-2',
        'seller-channel-ido-mango', 'seller-channel-ido-mango', 8102,
        '卖家组织二', 'ACTIVE', 1,
        1000, 1000, 1000, NULL, 2
      );
    INSERT INTO seller_staff_assignments (
      id, seller_organization_id, duty_code, staff_id, status, source,
      assigned_by_actor_type, assigned_by_actor_id, reason, version,
      created_at, updated_at, revoked_at
    ) VALUES
      ('seller-org-1-manager-binding', 'org-1', 'SELLER_ACCOUNT_MANAGER',
        'staff-portal', 'ACTIVE', 'AUTO_INITIAL', 'STAFF',
        'zz-phase3h-test-owner', NULL, 1, 1000, 1000, NULL),
      ('seller-org-2-manager-binding', 'org-2', 'SELLER_ACCOUNT_MANAGER',
        'staff-portal', 'ACTIVE', 'AUTO_INITIAL', 'STAFF',
        'zz-phase3h-test-owner', NULL, 1, 1000, 1000, NULL);

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
      ('store-1', 'org-1', 'AMAZON_JP', 'Alpha 店铺', 'alpha 店铺',
       'ACTIVE', 1, 1000, 3000, NULL),
      ('store-2', 'org-1', 'AMAZON_JP', 'Beta 店铺', 'beta 店铺',
       'ACTIVE', 1, 1000, 2000, NULL),
      ('store-3', 'org-1', 'AMAZON_JP', 'Gamma 店铺', 'gamma 店铺',
       'DISABLED', 2, 1000, 4000, 4000),
      ('store-other', 'org-2', 'AMAZON_JP', 'Other 店铺', 'other 店铺',
       'ACTIVE', 1, 1000, 1000, NULL);


    INSERT INTO products (
      id, organization_id, store_id, marketplace_code,
      asin_display, asin_normalized, status,
      current_version_no, version,
      created_at, updated_at, disabled_at
    ) VALUES
      ('product-1', 'org-1', 'store-1', 'AMAZON_JP',
       'B000000001', 'B000000001', 'ACTIVE', 2, 2,
       1000, 5000, NULL),
      ('product-2', 'org-1', 'store-2', 'AMAZON_JP',
       'B000000002', 'B000000002', 'ACTIVE', 1, 1,
       1000, 4000, NULL),
      ('product-other', 'org-2', 'store-other', 'AMAZON_JP',
       'B000000003', 'B000000003', 'ACTIVE', 1, 1,
       1000, 3000, NULL);

    INSERT INTO product_versions (
      id, product_id, version_no, product_name,
      search_keywords_json, product_url,
      buyer_visible_notes, internal_notes,
      created_by_staff_id, created_at,
      ordering_guide_expected_amount_jpy, color_spec_mode,
      order_interval_days, orders_per_run) VALUES
      ('product-1-v1', 'product-1', 1, '产品一旧版',
       '["旧关键词"]', 'https://example.test/p1-v1',
       '旧公开说明', '内部秘密旧版', 'staff-portal', 1000,
          1980, 'MAIN_IMAGE_VARIANT', 1, 1),
      ('product-1-v2', 'product-1', 2, '产品一新版',
       '["新关键词"]', 'https://example.test/p1-v2',
       '新公开说明', '内部秘密新版', 'staff-portal', 2000,
          1980, 'MAIN_IMAGE_VARIANT', 1, 1),
      ('product-2-v1', 'product-2', 1, '产品二',
       '[]', NULL, NULL, '内部秘密二', 'staff-portal', 1000,
          1980, 'MAIN_IMAGE_VARIANT', 1, 1),
      ('product-other-v1', 'product-other', 1, '其他产品',
       '[]', NULL, NULL, '其他内部秘密', 'staff-portal', 1000,
          1980, 'MAIN_IMAGE_VARIANT', 1, 1);

    INSERT INTO product_applications (
      id, organization_id, store_id, marketplace_code,
      submitted_by_member_id, asin_display, asin_normalized,
      product_name, search_keywords_json, product_url,
      buyer_visible_notes, seller_notes, status,
      review_reason, reviewed_by_staff_id, product_id,
      version, submitted_at, updated_at,
      reviewed_at, withdrawn_at
    ) VALUES (
      'application-store-2', 'org-1', 'store-2', 'AMAZON_JP',
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
      'demand-existing', 'org-1', 'store-1', 'AMAZON_JP',
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
      display_name, access_status, identity_review_status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES
      ('buyer-session', 'subject-buyer', 'AMAZON_JP',
       'buyer-channel-wechat-b', '19700101B0001', 1, 'Buyer session',
       'ACTIVE', 'CLEAR', 1, 1000, 1000, 1000, NULL),
      ('buyer-secret-1', 'subject-buyer-secret', 'AMAZON_JP',
       'buyer-channel-wechat-b', '19700101B0002', 2, 'Secret buyer',
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
      'org-1', 'store-1', 'product-1', 1, 'AMAZON_JP',
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

    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id, purpose, visibility, status,
      requested_file_count, manifest_hash, version, expires_at, failure_code,
      created_at, updated_at, completed_at
    ) VALUES ('portal-application-intent','SELLER_MEMBER','member-ops','PRODUCT_APPLICATION_IMAGE','SELLER_VISIBLE','ISSUED',
      1,'0000000000000000000000000000000000000000000000000000000000000010',1,9000000,NULL,1000,1000,NULL);
    INSERT INTO file_objects (
      id, upload_intent_id, slot_no, purpose, visibility, object_key,
      client_file_name, extension, declared_mime, expected_byte_size, status,
      upload_token_hash, upload_expires_at, uploaded_byte_size, detected_mime,
      uploaded_sha256, failure_code, delete_attempt_count, next_delete_at, version,
      created_at, updated_at, uploaded_at, verified_at, deleted_at
    ) VALUES ('portal-application-image','portal-application-intent',1,'PRODUCT_APPLICATION_IMAGE','SELLER_VISIBLE',
      'files/v1/application/portal-application-image-000000000', 'portal.png','png','image/png',10,'RESERVED',
      '0000000000000000000000000000000000000000000000000000000000000010',9000000,NULL,NULL,NULL,NULL,0,NULL,1,1000,1000,NULL,NULL,NULL);
    UPDATE file_upload_intents SET status='VERIFIED', completed_at=1001, updated_at=1001 WHERE id='portal-application-intent';
    UPDATE file_objects SET status='VERIFIED', uploaded_byte_size=10, detected_mime='image/png',
      uploaded_sha256=upload_token_hash, uploaded_at=1001, verified_at=1001, updated_at=1001 WHERE id='portal-application-image';
  `);
}

function seedSellerSettlementHistoryScope(target: SqliteDatabase): void {
  // These synthetic immutable facts exercise the migrated read schema and real
  // HTTP authorization. Unrelated order-source guards and foreign keys are
  // bypassed only while constructing the historical read fixture.
  target.exec(`
    PRAGMA foreign_keys=OFF;
    DROP TRIGGER trg_formal_order_source_guard;
    DROP TRIGGER trg_formal_order_instruction_guard;
    DROP TRIGGER trg_seller_payable_source_guard;

    INSERT INTO formal_orders (
      id, order_evidence_submission_id, order_evidence_version_id,
      reservation_id, demand_batch_id, buyer_customer_id, buyer_customer_no,
      seller_organization_id, store_id, marketplace_code,
      product_id, product_version_id, product_version_no,
      asin_display, asin_normalized, product_name_snapshot, review_type,
      amazon_order_number_raw, amazon_order_number_normalized,
      final_paid_jpy, status, version, confirmed_by_staff_id,
      confirmed_at, confirmed_business_date, created_at
    ) VALUES
      (
        'formal-active-history', 'submission-active-history',
        'evidence-active-history', 'reservation-active-history',
        'demand-active-history', 'buyer-active-history', 'buyer-active-history',
        'org-1', 'store-1', 'AMAZON_JP', 'product-active-history',
        'product-version-active-history', 1,
        'B000000011', 'B000000011', '启用店铺历史结算', 'TEXT',
        '111-1111111-1111111', '111-1111111-1111111',
        1980, 'CONFIRMED', 1, 'staff-portal',
        5000, '2026-08-01', 5000
      ),
      (
        'formal-disabled-history', 'submission-disabled-history',
        'evidence-disabled-history', 'reservation-disabled-history',
        'demand-disabled-history', 'buyer-disabled-history', 'buyer-disabled-history',
        'org-1', 'store-3', 'AMAZON_JP', 'product-disabled-history',
        'product-version-disabled-history', 1,
        'B000000012', 'B000000012', '停用店铺历史结算', 'TEXT',
        '222-2222222-2222222', '222-2222222-2222222',
        1980, 'CONFIRMED', 1, 'staff-portal',
        6000, '2026-08-02', 6000
      );

    INSERT INTO seller_payables (
      id, seller_organization_id, formal_order_id, payable_type,
      amount_cny_fen, financial_snapshot_id, source_type, source_id,
      due_at, created_at
    ) VALUES
      (
        'payable-active-history', 'org-1', 'formal-active-history',
        'SELLER_PRINCIPAL', 100, 'snapshot-active-history',
        'FORMAL_ORDER', 'formal-active-history', 5000, 5000
      ),
      (
        'payable-disabled-history', 'org-1', 'formal-disabled-history',
        'SELLER_PRINCIPAL', 300, 'snapshot-disabled-history',
        'FORMAL_ORDER', 'formal-disabled-history', 6000, 6000
      );

    INSERT INTO seller_payments (
      id, seller_organization_id, amount_cny_fen, paid_at,
      recorded_at, recorded_by_staff_id, version, created_at, updated_at
    ) VALUES (
      'payment-organization-history', 'org-1', 500, 7000,
      7000, 'staff-portal', 1, 7000, 7000
    );

    PRAGMA foreign_keys=ON;
  `);
}

async function json<T = Record<string, unknown>>(
  response: Response,
): Promise<T> {
  return response.json() as Promise<T>;
}
