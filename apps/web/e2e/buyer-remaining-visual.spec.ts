import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

test.use({
  colorScheme: 'light',
  locale: 'zh-CN',
  reducedMotion: 'reduce',
  timezoneId: 'Asia/Shanghai',
});

const screenshotDirectory = process.env['BUYER_REMAINING_VISUAL_SCREENSHOT_DIR'];
const screenshotSurfaces = new Set((process.env['BUYER_REMAINING_VISUAL_SCREENSHOT_SURFACES'] ?? '').split(',').filter(Boolean));
const fixedNow = Date.parse('2026-08-09T04:00:00.000Z');
const invitationToken = 'i'.repeat(43);
const viewports = [
  { width: 320, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
  { width: 1600, height: 1000 },
] as const;

const reservationDemand = {
  demand_id: 'demand-visual',
  demand_version: 4,
  marketplace_code: 'JP',
  product_name: '月白保湿护理套装',
  reference_order_amount_jpy: '3980',
  buyer_self_pay_bps: 1250,
  estimated_buyer_self_pay_jpy: '498',
  estimated_refundable_principal_jpy: '3482',
  buyer_visible_notes: '请按公开说明选择商品。',
  store_display_name: '日本站合作店铺',
  task_type: 'IMAGE',
  reservation_deadline: fixedNow + 3 * 86_400_000,
  order_deadline: fixedNow + 8 * 86_400_000,
};

const reservation = {
  reservation_id: 'reservation-visual',
  status: 'APPROVED',
  version: 2,
  submitted_at: fixedNow - 8_000,
  updated_at: fixedNow - 5_000,
  hold_expires_at: fixedNow + 20_000,
  order_deadline_snapshot: reservationDemand.order_deadline,
  buyer_self_pay_bps_snapshot: 1250,
  reference_order_amount_jpy_snapshot: '3980',
  estimated_self_pay_jpy_snapshot: '498',
  estimated_refundable_principal_jpy_snapshot: '3482',
  buyer_self_pay_accepted_at: fixedNow - 8_000,
  buyer_self_pay_accepted_demand_version: 4,
  decided_at: fixedNow - 6_000,
  cancelled_at: null,
  expired_at: null,
  can_cancel: true,
  demand: reservationDemand,
};

const evidenceFile = {
  file_object_id: 'evidence-file-visual',
  client_file_name: '订单截图.png',
  mime: 'image/png',
  byte_size: 3,
  status: 'VERIFIED',
  visibility: 'BUYER_VISIBLE',
  verified_at: fixedNow - 4_000,
  file_entity_link_id: 'evidence-link-visual',
  version: 3,
  allowed_actions: ['CREATE_READ_INTENT'],
};

const evidence = {
  submission_id: 'evidence-visual',
  reservation: {
    reservation_id: reservation.reservation_id,
    demand_id: reservationDemand.demand_id,
    marketplace_code: 'JP',
    product_name: reservationDemand.product_name,
    store_display_name: reservationDemand.store_display_name,
    review_type: 'IMAGE',
    order_deadline: reservationDemand.order_deadline,
  },
  marketplace: 'JP',
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
  submitted_at: fixedNow - 5_000,
  updated_at: fixedNow - 4_000,
  verified_at: null,
  public_change_reason: '请补充清晰截图',
  files: [evidenceFile],
  allowed_actions: ['RESUBMIT', 'WITHDRAW'],
};

const formalOrder = {
  formal_order_id: 'formal-visual',
  marketplace: 'JP',
  amazon_order_number: evidence.amazon_order_number_display,
  amazon_order_date: '2026-08-06',
  product_name: reservationDemand.product_name,
  review_type: 'IMAGE',
  final_paid_jpy: '4100',
  buyer_self_pay_bps: 1250,
  buyer_self_pay_jpy: '512',
  buyer_refundable_principal_jpy: '3588',
  buyer_expected_principal_cny_fen: '19734',
  buyer_exchange_rate_snapshot: {
    version_no: 1,
    business_date: '2026-08-06',
    confirmed_at: fixedNow - 3_000,
    cny_per_jpy_e8: '5500000',
  },
  confirmed_at: fixedNow - 3_000,
  confirmed_business_date: '2026-08-06',
  status: 'CONFIRMED',
  order_evidence_summary: {
    evidence_version_no: 1,
    submitted_at: fixedNow - 5_000,
    verified_at: fixedNow - 3_500,
    file_count: 1,
  },
};

const reviewOrder = {
  formal_order_id: formalOrder.formal_order_id,
  marketplace: 'JP',
  amazon_order_number: evidence.amazon_order_number_display,
  amazon_order_date: '2026-08-06',
  product_name: reservationDemand.product_name,
  review_type: 'IMAGE',
  confirmed_at: fixedNow - 3_000,
  confirmed_business_date: '2026-08-06',
  status: 'CONFIRMED',
};

const review = {
  review_case_id: 'review-visual',
  order: reviewOrder,
  review_type: 'IMAGE',
  status: 'CHANGES_REQUESTED',
  version: 2,
  current_evidence_version_no: 1,
  submitted_at: fixedNow - 2_500,
  updated_at: fixedNow - 2_000,
  public_change_reason: '请补充完整评论截图',
  review_url: 'https://www.amazon.co.jp/review/example',
  review_approved_at: null,
  buyer_refund_due: null,
  file_count: 1,
  files: [{
    file_object_id: 'review-file-visual',
    file_entity_link_id: 'review-link-visual',
    client_file_name: '评论截图.png',
    mime: 'image/png',
    byte_size: 3,
    status: 'VERIFIED',
    version: 3,
    verified_at: fixedNow - 2_400,
    allowed_actions: ['CREATE_READ_INTENT'],
  }],
  allowed_actions: ['RESUBMIT', 'WITHDRAW'],
};
const { files: _reviewFiles, ...reviewSummary } = review;

const refund = {
  refund_obligation_id: 'refund-visual',
  due_amount_cny_fen: '19734',
  net_paid_cny_fen: '10000',
  remaining_amount_cny_fen: '9734',
  overpaid_amount_cny_fen: '0',
  status: 'PARTIALLY_PAID',
  order: {
    formal_order_id: formalOrder.formal_order_id,
    marketplace: 'JP',
    amazon_order_number: evidence.amazon_order_number_display,
    product_name: reservationDemand.product_name,
    review_type: 'IMAGE',
    status: 'CONFIRMED',
  },
  reminder: {
    reminder_count: 0,
    last_reminded_at: null,
    next_reminder_at: null,
  },
  allowed_actions: [],
};

const refundDetail = {
  ...refund,
  activities: [
    {
      activity_id: 'payment-visual',
      activity_type: 'PAYMENT_RECORDED',
      amount_cny_fen: '12000',
      occurred_at: fixedNow - 600,
      payment_channel: 'WECHAT_PAY',
      balance_after: {
        due_amount_cny_fen: '19734',
        net_paid_cny_fen: '12000',
        remaining_amount_cny_fen: '7734',
        overpaid_amount_cny_fen: '0',
        status: 'PARTIALLY_PAID',
      },
    },
    {
      activity_id: 'reversal-visual',
      activity_type: 'PAYMENT_REVERSED',
      amount_cny_fen: '2000',
      occurred_at: fixedNow - 300,
      payment_channel: 'WECHAT_PAY',
      balance_after: {
        due_amount_cny_fen: '19734',
        net_paid_cny_fen: '10000',
        remaining_amount_cny_fen: '9734',
        overpaid_amount_cny_fen: '0',
        status: 'PARTIALLY_PAID',
      },
    },
  ],
};

function success(data: unknown): unknown {
  return { data, meta: { request_id: 'buyer-remaining-visual' } };
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installBuyerFixture(page: Page, refundStatus: 'PARTIALLY_PAID' | 'PAID' = 'PARTIALLY_PAID'): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
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
    if (path === `/api/buyer-auth/invitations/${invitationToken}`) {
      await json(route, success({ invitation: {
        invitation_valid: true,
        marketplace_code: 'AMAZON_JP',
        marketplace_name: '日本亚马逊',
        wechat_hint: 'yu***wx',
        expires_at: fixedNow + 3_600_000,
      } }));
      return;
    }
    if (path === '/api/buyer-portal/me') {
      await json(route, success({ buyer: {
        display_name: '月白买家',
        marketplace_code: 'JP',
        identity_review_status: 'CLEAR',
      } }));
      return;
    }
    if (path === '/api/buyer-portal/reservations') {
      await json(route, success({ items: [reservation], next_cursor: null }));
      return;
    }
    if (path === `/api/buyer-portal/reservations/${reservation.reservation_id}`) {
      await json(route, success({ reservation }));
      return;
    }
    if (path.endsWith('/order-instruction/state')) {
      await json(route, success({ order_instruction: {
        status: 'ACTIVE',
        instruction_version: 3,
        current_version_no: 2,
        initial_deadline_at: fixedNow + 2 * 86_400_000,
        resubmission_deadline_at: fixedNow + 4 * 86_400_000,
        evidence_status: 'CHANGES_REQUESTED',
        can_submit_evidence: true,
        can_read_images: true,
        content_updated: false,
      } }));
      return;
    }
    if (path.endsWith('/order-instruction')) {
      await json(route, success({ order_instruction: {
        status: 'ACTIVE',
        product_name: reservationDemand.product_name,
        store_display_name: reservationDemand.store_display_name,
        search_keywords: ['月光白', '商品关键词'],
        color_spec_mode: 'MAIN_IMAGE_VARIANT',
        staff_public_note: '请核对主图与商品规格。',
        buyer_visible_notes: '下单后请按页面要求保存订单截图。',
        initial_deadline_at: fixedNow + 2 * 86_400_000,
        resubmission_deadline_at: fixedNow + 4 * 86_400_000,
        content_updated: false,
        reference_order_amount_jpy: '3980',
        buyer_self_pay_bps: 1250,
        estimated_buyer_self_pay_jpy: '498',
        estimated_refundable_principal_jpy: '3482',
        main_image: {
          image_id: 'instruction-main-visual',
          position: null,
          mime: 'image/png',
          width: 800,
          height: 800,
          read_intent_path: `/api/buyer-portal/reservations/${reservation.reservation_id}/order-instruction/images/main/read-intent`,
        },
        keyword_images: [],
      } }));
      return;
    }
    if (path === '/api/buyer-portal/order-evidence/eligible-reservations') {
      await json(route, success({ items: [{
        ...evidence.reservation,
        current_order_evidence_status: null,
        current_order_evidence_version: null,
        allowed_actions: ['SUBMIT'],
      }], next_cursor: null }));
      return;
    }
    if (path === '/api/buyer-portal/order-evidence' && request.method() === 'GET') {
      await json(route, success({ items: [evidence], next_cursor: null }));
      return;
    }
    if (path === `/api/buyer-portal/order-evidence/${evidence.submission_id}`) {
      await json(route, success({ order_evidence: evidence }));
      return;
    }
    if (path === '/api/buyer-portal/formal-orders') {
      await json(route, success({ items: [formalOrder], next_cursor: null }));
      return;
    }
    if (path === `/api/buyer-portal/formal-orders/${formalOrder.formal_order_id}`) {
      await json(route, success({ formal_order: formalOrder }));
      return;
    }
    if (path === '/api/buyer-portal/reviews/eligible-orders') {
      await json(route, success({ items: [{ order: reviewOrder, current_review: null, allowed_actions: ['SUBMIT'] }], next_cursor: null }));
      return;
    }
    if (path === '/api/buyer-portal/reviews' && request.method() === 'GET') {
      await json(route, success({ items: [reviewSummary], next_cursor: null }));
      return;
    }
    if (path === `/api/buyer-portal/reviews/${review.review_case_id}`) {
      await json(route, success({ review }));
      return;
    }
    if (path === '/api/buyer-portal/refunds') {
      await json(route, success({ items: [{ ...refund, status: refundStatus }], next_cursor: null }));
      return;
    }
    if (path === `/api/buyer-portal/refunds/${refund.refund_obligation_id}`) {
      await json(route, success({ refund: {
        ...refundDetail,
        status: refundStatus,
        net_paid_cny_fen: refundStatus === 'PAID' ? refund.due_amount_cny_fen : refund.net_paid_cny_fen,
        remaining_amount_cny_fen: refundStatus === 'PAID' ? '0' : refund.remaining_amount_cny_fen,
        activities: refundStatus === 'PAID' ? [] : refundDetail.activities,
      } }));
      return;
    }
    await json(route, {
      error: { code: 'NOT_FOUND', message: 'not found', details: null },
      meta: { request_id: 'buyer-remaining-visual-not-found' },
    }, 404);
  });
}

