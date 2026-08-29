import { expect, test, type Page, type Route } from '@playwright/test';

const success = (data: unknown) => ({ data, meta: { request_id: 'schedule-browser' } });

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function staff(role: 'owner'|'buyer_refund') {
  return { staff_id: `browser-${role}`, display_name: '排期验收员工',
    role: role === 'owner' ? { code: 'owner', display_name: '总管理员' }
      : { code: 'buyer_refund', display_name: '买家返款' },
    permissions: role === 'owner' ? ['PRODUCT_VIEW','PRODUCT_REVIEW','DEMAND_PUBLISH'] : [],
    data_scope: { type: role === 'owner' ? 'GLOBAL' : 'MARKETPLACE',
      marketplaceCodes: role === 'owner' ? [] : ['AMAZON_JP'],
      buyerCustomerIds: [], sellerOrganizationIds: [], teamIds: [] },
    authorization_version: 7, session_version: 1, expires_at: 9_999_999_999_999 };
}

function productItem() {
  return { product_id: 'product-1', seller_organization_id: 'seller-1', store_id: 'store-1',
    store_name: '东京店铺', marketplace_code: 'AMAZON_JP', asin: 'B0SCHEDULE', status: 'ACTIVE',
    aggregate_version: 2, current_version_no: 2, product_name: '月光测试产品',
    cadence: { order_interval_days: 1, orders_per_run: 2 }, updated_at: 1_786_161_600_000 };
}

function version() {
  return { product_version_id: 'version-2', version_no: 2, product_name: '月光测试产品',
    search_keywords: ['月光','测试'], ordering_guide_expected_amount_jpy: 1980,
    color_spec_mode: 'MAIN_IMAGE_VARIANT', default_buyer_self_pay_bps: 1000,
    product_url: 'https://example.test/product', buyer_visible_notes: '买家说明',
    internal_notes: '内部说明', cadence: { order_interval_days: 1, orders_per_run: 2 },
    main_image: { file_object_id: 'file-main-1', file_version: 1,
      client_file_name: 'main.png', bound_at: 1_786_161_600_000 },
    created_at: 1_786_161_600_000 };
}

function schedule() {
  return { schedule_version_id: 'schedule-1', version_no: 1, demand_version: 4,
    first_order_date: '2026-08-10', order_interval_days: 1, orders_per_run: 2,
    theoretical_last_order_date: '2026-08-19', affected_reservation_count: 0,
    preview_hash: 'b'.repeat(64), change_reason: '需求发布',
    changed_by_staff_id: 'owner-1', created_at: 1_786_161_600_000 };
}

function schedulePage() {
  return { demand: { demand_batch_id: 'demand-1', product_id: 'product-1',
    product_name: '月光测试产品', target_quantity: 20, effective_reservation_count: 2,
    order_deadline: 1_786_838_400_000, demand_version: 4, schedule: schedule() },
  items: [
    { reservation_id: 'reservation-1', status: 'APPROVED', submitted_at: 1000,
      decision_source: 'STAFF', version: 2,
      rank: 1, planned_order_date: '2026-08-10', buyer_reference: 'B0001',
      buyer_customer_id: 'buyer-1', buyer_display_name: '范围内买家',
      actual_order_status: null, actual_order_date: null },
    { reservation_id: 'reservation-2', status: 'PENDING_REVIEW', submitted_at: 1001,
      decision_source: null, version: 1,
      rank: 2, planned_order_date: '2026-08-10', buyer_reference: 'B0002',
      buyer_customer_id: null, buyer_display_name: null,
      actual_order_status: null, actual_order_date: null },
  ], next_cursor: null, timezone: 'Asia/Shanghai',
  sorting: 'submitted_at ASC, id ASC', data_as_of: 1_786_161_600_000 };
}

interface ObservedRequests {
  schedule: number;
  demandReviewBody?: unknown;
  demandReviewKey?: string | null;
}

