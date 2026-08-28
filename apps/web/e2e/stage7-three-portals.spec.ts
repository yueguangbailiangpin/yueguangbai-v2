import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Stage 7 final verification across the three portals (staff / buyer / seller).
 * Every assertion runs against the real built app with deterministic API mocks
 * that mirror the CURRENT DTO contracts — no invented endpoints or permissions.
 * Staff mocks reuse the stage66e pattern; buyer mocks reuse module1-buyer;
 * seller mocks reuse seller-visual-refresh.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function ok(data: unknown, requestId = 'stage7-three-portals') {
  return {
    contentType: 'application/json',
    body: JSON.stringify({ data, meta: { request_id: requestId } }),
  };
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

const notFound = (route: Route) =>
  json(
    route,
    { error: { code: 'NOT_FOUND', message: 'not found', details: null }, meta: { request_id: 'stage7-404' } },
    404,
  );

// ---------------------------------------------------------------------------
// STAFF fixtures (stage66e pattern, extended with seller_ops)
// ---------------------------------------------------------------------------

type StaffRole = 'owner' | 'pre_sales' | 'buyer_refund' | 'seller_ops';

const staffRoleDisplay: Record<StaffRole, string> = {
  owner: '总管理员',
  pre_sales: '售前',
  buyer_refund: '买家返款',
  seller_ops: '卖家对接',
};

const staffPermissions: Record<StaffRole, string[]> = {
  owner: [
    'STAFF_MANAGE', 'PERMISSION_MANAGE', 'FINANCIAL_VIEW', 'ORDER_VIEW',
    'ORDER_CONFIRM', 'BUYER_REFUND_RECORD', 'BUYER_CREATE', 'SELLER_MANAGE',
  ],
  pre_sales: [
    'BUYER_CREATE', 'BUYER_VIEW', 'ORDER_VIEW', 'ORDER_CONFIRM',
    'RESERVATION_VIEW', 'RESERVATION_DECIDE',
  ],
  buyer_refund: ['BUYER_VIEW', 'ORDER_VIEW', 'REVIEW_VIEW', 'BUYER_REFUND_VIEW', 'BUYER_REFUND_RECORD'],
  seller_ops: ['SELLER_VIEW', 'SELLER_MANAGE', 'ORDER_VIEW', 'FINANCIAL_VIEW'],
};

function staffSession(role: StaffRole) {
  return {
    staff_id: `stage7-${role}`,
    display_name: staffRoleDisplay[role],
    role: { code: role, display_name: staffRoleDisplay[role] },
    permissions: staffPermissions[role],
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
      file_object_id: 'comm-7-1',
      file_version: 2,
      purpose: 'ORDER_COMMUNICATION_SCREENSHOT',
      visibility: 'SELLER_VISIBLE',
      uploaded_at: 1_754_240_000_000,
      uploaded_by_staff_id: 'stage7-owner',
      uploaded_by_staff_name: '总管理员',
    },
    {
      file_object_id: 'comm-7-2',
      file_version: 1,
      purpose: 'ORDER_COMMUNICATION_SCREENSHOT',
      visibility: 'SELLER_VISIBLE',
      uploaded_at: 1_754_240_100_000,
      uploaded_by_staff_id: 'stage7-owner',
      uploaded_by_staff_name: '总管理员',
    },
  ],
  operational_events: [
    {
      event_id: 'event-7',
      event_type: 'PRICE_MISMATCH_NOTE',
      reason: '备注',
      actor_staff_id: 'stage7-owner',
      created_at: 1_754_240_000_000,
    },
  ],
};

const BUYER_ADVANCE = {
  authoritative_advance_amount_cny_fen: '165000',
  recorded_advance_amount_cny_fen: '0',
  remaining_advance_amount_cny_fen: '165000',
  can_record_advance_payment: true,
};

