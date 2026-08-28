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

function customerSession(identity: 'buyer' | 'seller', passwordChangeRequired = false) {
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
    role: { code: 'pre_sales', display_name: '售前' },
    permissions: [],
    data_scope: {
      type: 'MARKETPLACE',
      marketplaceCodes: ['AMAZON_JP'],
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
      await fulfillJson(
        route,
        success(
          {
            logged_out: true,
            all_devices_logged_out: false,
          },
          'browser-customer-logout',
        ),
      );
      return;
    }
    if (identity === 'seller' && path === '/api/seller-portal/me') {
      await fulfillJson(
        route,
        success({
          me: {
            account_id: 'seller-local',
            member: {
              id: 'member-local',
              display_name: '本地卖家',
              role: 'OWNER',
              primary_owner: true,
            },
            organization: {
              id: 'org-local',
              seller_code: 'seller-local',
              name: '本地卖家组织',
              marketplace_code: 'AMAZON_JP',
              status: 'ACTIVE',
            },
            access: {
              read_scope: 'ORGANIZATION',
              store_ids: ['store-local'],
              can_submit_product_applications: true,
              can_submit_demand_batches: true,
            },
          },
        }),
      );
      return;
    }
    if (identity === 'seller' && path === '/api/seller-portal/stores') {
      await fulfillJson(
        route,
        success({
          items: [
            {
              id: 'store-local',
              marketplace_code: 'AMAZON_JP',
              canonical_marketplace_code: 'AMAZON_JP',
              transaction_currency_code: 'JPY',
              transaction_currency_exponent: 0,
              marketplace_status: 'ACTIVE',
              adapter_status: 'AVAILABLE',
              display_name: '日本一号店',
              status: 'ACTIVE',
              version: 1,
              created_at: 1,
              updated_at: 1,
            },
          ],
          page: { limit: 100, next_cursor: null },
        }),
      );
      return;
    }
    if (identity === 'seller' && path === '/api/seller-portal/formal-orders') {
      await fulfillJson(route, success({ items: [], page: { limit: 100, next_cursor: null } }));
      return;
    }
    if (identity === 'seller' && path === '/api/seller-portal/settlement/summary') {
      await fulfillJson(
        route,
        success({
          settlement: {
            outstanding_principal_cny_fen: '0',
            outstanding_service_fee_cny_fen: '0',
            total_outstanding_cny_fen: '0',
            unallocated_credit_cny_fen: '0',
          },
        }),
      );
      return;
    }
    if (
      identity === 'seller' &&
      [
        '/api/seller-portal/products',
        '/api/seller-portal/product-applications',
        '/api/seller-portal/demand-batches',
        '/api/seller-portal/reviews',
        '/api/seller-portal/settlement/payables',
      ].includes(path)
    ) {
      await fulfillJson(route, success({ items: [], page: { limit: 100, next_cursor: null } }));
      return;
    }
    if (path === '/api/staff-auth/logout') {
      await fulfillJson(
        route,
        success(
          {
            logged_out: true,
            all_devices_logged_out: false,
          },
          'browser-staff-logout',
        ),
      );
      return;
    }
    if (path === '/api/staff-auth/logout-all') {
      await fulfillJson(
        route,
        success(
          {
            logged_out: true,
            all_devices_logged_out: true,
            session_version: 2,
          },
          'browser-staff-logout-all',
        ),
      );
      return;
    }
          if (identity === 'staff' && path === '/api/staff/me/work-items/summary') {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { summary: {
          open_count: 0, due_today_count: 0, overdue_count: 0,
          exception_order_count: 0, refund_due_today_cny_fen: null,
          recent: [],
        } }, meta: { request_id: 'summary' } }) });
      }
if (identity === 'staff' && path === '/api/staff/me/work-items') {
      await fulfillJson(route, success({ work_items: [], next_cursor: null }));
      return;
    }
    await fulfillJson(route, failure('NOT_FOUND', 'browser-unhandled'), 404);
  });
}

