import { expect, test, type Page, type Route } from '@playwright/test';

type Identity = 'buyer' | 'seller' | 'staff';

function success(data: unknown, requestId = 'browser-local') {
  return { data, meta: { request_id: requestId } };
}

function failure(code: string, requestId: string) {
  return {
    error: { code, message: 'safe browser fixture', details: null },
    meta: { request_id: requestId },
  };
}

function customerSession(
  identity: 'buyer' | 'seller',
  passwordChangeRequired = false,
) {
  return {
    account_id: `${identity}-local`,
    identity_subject_id: 'subject-local',
    account_type: identity === 'buyer' ? 'BUYER' : 'SELLER_MEMBER',
    session_version: 1,
    password_change_required: passwordChangeRequired,
    issued_at: 1,
    expires_at: 9_999_999_999_999,
  };
}

function staffSession() {
  return {
    staff_id: 'staff-local',
    display_name: '本地员工',
    roles: [],
    permissions: [],
    data_scope: {
      type: 'GLOBAL',
      buyerCustomerIds: [],
      sellerOrganizationIds: [],
      teamIds: [],
    },
    authorization_version: 1,
    session_version: 1,
    expires_at: 9_999_999_999_999,
  };
}

async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body),
  });
}

async function mockApi(
  page: Page,
  identity: Identity,
  sessionReads?: { count: number },
): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/staff-auth/session') {
      await fulfillJson(route, success({ session: staffSession() }));
      return;
    }
    if (path === '/api/customer-auth/session') {
      if (sessionReads) sessionReads.count += 1;
      const customer = identity === 'staff' ? 'buyer' : identity;
      await fulfillJson(route, success({ session: customerSession(customer) }));
      return;
    }
    if (path === '/api/customer-auth/logout') {
      await fulfillJson(route, success({
        logged_out: true,
        all_devices_logged_out: false,
      }, 'browser-customer-logout'));
      return;
    }
    if (identity === 'seller' && path === '/api/seller-portal/me') {
      await fulfillJson(route, success({ me: { account_id: 'seller-local', member: { id: 'member-local', display_name: '本地卖家', role: 'OWNER', primary_owner: true }, organization: { id: 'org-local', seller_code: 'seller-local', name: '本地卖家组织', marketplace_code: 'JP', status: 'ACTIVE' }, access: { read_scope: 'ORGANIZATION', store_ids: ['store-local'], can_submit_product_applications: true, can_submit_demand_batches: true } } }));
      return;
    }
    if (identity === 'seller' && path === '/api/seller-portal/stores') {
      await fulfillJson(route, success({ items: [{ id: 'store-local', marketplace_code: 'JP', canonical_marketplace_code: 'AMAZON_JP', transaction_currency_code: 'JPY', transaction_currency_exponent: 0, marketplace_status: 'ACTIVE', adapter_status: 'AVAILABLE', display_name: '日本一号店', status: 'ACTIVE', version: 1, created_at: 1, updated_at: 1 }], page: { limit: 100, next_cursor: null } }));
      return;
    }
    if (identity === 'seller' && path === '/api/seller-portal/formal-orders') {
      await fulfillJson(route, success({ items: [], page: { limit: 100, next_cursor: null } }));
      return;
    }
    if (identity === 'seller' && path === '/api/seller-portal/settlement/summary') {
      await fulfillJson(route, success({ settlement: { outstanding_principal_cny_fen: '0', outstanding_service_fee_cny_fen: '0', total_outstanding_cny_fen: '0', unallocated_credit_cny_fen: '0' } }));
      return;
    }
    if (identity === 'seller' && ['/api/seller-portal/products', '/api/seller-portal/demand-batches', '/api/seller-portal/reviews', '/api/seller-portal/settlement/payables'].includes(path)) {
      await fulfillJson(route, success({ items: [], page: { limit: 100, next_cursor: null } }));
      return;
    }
    if (path === '/api/staff-auth/logout') {
      await fulfillJson(route, success({
        logged_out: true,
        all_devices_logged_out: false,
      }, 'browser-staff-logout'));
      return;
    }
    if (path === '/api/staff-auth/logout-all') {
      await fulfillJson(route, success({
        logged_out: true,
        all_devices_logged_out: true,
        session_version: 2,
      }, 'browser-staff-logout-all'));
      return;
    }
    if (identity === 'staff' && path === '/api/staff/me/work-items') {
      await fulfillJson(route, success({ work_items: [], next_cursor: null }));
      return;
    }
    await fulfillJson(route, failure('NOT_FOUND', 'browser-unhandled'), 404);
  });
}