async function mockStaffApis(page: Page, role: StaffRole): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (path.endsWith('/access/bootstrap')) {
      await route.fulfill(ok({ session: staffSession(role), access_email: 'stage7@example.test' }));
      return;
    }
    if (path.endsWith('/staff-auth/session')) {
      await route.fulfill(ok({ session: staffSession(role) }));
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
    if (path === '/api/staff/buyer-customers' && method === 'POST') {
      await route.fulfill({
        status: 201,
        ...ok({
          buyer_customer: {
            buyer_customer_id: 'buyer-7-created',
            buyer_number: '20260828B3001',
            access_status: 'DISABLED',
            activated: false,
            initial_pre_sales_owner: {
              assignment_id: 'assign-7',
              staff_id: 'stage7-pre_sales',
              staff_display_name: '售前',
              version: 1,
            },
          },
          replayed: false,
        }),
      });
      return;
    }
    if (path.endsWith('/buyer-registration-invitations') && method === 'POST') {
      await route.fulfill({
        status: 201,
        ...ok({
          invitation: {
            invitation_id: 'invitation-7',
            buyer_customer_id: 'buyer-7-created',
            buyer_customer_no: '20260828B3001',
            registration_token: 'T'.repeat(43),
            registration_path: '/buyer/register?token=T',
            wechat_id: 'wx_stage7',
            marketplace_code: 'AMAZON_JP',
            status: 'ACTIVE',
            version: 1,
            expires_at: 9_999_999_999_999,
            replayed: false,
          },
        }),
      });
      return;
    }
    if (path === '/api/staff/formal-orders/order-7') {
      const withAdvance = role === 'owner' || role === 'buyer_refund';
      await route.fulfill(
        ok(withAdvance ? { ...ORDER_DETAIL, buyer_advance: BUYER_ADVANCE } : ORDER_DETAIL),
      );
      return;
    }
    if (path.includes('/api/staff/buyer-advance-principal/order-7') && !path.includes('/payments')) {
      await route.fulfill(ok({ entries: [] }));
      return;
    }
    if (path.startsWith('/api/staff/access-management')) {
      if (role !== 'owner') {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'FORBIDDEN', message: '仅总管理员可管理员工' },
            meta: { request_id: 'stage7-403' },
          }),
        });
        return;
      }
      if (path.endsWith('/access-management')) {
        await route.fulfill(ok({ employees: [], available_marketplaces: [] }));
        return;
      }
      await route.fulfill(ok({ buyers: [], seller_organizations: [], denies: [] }));
      return;
    }
    if (path.includes('/api/staff/finance/') || path.includes('/api/staff/finance?')) {
      await route.fulfill(ok({ summary: {}, exceptions: [], groups: [] }));
      return;
    }
    await notFound(route);
  });
}

// ---------------------------------------------------------------------------
// BUYER fixtures (module1-buyer pattern, trimmed to the pages used here)
// ---------------------------------------------------------------------------

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

const buyerReservation = {
  reservation_id: 'reservation-1',
  status: 'APPROVED',
  version: 2,
  submitted_at: now - 8_000,
  updated_at: now - 5_000,
  hold_expires_at: now + 20_000,
  order_deadline_snapshot: now + 100_000,
  buyer_self_pay_bps_snapshot: 1250,
  reference_order_amount_jpy_snapshot: '3980',
  estimated_self_pay_jpy_snapshot: '498',
  estimated_refundable_principal_jpy_snapshot: '3482',
  buyer_self_pay_accepted_at: now - 8_000,
  buyer_self_pay_accepted_demand_version: 2,
  decided_at: now - 6_000,
  cancelled_at: null,
  expired_at: null,
  can_cancel: true,
  demand: {
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
  },
};

