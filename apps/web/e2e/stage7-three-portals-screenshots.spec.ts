import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Stage 7 three-portal deterministic screenshot capture.
 * Shots come from the built app (vite preview) with fully mocked APIs.
 * Writes exactly 13 PNGs into tmp/stage7-three-portals-screenshots/.
 */

const directory = process.env['STAGE7_THREE_PORTALS_SCREENSHOT_DIR']
  ?? join(process.cwd(), 'tmp', 'stage7-three-portals-screenshots');

test.use({ colorScheme: 'light', locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });

function ok(data: unknown, requestId = 'stage7-shot') {
  return {
    contentType: 'application/json',
    body: JSON.stringify({ data, meta: { request_id: requestId } }),
  };
}

async function notFoundJson(route: unknown): Promise<void> {
  await (route as { fulfill: (r: unknown) => Promise<void> }).fulfill({
    status: 404,
    contentType: 'application/json',
    body: JSON.stringify({
      error: { code: 'NOT_FOUND', message: 'not found', details: null },
      meta: { request_id: 'stage7-shot-404' },
    }),
  });
}

// ------------------------------ STAFF mocks ------------------------------

function staffSession() {
  return {
    staff_id: 'stage7-shot-owner',
    display_name: '总管理员',
    role: { code: 'owner', display_name: '总管理员' },
    permissions: [
      'STAFF_MANAGE', 'PERMISSION_MANAGE', 'FINANCIAL_VIEW', 'ORDER_VIEW',
      'ORDER_CONFIRM', 'BUYER_REFUND_RECORD', 'BUYER_CREATE', 'SELLER_MANAGE',
    ],
    data_scope: {
      type: 'GLOBAL', marketplaceCodes: [], buyerCustomerIds: [],
      sellerOrganizationIds: [], teamIds: [],
    },
    authorization_version: 1,
    session_version: 1,
    expires_at: 9_999_999_999_999,
  };
}

const ORDER_DETAIL = {
  order: {
    formal_order_id: 'order-7',
    marketplace_code: 'AMAZON_JP',
    amazon_order_number: '123-1234567-1234567',
    amazon_order_date: '2026-08-01',
    status: 'CONFIRMED',
    confirmed_at: 1_754_240_000_000,
  },
  buyer: {
    buyer_customer_id: 'buyer-7',
    display_name: '阶段七买家',
    customer_no: '20260828B3001',
  },
  seller: { seller_organization_id: 'org-7', store_display_name: '测试店铺' },
  payment_screenshot: { file_object_id: 'pay-7', file_version: 1 },
  communication_screenshots: [
    {
      file_object_id: 'comm-7-1', file_version: 2,
      purpose: 'ORDER_COMMUNICATION_SCREENSHOT', visibility: 'SELLER_VISIBLE',
      uploaded_at: 1_754_240_000_000, uploaded_by_staff_id: 'stage7-shot-owner',
      uploaded_by_staff_name: '总管理员',
    },
    {
      file_object_id: 'comm-7-2', file_version: 1,
      purpose: 'ORDER_COMMUNICATION_SCREENSHOT', visibility: 'SELLER_VISIBLE',
      uploaded_at: 1_754_240_100_000, uploaded_by_staff_id: 'stage7-shot-owner',
      uploaded_by_staff_name: '总管理员',
    },
  ],
  operational_events: [
    {
      event_id: 'event-7', event_type: 'PRICE_MISMATCH_NOTE', reason: '备注',
      actor_staff_id: 'stage7-shot-owner', created_at: 1_754_240_000_000,
    },
  ],
  buyer_advance: {
    authoritative_advance_amount_cny_fen: '165000',
    recorded_advance_amount_cny_fen: '0',
    remaining_advance_amount_cny_fen: '165000',
    can_record_advance_payment: true,
  },
};

