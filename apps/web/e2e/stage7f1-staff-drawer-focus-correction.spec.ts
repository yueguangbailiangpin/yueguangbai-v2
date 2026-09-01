import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const screenshotDirectory = resolve(process.cwd(), 'tmp/stage7f1-staff-navigation-correction');
const screenshotPath = resolve(screenshotDirectory, 'staff-navigation-owner-drawer-390x844.png');

test.use({
  colorScheme: 'light',
  locale: 'zh-CN',
  reducedMotion: 'reduce',
  timezoneId: 'Asia/Shanghai',
});

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test('员工端手机 Drawer 关闭按钮保持轻量焦点指示', async ({ page }) => {
  mkdirSync(screenshotDirectory, { recursive: true });
  const apiRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) apiRequests.push(`${request.method()} ${path}`);
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/review/staff');
  await expect(page.getByRole('heading', { name: '建议先处理' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByText(/服务暂时不可用|MALFORMED_RESPONSE|公共池|抢任务|获客中心|规划中/u),
  ).toHaveCount(0);

  const menuButton = page.getByLabel('打开导航菜单');
  await menuButton.focus();
  await menuButton.click();
  const drawer = page.getByRole('dialog', { name: '员工导航菜单' });
  await expect(drawer).toBeVisible();
  const closeButton = page.getByLabel('关闭导航菜单');
  await expect(closeButton).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');

  const focusStyles = await closeButton.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      width: style.width,
      height: style.height,
      background: style.backgroundColor,
      borderWidth: style.borderWidth,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
    };
  });
  expect(focusStyles).toEqual({
    width: '36px',
    height: '36px',
    background: 'rgba(0, 0, 0, 0)',
    borderWidth: '0px',
    outlineWidth: '1px',
    boxShadow: 'none',
  });
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: screenshotPath });

  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(menuButton).toBeFocused();
  expect(apiRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