async function mockSellerStatusRecords(page: Page): Promise<void> {
  const pageInfo = { limit: 100, next_cursor: null };
  await page.route('**/api/seller-portal/products**', (route) =>
    fulfillJson(
      route,
      success({
        items: (['ACTIVE', 'DISABLED'] as const).map((status, index) => ({
          id: `product-status-${status}`,
          store: { id: 'store-local', display_name: '日本一号店' },
          marketplace_code: 'AMAZON_JP',
          seller_code: 'seller-local',
          asin: `B0000000${index}`,
          status,
          current_version_no: 1,
          version: 1,
          created_at: 1,
          updated_at: 1,
          current_version: {
            id: `product-version-${status}`,
            version_no: 1,
            product_name: `商品${index + 1}`,
            search_keywords: [],
            ordering_guide_expected_amount_jpy: null,
            color_spec_mode: null,
            main_image: null,
            product_url: null,
            buyer_visible_notes: null,
            created_at: 1,
          },
        })),
        page: pageInfo,
      }),
    ),
  );
  await page.route('**/api/seller-portal/demand-batches**', (route) =>
    fulfillJson(
      route,
      success({
        items: (['SUBMITTED', 'PUBLISHED', 'REJECTED', 'WITHDRAWN', 'CLOSED'] as const).map(
          (status, index) => ({
            id: `demand-status-${status}`,
            store: { id: 'store-local', display_name: '日本一号店' },
            product: {
              id: 'product-status',
              version_no: 1,
              asin: 'B00000001',
              product_name: `需求商品${index + 1}`,
              search_keywords: [],
              product_url: null,
            },
            marketplace_code: 'AMAZON_JP',
            task_type: 'TEXT',
            target_quantity: 1,
            held_quantity: 0,
            approved_quantity: 0,
            remaining_quantity: 1,
            buyer_visible_notes: null,
            seller_notes: null,
            open_at: 1,
            reservation_deadline: 2,
            order_deadline: 3,
            status,
            review_reason: null,
            close_reason: null,
            version: 1,
            submitted_at: 1,
            updated_at: 1,
            reviewed_at: null,
            published_at: null,
            withdrawn_at: null,
            closed_at: null,
          }),
        ),
        page: pageInfo,
      }),
    ),
  );
  await page.route('**/api/seller-portal/reviews**', (route) =>
    fulfillJson(
      route,
      success({
        items: (
          ['PENDING_REVIEW', 'CHANGES_REQUESTED', 'REJECTED', 'WITHDRAWN', 'APPROVED'] as const
        ).map((status, index) => ({
          review_case_id: `review-status-${status}`,
          formal_order: { id: 'order-status', amazon_order_number: '111-1111111-1111111' },
          store: { id: 'store-local', display_name: '日本一号店' },
          marketplace_code: 'AMAZON_JP',
          asin: 'B00000001',
          product_name: `评论商品${index + 1}`,
          review_type: 'TEXT',
          status,
          version: 1,
          review_url: null,
          submitted_at: 1,
          approved_at: null,
          evidence: { version_id: `evidence-${status}`, version_no: 1, submitted_at: 1, files: [] },
          service_fee_accrued: null,
          allowed_actions: ['VIEW'],
        })),
        page: pageInfo,
      }),
    ),
  );
}