async function expectNoCriticalHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test('root is a finished dedicated-link notice with no identity controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '月光白' })).toBeVisible();
  await expect(page.getByText('请使用工作人员发送的专属链接登录。')).toBeVisible();
  await expect(page.getByRole('link')).toHaveCount(0);
  await expect(page.getByRole('button')).toHaveCount(0);
  await expect(page.locator('form')).toHaveCount(0);
  await expect(page.locator('.dedicated-entry')).toHaveText(
    '月光白请使用工作人员发送的专属链接登录。',
  );
  await expect(page.getByText('专属访问')).toHaveCount(0);
  await expect(page.getByText('链接将自动确认您的访问身份')).toHaveCount(0);
  await expect(page.getByText('月', { exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/Moonlight|Moonlight White|V2/u);
});

for (const [path, heading, other] of [
  ['/buyer/login', '买家登录', 'buyer'],
  ['/seller/login', '卖家登录', 'seller'],
] as const) {
test(`${path} renders a polished customer login with no cross-identity entry`, async ({ page }) => {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  await expect(page.getByLabel('账号')).toBeVisible();
  await expect(page.getByLabel('密码')).toBeVisible();
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(
    other === 'buyer' ? '卖家登录' : '买家登录',
  );
});
}

test('staff login has only the trusted provider action and no customer form', async ({ page }) => {
  await page.goto('/staff/login');
  await expect(page.getByRole('heading', { name: '员工登录' })).toBeVisible();
  await expect(page.getByRole('button', { name: '使用受信任身份继续' })).toBeVisible();
  await expect(page.getByLabel('账号')).toHaveCount(0);
  await expect(page.getByLabel('密码')).toHaveCount(0);
  await expect(page.getByText('员工身份与买家、卖家账号严格分离；本地验收不连接外部身份提供方。')).toBeVisible();
});

test('buyer login tab order and focus ring remain keyboard-visible', async ({ page }) => {
  await page.goto('/buyer/login');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('账号')).toBeFocused();
  const focusStyle = await page.getByLabel('账号').evaluate((element) => {
    const style = getComputedStyle(element);
    return { outline: style.outlineStyle, width: style.outlineWidth };
  });
  expect(focusStyle.outline).not.toBe('none');
  expect(focusStyle.width).not.toBe('0px');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('密码')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('进入身份')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '登录' })).toBeFocused();
});

for (const [identity, path, heading] of [
  ['buyer', '/buyer/change-password', '买家修改密码'],
  ['seller', '/seller/change-password', '卖家修改密码'],
] as const) {
test(`${identity} password change renders only after a matching session`, async ({ page }) => {
  await mockApi(page, identity);
  await page.goto(path);
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  await expect(page.getByLabel('当前密码')).toBeVisible();
  await expect(page.getByLabel('新密码', { exact: true })).toBeVisible();
  await expect(page.getByLabel('确认新密码', { exact: true })).toBeVisible();
});
}

test('password_change_required routes Buyer to the password flow', async ({ page }) => {
  await page.route('**/api/customer-auth/session', (route) => fulfillJson(
    route,
    success({ session: customerSession('buyer', true) }),
  ));
  await page.goto('/buyer');
  await expect(page).toHaveURL(/\/buyer\/change-password$/u);
  await expect(page.getByRole('heading', { name: '买家修改密码' })).toBeVisible();
});

