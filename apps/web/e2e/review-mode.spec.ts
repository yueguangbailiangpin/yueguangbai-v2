import { expect, test, type Page } from '@playwright/test';

test.use({
  colorScheme: 'light',
  locale: 'zh-CN',
  reducedMotion: 'reduce',
  timezoneId: 'Asia/Shanghai',
});

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const size = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
}

test('review entry and all three portals render without real API requests', async ({ page }) => {
  const apiRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) apiRequests.push(path);
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/review');
  await expect(page.getByRole('heading', { name: '月光白 V2 · 前端评审环境' })).toBeVisible();
  await expect(page.getByRole('link', { name: /买家端/u })).toBeVisible();
  await expect(page.getByRole('link', { name: /卖家端/u })).toBeVisible();
  await expect(page.getByRole('link', { name: /员工端/u })).toBeVisible();

  await page.goto('/review/buyer');
  await expect(page.getByText('前端评审 · Demo 数据', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '当前开放产品' })).toBeVisible();

  await page.goto('/review/seller');
  await expect(page.getByLabel('卖家评审角色')).toBeVisible();
  await expect(page.getByRole('heading', { name: '业务进度', exact: true })).toBeVisible();

  await page.goto('/review/staff');
  await expect(page.getByLabel('员工评审角色')).toBeVisible();
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
  await expect(page.getByRole('button', { name: /商品申请审核/u })).toBeVisible();

  expect(apiRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('review role selectors update visible seller and staff permissions', async ({ page }) => {
  await page.goto('/review/seller');
  await expect(page.getByRole('link', { name: '提交产品申请', exact: true })).toBeVisible();
  await page.getByLabel('卖家评审角色').selectOption('FINANCE');
  await expect(page.getByText('Demo FINANCE', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: '提交产品申请', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '结算', exact: true })).toBeVisible();
  await page.getByLabel('卖家评审角色').selectOption('VIEWER');
  await expect(page.getByText('Demo VIEWER', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: '提交产品申请', exact: true })).toHaveCount(0);

  await page.goto('/review/staff');
  const navigation = page.getByRole('navigation', { name: '员工工作台导航' });
  const roles = [
    ['owner', ['工作台', '获客', '卖家', '产品与投放', '买家与订单', '财务配置', '员工与访问管理', '经营看板', '运行完整性工具']],
    ['acquisition', ['获客']],
    ['pre_sales', ['工作台', '买家与订单', '产品与投放', '运行完整性工具']],
    ['seller_ops', ['工作台', '卖家', '产品与投放', '财务配置', '运行完整性工具']],
    ['buyer_refund', ['工作台', '运行完整性工具']],
  ] as const;
  for (const [role, expected] of roles) {
    await page.getByLabel('员工评审角色').selectOption(role);
    for (const name of expected) await expect(navigation.getByRole('link', { name, exact: true })).toBeVisible();
    await expect(navigation.getByRole('link')).toHaveCount(expected.length);
  }
  await expect(page.getByRole('button', { name: /买家返款/u })).toBeVisible();
});

test('review mutations stay inside browser demo state', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) apiRequests.push(`${request.method()} ${path}`);
  });

  await page.goto('/review/buyer/demands/review-buyer-demand-003');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '确认并预约' }).click();
  await expect(page).toHaveURL(/\/review\/buyer\/reservations\/review-buyer-reservation-/u);

  await page.goto('/review/seller/products');
  await page.getByRole('button', { name: '撤回申请', exact: true }).first().click();
  await page.getByRole('button', { name: '确认撤回', exact: true }).click();
  await expect(page.getByText('已撤回', { exact: true }).first()).toBeVisible();

  expect(apiRequests).toEqual([]);
});

test('review pages fit the required viewport matrix', async ({ page }) => {
  const viewports = [
    { width: 320, height: 800 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 1024, height: 1366 },
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1600, height: 1000 },
    { width: 1920, height: 1080 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const path of ['/review', '/review/buyer', '/review/seller', '/review/staff']) {
      await page.goto(path);
      await expect(page.getByText('前端评审 · Demo 数据', { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  }
});

test('review detail surfaces keep their real layouts and valid demo contracts', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const surfaces = [
    '/review/buyer/products',
    '/review/buyer/tasks',
    '/review/buyer/demands/review-buyer-demand-003',
    '/review/buyer/reservations',
    '/review/buyer/reservations/review-buyer-reservation-002/instruction',
    '/review/buyer/order-materials',
    '/review/buyer/order-materials/review-buyer-evidence-002',
    '/review/buyer/orders',
    '/review/buyer/orders/review-buyer-order-001',
    '/review/buyer/reviews',
    '/review/buyer/reviews/review-buyer-review-002',
    '/review/buyer/refunds',
    '/review/buyer/refunds/review-buyer-refund-002',
    '/review/buyer/me',
    '/review/seller/products',
    '/review/seller/products/review-app-1',
    '/review/seller/demands',
    '/review/seller/orders',
    '/review/seller/reviews',
    '/review/seller/settlements',
    '/review/seller/settings',
    '/review/staff/acquisition',
    '/review/staff/buyer-customers',
    '/review/staff/seller-customers',
    '/review/staff/products',
    '/review/staff/products/review-product-1',
    '/review/staff/admin-business-dashboard',
    '/review/staff/seller-principal-rate-policies',
    '/review/staff/access-management',
  ];
  for (const path of surfaces) {
    await page.goto(path);
    await expect(page.getByText('前端评审 · Demo 数据', { exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/暂时无法加载|暂时无法读取|服务暂时不可用/u);
  }
  expect(pageErrors).toEqual([]);
});