async function mockStaffApis(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/access/bootstrap')) {
      await route.fulfill(ok({ session: staffSession(), access_email: 'stage7@example.test' }));
      return;
    }
    if (path.endsWith('/staff-auth/session')) {
      await route.fulfill(ok({ session: staffSession() }));
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
    if (path === '/api/staff/formal-orders/order-7') {
      await route.fulfill(ok(ORDER_DETAIL));
      return;
    }
    if (path.includes('/api/staff/buyer-advance-principal/order-7')) {
      await route.fulfill(ok({ entries: [] }));
      return;
    }
    await notFoundJson(route);
  });
}

// ------------------------------ BUYER mocks ------------------------------

const now = 1_900_000_000_000;

const buyerDemand = {
  demand_id: 'demand-1',
  demand_version: 2,
  marketplace_code: 'AMAZON_JP',
  product_name: '月白护肤套装',
  reference_order_amount_jpy: '3980',
  buyer_self_pay_bps: 1250,
  estimated_buyer_self_pay_jpy: '498',
  estimated_refundable_principal_jpy: '3482',
  buyer_visible_notes: '请按公开说明选择商品。',
  store_display_name: '月白旗舰店',
  task_type: 'IMAGE',
  target_quantity: 8,
  remaining_quantity: 3,
  open_at: now - 10_000,
  reservation_deadline: now + 50_000,
  order_deadline: now + 100_000,
  main_image: null,
  reservation_eligibility: 'ELIGIBLE',
  reservation_ineligibility_reason: null,
};

const buyerEvidence = {
  submission_id: 'evidence-1',
  reservation: {
    reservation_id: 'reservation-1', demand_id: 'demand-1', marketplace_code: 'AMAZON_JP',
    product_name: '月白护肤套装', store_display_name: '月白旗舰店',
    review_type: 'IMAGE', order_deadline: now + 100_000,
  },
  marketplace: 'AMAZON_JP',
  amazon_order_number_display: '123-1234567-1234567',
  amazon_order_date: '2026-08-06',
  final_paid_jpy: 4100,
  buyer_self_pay_bps: 1250,
  buyer_self_pay_jpy: 512,
  buyer_refundable_principal_jpy: 3588,
  price_mismatch: true,
  price_difference_jpy: 120,
  status: 'CHANGES_REQUESTED',
  version: 2,
  evidence_version_no: 1,
  submitted_at: now - 5_000,
  updated_at: now - 4_000,
  verified_at: null,
  public_change_reason: '请补充清晰截图',
  files: [],
  allowed_actions: ['RESUBMIT', 'WITHDRAW'],
};

const buyerFormalOrder = {
  formal_order_id: 'formal-1',
  marketplace: 'AMAZON_JP',
  amazon_order_number: '123-1234567-1234567',
  amazon_order_date: '2026-08-06',
  product_name: '月白护肤套装',
  review_type: 'IMAGE',
  final_paid_jpy: '4100',
  buyer_self_pay_bps: 1250,
  buyer_self_pay_jpy: '512',
  buyer_refundable_principal_jpy: '3588',
  buyer_expected_principal_cny_fen: '19734',
  buyer_exchange_rate_snapshot: {
    version_no: 1, business_date: '2026-08-06', confirmed_at: now - 3_000,
    cny_per_jpy_e8: '5500000',
  },
  confirmed_at: now - 3_000,
  confirmed_business_date: '2026-08-06',
  status: 'CONFIRMED',
  order_evidence_summary: {
    evidence_version_no: 1, submitted_at: now - 5_000, verified_at: now - 3_500,
    file_count: 1,
  },
};

const buyerReviewOrder = {
  formal_order_id: 'formal-1', marketplace: 'AMAZON_JP',
  amazon_order_number: '123-1234567-1234567', amazon_order_date: '2026-08-06',
  product_name: '月白护肤套装', review_type: 'IMAGE',
  confirmed_at: now - 3_000, confirmed_business_date: '2026-08-06', status: 'CONFIRMED',
};

