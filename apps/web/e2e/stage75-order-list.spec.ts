import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Stage 7.5 batch 1 browser verification: the staff formal-order cursor
 * list (rows, filters in URL, cursor pagination, failure recovery), the
 * authoritative "当前负责人 / 下一步" block on the unified order detail, and
 * the workbench metric strip. Every API is mocked deterministically; all
 * numbers and SLA values come from the mocked backend projections.
 */

const directory = process.env['STAGE75_ORDER_LIST_SCREENSHOT_DIR']
  ?? 'tmp/stage75-order-list-screenshots';

type Role = 'owner' | 'pre_sales';

function session(role: Role) {
  const permissionsByRole: Record<Role, string[]> = {
    owner: ['ORDER_VIEW', 'ORDER_CONFIRM', 'FINANCIAL_VIEW', 'STAFF_MANAGE'],
    pre_sales: ['ORDER_VIEW', 'ORDER_CONFIRM', 'BUYER_VIEW'],
  };
  return {
    staff_id: `stage75-${role}`,
    display_name: role === 'owner' ? '总管理员' : '售前甲',
    role: {
      code: role,
      display_name: role === 'owner' ? '总管理员' : '售前',
    },
    permissions: permissionsByRole[role],
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

function ok(data: unknown, requestId = 'stage75') {
  return {
    contentType: 'application/json',
    body: JSON.stringify({ data, meta: { request_id: requestId } }),
  };
}

function listItem(id: string, number: string, overrides: Record<string, unknown> = {}) {
  return {
    formal_order_id: id,
    marketplace_code: 'AMAZON_JP',
    amazon_order_number: number,
    amazon_order_date: '2026-08-28',
    confirmed_at: 1_787_900_000_000 + Number(id) * 1000,
    buyer_customer_id: `buyer-${id}`,
    buyer_customer_no: `20260828B300${id}`,
    buyer_display_name: `列表买家${id}`,
    seller_organization_id: 'org-75',
    store_display_name: '测试店铺75',
    product_name_snapshot: '测试产品75',
    review_type: 'IMAGE',
    buyer_expected_principal_cny_fen: '10890',
    seller_expected_principal_cny_fen: '11880',
    responsibility: {
      stage: 'SELLER_SETTLEMENT',
      responsible_role: 'seller_ops',
      responsible_staff: { staff_id: 'stage75-ops', display_name: '卖家对接甲' },
      next_action: 'FOLLOW_SELLER_SETTLEMENT',
      next_action_due_at: 1_788_000_000_000,
      is_overdue: false,
      overdue_since: null,
      exception_state: 'NONE',
      exception_reason: null,
      available_actions: [],
      ...overrides,
    },
  };
}

const ORDER_DETAIL = {
  order: {
    formal_order_id: 'order-75',
    marketplace_code: 'AMAZON_JP',
    amazon_order_number: '123-7654321-0000075',
    amazon_order_date: '2026-08-28',
    status: 'CONFIRMED',
    confirmed_at: 1_787_900_000_000,
  },
  buyer: {
    buyer_customer_id: 'buyer-75',
    display_name: '列表买家75',
    customer_no: '20260828B30075',
  },
  seller: { seller_organization_id: 'org-75', store_display_name: '测试店铺75' },
  payment_screenshot: null,
  communication_screenshots: [],
  operational_events: [],
  responsibility: {
    stage: 'BUYER_REFUND',
    responsible_role: 'buyer_refund',
    responsible_staff: { staff_id: 'stage75-refund', display_name: '返款甲' },
    next_action: 'PROCESS_BUYER_REFUND',
    next_action_due_at: 1_787_800_000_000,
    is_overdue: true,
    overdue_since: 1_787_800_000_000,
    exception_state: 'OPEN',
    exception_reason: '平台取消待复核',
    available_actions: ['record_refund_payment'],
  },
};

interface MockOptions {
  role: Role;
  firstPage?: unknown[];
  nextCursor?: string | null;
  secondPage?: unknown[];
  failFirstList?: boolean;
  summary?: Record<string, unknown> | null;
}

async function mockApis(page: Page, options: MockOptions): Promise<void> {
  let listCalls = 0;
  let listFailedOnce = false;
  await page.route('**/api/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/access/bootstrap')) {
      await route.fulfill(ok({
        session: session(options.role),
        access_email: 'stage75@example.test',
      }));
      return;
    }
    if (path.endsWith('/staff-auth/session')) {
      await route.fulfill(ok({ session: session(options.role) }));
      return;
    }
    if (path === '/api/staff/me/work-items/summary') {
      await route.fulfill(ok({
        summary: options.summary ?? {
          open_count: 3,
          due_today_count: 1,
          overdue_count: 2,
          exception_order_count: 1,
          refund_due_today_cny_fen: options.role === 'owner' ? '165000' : null,
          recent: [],
        },
      }));
      return;
    }
    if (path.endsWith('/api/staff/me/work-items')) {
      await route.fulfill(ok({ work_items: [], next_cursor: null }));
      return;
    }
    if (path === '/api/staff/formal-orders/order-75'
      || path === '/api/staff/formal-orders/1') {
      await route.fulfill(ok(ORDER_DETAIL));
      return;
    }
    if (path === '/api/staff/formal-orders') {
      listCalls += 1;
      if (options.failFirstList && !listFailedOnce) {
        listFailedOnce = true;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'DEPENDENCY_UNAVAILABLE', message: '暂不可用' },
            meta: { request_id: 'list-fail' },
          }),
        });
        return;
      }
      const cursor = url.searchParams.get('cursor');
      const items = cursor !== null && options.secondPage !== undefined
        ? options.secondPage
        : options.firstPage ?? [];
      const nextCursor = cursor !== null
        ? null
        : options.nextCursor ?? null;
      await route.fulfill(ok({ items, next_cursor: nextCursor }, `list-${listCalls}`));
      return;
    }
    if (path.endsWith('/api/staff/search')) {
      await route.fulfill(ok({ query: '', buyers: [], products: [], orders: [], demands: [] }));
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
}

