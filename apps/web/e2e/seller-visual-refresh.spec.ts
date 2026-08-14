import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

test.use({
  colorScheme: 'light',
  locale: 'zh-CN',
  reducedMotion: 'reduce',
  timezoneId: 'Asia/Shanghai',
});

const screenshotDirectory = process.env['SELLER_VISUAL_SCREENSHOT_DIR'];
const fixedNow = Date.parse('2026-08-09T04:00:00.000Z');
const pageInfo = { limit: 100, next_cursor: null };
const navigationLabels = ['首页', '商品', '需求', '订单', '评论', '结算', '我的'] as const;
const primaryViewports = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;
const extendedViewports = [
  { width: 320, height: 800 },
  { width: 768, height: 1024 },
  { width: 1600, height: 1000 },
] as const;

const me = {
  account_id: 'seller-visual-account',
  member: { id: 'member-visual', display_name: '张三', role: 'OWNER', primary_owner: true },
  organization: { id: 'org-visual', seller_code: 'YG-26001', name: '月白生活株式会社', marketplace_code: 'JP', status: 'ACTIVE' },
  access: { read_scope: 'ORGANIZATION', store_ids: ['store-jp', 'store-us'], can_submit_product_applications: true, can_submit_demand_batches: true },
};

const stores = [
  { id: 'store-jp', marketplace_code: 'JP', canonical_marketplace_code: 'AMAZON_JP', transaction_currency_code: 'JPY', transaction_currency_exponent: 0, marketplace_status: 'ACTIVE', adapter_status: 'AVAILABLE', display_name: '东京一号店', status: 'ACTIVE', version: 3, created_at: fixedNow - 90_000_000, updated_at: fixedNow - 3_600_000 },
  { id: 'store-us', marketplace_code: 'JP', canonical_marketplace_code: 'AMAZON_US', transaction_currency_code: 'USD', transaction_currency_exponent: 2, marketplace_status: 'ACTIVE', adapter_status: 'AVAILABLE', display_name: '北美精品店', status: 'ACTIVE', version: 2, created_at: fixedNow - 80_000_000, updated_at: fixedNow - 7_200_000 },
] as const;

const products = [
  { id: 'product-rice', store: { id: 'store-jp', display_name: '东京一号店' }, marketplace_code: 'JP', seller_code: 'YG-26001', asin: 'B07W5DMQ3R', status: 'ACTIVE', current_version_no: 2, version: 5, created_at: fixedNow - 70_000_000, updated_at: fixedNow - 2_000_000, current_version: { id: 'version-rice', version_no: 2, product_name: '象印 IH 电饭煲 5.5 合', search_keywords: ['电饭煲', '象印'], ordering_guide_expected_amount_jpy: 22800, color_spec_mode: null, main_image: null, product_url: 'https://example.invalid/rice', buyer_visible_notes: '白色款', created_at: fixedNow - 60_000_000 } },
  { id: 'product-kettle', store: { id: 'store-us', display_name: '北美精品店' }, marketplace_code: 'JP', seller_code: 'YG-26001', asin: 'B08J7H2K5L', status: 'ACTIVE', current_version_no: 1, version: 2, created_at: fixedNow - 50_000_000, updated_at: fixedNow - 1_000_000, current_version: { id: 'version-kettle', version_no: 1, product_name: '山善电热水壶 0.8L', search_keywords: ['电热水壶'], ordering_guide_expected_amount_jpy: null, color_spec_mode: null, main_image: null, product_url: null, buyer_visible_notes: null, created_at: fixedNow - 50_000_000 } },
] as const;

const applications = [
  { id: 'application-serum', store: { id: 'store-jp', display_name: '东京一号店' }, marketplace_code: 'JP', asin: 'B00XQJG2Z4', product_name: '资生堂 HAKU 美白精华 45g', search_keywords: ['美白精华'], product_url: null, buyer_visible_notes: '请核对规格', seller_notes: null, status: 'SUBMITTED', review_reason: null, product_id: null, version: 4, submitted_at: fixedNow - 7200_000, updated_at: fixedNow - 7200_000, reviewed_at: null, withdrawn_at: null },
  { id: 'application-mask', store: { id: 'store-us', display_name: '北美精品店' }, marketplace_code: 'JP', asin: 'B00E3N4H7C', product_name: '肌美精 3D 面膜 4 枚入', search_keywords: ['面膜'], product_url: null, buyer_visible_notes: null, seller_notes: null, status: 'REJECTED', review_reason: '请补充清晰的商品主图。', product_id: null, version: 2, submitted_at: fixedNow - 172_800_000, updated_at: fixedNow - 86_400_000, reviewed_at: fixedNow - 86_400_000, withdrawn_at: null },
] as const;

