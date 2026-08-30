import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

test.use({
  colorScheme: 'light',
  locale: 'zh-CN',
  reducedMotion: 'reduce',
  timezoneId: 'Asia/Shanghai',
});

type Role = 'owner' | 'pre_sales' | 'seller_ops' | 'buyer_refund';

const screenshotDirectory = process.env['STAFF_VISUAL_SCREENSHOT_DIR'];
const fixedNow = Date.parse('2026-08-09T04:00:00.000Z');
const success = (data: unknown) => ({ data, meta: { request_id: 'staff-visual-refresh' } });
const roleNames: Record<Role, string> = {
  owner: '总管理员', pre_sales: '售前', seller_ops: '卖家对接', buyer_refund: '买家返款',
};
const rolePermissions: Record<Role, string[]> = {
  owner: ['PRODUCT_VIEW', 'PRODUCT_REVIEW', 'DEMAND_PUBLISH', 'FINANCIAL_VIEW',
    'ORDER_VIEW', 'ORDER_CONFIRM'],
  pre_sales: ['PRODUCT_VIEW', 'ORDER_VIEW', 'ORDER_CONFIRM'],
  seller_ops: ['PRODUCT_VIEW', 'PRODUCT_REVIEW', 'DEMAND_PUBLISH'],
  buyer_refund: ['REVIEW_VIEW', 'REVIEW_APPROVE', 'BUYER_REFUND_VIEW', 'BUYER_REFUND_PAY'],
};

function staffSession(role: Role) {
  return {
    staff_id: `visual-${role}`,
    display_name: role === 'owner' ? '白月光' : `视觉${roleNames[role]}`,
    role: { code: role, display_name: roleNames[role] },
    permissions: rolePermissions[role],
    data_scope: { type: role === 'owner' ? 'GLOBAL' : 'MARKETPLACE',
    marketplaceCodes: role === 'owner' ? [] : ['AMAZON_JP'],
    buyerCustomerIds: role === 'seller_ops' ? [] : ['buyer-visual'],
    sellerOrganizationIds: role === 'pre_sales' || role === 'buyer_refund' ? [] : ['seller-visual'],
    teamIds: [] },
    authorization_version: 7, session_version: 3, expires_at: fixedNow + 3_600_000,
  };
}

const workItem = {
  work_item_id: 'work-visual', work_type: 'ORDER_EVIDENCE_REVIEW',
  source_entity_type: 'ORDER_EVIDENCE', source_entity_id: 'evidence-visual',
  buyer_customer_id: 'buyer-visual', seller_organization_id: 'seller-visual',
  store_id: 'store-visual', duty_code: 'BUYER_PRE_SALES_OWNER',
  fixed_assignment_id: 'assignment-visual', assigned_staff_id: 'visual-owner',
  status: 'OPEN', version: 2, created_at: fixedNow - 7_200_000,
  updated_at: fixedNow - 3_600_000, completed_at: null, cancelled_at: null,
  sla_due_at: 1786161600000 + 172800000,
  is_overdue: false,
  overdue_since: null,
  next_action: 'REVIEW_ORDER_EVIDENCE',
  responsible_role: 'pre_sales',
  responsible_staff_name: '总管理员',
  priority: 'NORMAL',
};

const orderEvidence = {
  submission_id: 'evidence-visual', reservation_id: 'reservation-visual', marketplace: 'AMAZON_JP',
  status: 'PENDING_VERIFICATION', version: 2, evidence_version_no: 1,
  amazon_order_number_raw: '503-1234567-1234567',
  amazon_order_number_normalized: '503-1234567-1234567', amazon_order_date: '2026-08-09',
  final_paid_jpy: '12880', buyer_note: '订单页面已包含折扣后的实付金额',
  public_change_reason: null, submitted_at: fixedNow - 7_200_000,
  updated_at: fixedNow - 3_600_000, verified_at: null, withdrawn_at: null,
  buyer_customer_id: 'buyer-visual', internal_review_note: '请核对平台优惠后的金额',
  verified_by_staff_id: null, duplicate_signal_count: 0,
  reference_order_amount_jpy: '13000', price_difference_jpy: '-120', price_mismatch: true,
  screenshot: { file_object_id: 'file-visual', file_version: 4,
    purpose: 'ORDER_EVIDENCE', visibility: 'BUYER_VISIBLE' },
  buyer: { buyer_customer_id: 'buyer-visual', buyer_customer_no: '20260809B001' },
  instruction: { instruction_id: 'instruction-visual', instruction_version_id: 'instruction-version-visual',
    buyer_self_pay_bps: 1000, buyer_self_pay_jpy: '1300', buyer_refundable_principal_jpy: '11700' },
  reservation: { reservation_id: 'reservation-visual', status: 'ORDER_EVIDENCE_SUBMITTED', version: 4 },
  version_history: [{ evidence_version_id: 'evidence-version-visual', version_no: 1,
    final_paid_jpy: '12880', submitted_at: fixedNow - 7_200_000 }],
  workflow: { work_item_id: 'work-visual', assigned_staff_id: 'visual-owner',
    assigned_team_id: null, fixed_assignment_id: 'assignment-visual' },
};