async function mockSellerSubmissions(page: Page, failFirstUpload = false) {
  const state: {
    intentCount: number;
    uploadAttempts: number;
    applicationBodies: unknown[];
    demandBodies: unknown[];
    applicationWithdrawBodies: unknown[];
    demandWithdrawBodies: unknown[];
  } = {
    intentCount: 0,
    uploadAttempts: 0,
    applicationBodies: [],
    demandBodies: [],
    applicationWithdrawBodies: [],
    demandWithdrawBodies: [],
  };
  const product = {
    id: 'product-new',
    store: { id: 'store-local', display_name: '日本一号店' },
    marketplace_code: 'AMAZON_JP',
    seller_code: 'seller-local',
    asin: 'B000000001',
    status: 'ACTIVE',
    current_version_no: 1,
    version: 1,
    created_at: 1,
    updated_at: 1,
    current_version: {
      id: 'product-version-new',
      version_no: 1,
      product_name: '已通过产品',
      search_keywords: [],
      ordering_guide_expected_amount_jpy: null,
      color_spec_mode: null,
      main_image: null,
      product_url: null,
      buyer_visible_notes: null,
      created_at: 1,
    },
  };
  const application = {
    id: 'application-new',
    store: product.store,
    marketplace_code: 'AMAZON_JP',
    asin: 'B000000002',
    product_name: '新品申请',
    search_keywords: ['关键词一', '关键词二'],
    product_url: null,
    buyer_visible_notes: null,
    seller_notes: null,
    status: 'SUBMITTED',
    review_reason: null,
    product_id: null,
    version: 1,
    submitted_at: 1,
    updated_at: 1,
    reviewed_at: null,
    withdrawn_at: null,
  };
  const demand = {
    id: 'demand-new',
    store: product.store,
    product: {
      id: product.id,
      version_no: 1,
      asin: product.asin,
      product_name: product.current_version.product_name,
      search_keywords: [],
      product_url: null,
    },
    marketplace_code: 'AMAZON_JP',
    task_type: 'IMAGE',
    target_quantity: 8,
    held_quantity: 0,
    approved_quantity: 0,
    remaining_quantity: 8,
    buyer_visible_notes: null,
    seller_notes: null,
    open_at: 1_786_236_000_000,
    reservation_deadline: 1_786_322_400_000,
    order_deadline: 1_786_408_800_000,
    status: 'SUBMITTED',
    review_reason: null,
    close_reason: null,
    version: 1,
    submitted_at: 1,
    updated_at: 1,
    reviewed_at: null,
    published_at: null,
    withdrawn_at: null,
    closed_at: null,
  };
  await page.route('**/api/seller-portal/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/seller-portal/products') {
      await fulfillJson(
        route,
        success({ items: [product], page: { limit: 100, next_cursor: null } }),
      );
      return;
    }
    if (path === '/api/seller-portal/file-uploads/product-application-images/intents') {
      state.intentCount += 1;
      await fulfillJson(
        route,
        success({
          upload_intent_id: 'application-intent',
          purpose: 'PRODUCT_APPLICATION_IMAGE',
          visibility: 'SELLER_VISIBLE',
          status: 'ISSUED',
          version: 1,
          expires_at: 9_999_999_999_999,
          uploads: [
            {
              file_object_id: 'application-file',
              slot_no: 1,
              upload_token: 'u'.repeat(40),
              upload_token_available: true,
              expires_at: 9_999_999_999_999,
            },
          ],
          replayed: false,
        }),
        201,
      );
      return;
    }
    if (path === '/api/seller-portal/file-uploads/application-file/content') {
      state.uploadAttempts += 1;
      if (failFirstUpload && state.uploadAttempts === 1) {
        await fulfillJson(route, failure('DEPENDENCY_UNAVAILABLE', 'seller-upload-retry'), 503);
        return;
      }
      await fulfillJson(
        route,
        success({
          file_object_id: 'application-file',
          upload_intent_id: 'application-intent',
          status: 'UPLOADED',
          detected_mime: 'image/png',
          byte_size: 3,
          sha256: 'a'.repeat(64),
          version: 2,
          replayed: false,
        }),
      );
      return;
    }
    if (path === '/api/seller-portal/file-upload-intents/application-intent/complete') {
      await fulfillJson(
        route,
        success({
          upload_intent_id: 'application-intent',
          status: 'VERIFIED',
          version: 2,
          files: [
            {
              file_object_id: 'application-file',
              purpose: 'PRODUCT_APPLICATION_IMAGE',
              visibility: 'SELLER_VISIBLE',
              detected_mime: 'image/png',
              byte_size: 3,
              sha256: 'a'.repeat(64),
              version: 3,
            },
          ],
          replayed: false,
        }),
      );
      return;
    }
    if (path === '/api/seller-portal/product-applications' && request.method() === 'POST') {
      state.applicationBodies.push(request.postDataJSON());
      await fulfillJson(route, success({ application, replayed: false }), 201);
      return;
    }
    if (path === '/api/seller-portal/product-applications' && request.method() === 'GET') {
      await fulfillJson(
        route,
        success({ items: [application], page: { limit: 100, next_cursor: null } }),
      );
      return;
    }
    if (path === '/api/seller-portal/product-applications/application-new') {
      await fulfillJson(route, success({ application }));
      return;
    }
    if (path === '/api/seller-portal/product-applications/application-new/withdraw') {
      state.applicationWithdrawBodies.push(request.postDataJSON());
      await fulfillJson(
        route,
        success({
          application: {
            ...application,
            status: 'WITHDRAWN',
            version: 2,
            updated_at: 2,
            withdrawn_at: 2,
          },
          replayed: false,
        }),
      );
      return;
    }
    if (path === '/api/seller-portal/demand-batches' && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.demandBodies.push(body);
      await fulfillJson(
        route,
        success({
          demand_batch: {
            ...demand,
            task_type: body['task_type'],
            target_quantity: body['target_quantity'],
            remaining_quantity: body['target_quantity'],
            buyer_visible_notes: body['buyer_visible_notes'],
            seller_notes: body['seller_notes'],
            open_at: body['open_at'],
            reservation_deadline: body['reservation_deadline'],
            order_deadline: body['order_deadline'],
          },
          replayed: false,
        }),
        201,
      );
      return;
    }
    if (path === '/api/seller-portal/demand-batches' && request.method() === 'GET') {
      await fulfillJson(
        route,
        success({ items: [demand], page: { limit: 100, next_cursor: null } }),
      );
      return;
    }
    if (path === '/api/seller-portal/demand-batches/demand-new/withdraw') {
      state.demandWithdrawBodies.push(request.postDataJSON());
      await fulfillJson(
        route,
        success({
          demand_batch: {
            ...demand,
            status: 'WITHDRAWN',
            version: 2,
            updated_at: 2,
            withdrawn_at: 2,
          },
          replayed: false,
        }),
      );
      return;
    }
    await route.fallback();
  });
  return state;
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
  await expect(page.getByText('请使用工作人员发给您的专属链接登录。')).toBeVisible();
  await expect(page.getByRole('link')).toHaveCount(0);
  await expect(page.getByRole('button')).toHaveCount(0);
  await expect(page.locator('form')).toHaveCount(0);
  await expect(page.locator('.dedicated-entry')).toHaveText(
    '月光白请使用工作人员发给您的专属链接登录。',
  );
  await expect(page.getByText('专属访问')).toHaveCount(0);
  await expect(page.getByText('链接将自动确认您的访问身份')).toHaveCount(0);
  await expect(page.getByText('月', { exact: true })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/Moonlight|Moonlight White|V2/u);
});