test('Buyer shell is task-focused with five fixed items and no fake business data', async ({ page }) => {
  await mockApi(page, 'buyer');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/buyer');
  const navigation = page.getByRole('navigation', { name: '买家导航' });
  await expect(navigation.getByRole('link')).toHaveCount(5);
  for (const label of ['首页', '任务', '订单资料', '评论', '我的']) {
    await expect(navigation.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: '首页' })).toBeVisible();
  await expect(page.getByText('部分内容暂不可用')).toBeVisible();
  await expectNoCriticalHorizontalOverflow(page);
});

test('Buyer shell keeps navigation clear at 320px and safe content padding', async ({ page }) => {
  await mockApi(page, 'buyer');
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/buyer/tasks');
  await expect(page.getByRole('heading', { name: '任务', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '买家导航' })).toBeVisible();
  await expectNoCriticalHorizontalOverflow(page);
});

test('Seller shell exposes organization/store context and truthful business metrics', async ({ page }) => {
  await mockApi(page, 'seller');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/seller');
  await expect(page.getByRole('navigation', { name: '卖家导航' })).toBeVisible();
  await expect(page.getByLabel('店铺与站点')).toBeVisible();
  await expect(page.getByText(/本地卖家组织/u)).toBeVisible();
  for (const label of ['正式订单', '业务完成', '待结算']) await expect(page.getByText(label, { exact: true })).toBeVisible();
  await expect(page.getByText('状态来自服务器业务事实；结算确认由员工控制。')).toBeVisible();
  await expectNoCriticalHorizontalOverflow(page);
});

test('Seller navigation is route-aware, client-side, and session-stable', async ({ page }) => {
  const sessionReads = { count: 0 };
  await mockApi(page, 'seller', sessionReads);
  await page.goto('/seller');
  const navigation = page.getByRole('navigation', { name: '卖家导航' });
  const expectCurrent = async (label: string): Promise<void> => {
    await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(navigation.getByRole('link', { name: label })).toHaveAttribute(
      'aria-current', 'page',
    );
  };
  await expectCurrent('首页');
  expect(sessionReads.count).toBe(1);

  await navigation.getByRole('link', { name: '商品' }).click();
  await expect(page).toHaveURL(/\/seller\/products$/u);
  await expectCurrent('商品');
  expect(sessionReads.count).toBe(1);

  await navigation.getByRole('link', { name: '订单' }).click();
  await expect(page).toHaveURL(/\/seller\/orders$/u);
  await expectCurrent('订单');
  expect(sessionReads.count).toBe(1);

  for (const label of ['首页', '商品', '需求', '订单', '评论', '结算', '我的']) {
    await expect(navigation.getByRole('link', { name: label })).toBeVisible();
  }
});

test('Seller store context is keyboard operable and remains visible', async ({ page }) => {
  await mockApi(page, 'seller');
  await page.goto('/seller');
  const context = page.getByLabel('店铺与站点');
  await context.focus();
  await expect(context).toBeFocused();
  await context.selectOption('store-local');
  await expect(context).toHaveValue('store-local');
});

test('Seller small screen uses the business dashboard without page overflow', async ({ page }) => {
  await mockApi(page, 'seller');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/seller');
  await expect(page.getByRole('heading', { name: '业务进度' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '卖家导航' })).toBeVisible();
  await expectNoCriticalHorizontalOverflow(page);
});

test('Staff desktop shell preserves queue-detail-action DOM order and separation', async ({ page }) => {
  await mockApi(page, 'staff');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: '员工工作台' })).toBeVisible();
  const headings = await page.locator(
    '.staff-panes > section > .pane-heading h2, .staff-panes > aside > h2',
  ).allTextContents();
  expect(headings).toEqual(['待处理队列', '详情', '客户安全与账户']);
  await expect(page.getByRole('heading', { name: '请选择工作项' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '客户邀请与账号恢复' })).toBeVisible();
  await expectNoCriticalHorizontalOverflow(page);
});

