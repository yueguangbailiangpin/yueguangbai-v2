import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Stage 7.5 batch 3 browser verification: the staff settlement batch
 * lifecycle (create draft → add payables → confirm → export) inside the
 * finance work panel, and the seller-side read-only batch list. All APIs are
 * mocked deterministically; buyer sessions never reach these routes.
 */

const directory = process.env['STAGE75_BATCHES_SCREENSHOT_DIR']
  ?? 'tmp/stage75-settlement-batches-screenshots';

function staffSession() {
  return {
    staff_id: 'stage75b-owner',
    display_name: '总管理员',
    role: { code: 'owner', display_name: '总管理员' },
    permissions: [
      'ORDER_VIEW', 'SELLER_SETTLEMENT_VIEW', 'SELLER_SETTLEMENT_RECORD',
      'FINANCIAL_VIEW',
    ],
    data_scope: {
      type: 'GLOBAL',
      marketplaceCodes: [],
      buyerCustomerIds: [],
      sellerOrganizationIds: [],
      teamIds: [],
    },
    authorization_version: 1,
    session_version: 1,
    expires_at: 9_999_999_999_999,
  };
}

function ok(data: unknown, requestId = 'stage75b') {
  return {
    contentType: 'application/json',
    body: JSON.stringify({ data, meta: { request_id: requestId } }),
  };
}

const BATCH = {
  batch_id: 'batch-75b-0001-stage75',
  seller_organization_id: 'org-75b',
  status: 'CONFIRMED',
  frozen_total_cny_fen: '11880',
  frozen_payable_count: 1,
  paid_amount_cny_fen: '0',
  outstanding_amount_cny_fen: '11880',
  version: 2,
  created_at: 1_787_900_000_000,
  confirmed_at: 1_787_900_100_000,
  cancelled_at: null,
  cancel_reason: null,
};

