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
    data_scope: { type: role === 'owner' ? 'GLOBAL' : 'ASSIGNED_BUYERS',
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

async function mock(page: Page, role: 'owner'|'pre_sales', observed?: { dashboardRequests: number }) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/staff-auth/session') return json(route, success({ session: session(role) }));
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

test('owner dashboard is Chinese, responsive and exposes only controlled drill-down', async ({ page }) => {
  await mock(page, 'owner');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/staff/admin-business-dashboard');
  await expect(page).toHaveURL(/\/staff\/admin-business-dashboard$/u);
  await expect(page.getByRole('heading', { name: '经营看板', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '经营概览' })).toBeVisible();
  await expect(page.locator('.dashboard-toolbar').getByText(/北京时间/u)).toBeVisible();
  await expect(page.getByRole('table', { name: '经营趋势（服务端按北京时间分组）' })).toBeVisible();
  await expect(page.getByText(/冲突订单未按零计入利润/u)).toBeVisible();
  const today = page.getByRole('button', { name: '今日' });
  await today.focus();
  await expect(today).toBeFocused();
  expect(await today.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');

  const firstMetric = page.locator('.dashboard-metric').filter({ hasText: '新增买家' });
  await firstMetric.getByRole('button', { name: '查看明细' }).click();
  await expect(page.getByRole('table', { name: '新增买家受控明细' })).toBeVisible();
  await expect(page.getByText('buyer-safe-id')).toBeVisible();
  await expect(page.getByText(/private_wechat|内部备注|file_/u)).toHaveCount(0);

  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
});

test('non-owner direct route neither exposes navigation nor requests dashboard facts', async ({ page }) => {
  const observed = { dashboardRequests: 0 };
  await mock(page, 'pre_sales', observed);
  await page.goto('/staff/admin-business-dashboard');
  await expect(page.getByText(/没有经营看板权限/u)).toBeVisible();
  await expect(page.getByRole('link', { name: '经营看板' })).toHaveCount(0);
  expect(observed.dashboardRequests).toBe(0);
});
