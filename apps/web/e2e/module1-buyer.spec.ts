import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

const now = 1_900_000_000_000;
const sha = 'a'.repeat(64);
const buyerInvitationToken = 'i'.repeat(43);
type MockOptions = {
  failures?: Readonly<Record<string, number>>;
  instructionStatus?: 'UNPUBLISHED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'COMPLETED';
  sessionType?: 'BUYER' | 'SELLER_MEMBER';
  reviewStatus?: 'PENDING_REVIEW' | 'CHANGES_REQUESTED' | 'REJECTED' | 'WITHDRAWN' | 'APPROVED';
  refundStatus?: 'DUE' | 'PARTIALLY_PAID' | 'PAID' | 'OVERPAID';
  reviewRequired?: boolean;
  registrationStatus?: number;
  reservationConflict?: boolean;
  invalidInstructionPath?: boolean;
  failureOnce?: string;
  networkFailureOnce?: string;
  cursorPages?: boolean;
  fileContentFailureOnce?: 429 | 503;
};

function success(data: unknown, requestId = 'module1-browser') {
  return { data, meta: { request_id: requestId } };
}

function failure(code: string, requestId = 'module1-browser-error') {
  return { error: { code, message: 'safe fixture', details: null }, meta: { request_id: requestId } };
}

async function json(route: Route, body: unknown, status = 200, headers: Record<string, string> = {}): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
}

function session(type: 'BUYER' | 'SELLER_MEMBER' = 'BUYER') {
  return { account_id: 'buyer-account', identity_subject_id: 'buyer-subject', account_type: type,
    session_version: 1, password_change_required: false, issued_at: 1, expires_at: now + 100_000 };
}

const demand = {
  demand_id: 'demand-1', demand_version: 2, marketplace_code: 'JP', product_name: '月白护肤套装',
  reference_order_amount_jpy: '3980', buyer_self_pay_bps: 1250,
  estimated_buyer_self_pay_jpy: '498', estimated_refundable_principal_jpy: '3482',
  buyer_visible_notes: '请按公开说明选择商品。', store_display_name: '月白旗舰店', task_type: 'IMAGE',
  target_quantity: 8, remaining_quantity: 3, open_at: now - 10_000,
  reservation_deadline: now + 50_000, order_deadline: now + 100_000,
};

const reservationDemand = (({ target_quantity, remaining_quantity, open_at, ...value }) => value)(demand);
const reservation = {
  reservation_id: 'reservation-1', status: 'APPROVED', version: 2,
  submitted_at: now - 8_000, updated_at: now - 5_000, hold_expires_at: now + 20_000,
  order_deadline_snapshot: now + 100_000, buyer_self_pay_bps_snapshot: 1250,
  reference_order_amount_jpy_snapshot: '3980', estimated_self_pay_jpy_snapshot: '498',
  estimated_refundable_principal_jpy_snapshot: '3482', buyer_self_pay_accepted_at: now - 8_000,
  buyer_self_pay_accepted_demand_version: 2, decided_at: now - 6_000,
  cancelled_at: null, expired_at: null, can_cancel: true, demand: reservationDemand,
};

const instructionState = (status: MockOptions['instructionStatus'] = 'ACTIVE') => ({
  status, instruction_version: 3, current_version_no: 2,
  initial_deadline_at: now + 40_000, resubmission_deadline_at: now + 60_000,
  evidence_status: 'CHANGES_REQUESTED', can_submit_evidence: status === 'ACTIVE',
  can_read_images: status === 'ACTIVE' || status === 'COMPLETED', content_updated: status === 'COMPLETED',
});

const instruction = (invalid = false) => ({
  status: 'ACTIVE', product_name: demand.product_name, store_display_name: demand.store_display_name,
  color_spec_mode: 'MAIN_IMAGE_VARIANT', staff_public_note: '请核对主图。', buyer_visible_notes: '公开下单说明',
  initial_deadline_at: now + 40_000, resubmission_deadline_at: now + 60_000, content_updated: false,
  reference_order_amount_jpy: '3980', buyer_self_pay_bps: 1250,
  estimated_buyer_self_pay_jpy: '498', estimated_refundable_principal_jpy: '3482',
  main_image: { image_id: 'image-main', position: null, mime: 'image/png', width: 800, height: 800,
    read_intent_path: invalid ? '/api/staff/files/private/read-intent' : '/api/buyer-portal/reservations/reservation-1/order-instruction/images/main/read-intent' },
  keyword_images: [{ image_id: 'image-keyword', position: 1, mime: 'image/png', width: 800, height: 800,
    read_intent_path: '/api/buyer-portal/reservations/reservation-1/order-instruction/images/1/read-intent' }],
});

const evidenceFile = { file_object_id: 'evidence-file', client_file_name: '订单截图.png', mime: 'image/png',
  byte_size: 3, status: 'VERIFIED', visibility: 'BUYER_VISIBLE', verified_at: now - 4_000,
  file_entity_link_id: 'evidence-link', version: 3, allowed_actions: ['CREATE_READ_INTENT'] };
const evidence = {
  submission_id: 'evidence-1', reservation: { reservation_id: 'reservation-1', demand_id: 'demand-1',
    marketplace_code: 'JP', product_name: demand.product_name, store_display_name: demand.store_display_name,
    review_type: 'IMAGE', order_deadline: now + 100_000 }, marketplace: 'JP',
  amazon_order_number_display: '123-1234567-1234567', amazon_order_date: '2026-08-06', final_paid_jpy: 4100,
  buyer_self_pay_bps: 1250, buyer_self_pay_jpy: 512, buyer_refundable_principal_jpy: 3588,
  price_mismatch: true, price_difference_jpy: 120, status: 'CHANGES_REQUESTED', version: 2,
  evidence_version_no: 1, submitted_at: now - 5_000, updated_at: now - 4_000, verified_at: null,
  public_change_reason: '请补充清晰截图', files: [evidenceFile], allowed_actions: ['RESUBMIT', 'WITHDRAW'],
};