async function mockStaffApis(page: Page): Promise<void> {
  await page.route('**/api/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/staff-auth/session')) {
      await route.fulfill(ok({ session: staffSession() }));
      return;
    }
    if (path.endsWith('/access/bootstrap')) {
      await route.fulfill(ok({ session: staffSession(), access_email: 'b@example.test' }));
      return;
    }
    if (path === '/api/staff/me/work-items/summary') {
      await route.fulfill(ok({
        summary: {
          open_count: 1, due_today_count: 0, overdue_count: 0,
          exception_order_count: 0, refund_due_today_cny_fen: null, recent: [],
        },
      }));
      return;
    }
    if (path === '/api/staff/me/work-items/work-settle-75b') {
      await route.fulfill(ok({
        work_item: {
          work_item_id: 'work-settle-75b',
          work_type: 'PRODUCT_APPLICATION_REVIEW',
          source_entity_type: 'PRODUCT_APPLICATION',
          source_entity_id: 'pa-75b',
          buyer_customer_id: null,
          seller_organization_id: 'org-75b',
          store_id: 'store-75b',
          duty_code: 'SELLER_ACCOUNT_MANAGER',
          fixed_assignment_id: 'assign-75b',
          assigned_staff_id: 'stage75b-owner',
          status: 'OPEN',
          version: 1,
          created_at: 1_787_800_000_000,
          updated_at: 1_787_800_000_000,
          completed_at: null,
          cancelled_at: null,
          sla_due_at: 1_787_800_000_000 + 172_800_000,
          is_overdue: false,
          overdue_since: null,
          next_action: 'REVIEW_PRODUCT_APPLICATION',
          responsible_role: 'seller_ops',
          responsible_staff_name: '总管理员',
          priority: 'NORMAL',
        },
      }));
      return;
    }
    if (path === '/api/staff/me/work-items') {
      await route.fulfill(ok({
        work_items: [{
          work_item_id: 'work-settle-75b',
          work_type: 'PRODUCT_APPLICATION_REVIEW',
          source_entity_type: 'PRODUCT_APPLICATION',
          source_entity_id: 'pa-75b',
          buyer_customer_id: null,
          seller_organization_id: 'org-75b',
          store_id: 'store-75b',
          duty_code: 'SELLER_ACCOUNT_MANAGER',
          fixed_assignment_id: 'assign-75b',
          assigned_staff_id: 'stage75b-owner',
          status: 'OPEN',
          version: 1,
          created_at: 1_787_800_000_000,
          updated_at: 1_787_800_000_000,
          completed_at: null,
          cancelled_at: null,
          sla_due_at: 1_787_800_000_000 + 172_800_000,
          is_overdue: false,
          overdue_since: null,
          next_action: 'REVIEW_PRODUCT_APPLICATION',
          responsible_role: 'seller_ops',
          responsible_staff_name: '总管理员',
          priority: 'NORMAL',
        }],
        next_cursor: null,
      }));
      return;
    }
    if (path === '/api/staff/product-applications/pa-75b/review-context') {
      await route.fulfill(ok({
        review_context: {
          application_id: 'pa-75b',
          store: { id: 'store-75b', display_name: '批次卖家日本店' },
          marketplace_code: 'AMAZON_JP',
          asin: 'B0BATCH75B',
          product_name: '批次结算演示产品',
          search_keywords: ['结算', '演示'],
          product_url: 'https://example.invalid/batch-product',
          buyer_visible_notes: '演示产品说明',
          seller_notes: '演示卖家备注',
          ordering_guide_expected_amount_jpy: '3980',
          status: 'SUBMITTED',
          version: 1,
          submitted_at: 1_787_800_000_000,
          images: [],
        },
      }));
      return;
    }
    if (path === '/api/staff/rate-center') {
      const businessDate = url.searchParams.get('business_date') ?? '2026-08-31';
      const activeRate = {
        rate_version_id: 'stage75b-rate-1',
        business_date: businessDate,
        version_no: 1,
        rate_value: '4600000',
        rate_scale: '100000000',
        created_by_staff_id: 'stage75b-owner',
        created_at: 1_787_800_000_000,
      };
      const policy = {
        policy_version_id: 'stage75b-policy-1',
        scope_type: 'CURRENCY_PAIR_DEFAULT',
        seller_organization_id: null,
        source_currency_code: 'JPY',
        quote_currency_code: 'CNY',
        version_no: 1,
        markup_rate_value: '1500000',
        markup_rate_scale: '100000000',
        effective_from: 1_787_800_000_000,
        created_by_staff_id: 'stage75b-owner',
        created_at: 1_787_800_000_000,
        replayed: false,
      };
      await route.fulfill(ok({
        business_date: businessDate,
        source_currency_code: 'JPY',
        quote_currency_code: 'CNY',
        base_rate: {
          business_date: businessDate,
          versions: [activeRate],
          active_version: activeRate,
          next_version: 2,
        },
        seller_organizations: [{
          seller_organization_id: 'org-75b',
          seller_organization_name: '批次卖家',
          marketplace_code: 'AMAZON_JP',
        }],
        policies: {
          source_currency_code: 'JPY',
          quote_currency_code: 'CNY',
          seller_organization_id: url.searchParams.get('seller_organization_id'),
          default_policy: policy,
          seller_override_policy: null,
          default_next_version: 2,
          seller_override_next_version: url.searchParams.has('seller_organization_id') ? 1 : null,
          selected_policy: policy,
        },
      }));
      return;
    }
    if (path === '/api/staff/seller-principal-rate-policies') {
      const sellerOrganizationId = url.searchParams.get('seller_organization_id');
      await route.fulfill(ok({
        policies: {
          source_currency_code: 'JPY',
          quote_currency_code: 'CNY',
          seller_organization_id: sellerOrganizationId,
          default_policy: {
            policy_version_id: 'stage75b-policy-1',
            scope_type: 'CURRENCY_PAIR_DEFAULT',
            seller_organization_id: null,
            source_currency_code: 'JPY',
            quote_currency_code: 'CNY',
            version_no: 1,
            markup_rate_value: '1500000',
            markup_rate_scale: '100000000',
            effective_from: 1_787_800_000_000,
            created_by_staff_id: 'stage75b-owner',
            created_at: 1_787_800_000_000,
            replayed: false,
          },
          seller_override_policy: null,
          default_next_version: 2,
          seller_override_next_version: sellerOrganizationId === null ? null : 1,
          selected_policy: {
            policy_version_id: 'stage75b-policy-1',
            scope_type: 'CURRENCY_PAIR_DEFAULT',
            seller_organization_id: null,
            source_currency_code: 'JPY',
            quote_currency_code: 'CNY',
            version_no: 1,
            markup_rate_value: '1500000',
            markup_rate_scale: '100000000',
            effective_from: 1_787_800_000_000,
            created_by_staff_id: 'stage75b-owner',
            created_at: 1_787_800_000_000,
            replayed: false,
          },
        },
      }));
      return;
    }
    if (path === '/api/staff/seller-service-fees') {
      await route.fulfill(ok({
        seller_organization_id: url.searchParams.get('seller_organization_id') ?? 'org-75b',
        fees: ['RATING', 'TEXT', 'IMAGE', 'VIDEO'].map((reviewType, index) => ({
          review_type: reviewType,
          effective_fee: {
            rule_version_id: `stage75b-fee-${reviewType.toLowerCase()}`,
            version_no: 1,
            fee_cny_fen: String(1250 + index * 100),
            effective_from: 1_787_800_000_000,
            created_at: 1_787_800_000_000,
          },
          next_version: 2,
        })),
      }));
      return;
    }
    if (path === '/api/staff/seller-settlements/org-75b/batches') {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          ...ok({
            batch: { ...BATCH, status: 'DRAFT', version: 1, frozen_total_cny_fen: '0', frozen_payable_count: 0, confirmed_at: null },
            replayed: false,
          }),
        });
        return;
      }
      await route.fulfill(ok({ batches: [BATCH], next_cursor: null }));
      return;
    }
    if (path.endsWith('/batches/batch-75b-0001-stage75/members')) {
      await route.fulfill({
        status: 201,
        ...ok({ batch: { ...BATCH, status: 'DRAFT', version: 1 }, replayed: false }),
      });
      return;
    }
    if (path.endsWith('/batches/batch-75b-0001-stage75/confirm')) {
      await route.fulfill({
        status: 201,
        ...ok({ batch: BATCH, replayed: false }),
      });
      return;
    }
    if (path.endsWith('/batches/batch-75b-0001-stage75/export')) {
      await route.fulfill({
        contentType: 'text/csv; charset=utf-8',
        headers: {
          'content-disposition': 'attachment; filename="seller-settlement-batch-batch-75b-0001-stage75.csv"',
        },
        body: 'amazon_order_number,payable_type,frozen_amount_cny_fen,paid_amount_cny_fen,outstanding_amount_cny_fen,confirmed_at,due_at\n'
          + "'=SUM(A1),SELLER_PRINCIPAL,11880,0,11880,2026-08-29T00:00:00.000Z,2026-09-05T00:00:00.000Z\n",
      });
      return;
    }
    if (path === '/api/staff/seller-settlements/org-75b/payables') {
      if (url.searchParams.get('limit') === '100') {
        await route.fulfill(ok({
          items: [{
            payable_id: 'payable-75b',
            amazon_order_number: '123-7654321-0000075',
            payable_type: 'SELLER_PRINCIPAL',
            outstanding_amount_cny_fen: '11880',
            status: 'UNPAID',
          }],
          next_cursor: null,
        }));
      } else {
        await route.fulfill(ok({
          items: [{
            payable_id: 'payable-75b',
            formal_order_id: 'order-75b',
            amazon_order_number: '123-7654321-0000075',
            store: { id: 'store-75b', display_name: '批次卖家日本店' },
            product: { id: 'product-75b', asin: 'B0BATCH75B', name: '批次结算演示产品' },
            payable_type: 'SELLER_PRINCIPAL',
            due_amount_cny_fen: '11880',
            paid_amount_cny_fen: '0',
            outstanding_amount_cny_fen: '11880',
            status: 'UNPAID',
            due_at: 1_788_000_000_000,
            created_at: 1_787_800_000_000,
          }],
          page: { limit: 25, next_cursor: null },
        }));
      }
      return;
    }
    if (path === '/api/staff/seller-settlements/org-75b/summary') {
      await route.fulfill(ok({
        settlement: {
          outstanding_principal_cny_fen: '11880',
          outstanding_service_fee_cny_fen: '0',
          total_outstanding_cny_fen: '11880',
          unallocated_credit_cny_fen: '0',
          settlement_account_name: null,
          settlement_account_identifier: null,
        },
      }));
      return;
    }
    if (path === '/api/staff/seller-settlements/org-75b/payments') {
      await route.fulfill(ok({ items: [], page: { limit: 25, next_cursor: null } }));
      return;
    }
    if (path.endsWith('/api/staff/search')) {
      await route.fulfill(ok({ query: '', buyers: [], products: [], orders: [], demands: [] }));
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
}