async function assertNoUnexpectedErrorState(page: Page): Promise<void> {
  const body = page.locator('body');
  for (const text of ['读取失败', '加载失败', '暂时不可用', 'not found', '读取中…', '加载中…']) {
    await expect(body).not.toContainText(text);
  }
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.beforeAll(() => {
  mkdirSync(directory, { recursive: true });
});

test('员工订单列表渲染后端行、翻页并进入统一详情', async ({ page }) => {
  await mockApis(page, {
    role: 'pre_sales',
    firstPage: [
      listItem('1', '123-7654321-0000001'),
      listItem('2', '123-7654321-0000002', {
        stage: 'BUYER_REFUND',
        responsible_role: 'buyer_refund',
        responsible_staff: { staff_id: 'stage75-refund', display_name: '返款甲' },
        next_action: 'PROCESS_BUYER_REFUND',
      }),
    ],
    nextCursor: 'cursor-2',
    secondPage: [listItem('3', '123-7654321-0000003')],
  });
  await page.goto('/staff/orders');
  await expect(page.getByText('123-7654321-0000001').first()).toBeVisible();
  await expect(page.getByText('跟进卖家结算').first()).toBeVisible();
  await expect(page.getByText('处理买家返款').first()).toBeVisible();
  await assertNoUnexpectedErrorState(page);

  await page.getByRole('button', { name: '加载更多' }).click();
  await expect(page.getByText('123-7654321-0000003').first()).toBeVisible();
  // Pages accumulate under 加载更多: page-one rows remain rendered.
  await expect(page.getByText('123-7654321-0000001').first()).toBeVisible();
  await expect(page.getByText(/已全部加载/u)).toBeVisible();

  await page.locator('tr.sa-table__row', { hasText: '123-7654321-0000001' }).first().click();
  await expect(page.getByRole('heading', { name: '订单详情' }).first()).toBeVisible();
  await expect(page.getByText('当前负责人 / 下一步')).toBeVisible();
  await expect(page.getByText('返款甲')).toBeVisible();
  await expect(page.getByText('已逾期').first()).toBeVisible();
  await expect(page.getByText('平台取消待复核')).toBeVisible();
  await assertNoUnexpectedErrorState(page);
});

test('筛选提交进入 URL 并保留在地址栏', async ({ page }) => {
  await mockApis(page, { role: 'owner', firstPage: [] });
  await page.goto('/staff/orders');
  await expect(page.getByText('没有符合条件的订单')).toBeVisible();
  await page.getByRole('textbox').nth(1).fill('20260828B3001');
  await page.getByRole('button', { name: '应用筛选' }).click();
  await expect(page.getByText('没有符合条件的订单')).toBeVisible();
  expect(page.url()).toContain('buyer_customer_no=20260828B3001');
});

test('列表读取失败展示错误态并可恢复', async ({ page }) => {
  await mockApis(page, { role: 'owner', failFirstList: true, firstPage: [listItem('9', '123-7654321-0000009')] });
  await page.goto('/staff/orders');
  await expect(page.getByText(/订单列表读取失败/)).toBeVisible();
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByText('123-7654321-0000009').first()).toBeVisible();
  await assertNoUnexpectedErrorState(page);
});