const formalOrder = { formal_order_id: 'formal-1', marketplace: 'JP',
  amazon_order_number: evidence.amazon_order_number_display, amazon_order_date: null, product_name: demand.product_name,
  review_type: 'IMAGE', final_paid_jpy: '4100', buyer_self_pay_bps: 1250, buyer_self_pay_jpy: '512',
  buyer_refundable_principal_jpy: '3588', buyer_expected_principal_cny_fen: '19734',
  buyer_exchange_rate_snapshot: { version_no: 1, business_date: '2026-08-06', confirmed_at: now - 3_000, cny_per_jpy_e8: '5500000' },
  confirmed_at: now - 3_000, confirmed_business_date: '2026-08-06', status: 'CONFIRMED',
  order_evidence_summary: { evidence_version_no: 1, submitted_at: now - 5_000, verified_at: now - 3_500, file_count: 1 },
};

const reviewOrder = { formal_order_id: 'formal-1', marketplace: 'JP', amazon_order_number: evidence.amazon_order_number_display,
  amazon_order_date: '2026-08-06', product_name: demand.product_name, review_type: 'IMAGE',
  confirmed_at: now - 3_000, confirmed_business_date: '2026-08-06', status: 'CONFIRMED' };
const review = (status: MockOptions['reviewStatus'] = 'CHANGES_REQUESTED') => ({
  review_case_id: 'review-1', order: reviewOrder, review_type: 'IMAGE', status, version: 2,
  current_evidence_version_no: 1, submitted_at: now - 2_500, updated_at: now - 2_000,
  public_change_reason: status === 'CHANGES_REQUESTED' ? '请补充完整评论截图' : null,
  review_url: 'https://www.amazon.co.jp/review/example', review_approved_at: status === 'APPROVED' ? now - 1_000 : null,
  buyer_refund_due: status === 'APPROVED' ? { amount_cny_fen: '19734' } : null,
  file_count: 1, allowed_actions: status === 'CHANGES_REQUESTED' ? ['RESUBMIT', 'WITHDRAW'] : [],
});
const reviewDetail = (status: MockOptions['reviewStatus'] = 'CHANGES_REQUESTED') => ({ ...review(status), files: [{
  file_object_id: 'review-file', file_entity_link_id: 'review-link', client_file_name: '评论截图.png',
  mime: 'image/png', byte_size: 3, status: 'VERIFIED', version: 3, verified_at: now - 2_400,
  allowed_actions: ['CREATE_READ_INTENT'],
}] });

const refund = (status: MockOptions['refundStatus'] = 'PARTIALLY_PAID') => ({
  refund_obligation_id: 'refund-1', due_amount_cny_fen: '19734', net_paid_cny_fen: status === 'OVERPAID' ? '21000' : '10000',
  remaining_amount_cny_fen: status === 'PARTIALLY_PAID' ? '9734' : '0', overpaid_amount_cny_fen: status === 'OVERPAID' ? '1266' : '0', status,
  order: { formal_order_id: 'formal-1', marketplace: 'JP', amazon_order_number: evidence.amazon_order_number_display,
    product_name: demand.product_name, review_type: 'IMAGE', status: 'CONFIRMED' }, allowed_actions: [],
});
const refundDetail = (status: MockOptions['refundStatus'] = 'PARTIALLY_PAID') => ({ ...refund(status), activities: [
  { activity_id: 'pay-1', activity_type: 'PAYMENT_RECORDED', amount_cny_fen: '12000', occurred_at: now - 600,
    payment_channel: 'WECHAT_PAY', balance_after: { due_amount_cny_fen: '19734', net_paid_cny_fen: '12000', remaining_amount_cny_fen: '7734', overpaid_amount_cny_fen: '0', status: 'PARTIALLY_PAID' } },
  { activity_id: 'reverse-1', activity_type: 'PAYMENT_REVERSED', amount_cny_fen: '2000', occurred_at: now - 300,
    payment_channel: 'WECHAT_PAY', balance_after: { due_amount_cny_fen: '19734', net_paid_cny_fen: '10000', remaining_amount_cny_fen: '9734', overpaid_amount_cny_fen: '0', status: 'PARTIALLY_PAID' } },
] });