const product = {
  product_id: 'product-visual', seller_organization_id: 'seller-visual', store_id: 'store-visual',
  store_name: '东京精选店', marketplace_code: 'AMAZON_JP', asin: 'B0VISUAL01', status: 'ACTIVE',
  aggregate_version: 2, current_version_no: 2, product_name: '月光白经典手链',
  cadence: { order_interval_days: 1, orders_per_run: 2 }, updated_at: fixedNow,
};

const productVersion = {
  product_version_id: 'version-visual', version_no: 2, product_name: '月光白经典手链',
  search_keywords: ['手链', '经典款'], ordering_guide_expected_amount_jpy: 3280,
  color_spec_mode: 'MAIN_IMAGE_VARIANT', default_buyer_self_pay_bps: 1000,
  product_url: 'https://example.invalid/product', buyer_visible_notes: '选择 10mm 规格',
  internal_notes: '视觉验收匿名数据', cadence: { order_interval_days: 1, orders_per_run: 2 },
  main_image: { file_object_id: 'file-visual-main', file_version: 1,
    client_file_name: 'main.png', bound_at: fixedNow - 86_400_000 },
  created_at: fixedNow - 86_400_000,
};

const demandSchedule = {
  schedule_version_id: 'schedule-visual', version_no: 1, demand_version: 4,
  first_order_date: '2026-08-10', order_interval_days: 1, orders_per_run: 2,
  theoretical_last_order_date: '2026-08-19', affected_reservation_count: 2,
  preview_hash: 'b'.repeat(64), change_reason: '需求发布', changed_by_staff_id: 'visual-owner',
  created_at: fixedNow,
};

function dashboardProfit(amount: string, valid: number, conflicts: number) {
  return { amount_cny_fen: amount, valid_order_count: valid, conflict_order_count: conflicts };
}

function dashboardStage(code: string, label: string, count: number, conversion: number | null) {
  return { code, label, count, conversion_rate_bps: conversion };
}

