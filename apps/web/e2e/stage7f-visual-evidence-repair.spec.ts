import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Stage 7F visual evidence: the frozen Staff matrix plus the four Review
 * recovery entry points. Review mode uses the real production page components
 * and its in-browser strict demo adapter; no API request is expected here.
 */

const screenshotDirectory = resolve(
  process.cwd(),
  process.env['STAGE7F_VISUAL_EVIDENCE_DIR'] ?? 'tmp/stage7f-visual-evidence-repair',
);

const forbiddenState =
  /MALFORMED_RESPONSE|服务暂时不可用|当前面板加载失败|暂时无法加载|暂时无法读取|读取失败|加载失败|正在加载|正在读取|加载中|读取中/u;
const retiredNavigation = /规划中|公共池|抢任务|获客中心/u;

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

async function assertDecodedImages(page: Page, required = false): Promise<void> {
  const images = page.locator('img');
  if (required) {
    await expect
      .poll(
        async () => (await images.count()) + (await page.getByText('截图加载中', { exact: true }).count()),
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
    const placeholders = page.getByText('截图加载中', { exact: true });
    for (let index = 0; index < await placeholders.count(); index += 1) {
      await placeholders.nth(index).scrollIntoViewIfNeeded();
    }
    await expect.poll(() => images.count(), { timeout: 10_000 }).toBeGreaterThan(0);
  }
  const count = await images.count();
  if (count === 0) return;
  for (let index = 0; index < count; index += 1) {
    await images.nth(index).scrollIntoViewIfNeeded();
  }
  await expect
    .poll(
      () =>
        images.evaluateAll((nodes) =>
          nodes.every((image) => image.complete && image.naturalWidth > 0),
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
}

async function assertNormalState(page: Page, key: string | RegExp): Promise<void> {
  await expect(page.getByText('前端评审 · Demo 数据', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: key }).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText(forbiddenState);
  await expect(page.locator('body')).not.toContainText(retiredNavigation);
  await expect(page.getByRole('alert').filter({ hasText: forbiddenState })).toHaveCount(0);
  await assertDecodedImages(page);
  await assertNoHorizontalOverflow(page);
}

async function capture(page: Page, name: string): Promise<void> {
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: resolve(screenshotDirectory, name),
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
  });
}

async function setOwner(page: Page): Promise<void> {
  await page.goto('/review/staff');
  const role = page.getByLabel('员工评审角色');
  await expect(role).toBeVisible();
  await role.selectOption('owner');
  await expect(page.getByText('审核卖家产品申请').first()).toBeVisible();
}

test('Stage 7F 17 Staff views and 4 Review recovery views', async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(screenshotDirectory, { recursive: true });
  const apiRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) apiRequests.push(`${request.method()} ${path}`);
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // 1–3. Staff workbench desktop, mobile, and the real mobile navigation drawer.
  await setOwner(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await assertNormalState(page, '建议先处理');
  await expect(page.getByText('审核卖家产品申请').first()).toBeVisible();
  await capture(page, 'staff-workbench-owner-1440x900.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/review/staff');
  await expect(page.getByText('审核卖家产品申请').first()).toBeVisible();
  await assertNormalState(page, '建议先处理');
  await capture(page, 'staff-workbench-owner-390x844.png');

  await page.getByLabel('打开导航菜单').click();
  await expect(page.getByRole('dialog', { name: '员工导航菜单' })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await capture(page, 'staff-workbench-owner-drawer-390x844.png');

  // 4–7. Staff order list at desktop widths, mobile cards, and filter drawer.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/review/staff/orders');
  await expect(page.getByRole('columnheader', { name: '买家编号' })).toBeVisible();
  await expect(page.getByText('503-7770001-0003001').first()).toBeVisible();
  await assertNormalState(page, '订单');
  await capture(page, 'staff-orders-owner-1440x900.png');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/review/staff/orders');
  await expect(page.getByText('503-7770001-0003001').first()).toBeVisible();
  await assertNormalState(page, '订单');
  await capture(page, 'staff-orders-owner-1280x900.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/review/staff/orders');
  await expect(page.locator('.sp-order-mobile-list').getByText('503-7770001-0003001')).toBeVisible();
  await assertNormalState(page, '订单');
  await capture(page, 'staff-orders-owner-390x844.png');

  const filterButton = page.getByRole('button', { name: /^筛选/u });
  await filterButton.click();
  await expect(page.getByRole('dialog', { name: '订单筛选' })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await capture(page, 'staff-orders-owner-filter-drawer-390x844.png');
  await page.keyboard.press('Escape');

  // 8–9. Staff order detail at desktop and mobile; all protected images must decode.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/review/staff/orders/review-seller-order-1');
  await expect(page.getByRole('heading', { name: '业务参与方' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '订单进度' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '订单付款截图' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /订单沟通截图/u })).toBeVisible();
  await expect(page.getByRole('heading', { name: '计价明细' })).toBeVisible();
  await assertDecodedImages(page, true);
  await assertNormalState(page, '订单详情');
  await capture(page, 'staff-order-detail-owner-1440x900.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/review/staff/orders/review-seller-order-1');
  await expect(page.getByRole('heading', { name: '业务参与方' })).toBeVisible();
  await assertDecodedImages(page, true);
  await assertNormalState(page, '订单详情');
  await capture(page, 'staff-order-detail-owner-390x844.png');

  // 10–11. Buyer and seller customer management surfaces.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/review/staff/buyer-customers');
  await expect(page.getByRole('heading', { name: '历史客户 / 已有客户查询' })).toBeVisible();
  await page.locator('#BUYER-historical-wechat').fill('demo_existing_wechat');
  await page.getByRole('button', { name: '查询已有客户' }).click();
  await expect(page.getByText('Demo 历史多身份客户')).toBeVisible();
  await assertNormalState(page, '买家客户');
  await capture(page, 'staff-buyer-customers-owner-1440x900.png');

  await page.goto('/review/staff/seller-customers');
  await expect(page.getByRole('heading', { name: /全部卖家客户/u })).toBeVisible();
  await expect(page.getByText('月光白 Demo 卖家组织')).toBeVisible();
  await assertNormalState(page, '卖家客户');
  await capture(page, 'staff-seller-customers-owner-1440x900.png');

  // 12–13. Product list and reservation scheduling.
  await page.goto('/review/staff/products');
  await expect(page.getByRole('table', { name: '员工产品库' })).toBeVisible();
  await expect(page.getByText('轻量保温随行杯').first()).toBeVisible();
  await assertNormalState(page, '产品与预约');
  await capture(page, 'staff-products-owner-1440x900.png');

  await page.goto('/review/staff/demands/review-seller-demand-1/reservations');
  await expect(page.getByRole('table', { name: '预约排名与预计下单日期' })).toBeVisible();
  await expect(page.getByText('张三丰（演示）').first()).toBeVisible();
  await assertNormalState(page, '工作台');
  await capture(page, 'staff-reservation-schedule-owner-1440x900.png');

  // 14. Buyer refund workbench.
  await page.goto('/review/staff/refunds');
  await expect(page.getByRole('heading', { name: '返款记录' })).toBeVisible();
  await expect(page.getByText('20260808B00042').first()).toBeVisible();
  await assertNormalState(page, '买家返款');
  await capture(page, 'staff-buyer-refunds-owner-1440x900.png');

  // 15–16. Finance desktop and mobile.
  await page.goto('/review/staff/finance');
  await expect(page.getByRole('heading', { name: '结算概览' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '应付明细' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '付款进度' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '结算批次' })).toBeVisible();
  await expect(page.getByText('¥6,339.00')).toBeVisible();
  await assertNormalState(page, '财务');
  await capture(page, 'staff-finance-owner-1440x900.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/review/staff/finance');
  await expect(page.getByRole('heading', { name: '结算概览' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '付款进度' })).toBeVisible();
  await assertNormalState(page, '财务');
  await capture(page, 'staff-finance-owner-390x844.png');

  // 17. Owner system settings: service-channel configuration is the primary
  // screenshot; Dashboard and access management are checked in the same run
  // because their focused suites own their supplemental screenshot flows.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/review/staff/service-channels');
  await expect(page.getByRole('heading', { name: '售前客服（预约、订单资料阶段）' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '售后客服（评论、返款、正式售后阶段）' })).toBeVisible();
  await assertNormalState(page, '客服渠道');
  await capture(page, 'staff-service-channels-owner-1440x900.png');

  await page.goto('/review/staff/admin-business-dashboard');
  await expect(page.getByRole('heading', { name: '客户与订单' })).toBeVisible();
  await expect(page.getByText('¥8,965.20')).toBeVisible();
  await assertNormalState(page, '经营看板');

  await page.goto('/review/staff/access-management');
  await expect(page.getByRole('heading', { name: '负责卖家组织' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '负责买家售前' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '负责买家返款' })).toBeVisible();
  await assertNormalState(page, '员工与权限');

  // Four recovery screenshots: review entry and each portal entry.
  await page.goto('/review');
  await expect(page.getByRole('heading', { name: '月光白 V2 · 前端评审环境' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(forbiddenState);
  await assertNoHorizontalOverflow(page);
  await capture(page, 'review-entry-1440x900.png');

  await page.goto('/review/buyer');
  await expect(page.getByRole('heading', { name: '当前可预约' })).toBeVisible();
  await assertNormalState(page, '当前可预约');
  await capture(page, 'review-buyer-recovery-1440x900.png');

  await page.goto('/review/seller');
  await expect(page.getByRole('heading', { name: '建议处理', exact: true })).toBeVisible();
  await expect(page.getByText('Demo OWNER', { exact: true })).toBeVisible();
  await assertNormalState(page, '建议处理');
  await capture(page, 'review-seller-recovery-1440x900.png');

  await page.goto('/review/staff');
  await expect(page.getByRole('heading', { name: '建议先处理' })).toBeVisible();
  await expect(page.getByText('审核卖家产品申请').first()).toBeVisible();
  await assertNormalState(page, '建议先处理');
  await capture(page, 'review-staff-recovery-1440x900.png');

  expect(apiRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
