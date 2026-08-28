import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

const screenshotDirectory = process.env['M5_SCREENSHOT_DIR'];
const success = (data: unknown, requestId = 'm5-browser') => ({ data, meta: { request_id: requestId } });
const session = {
  staff_id: 'staff-m5', display_name: '售前员工', role: { code: 'pre_sales', display_name: '售前' },
  permissions: ['ORDER_VIEW', 'ORDER_CONFIRM'], data_scope: {
    type: 'MARKETPLACE', marketplaceCodes: ['AMAZON_JP'], buyerCustomerIds: ['buyer-m5'], sellerOrganizationIds: [], teamIds: [],
  }, authorization_version: 2, session_version: 3, expires_at: 9_999_999_999_999,
};
const item = {
  work_item_id: 'work-m5', work_type: 'ORDER_EVIDENCE_REVIEW', source_entity_type: 'ORDER_EVIDENCE',
  source_entity_id: 'evidence-m5', buyer_customer_id: 'buyer-m5', seller_organization_id: 'org-m5',
  store_id: 'store-m5', duty_code: 'BUYER_PRE_SALES_OWNER', fixed_assignment_id: 'assignment-m5',
  assigned_staff_id: 'staff-m5', status: 'OPEN', version: 2,
  created_at: 1_786_000_000_000, updated_at: 1_786_000_000_000, completed_at: null, cancelled_at: null,
  sla_due_at: 1786161600000 + 172800000,
  is_overdue: false,
  overdue_since: null,
  next_action: 'REVIEW_ORDER_EVIDENCE',
  responsible_role: 'pre_sales',
  responsible_staff_name: '总管理员',
  priority: 'NORMAL',
};
const evidence = {
  submission_id: 'evidence-m5', reservation_id: 'reservation-m5', marketplace: 'AMAZON_JP', status: 'PENDING_VERIFICATION',
  version: 2, evidence_version_no: 1, amazon_order_number_raw: '123-1234567-1234567',
  amazon_order_number_normalized: '123-1234567-1234567', amazon_order_date: '2026-08-06', final_paid_jpy: '12880',
  buyer_note: '订单页面已包含折扣后的实付金额', public_change_reason: null,
  submitted_at: 1_786_000_000_000, updated_at: 1_786_000_000_000, verified_at: null, withdrawn_at: null,
  buyer_customer_id: 'buyer-m5', internal_review_note: '请核对折扣', verified_by_staff_id: null,
  duplicate_signal_count: 0, reference_order_amount_jpy: '13000', price_difference_jpy: '-120', price_mismatch: true,
  screenshot: { file_object_id: 'file-m5', file_version: 4, purpose: 'ORDER_EVIDENCE', visibility: 'BUYER_VISIBLE' },
  buyer: { buyer_customer_id: 'buyer-m5', buyer_customer_no: '20260806B001' },
  instruction: { instruction_id: 'instruction-m5', instruction_version_id: 'instruction-version-m5', buyer_self_pay_bps: 1000, buyer_self_pay_jpy: '1300', buyer_refundable_principal_jpy: '11700' },
  reservation: { reservation_id: 'reservation-m5', status: 'ORDER_EVIDENCE_SUBMITTED', version: 4 },
  version_history: [{ evidence_version_id: 'evidence-version-m5', version_no: 1, final_paid_jpy: '12880', submitted_at: 1_786_000_000_000 }],
  workflow: { work_item_id: 'work-m5', assigned_staff_id: 'staff-m5', assigned_team_id: null, fixed_assignment_id: 'assignment-m5' },
};

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockWorkbench(page: Page, observe?: { approveBody?: unknown; key?: string | null }): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/staff-auth/session') return json(route, success({ session }));
    if (url.pathname === '/api/staff/me/work-items/summary')
      return json(route, success({ summary: {
        open_count: 1, due_today_count: 0, overdue_count: 0,
        exception_order_count: 0, refund_due_today_cny_fen: null,
        recent: [],
      } }));
    if (url.pathname === '/api/staff/me/work-items') return json(route, success({ work_items: [item], next_cursor: null }));
    if (url.pathname === '/api/staff/me/work-items/work-m5') return json(route, success({ work_item: item }));
    if (url.pathname === '/api/staff/order-evidence/evidence-m5') return json(route, success({ order_evidence: evidence }));
    if (url.pathname === '/api/staff/order-evidence/evidence-m5/preflight')
      return json(route, success({ preflight: { submission_id: 'evidence-m5', amazon_order_date: '2026-08-06', ready: true, checks: [] } }));
    if (url.pathname === '/api/staff/order-evidence/evidence-m5/approve') {
      if (observe) { observe.approveBody = route.request().postDataJSON(); observe.key = route.request().headers()['idempotency-key'] ?? null; }
      return json(route, { error: { code: 'VERSION_CONFLICT', message: '已更新', details: null }, meta: { request_id: 'm5-version-conflict' } }, 409);
    }
    return json(route, { error: { code: 'NOT_FOUND', message: 'not found', details: null }, meta: { request_id: 'm5-unhandled' } }, 404);
  });
}

async function noOverflow(page: Page): Promise<void> {
  const sizes = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(sizes.content).toBeLessThanOrEqual(sizes.viewport + 1);
}

