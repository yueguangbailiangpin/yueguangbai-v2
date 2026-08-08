import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

test.use({
  colorScheme: 'light',
  locale: 'zh-CN',
  reducedMotion: 'reduce',
  timezoneId: 'Asia/Shanghai',
});

const screenshotDirectory = process.env['BUYER_VISUAL_PILOT_SCREENSHOT_DIR'];
const visualReviewScreenshotPath = process.env['BUYER_VISUAL_REVIEW_SCREENSHOT'];
const fixedNow = Date.parse('2026-08-09T04:00:00.000Z');
const viewports = [
  { width: 320, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
  { width: 1600, height: 1000 },
] as const;
const buyerNavigationLabels = ['首页', '产品', '订单资料', '评论', '我的'] as const;

const product = {
  demand_id: 'demand-visual-1',
  demand_version: 4,
  marketplace_code: 'JP',
  product_name: '月白保湿护理套装',
  reference_order_amount_jpy: '3980',
  buyer_self_pay_bps: 1250,
  estimated_buyer_self_pay_jpy: '498',
  estimated_refundable_principal_jpy: '3482',
  buyer_visible_notes: '请确认商品规格与公开说明后再预约。',
  store_display_name: '日本站合作店铺',
  task_type: 'IMAGE',
  target_quantity: 8,
  remaining_quantity: 3,
  open_at: fixedNow - 86_400_000,
  reservation_deadline: fixedNow + 3 * 86_400_000,
  order_deadline: fixedNow + 8 * 86_400_000,
};

const secondProduct = {
  ...product,
  demand_id: 'demand-visual-2',
  demand_version: 2,
  product_name: '月白清洁补充装',
  reference_order_amount_jpy: '2680',
  estimated_buyer_self_pay_jpy: '335',
  estimated_refundable_principal_jpy: '2345',
  remaining_quantity: 6,
  reservation_deadline: fixedNow + 5 * 86_400_000,
  order_deadline: fixedNow + 10 * 86_400_000,
};

function success(data: unknown) {
  return { data, meta: { request_id: 'buyer-visual-pilot' } };
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function installBuyerFixture(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/customer-auth/session') {
      await json(route, success({ session: {
        account_id: 'buyer-visual-account',
        identity_subject_id: 'buyer-visual-subject',
        account_type: 'BUYER',
        session_version: 1,
        password_change_required: false,
        issued_at: fixedNow - 60_000,
        expires_at: fixedNow + 3_600_000,
      } }));
      return;
    }
    if (path === '/api/buyer-portal/demands') {
      await json(route, success({ items: [product, secondProduct], next_cursor: null }));
      return;
    }
    if (path === '/api/buyer-portal/demands/demand-visual-1') {
      await json(route, success({ demand: product }));
      return;
    }
    await json(route, {
      error: { code: 'NOT_FOUND', message: 'not found', details: null },
      meta: { request_id: 'buyer-visual-not-found' },
    }, 404);
  });
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const size = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
}

async function capture(page: Page, name: string): Promise<void> {
  if (!screenshotDirectory) return;
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({
    path: join(screenshotDirectory, name),
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
  });
}

async function assertMinimumTarget(page: Page, selector: string): Promise<void> {
  const boxes = await page.locator(selector).evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }));
  for (const box of boxes) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
}

async function assertBuyerNavigationInsideViewport(page: Page): Promise<void> {
  const navigation = page.getByRole('navigation', { name: '买家导航' });
  for (const label of buyerNavigationLabels) {
    const link = navigation.getByRole('link', { name: label, exact: true });
    await expect(link).toBeVisible();
    const box = await link.evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
    });
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(box.viewportWidth);
    expect(box.y + box.height).toBeLessThanOrEqual(box.viewportHeight);
  }
}

