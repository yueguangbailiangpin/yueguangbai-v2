import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const screenshotDirectory = resolve(process.cwd(), 'tmp/stage7f1-staff-visual-correction');

test.use({
  colorScheme: 'light',
  locale: 'zh-CN',
  reducedMotion: 'reduce',
  timezoneId: 'Asia/Shanghai',
});

async function assertVisualReady(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: '建议先处理' })).toBeVisible();
  await expect(page.getByText('审核卖家产品申请').first()).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByText(/服务暂时不可用|MALFORMED_RESPONSE|当前面板加载失败|读取失败/u),
  ).toHaveCount(0);
  await expect(page.getByText(/正在加载|加载中/u)).toHaveCount(0);
  await expect(page.getByText(/公共池|抢任务|获客中心|规划中/u)).toHaveCount(0);
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);
}

async function assertWorkbenchTypography(page: Page): Promise<void> {
  const typography = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('.staff-app');
    const activeNav = document.querySelector<HTMLElement>('.sa-nav__link.is-active');
    const inactiveNav = document.querySelector<HTMLElement>('.sa-nav__link:not(.is-active)');
    const groupLabel = document.querySelector<HTMLElement>('.sa-nav__group-label');
    const title = document.querySelector<HTMLElement>('.sp-hello__title');
    const section = document.querySelector<HTMLElement>('.sp-workbench .sp-section-heading h2');
    const task = document.querySelector<HTMLElement>('.sp-workbench .sp-task-copy strong');
    const meta = document.querySelector<HTMLElement>('.sp-workbench .sp-task-copy small');
    const button = document.querySelector<HTMLElement>('.sp-hello__actions .sa-btn');
    const style = (node: HTMLElement | null) =>
      node
        ? {
            fontFamily: getComputedStyle(node).fontFamily,
            fontSize: getComputedStyle(node).fontSize,
            fontWeight: getComputedStyle(node).fontWeight,
          }
        : null;
    return {
      root: style(root),
      activeNav: style(activeNav),
      inactiveNav: style(inactiveNav),
      groupLabel: style(groupLabel),
      title: style(title),
      section: style(section),
      task: style(task),
      meta: style(meta),
      button: style(button),
    };
  });

  expect(typography.root?.fontSize).toBe('15px');
  expect(typography.root?.fontWeight).toBe('400');
  expect(typography.root?.fontFamily).toContain('Google Sans Text');
  expect(typography.activeNav).toMatchObject({ fontSize: '15px', fontWeight: '600' });
  expect(typography.inactiveNav).toMatchObject({ fontSize: '15px', fontWeight: '500' });
  expect(typography.groupLabel).toMatchObject({ fontSize: '12px', fontWeight: '600' });
  expect(typography.title).toMatchObject({ fontSize: '32px', fontWeight: '600' });
  expect(typography.section).toMatchObject({ fontSize: '18px', fontWeight: '600' });
  expect(typography.task).toMatchObject({ fontSize: '15px', fontWeight: '500' });
  expect(typography.meta).toMatchObject({ fontSize: '13px', fontWeight: '400' });
  expect(typography.button).toMatchObject({ fontSize: '15px', fontWeight: '500' });
}

test('员工端 Shell + 工作台第一版：owner、非 Owner、手机 Drawer 与三张视觉证据', async ({
  page,
}) => {
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
  await assertVisualReady(page);
  await assertWorkbenchTypography(page);
  await expect(page.getByText('503-7770005-0003005')).toBeVisible();

  // 非 Owner：仍有固定分配、SLA 和工作项摘要；无 Owner/财务入口与返款金额。
  await page.getByLabel('员工评审角色').selectOption('pre_sales');
  await expect(page.getByRole('heading', { name: /Demo 售前/u })).toBeVisible();
  await expect(page.getByText('审核买家预约申请').first()).toBeVisible();
  const staffNavigation = page.getByRole('navigation', { name: '员工工作台主导航' });
  await expect(staffNavigation.getByRole('link', { name: '买家客户', exact: true })).toBeVisible();
  await expect(staffNavigation.getByRole('link', { name: '财务', exact: true })).toHaveCount(0);
  await expect(page.getByText('今日应处理返款')).toHaveCount(0);
  await expect(page.getByText(/公共池|抢任务|获客中心|规划中/u)).toHaveCount(0);

  // 回到 Owner 生成本轮三张唯一交付截图。
  await page.getByLabel('员工评审角色').selectOption('owner');
  await assertVisualReady(page);
  await page.screenshot({
    path: resolve(screenshotDirectory, 'staff-workbench-owner-1440x900.png'),
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await assertVisualReady(page);
  await expect(page.getByLabel('快捷入口')).toBeVisible();
  await expect(page.getByRole('navigation', { name: '员工端手机快捷导航' })).toBeVisible();
  await page.screenshot({
    path: resolve(screenshotDirectory, 'staff-workbench-owner-390x844.png'),
  });

  const menuButton = page.getByLabel('打开导航菜单');
  await menuButton.focus();
  await menuButton.click();
  const drawer = page.getByRole('dialog', { name: '员工导航菜单' });
  await expect(drawer).toBeVisible();
  await expect(page.getByLabel('关闭导航菜单')).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(menuButton).toBeFocused();
  await menuButton.click();
  await expect(page.getByRole('dialog', { name: '员工导航菜单' })).toBeVisible();
  await page.screenshot({
    path: resolve(screenshotDirectory, 'staff-workbench-owner-drawer-390x844.png'),
  });

  expect(apiRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