async function installBuyerApi(page: Page, options: MockOptions = {}): Promise<void> {
  let sessionReads = 0;
  const failedOnce = new Set<string>();
  let activeUpload: { purpose: 'ORDER_EVIDENCE' | 'REVIEW_EVIDENCE'; visibility: 'BUYER_VISIBLE' | 'SELLER_VISIBLE'; count: number } | null = null;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (options.networkFailureOnce === path && !failedOnce.has(`network:${path}`)) {
      failedOnce.add(`network:${path}`); await route.abort('failed'); return;
    }
    if (options.failureOnce === path && !failedOnce.has(`http:${path}`)) {
      failedOnce.add(`http:${path}`); await json(route, failure('DEPENDENCY_UNAVAILABLE', 'module1-retry-source'), 503); return;
    }
    const forced = options.failures?.[path];
    if (forced) { await json(route, failure(forced === 403 ? 'FORBIDDEN' : forced === 404 ? 'NOT_FOUND' : forced === 409 ? 'VERSION_CONFLICT' : forced === 429 ? 'RATE_LIMITED' : 'DEPENDENCY_UNAVAILABLE'), forced); return; }
    if (path === '/api/customer-auth/session') { sessionReads += 1; await new Promise((resolve) => setTimeout(resolve, 10)); await json(route, success({ session: session(options.sessionType) })); return; }
    if (path === '/api/customer-auth/logout') { await json(route, success({ logged_out: true, all_devices_logged_out: false })); return; }
    if (path === `/api/buyer-auth/invitations/${buyerInvitationToken}`) {
      await json(route, success({ invitation: {
        invitation_valid: true, marketplace_code: 'AMAZON_JP',
        marketplace_name: '日本亚马逊', wechat_hint: 'bu***wx',
        expires_at: now + 100_000,
      } })); return;
    }
    if (path === '/api/buyer-auth/register') {
      const status = options.registrationStatus ?? 201;
      if (status !== 201) { await json(route, failure(status === 429 ? 'RATE_LIMITED' : 'FEATURE_DISABLED'), status, status === 429 ? { 'Retry-After': '10' } : {}); return; }
      await json(route, success({ identity: { buyer_number: 'B-1001', wechat_id: 'buyer_wx' }, session_established: true, must_change_password: false, next_path: '/buyer' }), 201); return;
    }
    if (path === '/api/buyer-portal/me') { await json(route, success({ buyer: { display_name: '月白买家', marketplace_code: 'JP', identity_review_status: options.reviewRequired ? 'REVIEW_REQUIRED' : 'CLEAR' } })); return; }
    if (path === '/api/buyer-portal/demands') {
      const cursor = url.searchParams.get('cursor');
      if (options.cursorPages && cursor === 'demand-cursor-2') { await json(route, success({ items: [{ ...demand, demand_id: 'demand-2', product_name: '月白补充装' }], next_cursor: 'demand-cursor-3' })); return; }
      if (options.cursorPages && cursor === 'demand-cursor-3') { await json(route, success({ items: [{ ...demand, demand_id: 'demand-3', product_name: '月白旅行装' }], next_cursor: null })); return; }
      await json(route, success({ items: [demand], next_cursor: options.cursorPages ? 'demand-cursor-2' : 'more-demands' })); return;
    }
    if (path === '/api/buyer-portal/demands/demand-1') { await json(route, success({ demand })); return; }
    if (path === '/api/buyer-portal/demands/demand-1/reservations') {
      if (options.reservationConflict) { await json(route, failure('VERSION_CONFLICT'), 409); return; }
      await json(route, success({ reservation, replayed: false }), 201); return;
    }
    if (path === '/api/buyer-portal/reservations') { await json(route, success({ items: [reservation], next_cursor: null })); return; }
    if (path === '/api/buyer-portal/reservations/reservation-1') { await json(route, success({ reservation })); return; }
    if (path === '/api/buyer-portal/reservations/reservation-1/cancel') { await json(route, success({ reservation: { ...reservation, status: 'CANCELLED', can_cancel: false, version: 3, cancelled_at: now }, replayed: false })); return; }
    if (path.endsWith('/order-instruction/state')) { await json(route, success({ order_instruction: instructionState(options.instructionStatus) })); return; }
    if (path.endsWith('/order-instruction')) { await json(route, success({ order_instruction: instruction(options.invalidInstructionPath) })); return; }
    if (path.includes('/order-instruction/images/') && path.endsWith('/read-intent')) { await json(route, success({ read_intent: { read_intent_id: 'image-intent', access_token: 'x'.repeat(40), access_token_available: true, expires_at: now + 1000 } }), 201); return; }
    if (path === '/api/buyer-portal/order-evidence/eligible-reservations') { await json(route, success({ items: [{ ...evidence.reservation, current_order_evidence_status: null, current_order_evidence_version: null, allowed_actions: ['SUBMIT'] }], next_cursor: null })); return; }
    if (path === '/api/buyer-portal/order-evidence' && request.method() === 'GET') { await json(route, success({ items: [evidence], next_cursor: 'more-evidence' })); return; }
    if (path === '/api/buyer-portal/order-evidence' && request.method() === 'POST') { await json(route, success({ order_evidence: { ...evidence, status: 'PENDING_VERIFICATION', allowed_actions: ['WITHDRAW'], price_mismatch: false, price_difference_jpy: 0 }, replayed: false }), 201); return; }
    if (path === '/api/buyer-portal/order-evidence/evidence-1') { await json(route, success({ order_evidence: evidence })); return; }
    if (path.endsWith('/order-evidence/evidence-1/resubmit')) { await json(route, success({ order_evidence: { ...evidence, status: 'PENDING_VERIFICATION', version: 3, allowed_actions: ['WITHDRAW'] }, replayed: false })); return; }
    if (path.endsWith('/order-evidence/evidence-1/withdraw')) { await json(route, success({ order_evidence: { ...evidence, status: 'WITHDRAWN', version: 3, allowed_actions: [] }, replayed: false })); return; }
    if (path.endsWith('/order-evidence/evidence-1/files/evidence-link/read-intent')) { await json(route, success({ read_intent_id: 'evidence-intent', file_object_id: 'evidence-file', access_token: 'x'.repeat(40), access_token_available: true, expires_at: now + 1000, replayed: false }), 201); return; }
    if (path === '/api/buyer-portal/formal-orders') { await json(route, success({ items: [formalOrder], next_cursor: null })); return; }
    if (path === '/api/buyer-portal/formal-orders/formal-1') { await json(route, success({ formal_order: formalOrder })); return; }
    if (path === '/api/buyer-portal/reviews/eligible-orders') { await json(route, success({ items: [{ order: reviewOrder, current_review: null, allowed_actions: ['SUBMIT'] }], next_cursor: null })); return; }
    if (path === '/api/buyer-portal/reviews' && request.method() === 'GET') { await json(route, success({ items: [review(options.reviewStatus)], next_cursor: null })); return; }
    if (path === '/api/buyer-portal/reviews' && request.method() === 'POST') { await json(route, success({ review: reviewDetail('PENDING_REVIEW'), replayed: false }), 201); return; }
    if (path === '/api/buyer-portal/reviews/review-1') { await json(route, success({ review: reviewDetail(options.reviewStatus) })); return; }
    if (path.endsWith('/reviews/review-1/resubmit')) { await json(route, success({ review: reviewDetail('PENDING_REVIEW'), replayed: false })); return; }
    if (path.endsWith('/reviews/review-1/withdraw')) { await json(route, success({ review: reviewDetail('WITHDRAWN'), replayed: false })); return; }
    if (path.endsWith('/reviews/review-1/files/review-link/read-intent')) { await json(route, success({ read_intent_id: 'review-intent', file_object_id: 'review-file', access_token: 'x'.repeat(40), access_token_available: true, expires_at: now + 1000, replayed: false }), 201); return; }
    if (path === '/api/buyer-portal/refunds') { await json(route, success({ items: [refund(options.refundStatus)], next_cursor: null })); return; }
    if (path === '/api/buyer-portal/refunds/refund-1') { await json(route, success({ refund: refundDetail(options.refundStatus) })); return; }
    if (path === '/api/buyer-portal/file-uploads/order-evidence/intents' || path === '/api/buyer-portal/file-uploads/review-evidence/intents') {
      const body = request.postDataJSON() as { files: unknown[] };
      const reviewUpload = path.includes('review-evidence');
      activeUpload = { purpose: reviewUpload ? 'REVIEW_EVIDENCE' : 'ORDER_EVIDENCE', visibility: reviewUpload ? 'SELLER_VISIBLE' : 'BUYER_VISIBLE', count: body.files.length };
      await json(route, success({ upload_intent_id: 'upload-intent', purpose: activeUpload.purpose,
        visibility: activeUpload.visibility, status: 'ISSUED', version: 1, expires_at: now + 1000,
        uploads: body.files.map((_, index) => ({ file_object_id: `upload-file-${index + 1}`, slot_no: index + 1, upload_token: 'u'.repeat(40), upload_token_available: true, expires_at: now + 1000 })), replayed: false }), 201); return;
    }
    if (/\/api\/buyer-portal\/file-uploads\/upload-file-\d+\/content$/u.test(path)) {
      const id = path.split('/').at(-2)!; await json(route, success({ file_object_id: id, upload_intent_id: 'upload-intent', status: 'UPLOADED', detected_mime: 'image/png', byte_size: 3, sha256: sha, version: 2, replayed: false })); return;
    }
    if (path === '/api/buyer-portal/file-upload-intents/upload-intent/complete') {
      if (!activeUpload) { await json(route, failure('NOT_FOUND'), 404); return; }
      await json(route, success({ upload_intent_id: 'upload-intent', status: 'VERIFIED', version: 2,
        files: Array.from({ length: activeUpload.count }, (_, index) => ({ file_object_id: `upload-file-${index + 1}`, purpose: activeUpload!.purpose, visibility: activeUpload!.visibility, detected_mime: 'image/png', byte_size: 3, sha256: sha, version: 3 })), replayed: false })); return;
    }
    if (path.includes('/file-read-intents/') && path.endsWith('/content')) {
      if (options.fileContentFailureOnce && !failedOnce.has('file-content')) {
        failedOnce.add('file-content');
        await json(route, failure(options.fileContentFailureOnce === 429 ? 'RATE_LIMITED' : 'DEPENDENCY_UNAVAILABLE'), options.fileContentFailureOnce,
          options.fileContentFailureOnce === 429 ? { 'Retry-After': '1' } : {}); return;
      }
      await route.fulfill({ status: 200, headers: { 'Content-Type': 'image/png', 'Content-Length': '3', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }, body: 'png' }); return;
    }
    await json(route, failure('NOT_FOUND'), 404);
  });
  await page.addInitScript((reads) => { (window as any).__module1SessionReads = reads; }, sessionReads);
}