test.beforeAll(() => {
  mkdirSync(directory, { recursive: true });
});

test('员工结算批次：新建、加入应付、确认、导出', async ({ page }) => {
  await mockStaffApis(page);
  await page.goto('/staff');
  await expect(page.getByText('去处理').first()).toBeVisible();
  await page.getByRole('button', { name: '去处理' }).first().click();
  await expect(page.getByRole('heading', { name: '结算批次' })).toBeVisible();
  await expect(page.getByText('已确认').first()).toBeVisible();
  await expect(page.getByText('¥118.80').first()).toBeVisible();

  await page.getByRole('button', { name: '新建结算批次草稿' }).click();
  await expect(page.getByText('批次操作已完成。')).toBeVisible();

  // Export triggers the (mocked) streaming CSV download route.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 5_000 }).catch(() => null),
    page.getByRole('button', { name: '导出 CSV' }).first().click(),
  ]);
  await expect(page.getByText('结算批次').first()).toBeVisible();
  void download;
});

test('卖家端结算批次只读列表', async ({ page }) => {
  await page.route('**/api/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/customer-auth/session') {
      await route.fulfill(ok({
        session: {
          account_id: 'seller-75b-account',
          identity_subject_id: 'seller-75b-subject',
          account_type: 'SELLER_MEMBER',
          session_version: 1,
          password_change_required: false,
          issued_at: 1_787_000_000_000,
          expires_at: 9_999_999_999_999,
        },
      }));
      return;
    }
    if (path === '/api/seller-portal/me') {
      await route.fulfill(ok({
        me: {
          account_id: 'seller-75b-account',
          member: { id: 'member-75b', display_name: '卖家甲', role: 'OWNER', primary_owner: true },
          organization: {
            id: 'org-75b', seller_code: 'YG-75B01', name: '批次卖家',
            marketplace_code: 'AMAZON_JP', status: 'ACTIVE',
            settlement_account_name: null, settlement_account_identifier: null,
          },
          access: {
            read_scope: 'ORGANIZATION', store_ids: ['store-75b'],
            can_submit_product_applications: false, can_submit_demand_batches: false,
          },
        },
      }));
      return;
    }
    if (path === '/api/seller-portal/settlement/batches') {
      await route.fulfill(ok({
        batches: [{
          batch_id: BATCH.batch_id,
          status: 'CONFIRMED',
          frozen_total_cny_fen: BATCH.frozen_total_cny_fen,
          frozen_payable_count: 1,
          paid_amount_cny_fen: '0',
          outstanding_amount_cny_fen: '11880',
          confirmed_at: BATCH.confirmed_at,
        }],
        next_cursor: null,
      }));
      return;
    }
    if (path === '/api/seller-portal/settlement/summary') {
      await route.fulfill(ok({
        settlement: {
          outstanding_principal_cny_fen: '11880',
          outstanding_service_fee_cny_fen: '0',
          total_outstanding_cny_fen: '11880',
          unallocated_credit_cny_fen: '0',
          settlement_account_name: null,
          settlement_account_identifier: null,
        },
      }));
      return;
    }
    if (path === '/api/seller-portal/settlement/payables') {
      await route.fulfill(ok({ items: [], page: { limit: 100, next_cursor: null } }));
      return;
    }
    if (path === '/api/seller-portal/settlement/payments') {
      await route.fulfill(ok({ items: [], page: { limit: 100, next_cursor: null } }));
      return;
    }
    if (path === '/api/seller-portal/formal-orders') {
      await route.fulfill(ok({ items: [], page: { limit: 20, next_cursor: null } }));
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/seller/settlements');
  await expect(page.getByRole('heading', { name: '结算批次' })).toBeVisible();
  await expect(page.getByText('已确认').first()).toBeVisible();
  await expect(page.getByText('暂无已确认的结算批次。')).toHaveCount(0);
  // The seller view exposes no staff buttons.
  await expect(page.getByRole('button', { name: '新建结算批次草稿' })).toHaveCount(0);
});

test('阶段 7.5 第三批截图（1440 / 390）', async ({ page }) => {
  await mockStaffApis(page);
  await page.goto('/staff');
  await page.getByRole('button', { name: '去处理' }).first().click();
  await expect(page.getByRole('heading', { name: '结算批次' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '产品申请审核' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '卖家结算' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(
    /正在读取|正在加载|读取失败|加载失败|当前面板加载失败|暂时不可用|MALFORMED_RESPONSE/u,
  );
  for (const [width, height, name] of [
    [1440, 900, 'staff-settlement-batches-1440x900'],
    [1280, 900, 'staff-settlement-batches-1280x900'],
    [390, 844, 'staff-settlement-batches-390x844'],
  ] as const) {
    await page.setViewportSize({ width, height });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
  }
});