test('Staff narrow shell preserves queue-detail-tools order without overflow', async ({ page }) => {
  await mockApi(page, 'staff');
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: '员工工作台' })).toBeVisible();
  const headings = await page.locator(
    '.staff-panes > section > .pane-heading h2, .staff-panes > aside > h2',
  ).allTextContents();
  expect(headings.slice(0, 3)).toEqual(['待处理队列', '详情', '客户安全与账户']);
  await page.getByLabel('状态').focus();
  await expect(page.getByLabel('状态')).toBeFocused();
  await expectNoCriticalHorizontalOverflow(page);
});

test('Staff ordinary logout clears the local session before navigation', async ({ page }) => {
  await mockApi(page, 'staff');
  await page.goto('/staff');
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/staff\/login$/u);
  await expect(page.getByRole('heading', { name: '员工登录' })).toBeVisible();
});

test('Staff logout-all requires a busy-safe Dialog and completes explicitly', async ({ page }) => {
  await mockApi(page, 'staff');
  await page.goto('/staff');
  const opener = page.getByRole('button', { name: '退出所有设备' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: '退出所有设备' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '确认退出所有设备' }).click();
  await expect(page).toHaveURL(/\/staff\/login$/u);
});

test('401 route guard redirects without rendering Buyer shell content', async ({ page }) => {
  await page.route('**/api/customer-auth/session', (route) => fulfillJson(
    route,
    failure('UNAUTHENTICATED', 'browser-401'),
    401,
  ));
  await page.goto('/buyer/orders');
  await expect(page.getByRole('heading', { name: '买家登录' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '买家导航' })).toHaveCount(0);
});

test('mismatch fails closed, logs out, and returns to the correct login', async ({ page }) => {
  let logoutRequests = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/customer-auth/session') {
      await fulfillJson(route, success({ session: customerSession('seller') }));
    } else if (path === '/api/customer-auth/logout') {
      logoutRequests += 1;
      await fulfillJson(route, success({
        logged_out: true,
        all_devices_logged_out: false,
      }));
    } else {
      await fulfillJson(route, failure('NOT_FOUND', 'browser-mismatch'), 404);
    }
  });
  await page.goto('/buyer');
  await expect(page.getByRole('heading', { name: '买家登录' })).toBeVisible();
  expect(logoutRequests).toBe(1);
});

test('403 state is durable, explicit, and retains a safe request ID', async ({ page }) => {
  await page.goto('/forbidden');
  await expect(page.getByRole('heading', { name: '无权访问' })).toBeVisible();
  await expect(page.getByText(/local-permission-request/u)).toBeVisible();
});

test('404 state does not disclose protected resource detail', async ({ page }) => {
  await page.goto('/not-a-route');
  await expect(page.getByRole('heading', { name: '页面未找到' })).toBeVisible();
  await expect(page.getByText(/无权了解它是否存在/u)).toBeVisible();
});

test('503 session state is persistent and carries request_id', async ({ page }) => {
  await page.route('**/api/customer-auth/session', (route) => fulfillJson(
    route,
    failure('DEPENDENCY_UNAVAILABLE', 'browser-503'),
    503,
  ));
  await page.goto('/buyer');
  await expect(page.getByRole('heading', { name: '服务暂时不可用' })).toBeVisible();
  await expect(page.getByText(/browser-503/u)).toBeVisible();
});

test('reduced-motion removes meaningful animation duration', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dependency-error');
  const duration = await page.locator('.state').evaluate((element) =>
    getComputedStyle(element).transitionDuration,
  );
  expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.00001);
});

test('200% equivalent text zoom reflows without critical horizontal clipping', async ({ page }) => {
  await mockApi(page, 'seller');
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto('/seller');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await expect(page.getByRole('heading', { name: '业务进度' })).toBeVisible();
  await expect(page.getByLabel('店铺与站点')).toBeVisible();
  await expectNoCriticalHorizontalOverflow(page);
});

for (const [width, height] of [
  [320, 720],
  [390, 844],
  [768, 1024],
  [1440, 900],
  [1600, 1000],
] as const) {
test(`${width}x${height} viewport retains the root notice without clipping`, async ({ page }) => {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '月光白' })).toBeVisible();
  await expectNoCriticalHorizontalOverflow(page);
});
}