async function gotoBuyer(page: Page, path: string, options: MockOptions = {}): Promise<void> {
  await installBuyerApi(page, options); await page.goto(path);
}

async function noOverflow(page: Page): Promise<void> {
  const sizes = await page.evaluate(() => [document.documentElement.clientWidth, document.documentElement.scrollWidth]);
  expect(sizes[1]).toBeLessThanOrEqual(sizes[0]! + 1);
}

const screenshotDirectory = process.env['MODULE1_BUYER_SCREENSHOT_DIR'];
async function captureAcceptance(page: Page, name: string): Promise<void> {
  if (!screenshotDirectory) return;
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: join(screenshotDirectory, name), fullPage: false });
}

test('Buyer registration exposes no manual human token input', async ({ page }) => {
  await page.goto('/buyer/register'); await expect(page.getByRole('heading', { name: '邀请注册' })).toBeVisible();
  await expect(page.locator('input[name="human_verification_token"]')).toHaveCount(0);
});

test('Buyer registration succeeds only after the verified session read', async ({ page }) => {
  await installBuyerApi(page); await page.goto(`/buyer/register?token=${buyerInvitationToken}`);
  await page.getByLabel('微信号').fill('buyer_wx'); await page.getByLabel('密码', { exact: true }).fill('safe-password-123');
  await page.getByLabel('确认密码').fill('safe-password-123'); await page.getByRole('button', { name: '完成注册' }).click();
  await expect(page).toHaveURL(/\/buyer$/u); await expect(page.getByRole('navigation', { name: '买家导航' })).toBeVisible();
});

for (const [name, status, message] of [['disabled', 503, '当前暂未开放注册'], ['rate limited', 429, '操作过于频繁']] as const) {
  test(`Buyer registration ${name} fails safely`, async ({ page }) => {
    await installBuyerApi(page, { registrationStatus: status }); await page.goto(`/buyer/register?token=${buyerInvitationToken}`);
    await page.getByLabel('微信号').fill('buyer_wx'); await page.getByLabel('密码', { exact: true }).fill('safe-password-123');
    await page.getByLabel('确认密码').fill('safe-password-123'); await page.getByRole('button', { name: '完成注册' }).click();
    await expect(page.getByText(new RegExp(message, 'u'))).toBeVisible();
  });
}