test('工作台指标卡显示后端权威值（Owner 可见返款金额）', async ({ page }) => {
  await mockApis(page, { role: 'owner', firstPage: [] });
  await page.goto('/staff');
  const metrics = page.getByTestId('staff-workbench-metrics');
  await expect(metrics).toBeVisible();
  await expect(metrics.getByText('我的待处理')).toBeVisible();
  await expect(metrics.getByText('已逾期')).toBeVisible();
  await expect(metrics.getByText('今日应处理返款')).toBeVisible();
  await expect(metrics.getByText('¥1650.00')).toBeVisible();
  await assertNoUnexpectedErrorState(page);
});

test('工作台指标卡对非 Owner 不显示返款金额', async ({ page }) => {
  await mockApis(page, { role: 'pre_sales', firstPage: [] });
  await page.goto('/staff');
  const metrics = page.getByTestId('staff-workbench-metrics');
  await expect(metrics).toBeVisible();
  await expect(metrics.getByText('今日应处理返款')).toHaveCount(0);
  await assertNoUnexpectedErrorState(page);
});

test.describe('阶段 7.5 第一批截图（1440 / 1280 / 390）', () => {
  test('staff order list screenshots', async ({ page }) => {
    await mockApis(page, {
      role: 'owner',
      firstPage: [
        listItem('1', '123-7654321-0000001'),
        listItem('2', '123-7654321-0000002', {
          stage: 'BUYER_REFUND',
          responsible_role: 'buyer_refund',
          responsible_staff: { staff_id: 'stage75-refund', display_name: '返款甲' },
          next_action: 'PROCESS_BUYER_REFUND',
          is_overdue: true,
          overdue_since: 1_787_800_000_000,
        }),
        listItem('3', '123-7654321-0000003'),
      ],
    });
    for (const [width, height, name] of [
      [1440, 900, 'staff-order-list-1440x900'],
      [1280, 900, 'staff-order-list-1280x900'],
      [390, 844, 'staff-order-list-390x844'],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto('/staff/orders');
      await expect(page.getByText('123-7654321-0000001').filter({ visible: true }).first()).toBeVisible();
      await assertNoUnexpectedErrorState(page);
      await noHorizontalOverflow(page);
      await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
    }
  });

  test('staff order detail responsibility screenshots', async ({ page }) => {
    await mockApis(page, { role: 'pre_sales', firstPage: [] });
    for (const [width, height, name] of [
      [1440, 900, 'staff-order-responsibility-1440x900'],
      [390, 844, 'staff-order-responsibility-390x844'],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto('/staff/orders/order-75');
      await expect(page.getByRole('heading', { name: '订单详情' }).first()).toBeVisible();
      await expect(page.getByText('当前负责人 / 下一步')).toBeVisible();
      await assertNoUnexpectedErrorState(page);
      await noHorizontalOverflow(page);
      await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
    }
  });
});