async function mockBuyerApis(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/customer-auth/session') {
      await route.fulfill(ok({
        session: {
          account_id: 'buyer-account', identity_subject_id: 'buyer-subject',
          account_type: 'BUYER', session_version: 1, password_change_required: false,
          issued_at: 1, expires_at: now + 100_000,
        },
      }));
      return;
    }
    if (path === '/api/buyer-portal/me') {
      await route.fulfill(ok({
        buyer: {
          display_name: '月白买家', marketplace_code: 'AMAZON_JP',
          identity_review_status: 'CLEAR', customer_number: '20260824B3612',
          refund_account_name: null, refund_account_identifier: null,
        },
      }));
      return;
    }
    if (path === '/api/buyer-portal/demands') {
      await route.fulfill(ok({ items: [buyerDemand], next_cursor: null }));
      return;
    }
    if (path === '/api/buyer-portal/demands/demand-1') {
      await route.fulfill(ok({ demand: buyerDemand }));
      return;
    }
    if (path === '/api/buyer-portal/reservations') {
      await route.fulfill(ok({ items: [], next_cursor: null }));
      return;
    }
    if (path.endsWith('/order-instruction/state')) {
      await route.fulfill(ok({
        order_instruction: {
          status: 'ACTIVE',
          instruction_version: 3,
          current_version_no: 2,
          initial_deadline_at: now + 40_000,
          resubmission_deadline_at: now + 60_000,
          evidence_status: 'NOT_SUBMITTED',
          can_submit_evidence: true,
          can_read_images: true,
          content_updated: false,
        },
      }));
      return;
    }
    if (path.endsWith('/order-evidence/evidence-1')) {
      await route.fulfill(ok({ order_evidence: buyerEvidence }));
      return;
    }
    if (path === '/api/buyer-portal/formal-orders') {
      await route.fulfill(ok({ items: [buyerFormalOrder], next_cursor: null }));
      return;
    }
    if (path === '/api/buyer-portal/formal-orders/formal-1') {
      await route.fulfill(ok({ formal_order: buyerFormalOrder }));
      return;
    }
    if (path === '/api/buyer-portal/reviews/eligible-orders') {
      await route.fulfill(ok({ items: [], next_cursor: null }));
      return;
    }
    if (path === '/api/buyer-portal/reviews') {
      await route.fulfill(ok({
        items: [{
          review_case_id: 'review-1', order: buyerReviewOrder, review_type: 'IMAGE',
          status: 'PENDING_REVIEW', version: 2, current_evidence_version_no: 1,
          submitted_at: now - 2_500, updated_at: now - 2_000, public_change_reason: null,
          review_url: 'https://www.amazon.co.jp/review/example', review_approved_at: null,
          buyer_refund_due: null, file_count: 1, allowed_actions: ['WITHDRAW'],
        }],
        next_cursor: null,
      }));
      return;
    }
    if (path === '/api/buyer-portal/refunds') {
      await route.fulfill(ok({
        items: [{
          refund_obligation_id: 'refund-1', due_amount_cny_fen: '19734',
          net_paid_cny_fen: '10000', remaining_amount_cny_fen: '9734',
          overpaid_amount_cny_fen: '0', status: 'PARTIALLY_PAID',
          order: buyerReviewOrder,
          reminder: { reminder_count: 0, last_reminded_at: null, next_reminder_at: null },
          allowed_actions: [],
        }],
        next_cursor: null,
      }));
      return;
    }
    if (path === '/api/buyer-portal/order-evidence/eligible-reservations') {
      await route.fulfill(ok({
        items: [{
          ...buyerEvidence.reservation,
          current_order_evidence_status: null,
          current_order_evidence_version: null,
          allowed_actions: ['SUBMIT'],
        }],
        next_cursor: null,
      }));
      return;
    }
    await notFoundJson(route);
  });
}

// ----------------------------- SELLER mocks ------------------------------

const fixedNow = Date.parse('2026-08-28T04:00:00.000Z');
const pageInfo = { limit: 100, next_cursor: null };