const demands = [
  { id: 'demand-rice', store: { id: 'store-jp', display_name: '东京一号店' }, product: { id: 'product-rice', version_no: 2, asin: 'B07W5DMQ3R', product_name: '象印 IH 电饭煲 5.5 合', search_keywords: ['电饭煲'], product_url: null }, marketplace_code: 'JP', task_type: 'IMAGE', target_quantity: 20, held_quantity: 6, approved_quantity: 5, remaining_quantity: 14, buyer_visible_notes: '请按说明选择白色款。', seller_notes: '本月主推', open_at: fixedNow - 86_400_000, reservation_deadline: fixedNow + 3 * 86_400_000, order_deadline: fixedNow + 10 * 86_400_000, status: 'PUBLISHED', review_reason: null, close_reason: null, version: 3, submitted_at: fixedNow - 172_800_000, updated_at: fixedNow - 3_600_000, reviewed_at: fixedNow - 90_000_000, published_at: fixedNow - 86_400_000, withdrawn_at: null, closed_at: null },
  { id: 'demand-kettle', store: { id: 'store-us', display_name: '北美精品店' }, product: { id: 'product-kettle', version_no: 1, asin: 'B08J7H2K5L', product_name: '山善电热水壶 0.8L', search_keywords: ['电热水壶'], product_url: null }, marketplace_code: 'JP', task_type: 'TEXT', target_quantity: 12, held_quantity: 0, approved_quantity: 0, remaining_quantity: 12, buyer_visible_notes: null, seller_notes: null, open_at: fixedNow + 86_400_000, reservation_deadline: fixedNow + 4 * 86_400_000, order_deadline: fixedNow + 12 * 86_400_000, status: 'SUBMITTED', review_reason: null, close_reason: null, version: 1, submitted_at: fixedNow - 3_600_000, updated_at: fixedNow - 3_600_000, reviewed_at: null, published_at: null, withdrawn_at: null, closed_at: null },
] as const;

