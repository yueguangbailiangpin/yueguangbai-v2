import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const screenshotDirectory = resolve(process.cwd(), 'tmp/stage7f2-staff-core-pages-visual');

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

async function assertNoBrokenStates(page: Page): Promise<void> {
  await expect(page.locator('body')).not.toContainText(
    /服务暂时不可用|MALFORMED_RESPONSE|读取失败|当前面板加载失败|公共池|抢任务|获客中心|规划中/u,
  );
  await assertNoHorizontalOverflow(page);
}

async function assertDecodedImages(page: Page): Promise<void> {
  await expect.poll(async () => page.locator('img').evaluateAll((images) =>
    images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0),
  )).toBe(true);
}

test('员工端订单列表、订单详情与财务工作区视觉样板', async ({ page }) => {
  mkdirSync(screenshotDirectory, { recursive: true });
  const apiRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) apiRequests.push(`${request.method()} ${path}`);
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/review/staff');
  await expect(page.getByLabel('员工评审角色')).toBeVisible();
  await page.getByLabel('员工评审角色').selectOption('owner');

  await page.goto('/review/staff/orders');
  await expect(page.getByRole('columnheader', { name: '买家编号' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '状态 / 异常' })).toBeVisible();
  await expect(page.getByText('503-7770001-0003001').first()).toBeVisible();
  await expect(page.getByText('共 5 条')).toBeVisible();
  await assertNoBrokenStates(page);
  await page.screenshot({
    path: resolve(screenshotDirectory, 'staff-orders-owner-1440x900.png'),
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/review/staff/orders');
  await expect(page.locator('.sp-order-mobile-list').getByText('503-7770001-0003001')).toBeVisible();
  await expect(page.locator('.sp-order-mobile-list')).toBeVisible();
  await assertNoBrokenStates(page);
  await page.screenshot({
    path: resolve(screenshotDirectory, 'staff-orders-owner-390x844.png'),
  });

  const filterButton = page.getByRole('button', { name: /^筛选/u });
  await filterButton.focus();
  await filterButton.click();
  const filterDrawer = page.getByRole('dialog', { name: '订单筛选' });
  await expect(filterDrawer).toBeVisible();
  await expect(page.getByLabel('关闭筛选')).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: resolve(screenshotDirectory, 'staff-orders-owner-filter-drawer-390x844.png'),
  });
  await page.keyboard.press('Escape');
  await expect(filterDrawer).toHaveCount(0);
  await expect(filterButton).toBeFocused();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/review/staff/orders/review-seller-order-1');
  await expect(page.getByRole('region', { name: '订单身份摘要' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '业务参与方' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '订单进度' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '订单付款截图' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /订单沟通截图/u })).toBeVisible();
  await expect(page.getByRole('heading', { name: '计价明细' })).toBeVisible();
  await assertDecodedImages(page);
  await assertNoBrokenStates(page);
  await page.screenshot({
    path: resolve(screenshotDirectory, 'staff-order-detail-owner-1440x900.png'),
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/review/staff/orders/review-seller-order-1');
  await expect(page.getByRole('heading', { name: '业务参与方' })).toBeVisible();
  await expect(page.locator('.sp-order-detail-page')).toBeVisible();
  await assertNoBrokenStates(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/review/staff/finance');
  await expect(page.getByRole('heading', { name: '结算概览' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '应付明细' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '付款进度' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '结算批次' })).toBeVisible();
  await expect(page.getByText('¥6,339.00')).toBeVisible();
  await expect(page.locator('text=正在读取')).toHaveCount(0);
  await assertNoBrokenStates(page);
  await page.screenshot({
    path: resolve(screenshotDirectory, 'staff-finance-owner-1440x900.png'),
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/review/staff/finance');
  await expect(page.getByRole('heading', { name: '结算概览' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '付款进度' })).toBeVisible();
  await expect(page.locator('text=正在读取')).toHaveCount(0);
  await assertNoBrokenStates(page);
  await page.screenshot({
    path: resolve(screenshotDirectory, 'staff-finance-owner-390x844.png'),
  });

  // Permission isolation: a pre-sales session can still use the staff shell,
  // but does not receive the finance ledger surface.
  await page.goto('/review/staff/finance');
  await page.getByLabel('员工评审角色').selectOption('pre_sales');
  await page.goBack();
  await expect(page).toHaveURL(/\/review\/staff\/finance/u);
  await expect(page.getByRole('alert')).toContainText('当前员工没有此权限');
  await expect(page.getByRole('heading', { name: '结算概览' })).toHaveCount(0);

  expect(apiRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