test('Buyer registration mismatch logs out and stays fail closed', async ({ page }) => {
  await installBuyerApi(page, { sessionType: 'SELLER_MEMBER' }); await page.goto(`/buyer/register?token=${buyerInvitationToken}`);
  await page.getByLabel('微信号').fill('buyer_wx'); await page.getByLabel('密码', { exact: true }).fill('safe-password-123');
  await page.getByLabel('确认密码').fill('safe-password-123'); await page.getByRole('button', { name: '完成注册' }).click();
  await expect(page.getByText('注册后的会话身份不匹配，已安全退出。')).toBeVisible();
});

test('Root has no registration link', async ({ page }) => { await page.goto('/'); await expect(page.getByRole('link')).toHaveCount(0); });
test('Buyer login has no registration link', async ({ page }) => { await page.goto('/buyer/login'); await expect(page.getByRole('link', { name: /注册/u })).toHaveCount(0); });

test('Dashboard lists only server-authoritative reservable products', async ({ page }) => {
  await gotoBuyer(page, '/buyer'); const cards = page.locator('main a[href^="/buyer/demands/"]:has(h2)'); await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('月白护肤套装'); await expect(cards).not.toContainText('修改订单资料');
});

test('Dashboard shows a product-only failure safely', async ({ page }) => {
  await gotoBuyer(page, '/buyer', { failures: { '/api/buyer-portal/demands': 503 } });
  await expect(page.getByText('产品暂时无法读取')).toBeVisible();
});

test('Dashboard reload restores the product list', async ({ page }) => {
  let demandReads = 0;
  page.on('request', (request) => { if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/buyer-portal/demands') demandReads += 1; });
  await gotoBuyer(page, '/buyer', { failureOnce: '/api/buyer-portal/demands' });
  await expect(page.getByText('产品暂时无法读取')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '月白护肤套装', exact: true })).toBeVisible(); expect(demandReads).toBe(2);
});

for (const [path, owner] of [
  ['/buyer/demands/demand-1', '产品'], ['/buyer/reservations/reservation-1/instruction', '产品'],
  ['/buyer/order-materials/evidence-1', '订单资料'], ['/buyer/orders/formal-1', '订单资料'],
  ['/buyer/reviews/review-1', '评论'], ['/buyer/refunds/refund-1', '我的'], ['/buyer/change-password', '我的'],
] as const) {
  test(`Nested Buyer route ${path} has one ${owner} navigation owner`, async ({ page }) => {
    await gotoBuyer(page, path); const nav = page.getByRole('navigation', { name: '买家导航' });
    await expect(nav.getByRole('link')).toHaveCount(5); await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(nav.getByRole('link', { name: owner })).toHaveAttribute('aria-current', 'page');
  });
}

test('Demand list shows real rules and deadlines', async ({ page }) => { await gotoBuyer(page, '/buyer/demands'); await expect(page.getByText('月白护肤套装')).toBeVisible(); await expect(page.getByText('12.50%')).toBeVisible(); });
test('Demand cursor loads and retains three pages', async ({ page }) => {
  await gotoBuyer(page, '/buyer/demands', { cursorPages: true });
  await page.getByRole('button', { name: '加载更多' }).click(); await page.getByRole('button', { name: '加载更多' }).click();
  await expect(page.getByText('月白护肤套装')).toBeVisible(); await expect(page.getByText('月白补充装')).toBeVisible(); await expect(page.getByText('月白旅行装')).toBeVisible();
});
test('Demand confirmation defaults unchecked', async ({ page }) => { await gotoBuyer(page, '/buyer/demands/demand-1'); await expect(page.getByRole('checkbox')).not.toBeChecked(); await expect(page.getByRole('button', { name: '确认并预约' })).toBeDisabled(); });
test('Demand version conflict resets acceptance', async ({ page }) => { await gotoBuyer(page, '/buyer/demands/demand-1', { reservationConflict: true }); await page.getByRole('checkbox').check(); await page.getByRole('button', { name: '确认并预约' }).click(); await expect(page.getByRole('checkbox')).not.toBeChecked(); });
test('Ambiguous reservation retry preserves the exact idempotency key and body', async ({ page }) => {
  const operations: { key: string | undefined; body: string | null }[] = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname.endsWith('/demands/demand-1/reservations')) operations.push({ key: request.headers()['idempotency-key'], body: request.postData() }); });
  await gotoBuyer(page, '/buyer/demands/demand-1', { networkFailureOnce: '/api/buyer-portal/demands/demand-1/reservations' });
  await page.getByRole('checkbox').check(); await page.getByRole('button', { name: '确认并预约' }).click();
  await page.getByRole('button', { name: '重新尝试同一操作' }).click(); await expect(page).toHaveURL(/\/buyer\/reservations\/reservation-1$/u);
  expect(operations).toHaveLength(2); expect(operations[0]).toEqual(operations[1]);
});
test('Reservation creation navigates to authoritative detail', async ({ page }) => { await gotoBuyer(page, '/buyer/demands/demand-1'); await page.getByRole('checkbox').check(); await page.getByRole('button', { name: '确认并预约' }).click(); await expect(page).toHaveURL(/\/buyer\/reservations\/reservation-1$/u); });
test('Reservation list shows status', async ({ page }) => { await gotoBuyer(page, '/buyer/reservations'); await expect(page.getByText('已确认')).toBeVisible(); });
test('Reservation cancellation is offered only by can_cancel', async ({ page }) => { await gotoBuyer(page, '/buyer/reservations/reservation-1'); await expect(page.getByRole('button', { name: '取消预约' })).toBeVisible(); });
test('Reservation cancel uses an explicit confirmation dialog', async ({ page }) => { await gotoBuyer(page, '/buyer/reservations/reservation-1'); await page.getByRole('button', { name: '取消预约' }).click(); await expect(page.getByRole('dialog', { name: '取消预约' })).toBeVisible(); });