async function mock(page: Page, role: 'owner'|'buyer_refund', observed?: ObservedRequests) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/staff-auth/session') return json(route, success({ session: staff(role) }));
    if (path === '/api/staff/catalog/products' && route.request().method() === 'GET') {
      return json(route, success({ page: { items: [productItem()], next_cursor: null,
        data_as_of: 1_786_161_600_000 } }));
    }
    if (path === '/api/staff/catalog/products/product-1') {
      return json(route, success({ product: { ...productItem(), versions: [version()],
        demands: [{ demand_batch_id: 'demand-1', status: 'PUBLISHED', target_quantity: 20,
          effective_reservation_count: 2, order_deadline: 1_786_838_400_000,
          demand_version: 4, schedule_version: 1, first_order_date: '2026-08-10' }],
        timezone: 'Asia/Shanghai', data_as_of: 1_786_161_600_000 } }));
    }
    if (path === '/api/staff/me/work-items/summary') {
      return json(route, success({ summary: {
        open_count: 0, due_today_count: 0, overdue_count: 0,
        exception_order_count: 0, refund_due_today_cny_fen: null,
        recent: [],
      } }));
    }
    if (path === '/api/staff/me/work-items') {
      return json(route, success({ work_items: [{
        work_item_id: 'work-demand', work_type: 'DEMAND_REVIEW',
        source_entity_type: 'DEMAND_BATCH', source_entity_id: 'demand-review-1',
        buyer_customer_id: null, seller_organization_id: 'seller-1', store_id: 'store-1',
        duty_code: 'SELLER_ACCOUNT_MANAGER', fixed_assignment_id: 'assignment-demand',
        assigned_staff_id: 'browser-owner', status: 'OPEN', version: 1,
        created_at: 1_786_161_600_000, updated_at: 1_786_161_600_000,
        completed_at: null, cancelled_at: null,
        sla_due_at: 1_786_161_600_000 + 172_800_000, is_overdue: false,
        overdue_since: null, next_action: 'REVIEW_DEMAND',
        responsible_role: 'seller_ops', responsible_staff_name: '总管理员',
        priority: 'NORMAL',
      }], next_cursor: null }));
    }
    if (path === '/api/staff/me/work-items/work-demand') {
      return json(route, success({ work_item: {
        work_item_id: 'work-demand', work_type: 'DEMAND_REVIEW',
        source_entity_type: 'DEMAND_BATCH', source_entity_id: 'demand-review-1',
        buyer_customer_id: null, seller_organization_id: 'seller-1', store_id: 'store-1',
        duty_code: 'SELLER_ACCOUNT_MANAGER', fixed_assignment_id: 'assignment-demand',
        assigned_staff_id: 'browser-owner', status: 'OPEN', version: 1,
        created_at: 1_786_161_600_000, updated_at: 1_786_161_600_000,
        completed_at: null, cancelled_at: null,
      } }));
    }
    if (path === '/api/staff/demand-batches/demand-review-1/review-context') {
      return json(route, success({ review_context: {
        demand_batch_id: 'demand-review-1', demand_version: 3, status: 'SUBMITTED',
        seller_organization_id: 'seller-1', store_id: 'store-1', product_id: 'product-1',
        product_version_no: 2, product_name: '月光测试产品', task_type: 'IMAGE',
        target_quantity: 20, reservation_deadline: 1_786_161_600_000,
        order_deadline: 1_786_838_400_000,
        cadence: { order_interval_days: 2, orders_per_run: 5 },
        main_image: null,
        ordering_guide_expected_amount_jpy: 1980,
        color_spec_mode: 'ANY_VARIANT',
        buyer_self_pay_bps_snapshot: null,
        can_publish: true,
        timezone: 'Asia/Shanghai', data_as_of: 1_786_161_600_000,
      } }));
    }
    if (path === '/api/staff/demand-batches/demand-review-1/review'
      && route.request().method() === 'POST') {
      if (observed) {
        observed.demandReviewBody = route.request().postDataJSON();
        observed.demandReviewKey = route.request().headers()['idempotency-key'] ?? null;
      }
      return json(route, success({ demand_review: {
        demand_batch_id: 'demand-review-1', status: 'PUBLISHED', version: 4,
        review_reason: null, schedule: {
          schedule_version_id: 'schedule-review-1', version_no: 1, demand_version: 4,
          first_order_date: '2026-08-11', theoretical_last_order_date: '2026-08-17',
          order_interval_days: 2, orders_per_run: 5, affected_reservation_count: 0,
          preview_hash: 'c'.repeat(64), change_reason: '首次发布需求',
          changed_by_staff_id: 'browser-owner', created_at: 1_786_161_600_000,
        }, replayed: false,
      } }));
    }
    if (path === '/api/staff/demand-batches/demand-1/reservation-schedule') {
      if (observed) observed.schedule += 1;
      return json(route, success({ page: schedulePage() }));
    }
    if (path === '/api/staff/demand-batches/demand-1/schedule/preview') {
      return json(route, success({ preview: { demand_batch_id: 'demand-1', expected_version: 4,
        current_schedule_version: 1, first_order_date: '2026-08-10',
        order_interval_days: 1, orders_per_run: 2,
        theoretical_last_order_date: '2026-08-19', order_deadline_date: '2026-08-20',
        effective_reservation_count: 2, affected_reservation_count: 2,
        before_first_order_date: '2026-08-09', before_theoretical_last_order_date: '2026-08-18',
        preview_hash: 'a'.repeat(64), timezone: 'Asia/Shanghai',
        data_as_of: 1_786_161_600_000 } }));
    }
    if (path === '/api/staff/demand-batches/demand-1/schedule/confirm') {
      return json(route, success({ schedule_confirmation: {
        demand_batch_id: 'demand-1', demand_version: 5,
        schedule: { ...schedule(), version_no: 2, demand_version: 5,
          preview_hash: 'a'.repeat(64), change_reason: '浏览器验收改期',
          affected_reservation_count: 2 }, replayed: false,
      } }));
    }
    return json(route, { error: { code: 'NOT_FOUND', message: 'not found', details: null },
      meta: { request_id: 'schedule-browser-unhandled' } }, 404);
  });
}