for (const [path, other] of [
  ['/buyer/login', 'buyer'],
  ['/seller/login', 'seller'],
] as const) {
  test(`${path} renders a polished customer login with no cross-identity entry`, async ({
    page,
  }) => {
    await page.goto(path);
    await expect(page.getByText('月光白')).toBeVisible();
    await expect(page.getByLabel('账号')).toBeVisible();
    await expect(page.getByLabel('密码')).toBeVisible();
    await expect(page.getByRole('button', { name: '登录' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(
      other === 'buyer' ? '卖家登录' : '买家登录',
    );
    await expect(page.getByLabel('进入身份')).toHaveCount(0);
  });
}

test('legacy customer login path cannot silently select the Buyer identity', async ({ page }) => {
  await page.goto('/customer/login');
  await expect(page.getByRole('heading', { name: '页面未找到' })).toBeVisible();
  await expect(page.getByRole('button', { name: '登录' })).toHaveCount(0);
});

test('staff login uses Cloudflare Access and has no customer form', async ({ page }) => {
  await page.goto('/staff/login');
  await expect(page.getByRole('heading', { name: '员工登录' })).toBeVisible();
  await expect(page.getByRole('button', { name: '进入员工后台' })).toBeVisible();
  await expect(page.getByLabel('账号')).toHaveCount(0);
  await expect(page.getByLabel('密码')).toHaveCount(0);
  await expect(page.getByText(/Cloudflare Access 邮箱验证码验证/u)).toBeVisible();
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
  await expect(page.getByRole('button', { name: '登录' })).toBeFocused();
});

for (const [identity, path] of [
  ['buyer', '/buyer/change-password'],
  ['seller', '/seller/change-password'],
] as const) {
  test(`${identity} password change renders only after a matching session`, async ({ page }) => {
    await mockApi(page, identity);
    await page.goto(path);
    await expect(page.getByRole('heading', { name: '修改密码' })).toBeVisible();
    await expect(page.getByLabel('当前密码')).toBeVisible();
    await expect(page.getByLabel('新密码', { exact: true })).toBeVisible();
    await expect(page.getByLabel('确认新密码', { exact: true })).toBeVisible();
  });
}

test('password_change_required routes Buyer to the password flow', async ({ page }) => {
  await page.route('**/api/customer-auth/session', (route) =>
    fulfillJson(route, success({ session: customerSession('buyer', true) })),
  );
  await page.goto('/buyer');
  await expect(page).toHaveURL(/\/buyer\/change-password$/u);
  await expect(page.getByRole('heading', { name: '修改密码' })).toBeVisible();
});

test('Buyer shell is product-focused with three fixed items and no fake business data', async ({
  page,
}) => {
  await mockApi(page, 'buyer');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/buyer');
  const navigation = page.getByRole('navigation', { name: '买家导航' });
  await expect(navigation.getByRole('link')).toHaveCount(3);
  for (const label of ['产品', '任务', '我的']) {
    await expect(navigation.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: '当前开放产品', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '暂时无法读取内容' })).toBeVisible();
  await expectNoCriticalHorizontalOverflow(page);
});

test('Buyer shell keeps navigation clear at 320px and safe content padding', async ({ page }) => {
  await mockApi(page, 'buyer');
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/buyer/products');
  await expect(page.getByRole('heading', { name: '当前开放产品', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '买家导航' })).toBeVisible();
  await expectNoCriticalHorizontalOverflow(page);
});

test('Seller shell exposes organization/store context and truthful business metrics', async ({
  page,
}) => {
  await mockApi(page, 'seller');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/seller');
  await expect(page.getByRole('navigation', { name: '卖家导航' })).toBeVisible();
  await expect(page.getByLabel('店铺', { exact: true })).toBeVisible();
  await expect(page.getByText(/本地卖家组织/u)).toBeVisible();
  for (const label of ['正式订单', '业务完成', '待结算'])
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  await expect(page.getByText('状态来自服务器业务事实；结算确认由员工控制。')).toHaveCount(0);
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
      'aria-current',
      'page',
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

test('Seller record pages render every frozen status in Chinese without exposing status codes', async ({
  page,
}) => {
  await mockApi(page, 'seller');
  await mockSellerStatusRecords(page);
  const rawStatus =
    /ACTIVE|DISABLED|SUBMITTED|PUBLISHED|REJECTED|WITHDRAWN|CLOSED|PENDING_REVIEW|CHANGES_REQUESTED|APPROVED/u;

  await page.goto('/seller/products');
  for (const label of ['启用中', '已停用']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.locator('.seller-record-list')).not.toContainText(rawStatus);

  await page.goto('/seller/demands');
  for (const label of ['待审核', '已发布', '未通过', '已撤回', '已关闭']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.locator('.seller-record-list')).not.toContainText(rawStatus);

  await page.goto('/seller/reviews');
  for (const label of ['待审核', '需修改', '未通过', '已撤回', '已通过']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.locator('.seller-record-list')).not.toContainText(rawStatus);
});

test('Seller product application recovers one upload and reuses the verified manifest', async ({
  page,
}) => {
  await mockApi(page, 'seller');
  const state = await mockSellerSubmissions(page, true);
  await page.goto('/seller/products/new');
  await page.locator('#application-store').selectOption('store-local');
  await page.getByLabel('产品标识').fill('B000000002');
  await page.getByLabel('中文名').fill('新品申请');
  await page.getByLabel('搜索词').fill('关键词一，关键词二');
  await page
    .getByLabel('申请图片')
    .setInputFiles({ name: 'product.png', mimeType: 'image/png', buffer: Buffer.from('png') });
  await page.getByRole('button', { name: '提交申请' }).click();
  await expect(page.getByRole('button', { name: '继续上传' })).toBeVisible();
  await page.getByRole('button', { name: '继续上传' }).click();
  await expect(page.getByRole('button', { name: '继续上传' })).toHaveCount(0);
  await page.getByRole('button', { name: '提交申请' }).click();
  await expect(page).toHaveURL(/\/seller\/products\/application-new$/u);
  expect(state.intentCount).toBe(1);
  expect(state.uploadAttempts).toBe(2);
  expect(state.applicationBodies).toEqual([
    {
      store_id: 'store-local',
      asin: 'B000000002',
      product_name: '新品申请',
      search_keywords: ['关键词一', '关键词二'],
      product_url: null,
      buyer_visible_notes: null,
      seller_notes: null,
      image_files: [{ file_object_id: 'application-file', expected_file_version: 3 }],
    },
  ]);
});

test('Seller demand form submits a new batch with Beijing time values', async ({ page }) => {
  await mockApi(page, 'seller');
  const state = await mockSellerSubmissions(page);
  await page.goto('/seller/demands/new');
  await page.getByLabel('已通过产品').selectOption('product-new');
  await page.getByLabel('任务类型').selectOption('IMAGE');
  await page.getByLabel('目标数量').fill('8');
  await page.getByLabel('开放时间（北京时间）').fill('2026-08-09T09:00');
  await page.getByLabel('预约截止（北京时间）').fill('2026-08-10T09:00');
  await page.getByLabel('下单截止（北京时间）').fill('2026-08-11T09:00');
  await page.getByRole('button', { name: '提交需求' }).click();
  await expect(page).toHaveURL(/\/seller\/demands$/u);
  expect(state.demandBodies).toEqual([
    {
      product_id: 'product-new',
      task_type: 'IMAGE',
      target_quantity: 8,
      open_at: Date.parse('2026-08-09T09:00:00+08:00'),
      reservation_deadline: Date.parse('2026-08-10T09:00:00+08:00'),
      order_deadline: Date.parse('2026-08-11T09:00:00+08:00'),
      buyer_visible_notes: null,
      seller_notes: null,
    },
  ]);
});

test('Seller withdrawals require confirmation and submit the server version', async ({ page }) => {
  await mockApi(page, 'seller');
  const state = await mockSellerSubmissions(page);
  await page.goto('/seller/products');
  await page.getByRole('button', { name: '撤回申请' }).click();
  const applicationDialog = page.getByRole('dialog', { name: '撤回产品申请' });
  await expect(applicationDialog).toBeVisible();
  expect(state.applicationWithdrawBodies).toEqual([]);
  await applicationDialog.getByRole('button', { name: '确认撤回' }).click();
  await expect(applicationDialog).toHaveCount(0);
  expect(state.applicationWithdrawBodies).toEqual([{ expected_version: 1 }]);

  await page.goto('/seller/demands');
  await page.getByRole('button', { name: '撤回需求' }).click();
  const demandDialog = page.getByRole('dialog', { name: '撤回需求' });
  await expect(demandDialog).toBeVisible();
  expect(state.demandWithdrawBodies).toEqual([]);
  await demandDialog.getByRole('button', { name: '确认撤回' }).click();
  await expect(demandDialog).toHaveCount(0);
  expect(state.demandWithdrawBodies).toEqual([{ expected_version: 1 }]);
});

test('Seller store context is keyboard operable and remains visible', async ({ page }) => {
  await mockApi(page, 'seller');
  await page.goto('/seller');
  const context = page.getByLabel('店铺', { exact: true });
  await context.focus();
  await expect(context).toBeFocused();
  await context.selectOption('store-local');
  await expect(context).toHaveValue('store-local');
});

test('Seller small screen uses the business dashboard without page overflow', async ({ page }) => {
  await mockApi(page, 'seller');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/seller');
  await expect(page.getByRole('heading', { name: '业务进度', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '卖家导航' })).toBeVisible();
  await expectNoCriticalHorizontalOverflow(page);
});

test('Staff desktop shell preserves the two-section task queue DOM order', async ({
  page,
}) => {
  await mockApi(page, 'staff');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '任务队列' })).toBeVisible();
  await expect(page.locator('#staff-queue-mine')).toBeVisible();
  await expect(page.locator('#staff-queue-claimable')).toBeVisible();
  await expect(page.getByRole('button', { name: '刷新' })).toBeVisible();
  await expectNoCriticalHorizontalOverflow(page);
});

test('Staff narrow shell keeps the task queue operable without overflow', async ({ page }) => {
  await mockApi(page, 'staff');
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '任务队列' })).toBeVisible();
  await page.getByRole('button', { name: '刷新' }).focus();
  await expect(page.getByRole('button', { name: '刷新' })).toBeFocused();
  await expect(page.locator('.staff-sidebar .staff-account-actions')).toBeVisible();
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
  await page.route('**/api/customer-auth/session', (route) =>
    fulfillJson(route, failure('UNAUTHENTICATED', 'browser-401'), 401),
  );
  await page.goto('/buyer/orders');
  await expect(page.getByText('月光白')).toBeVisible();
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
      await fulfillJson(
        route,
        success({
          logged_out: true,
          all_devices_logged_out: false,
        }),
      );
    } else {
      await fulfillJson(route, failure('NOT_FOUND', 'browser-mismatch'), 404);
    }
  });
  await page.goto('/buyer');
  await expect(page.getByText('月光白')).toBeVisible();
  expect(logoutRequests).toBe(1);
});

