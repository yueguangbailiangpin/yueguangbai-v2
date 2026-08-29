import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Stage 7.5 batch 2 browser verification: buyer stage contact cards
 * (configured and unconfigured channels, no internal staff fields), the
 * Owner-only company service channel settings page, and the seller product
 * primary-contact display. All APIs are mocked deterministically.
 */

const directory = process.env['STAGE75_CONTACTS_SCREENSHOT_DIR']
  ?? 'tmp/stage75-contacts-screenshots';

type Portal = 'buyer' | 'staff-owner' | 'staff-pre' | 'seller';

function staffSession(role: 'owner' | 'pre_sales') {
  return {
    staff_id: `stage75c-${role}`,
    display_name: role === 'owner' ? '总管理员' : '售前甲',
    role: { code: role, display_name: role === 'owner' ? '总管理员' : '售前' },
    permissions: role === 'owner'
      ? ['ORDER_VIEW', 'STAFF_MANAGE', 'PERMISSION_MANAGE', 'PRODUCT_VIEW']
      : ['ORDER_VIEW', 'PRODUCT_VIEW'],
    data_scope: {
      type: 'GLOBAL',
      marketplaceCodes: [],
      buyerCustomerIds: [],
      sellerOrganizationIds: [],
      teamIds: [],
    },
    authorization_version: 1,
    session_version: 1,
    expires_at: 9_999_999_999_999,
  };
}

function ok(data: unknown, requestId = 'stage75c') {
  return {
    contentType: 'application/json',
    body: JSON.stringify({ data, meta: { request_id: requestId } }),
  };
}

const channelsConfigured = [
  {
    code: 'BUYER_PRE_SALES',
    display_name: '售前客服',
    wechat_id: 'ygb-pre-sales',
    qr_file: null,
    version: 2,
    updated_at: 1_788_000_000_000,
  },
  {
    code: 'BUYER_AFTER_SALES',
    display_name: '售后客服',
    wechat_id: null,
    qr_file: null,
    version: 1,
    updated_at: 0,
  },
];

