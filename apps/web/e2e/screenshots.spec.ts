import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const directory = process.env['WAVE14A_SCREENSHOT_DIR'];

test('production build renders frozen visual foundation states', async ({ page }) => {
  let identity: 'buyer' | 'seller' | 'staff' = 'buyer';
  await page.route('**/api/**', async (route) => {
    const session = identity === 'staff'
      ? { staff_id: 'staff-local', display_name: '本地员工', roles: [], permissions: [], data_scope: {}, authorization_version: 1, session_version: 1, expires_at: 9_999_999_999_999 }
      : { account_id: `${identity}-local`, identity_subject_id: 'subject-local', account_type: identity === 'buyer' ? 'BUYER' : 'SELLER_MEMBER', session_version: 1, password_change_required: false, issued_at: 1, expires_at: 9_999_999_999_999 };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { session }, meta: { request_id: 'screenshot-local' } }) });
  });
  const capture = async (name: string): Promise<void> => { if (directory) { mkdirSync(directory, { recursive: true }); await page.screenshot({ path: join(directory, name), fullPage: true }); } };
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/'); await expect(page.getByRole('heading', { name: '月光白' })).toBeVisible(); await capture('root-desktop-1440x900.png');
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/buyer/login'); await capture('buyer-login-mobile-390x844.png');
  identity = 'buyer'; await page.goto('/buyer'); await capture('buyer-shell-mobile-390x844.png');
  identity = 'seller'; await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/seller'); await capture('seller-shell-desktop-1440x900.png');
  identity = 'staff'; await page.setViewportSize({ width: 1600, height: 1000 }); await page.goto('/staff'); await capture('staff-shell-desktop-1600x1000.png');
  await page.setViewportSize({ width: 768, height: 1024 }); await page.goto('/staff'); await capture('staff-shell-narrow-768x1024.png');
});