const buyerEvidence = {
  submission_id: 'evidence-1',
  reservation: {
    reservation_id: 'reservation-1',
    demand_id: 'demand-1',
    marketplace_code: 'AMAZON_JP',
    product_name: '月白护肤套装',
    store_display_name: '月白旗舰店',
    review_type: 'IMAGE',
    order_deadline: now + 100_000,
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
  amazon_order_date: null,
  product_name: '月白护肤套装',
  review_type: 'IMAGE',
  final_paid_jpy: '4100',
  buyer_self_pay_bps: 1250,
  buyer_self_pay_jpy: '512',
  buyer_refundable_principal_jpy: '3588',
  buyer_expected_principal_cny_fen: '19734',
  buyer_exchange_rate_snapshot: {
    version_no: 1,
    business_date: '2026-08-06',
    confirmed_at: now - 3_000,
    cny_per_jpy_e8: '5500000',
  },
  confirmed_at: now - 3_000,
  confirmed_business_date: '2026-08-06',
  status: 'CONFIRMED',
  order_evidence_summary: {
    evidence_version_no: 1,
    submitted_at: now - 5_000,
    verified_at: now - 3_500,
    file_count: 1,
  },
};

const buyerReviewOrder = {
  formal_order_id: 'formal-1',
  marketplace: 'AMAZON_JP',
  amazon_order_number: '123-1234567-1234567',
  amazon_order_date: '2026-08-06',
  product_name: '月白护肤套装',
  review_type: 'IMAGE',
  confirmed_at: now - 3_000,
  confirmed_business_date: '2026-08-06',
  status: 'CONFIRMED',
};
const buyerReview = {
  review_case_id: 'review-1',
  order: buyerReviewOrder,
  review_type: 'IMAGE',
  status: 'PENDING_REVIEW' as const,
  version: 2,
  current_evidence_version_no: 1,
  submitted_at: now - 2_500,
  updated_at: now - 2_000,
  public_change_reason: null,
  review_url: 'https://www.amazon.co.jp/review/example',
  review_approved_at: null,
  buyer_refund_due: null,
  file_count: 1,
  allowed_actions: ['WITHDRAW'],
};

const buyerRefund = {
  refund_obligation_id: 'refund-1',
  due_amount_cny_fen: '19734',
  net_paid_cny_fen: '10000',
  remaining_amount_cny_fen: '9734',
  overpaid_amount_cny_fen: '0',
  status: 'PARTIALLY_PAID' as const,
  order: {
    formal_order_id: 'formal-1',
    marketplace: 'AMAZON_JP',
    amazon_order_number: '123-1234567-1234567',
    product_name: '月白护肤套装',
    review_type: 'IMAGE',
    status: 'CONFIRMED',
  },
  reminder: { reminder_count: 0, last_reminded_at: null, next_reminder_at: null },
  allowed_actions: [],
};

export async function mockBuyerApis(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/customer-auth/session') {
      await route.fulfill(ok({
        session: {
          account_id: 'buyer-account',
          identity_subject_id: 'buyer-subject',
          account_type: 'BUYER',
          session_version: 1,
          password_change_required: false,
          issued_at: 1,
          expires_at: now + 100_000,
        },
      }));
      return;
    }
    if (path === '/api/buyer-portal/me') {
      await route.fulfill(ok({
        buyer: {
          display_name: '月白买家',
          marketplace_code: 'AMAZON_JP',
          identity_review_status: 'CLEAR',
          customer_number: '20260824B3612',
          refund_account_name: null,
          refund_account_identifier: null,
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
      await route.fulfill(ok({ items: [buyerReservation], next_cursor: null }));
      return;
    }
    if (path === '/api/buyer-portal/reservations/reservation-1') {
      await route.fulfill(ok({ reservation: buyerReservation }));
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
      await route.fulfill(ok({ items: [buyerReview], next_cursor: null }));
      return;
    }
    if (path === '/api/buyer-portal/refunds') {
      await route.fulfill(ok({ items: [buyerRefund], next_cursor: null }));
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
    await notFound(route);
  });
}

// ---------------------------------------------------------------------------
// SELLER fixtures (seller-visual-refresh pattern, trimmed)
// ---------------------------------------------------------------------------

const fixedNow = Date.parse('2026-08-28T04:00:00.000Z');
const pageInfo = { limit: 100, next_cursor: null };

function sellerMe(role: 'OWNER' | 'OPERATIONS') {
  return {
    account_id: 'seller-stage7-account',
    member: { id: 'member-stage7', display_name: '张三', role, primary_owner: role === 'OWNER' },
    organization: {
      id: 'org-stage7',
      seller_code: 'YG-26001',
      name: '月白生活株式会社',
      marketplace_code: 'AMAZON_JP',
      status: 'ACTIVE',
      settlement_account_name: null,
      settlement_account_identifier: null,
    },
    access: {
      read_scope: 'ORGANIZATION',
      store_ids: ['store-jp', 'store-us'],
      can_submit_product_applications: true,
      can_submit_demand_batches: true,
    },
  };
}

const sellerStores = [
  {
    id: 'store-jp',
    marketplace_code: 'AMAZON_JP',
    canonical_marketplace_code: 'AMAZON_JP',
    transaction_currency_code: 'JPY',
    transaction_currency_exponent: 0,
    marketplace_status: 'ACTIVE',
    adapter_status: 'AVAILABLE',
    display_name: '东京一号店',
    status: 'ACTIVE',
    version: 3,
    created_at: fixedNow - 90_000_000,
    updated_at: fixedNow - 3_600_000,
  },
  {
    id: 'store-us',
    marketplace_code: 'AMAZON_JP',
    canonical_marketplace_code: 'AMAZON_US',
    transaction_currency_code: 'USD',
    transaction_currency_exponent: 2,
    marketplace_status: 'ACTIVE',
    adapter_status: 'AVAILABLE',
    display_name: '北美精品店（停用）',
    status: 'DISABLED',
    version: 2,
    created_at: fixedNow - 80_000_000,
    updated_at: fixedNow - 7_200_000,
  },
];

const sellerOrders = [
  {
    formal_order_id: 'order-rice',
    status: 'CONFIRMED',
    marketplace_code: 'AMAZON_JP',
    amazon_order_number: '503-1234567-1234567',
    platform_order_identifier: '503-1234567-1234567',
    store: { id: 'store-jp', display_name: '东京一号店' },
    asin: 'B07W5DMQ3R',
    platform_product_identifier: 'B07W5DMQ3R',
    product_name: '象印 IH 电饭煲 5.5 合',
    product_version: { id: 'version-rice', version_no: 2 },
    review_type: 'IMAGE',
    main_image: null,
    order_screenshot: null,
    final_paid_jpy: '22800',
    payment: { amount_minor: '22800', currency_code: 'JPY', currency_exponent: 0 },
    seller_expected_principal_cny_fen: '91200',
    seller_principal_rate_snapshot: {
      platform_order_date: '2026-08-09',
      payment_amount_minor: '22800',
      payment_currency_code: 'JPY',
      base_rate_version_id: 'base-rate-jp',
      base_rate_business_date: '2026-08-09',
      base_rate_created_at: fixedNow - 8_000_000,
      base_rate_value: '3800000',
      base_rate_scale: '100000000',
      policy_version_id: 'policy-jp',
      policy_scope_type: 'SELLER_ORGANIZATION',
      policy_seller_organization_id: 'org-stage7',
      policy_version_no: 8,
      policy_effective_from: fixedNow - 10_000_000,
      policy_created_at: fixedNow - 8_000_000,
      markup_rate_value: '200000',
      markup_rate_scale: '100000000',
      final_rate_value: '4000000',
      final_rate_scale: '100000000',
      rounding_rule: 'HALF_UP',
      seller_expected_principal_amount_minor: '91200',
    },
    locked_service_fee_snapshot: {
      fee_version_id: 'fee-image',
      version_no: 4,
      review_type: 'IMAGE',
      service_fee_cny_fen: '3200',
      effective_from: fixedNow - 10_000_000,
      created_at: fixedNow - 8_000_000,
      marketplace_code: 'AMAZON_JP',
      currency_code: 'CNY',
      currency_exponent: 2,
    },
    business_completion: {
      status: 'IN_PROGRESS',
      review: 'COMPLETE',
      seller_principal: 'COMPLETE',
      seller_service_fee: 'PENDING',
    },
    confirmed_at: fixedNow - 7_200_000,
    confirmed_business_date: '2026-08-09',
    communication_screenshots: [
      {
        file_object_id: 'comm-seller-1',
        file_version: 2,
        purpose: 'ORDER_COMMUNICATION_SCREENSHOT',
        visibility: 'SELLER_VISIBLE',
        uploaded_at: fixedNow - 6_000_000,
        uploaded_by_staff_id: 'stage7-staff-1',
        uploaded_by_staff_name: '陈 staff',
      },
      {
        file_object_id: 'comm-seller-2',
        file_version: 1,
        purpose: 'ORDER_COMMUNICATION_SCREENSHOT',
        visibility: 'SELLER_VISIBLE',
        uploaded_at: fixedNow - 5_000_000,
        uploaded_by_staff_id: null,
        uploaded_by_staff_name: null,
      },
    ],
  },
];

const sellerPayables = [
  {
    payable_id: 'payable-principal',
    formal_order_id: 'order-rice',
    payable_type: 'SELLER_PRINCIPAL',
    amazon_order_number: '503-1234567-1234567',
    store: { id: 'store-jp', display_name: '东京一号店' },
    product: { id: 'product-rice', asin: 'B07W5DMQ3R', name: '象印 IH 电饭煲 5.5 合' },
    due_amount_cny_fen: '91200',
    paid_amount_cny_fen: '61200',
    outstanding_amount_cny_fen: '30000',
    status: 'PARTIALLY_PAID',
    due_at: fixedNow + 86_400_000,
    created_at: fixedNow - 7_200_000,
  },
  {
    payable_id: 'payable-fee',
    formal_order_id: 'order-rice',
    payable_type: 'SELLER_SERVICE_FEE',
    amazon_order_number: '503-1234567-1234567',
    store: { id: 'store-jp', display_name: '东京一号店' },
    product: { id: 'product-rice', asin: 'B07W5DMQ3R', name: '象印 IH 电饭煲 5.5 合' },
    due_amount_cny_fen: '3200',
    paid_amount_cny_fen: '0',
    outstanding_amount_cny_fen: '3200',
    status: 'UNPAID',
    due_at: fixedNow + 172_800_000,
    created_at: fixedNow - 7_200_000,
  },
];

export async function mockSellerApis(page: Page, role: 'OWNER' | 'OPERATIONS' = 'OWNER'): Promise<void> {
  const me = sellerMe(role);
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/customer-auth/session') {
      await route.fulfill(ok({
        session: {
          account_id: me.account_id,
          identity_subject_id: 'seller-stage7-subject',
          account_type: 'SELLER_MEMBER',
          session_version: 1,
          password_change_required: false,
          issued_at: fixedNow - 60_000,
          expires_at: fixedNow + 3_600_000,
        },
      }));
      return;
    }
    if (path === '/api/seller-portal/me') {
      await route.fulfill(ok({ me }));
      return;
    }
    if (path === '/api/seller-portal/stores') {
      await route.fulfill(ok({ items: sellerStores, page: pageInfo }));
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
      await route.fulfill(ok({ items: sellerOrders, page: pageInfo }));
      return;
    }
    if (path === '/api/seller-portal/settlement/summary') {
      await route.fulfill(ok({
        settlement: {
          outstanding_principal_cny_fen: '30000',
          outstanding_service_fee_cny_fen: '3200',
          total_outstanding_cny_fen: '33200',
          unallocated_credit_cny_fen: '1200',
          settlement_account_name: null,
          settlement_account_identifier: null,
        },
      }));
      return;
    }
    if (path === '/api/seller-portal/settlement/payables') {
      await route.fulfill(ok({ items: sellerPayables, page: pageInfo }));
      return;
    }
    await notFound(route);
  });
}