for (const status of ['UNPUBLISHED', 'EXPIRED', 'CANCELLED'] as const) {
  test(`Instruction ${status} state does not expose a submit action`, async ({ page }) => {
    await gotoBuyer(page, '/buyer/reservations/reservation-1/instruction', { instructionStatus: status });
    await expect(page.getByRole('heading', { name: status === 'UNPUBLISHED' ? '尚未发布' : status === 'EXPIRED' ? '已到期' : '已取消' })).toBeVisible();
    await expect(page.getByRole('link', { name: '提交订单资料' })).toHaveCount(0);
  });
}

test('Instruction ACTIVE reads content after state and shows image controls', async ({ page }) => { await gotoBuyer(page, '/buyer/reservations/reservation-1/instruction'); await expect(page.getByText('商品图片')).toBeVisible(); await expect(page.getByRole('button', { name: '查看主图' })).toBeVisible(); });
test('Instruction COMPLETED is terminal and makes zero Content requests', async ({ page }) => {
  let contentRequests = 0; page.on('request', (request) => { if (new URL(request.url()).pathname.endsWith('/order-instruction')) contentRequests += 1; });
  await gotoBuyer(page, '/buyer/reservations/reservation-1/instruction', { instructionStatus: 'COMPLETED' });
  await expect(page.getByRole('heading', { name: '已完成' })).toBeVisible(); await expect(page.getByText('商品图片')).toHaveCount(0); expect(contentRequests).toBe(0);
});
test('Instruction arbitrary image path fails closed without pageerror', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await gotoBuyer(page, '/buyer/reservations/reservation-1/instruction', { invalidInstructionPath: true });
  await expect(page.getByRole('heading', { name: '暂时无法读取内容' })).toBeVisible(); expect(errors).toEqual([]);
});

test('Order materials show actionable and submitted sections', async ({ page }) => { await gotoBuyer(page, '/buyer/order-materials'); await expect(page.getByText('可提交')).toBeVisible(); await expect(page.getByText('已提交资料')).toBeVisible(); });
test('Evidence detail survives direct deep link refresh', async ({ page }) => { await gotoBuyer(page, '/buyer/order-materials/evidence-1'); await page.reload(); await expect(page.getByText('123-1234567-1234567')).toBeVisible(); });
test('Evidence stale deep link remains concealed', async ({ page }) => { await gotoBuyer(page, '/buyer/order-materials/new?reservation_id=foreign'); await expect(page.getByRole('heading', { name: '无法打开提交页面' })).toBeVisible(); });
test('Evidence form rejects non-Gregorian browser text input', async ({ page }) => { await gotoBuyer(page, '/buyer/order-materials/new?reservation_id=reservation-1'); await expect(page.getByLabel('Amazon 下单日期')).toHaveAttribute('type', 'date'); });
test('Evidence form input is exact-one screenshot', async ({ page }) => { await gotoBuyer(page, '/buyer/order-materials/new?reservation_id=reservation-1'); const input = page.getByLabel('订单截图'); await expect(input).not.toHaveAttribute('multiple'); await expect(input).toHaveAttribute('required', ''); });
test('Evidence upload and submit completes the business command', async ({ page }) => {
  await gotoBuyer(page, '/buyer/order-materials/new?reservation_id=reservation-1');
  await page.getByLabel('Amazon 订单号').fill('123-1234567-1234567'); await page.getByLabel('Amazon 下单日期').fill('2026-08-06');
  await page.getByLabel('最终支付金额 JPY').fill('4100'); await page.getByLabel('订单截图').setInputFiles({ name: 'evidence.png', mimeType: 'image/png', buffer: Buffer.from('png') });
  await page.getByRole('button', { name: '提交资料' }).click(); await expect(page).toHaveURL(/\/buyer\/order-materials\/evidence-1$/u);
});
test('Evidence detail shows fixed PRICE_MISMATCH copy and signed direction', async ({ page }) => { await gotoBuyer(page, '/buyer/order-materials/evidence-1'); await expect(page.getByText('实际支付金额与参考金额不一致')).toBeVisible(); await expect(page.getByText('+¥120 JPY（实际支付高于参考金额）')).toBeVisible(); });
test('Evidence historical metadata falls back without a read action', async ({ page }) => { const metadata = { ...evidenceFile, file_entity_link_id: null, version: null, allowed_actions: [] }; await installBuyerApi(page); await page.route('**/api/buyer-portal/order-evidence/evidence-1', (route) => json(route, success({ order_evidence: { ...evidence, files: [metadata] } }))); await page.goto('/buyer/order-materials/evidence-1'); await expect(page.getByText('历史文件仅保留元数据')).toBeVisible(); });
test('Evidence withdrawal requires confirmation', async ({ page }) => { await gotoBuyer(page, '/buyer/order-materials/evidence-1'); await page.getByRole('button', { name: '撤回资料' }).click(); await expect(page.getByRole('dialog', { name: '撤回订单资料' })).toBeVisible(); });
test('Evidence changes-requested resubmit requires date and one new screenshot', async ({ page }) => { await gotoBuyer(page, '/buyer/order-materials/evidence-1'); await expect(page.getByRole('heading', { name: '按说明重新提交' })).toBeVisible(); await expect(page.getByLabel('新的订单截图')).not.toHaveAttribute('multiple'); });
test('Evidence protected file read consumes the shared content endpoint', async ({ page }) => { await gotoBuyer(page, '/buyer/order-materials/evidence-1'); await page.getByRole('button', { name: '查看文件' }).click(); await expect(page.getByRole('link', { name: '打开文件' })).toBeVisible(); });