function dashboardSummary() {
  const performance = {
    dimension_id: 'staff-safe-id', dimension_name: '售前一组', consultation_count: null,
    buyer_lead_count: 12, buyer_registered_count: 9, buyer_reservation_count: 7,
    buyer_formal_order_count: 5, buyer_business_completed_count: 3,
    buyer_no_participation_count: 2, seller_lead_count: 4, seller_cooperation_count: 2,
    current_owner_active_lead_count: 5,
    projected_profit: dashboardProfit('168800', 5, 1), completed_profit: dashboardProfit('88600', 3, 0),
  };
  return {
    window: { key: 'TODAY', from_date: '2026-08-09', to_date: '2026-08-09',
      timezone: 'Asia/Shanghai', data_as_of: fixedNow },
    cards: { new_buyers: 9, reservations: 7, formal_orders: 5, business_completions: 3 },
    buyer_funnel: { stages: [dashboardStage('CONSULTATION', '咨询', 20, null),
      dashboardStage('WECHAT_ADDED', '加微信', 12, 6000), dashboardStage('REGISTERED', '注册', 9, 7500),
      dashboardStage('RESERVATION_SUBMITTED', '预约', 7, 7778),
      dashboardStage('FORMAL_ORDER', '正式订单', 5, 7143),
      dashboardStage('BUSINESS_COMPLETED', '业务完成', 3, 6000)], no_participation_count: 2 },
    seller_funnel: { stages: [dashboardStage('CONSULTATION', '咨询', 8, null),
      dashboardStage('WECHAT_ADDED', '加微信', 4, 5000), dashboardStage('COOPERATION', '确认合作', 2, 5000)] },
    projected_profit: dashboardProfit('168800', 5, 1), completed_profit: dashboardProfit('88600', 3, 0),
    staff_performance: [performance], channel_performance: [{ ...performance,
      dimension_id: 'channel-safe-id', dimension_name: '小红书一号', consultation_count: 20,
      current_owner_active_lead_count: null }],
  };
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installStaffFixture(page: Page, role: Role = 'owner'): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/staff-auth/session') return json(route, success({ session: staffSession(role) }));
    if (path === '/api/staff/me/work-items/summary') {
      return json(route, success({ summary: {
        open_count: 0, due_today_count: 0, overdue_count: 0,
        exception_order_count: 0, refund_due_today_cny_fen: null,
        recent: [],
      } }));
    }
    if (path === '/api/staff/me/work-items') return json(route, success({ work_items: [workItem], next_cursor: null }));
    if (path === '/api/staff/me/work-items/work-visual') return json(route, success({ work_item: workItem }));
    if (path === '/api/staff/order-evidence/evidence-visual') return json(route, success({ order_evidence: orderEvidence }));
    if (path === '/api/staff/catalog/products') return json(route, success({ page: {
      items: [product], next_cursor: null, data_as_of: fixedNow,
    } }));
    if (path === '/api/staff/catalog/products/product-visual') return json(route, success({ product: {
      ...product, versions: [productVersion], demands: [{ demand_batch_id: 'demand-visual',
        status: 'PUBLISHED', target_quantity: 20, effective_reservation_count: 2,
        order_deadline: fixedNow + 10 * 86_400_000, demand_version: 4,
        schedule_version: 1, first_order_date: '2026-08-10' }],
      timezone: 'Asia/Shanghai', data_as_of: fixedNow,
    } }));
    if (path === '/api/staff/demand-batches/demand-visual/reservation-schedule') return json(route, success({ page: {
      demand: { demand_batch_id: 'demand-visual', product_id: 'product-visual',
        product_name: product.product_name, target_quantity: 20, effective_reservation_count: 2,
        order_deadline: fixedNow + 10 * 86_400_000, demand_version: 4,
        status: 'PUBLISHED', can_close: true, schedule: demandSchedule },
      items: [{ reservation_id: 'reservation-a', status: 'APPROVED', submitted_at: fixedNow - 5000,
        decision_source: 'STAFF', version: 2,
        rank: 1, planned_order_date: '2026-08-10', buyer_reference: 'B0001',
        buyer_customer_id: 'buyer-visual', buyer_display_name: '林女士',
        actual_order_status: null, actual_order_date: null },
      { reservation_id: 'reservation-b', status: 'PENDING_REVIEW', submitted_at: fixedNow - 4000,
        decision_source: null, version: 1,
        rank: 2, planned_order_date: '2026-08-10', buyer_reference: 'B0002',
        buyer_customer_id: null, buyer_display_name: null,
        actual_order_status: null, actual_order_date: null }],
      next_cursor: null, timezone: 'Asia/Shanghai', sorting: 'submitted_at ASC, id ASC', data_as_of: fixedNow,
    } }));
    if (path === '/api/staff/admin-business-dashboard/summary') return json(route, success({ summary: dashboardSummary() }));
    if (path === '/api/staff/customer-identity-resolution/cases') return json(route, success({ cases: [] }));
    return json(route, { error: { code: 'NOT_FOUND', message: 'not found', details: null },
      meta: { request_id: 'staff-visual-unhandled' } }, 404);
  });
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const size = await page.evaluate(() => {
    const client = document.documentElement.clientWidth;
    const dimensions = ['.staff-business-shell', '.staff-work-area', '.staff-main',
      '.product-scheduling-workspace'].map((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return `${selector}=missing`;
      const rect = element.getBoundingClientRect();
      return `${selector}=${Math.round(rect.left)}/${Math.round(rect.width)}`;
    });
    return { client, scroll: document.documentElement.scrollWidth, dimensions,
      offenders: [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.right > client + 1 || rect.left < -1;
        })
        .slice(0, 12)
        .map((element) => { const rect = element.getBoundingClientRect();
          return `${element.tagName.toLowerCase()}.${element.className}`
            + `[${Math.round(rect.left)},${Math.round(rect.width)},${Math.round(rect.right)}]`;
        }) };
  });
  expect(size.scroll, `horizontal overflow: ${size.offenders.join(', ')}; ${size.dimensions.join(', ')}`)
    .toBeLessThanOrEqual(size.client + 1);
}

async function capture(page: Page, name: string): Promise<void> {
  if (!screenshotDirectory) return;
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: join(screenshotDirectory, name), animations: 'disabled',
    caret: 'hide', fullPage: true });
}

async function verifyAfterOverflow(page: Page): Promise<void> {
  if (!screenshotDirectory?.endsWith('/before')) await noHorizontalOverflow(page);
}

const primaryViewports = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;
const extendedViewports = [
  { width: 320, height: 800 },
  { width: 768, height: 1024 },
  { width: 1600, height: 1000 },
] as const;
const surfaces = [
  ['workbench', '/staff/work/work-visual', '订单资料'],
  ['products', '/staff/products', '产品与预约'],
  ['product-detail', '/staff/products/product-visual', '月光白经典手链'],
  ['reservation-schedule', '/staff/demands/demand-visual/reservations', '预约排名与预计下单日期'],
  ['dashboard', '/staff/admin-business-dashboard', '客户与订单'],
] as const;

