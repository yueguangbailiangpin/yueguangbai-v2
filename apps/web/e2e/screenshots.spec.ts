import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const directory = process.env['WAVE14A_SCREENSHOT_DIR'];

function customerSession(identity: 'buyer' | 'seller') {
  return {
    account_id: `${identity}-screenshot`,
    identity_subject_id: 'screenshot-subject',
    account_type: identity === 'buyer' ? 'BUYER' : 'SELLER_MEMBER',
    session_version: 1,
    password_change_required: false,
    issued_at: 1,
    expires_at: 9_999_999_999_999,
  };
}

function staffSession() {
  return {
    staff_id: 'staff-screenshot',
    display_name: '本地员工',
    role: { code: 'pre_sales', display_name: '售前' },
    permissions: [],
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

async function mockSession(page: Page, identity: 'buyer' | 'seller' | 'staff'): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const session = identity === 'staff' ? staffSession() : customerSession(identity);
    if (path.endsWith('/session')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: { session },
          meta: { request_id: 'screenshot-local' },
        }),
      });
      return;
    }
    if (identity === 'seller' && path === '/api/seller-portal/me') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            me: {
              account_id: 'seller-screenshot',
              member: {
                id: 'member-shot',
                display_name: '演示卖家',
                role: 'OWNER',
                primary_owner: true,
              },
              organization: {
                id: 'org-shot',
                seller_code: 'seller-shot',
                name: '演示卖家组织',
                marketplace_code: 'AMAZON_JP',
                status: 'ACTIVE',
              },
              access: {
                read_scope: 'ORGANIZATION',
                store_ids: ['store-shot'],
                can_submit_product_applications: true,
                can_submit_demand_batches: true,
              },
            },
          },
          meta: { request_id: 'screenshot-local' },
        }),
      });
      return;
    }
    if (identity === 'seller' && path === '/api/seller-portal/stores') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            items: [
              {
                id: 'store-shot',
                marketplace_code: 'AMAZON_JP',
                canonical_marketplace_code: 'AMAZON_JP',
                transaction_currency_code: 'JPY',
                transaction_currency_exponent: 0,
                marketplace_status: 'ACTIVE',
                adapter_status: 'AVAILABLE',
                display_name: '日本演示店',
                status: 'ACTIVE',
                version: 1,
                created_at: 1,
                updated_at: 1,
              },
            ],
            page: { limit: 100, next_cursor: null },
          },
          meta: { request_id: 'screenshot-local' },
        }),
      });
      return;
    }
    if (identity === 'seller' && path === '/api/seller-portal/formal-orders') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: { items: [], page: { limit: 100, next_cursor: null } },
          meta: { request_id: 'screenshot-local' },
        }),
      });
      return;
    }
    if (identity === 'seller' && path === '/api/seller-portal/settlement/summary') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            settlement: {
              outstanding_principal_cny_fen: '0',
              outstanding_service_fee_cny_fen: '0',
              total_outstanding_cny_fen: '0',
              unallocated_credit_cny_fen: '0',
            },
          },
          meta: { request_id: 'screenshot-local' },
        }),
      });
      return;
    }
          if (identity === 'staff' && path === '/api/staff/me/work-items/summary') {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { summary: {
          open_count: 0, due_today_count: 0, overdue_count: 0,
          exception_order_count: 0, refund_due_today_cny_fen: null,
          recent: [],
        } }, meta: { request_id: 'summary' } }) });
      }
if (identity === 'staff' && path === '/api/staff/me/work-items') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: { work_items: [], next_cursor: null },
          meta: { request_id: 'screenshot-local' },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'NOT_FOUND', message: 'not found', details: null },
        meta: { request_id: 'screenshot-not-found' },
      }),
    });
  });
}

async function capture(
  page: Page,
  name: string,
  viewport: Readonly<{ width: number; height: number }>,
): Promise<void> {
  await page.setViewportSize(viewport);
  if (directory) {
    mkdirSync(directory, { recursive: true });
    await page.screenshot({ path: join(directory, name), fullPage: false });
  }
}

test('capture root desktop', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '月光白' })).toBeVisible();
  await capture(page, 'root-desktop-1440x900.png', { width: 1440, height: 900 });
});

test('capture Buyer login mobile', async ({ page }) => {
  await page.goto('/buyer/login');
  await expect(page.getByText('月光白')).toBeVisible();
  await capture(page, 'buyer-login-mobile-390x844.png', { width: 390, height: 844 });
});

test('capture Seller login desktop', async ({ page }) => {
  await page.goto('/seller/login');
  await expect(page.getByText('月光白')).toBeVisible();
  await capture(page, 'seller-login-desktop-1440x900.png', { width: 1440, height: 900 });
});

test('capture Staff login desktop', async ({ page }) => {
  await page.goto('/staff/login');
  await expect(page.getByRole('heading', { name: '员工登录' })).toBeVisible();
  await capture(page, 'staff-login-desktop-1440x900.png', { width: 1440, height: 900 });
});

test('capture Buyer password change mobile', async ({ page }) => {
  await mockSession(page, 'buyer');
  await page.goto('/buyer/change-password');
  await expect(page.getByRole('heading', { name: '修改密码' })).toBeVisible();
  await capture(page, 'buyer-change-password-mobile-390x844.png', { width: 390, height: 844 });
});

test('capture Buyer shell mobile', async ({ page }) => {
  await mockSession(page, 'buyer');
  await page.goto('/buyer');
  await expect(page.getByRole('navigation', { name: '买家导航' })).toBeVisible();
  await capture(page, 'buyer-shell-mobile-390x844.png', { width: 390, height: 844 });
});

test('capture Seller shell desktop', async ({ page }) => {
  await mockSession(page, 'seller');
  await page.goto('/seller');
  await expect(page.getByRole('heading', { name: '业务进度', exact: true })).toBeVisible();
  await capture(page, 'seller-shell-desktop-1440x900.png', { width: 1440, height: 900 });
});

test('capture Seller orders desktop', async ({ page }) => {
  await mockSession(page, 'seller');
  await page.goto('/seller');
  await page.getByRole('link', { name: '订单', exact: true }).click();
  await expect(page.getByRole('heading', { name: '订单与业务完成' })).toBeVisible();
  await capture(page, 'seller-orders-desktop-1440x900.png', { width: 1440, height: 900 });
});

test('capture Staff shell desktop', async ({ page }) => {
  await mockSession(page, 'staff');
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
  await capture(page, 'staff-shell-desktop-1600x1000.png', { width: 1600, height: 1000 });
});

test('capture Staff shell narrow', async ({ page }) => {
  await mockSession(page, 'staff');
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
  await capture(page, 'staff-shell-narrow-768x1024.png', { width: 768, height: 1024 });
});

test('capture dependency error mobile', async ({ page }) => {
  await page.goto('/dependency-error');
  await expect(page.getByRole('heading', { name: '服务暂时不可用' })).toBeVisible();
  await capture(page, 'dependency-error-mobile-390x844.png', { width: 390, height: 844 });
});

test('capture permission denied desktop', async ({ page }) => {
  await page.goto('/forbidden');
  await expect(page.getByRole('heading', { name: '无权访问' })).toBeVisible();
  await capture(page, 'permission-denied-desktop-1440x900.png', { width: 1440, height: 900 });
});