const surfaces = [
  { name: 'reservations', path: '/buyer/reservations', heading: '我的预约' },
  { name: 'reservation-detail', path: `/buyer/reservations/${reservation.reservation_id}`, heading: reservationDemand.product_name },
  { name: 'instruction', path: `/buyer/reservations/${reservation.reservation_id}/instruction`, heading: reservationDemand.product_name },
  { name: 'order-materials', path: '/buyer/order-materials', heading: '订单资料' },
  { name: 'order-material-form', path: `/buyer/order-materials/new?reservation_id=${reservation.reservation_id}`, heading: '提交订单资料' },
  { name: 'order-material-detail', path: `/buyer/order-materials/${evidence.submission_id}`, heading: reservationDemand.product_name },
  { name: 'formal-orders', path: '/buyer/orders', heading: '正式订单' },
  { name: 'formal-order-detail', path: `/buyer/orders/${formalOrder.formal_order_id}`, heading: reservationDemand.product_name },
  { name: 'reviews', path: '/buyer/reviews', heading: '评论资料' },
  { name: 'review-form', path: `/buyer/reviews/new?formal_order_id=${formalOrder.formal_order_id}`, heading: '提交评论资料' },
  { name: 'review-detail', path: `/buyer/reviews/${review.review_case_id}`, heading: reservationDemand.product_name },
  { name: 'refunds', path: '/buyer/refunds', heading: '返款记录' },
  { name: 'refund-detail', path: `/buyer/refunds/${refund.refund_obligation_id}`, heading: reservationDemand.product_name },
  { name: 'me', path: '/buyer/me', heading: '月白买家' },
  { name: 'change-password', path: '/buyer/change-password', heading: '修改密码' },
  { name: 'registration', path: `/buyer/register?token=${invitationToken}`, heading: '邀请注册' },
] as const;