test('product and reservation deep links are Chinese, responsive and keyboard usable', async ({ page }) => {
  await mock(page, 'owner');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/staff/products?q=%E6%9C%88%E5%85%89');
  await expect(page).toHaveURL(/\/staff\/products\?q=/u);
  await expect(page.getByRole('heading', { name: '产品与预约', exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: '员工产品库' })).toBeVisible();
  await page.getByRole('link', { name: '查看详情' }).click();
  await expect(page).toHaveURL(/\/staff\/products\/product-1$/u);
  await expect(page.getByRole('heading', { name: '月光测试产品', exact: true })).toBeVisible();
  await expect(page.getByText(/每隔 1 个自然日，每次 2 单/u).first()).toBeVisible();
  await page.getByRole('link', { name: '查看预约' }).click();
  await expect(page).toHaveURL(/\/staff\/demands\/demand-1\/reservations$/u);
  await expect(page.getByRole('table', { name: '预约排名与预计下单日期' })).toBeVisible();
  await expect(page.getByText('范围内买家')).toBeVisible();
  await expect(page.getByText(/内部说明|buyer-2/u)).toHaveCount(0);
  const preview = page.getByRole('button', { name: '服务端预览影响' });
  await preview.focus();
  await expect(preview).toBeFocused();
  expect(await preview.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await page.getByLabel('修改原因').fill('浏览器验收改期');
  await preview.click();
  await expect(page.getByText(/其中 2 人的预计日期会变化/u)).toBeVisible();
  await page.getByRole('button', { name: '确认新增排期版本' }).click();
  await expect(page.getByText(/排期新版本已确认/u)).toBeVisible();
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
});

test('buyer_refund direct route exposes neither navigation nor schedule data', async ({ page }) => {
  const observed = { schedule: 0 };
  await mock(page, 'buyer_refund', observed);
  await page.goto('/staff/demands/demand-1/reservations');
  await expect(page.getByText('当前角色无权查看产品排期')).toBeVisible();
  await expect(page.getByRole('link', { name: '产品与投放' })).toHaveCount(0);
  expect(observed.schedule).toBe(0);
});

test('demand review deep link publishes the authoritative version with a first order date', async ({ page }) => {
  const observed: ObservedRequests = { schedule: 0 };
  await mock(page, 'owner', observed);
  await page.goto('/staff/work/work-demand');
  await expect(page.getByRole('heading', { name: '需求发布事实' })).toBeVisible();
  await expect(page.getByText('月光测试产品 · v2')).toBeVisible();
  await expect(page.getByText('每 2 天 / 5 单')).toBeVisible();
  await page.getByLabel('首个下单日期').fill('2026-08-11');
  const publish = page.getByRole('button', { name: '通过并发布' });
  await publish.focus();
  await expect(publish).toBeFocused();
  await publish.click();
  await expect.poll(() => observed.demandReviewBody).toEqual({
    expected_version: 3,
    decision: 'PUBLISH',
    first_order_date: '2026-08-11',
  });
  expect(observed.demandReviewKey).toMatch(/\S/u);
});