test('403 state is durable, explicit, and retains a safe request ID', async ({ page }) => {
  await page.goto('/forbidden');
  await expect(page.getByRole('heading', { name: '无权访问' })).toBeVisible();
  await expect(page.getByText(/local-permission-request/u)).toBeVisible();
});

test('identity chunk failure is Chinese, hides protected content, and retries only after an explicit reload', async ({
  page,
}) => {
  let chunkRequests = 0;
  await mockApi(page, 'buyer');
  await page.route('**/assets/BuyerRouteModule-*.js', async (route) => {
    chunkRequests += 1;
    if (chunkRequests === 1) {
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await page.goto('/buyer');
  await expect(page.getByRole('heading', { name: '页面内容暂时无法加载' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '当前开放产品', exact: true })).toHaveCount(0);
  expect(chunkRequests).toBe(1);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.getByRole('button', { name: '重新加载整页' }).click(),
  ]);
  await expect(page.getByRole('heading', { name: '当前开放产品', exact: true })).toBeVisible();
  expect(chunkRequests).toBe(2);
});

for (const [identity, path, heading, ownChunk, foreignChunks] of [
  [
    'buyer',
    '/buyer',
    '当前开放产品',
    'BuyerRouteModule-',
    ['SellerRouteModule-', 'StaffRouteModule-'],
  ],
  [
    'seller',
    '/seller',
    '业务进度',
    'SellerRouteModule-',
    ['BuyerRouteModule-', 'StaffRouteModule-'],
  ],
  [
    'staff',
    '/staff',
    '工作台',
    'StaffRouteModule-',
    ['BuyerRouteModule-', 'SellerRouteModule-'],
  ],
] as const) {
  test(`${identity} only downloads its own protected route chunk`, async ({ page }) => {
    const assets: string[] = [];
    page.on('request', (request) => {
      const asset = request.url().split('/').at(-1) ?? '';
      if (asset.endsWith('.js')) assets.push(asset);
    });
    await mockApi(page, identity);
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    expect(assets.some((asset) => asset.includes(ownChunk))).toBe(true);
    for (const foreignChunk of foreignChunks)
      expect(assets.some((asset) => asset.includes(foreignChunk))).toBe(false);
  });
}

test('buyer product defers order materials and after-sales chunks until their routes open', async ({
  page,
}) => {
  const assets: string[] = [];
  page.on('request', (request) => {
    const asset = request.url().split('/').at(-1) ?? '';
    if (asset.endsWith('.js')) assets.push(asset);
  });
  await mockApi(page, 'buyer');
  await page.goto('/buyer/products');
  await expect(page.getByRole('heading', { name: '当前开放产品', exact: true })).toBeVisible();
  expect(assets.some((asset) => asset.includes('BuyerOrderRouteModule-'))).toBe(false);
  expect(assets.some((asset) => asset.includes('BuyerAfterSalesRouteModule-'))).toBe(false);
  expect(assets.some((asset) => asset.includes('BuyerInstructionRouteModule-'))).toBe(false);

  await page.goto('/buyer/reviews');
  await expect(page.getByRole('heading', { name: '评论资料', exact: true })).toBeVisible();
  expect(assets.some((asset) => asset.includes('BuyerAfterSalesRouteModule-'))).toBe(true);
  expect(assets.some((asset) => asset.includes('BuyerOrderRouteModule-'))).toBe(false);

  await page.goto('/buyer/order-materials');
  await expect(page.getByRole('heading', { name: '订单资料', exact: true })).toBeVisible();
  expect(assets.some((asset) => asset.includes('BuyerOrderRouteModule-'))).toBe(true);

  await page.goto('/buyer/reservations/reservation-local/instruction');
  await expect
    .poll(() => assets.some((asset) => asset.includes('BuyerInstructionRouteModule-')))
    .toBe(true);
});

test('seller dashboard defers submission and file-upload chunks until a submission route opens', async ({
  page,
}) => {
  const assets: string[] = [];
  page.on('request', (request) => {
    const asset = request.url().split('/').at(-1) ?? '';
    if (asset.endsWith('.js')) assets.push(asset);
  });
  await mockApi(page, 'seller');
  await page.goto('/seller');
  await expect(page.getByRole('heading', { name: '业务进度', exact: true })).toBeVisible();
  expect(assets.some((asset) => asset.includes('SellerSubmissionRouteModule-'))).toBe(false);
  expect(assets.some((asset) => asset.includes('useFileUpload-'))).toBe(false);

  await page.goto('/seller/products/new');
  await expect(page.getByRole('heading', { name: '提交产品申请', exact: true })).toBeVisible();
  expect(assets.some((asset) => asset.includes('SellerSubmissionRouteModule-'))).toBe(true);
  expect(assets.some((asset) => asset.includes('useFileUpload-'))).toBe(true);
});

test('staff workbench defers dashboard and scheduling chunks until their routes open', async ({
  page,
}) => {
  const assets: string[] = [];
  page.on('request', (request) => {
    const asset = request.url().split('/').at(-1) ?? '';
    if (asset.endsWith('.js')) assets.push(asset);
  });
  await mockApi(page, 'staff');
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
  expect(assets.some((asset) => asset.includes('StaffAdminRouteModule-'))).toBe(false);
  expect(assets.some((asset) => asset.includes('StaffSchedulingRouteModule-'))).toBe(false);

  await page.goto('/staff/admin-business-dashboard');
  await expect(page.getByText('只有总管理员可以查看经营看板。')).toBeVisible();
  expect(assets.some((asset) => asset.includes('StaffAdminRouteModule-'))).toBe(true);
  expect(assets.some((asset) => asset.includes('StaffSchedulingRouteModule-'))).toBe(false);

  await page.goto('/staff/products');
  await expect(page.getByText('当前角色无权查看产品排期')).toBeVisible();
  expect(assets.some((asset) => asset.includes('StaffSchedulingRouteModule-'))).toBe(true);
});

test('404 state does not disclose protected resource detail', async ({ page }) => {
  await page.goto('/not-a-route');
  await expect(page.getByRole('heading', { name: '页面未找到' })).toBeVisible();
  await expect(page.getByText(/无权了解它是否存在/u)).toBeVisible();
});

test('503 session state is persistent and carries request_id', async ({ page }) => {
  await page.route('**/api/customer-auth/session', (route) =>
    fulfillJson(route, failure('DEPENDENCY_UNAVAILABLE', 'browser-503'), 503),
  );
  await page.goto('/buyer');
  await expect(page.getByRole('heading', { name: '服务暂时不可用' })).toBeVisible();
  await expect(page.getByText(/browser-503/u)).toBeVisible();
});

test('reduced-motion removes meaningful animation duration', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dependency-error');
  const duration = await page
    .locator('.state')
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.00001);
});

test('200% equivalent text zoom reflows without critical horizontal clipping', async ({ page }) => {
  await mockApi(page, 'seller');
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto('/seller');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await expect(page.getByRole('heading', { name: '业务进度', exact: true })).toBeVisible();
  await expect(page.getByLabel('店铺', { exact: true })).toBeVisible();
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