const fullWidthRepresentatives = new Set([
  'reservation-detail',
  'instruction',
  'order-material-form',
  'review-detail',
  'refund-detail',
  'me',
]);

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

test('Buyer remaining visual fixture captures the frozen matrix', async ({ page }) => {
  test.setTimeout(120_000);
  await installBuyerFixture(page);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const surface of surfaces) {
      if (screenshotSurfaces.size > 0 && !screenshotSurfaces.has(surface.name)) continue;
      if (viewport.width !== 390 && !fullWidthRepresentatives.has(surface.name)) continue;
      await page.goto(surface.path);
      await expect(page.getByRole('heading', { name: surface.heading, exact: true }).first()).toBeVisible();
      await noHorizontalOverflow(page);
      await capture(page, `${surface.name}-${viewport.width}x${viewport.height}.png`);
    }
  }
});

test('Buyer remaining pages keep Chinese facts and truthful refund wording', async ({ page }) => {
  await installBuyerFixture(page);
  await page.goto(`/buyer/refunds/${refund.refund_obligation_id}`);
  await expect(page.getByText('返款金额', { exact: true })).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/WECHAT_PAY|PAYMENT_RECORDED|PAYMENT_REVERSED/u);
  await expect(page.locator('main')).not.toContainText(/首次付款|最后付款|应返金额/u);
  await expect(page.getByText(/北京时间/u).first()).toBeVisible();

  await page.goto(`/buyer/orders/${formalOrder.formal_order_id}`);
  await expect(page.locator('main')).not.toContainText(/\bIMAGE\b|\bJP\b/u);
  await expect(page.getByText('订单汇率')).toBeVisible();
  await expect(page.getByText('1 JPY = ¥0.055 CNY')).toBeVisible();
  await expect(page.locator('main')).not.toContainText(/汇率快照 e8|5500000/u);
  await expect(page.locator('main')).not.toContainText(/客户编号|会话到期|内部说明|预约排名|预计下单日期/u);
});