test('Staff visual refresh captures the deterministic responsive matrix', async ({ page }) => {
  test.setTimeout(120_000);
  await installStaffFixture(page);
  for (const viewport of primaryViewports) {
    await page.setViewportSize(viewport);
    await page.goto('/staff/login');
    await expect(page.getByText('月光白', { exact: true })).toBeVisible();
    await verifyAfterOverflow(page);
    await capture(page, `staff-login-${viewport.width}x${viewport.height}.png`);
    for (const [name, path, text] of surfaces) {
      await page.goto(path);
      await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
      await verifyAfterOverflow(page);
      await capture(page, `staff-${name}-${viewport.width}x${viewport.height}.png`);
    }
  }
  for (const viewport of extendedViewports) {
    await page.setViewportSize(viewport);
    for (const [name, path, text] of surfaces.filter(([name]) =>
      ['workbench', 'reservation-schedule', 'dashboard'].includes(name))) {
      await page.goto(path);
      await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
      await verifyAfterOverflow(page);
      await capture(page, `staff-${name}-${viewport.width}x${viewport.height}.png`);
    }
  }
});

test('Staff navigation follows all four canonical role projections', async ({ browser }) => {
  // D-056 四角色（acquisition 退役）；upcoming 导航项渲染为 span 非 link，不在断言内。
  const expected: Record<Role, string[]> = {
    owner: ['工作台', '买家', '卖家', '产品与预约', '买家返款', '财务', '员工与权限', '经营看板'],
    pre_sales: ['工作台', '买家', '产品与预约'],
    seller_ops: ['工作台', '卖家', '产品与预约'],
    buyer_refund: ['工作台', '买家返款'],
  };
  for (const role of Object.keys(expected) as Role[]) {
    const context = await browser.newContext({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    const page = await context.newPage();
    await installStaffFixture(page, role);
    await page.goto('/staff');
    await expect(page.getByText(roleNames[role], { exact: true }).first()).toBeVisible();
    const navigation = page.getByRole('navigation', { name: '员工工作台主导航' });
    for (const label of ['工作台', '买家', '卖家', '产品与预约', '买家返款', '财务', '员工与权限', '经营看板']) {
      const link = navigation.getByRole('link', { name: label, exact: true });
      if (expected[role].includes(label)) await expect(link).toBeVisible();
      else await expect(link).toHaveCount(0);
    }
    await context.close();
  }
});

test('Staff pages preserve keyboard, zoom, reduced motion, targets, and disclosure boundaries', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installStaffFixture(page);
  for (const viewport of [...extendedViewports, ...primaryViewports]) {
    await page.setViewportSize(viewport);
    await page.goto('/staff/work/work-visual');
    await noHorizontalOverflow(page);
    const targets = await page.locator('a, button, select, input, textarea').evaluateAll((elements) =>
      elements.filter((element) => { const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden'; })
        .map((element) => { const box = element.getBoundingClientRect();
          return { width: box.width, height: box.height }; }));
    for (const target of targets) {
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
    }
  }
  for (const viewport of primaryViewports) {
    await page.setViewportSize(viewport);
    await page.goto('/staff/admin-business-dashboard');
    const dashboardButtons = page.locator('.dashboard-window-switch button');
    await expect(dashboardButtons.first()).toBeVisible();
    const heights = await dashboardButtons.evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height));
    expect(heights).toHaveLength(3);
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/staff/buyer-customers');
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await noHorizontalOverflow(page);
  const lookupButton = page.getByRole('button', { name: '查询已有客户' });
  await lookupButton.focus();
  await expect(lookupButton).toBeFocused();
  expect(await lookupButton.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await expect(page.locator('body')).not.toContainText(/object_key|drive_file_id|password_hash|session_token/u);
});

test('Staff lazy routes remain isolated on cold loads', async ({ page }) => {
  const scripts = new Set<string>();
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.endsWith('.js')) scripts.add(path.split('/').at(-1) ?? path);
  });
  await installStaffFixture(page);
  await page.goto('/staff/work/work-visual');
  await expect(page.getByRole('heading', { name: '订单资料', level: 3 })).toBeVisible();
  expect([...scripts].some((name) => /BuyerRouteModule|BuyerOrderRouteModule|BuyerAfterSalesRouteModule|SellerRouteModule|StaffAdminRouteModule|StaffSchedulingRouteModule/u.test(name))).toBe(false);
});
