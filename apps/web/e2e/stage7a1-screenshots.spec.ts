import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const directory = process.env['STAGE7A1_SCREENSHOT_DIR'] ?? join(process.cwd(), 'tmp', 'stage7a1-screenshots');

function ownerSession() {
  return {
    staff_id: 'stage7a1-owner',
    display_name: '白月光',
    role: { code: 'owner', display_name: '总管理员' },
    permissions: ['STAFF_MANAGE', 'FINANCIAL_VIEW', 'SELLER_MANAGE', 'FINANCIAL_CORRECT'],
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

async function mockStaffSession(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/access/bootstrap')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: { session: ownerSession(), access_email: 'owner@example.com' },
          meta: { request_id: 'stage7a1-screenshot' },
        }),
      });
      return;
    }
    if (path.endsWith('/session')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: { session: ownerSession() },
          meta: { request_id: 'stage7a1-screenshot' },
        }),
      });
      return;
    }
    if (path.endsWith('/api/staff/me/work-items')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: { work_items: [], next_cursor: null },
          meta: { request_id: 'stage7a1-screenshot' },
        }),
      });
      return;
    }
    if (path.endsWith('/api/staff/search')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: { query: '', buyers: [], products: [], orders: [], demands: [] },
          meta: { request_id: 'stage7a1-screenshot' },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'not found', details: null }, meta: { request_id: 'stage7a1-404' } }),
    });
  });
}

async function capture(page: Page, name: string, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: join(directory, name), fullPage: false });
}

test.use({ colorScheme: 'light', locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });

test('staff shell after - 1440px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockStaffSession(page);
  await page.goto('/staff');
  await expect(page.getByRole('navigation', { name: '员工工作台主导航' })).toBeVisible();
  await page.waitForTimeout(500);
  await capture(page, 'staff-shell-after-1440x900.png', 1440, 900);
});

test('staff shell after - 1280px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockStaffSession(page);
  await page.goto('/staff');
  await expect(page.getByRole('navigation', { name: '员工工作台主导航' })).toBeVisible();
  await page.waitForTimeout(500);
  await capture(page, 'staff-shell-after-1280x800.png', 1280, 800);
});

test('staff shell after - 390px mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStaffSession(page);
  await page.goto('/staff');
  await expect(page.getByLabel('打开导航菜单')).toBeVisible();
  await page.waitForTimeout(500);
  await capture(page, 'staff-shell-after-390x844.png', 390, 844);
});

test('staff shell after - 390px mobile drawer open', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStaffSession(page);
  await page.goto('/staff');
  await expect(page.getByLabel('打开导航菜单')).toBeVisible();
  await page.getByLabel('打开导航菜单').click();
  await expect(page.getByRole('dialog', { name: '员工导航菜单' })).toBeVisible();
  await page.waitForTimeout(500);
  await capture(page, 'staff-shell-after-390x844-drawer.png', 390, 844);
});

test('staff shell after - finance page 1440px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockStaffSession(page);
  await page.goto('/staff/finance');
  await expect(page.getByRole('navigation', { name: '员工工作台主导航' })).toBeVisible();
  await page.waitForTimeout(500);
  await capture(page, 'staff-finance-after-1440x900.png', 1440, 900);
});