test('Buyer refund journey marks complete only for PAID detail', async ({ page }) => {
  await installBuyerFixture(page);
  await page.goto('/buyer/refunds');
  await expect(page.getByRole('region', { name: '业务流程' }).locator('[aria-current="step"]')).toHaveCount(0);

  await page.goto(`/buyer/refunds/${refund.refund_obligation_id}`);
  await expect(page.getByText('部分返款', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '业务流程' }).locator('[aria-current="step"]')).toHaveCount(0);

  await page.unrouteAll();
  await installBuyerFixture(page, 'PAID');
  await page.goto(`/buyer/refunds/${refund.refund_obligation_id}`);
  await expect(page.getByText('已返款', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '业务流程' }).getByRole('listitem').filter({ hasText: '完成' }))
    .toHaveAttribute('aria-current', 'step');
});

test('Buyer remaining representatives reflow, focus, and reduce motion', async ({ page }) => {
  await installBuyerFixture(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/buyer/order-materials/new?reservation_id=${reservation.reservation_id}`);
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await noHorizontalOverflow(page);
  await expect(page.getByRole('button', { name: '提交资料' })).toBeVisible();

  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.getByLabel('Amazon 订单号').focus();
  const focus = await page.getByLabel('Amazon 订单号').evaluate((element) => ({
    outline: getComputedStyle(element).outlineStyle,
    bottom: element.getBoundingClientRect().bottom,
  }));
  const navigationTop = await page.locator('.bottom-nav').evaluate((element) => element.getBoundingClientRect().top);
  expect(focus.outline).not.toBe('none');
  expect(focus.bottom).toBeLessThan(navigationTop);

  const duration = await page.evaluate(() => {
    const node = document.createElement('span');
    node.className = 'buyer-loading-mark';
    document.body.append(node);
    return getComputedStyle(node).animationDuration;
  });
  expect(duration).not.toBe('0.9s');
});

test('Buyer remaining routes preserve page-level lazy loading', async ({ page }) => {
  const scripts = new Set<string>();
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.endsWith('.js')) scripts.add(path.split('/').at(-1) ?? path);
  });
  await installBuyerFixture(page);
  await page.goto('/buyer/order-materials');
  await expect(page.getByRole('heading', { name: '订单资料', exact: true }).first()).toBeVisible();
  expect([...scripts].some((name) => /BuyerAfterSalesRouteModule|SellerRouteModule|StaffRouteModule/u.test(name))).toBe(false);

  scripts.clear();
  await page.goto('/buyer/refunds');
  await expect(page.getByRole('heading', { name: '返款记录' })).toBeVisible();
  expect([...scripts].some((name) => /BuyerOrderRouteModule|SellerRouteModule|StaffRouteModule/u.test(name))).toBe(false);
});
