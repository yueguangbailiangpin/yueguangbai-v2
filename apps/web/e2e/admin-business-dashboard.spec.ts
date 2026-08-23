import { expect, test, type Page, type Route } from '@playwright/test';
import type {
  AdminBusinessDashboardSummaryDto,
  DashboardWindow,
  FinancialReportingProjectionDto,
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

function profit(amount: string, valid: number, conflicts: number) {
  return { amount_cny_fen: amount, valid_order_count: valid, conflict_order_count: conflicts };
}

function stage(code: string, label: string, count: number, conversion: number|null) {
  return { code, label, count, conversion_rate_bps: conversion };
}

const WINDOW_FACTS = {
  TODAY: { from: '2026-08-08', to: '2026-08-08', channel: '今日渠道事实' },
  WEEK: { from: '2026-08-04', to: '2026-08-10', channel: '本周渠道事实' },
  MONTH: { from: '2026-08-01', to: '2026-08-31', channel: '本月渠道事实' },
} as const satisfies Record<DashboardWindow, { from: string; to: string; channel: string }>;

function dashboardWindow(value: string | null): DashboardWindow {
  if (value === 'TODAY' || value === 'WEEK' || value === 'MONTH') return value;
  throw new Error(`Admin dashboard mock rejected window query: ${String(value)}`);
}

function windowForRange(from: string | null, to: string | null): DashboardWindow {
  const key = Object.entries(WINDOW_FACTS).find(([, fact]) => fact.from === from && fact.to === to)?.[0];
  if (key === 'TODAY' || key === 'WEEK' || key === 'MONTH') return key;
  throw new Error(`Admin dashboard mock rejected date query: ${String(from)}:${String(to)}`);
}

function summary(key: DashboardWindow): AdminBusinessDashboardSummaryDto {
  const fact = WINDOW_FACTS[key];
  const performance = {
    dimension_id: 'staff-safe-id', dimension_name: '来源员工', consultation_count: null,
    buyer_lead_count: 2, buyer_registered_count: 1, buyer_reservation_count: 1,
    buyer_formal_order_count: 1, buyer_business_completed_count: 0,
    buyer_no_participation_count: 1, seller_lead_count: 1, seller_cooperation_count: 1,
    current_owner_active_lead_count: 2,
    projected_profit: profit('12345', 1, 1), completed_profit: profit('2345', 1, 1),
  };
  return {
    window: { key, from_date: fact.from, to_date: fact.to,
      timezone: 'Asia/Shanghai', data_as_of: 1_786_161_600_000 },
    cards: { new_buyers: 2, reservations: 1, formal_orders: 1, business_completions: 0 },
    buyer_funnel: { stages: [stage('CONSULTATION', '咨询', 3, null),
      stage('WECHAT_ADDED', '加微信', 2, 6667), stage('REGISTERED', '注册', 1, 5000),
      stage('RESERVATION_SUBMITTED', '预约', 1, 10000),
      stage('FORMAL_ORDER', '正式订单', 1, 10000),
      stage('BUSINESS_COMPLETED', '业务完成', 0, 0)], no_participation_count: 1 },
    seller_funnel: { stages: [stage('CONSULTATION', '咨询', 2, null),
      stage('WECHAT_ADDED', '加微信', 1, 5000),
      stage('COOPERATION', '确认合作', 1, 10000)] },
    projected_profit: profit('12345', 1, 1), completed_profit: profit('2345', 1, 1),
    staff_performance: [performance],
    channel_performance: [{ ...performance, dimension_id: 'channel-safe-id',
      dimension_name: '小红书一号', current_owner_active_lead_count: null,
      consultation_count: 3 }],
  } satisfies AdminBusinessDashboardSummaryDto;
}

function acquisitionDaily(key: DashboardWindow) {
  const fact = WINDOW_FACTS[key];
  return {
    from_date: fact.from, to_date: fact.to, timezone: 'Asia/Shanghai',
    data_as_of: 1_786_161_600_000,
    reporting_precision: { configured: true, business_date: '2026-08-08' },
    anomalies: { identity_conflicts: 2, attribution_anomalies: 4,
      buyer_attribution_gaps: 3, seller_attribution_gaps: 2, finance_conflicts: 1 },
    totals: { new_buyer_customers: 2, new_seller_customers: 1,
      buyer_portal_registrations: 1, seller_portal_registrations: 1,
      formal_orders: 1, buyer_historical_unknown_orders: 0,
      seller_historical_unknown_orders: 0, buyer_attribution_anomaly_orders: 0,
      seller_attribution_anomaly_orders: 2 },
    daily: [{ business_date: fact.to, new_buyer_customers: 2, new_seller_customers: 1,
      buyer_portal_registrations: 1, seller_portal_registrations: 1, formal_orders: 1,
      buyer_historical_unknown_orders: 1, seller_historical_unknown_orders: 1,
      buyer_attribution_anomaly_orders: 3, seller_attribution_anomaly_orders: 2 }],
    channel_daily: [{ business_date: fact.to, channel_id: `channel-${key.toLowerCase()}`,
      channel_name: fact.channel, channel_label: '员工渠道一号', platform_name: '小红书',
      channel_status: 'ACTIVE' as const, lead_type: 'BUYER' as const, marketplace_code: 'AMAZON_JP',
      new_customer_count: 2, formal_order_count: 1 }],
  };
}

function financialProjection(key: DashboardWindow): FinancialReportingProjectionDto {
  const fact = WINDOW_FACTS[key];
  return {
    from_date: fact.from, to_date: fact.to, timezone: 'Asia/Shanghai',
    data_as_of: 1_786_161_600_000, seller_cash_in_cny_fen: '30000',
    buyer_cash_out_cny_fen: '10000', net_cash_flow_cny_fen: '20000',
    seller_payable_due_cny_fen: '25000', seller_payable_paid_cny_fen: '15000',
    seller_payable_outstanding_cny_fen: '10000', buyer_refund_due_cny_fen: '12000',
    buyer_refund_paid_cny_fen: '10000', buyer_refund_outstanding_cny_fen: '2000',
    projected_profit_cny_fen: '12345', completed_profit_cny_fen: '2345',
    projected_profit_adjustment_cny_fen: '0', completed_profit_adjustment_cny_fen: '0',
  } satisfies FinancialReportingProjectionDto;
}

async function mock(page: Page, role: 'owner'|'pre_sales', observed?: {
  dashboardRequests: number;
  summaryQueries?: string[];
  dailyRanges?: string[];
  financialRanges?: string[];
}) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/staff-auth/session') return json(route, success({ session: session(role) }));
    if (path.endsWith('/acquisition-daily')) {
      const key = windowForRange(url.searchParams.get('from_date'), url.searchParams.get('to_date'));
      observed?.dailyRanges?.push(url.searchParams.toString());
      return json(route, success(acquisitionDaily(key)));
    }
    if (path.endsWith('/financial-projection')) {
      const key = windowForRange(url.searchParams.get('from_date'), url.searchParams.get('to_date'));
      observed?.financialRanges?.push(url.searchParams.toString());
      return json(route, success({ financial_projection: financialProjection(key) }));
    }
    if (path === '/api/staff/acquisition/reporting-config') return json(route, success({ config: {
      precision_started_business_date: '2026-08-08', activated_at: 1_786_161_600_000,
      activated_by_staff_id: 'browser-owner', version: 1, updated_at: 1_786_161_600_000,
    } }));
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

test('owner dashboard is Chinese, responsive and uses canonical finance projections', async ({ page }) => {
  const observed = { dashboardRequests: 0, summaryQueries: [] as string[], dailyRanges: [] as string[], financialRanges: [] as string[] };
  await mock(page, 'owner', observed);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/staff/admin-business-dashboard');
  await expect(page).toHaveURL(/\/staff\/admin-business-dashboard$/u);
  await expect(page.getByRole('heading', { name: '经营看板', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '本期赚了多少' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '客户与订单' })).toBeVisible();
  await expect(page.locator('.dashboard-toolbar').getByText(/北京时间/u)).toBeVisible();
  await expect(page.getByText('¥200.00')).toBeVisible();
  await expect(page.getByText('客户身份对不上')).toBeVisible();
  await expect(page.getByText('找不到来源的订单')).toBeVisible();
  await expect(page.getByText('账目对不上')).toBeVisible();
  await expect.poll(() => observed.summaryQueries.includes('window=TODAY')).toBe(true);
  await expect.poll(() => observed.dailyRanges.includes('from_date=2026-08-08&to_date=2026-08-08')).toBe(true);
  await expect.poll(() => observed.financialRanges.includes('from_date=2026-08-08&to_date=2026-08-08')).toBe(true);
  const today = page.getByRole('button', { name: '今日' });
  await today.focus();
  await expect(today).toBeFocused();
  expect(await today.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');

  await page.getByRole('button', { name: '本周' }).click();
  await expect.poll(() => observed.summaryQueries.includes('window=WEEK')).toBe(true);
  await expect.poll(() => observed.dailyRanges.includes('from_date=2026-08-04&to_date=2026-08-10')).toBe(true);
  await expect.poll(() => observed.financialRanges.includes('from_date=2026-08-04&to_date=2026-08-10')).toBe(true);

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