async function mockApis(page: Page, portal: Portal): Promise<void> {
  await page.route('**/api/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/staff-auth/session')) {
      await route.fulfill(ok({ session: staffSession(portal === 'staff-owner' ? 'owner' : 'pre_sales') }));
      return;
    }
    if (path.endsWith('/access/bootstrap')) {
      await route.fulfill(ok({
        session: staffSession(portal === 'staff-owner' ? 'owner' : 'pre_sales'),
        access_email: 'stage75c@example.test',
      }));
      return;
    }
    if (path === '/api/buyer-portal/service-channels') {
      // Buyer projection: public fields only.
      await route.fulfill(ok({
        channels: channelsConfigured.map((channel) => ({
          code: channel.code,
          display_name: channel.display_name,
          wechat_id: channel.wechat_id,
          qr_file: channel.qr_file,
        })),
      }));
      return;
    }
    if (path === '/api/staff/service-channels') {
      await route.fulfill(ok({ channels: channelsConfigured }));
      return;
    }
    if (path === '/api/buyer-portal/me') {
      await route.fulfill(ok({
        assigned_contacts: {
          pre_sales_owner_display_name: '售前甲',
          refund_owner_display_name: null,
        },
        buyer: {
          display_name: '联系人买家',
          marketplace_code: 'AMAZON_JP',
          identity_review_status: 'CLEAR',
          customer_number: '20260829B90001',
          refund_account_name: null,
          refund_account_identifier: null,
        },
      }));
      return;
    }
    if (path === '/api/buyer-portal/reservations') {
      await route.fulfill(ok({
        items: [{
          reservation_id: 'res-75c',
          status: 'APPROVED',
          updated_at: 1_787_900_000_000,
          demand: { product_name: '联系人测试产品' },
        }],
        next_cursor: null,
      }));
      return;
    }
    if (path === '/api/buyer-portal/formal-orders') {
      await route.fulfill(ok({ items: [], next_cursor: null }));
      return;
    }
    if (path === '/api/seller-portal/product-applications'
      || path === '/api/seller-portal/stores') {
      await route.fulfill(ok({
        items: [],
        page: { limit: 100, next_cursor: null },
      }));
      return;
    }
    if (path === '/api/seller-portal/products') {
      await route.fulfill(ok({
        items: [{
          id: 'prod-75c',
          store: { id: 'store-75c', display_name: '联系人店铺' },
          marketplace_code: 'AMAZON_JP',
          seller_code: 'seller-75c',
          asin: 'B0CONTACT01',
          status: 'ACTIVE',
          current_version_no: 1,
          version: 1,
          created_at: 1_787_000_000_000,
          updated_at: 1_787_000_000_000,
          primary_contact_member_id: 'member-75c',
          primary_contact_member_name: '店铺对接人',
          current_version: {
            id: 'pv-75c',
            version_no: 1,
            product_name: '联系人测试产品',
            search_keywords: [],
            ordering_guide_expected_amount_jpy: 1980,
            color_spec_mode: 'MAIN_IMAGE_VARIANT',
            main_image: null,
            product_url: null,
            buyer_visible_notes: null,
            created_at: 1_787_000_000_000,
          },
        }],
        page: { limit: 100, next_cursor: null },
      }));
      return;
    }
    if (path.endsWith('/api/staff/me/work-items/summary')) {
      await route.fulfill(ok({
        summary: {
          open_count: 0, due_today_count: 0, overdue_count: 0,
          exception_order_count: 0, refund_due_today_cny_fen: null, recent: [],
        },
      }));
      return;
    }
    if (path.endsWith('/api/staff/me/work-items')) {
      await route.fulfill(ok({ work_items: [], next_cursor: null }));
      return;
    }
    if (path.endsWith('/api/staff/search')) {
      await route.fulfill(ok({ query: '', buyers: [], products: [], orders: [], demands: [] }));
      return;
    }
    if (path === '/api/customer-auth/session') {
      await route.fulfill(ok({
        session: {
          account_id: 'stage75c-account',
          identity_subject_id: 'stage75c-subject',
          account_type: portal === 'seller' ? 'SELLER_MEMBER' : 'BUYER',
          session_version: 1,
          password_change_required: false,
          issued_at: 1_787_000_000_000,
          expires_at: 9_999_999_999_999,
        },
      }));
      return;
    }
    if (path === '/api/seller-portal/me') {
      await route.fulfill(ok({
        me: {
          account_id: 'stage75c-account',
          member: { id: 'member-75c', display_name: '店铺对接人', role: 'OWNER', primary_owner: true },
          organization: {
            id: 'org-75c',
            seller_code: 'YG-75C01',
            name: '联系人卖家',
            marketplace_code: 'AMAZON_JP',
            status: 'ACTIVE',
            settlement_account_name: null,
            settlement_account_identifier: null,
          },
          access: {
            read_scope: 'ORGANIZATION',
            store_ids: ['store-75c'],
            can_submit_product_applications: false,
            can_submit_demand_batches: false,
          },
        },
      }));
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
}

async function loginAs(page: Page, portal: Portal): Promise<void> {
  await mockApis(page, portal);
  const target = portal === 'buyer' ? '/buyer/reservations'
    : portal === 'seller' ? '/seller/products'
      : portal === 'staff-owner' ? '/staff/service-channels'
        : '/staff/service-channels';
  await page.goto(target);
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.beforeAll(() => {
  mkdirSync(directory, { recursive: true });
});

test('买家预约页显示售前联系卡（已配置渠道显示微信号）', async ({ page }) => {
  await loginAs(page, 'buyer');
  await expect(page.getByText('售前联系人')).toBeVisible();
  await expect(page.getByText('当前负责工作人员', { exact: true })).toBeVisible();
  await expect(page.getByText('售前甲')).toBeVisible();
  await expect(page.getByText('ygb-pre-sales')).toBeVisible();
  // 未配置的售后渠道不影响本页；页面不得出现任何内部字段。
  const body = page.locator('body');
  await expect(body).not.toContainText('staff_id');
  await expect(body).not.toContainText('@example');
  await noHorizontalOverflow(page);
});

test('买家订单页售后渠道未配置时显示兜底文案', async ({ page }) => {
  await loginAs(page, 'buyer');
  await page.goto('/buyer/orders');
  await expect(page.getByText('售后联系人')).toBeVisible();
  await expect(page.getByText('请联系工作人员').first()).toBeVisible();
});

// Stage 7.5R: the QR renders through the controlled read-intent chain and
// never leaks a bare internal file id into the DOM.
test('买家预约页二维码经受控读取链渲染且不泄露文件编号', async ({ page }) => {
  await loginAs(page, 'buyer');
  await page.route('**/api/buyer-portal/service-channels', async (route) => {
    await route.fulfill(ok({
      channels: [
        {
          code: 'BUYER_PRE_SALES',
          display_name: '售前客服',
          wechat_id: 'ygb-pre-sales',
          qr_file: {
            file_object_id: 'fqr-75c',
            file_version: 1,
            purpose: 'SERVICE_CHANNEL_QR',
            visibility: 'BUYER_VISIBLE',
          },
        },
        { code: 'BUYER_AFTER_SALES', display_name: '售后客服', wechat_id: null, qr_file: null },
      ],
    }));
  });
  await page.route('**/api/buyer-portal/files/fqr-75c/read-intents', async (route) => {
    await route.fulfill(ok({
      read_intent_id: 'ri-75c',
      file_object_id: 'fqr-75c',
      access_token: 't'.repeat(48),
      access_token_available: true,
      expires_at: 9_999_999_999_999,
      replayed: false,
    }));
  });
  await page.route('**/api/buyer-portal/file-read-intents/ri-75c/content', async (route) => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(png.byteLength),
        'Cache-Control': 'private, max-age=60',
        'X-Content-Type-Options': 'nosniff',
      },
      body: png,
    });
  });
  await page.goto('/buyer/reservations');
  await expect(page.getByText('扫二维码添加售前客服')).toBeVisible();
  await expect(page.locator('img.stage-contact-qr-image')).toBeVisible();
  const body = page.locator('body');
  await expect(body).not.toContainText('fqr-75c');
  await noHorizontalOverflow(page);
});

