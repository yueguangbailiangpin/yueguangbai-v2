import { expect, test, type Page, type Route } from '@playwright/test';

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

function summary() {
  const performance = {
    dimension_id: 'staff-safe-id', dimension_name: '来源员工', consultation_count: null,
    buyer_lead_count: 2, buyer_registered_count: 1, buyer_reservation_count: 1,
    buyer_formal_order_count: 1, buyer_business_completed_count: 0,
    buyer_no_participation_count: 1, seller_lead_count: 1, seller_cooperation_count: 1,
    current_owner_active_lead_count: 2,
    projected_profit: profit('12345', 1, 1), completed_profit: profit('2345', 1, 1),
  };
  return {
    window: { key: 'TODAY', from_date: '2026-08-08', to_date: '2026-08-08',
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
  };
}

function acquisitionDaily() {
  return {
    from_date: '2026-08-08', to_date: '2026-08-08', timezone: 'Asia/Shanghai',
    data_as_of: 1_786_161_600_000,
    reporting_precision: { configured: true, business_date: '2026-08-08' },
    anomalies: { identity_conflicts: 0, attribution_anomalies: 0,
      buyer_attribution_gaps: 0, seller_attribution_gaps: 0, finance_conflicts: 1 },
    totals: { new_buyer_customers: 2, new_seller_customers: 1,
      buyer_portal_registrations: 1, seller_portal_registrations: 1,
      formal_orders: 1, buyer_historical_unknown_orders: 0,
      seller_historical_unknown_orders: 0, buyer_attribution_anomaly_orders: 0,
      seller_attribution_anomaly_orders: 0 },
    daily: [], channel_daily: [],
  };
}

function financialProjection() {
  return {
    from_date: '2026-08-08', to_date: '2026-08-08', timezone: 'Asia/Shanghai',
    data_as_of: 1_786_161_600_000, seller_cash_in_cny_fen: '30000',
    buyer_cash_out_cny_fen: '10000', net_cash_flow_cny_fen: '20000',
    seller_payable_due_cny_fen: '25000', seller_payable_paid_cny_fen: '15000',
    seller_payable_outstanding_cny_fen: '10000', buyer_refund_due_cny_fen: '12000',
    buyer_refund_paid_cny_fen: '10000', buyer_refund_outstanding_cny_fen: '2000',
    projected_profit_cny_fen: '12345', completed_profit_cny_fen: '2345',
    projected_profit_adjustment_cny_fen: '0', completed_profit_adjustment_cny_fen: '0',
  };
}

async function mock(page: Page, role: 'owner'|'pre_sales', observed?: { dashboardRequests: number }) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/staff-auth/session') return json(route, success({ session: session(role) }));
    if (path.endsWith('/acquisition-daily')) return json(route, success(acquisitionDaily()));
    if (path.endsWith('/financial-projection')) return json(route, success({ financial_projection: financialProjection() }));
    if (path === '/api/staff/acquisition/reporting-config') return json(route, success({ config: {
      precision_started_business_date: '2026-08-08', activated_at: 1_786_161_600_000,
      activated_by_staff_id: 'browser-owner', version: 1, updated_at: 1_786_161_600_000,
    } }));
    if (path === '/api/staff/customer-identity-resolution/cases') return json(route, success({ cases: [] }));
    if (path.startsWith('/api/staff/admin-business-dashboard/')) {
      if (observed) observed.dashboardRequests += 1;
      if (path.endsWith('/summary')) return json(route, success({ summary: summary() }));
      if (path.endsWith('/trends')) return json(route, success({ trend: {
        granularity: 'DAY', from_date: '2026-08-08', to_date: '2026-08-08',
        timezone: 'Asia/Shanghai', data_as_of: 1_786_161_600_000,
        points: [{ from_date: '2026-08-08', to_date: '2026-08-08', new_buyers: 2,
          reservations: 1, formal_orders: 1, business_completions: 0,
          projected_profit: profit('12345', 1, 1), completed_profit: profit('2345', 1, 1) }],
      } }));
      if (path.endsWith('/drill-down')) return json(route, success({ drill_down: {
        metric: 'NEW_BUYERS', from_date: '2026-08-08', to_date: '2026-08-08',
        timezone: 'Asia/Shanghai', data_as_of: 1_786_161_600_000,
        items: [{ reference_id: 'buyer-safe-id', business_date: '2026-08-08', status: 'ACTIVE' }],
        next_cursor: null,
      } }));
    }
    return json(route, { error: { code: 'NOT_FOUND', message: 'not found', details: null },
      meta: { request_id: 'dashboard-browser-unhandled' } }, 404);
  });
}

test('owner dashboard is Chinese, responsive and uses canonical finance projections', async ({ page }) => {
  await mock(page, 'owner');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/staff/admin-business-dashboard');
  await expect(page).toHaveURL(/\/staff\/admin-business-dashboard$/u);
  await expect(page.getByRole('heading', { name: '经营看板', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '资金与经营口径' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '客户与订单概览' })).toBeVisible();
  await expect(page.locator('.dashboard-toolbar').getByText(/北京时间/u)).toBeVisible();
  await expect(page.getByText('¥200.00')).toBeVisible();
  await expect(page.getByText('财务冲突')).toBeVisible();
  const today = page.getByRole('button', { name: '今日' });
  await today.focus();
  await expect(today).toBeFocused();
  expect(await today.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');

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