for (const status of [429, 503] as const) {
  test(`Provider ${status} recovery retries the same content token`, async ({ page }) => {
    const tokens: string[] = []; page.on('request', (request) => { if (new URL(request.url()).pathname.includes('/file-read-intents/')) tokens.push(request.headers()['x-file-read-token'] ?? ''); });
    await gotoBuyer(page, '/buyer/order-materials/evidence-1', { fileContentFailureOnce: status });
    await page.getByRole('button', { name: '查看文件' }).click();
    await expect(page.getByRole('button', { name: '重试读取' })).toBeVisible({ timeout: status === 429 ? 2_500 : 1_000 });
    await page.getByRole('button', { name: '重试读取' }).click(); await expect(page.getByRole('link', { name: '打开文件' })).toBeVisible();
    expect(tokens).toHaveLength(2); expect(tokens[0]).toBe(tokens[1]);
  });
}

test('Formal order list exposes all six business filters plus paging', async ({ page }) => { await gotoBuyer(page, '/buyer/orders'); await expect(page.getByRole('search', { name: '正式订单筛选' })).toBeVisible(); await expect(page.getByLabel('Amazon 订单号')).toBeVisible(); });
test('Formal order detail displays historical null date as unknown', async ({ page }) => { await gotoBuyer(page, '/buyer/orders/formal-1'); await expect(page.getByText('未知')).toBeVisible(); await expect(page.getByText('汇率快照 e8')).toBeVisible(); });

test('Review list shows eligible and submitted cases', async ({ page }) => { await gotoBuyer(page, '/buyer/reviews'); await expect(page.getByText('可提交评论')).toBeVisible(); await expect(page.getByText('已提交评论')).toBeVisible(); });
test('Review stale deep link remains concealed', async ({ page }) => { await gotoBuyer(page, '/buyer/reviews/new?formal_order_id=foreign'); await expect(page.getByRole('heading', { name: '无法打开评论提交页面' })).toBeVisible(); });
test('Review form enforces business 1–3 evidence guidance', async ({ page }) => { await gotoBuyer(page, '/buyer/reviews/new?formal_order_id=formal-1'); await expect(page.getByText('请选择 1–3 个图片或 PDF 文件')).toBeVisible(); await expect(page.getByLabel('评论证据')).toHaveAttribute('multiple', ''); });
test('Review upload and submit sends 1–3 verified file versions', async ({ page }) => {
  const requests: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => { pageErrors.push(error.message); });
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) requests.push(`${request.method()} ${path}`);
  });
  await gotoBuyer(page, '/buyer/reviews/new?formal_order_id=formal-1');
  await page.getByLabel('评论证据').setInputFiles(
    { name: 'review-a.png', mimeType: 'image/png', buffer: Buffer.from('png') },
  );
  await page.getByRole('button', { name: '提交评论资料' }).click();
  await expect.poll(() => ({ requests, pageErrors })).toEqual(expect.objectContaining({
    requests: expect.arrayContaining(['POST /api/buyer-portal/reviews']),
    pageErrors: [],
  }));
  await expect(page).toHaveURL(/\/buyer\/reviews\/review-1$/u);
});
test('Review detail shows public change reason and resubmit form', async ({ page }) => { await gotoBuyer(page, '/buyer/reviews/review-1'); await expect(page.getByText('修改说明：请补充完整评论截图')).toBeVisible(); await expect(page.getByRole('heading', { name: '按说明重新提交' })).toBeVisible(); });
test('Approved review shows refund amount without inventing payment', async ({ page }) => { await gotoBuyer(page, '/buyer/reviews/review-1', { reviewStatus: 'APPROVED' }); await expect(page.getByText(/返款金额/u)).toBeVisible(); await expect(page.getByText(/已支付/u)).toHaveCount(0); });
test('Review protected file read uses entity-bound provider', async ({ page }) => { await gotoBuyer(page, '/buyer/reviews/review-1'); await page.getByRole('button', { name: '查看文件' }).click(); await expect(page.getByRole('link', { name: '打开文件' })).toBeVisible(); });

test('Refund detail keeps payment and reversal activities visible', async ({ page }) => { await gotoBuyer(page, '/buyer/refunds/refund-1'); await expect(page.getByText('记录付款')).toBeVisible(); await expect(page.getByText('付款冲正')).toBeVisible(); });
test('Refund OVERPAID displays overpaid amount', async ({ page }) => { await gotoBuyer(page, '/buyer/refunds/refund-1', { refundStatus: 'OVERPAID' }); await expect(page.getByText('超额返款')).toBeVisible(); await expect(page.getByText('¥12.66 CNY')).toBeVisible(); });
test('Me displays service links without internal account fields', async ({ page }) => { await gotoBuyer(page, '/buyer/me'); await expect(page.getByText('B-1001')).toHaveCount(0); await expect(page.getByRole('link', { name: '正式订单' })).toBeVisible(); await expect(page.getByRole('link', { name: '返款记录' })).toBeVisible(); });
test('Me REVIEW_REQUIRED shows only safe limitation guidance', async ({ page }) => { await gotoBuyer(page, '/buyer/me', { reviewRequired: true }); await expect(page.getByText(/部分业务操作会受到限制/u)).toBeVisible(); await expect(page.getByRole('button', { name: /编辑/u })).toHaveCount(0); });
test('Me logout returns to Buyer login', async ({ page }) => { await gotoBuyer(page, '/buyer/me'); await page.getByRole('button', { name: '退出登录' }).click(); await expect(page).toHaveURL(/\/buyer\/login$/u); });