test('Buyer visual pilot captures deterministic responsive matrix', async ({ page }) => {
  await installBuyerFixture(page);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);

    await page.goto('/buyer/login');
    await expect(page.getByText('月光白', { exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    await capture(page, `buyer-login-${viewport.width}x${viewport.height}.png`);

    await page.goto('/buyer/products');
    await expect(page.getByRole('heading', { name: product.product_name, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: secondProduct.product_name, exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    await assertBuyerNavigationInsideViewport(page);
    await capture(page, `buyer-products-${viewport.width}x${viewport.height}.png`);

    await page.goto('/buyer/demands/demand-visual-1');
    await expect(page.getByRole('heading', { name: product.product_name })).toBeVisible();
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    await noHorizontalOverflow(page);
    await assertBuyerNavigationInsideViewport(page);
    await capture(page, `buyer-product-detail-${viewport.width}x${viewport.height}.png`);
  }
});

test('Buyer home captures the 390 visual review checkpoint', async ({ page }) => {
  test.skip(!visualReviewScreenshotPath, 'Set BUYER_VISUAL_REVIEW_SCREENSHOT for the visual review checkpoint.');
  if (!visualReviewScreenshotPath) return;
  await installBuyerFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/buyer');
  await expect(page.getByRole('heading', { name: '当前开放产品' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  mkdirSync(dirname(visualReviewScreenshotPath), { recursive: true });
  await page.screenshot({
    path: visualReviewScreenshotPath,
    animations: 'disabled',
    caret: 'hide',
  });
});

test('Buyer login core stays minimal, labeled, and recoverable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/buyer/login');
  await expect(page.getByText('月光白', { exact: true })).toHaveCount(1);
  await expect(page.getByLabel('账号')).toBeVisible();
  await expect(page.getByLabel('密码')).toBeVisible();
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible();
  await expect(page.locator('select')).toHaveCount(0);
  await expect(page.getByRole('link')).toHaveCount(0);
  await expect(page.getByText(/买家服务|买家登录|工作区|身份|注册|安全访问/u)).toHaveCount(0);
  await page.locator('form').evaluate((form) => form.dispatchEvent(new SubmitEvent('submit', {
    bubbles: true,
    cancelable: true,
  })));
  await expect(page.getByRole('alert')).toContainText('请输入登录标识和密码');
  await assertMinimumTarget(page, '.login-card button, .login-card input');
});

test('Buyer product pilot excludes adjacent and internal content', async ({ page }) => {
  await installBuyerFixture(page);
  await page.goto('/buyer/products');
  await expect(page.getByRole('heading', { name: '当前开放产品' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '下一步' })).toBeVisible();
  await expect(page.getByRole('heading', { name: product.product_name, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: secondProduct.product_name, exact: true })).toBeVisible();
  await expect(page.locator('main').getByText(/客户编号|会话到期|内部说明|内部业务时间|预约排名|预计下单日期|返款金额/u)).toHaveCount(0);
  await expect(page.locator('main').getByText(/进行中的产品|已预约|已下单|等待下单/u)).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: '买家导航' }).getByRole('link')).toHaveCount(5);
  await assertMinimumTarget(page, '.bottom-nav a');
});

test('Buyer pilot keeps keyboard focus, zoom reflow, and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/buyer/login');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('账号')).toBeFocused();
  const focusStyle = await page.getByLabel('账号').evaluate((element) => ({
    outline: getComputedStyle(element).outlineStyle,
    width: getComputedStyle(element).outlineWidth,
  }));
  expect(focusStyle.outline).not.toBe('none');
  expect(focusStyle.width).not.toBe('0px');

  await installBuyerFixture(page);
  await page.goto('/buyer/products');
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await noHorizontalOverflow(page);
  await expect(page.getByRole('heading', { name: product.product_name, exact: true })).toBeVisible();
  const animationDuration = await page.evaluate(() => {
    const node = document.createElement('span');
    node.className = 'buyer-loading-mark';
    document.body.append(node);
    return getComputedStyle(node).animationDuration;
  });
  expect(animationDuration).not.toBe('0.9s');

  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.goto('/buyer/demands/demand-visual-1');
  const checkbox = page.getByRole('checkbox');
  await checkbox.focus();
  const focusPosition = await checkbox.evaluate((element) => element.getBoundingClientRect().bottom);
  const navigationTop = await page.locator('.bottom-nav').evaluate((element) => element.getBoundingClientRect().top);
  expect(focusPosition).toBeLessThan(navigationTop);
});

test('Buyer pilot text and primary action meet contrast targets', async ({ page }) => {
  await page.goto('/buyer/login');
  const ratios = await page.evaluate(() => {
    const rgb = (value: string): [number, number, number] => {
      const values = value.match(/[\d.]+/gu)?.slice(0, 3).map(Number) ?? [];
      if (values.length !== 3) throw new Error(`Unsupported color: ${value}`);
      return values as [number, number, number];
    };
    const luminance = (color: [number, number, number]): number => {
      const linear = color.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    };
    const ratio = (foreground: string, background: string): number => {
      const values = [luminance(rgb(foreground)), luminance(rgb(background))].sort((a, b) => b - a);
      return (values[0]! + 0.05) / (values[1]! + 0.05);
    };
    const brand = document.querySelector<HTMLElement>('.login-brand strong')!;
    const button = document.querySelector<HTMLElement>('.login-card button[type="submit"]')!;
    const card = document.querySelector<HTMLElement>('.login-card')!;
    return {
      brand: ratio(getComputedStyle(brand).color, getComputedStyle(card).backgroundColor),
      button: ratio(getComputedStyle(button).color, getComputedStyle(button).backgroundColor),
    };
  });
  expect(ratios.brand).toBeGreaterThanOrEqual(4.5);
  expect(ratios.button).toBeGreaterThanOrEqual(4.5);
});

test('Buyer products preserve on-demand route isolation', async ({ page }) => {
  const scripts = new Set<string>();
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.endsWith('.js')) scripts.add(path.split('/').at(-1) ?? path);
  });
  await installBuyerFixture(page);
  await page.goto('/buyer/products');
  await expect(page.getByRole('heading', { name: product.product_name, exact: true })).toBeVisible();
  expect([...scripts].some((name) => /BuyerOrderRouteModule|BuyerAfterSalesRouteModule|SellerRouteModule|StaffRouteModule/u.test(name))).toBe(false);
});