async function mockSellerApis(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/customer-auth/session') {
      await route.fulfill(ok({
        session: {
          account_id: 'seller-stage7-account', identity_subject_id: 'seller-stage7-subject',
          account_type: 'SELLER_MEMBER', session_version: 1,
          password_change_required: false, issued_at: fixedNow - 60_000,
          expires_at: fixedNow + 3_600_000,
        },
      }));
      return;
    }
    if (path === '/api/seller-portal/me') {
      await route.fulfill(ok({
        me: {
          account_id: 'seller-stage7-account',
          member: { id: 'member-stage7', display_name: '张三', role: 'OWNER', primary_owner: true },
          organization: {
            id: 'org-stage7', seller_code: 'YG-26001', name: '月白生活株式会社',
            marketplace_code: 'AMAZON_JP', status: 'ACTIVE',
            settlement_account_name: null, settlement_account_identifier: null,
          },
          access: {
            read_scope: 'ORGANIZATION', store_ids: ['store-jp', 'store-us'],
            can_submit_product_applications: true, can_submit_demand_batches: true,
          },
        },
      }));
      return;
    }
    if (path === '/api/seller-portal/stores') {
      await route.fulfill(ok({
        items: [
          {
            id: 'store-jp', marketplace_code: 'AMAZON_JP', canonical_marketplace_code: 'AMAZON_JP',
            transaction_currency_code: 'JPY', transaction_currency_exponent: 0,
            marketplace_status: 'ACTIVE', adapter_status: 'AVAILABLE',
            display_name: '东京一号店', status: 'ACTIVE', version: 3,
            created_at: fixedNow - 90_000_000, updated_at: fixedNow - 3_600_000,
          },
          {
            id: 'store-us', marketplace_code: 'AMAZON_JP', canonical_marketplace_code: 'AMAZON_US',
            transaction_currency_code: 'USD', transaction_currency_exponent: 2,
            marketplace_status: 'ACTIVE', adapter_status: 'AVAILABLE',
            display_name: '北美精品店（停用）', status: 'DISABLED', version: 2,
            created_at: fixedNow - 80_000_000, updated_at: fixedNow - 7_200_000,
          },
        ],
        page: pageInfo,
      }));
      return;
    }
    if (path === '/api/seller-portal/products'
      || path === '/api/seller-portal/product-applications'
      || path === '/api/seller-portal/demand-batches'
      || path === '/api/seller-portal/reviews') {
      await route.fulfill(ok({ items: [], page: pageInfo }));
      return;
    }
    if (path === '/api/seller-portal/formal-orders') {
      await route.fulfill(ok({
        items: [{
          formal_order_id: 'order-rice', status: 'CONFIRMED', marketplace_code: 'AMAZON_JP',
          amazon_order_number: '503-1234567-1234567',
          platform_order_identifier: '503-1234567-1234567',
          store: { id: 'store-jp', display_name: '东京一号店' },
          asin: 'B07W5DMQ3R', platform_product_identifier: 'B07W5DMQ3R',
          product_name: '象印 IH 电饭煲 5.5 合',
          product_version: { id: 'version-rice', version_no: 2 },
          review_type: 'IMAGE', main_image: null, order_screenshot: null, final_paid_jpy: '22800',
          payment: { amount_minor: '22800', currency_code: 'JPY', currency_exponent: 0 },
          seller_expected_principal_cny_fen: '91200',
          seller_principal_rate_snapshot: {
            platform_order_date: '2026-08-09', payment_amount_minor: '22800',
            payment_currency_code: 'JPY', base_rate_version_id: 'base-rate-jp',
            base_rate_business_date: '2026-08-09', base_rate_created_at: fixedNow - 8_000_000,
            base_rate_value: '3800000', base_rate_scale: '100000000',
            policy_version_id: 'policy-jp', policy_scope_type: 'SELLER_ORGANIZATION',
            policy_seller_organization_id: 'org-stage7', policy_version_no: 8,
            policy_effective_from: fixedNow - 10_000_000, policy_created_at: fixedNow - 8_000_000,
            markup_rate_value: '200000', markup_rate_scale: '100000000',
            final_rate_value: '4000000', final_rate_scale: '100000000',
            rounding_rule: 'HALF_UP', seller_expected_principal_amount_minor: '91200',
          },
          locked_service_fee_snapshot: {
            fee_version_id: 'fee-image', version_no: 4, review_type: 'IMAGE',
            service_fee_cny_fen: '3200', effective_from: fixedNow - 10_000_000,
            created_at: fixedNow - 8_000_000, marketplace_code: 'AMAZON_JP',
            currency_code: 'CNY', currency_exponent: 2,
          },
          business_completion: {
            status: 'IN_PROGRESS', review: 'COMPLETE', seller_principal: 'COMPLETE',
            seller_service_fee: 'PENDING',
          },
          confirmed_at: fixedNow - 7_200_000, confirmed_business_date: '2026-08-09',
          communication_screenshots: [
            {
              file_object_id: 'comm-seller-1', file_version: 2,
              purpose: 'ORDER_COMMUNICATION_SCREENSHOT', visibility: 'SELLER_VISIBLE',
              uploaded_at: fixedNow - 6_000_000, uploaded_by_staff_id: 'stage7-shot-owner',
              uploaded_by_staff_name: '总管理员',
            },
            {
              file_object_id: 'comm-seller-2', file_version: 1,
              purpose: 'ORDER_COMMUNICATION_SCREENSHOT', visibility: 'SELLER_VISIBLE',
              uploaded_at: fixedNow - 5_000_000, uploaded_by_staff_id: 'stage7-shot-ops',
              uploaded_by_staff_name: '卖家对接',
            },
          ],
        }],
        page: pageInfo,
      }));
      return;
    }
    if (path === '/api/seller-portal/settlement/summary') {
      await route.fulfill(ok({
        settlement: {
          outstanding_principal_cny_fen: '30000', outstanding_service_fee_cny_fen: '3200',
          total_outstanding_cny_fen: '33200', unallocated_credit_cny_fen: '1200',
          settlement_account_name: null, settlement_account_identifier: null,
        },
      }));
      return;
    }
    if (path === '/api/seller-portal/settlement/payables') {
      await route.fulfill(ok({
        items: [
          {
            payable_id: 'payable-principal', formal_order_id: 'order-rice',
            payable_type: 'SELLER_PRINCIPAL', amazon_order_number: '503-1234567-1234567',
            store: { id: 'store-jp', display_name: '东京一号店' },
            product: { id: 'product-rice', asin: 'B07W5DMQ3R', name: '象印 IH 电饭煲 5.5 合' },
            due_amount_cny_fen: '91200', paid_amount_cny_fen: '61200',
            outstanding_amount_cny_fen: '30000', status: 'PARTIALLY_PAID',
            due_at: fixedNow + 86_400_000, created_at: fixedNow - 7_200_000,
          },
          {
            payable_id: 'payable-fee', formal_order_id: 'order-rice',
            payable_type: 'SELLER_SERVICE_FEE', amazon_order_number: '503-1234567-1234567',
            store: { id: 'store-jp', display_name: '东京一号店' },
            product: { id: 'product-rice', asin: 'B07W5DMQ3R', name: '象印 IH 电饭煲 5.5 合' },
            due_amount_cny_fen: '3200', paid_amount_cny_fen: '0',
            outstanding_amount_cny_fen: '3200', status: 'UNPAID',
            due_at: fixedNow + 172_800_000, created_at: fixedNow - 7_200_000,
          },
        ],
        page: pageInfo,
      }));
      return;
    }
    await notFoundJson(route);
  });
}