const orders = [
  { formal_order_id: 'order-rice', status: 'CONFIRMED', marketplace_code: 'JP', canonical_marketplace_code: 'AMAZON_JP', amazon_order_number: '503-1234567-1234567', platform_order_identifier: '503-1234567-1234567', store: { id: 'store-jp', display_name: '东京一号店' }, asin: 'B07W5DMQ3R', platform_product_identifier: 'B07W5DMQ3R', product_name: '象印 IH 电饭煲 5.5 合', product_version: { id: 'version-rice', version_no: 2 }, review_type: 'IMAGE', final_paid_jpy: '22800', payment: { amount_minor: '22800', currency_code: 'JPY', currency_exponent: 0 }, seller_expected_principal_cny_fen: '91200', seller_principal_rate_snapshot: { platform_order_date: '2026-08-09', payment_amount_minor: '22800', payment_currency_code: 'JPY', base_rate_version_id: 'base-rate-jp', base_rate_business_date: '2026-08-09', base_rate_confirmed_at: fixedNow - 8_000_000, base_rate_value: '3800000', base_rate_scale: '100000000', policy_version_id: 'policy-jp', policy_scope_type: 'SELLER_ORGANIZATION', policy_seller_organization_id: 'seller-org', policy_version_no: 8, policy_effective_from: fixedNow - 10_000_000, policy_confirmed_at: fixedNow - 8_000_000, markup_rate_value: '200000', markup_rate_scale: '100000000', final_rate_value: '4000000', final_rate_scale: '100000000', rounding_rule: 'HALF_UP', seller_expected_principal_amount_minor: '91200' }, locked_service_fee_snapshot: { fee_version_id: 'fee-image', version_no: 4, review_type: 'IMAGE', service_fee_cny_fen: '3200', effective_from: fixedNow - 10_000_000, confirmed_at: fixedNow - 8_000_000, marketplace_code: 'AMAZON_JP', currency_code: 'CNY', currency_exponent: 2 }, business_completion: { status: 'IN_PROGRESS', review: 'COMPLETE', buyer_refund: 'PENDING', seller_principal: 'COMPLETE', seller_service_fee: 'PENDING' }, confirmed_at: fixedNow - 7_200_000, confirmed_business_date: '2026-08-09' },
  { formal_order_id: 'order-kettle', status: 'CONFIRMED', marketplace_code: 'JP', canonical_marketplace_code: 'AMAZON_US', amazon_order_number: '113-7654321-7654321', platform_order_identifier: '113-7654321-7654321', store: { id: 'store-us', display_name: '北美精品店' }, asin: 'B08J7H2K5L', platform_product_identifier: 'B08J7H2K5L', product_name: '山善电热水壶 0.8L', product_version: { id: 'version-kettle', version_no: 1 }, review_type: 'TEXT', final_paid_jpy: '4599', payment: { amount_minor: '4599', currency_code: 'USD', currency_exponent: 2 }, seller_expected_principal_cny_fen: '33000', seller_principal_rate_snapshot: { platform_order_date: '2026-08-08', payment_amount_minor: '4599', payment_currency_code: 'USD', base_rate_version_id: 'base-rate-us', base_rate_business_date: '2026-08-08', base_rate_confirmed_at: fixedNow - 9_000_000, base_rate_value: '700000000', base_rate_scale: '100000000', policy_version_id: 'policy-us', policy_scope_type: 'SELLER_ORGANIZATION', policy_seller_organization_id: 'seller-org', policy_version_no: 2, policy_effective_from: fixedNow - 10_000_000, policy_confirmed_at: fixedNow - 9_000_000, markup_rate_value: '20000000', markup_rate_scale: '100000000', final_rate_value: '720000000', final_rate_scale: '100000000', rounding_rule: 'HALF_UP', seller_expected_principal_amount_minor: '33000' }, locked_service_fee_snapshot: { fee_version_id: 'fee-text', version_no: 3, review_type: 'TEXT', service_fee_cny_fen: '1800', effective_from: fixedNow - 10_000_000, confirmed_at: fixedNow - 9_000_000, marketplace_code: 'AMAZON_US', currency_code: 'CNY', currency_exponent: 2 }, business_completion: { status: 'COMPLETE', review: 'COMPLETE', buyer_refund: 'COMPLETE', seller_principal: 'COMPLETE', seller_service_fee: 'NOT_APPLICABLE' }, confirmed_at: fixedNow - 10_800_000, confirmed_business_date: '2026-08-08' },
] as const;

const reviews = [
  { review_case_id: 'review-rice', formal_order: { id: 'order-rice', amazon_order_number: '503-1234567-1234567' }, store: { id: 'store-jp', display_name: '东京一号店' }, marketplace_code: 'JP', asin: 'B07W5DMQ3R', product_name: '象印 IH 电饭煲 5.5 合', review_type: 'IMAGE', status: 'APPROVED', version: 3, review_url: 'https://example.invalid/review', submitted_at: fixedNow - 20_000_000, approved_at: fixedNow - 18_000_000, evidence: { version_id: 'review-evidence-rice', version_no: 2, submitted_at: fixedNow - 20_000_000, files: [{ file_entity_link_id: 'review-file-safe', file_version: 2, content_type: 'image/png', byte_size: 2048, created_at: fixedNow - 20_000_000 }] }, service_fee_accrued: { amount_cny_fen: '3200', accrued_at: fixedNow - 18_000_000 }, allowed_actions: ['VIEW', 'READ_EVIDENCE'] },
  { review_case_id: 'review-kettle', formal_order: { id: 'order-kettle', amazon_order_number: '113-7654321-7654321' }, store: { id: 'store-us', display_name: '北美精品店' }, marketplace_code: 'JP', asin: 'B08J7H2K5L', product_name: '山善电热水壶 0.8L', review_type: 'TEXT', status: 'CHANGES_REQUESTED', version: 2, review_url: null, submitted_at: fixedNow - 6_000_000, approved_at: null, evidence: { version_id: 'review-evidence-kettle', version_no: 1, submitted_at: fixedNow - 6_000_000, files: [], }, service_fee_accrued: null, allowed_actions: ['VIEW'] },
] as const;