test('Staff completes queue to authoritative order detail and sees explicit conflict recovery', async ({ page }) => {
  const observed: { approveBody?: unknown; key?: string | null } = {};
  await mockWorkbench(page, observed);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/staff/work/work-m5');
  // 阶段 7 壳层重命名：旧 .staff-context-bar 由顶栏 .staff-session-context 取代，
  // 工作项页区块标题为"订单资料核对"（订单关键事实区在统一订单详情页）。
  const staffContext = page.locator('.staff-session-context');
  await expect(staffContext.getByText('售前员工', { exact: true })).toBeVisible();
  await expect(staffContext.getByText('售前', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '订单资料核对', exact: true })).toBeVisible();
  await expect(page.getByText('123-1234567-1234567')).toBeVisible();
  await expect(page.getByText('12880 JPY')).toBeVisible();
  await expect(page.getByRole('heading', { name: '内部核对' })).toBeVisible();
  await expect(page.getByText('-120 JPY')).toBeVisible();
  await page.getByLabel('已核对价格差异').check();
  await page.getByLabel('价差确认原因').fill('截图清晰显示平台折扣后的实付金额');
  await page.getByRole('button', { name: '通过', exact: true }).click();
  await expect(page.getByText(/m5-version-conflict/u)).toBeVisible();
  expect(observed.approveBody).toEqual({ expected_version: 2, price_mismatch_acknowledged: true, price_mismatch_reason: '截图清晰显示平台折扣后的实付金额' });
  expect(observed.key).toMatch(/^[0-9a-f-]{36}$/u);
  await expect(page.locator('body')).not.toContainText(/object_key|drive_file_id|password_hash/u);
  await noOverflow(page);
});

test('Staff explicit retry preserves ambiguous request authority and changed body starts a new operation', async ({ page }) => {
  const calls: Array<{ key: string | null; body: unknown }> = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/staff-auth/session') return json(route, success({ session }));
    if (url.pathname === '/api/staff/me/work-items/summary')
      return json(route, success({ summary: {
        open_count: 1, due_today_count: 0, overdue_count: 0,
        exception_order_count: 0, refund_due_today_cny_fen: null,
        recent: [],
      } }));
    if (url.pathname === '/api/staff/me/work-items') return json(route, success({ work_items: [item], next_cursor: null }));
    if (url.pathname === '/api/staff/me/work-items/work-m5') return json(route, success({ work_item: item }));
    if (url.pathname === '/api/staff/order-evidence/evidence-m5') return json(route, success({ order_evidence: evidence }));
    if (url.pathname === '/api/staff/order-evidence/evidence-m5/preflight')
      return json(route, success({ preflight: { submission_id: 'evidence-m5', amazon_order_date: '2026-08-06', ready: true, checks: [] } }));
    if (url.pathname === '/api/staff/order-evidence/evidence-m5/approve') {
      calls.push({ key: route.request().headers()['idempotency-key'] ?? null, body: route.request().postDataJSON() });
      if (calls.length === 1) return route.abort('failed');
      return json(route, { error: { code: 'VERSION_CONFLICT', message: '已更新', details: null }, meta: { request_id: `retry-deterministic-${calls.length}` } }, 409);
    }
    return json(route, { error: { code: 'NOT_FOUND', message: 'not found', details: null }, meta: { request_id: 'retry-unhandled' } }, 404);
  });
  await page.goto('/staff/work/work-m5');
  await page.getByLabel('已核对价格差异').check();
  await page.getByLabel('价差确认原因').fill('第一次提交的稳定原因');
  await page.getByRole('button', { name: '通过', exact: true }).click();
  await page.getByRole('button', { name: '重试原请求' }).click();
  await expect(page.getByText(/retry-deterministic-2/u)).toBeVisible();
  expect(calls[1]).toEqual(calls[0]);
  await page.getByLabel('价差确认原因').fill('确定性失败后修改的新原因');
  await page.getByRole('button', { name: '通过', exact: true }).click();
  await expect(page.getByText(/retry-deterministic-3/u)).toBeVisible();
  expect(calls[2]?.key).not.toBe(calls[1]?.key);
  expect(calls[2]?.body).toMatchObject({ price_mismatch_reason: '确定性失败后修改的新原因' });
});

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 720 }]) {
  test(`Staff workbench reflows at ${viewport.width}px with keyboard controls`, async ({ page }) => {
    await mockWorkbench(page); await page.setViewportSize(viewport); await page.goto('/staff');
    await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
    await page.getByRole('button', { name: '去处理', exact: true }).focus();
    await expect(page.getByRole('button', { name: '去处理', exact: true })).toBeFocused();
    await noOverflow(page);
  });
}

test('Staff workbench remains operable at 200% and with reduced motion', async ({ page }) => {
  await mockWorkbench(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 640, height: 720 });
  await page.goto('/staff');
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
  await page.getByRole('button', { name: '去处理', exact: true }).focus();
  await expect(page.getByRole('button', { name: '去处理', exact: true })).toBeFocused();
  await noOverflow(page);
});

test('capture deterministic Staff workbench desktop and narrow views', async ({ page }) => {
  await mockWorkbench(page); await page.setViewportSize({ width: 1600, height: 1000 }); await page.goto('/staff/work/work-m5');
  await expect(page.getByRole('heading', { name: '订单资料核对', exact: true })).toBeVisible();
  if (screenshotDirectory) {
    mkdirSync(screenshotDirectory, { recursive: true });
    await page.screenshot({ path: join(screenshotDirectory, 'staff-workbench-desktop-1600x1000.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(screenshotDirectory, 'staff-workbench-narrow-390x844.png'), fullPage: true });
  }
});
