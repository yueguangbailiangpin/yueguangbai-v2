import { expect, test, type Page } from '@playwright/test';

async function mockSession(page: Page, identity: 'buyer' | 'seller' | 'staff'): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const session = identity === 'staff'
      ? { staff_id: 'staff-local', display_name: '本地员工', roles: [], permissions: [], data_scope: { type: 'GLOBAL', buyerCustomerIds: [], sellerOrganizationIds: [], teamIds: [] }, authorization_version: 1, session_version: 1, expires_at: 9_999_999_999_999 }
      : { account_id: `${identity}-local`, identity_subject_id: 'subject-local', account_type: identity === 'buyer' ? 'BUYER' : 'SELLER_MEMBER', session_version: 1, password_change_required: false, issued_at: 1, expires_at: 9_999_999_999_999 };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { session }, meta: { request_id: 'browser-local' } }) });
  });
}

test('public entry and login routes are Chinese identity boundaries', async ({ page }) => { await page.goto('/'); await expect(page.getByRole('heading', { name: '月光白' })).toBeVisible(); await expect(page.getByRole('link')).toHaveCount(0); await page.goto('/buyer/login'); await expect(page.getByRole('heading', { name: '买家登录' })).toBeVisible(); await page.goto('/seller/login'); await expect(page.getByRole('heading', { name: '卖家登录' })).toBeVisible(); await page.goto('/staff/login'); await expect(page.getByRole('heading', { name: '员工登录' })).toBeVisible(); });
test('protected shells render from deterministic local sessions', async ({ page }) => { await mockSession(page, 'buyer'); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/buyer'); await expect(page.getByRole('navigation', { name: '买家导航' })).toBeVisible(); await expect(page.getByText('订单资料')).toBeVisible(); await mockSession(page, 'seller'); await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/seller'); await page.getByRole('button', { name: '查看详情结构' }).click(); await expect(page.getByRole('dialog', { name: '详情结构' })).toBeVisible(); await page.keyboard.press('Escape'); await mockSession(page, 'staff'); await page.goto('/staff'); await expect(page.getByRole('heading', { name: '待处理队列' })).toBeVisible(); });
test('guards and not found pages avoid protected content', async ({ page }) => { await page.route('**/api/customer-auth/session', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: '请先登录', details: null }, meta: { request_id: 'guard-local' } }) })); await page.goto('/buyer/unknown'); await expect(page.getByRole('heading', { name: '买家登录' })).toBeVisible(); await page.goto('/not-a-route'); await expect(page.getByRole('heading', { name: '页面未找到' })).toBeVisible(); });