const payables = [
  { payable_id: 'payable-principal', formal_order_id: 'order-rice', payable_type: 'SELLER_PRINCIPAL', amazon_order_number: '503-1234567-1234567', store: { id: 'store-jp', display_name: '东京一号店' }, product: { id: 'product-rice', asin: 'B07W5DMQ3R', name: '象印 IH 电饭煲 5.5 合' }, due_amount_cny_fen: '91200', paid_amount_cny_fen: '61200', outstanding_amount_cny_fen: '30000', status: 'PARTIALLY_PAID', due_at: fixedNow + 86_400_000, created_at: fixedNow - 7_200_000 },
  { payable_id: 'payable-fee', formal_order_id: 'order-rice', payable_type: 'SELLER_SERVICE_FEE', amazon_order_number: '503-1234567-1234567', store: { id: 'store-jp', display_name: '东京一号店' }, product: { id: 'product-rice', asin: 'B07W5DMQ3R', name: '象印 IH 电饭煲 5.5 合' }, due_amount_cny_fen: '3200', paid_amount_cny_fen: '0', outstanding_amount_cny_fen: '3200', status: 'UNPAID', due_at: fixedNow + 172_800_000, created_at: fixedNow - 7_200_000 },
] as const;

function success(data: unknown) { return { data, meta: { request_id: 'seller-visual-refresh' } }; }

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installSellerFixture(page: Page, access = me.access): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/customer-auth/session') {
      await json(route, success({ session: { account_id: me.account_id, identity_subject_id: 'seller-visual-subject', account_type: 'SELLER_MEMBER', session_version: 1, password_change_required: false, issued_at: fixedNow - 60_000, expires_at: fixedNow + 3_600_000 } })); return;
    }
    if (path === '/api/seller-portal/me') { await json(route, success({ me: { ...me, access } })); return; }
    if (path === '/api/seller-portal/stores') { await json(route, success({ items: stores, page: pageInfo })); return; }
    if (path === '/api/seller-portal/products') { await json(route, success({ items: products, page: pageInfo })); return; }
    if (path === '/api/seller-portal/product-applications') { await json(route, success({ items: applications, page: pageInfo })); return; }
    if (path === '/api/seller-portal/product-applications/application-serum') { await json(route, success({ application: applications[0] })); return; }
    if (path === '/api/seller-portal/demand-batches') { await json(route, success({ items: demands, page: pageInfo })); return; }
    if (path === '/api/seller-portal/formal-orders') { await json(route, success({ items: orders, page: pageInfo })); return; }
    if (path === '/api/seller-portal/reviews') { await json(route, success({ items: reviews, page: pageInfo })); return; }
    if (path === '/api/seller-portal/settlement/summary') { await json(route, success({ settlement: { outstanding_principal_cny_fen: '30000', outstanding_service_fee_cny_fen: '3200', total_outstanding_cny_fen: '33200', unallocated_credit_cny_fen: '1200' } })); return; }
    if (path === '/api/seller-portal/settlement/payables') { await json(route, success({ items: payables, page: pageInfo })); return; }
    await json(route, { error: { code: 'NOT_FOUND', message: 'not found', details: null }, meta: { request_id: 'seller-visual-not-found' } }, 404);
  });
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const size = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
}

async function capture(page: Page, name: string): Promise<void> {
  if (!screenshotDirectory) return;
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: join(screenshotDirectory, name), animations: 'disabled', caret: 'hide', fullPage: true });
}

const surfaces = [
  ['dashboard', '/seller', '业务进度'],
  ['products', '/seller/products', '商品与申请'],
  ['application-form', '/seller/products/new', '提交产品申请'],
  ['application-detail', '/seller/products/application-serum', '产品申请'],
  ['demands', '/seller/demands', '需求批次'],
  ['demand-form', '/seller/demands/new', '提交需求'],
  ['orders', '/seller/orders', '订单与业务完成'],
  ['reviews', '/seller/reviews', '评论'],
  ['settlements', '/seller/settlements', '本金与服务费'],
  ['account', '/seller/settings', '账户与团队'],
] as const;