// ------------------------------ capture ----------------------------------

async function capture(page: Page, name: string): Promise<void> {
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: join(directory, name), fullPage: false, animations: 'disabled', caret: 'hide' });
}

test.describe('stage 7 three-portal screenshots', () => {
  test('staff workbench desktop 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockStaffApis(page);
    await page.goto('/staff');
    await expect(page.getByRole('navigation', { name: '员工工作台主导航' })).toBeVisible();
    await page.waitForTimeout(400);
    await capture(page, 'staff-workbench-1440x900.png');
  });

  test('staff order detail desktop 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockStaffApis(page);
    await page.goto('/staff/orders/order-7');
    await expect(page.getByRole('heading', { name: /订单沟通截图（2）/u })).toBeVisible();
    await page.waitForTimeout(400);
    await capture(page, 'staff-order-detail-1440x900.png');
  });

  test('staff mobile 390x844', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockStaffApis(page);
    await page.goto('/staff');
    await expect(page.getByLabel('打开导航菜单')).toBeVisible();
    await page.waitForTimeout(400);
    await capture(page, 'staff-mobile-390x844.png');
  });

  test('staff mobile drawer 390x844', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockStaffApis(page);
    await page.goto('/staff');
    await expect(page.getByLabel('打开导航菜单')).toBeVisible();
    await page.getByLabel('打开导航菜单').click();
    await expect(page.getByRole('dialog', { name: '员工导航菜单' })).toBeVisible();
    await page.waitForTimeout(400);
    await capture(page, 'staff-mobile-drawer-390x844.png');
  });

  test('buyer home desktop 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockBuyerApis(page);
    await page.goto('/buyer');
    await expect(page.getByRole('heading', { name: '你好，月白买家' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '下一步', exact: true })).toBeVisible();
    await page.waitForTimeout(400);
    await capture(page, 'buyer-home-1440x900.png');
  });

  test('buyer order detail desktop 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockBuyerApis(page);
    await page.goto('/buyer/orders/formal-1');
    await expect(page.getByText('订单汇率')).toBeVisible();
    await page.waitForTimeout(400);
    await capture(page, 'buyer-order-detail-1440x900.png');
  });

  test('buyer mobile 390x844', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockBuyerApis(page);
    await page.goto('/buyer');
    await expect(page.getByLabel('打开导航菜单')).toBeVisible();
    await page.waitForTimeout(400);
    await capture(page, 'buyer-mobile-390x844.png');
  });

  test('buyer mobile drawer 390x844', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockBuyerApis(page);
    await page.goto('/buyer');
    await expect(page.getByLabel('打开导航菜单')).toBeVisible();
    await page.getByLabel('打开导航菜单').click();
    await expect(page.getByRole('dialog', { name: '买家导航菜单' })).toBeVisible();
    await page.waitForTimeout(400);
    await capture(page, 'buyer-mobile-drawer-390x844.png');
  });

  test('seller home desktop 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockSellerApis(page);
    await page.goto('/seller');
    await expect(page.getByRole('heading', { name: '月白生活株式会社', exact: true })).toBeVisible();
    await page.waitForTimeout(400);
    await capture(page, 'seller-home-1440x900.png');
  });

  test('seller orders with communication screenshots desktop 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockSellerApis(page);
    await page.goto('/seller/orders');
    await expect(page.getByRole('heading', { name: '订单与业务完成' })).toBeVisible();
    // 展开订单明细并滚到沟通截图分区：两份真实形状 DTO 截图（含上传人/时间）。
    await page.locator('details').first().locator('summary').click();
    await expect(page.getByRole('button', { name: '展开沟通截图 1' })).toBeVisible();
    await expect(page.getByRole('button', { name: '展开沟通截图 2' })).toBeVisible();
    await page.getByText('沟通截图（员工上传，一单可多张）').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await capture(page, 'seller-orders-communication-screenshots-1440x900.png');
  });

  test('seller settlement desktop 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockSellerApis(page);
    await page.goto('/seller/settlements');
    await expect(page.getByRole('heading', { name: '卖家结算' })).toBeVisible();
    await expect(page.getByText('待结本金', { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(400);
    await capture(page, 'seller-settlement-1440x900.png');
  });

  test('seller mobile 390x844', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockSellerApis(page);
    await page.goto('/seller');
    await expect(page.getByLabel('打开导航菜单')).toBeVisible();
    await page.waitForTimeout(400);
    await capture(page, 'seller-mobile-390x844.png');
  });

  test('seller mobile drawer 390x844', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockSellerApis(page);
    await page.goto('/seller');
    await expect(page.getByLabel('打开导航菜单')).toBeVisible();
    await page.getByLabel('打开导航菜单').click();
    await expect(page.getByRole('dialog', { name: '卖家导航菜单' })).toBeVisible();
    await page.waitForTimeout(400);
    await capture(page, 'seller-mobile-drawer-390x844.png');
  });
});
