import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const screenshotDirectory = resolve(process.cwd(), 'tmp/stage7f1-staff-navigation-correction');

test.use({
  colorScheme: 'light',
  locale: 'zh-CN',
  reducedMotion: 'reduce',
  timezoneId: 'Asia/Shanghai',
});

async function assertWorkbenchReady(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: '建议先处理' })).toBeVisible();
  await expect(page.getByText('审核卖家产品申请').first()).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByText(/服务暂时不可用|MALFORMED_RESPONSE|当前面板加载失败|读取失败/u),
  ).toHaveCount(0);
  await expect(page.getByText(/公共池|抢任务|获客中心|规划中/u)).toHaveCount(0);
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test('员工端导航颜色与图标视觉纠偏：桌面与手机 Drawer', async ({ page }) => {
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
  await assertWorkbenchReady(page);

  const navigation = page.getByRole('navigation', { name: '员工工作台主导航' });
  const active = navigation.getByRole('link', { name: '工作台', exact: true });
  const inactive = navigation.getByRole('link', { name: '买家客户', exact: true });
  await expect(active).toHaveClass(/is-active/u);

  const colors = await page.evaluate(() => {
    const activeLink = document.querySelector<HTMLElement>('.sa-nav__link.is-active');
    const inactiveLink = document.querySelector<HTMLElement>('.sa-nav__link:not(.is-active)');
    const activeIcon = activeLink?.querySelector<HTMLElement>('.sa-nav__icon');
    const inactiveIcon = inactiveLink?.querySelector<HTMLElement>('.sa-nav__icon');
    return {
      activeText: activeLink ? getComputedStyle(activeLink).color : null,
      activeBackground: activeLink ? getComputedStyle(activeLink).backgroundColor : null,
      activeIcon: activeIcon ? getComputedStyle(activeIcon).color : null,
      inactiveText: inactiveLink ? getComputedStyle(inactiveLink).color : null,
      inactiveIcon: inactiveIcon ? getComputedStyle(inactiveIcon).color : null,
    };
  });
  expect(colors).toEqual({
    activeText: 'rgb(4, 30, 73)',
    activeBackground: 'rgb(211, 227, 253)',
    activeIcon: 'rgb(4, 30, 73)',
    inactiveText: 'rgb(60, 64, 67)',
    inactiveIcon: 'rgb(95, 99, 104)',
  });

  const iconMetrics = await navigation.locator('.sa-nav__icon').evaluateAll((boxes) =>
    boxes.map((box) => {
      const svg = box.querySelector('svg');
      const boxStyle = getComputedStyle(box);
      return {
        boxWidth: boxStyle.width,
        boxHeight: boxStyle.height,
        width: svg?.getAttribute('width'),
        height: svg?.getAttribute('height'),
        strokeWidth: svg?.getAttribute('stroke-width'),
      };
    }),
  );
  expect(iconMetrics.length).toBeGreaterThan(0);
  expect(
    iconMetrics.every(
      (metric) =>
        metric.boxWidth === '24px' &&
        metric.boxHeight === '24px' &&
        metric.width === '20' &&
        metric.height === '20' &&
        metric.strokeWidth === '1.75',
    ),
  ).toBe(true);

  await inactive.hover();
  await expect
    .poll(() => inactive.evaluate((node) => getComputedStyle(node).color))
    .toBe('rgb(60, 64, 67)');
  await expect(page.locator('.sa-create-action svg')).toHaveAttribute('stroke-width', '1.75');
  await expect(page.getByLabel('打开系统设置').locator('svg')).toHaveAttribute(
    'stroke-width',
    '1.75',
  );
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: resolve(screenshotDirectory, 'staff-navigation-owner-1440x900.png'),
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await assertWorkbenchReady(page);
  await assertNoHorizontalOverflow(page);
  const menuButton = page.getByLabel('打开导航菜单');
  await menuButton.focus();
  await menuButton.click();
  const drawer = page.getByRole('dialog', { name: '员工导航菜单' });
  await expect(drawer).toBeVisible();
  await expect(page.getByLabel('关闭导航菜单')).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await expect(drawer.getByRole('link', { name: '工作台', exact: true })).toHaveClass(/is-active/u);
  await expect(drawer.getByRole('link', { name: '买家客户', exact: true })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await page.screenshot({
    path: resolve(screenshotDirectory, 'staff-navigation-owner-drawer-390x844.png'),
  });
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(menuButton).toBeFocused();

  expect(apiRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