test('Seller visual refresh captures deterministic before and after matrix', async ({ page }) => {
  test.setTimeout(120_000);
  await installSellerFixture(page);
  for (const viewport of primaryViewports) {
    await page.setViewportSize(viewport);
    await page.goto('/seller/login');
    await expect(page.getByText('月光白', { exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    await capture(page, `seller-login-${viewport.width}x${viewport.height}.png`);
    for (const [name, path, heading] of surfaces) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await noHorizontalOverflow(page);
      await capture(page, `seller-${name}-${viewport.width}x${viewport.height}.png`);
    }
    await page.goto('/seller/change-password');
    await expect(page.getByRole('heading', { name: '修改密码' })).toBeVisible();
    await noHorizontalOverflow(page);
    await capture(page, `seller-change-password-${viewport.width}x${viewport.height}.png`);
  }
  for (const viewport of extendedViewports) {
    await page.setViewportSize(viewport);
    for (const [name, path, heading] of surfaces.filter(([name]) => ['dashboard', 'products', 'demand-form', 'orders', 'settlements'].includes(name))) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await noHorizontalOverflow(page);
      await capture(page, `seller-${name}-${viewport.width}x${viewport.height}.png`);
    }
  }
});

test('Seller shell keeps context, navigation, entries, and disclosure boundaries', async ({ page }) => {
  await installSellerFixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/seller');
  await expect(page.getByText(me.organization.name, { exact: true })).toBeVisible();
  await expect(page.getByText(me.organization.seller_code, { exact: true })).toBeVisible();
  await expect(page.getByLabel('组织和店铺').getByText(me.member.display_name, { exact: true })).toBeVisible();
  await expect(page.getByLabel('店铺', { exact: true })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: '卖家导航' });
  for (const label of navigationLabels) await expect(navigation.getByRole('link', { name: label, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '提交需求', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '提交产品申请', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/卖家工作台|卖家首页|韩国站能力|状态来自服务器业务事实|结算确认由员工控制|Buyer Refund|内部利润|object_key|drive_file_id/u);

  const requestPaths: string[] = [];
  page.on('request', (request) => requestPaths.push(new URL(request.url()).pathname));
  await page.goto('/seller/reviews');
  await expect(page.getByText('象印 IH 电饭煲 5.5 合', { exact: true })).toBeVisible();
  expect(requestPaths.some((path) => path.includes('/file-read-intents'))).toBe(false);
});

test('Seller permission-projected entries disappear without access', async ({ page }) => {
  await installSellerFixture(page, { ...me.access, can_submit_product_applications: false, can_submit_demand_batches: false });
  await page.goto('/seller');
  await expect(page.getByRole('link', { name: '提交需求' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '提交产品申请' })).toHaveCount(0);
  await page.goto('/seller/products/new');
  await expect(page.getByText('当前账号没有提交产品申请的权限。')).toBeVisible();
  await page.goto('/seller/demands/new');
  await expect(page.getByText('当前账号没有提交需求的权限。')).toBeVisible();
});

test('Seller pages preserve keyboard, zoom, reduced motion, targets, and overflow', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installSellerFixture(page);
  for (const viewport of [...extendedViewports, ...primaryViewports]) {
    await page.setViewportSize(viewport);
    await page.goto('/seller');
    await noHorizontalOverflow(page);
    const targets = await page.locator('a, button, select, input').evaluateAll((elements) => elements.filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }).map((element) => { const box = element.getBoundingClientRect(); return { width: box.width, height: box.height }; }));
    for (const target of targets) {
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/seller/demands/new');
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await noHorizontalOverflow(page);
  await page.getByLabel('已通过产品').focus();
  await expect(page.getByLabel('已通过产品')).toBeFocused();
  const focus = await page.getByLabel('已通过产品').evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(focus).not.toBe('none');
});

test('Seller login remains minimal and forced password stays recoverable', async ({ page }) => {
  await page.goto('/seller/login');
  await expect(page.getByText('月光白', { exact: true })).toHaveCount(1);
  await expect(page.getByLabel('账号')).toBeVisible();
  await expect(page.getByLabel('密码')).toBeVisible();
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible();
  await expect(page.locator('select')).toHaveCount(0);
  await expect(page.getByRole('link')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/卖家工作区|卖家登录|进入身份|买家登录|员工登录/u);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('账号')).toBeFocused();

  await installSellerFixture(page);
  await page.goto('/seller/change-password');
  for (const label of ['当前密码', '新密码', '确认新密码']) await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '修改密码' })).toBeVisible();
  await expect(page.getByRole('button', { name: '取消本次操作' })).toBeVisible();
});

test('Seller route remains isolated on a cold load', async ({ page }) => {
  const scripts = new Set<string>();
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.endsWith('.js')) scripts.add(path.split('/').at(-1) ?? path);
  });
  await installSellerFixture(page);
  await page.goto('/seller/orders');
  await expect(page.getByRole('heading', { name: '订单与业务完成' })).toBeVisible();
  expect([...scripts].some((name) => /BuyerRouteModule|BuyerOrderRouteModule|BuyerAfterSalesRouteModule|StaffRouteModule/u.test(name))).toBe(false);
});