// ---------------------------------------------------------------------------
// STAFF tests
// ---------------------------------------------------------------------------

test.describe('stage 7 staff portal', () => {
  test('navigation differs per role: owner sees 员工与权限/财务, seller_ops sees 卖家/财务', async ({ page }) => {
    await mockStaffApis(page, 'owner');
    await page.goto('/staff');
    const nav = page.getByRole('navigation', { name: '员工工作台主导航' });
    await expect(nav.getByRole('link', { name: '员工与权限', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: '财务', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: '买家', exact: true })).toBeVisible();
  });

  test('pre_sales sees 客户/买家 but no 买家返款', async ({ page }) => {
    await mockStaffApis(page, 'pre_sales');
    await page.goto('/staff');
    const nav = page.getByRole('navigation', { name: '员工工作台主导航' });
    await expect(nav.getByText('客户', { exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: '买家', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: '买家返款', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: '员工与权限', exact: true })).toHaveCount(0);
  });

  test('buyer_refund sees 买家返款 but no 客户 group', async ({ page }) => {
    await mockStaffApis(page, 'buyer_refund');
    await page.goto('/staff');
    const nav = page.getByRole('navigation', { name: '员工工作台主导航' });
    await expect(nav.getByRole('link', { name: '买家返款', exact: true })).toBeVisible();
    await expect(nav.getByText('客户', { exact: true })).toHaveCount(0);
  });

  test('seller_ops sees 卖家 and 财务 but no 员工与权限', async ({ page }) => {
    await mockStaffApis(page, 'seller_ops');
    await page.goto('/staff');
    const nav = page.getByRole('navigation', { name: '员工工作台主导航' });
    await expect(nav.getByRole('link', { name: '卖家', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: '财务', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: '员工与权限', exact: true })).toHaveCount(0);
  });

  test('buyer registration/建档 shows the allocated B number', async ({ page }) => {
    await mockStaffApis(page, 'pre_sales');
    await page.goto('/staff/buyer-customers');
    await expect(page.getByRole('heading', { name: '买家客户', exact: true })).toBeVisible();
    await page.locator('#BUYER-market').selectOption('AMAZON_JP');
    await page.locator('#BUYER-wechat').fill('wx_stage7');
    await page.locator('#BUYER-name').fill('阶段七买家');
    await page.locator('#buyer-channel').selectOption('buyer-channel-wechat-b');
    await page.getByRole('button', { name: '建立买家档案' }).click();
    await expect(page.getByText('20260828B3001').first()).toBeVisible();
    await expect(page.getByText(/未激活/).first()).toBeVisible();
  });

  test('order detail: one 订单付款截图 and multiple 订单沟通截图 with uploader/time', async ({ page }) => {
    await mockStaffApis(page, 'owner');
    await page.goto('/staff/orders/order-7');
    await expect(page.getByRole('heading', { name: /订单付款截图/u })).toBeVisible();
    await expect(page.getByRole('heading', { name: /订单沟通截图（2）/u })).toBeVisible();
    await expect(page.getByText(/上传员工：总管理员/u).first()).toBeVisible();
    await expect(page.getByText(/上传时间：/u).first()).toBeVisible();
    // One payment screenshot card (strictly single) and two communication figures.
    await expect(page.getByRole('heading', { name: '订单付款截图', exact: true })).toHaveCount(1);
    await expect(page.getByText(/严格一张/u).first()).toBeVisible();
    await expect(page.locator('.order-communication-shot')).toHaveCount(2);
    await expect(page.getByText(/上传员工：总管理员/u)).toHaveCount(2);
  });

  test('buyer_refund sees 垫付 (buyer_advance) but no financial_snapshot/利润', async ({ page }) => {
    await mockStaffApis(page, 'buyer_refund');
    await page.goto('/staff/orders/order-7');
    await expect(page.getByText(/提前返本金/u).first()).toBeVisible();
    await expect(page.getByText('¥1,650.00').first()).toBeVisible();
    await expect(page.getByText(/利润/u)).toHaveCount(0);
    await expect(page.getByText(/financial_snapshot/u)).toHaveCount(0);
  });

  test('non-owner sees no 权限管理 entry and 403 on direct access', async ({ page }) => {
    await mockStaffApis(page, 'buyer_refund');
    await page.goto('/staff');
    await expect(page.getByRole('link', { name: '员工与权限' })).toHaveCount(0);
    await page.goto('/staff/access-management');
    await expect(page.getByText(/仅总管理员/u).first()).toBeVisible();
  });

  test('retired surfaces stay absent for staff', async ({ page }) => {
    await mockStaffApis(page, 'owner');
    await page.goto('/staff');
    const body = page.locator('body');
    await expect(body).not.toContainText('获客中心');
    await expect(body).not.toContainText('公共池');
    await expect(body).not.toContainText('抢单');
    await expect(body).not.toContainText('订单完整性');
    await page.goto('/staff/orders/order-7');
    await expect(page.getByRole('heading', { name: /买家聊天截图/u })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /卖家订单聊天截图/u })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /订单沟通截图/u })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// BUYER tests
// ---------------------------------------------------------------------------

test.describe('stage 7 buyer portal', () => {
  test('home shows 下一步, reservable product, and 我的订单 navigation', async ({ page }) => {
    await mockBuyerApis(page);
    await page.goto('/buyer');
    await expect(page.getByRole('heading', { name: '你好，月白买家' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '下一步', exact: true })).toBeVisible();
    await expect(page.locator('main a[href^="/buyer/demands/"]')).toHaveCount(1);
    await expect(page.locator('.mwb-product-grid article').first()).toContainText('月白护肤套装');
    const nav = page.getByRole('navigation', { name: '买家主导航' });
    await expect(nav.getByRole('link', { name: '我的订单', exact: true })).toBeVisible();
  });

  test('payment screenshot is a single-file upload and 订单沟通截图 never appears', async ({ page }) => {
    await mockBuyerApis(page);
    for (const path of [
      '/buyer',
      '/buyer/orders/formal-1',
      '/buyer/order-materials/evidence-1',
    ]) {
      await page.goto(path);
      await expect(page.locator('body')).not.toContainText('订单沟通截图');
    }
    await page.goto('/buyer/order-materials/new?reservation_id=reservation-1');
    const input = page.getByLabel('订单付款截图');
    await expect(input).toBeVisible();
    await expect(input).not.toHaveAttribute('multiple');
    await expect(input).toHaveAttribute('aria-required', 'true');
  });

  test('buyer order detail exposes no seller financial fields', async ({ page }) => {
    await mockBuyerApis(page);
    await page.goto('/buyer/orders/formal-1');
    await expect(page.getByText('订单汇率')).toBeVisible();
    const main = page.locator('main');
    await expect(main).not.toContainText('卖家本金');
    await expect(main).not.toContainText('服务费');
    await expect(main).not.toContainText('利润');
  });
});

// ---------------------------------------------------------------------------
// SELLER tests
// ---------------------------------------------------------------------------

test.describe('stage 7 seller portal', () => {
  test('home shows ACTIVE and DISABLED stores', async ({ page }) => {
    await mockSellerApis(page);
    await page.goto('/seller');
    await expect(page.getByRole('heading', { name: '月白生活株式会社', exact: true })).toBeVisible();
    await expect(page.getByText(/ACTIVE ·/u).first()).toBeVisible();
    await expect(page.getByText(/DISABLED ·/u).first()).toBeVisible();
  });

  test('org orders list renders every communication screenshot with uploader and time', async ({ page }) => {
    await mockSellerApis(page);
    await page.goto('/seller/orders');
    await expect(page.getByRole('heading', { name: '订单与业务完成' })).toBeVisible();
    await expect(page.getByText('象印 IH 电饭煲 5.5 合').first()).toBeVisible();
    // Expand the collapsed order details block to reveal the screenshot list.
    await page.locator('details').first().locator('summary').click();
    await expect(page.getByText('沟通截图（员工上传，一单可多张）').first()).toBeVisible();
    // Two real-shape DTO screenshots must produce two independent entries —
    // not a single aggregated "uploaded" label.
    await expect(page.getByRole('button', { name: '展开沟通截图 1' })).toBeVisible();
    await expect(page.getByRole('button', { name: '展开沟通截图 2' })).toBeVisible();
    // Uploader name resolves for the first, neutral placeholder for the second.
    await expect(page.getByText(/上传人：陈 staff/)).toBeVisible();
    await expect(page.getByText(/上传人：未知员工/)).toBeVisible();
    await expect(page.getByText(/上传时间：/).first()).toBeVisible();
  });

  test('settlement shows frozen principal/service fee and never 买家返款/利润', async ({ page }) => {
    await mockSellerApis(page);
    await page.goto('/seller/settlements');
    await expect(page.getByRole('heading', { name: '卖家结算' })).toBeVisible();
    await expect(page.getByText('待结本金', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('待结服务费', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('按冻结快照展示')).toBeVisible();
    const body = page.locator('body');
    await expect(body).not.toContainText('买家返款');
    await expect(body).not.toContainText('利润');
  });

  test('owner sees member management; non-owner member does not', async ({ page }) => {
    await mockSellerApis(page, 'OWNER');
    await page.goto('/seller/settings');
    await expect(page.getByRole('heading', { name: '账户与团队' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '团队成员' })).toBeVisible();

    const memberPage = await page.context().newPage();
    await mockSellerApis(memberPage, 'OPERATIONS');
    await memberPage.goto('/seller/settings');
    await expect(memberPage.getByRole('heading', { name: '账户与团队' })).toBeVisible();
    await expect(memberPage.getByRole('heading', { name: '团队成员' })).toHaveCount(0);
    await expect(memberPage.getByRole('heading', { name: '邀请新成员' })).toHaveCount(0);
    await memberPage.close();
  });
});