test('Owner 客服渠道设置页渲染两渠道并保存更新', async ({ page }) => {
  await loginAs(page, 'staff-owner');
  await expect(page.getByText('公司公开客服渠道')).toBeVisible();
  await expect(page.getByText('售前客服（预约、订单资料阶段）')).toBeVisible();
  await expect(page.getByText('售后客服（评论、返款、正式售后阶段）')).toBeVisible();

  let savedBody = '';
  await page.route('**/api/staff/service-channels/BUYER_AFTER_SALES', async (route) => {
    if (route.request().method() === 'PUT') {
      savedBody = route.request().postData() ?? '';
      await route.fulfill({
        status: 201,
        ...ok({
          channel: {
            code: 'BUYER_AFTER_SALES',
            display_name: '售后客服',
            wechat_id: 'ygb-after-sales',
            qr_file: null,
            version: 2,
            updated_at: 1_788_000_100_000,
          },
          replayed: false,
        }),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await page.locator('#channel-wechat-BUYER_AFTER_SALES').fill('ygb-after-sales');
  await page.locator('#channel-reason-BUYER_AFTER_SALES').fill('stage75 e2e 配置真实渠道');
  await page.locator('#channel-reason-BUYER_AFTER_SALES')
    .locator('..')
    .locator('..')
    .getByRole('button', { name: '保存渠道配置' }).click();
  await expect(page.getByText('客服渠道配置已更新。')).toBeVisible();
  expect(savedBody).toContain('ygb-after-sales');
  expect(savedBody).toContain('"expected_version":1');
});

test('客服渠道设置页对非 Owner 显示无权提示', async ({ page }) => {
  await loginAs(page, 'staff-pre');
  await expect(page.getByText('只有总管理员可以修改公司公开客服渠道。')).toBeVisible();
});

test('卖家产品页显示主要对接人', async ({ page }) => {
  await loginAs(page, 'seller');
  await expect(page.getByText('商品与申请')).toBeVisible();
  await expect(page.getByText('主要对接人')).toBeVisible();
  await expect(page.getByText('店铺对接人').first()).toBeVisible();
});

test('阶段 7.5 第二批截图（1440 / 390）', async ({ page }) => {
  for (const [width, height, name, portal, path] of [
    [1440, 900, 'buyer-stage-contact-1440x900', 'buyer', '/buyer/reservations'],
    [1280, 900, 'buyer-stage-contact-1280x900', 'buyer', '/buyer/reservations'],
    [390, 844, 'buyer-stage-contact-390x844', 'buyer', '/buyer/reservations'],
    [1440, 900, 'staff-service-channels-1440x900', 'staff-owner', '/staff/service-channels'],
    [1280, 900, 'staff-service-channels-1280x900', 'staff-owner', '/staff/service-channels'],
    [390, 844, 'staff-service-channels-390x844', 'staff-owner', '/staff/service-channels'],
  ] as const) {
    await page.setViewportSize({ width, height });
    await loginAs(page, portal);
    await page.goto(path);
    await page.waitForTimeout(0);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
  }
});
