import { expect, test, type Page, type Route } from '@playwright/test';
import type {
  AdminBusinessDashboardSummaryDto,
  DashboardWindow,
} from '@ygb/contracts';

const success = (data: unknown) => ({ data, meta: { request_id: 'dashboard-browser' } });

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function session(role: 'owner'|'pre_sales') {
  return {
    staff_id: `browser-${role}`,
    display_name: role === 'owner' ? '经营负责人' : '浏览器售前',
    role: role === 'owner'
      ? { code: 'owner', display_name: '总管理员' }
      : { code: 'pre_sales', display_name: '售前' },
    permissions: role === 'owner' ? ['FINANCIAL_VIEW'] : [],
    data_scope: { type: role === 'owner' ? 'GLOBAL' : 'MARKETPLACE',
      marketplaceCodes: role === 'owner' ? [] : ['AMAZON_JP'],
      buyerCustomerIds: [], sellerOrganizationIds: [], teamIds: [] },
    authorization_version: 7,
    session_version: 1,
    expires_at: 9_999_999_999_999,
  };
}

const WINDOW_FACTS = {
  TODAY: { from: '2026-08-08', to: '2026-08-08' },
  WEEK: { from: '2026-08-04', to: '2026-08-10' },
  MONTH: { from: '2026-08-01', to: '2026-08-31' },
} as const satisfies Record<DashboardWindow, { from: string; to: string }>;

function dashboardWindow(value: string | null): DashboardWindow {
  if (value === 'TODAY' || value === 'WEEK' || value === 'MONTH') return value;
  throw new Error(`Admin dashboard mock rejected window query: ${String(value)}`);
}

// D-056：经营看板只读精简摘要；漏斗、渠道归因、acquisition-daily 与
// financial-projection 读模型已退役，不再有任何对应请求。
function summary(key: DashboardWindow): AdminBusinessDashboardSummaryDto {
  const fact = WINDOW_FACTS[key];
  return {
    window: { key, from_date: fact.from, to_date: fact.to,
      timezone: 'Asia/Shanghai', data_as_of: 1_786_161_600_000 },
    cards: { new_customers_buyer: 2, new_customers_seller: 1,
      reservations: 1, formal_orders: 1 },
    pending: { buyer_refunds: 2, seller_settlements: 1 },
    overdue: { open_work_items: 1, finance_exceptions: 0 },
    owner_summary: {
      projected_profit: { amount_cny_fen: '12345', valid_order_count: 1, conflict_order_count: 1 },
      completed_profit: { amount_cny_fen: '2345', valid_order_count: 1, conflict_order_count: 0 },
    },
  } satisfies AdminBusinessDashboardSummaryDto;
}

async function mock(page: Page, role: 'owner'|'pre_sales', observed?: {
  dashboardRequests: number;
  summaryQueries?: string[];
}) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/staff-auth/session') return json(route, success({ session: session(role) }));
    if (path === '/api/staff/customer-identity-resolution/cases') return json(route, success({ cases: [] }));
    if (path.startsWith('/api/staff/admin-business-dashboard/')) {
      if (observed) observed.dashboardRequests += 1;
      if (path.endsWith('/summary')) {
        const key = dashboardWindow(url.searchParams.get('window'));
        observed?.summaryQueries?.push(url.searchParams.toString());
        return json(route, success({ summary: summary(key) }));
      }
    }
    return json(route, { error: { code: 'NOT_FOUND', message: 'not found', details: null },
      meta: { request_id: 'dashboard-browser-unhandled' } }, 404);
  });
}

test('owner dashboard is Chinese, responsive and reads only the lean summary', async ({ page }) => {
  const observed = { dashboardRequests: 0, summaryQueries: [] as string[] };
  await mock(page, 'owner', observed);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/staff/admin-business-dashboard');
  await expect(page).toHaveURL(/\/staff\/admin-business-dashboard$/u);
  await expect(page.getByRole('heading', { name: '客户与订单', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '需要你处理的', exact: true })).toBeVisible();
  await expect(page.locator('.dashboard-toolbar').getByText(/北京时间/u)).toBeVisible();
  await expect(page.getByText('新增买家客户')).toBeVisible();
  await expect(page.getByText('待处理买家返款')).toBeVisible();
  await expect(page.getByText('预计净赚')).toBeVisible();
  await expect.poll(() => observed.summaryQueries.includes('window=TODAY')).toBe(true);
  const today = page.getByRole('button', { name: '今日' });
  await today.focus();
  await expect(today).toBeFocused();
  expect(await today.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');

  await page.getByRole('button', { name: '本周' }).click();
  await expect.poll(() => observed.summaryQueries.includes('window=WEEK')).toBe(true);

  await expect(page.getByRole('button', { name: '查看明细' })).toHaveCount(0);
  await expect(page.getByText(/private_wechat|内部备注|file_/u)).toHaveCount(0);

  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
});

test('non-owner direct route neither exposes navigation nor requests dashboard facts', async ({ page }) => {
  const observed = { dashboardRequests: 0 };
  await mock(page, 'pre_sales', observed);
  await page.goto('/staff/admin-business-dashboard');
  await expect(page.getByText('只有总管理员可以查看经营看板。')).toBeVisible();
  await expect(page.getByRole('link', { name: '经营看板' })).toHaveCount(0);
  expect(observed.dashboardRequests).toBe(0);
});