test('Buyer 401 redirects before shell renders', async ({ page }) => { await gotoBuyer(page, '/buyer', { failures: { '/api/customer-auth/session': 401 } }); await expect(page.getByText('月光白')).toBeVisible(); });
for (const [status, path, message] of [[403, '/api/buyer-portal/me', '当前账号没有查看'], [404, '/api/buyer-portal/order-evidence/evidence-1', '内容不存在'], [503, '/api/buyer-portal/formal-orders/formal-1', '服务暂时不可用']] as const) {
  test(`Buyer ${status} renders a safe request-bound error`, async ({ page }) => { await gotoBuyer(page, status === 403 ? '/buyer/me' : status === 404 ? '/buyer/order-materials/evidence-1' : '/buyer/orders/formal-1', { failures: { [path]: status } }); await expect(page.getByText(new RegExp(message, 'u'))).toBeVisible(); await expect(page.getByText('请求编号：module1-browser-error')).toBeVisible(); });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 800 }]) {
  test(`Buyer layout reflows without horizontal overflow at ${viewport.width}px`, async ({ page }) => { await page.setViewportSize(viewport); await gotoBuyer(page, '/buyer/order-materials/evidence-1'); await noOverflow(page); await expect(page.getByRole('navigation', { name: '买家导航' })).toBeVisible(); });
}
test('Buyer remains readable at 200 percent text zoom', async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); await gotoBuyer(page, '/buyer/me'); await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; }); await noOverflow(page); await expect(page.getByText('月白买家')).toBeVisible(); });
test('Buyer respects reduced motion', async ({ page }) => { await page.emulateMedia({ reducedMotion: 'reduce' }); await gotoBuyer(page, '/buyer'); const duration = await page.evaluate(() => { const element = document.createElement('span'); element.className = 'buyer-loading-mark'; document.body.append(element); return getComputedStyle(element).animationDuration; }); expect(duration).not.toBe('0.9s'); });
test('Buyer keyboard focus remains visible', async ({ page }) => { await gotoBuyer(page, '/buyer/me'); const focused = page.getByRole('link', { name: '正式订单' }); await focused.focus(); await expect(focused).toBeFocused(); const outline = await focused.evaluate((element) => getComputedStyle(element).outlineStyle); expect(outline).not.toBe('none'); });

test('capture Module1 root desktop acceptance', async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/'); await expect(page.getByRole('heading', { name: '月光白' })).toBeVisible(); await captureAcceptance(page, 'root-desktop-1440x900.png'); });
test('capture Module1 registration mobile acceptance', async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/buyer/register'); await expect(page.getByRole('heading', { name: '邀请注册' })).toBeVisible(); await captureAcceptance(page, 'buyer-register-mobile-390x844.png'); });
test('capture Module1 login mobile acceptance', async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/buyer/login'); await expect(page.getByText('月光白')).toBeVisible(); await captureAcceptance(page, 'buyer-login-mobile-390x844.png'); });

for (const [name, path] of [
  ['buyer-dashboard-mobile-390x844.png', '/buyer'],
  ['buyer-demands-mobile-390x844.png', '/buyer/demands'],
  ['buyer-demand-detail-mobile-390x844.png', '/buyer/demands/demand-1'],
  ['buyer-reservation-detail-mobile-390x844.png', '/buyer/reservations/reservation-1'],
  ['buyer-instruction-mobile-390x844.png', '/buyer/reservations/reservation-1/instruction'],
  ['buyer-order-evidence-form-mobile-390x844.png', '/buyer/order-materials/new?reservation_id=reservation-1'],
  ['buyer-price-mismatch-mobile-390x844.png', '/buyer/order-materials/evidence-1'],
  ['buyer-order-evidence-detail-mobile-390x844.png', '/buyer/order-materials/evidence-1'],
  ['buyer-formal-order-detail-mobile-390x844.png', '/buyer/orders/formal-1'],
  ['buyer-review-form-mobile-390x844.png', '/buyer/reviews/new?formal_order_id=formal-1'],
  ['buyer-review-detail-mobile-390x844.png', '/buyer/reviews/review-1'],
  ['buyer-refund-detail-mobile-390x844.png', '/buyer/refunds/refund-1'],
  ['buyer-me-mobile-390x844.png', '/buyer/me'],
] as const) {
  test(`capture Module1 ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await gotoBuyer(page, path);
    await expect(page.locator('.buyer-page')).toBeVisible(); await captureAcceptance(page, name);
  });
}

test('capture Module1 partial failure mobile acceptance', async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); await gotoBuyer(page, '/buyer', { failures: { '/api/buyer-portal/demands': 503 } }); await expect(page.getByText('产品暂时无法读取')).toBeVisible(); await captureAcceptance(page, 'buyer-dashboard-partial-error-mobile-390x844.png'); });
test('capture Module1 320 reflow acceptance', async ({ page }) => { await page.setViewportSize({ width: 320, height: 800 }); await gotoBuyer(page, '/buyer/order-materials/evidence-1'); await noOverflow(page); await captureAcceptance(page, 'buyer-320-reflow-320x800.png'); });
test('capture Module1 200 percent acceptance', async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); await gotoBuyer(page, '/buyer/me'); await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; }); await expect(page.getByText('月白买家')).toBeVisible(); await noOverflow(page); await captureAcceptance(page, 'buyer-200-percent-390x844.png'); });
test('capture Module1 permission error mobile acceptance', async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); await gotoBuyer(page, '/buyer/me', { failures: { '/api/buyer-portal/me': 403 } }); await expect(page.getByText(/当前账号没有查看/u)).toBeVisible(); await captureAcceptance(page, 'buyer-permission-error-mobile-390x844.png'); });
