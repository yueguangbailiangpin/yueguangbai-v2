import type { z } from 'zod';
import { FrontendApiError } from '../api/errors';
import type { ApiRequest, ApiResult } from '../api/transport';
import { DAY, freshDemoData, NOW } from './demo-data';
import { currentSellerReviewRole, currentStaffReviewRole } from './runtime';

let state = freshDemoData();
let sequence = 100;
const page = { limit: 100, next_cursor: null };

export function resetReviewDemoState(): void {
  state = freshDemoData();
  sequence = 100;
}

function requestId(): string {
  sequence += 1;
  return `review-request-${sequence}`;
}
function demoReadCredential(): string {
  return ['review', 'demo', 'read', String(sequence)].join('-').padEnd(40, 'x');
}
function url(path: string): URL {
  return new URL(path, 'https://review.invalid');
}
function idAfter(pathname: string, prefix: string): string {
  return decodeURIComponent(pathname.slice(prefix.length).split('/')[0] ?? '');
}
function blocked(path: string): never {
  throw new FrontendApiError(
    'REVIEW_MODE_REAL_API_BLOCKED',
    0,
    'review-blocked',
    'CONTRACT',
    null,
    { path: path.slice(0, 200) },
  );
}
function clone<T>(value: T): T {
  return structuredClone(value);
}

function sellerMe() {
  const role = currentSellerReviewRole();
  const mayOperate = role === 'OWNER' || role === 'OPERATIONS';
  return {
    me: {
      account_id: 'review-seller-account',
      member: {
        id: `review-seller-${role.toLowerCase()}`,
        display_name: `Demo ${role}`,
        role,
        primary_owner: role === 'OWNER',
      },
      organization: {
        id: 'review-seller-org',
        seller_code: 'TEST-S001',
        name: '月光白 Demo 卖家组织',
        marketplace_code: 'JP',
        status: 'ACTIVE',
      },
      access: {
        read_scope: role === 'OWNER' || role === 'FINANCE' ? 'ORGANIZATION' : 'ASSIGNED_STORES',
        store_ids:
          role === 'OWNER' || role === 'FINANCE'
            ? ['review-store-a', 'review-store-b']
            : ['review-store-a'],
        can_submit_product_applications: mayOperate,
        can_submit_demand_batches: mayOperate,
      },
    },
  };
}

const stores = [
  {
    id: 'review-store-a',
    marketplace_code: 'JP',
    display_name: 'TEST 日本店 A',
    canonical_marketplace_code: 'AMAZON_JP',
    transaction_currency_code: 'JPY',
    transaction_currency_exponent: 0,
    marketplace_status: 'ACTIVE',
    adapter_status: 'AVAILABLE',
    status: 'ACTIVE',
    version: 1,
    created_at: NOW - 90 * DAY,
    updated_at: NOW,
  },
  {
    id: 'review-store-b',
    marketplace_code: 'JP',
    display_name: 'TEST 日本店 B',
    canonical_marketplace_code: 'AMAZON_US',
    transaction_currency_code: 'USD',
    transaction_currency_exponent: 2,
    marketplace_status: 'ACTIVE',
    adapter_status: 'AVAILABLE',
    status: 'ACTIVE',
    version: 1,
    created_at: NOW - 60 * DAY,
    updated_at: NOW,
  },
];
const sellerProducts = Array.from({ length: 5 }, (_, index) => ({
  id: `review-product-${index + 1}`,
  store: {
    id: index % 2 ? 'review-store-b' : 'review-store-a',
    display_name: index % 2 ? 'TEST 日本店 B' : 'TEST 日本店 A',
  },
  marketplace_code: 'JP',
  seller_code: 'TEST-S001',
  asin: `B0DEMO00${index + 1}X`,
  status: index === 4 ? 'DISABLED' : 'ACTIVE',
  current_version_no: (index % 2) + 1,
  version: (index % 2) + 1,
  created_at: NOW - (index + 20) * DAY,
  updated_at: NOW - index * DAY,
  current_version: {
    id: `review-product-version-${index + 1}`,
    version_no: (index % 2) + 1,
    product_name: [
      '轻量保温随行杯',
      '无线静音鼠标',
      '专业级家庭美容仪 Pro Max',
      '旅行收纳套装',
      '厨房电子秤',
    ][index],
    search_keywords: ['Demo', '评审'],
    ordering_guide_expected_amount_jpy: 2_980 + index * 12_000,
    color_spec_mode: index % 2 ? 'ANY_VARIANT' : 'MAIN_IMAGE_VARIANT',
    main_image: index % 2 ? null : { file_entity_link_id: `review-main-image-${index}` },
    product_url: 'https://example.invalid/product',
    buyer_visible_notes: 'Demo 产品说明',
    created_at: NOW - index * DAY,
  },
}));

function sellerReviews() {
  return (['RATING', 'TEXT', 'IMAGE', 'VIDEO'] as const).map((reviewType, index) => ({
    review_case_id: `review-seller-review-${index + 1}`,
    formal_order: {
      id: `review-seller-order-${index + 1}`,
      amazon_order_number: `503-777000${index + 1}-000300${index + 1}`,
    },
    store: {
      id: index % 2 ? 'review-store-b' : 'review-store-a',
      display_name: index % 2 ? 'TEST 日本店 B' : 'TEST 日本店 A',
    },
    marketplace_code: 'JP',
    asin: `B0DEMO00${index + 1}X`,
    product_name: sellerProducts[index]!.current_version.product_name,
    review_type: reviewType,
    status: (['PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED'] as const)[index],
    version: 1,
    review_url: index === 2 ? 'https://example.invalid/review/demo' : null,
    submitted_at: NOW - index * DAY,
    approved_at: index === 2 ? NOW - index * DAY + 5_000 : null,
    evidence: {
      version_id: `review-seller-evidence-${index}`,
      version_no: 1,
      submitted_at: NOW - index * DAY,
      files: [
        {
          file_entity_link_id: `review-seller-review-link-${index}`,
          file_version: 1,
          content_type: 'image/png',
          byte_size: 42_000 + index,
          created_at: NOW - index * DAY,
        },
      ],
    },
    service_fee_accrued:
      index === 2 ? { amount_cny_fen: '12800', accrued_at: NOW - index * DAY } : null,
    allowed_actions: ['VIEW', 'READ_EVIDENCE'],
  }));
}

const sellerPayables = [
  ['review-payable-1', 'SELLER_PRINCIPAL', '128800', '0', 'UNPAID'],
  ['review-payable-2', 'SELLER_SERVICE_FEE', '28600', '10000', 'PARTIALLY_PAID'],
  ['review-payable-3', 'SELLER_PRINCIPAL', '486500', '486500', 'PAID'],
].map(([payable_id, payable_type, due, paid, status], index) => ({
  payable_id,
  formal_order_id: `review-seller-order-${index + 1}`,
  payable_type,
  amazon_order_number: `503-777000${index + 1}-000300${index + 1}`,
  store: {
    id: index % 2 ? 'review-store-b' : 'review-store-a',
    display_name: index % 2 ? 'TEST 日本店 B' : 'TEST 日本店 A',
  },
  product: {
    id: `review-product-${index + 1}`,
    asin: `B0DEMO00${index + 1}X`,
    name: sellerProducts[index]!.current_version.product_name,
  },
  due_amount_cny_fen: due,
  paid_amount_cny_fen: paid,
  outstanding_amount_cny_fen: String(Number(due) - Number(paid)),
  status,
  due_at: NOW + index * DAY,
  created_at: NOW - index * DAY,
}));

const roleDisplay = {
  owner: '总管理员',
  acquisition: '获客',
  pre_sales: '售前',
  seller_ops: '卖家对接',
  buyer_refund: '买家返款',
} as const;
const staffEmployees = (Object.keys(roleDisplay) as (keyof typeof roleDisplay)[]).flatMap(
  (role, index) => [
    {
      staff_id: `review-employee-${role}`,
      display_name: `Demo ${roleDisplay[role]}`,
      email: `${role}@example.invalid`,
      status: 'ACTIVE',
      version: 1,
      role: { code: role, display_name: roleDisplay[role] },
      marketplace_codes: role === 'owner' ? [] : ['AMAZON_JP'],
      marketplace_scopes: role === 'owner' ? [] : [{ code: 'AMAZON_JP', scope_kind: 'PRIMARY' }],
      last_login_at: NOW - index * DAY,
      updated_at: NOW,
    },
    ...(index === 2
      ? [
          {
            staff_id: 'review-employee-disabled',
            display_name: 'Demo 已停用售前',
            email: 'disabled@example.invalid',
            status: 'DISABLED',
            version: 2,
            role: { code: 'pre_sales', display_name: '售前' },
            marketplace_codes: ['AMAZON_US'],
            marketplace_scopes: [{ code: 'AMAZON_US', scope_kind: 'SUPPORT' }],
            last_login_at: null,
            updated_at: NOW,
          },
        ]
      : []),
  ],
);

const workTypes = [
  'PRODUCT_APPLICATION_REVIEW',
  'DEMAND_REVIEW',
  'RESERVATION_DECISION',
  'ORDER_INSTRUCTION_PUBLISH',
  'ORDER_EVIDENCE_REVIEW',
  'REVIEW_DECISION',
  'BUYER_REFUND_PROCESSING',
] as const;
const workSource = [
  'review-app-1',
  'review-seller-demand-1',
  'review-buyer-reservation-001',
  'review-buyer-reservation-002',
  'review-staff-evidence-1',
  'review-staff-review-1',
  'review-staff-refund-1',
];
function workItems(status: string) {
  const role = currentStaffReviewRole();
  const allowed =
    role === 'owner'
      ? workTypes
      : role === 'seller_ops'
        ? workTypes.filter((type) =>
            ['PRODUCT_APPLICATION_REVIEW', 'DEMAND_REVIEW', 'ORDER_EVIDENCE_REVIEW'].includes(type),
          )
        : role === 'pre_sales'
          ? workTypes.filter((type) =>
              ['RESERVATION_DECISION', 'ORDER_INSTRUCTION_PUBLISH'].includes(type),
            )
          : role === 'buyer_refund'
            ? workTypes.filter((type) => type === 'BUYER_REFUND_PROCESSING')
            : [];
  return allowed.map((type, index) => ({
    work_item_id: `review-work-${type.toLowerCase()}`,
    work_type: type,
    source_entity_type: type.replace(/_REVIEW|_PROCESSING|_PUBLISH|_DECISION/u, ''),
    source_entity_id: workSource[workTypes.indexOf(type)]!,
    buyer_customer_id:
      type.includes('BUYER') ||
      type.includes('RESERVATION') ||
      type.includes('ORDER_') ||
      type.includes('REVIEW')
        ? 'review-buyer-customer-1'
        : null,
    seller_organization_id:
      type.includes('PRODUCT') || type.includes('DEMAND') ? 'review-seller-org' : null,
    store_id: type.includes('PRODUCT') || type.includes('DEMAND') ? 'review-store-a' : null,
    duty_code:
      type === 'BUYER_REFUND_PROCESSING'
        ? 'BUYER_REFUND_OWNER'
        : type.includes('PRODUCT') || type.includes('DEMAND')
          ? 'SELLER_ACCOUNT_MANAGER'
          : type === 'REVIEW_DECISION'
            ? 'BUYER_AFTER_SALES_OWNER'
            : 'BUYER_PRE_SALES_OWNER',
    fixed_assignment_id: `review-assignment-${index}`,
    assigned_staff_id: `review-staff-${role}`,
    status,
    version: 1,
    created_at: NOW - index * 3_600_000,
    updated_at: NOW,
    completed_at: status === 'COMPLETED' ? NOW : null,
    cancelled_at: status === 'CANCELLED' ? NOW : null,
  }));
}

const staffEvidence = {
  submission_id: 'review-staff-evidence-1',
  reservation_id: 'review-buyer-reservation-003',
  marketplace: 'JP',
  status: 'PENDING_VERIFICATION',
  version: 1,
  evidence_version_no: 1,
  amazon_order_number_raw: '503-3333333-4444444',
  amazon_order_number_normalized: '503-3333333-4444444',
  amazon_order_date: '2026-08-08',
  final_paid_jpy: '12860',
  buyer_note: '请核对订单金额。',
  public_change_reason: null,
  submitted_at: NOW - DAY,
  updated_at: NOW,
  verified_at: null,
  withdrawn_at: null,
  buyer_customer_id: 'review-buyer-customer-1',
  internal_review_note: null,
  verified_by_staff_id: null,
  duplicate_signal_count: 0,
  reference_order_amount_jpy: '12000',
  price_difference_jpy: '860',
  price_mismatch: true,
  screenshot: {
    file_object_id: 'review-file-staff-order',
    file_version: 1,
    purpose: 'ORDER_EVIDENCE',
    visibility: 'BUYER_VISIBLE',
  },
  buyer: { buyer_customer_id: 'review-buyer-customer-1', buyer_customer_no: 'B-DEMO-001' },
  instruction: {
    instruction_id: 'review-instruction-1',
    instruction_version_id: 'review-instruction-version-1',
    buyer_self_pay_bps: 0,
    buyer_self_pay_jpy: '0',
    buyer_refundable_principal_jpy: '12860',
  },
  reservation: { reservation_id: 'review-buyer-reservation-003', status: 'APPROVED', version: 1 },
  version_history: [
    {
      evidence_version_id: 'review-evidence-version-1',
      version_no: 1,
      final_paid_jpy: '12860',
      submitted_at: NOW - DAY,
    },
  ],
  workflow: {
    work_item_id: 'review-work-order_evidence',
    assigned_staff_id: 'review-staff-owner',
    assigned_team_id: null,
    fixed_assignment_id: 'review-assignment-order',
  },
};
const staffReview = {
  review_case_id: 'review-staff-review-1',
  formal_order_id: 'review-buyer-order-001',
  buyer_customer_id: 'review-buyer-customer-1',
  seller_organization_id: 'review-seller-org',
  review_type: 'IMAGE',
  status: 'PENDING_REVIEW',
  version: 1,
  current_evidence_version_no: 1,
  public_change_reason: null,
  internal_review_note: null,
  submitted_at: NOW - DAY,
  updated_at: NOW,
  decided_at: null,
  current_evidence: {
    evidence_version_id: 'review-staff-review-evidence-1',
    version_no: 1,
    review_type: 'IMAGE',
    review_url: 'https://example.invalid/review/demo',
    buyer_note: 'Demo 评论截图',
    submitted_by_buyer_id: 'review-buyer-customer-1',
    submitted_at: NOW - DAY,
    files: [
      {
        file_object_id: 'review-file-staff-review',
        file_entity_link_id: 'review-link-staff-review',
        file_version: 1,
        purpose: 'REVIEW_EVIDENCE',
        visibility: 'SELLER_VISIBLE',
        client_file_name: 'Demo-评论截图.png',
        mime: 'image/png',
        byte_size: 42_000,
        verified_at: NOW - DAY,
      },
    ],
  },
};
const staffRefund = {
  obligation_id: 'review-staff-refund-1',
  buyer_customer_id: 'review-buyer-customer-1',
  formal_order_id: 'review-buyer-order-001',
  due_amount_cny_fen: '168800',
  gross_paid_cny_fen: '60000',
  reversed_cny_fen: '0',
  net_paid_cny_fen: '60000',
  outstanding_amount_cny_fen: '108800',
  overpaid_amount_cny_fen: '0',
  status: 'PARTIALLY_PAID',
  version: 2,
  created_at: NOW - 4 * DAY,
  updated_at: NOW,
  buyer: { buyer_customer_id: 'review-buyer-customer-1', buyer_customer_no: 'B-DEMO-001' },
  order: {
    formal_order_id: 'review-buyer-order-001',
    marketplace: 'JP',
    amazon_order_number_normalized: '503-1000001-9000001',
    product_id: 'review-product-1',
    asin: 'B0DEMO001X',
  },
  workflow: {
    work_item_id: 'review-work-buyer-refund',
    assigned_staff_id: 'review-staff-owner',
    assigned_team_id: null,
    fixed_assignment_id: 'review-assignment-refund',
  },
  source_review_event_id: 'review-approved-event',
  review_case_id: 'review-staff-review-1',
  payments: [
    {
      payment_entry_id: 'review-refund-payment-1',
      amount_cny_fen: '60000',
      paid_at: NOW - DAY,
      china_business_date: '2026-08-10',
      payment_channel: 'WECHAT',
      public_note: 'Demo 首次返款',
      internal_note: 'Demo',
      proofs: [
        {
          file_object_id: 'review-file-refund-proof',
          file_version: 1,
          purpose: 'BUYER_REFUND_PROOF',
          visibility: 'INTERNAL_ONLY',
        },
      ],
    },
  ],
  reversals: [],
};

const acquisitionChannels = [
  {
    visibility: 'INTERNAL',
    channel_id: 'review-channel-1',
    code: 'CHANNEL_1',
    channel_type: 'XIAOHONGSHU',
    platform_name: '小红书',
    lead_type: 'BUYER',
    marketplace_code: 'AMAZON_JP',
    display_name: '日本好物体验官',
    status: 'ACTIVE',
    version: 1,
    created_at: NOW - 90 * DAY,
    updated_at: NOW,
    staff_label: '渠道1',
    intake_wechat_label: 'Demo 接待号 A',
    profile_version: 1,
  },
  {
    visibility: 'INTERNAL',
    channel_id: 'review-channel-2',
    code: 'CHANNEL_2',
    channel_type: 'REFERRAL',
    platform_name: '客户转介绍',
    lead_type: 'SELLER',
    marketplace_code: 'AMAZON_JP',
    display_name: '日本卖家合作渠道',
    status: 'ACTIVE',
    version: 1,
    created_at: NOW - 60 * DAY,
    updated_at: NOW,
    staff_label: '渠道2',
    intake_wechat_label: 'Demo 接待号 B',
    profile_version: 1,
  },
];
const acquisitionProspects = [
  {
    prospect_id: 'review-prospect-1',
    lead_type: 'BUYER',
    marketplace_code: 'AMAZON_JP',
    origin_channel_id: 'review-channel-1',
    origin_channel_name: '日本好物体验官',
    display_name: 'Demo 买家潜在线索',
    contact_value: 'demo***',
    source_url: 'https://example.invalid/prospect',
    origin_mode: 'HUMAN',
    status: 'RESEARCHING',
    ai_score: 76,
    note: '偏好家居类产品',
    discovered_at: NOW - DAY,
    converted_lead_id: null,
    version: 1,
    created_at: NOW - DAY,
    updated_at: NOW,
  },
  {
    prospect_id: 'review-prospect-2',
    lead_type: 'SELLER',
    marketplace_code: 'AMAZON_JP',
    origin_channel_id: 'review-channel-2',
    origin_channel_name: '日本卖家合作渠道',
    display_name: 'Demo Seller Studio',
    contact_value: null,
    source_url: null,
    origin_mode: 'CODEX',
    status: 'HUMAN_HANDOFF',
    ai_score: 92,
    note: '等待人工接入',
    discovered_at: NOW - 2 * DAY,
    converted_lead_id: null,
    version: 2,
    created_at: NOW - 2 * DAY,
    updated_at: NOW,
  },
];
const acquisitionLeads = (type: 'BUYER' | 'SELLER') => [
  {
    lead_id: `review-lead-${type.toLowerCase()}-1`,
    lead_type: type,
    marketplace_code: 'AMAZON_JP',
    wechat_masked: 'demo****88',
    display_name: type === 'BUYER' ? 'Demo 新买家' : 'Demo 新卖家',
    note: 'Demo 客户',
    origin_channel_id: type === 'BUYER' ? 'review-channel-1' : 'review-channel-2',
    channel_label: type === 'BUYER' ? '渠道1' : '渠道2',
    current_owner_staff_id: `review-staff-${currentStaffReviewRole()}`,
    status: 'ACTIVE',
    version: 1,
    created_business_date: '2026-08-10',
    latest_followup_at: NOW,
    retention_due_at: NOW + 365 * DAY,
    retention_hold_reason: null,
    registered: type === 'BUYER',
    reservation_submitted: type === 'BUYER',
    no_participation: false,
    formal_order_count: type === 'BUYER' ? 3 : 8,
    seller_cooperation: type === 'SELLER',
    created_at: NOW - DAY,
    updated_at: NOW,
  },
];

const staffProducts = sellerProducts.map((product) => ({
  product_id: product.id,
  seller_organization_id: 'review-seller-org',
  store_id: product.store.id,
  store_name: product.store.display_name,
  marketplace_code: 'AMAZON_JP',
  asin: product.asin,
  status: product.status,
  aggregate_version: product.version,
  current_version_no: product.current_version_no,
  product_name: product.current_version.product_name,
  cadence: { order_interval_days: 2, orders_per_run: 3 },
  updated_at: product.updated_at,
}));

function dashboardSummary(windowKey: string) {
  const performance = (id: string, name: string, multiplier: number) => ({
    dimension_id: id,
    dimension_name: name,
    buyer_lead_count: 24 * multiplier,
    buyer_registered_count: 17 * multiplier,
    buyer_reservation_count: 11 * multiplier,
    buyer_formal_order_count: 8 * multiplier,
    buyer_business_completed_count: 5 * multiplier,
    buyer_no_participation_count: 3 * multiplier,
    seller_lead_count: 9 * multiplier,
    seller_cooperation_count: 4 * multiplier,
    current_owner_active_lead_count: 6 * multiplier,
    consultation_count: 38 * multiplier,
    projected_profit: {
      amount_cny_fen: String(286_500 * multiplier),
      valid_order_count: 8 * multiplier,
      conflict_order_count: 1,
    },
    completed_profit: {
      amount_cny_fen: String(168_800 * multiplier),
      valid_order_count: 5 * multiplier,
      conflict_order_count: 0,
    },
  });
  return {
    summary: {
      window: {
        key: windowKey,
        from_date: '2026-08-01',
        to_date: '2026-08-11',
        timezone: 'Asia/Shanghai',
        data_as_of: NOW,
      },
      cards: { new_buyers: 27, reservations: 19, formal_orders: 13, business_completions: 8 },
      buyer_funnel: {
        stages: [
          { code: 'LEAD', label: '新增买家', count: 27, conversion_rate_bps: null },
          { code: 'RESERVATION', label: '提交预约', count: 19, conversion_rate_bps: 7037 },
          { code: 'ORDER', label: '正式订单', count: 13, conversion_rate_bps: 6842 },
        ],
        no_participation_count: 4,
      },
      seller_funnel: {
        stages: [
          { code: 'LEAD', label: '新增卖家', count: 9, conversion_rate_bps: null },
          { code: 'COOPERATION', label: '建立合作', count: 5, conversion_rate_bps: 5556 },
        ],
      },
      projected_profit: {
        amount_cny_fen: '896520',
        valid_order_count: 13,
        conflict_order_count: 1,
      },
      completed_profit: { amount_cny_fen: '568230', valid_order_count: 8, conflict_order_count: 0 },
      staff_performance: [
        performance('review-staff-1', 'Demo 售前', 1),
        performance('review-staff-2', 'Demo 卖家对接', 2),
      ],
      channel_performance: [
        performance('review-channel-1', '渠道1', 1),
        performance('review-channel-2', '渠道2', 1),
      ],
    },
  };
}

function reviewFileReadIntent(pathname: string) {
  const match = /\/files\/([^/]+)\/read-intents$/u.exec(pathname);
  const fileId = decodeURIComponent(match?.[1] ?? 'review-file');
  return {
    read_intent_id: `review-read-${sequence}`,
    file_object_id: fileId,
    access_token: demoReadCredential(),
    access_token_available: true,
    expires_at: NOW + 10 * 60_000,
    replayed: false,
  };
}

function resolve(request: ApiRequest<z.ZodType>): unknown {
  const parsed = url(request.path);
  const path = parsed.pathname;
  const method = request.method;

  if (method === 'POST' && /\/files\/[^/]+\/read-intents$/u.test(path))
    return reviewFileReadIntent(path);
  if (
    method === 'POST' &&
    /\/order-instruction\/images\/(?:main|[1-9][0-9]*)\/read-intent$/u.test(path)
  ) {
    return {
      read_intent: {
        read_intent_id: `review-read-${sequence}`,
        access_token: demoReadCredential(),
        access_token_available: true,
        expires_at: NOW + 10 * 60_000,
      },
    };
  }
  if (
    method === 'POST' &&
    /\/(?:reviews|order-evidence)\/[^/]+\/files\/[^/]+\/read-intent$/u.test(path)
  ) {
    const linkId = decodeURIComponent(path.split('/').at(-2) ?? 'review-link');
    const fileId = linkId.replace('review-link-', 'review-file-');
    return {
      read_intent_id: `review-read-${sequence}`,
      file_object_id: fileId,
      access_token: demoReadCredential(),
      access_token_available: true,
      expires_at: NOW + 10 * 60_000,
      replayed: false,
    };
  }
  if (method === 'POST' && /\/formal-orders\/[^/]+\/chat-screenshot\/read-intent$/u.test(path)) {
    return {
      read_intent: {
        read_intent_id: `review-read-${sequence}`,
        access_token: demoReadCredential(),
        access_token_available: true,
        expires_at: NOW + 10 * 60_000,
        replayed: false,
      },
    };
  }

  if (path === '/api/buyer-portal/me' && method === 'GET')
    return {
      buyer: {
        display_name: 'Demo 多身份客户',
        marketplace_code: 'JP',
        identity_review_status: 'CLEAR',
      },
    };
  if (path === '/api/buyer-portal/demands' && method === 'GET')
    return { items: clone(state.demands), next_cursor: null };
  if (path.startsWith('/api/buyer-portal/demands/') && method === 'GET')
    return {
      demand: clone(
        state.demands.find(
          (item) => item.demand_id === idAfter(path, '/api/buyer-portal/demands/'),
        ) ?? state.demands[0],
      ),
    };
  if (/^\/api\/buyer-portal\/demands\/[^/]+\/reservations$/u.test(path) && method === 'POST') {
    const demandId = idAfter(path, '/api/buyer-portal/demands/');
    const source = state.demands.find((item) => item.demand_id === demandId) ?? state.demands[0]!;
    const created = {
      ...state.reservations[0]!,
      reservation_id: `review-buyer-reservation-${sequence}`,
      demand: (({ target_quantity: _a, remaining_quantity: _b, open_at: _c, ...rest }) => rest)(
        source,
      ),
      submitted_at: NOW,
      updated_at: NOW,
    };
    state.reservations.unshift(created);
    return { reservation: clone(created), replayed: false };
  }
  if (path === '/api/buyer-portal/reservations' && method === 'GET')
    return { items: clone(state.reservations), next_cursor: null };
  if (/^\/api\/buyer-portal\/reservations\/[^/]+\/cancel$/u.test(path) && method === 'POST') {
    const id = idAfter(path, '/api/buyer-portal/reservations/');
    const item =
      state.reservations.find((value) => value.reservation_id === id) ?? state.reservations[0]!;
    Object.assign(item, {
      status: 'CANCELLED',
      can_cancel: false,
      cancelled_at: NOW,
      updated_at: NOW,
      version: item.version + 1,
    });
    return { reservation: clone(item), replayed: false };
  }
  if (
    /^\/api\/buyer-portal\/reservations\/[^/]+\/order-instruction\/state$/u.test(path) &&
    method === 'GET'
  ) {
    const id = idAfter(path, '/api/buyer-portal/reservations/');
    const active = id !== 'review-buyer-reservation-001';
    return {
      order_instruction: {
        status: active ? 'ACTIVE' : 'UNPUBLISHED',
        instruction_version: 1,
        current_version_no: 1,
        initial_deadline_at: NOW + 5 * DAY,
        resubmission_deadline_at: null,
        evidence_status: active ? 'NONE' : 'NONE',
        can_submit_evidence: active,
        can_read_images: active,
        content_updated: false,
      },
    };
  }
  if (
    /^\/api\/buyer-portal\/reservations\/[^/]+\/order-instruction$/u.test(path) &&
    method === 'GET'
  ) {
    const id = idAfter(path, '/api/buyer-portal/reservations/');
    return {
      order_instruction: {
        status: 'ACTIVE',
        product_name: '专业级家庭美容仪 Pro Max',
        store_display_name: 'TEST 日本店 A',
        search_keywords: ['家庭美容仪', 'Pro Max'],
        color_spec_mode: 'MAIN_IMAGE_VARIANT',
        staff_public_note: '请严格按照截图搜索商品。',
        buyer_visible_notes: '颜色请选择白色。',
        initial_deadline_at: NOW + 5 * DAY,
        resubmission_deadline_at: null,
        content_updated: false,
        reference_order_amount_jpy: '128000',
        buyer_self_pay_bps: 1500,
        estimated_buyer_self_pay_jpy: '19200',
        estimated_refundable_principal_jpy: '108800',
        main_image: {
          image_id: 'review-main-image',
          position: null,
          mime: 'image/png',
          width: 800,
          height: 800,
          read_intent_path: `/api/buyer-portal/reservations/${id}/order-instruction/images/main/read-intent`,
        },
        keyword_images: [
          {
            image_id: 'review-keyword-image-1',
            position: 1,
            mime: 'image/png',
            width: 1200,
            height: 700,
            read_intent_path: `/api/buyer-portal/reservations/${id}/order-instruction/images/1/read-intent`,
          },
        ],
      },
    };
  }
  if (path === '/api/buyer-portal/order-evidence/eligible-reservations' && method === 'GET')
    return {
      items: clone(
        state.reservations
          .filter((item) => item.status === 'APPROVED')
          .map((item) => ({
            reservation_id: item.reservation_id,
            demand_id: item.demand.demand_id,
            marketplace_code: 'JP',
            product_name: item.demand.product_name,
            store_display_name: item.demand.store_display_name,
            review_type: item.demand.task_type,
            order_deadline: item.demand.order_deadline,
            current_order_evidence_status: null,
            current_order_evidence_version: null,
            allowed_actions: ['SUBMIT'],
          })),
      ),
      next_cursor: null,
    };
  if (path === '/api/buyer-portal/order-evidence' && method === 'GET')
    return { items: clone(state.evidences), next_cursor: null };
  if (path === '/api/buyer-portal/order-evidence' && method === 'POST')
    return { order_evidence: clone(state.evidences[0]), replayed: false };
  if (path.startsWith('/api/buyer-portal/order-evidence/') && method === 'GET')
    return {
      order_evidence: clone(
        state.evidences.find(
          (item) => item.submission_id === idAfter(path, '/api/buyer-portal/order-evidence/'),
        ) ?? state.evidences[0],
      ),
    };
  if (
    /^\/api\/buyer-portal\/order-evidence\/[^/]+\/(?:resubmit|withdraw)$/u.test(path) &&
    method === 'POST'
  )
    return { order_evidence: clone(state.evidences[0]), replayed: false };
  if (path === '/api/buyer-portal/formal-orders' && method === 'GET')
    return { items: clone(state.formalOrders), next_cursor: null };
  if (path.startsWith('/api/buyer-portal/formal-orders/') && method === 'GET')
    return {
      formal_order: clone(
        state.formalOrders.find(
          (item) => item.formal_order_id === idAfter(path, '/api/buyer-portal/formal-orders/'),
        ) ?? state.formalOrders[0],
      ),
    };
  if (path === '/api/buyer-portal/reviews/eligible-orders' && method === 'GET')
    return {
      items: clone(
        state.formalOrders.map((order, index) => ({
          order: {
            formal_order_id: order.formal_order_id,
            marketplace: order.marketplace,
            amazon_order_number: order.amazon_order_number,
            amazon_order_date: order.amazon_order_date,
            product_name: order.product_name,
            review_type: order.review_type,
            confirmed_at: order.confirmed_at,
            confirmed_business_date: order.confirmed_business_date,
            status: order.status,
          },
          current_review:
            index === 1
              ? {
                  review_case_id: 'review-buyer-review-002',
                  status: 'CHANGES_REQUESTED',
                  version: 1,
                }
              : null,
          allowed_actions: index === 1 ? ['RESUBMIT'] : ['SUBMIT'],
        })),
      ),
      next_cursor: null,
    };
  if (path === '/api/buyer-portal/reviews' && method === 'GET')
    return {
      items: clone(state.reviews.map(({ files: _files, ...item }) => item)),
      next_cursor: null,
    };
  if (path === '/api/buyer-portal/reviews' && method === 'POST')
    return { review: clone(state.reviews[0]), replayed: false };
  if (path.startsWith('/api/buyer-portal/reviews/') && method === 'GET')
    return {
      review: clone(
        state.reviews.find(
          (item) => item.review_case_id === idAfter(path, '/api/buyer-portal/reviews/'),
        ) ?? state.reviews[0],
      ),
    };
  if (
    /^\/api\/buyer-portal\/reviews\/[^/]+\/(?:resubmit|withdraw)$/u.test(path) &&
    method === 'POST'
  )
    return { review: clone(state.reviews[0]), replayed: false };
  if (path === '/api/buyer-portal/refunds' && method === 'GET')
    return {
      items: clone(state.refunds.map(({ activities: _activities, ...item }) => item)),
      next_cursor: null,
    };
  if (path.startsWith('/api/buyer-portal/refunds/') && method === 'GET')
    return {
      refund: clone(
        state.refunds.find(
          (item) => item.refund_obligation_id === idAfter(path, '/api/buyer-portal/refunds/'),
        ) ?? state.refunds[0],
      ),
    };

  if (path === '/api/seller-portal/me' && method === 'GET') return sellerMe();
  if (path === '/api/seller-portal/stores' && method === 'GET')
    return { items: clone(stores), page };
  if (path === '/api/seller-portal/products' && method === 'GET')
    return { items: clone(filterStore(sellerProducts, parsed.searchParams.get('store_id'))), page };
  if (path === '/api/seller-portal/product-applications' && method === 'GET')
    return {
      items: clone(filterStore(state.sellerApplications, parsed.searchParams.get('store_id'))),
      page,
    };
  if (path === '/api/seller-portal/product-applications' && method === 'POST')
    return { application: clone(state.sellerApplications[0]), replayed: false };
  if (
    /^\/api\/seller-portal\/product-applications\/[^/]+\/withdraw$/u.test(path) &&
    method === 'POST'
  ) {
    const item =
      state.sellerApplications.find(
        (value) => value.id === idAfter(path, '/api/seller-portal/product-applications/'),
      ) ?? state.sellerApplications[0]!;
    Object.assign(item, {
      status: 'WITHDRAWN',
      withdrawn_at: NOW,
      updated_at: NOW,
      version: item.version + 1,
    });
    return { application: clone(item), replayed: false };
  }
  if (path.startsWith('/api/seller-portal/product-applications/') && method === 'GET')
    return {
      application: clone(
        state.sellerApplications.find(
          (item) => item.id === idAfter(path, '/api/seller-portal/product-applications/'),
        ) ?? state.sellerApplications[0],
      ),
    };
  if (path === '/api/seller-portal/demand-batches' && method === 'GET')
    return {
      items: clone(filterStore(state.sellerDemands, parsed.searchParams.get('store_id'))),
      page,
    };
  if (path === '/api/seller-portal/demand-batches' && method === 'POST')
    return { demand_batch: clone(state.sellerDemands[0]), replayed: false };
  if (/^\/api\/seller-portal\/demand-batches\/[^/]+\/withdraw$/u.test(path) && method === 'POST') {
    const item =
      state.sellerDemands.find(
        (value) => value.id === idAfter(path, '/api/seller-portal/demand-batches/'),
      ) ?? state.sellerDemands[0]!;
    Object.assign(item, {
      status: 'WITHDRAWN',
      withdrawn_at: NOW,
      updated_at: NOW,
      version: item.version + 1,
    });
    return { demand_batch: clone(item), replayed: false };
  }
  if (path === '/api/seller-portal/formal-orders' && method === 'GET')
    return {
      items: clone(filterStore(state.sellerOrders, parsed.searchParams.get('store_id'))),
      page,
    };
  if (path === '/api/seller-portal/reviews' && method === 'GET')
    return {
      items: clone(filterStore(sellerReviews(), parsed.searchParams.get('store_id'))),
      page,
    };
  if (path === '/api/seller-portal/settlement/summary' && method === 'GET')
    return {
      settlement: {
        outstanding_principal_cny_fen: '586800',
        outstanding_service_fee_cny_fen: '128450',
        total_outstanding_cny_fen: '715250',
        unallocated_credit_cny_fen: '37600',
      },
    };
  if (path === '/api/seller-portal/settlement/payables' && method === 'GET')
    return { items: clone(sellerPayables), page };
  if (path === '/api/seller-portal/members' && method === 'GET')
    return {
      members: [
        {
          member_id: 'review-member-owner',
          display_name: 'Demo Owner',
          role: 'OWNER',
          wechat_id: 'demo_owner',
          primary_owner: true,
          status: 'ACTIVE',
          member_number: 1,
        },
        {
          member_id: 'review-member-ops',
          display_name: 'Demo 运营',
          role: 'OPERATIONS',
          wechat_id: 'demo_ops',
          primary_owner: false,
          status: 'ACTIVE',
          member_number: 2,
        },
        {
          member_id: 'review-member-finance',
          display_name: 'Demo 财务',
          role: 'FINANCE',
          wechat_id: 'demo_finance',
          primary_owner: false,
          status: 'ACTIVE',
          member_number: 3,
        },
      ],
    };
  if (path === '/api/seller-portal/member-invitations' && method === 'GET')
    return {
      invitations: [
        {
          invitation_id: 'review-member-invite-1',
          wechat_id: 'demo_viewer',
          display_name: 'Demo 待加入成员',
          role: 'VIEWER',
          store_ids: ['review-store-a'],
          status: 'ACTIVE',
          version: 1,
          issued_at: NOW - DAY,
          expires_at: NOW + 6 * DAY,
          consumed_at: null,
          revoked_at: null,
        },
      ],
    };
  if (path === '/api/seller-portal/member-invitations' && method === 'POST')
    return {
      invitation: {
        invitation_id: `review-member-invite-${sequence}`,
        registration_token: 'review-member-token',
        registration_path: '/review/seller/member-register?token=demo',
        wechat_id: 'demo_new_member',
        display_name: 'Demo 新成员',
        role: 'OPERATIONS',
        store_ids: ['review-store-a'],
        status: 'ACTIVE',
        version: 1,
        expires_at: NOW + 7 * DAY,
      },
    };
  if (/^\/api\/seller-portal\/member-invitations\/[^/]+\/revoke$/u.test(path) && method === 'POST')
    return { revoked: true, revoked_at: NOW };

  if (path === '/api/staff/me/work-items' && method === 'GET') {
    const status = parsed.searchParams.get('status') ?? 'OPEN';
    const type = parsed.searchParams.get('work_type');
    return {
      work_items: clone(workItems(status).filter((item) => !type || item.work_type === type)),
      next_cursor: null,
    };
  }
  if (path.startsWith('/api/staff/order-evidence/') && method === 'GET')
    return { order_evidence: clone(staffEvidence) };
  if (path.startsWith('/api/staff/reviews/') && method === 'GET' && !path.endsWith('/visibility'))
    return { review: clone(staffReview) };
  if (path.startsWith('/api/staff/buyer-refunds/') && method === 'GET')
    return { buyer_refund: clone(staffRefund) };
  if (/^\/api\/staff\/demand-batches\/[^/]+\/review-context$/u.test(path) && method === 'GET')
    return {
      review_context: {
        demand_batch_id: 'review-seller-demand-1',
        demand_version: 1,
        status: 'SUBMITTED',
        seller_organization_id: 'review-seller-org',
        store_id: 'review-store-a',
        product_id: 'review-product-1',
        product_version_no: 1,
        product_name: '轻量保温随行杯',
        task_type: 'IMAGE',
        target_quantity: 12,
        reservation_deadline: NOW + 2 * DAY,
        order_deadline: NOW + 9 * DAY,
        cadence: { order_interval_days: 2, orders_per_run: 3 },
        can_publish: true,
        timezone: 'Asia/Shanghai',
        data_as_of: NOW,
      },
    };
  if (/^\/api\/staff\/demand-batches\/[^/]+\/review$/u.test(path) && method === 'POST')
    return {
      demand_review: {
        demand_batch_id: 'review-seller-demand-1',
        status: 'PUBLISHED',
        version: 2,
        review_reason: null,
        schedule: null,
        replayed: false,
      },
    };
  if (path === '/api/staff/catalog/products' && method === 'GET')
    return { page: { items: clone(staffProducts), next_cursor: null, data_as_of: NOW } };
  if (path.startsWith('/api/staff/catalog/products/') && method === 'GET') {
    const id = idAfter(path, '/api/staff/catalog/products/');
    const item = staffProducts.find((product) => product.product_id === id) ?? staffProducts[0]!;
    return {
      product: {
        ...clone(item),
        versions: [
          {
            product_version_id: `review-version-${id}`,
            version_no: item.current_version_no,
            product_name: item.product_name,
            search_keywords: ['Demo', '日本'],
            ordering_guide_expected_amount_jpy: 12_800,
            color_spec_mode: 'MAIN_IMAGE_VARIANT',
            default_buyer_self_pay_bps: 0,
            product_url: 'https://example.invalid/product',
            buyer_visible_notes: 'Demo 产品说明',
            internal_notes: 'Demo 内部说明',
            cadence: { order_interval_days: 2, orders_per_run: 3 },
            created_at: NOW - DAY,
          },
        ],
        demands: [
          {
            demand_batch_id: 'review-seller-demand-1',
            status: 'PUBLISHED',
            target_quantity: 12,
            effective_reservation_count: 5,
            order_deadline: NOW + 9 * DAY,
            demand_version: 1,
            schedule_version: 1,
            first_order_date: '2026-08-12',
          },
        ],
        timezone: 'Asia/Shanghai',
        data_as_of: NOW,
      },
    };
  }
  if (path === '/api/staff/access-management' && method === 'GET')
    return {
      employees: clone(staffEmployees),
      available_marketplaces: [
        { code: 'AMAZON_JP', display_name: '亚马逊日本站', status: 'ACTIVE' },
        { code: 'AMAZON_US', display_name: '亚马逊美国站', status: 'ACTIVE' },
      ],
    };
  if (path.startsWith('/api/staff/access-management/employees') && method === 'POST')
    return { employee: clone(staffEmployees[1]), replayed: false };
  if (path === '/api/staff/seller-principal-rate-policies' && method === 'GET') {
    const policy = {
      policy_version_id: 'review-policy-confirmed',
      scope_type: 'CURRENCY_PAIR_DEFAULT',
      seller_organization_id: null,
      source_currency_code: 'JPY',
      quote_currency_code: 'CNY',
      version_no: 3,
      decision_version: 2,
      status: 'CONFIRMED',
      markup_rate_value: '1500000',
      markup_rate_scale: '100000000',
      effective_from: NOW - 30 * DAY,
      submitted_at: NOW - 35 * DAY,
      confirmed_at: NOW - 34 * DAY,
      rejection_reason: null,
      replayed: false,
    };
    return {
      policies: {
        source_currency_code: 'JPY',
        quote_currency_code: 'CNY',
        seller_organization_id: parsed.searchParams.get('seller_organization_id'),
        default_policy: policy,
        seller_override_policy: null,
        default_pending_policy: null,
        seller_override_pending_policy: null,
        default_next_version: 4,
        seller_override_next_version: parsed.searchParams.has('seller_organization_id') ? 1 : null,
        selected_policy: policy,
      },
    };
  }
  if (path.startsWith('/api/staff/seller-principal-rate-policies') && method === 'POST')
    return {
      policy: {
        policy_version_id: `review-policy-${sequence}`,
        scope_type: 'CURRENCY_PAIR_DEFAULT',
        seller_organization_id: null,
        source_currency_code: 'JPY',
        quote_currency_code: 'CNY',
        version_no: 4,
        decision_version: 1,
        status: path.endsWith('/confirm')
          ? 'CONFIRMED'
          : path.endsWith('/reject')
            ? 'REJECTED'
            : 'SUBMITTED',
        markup_rate_value: '400000',
        markup_rate_scale: '100000000',
        effective_from: NOW + DAY,
        submitted_at: NOW,
        confirmed_at: path.endsWith('/confirm') ? NOW : null,
        rejection_reason: path.endsWith('/reject') ? 'Demo Owner 拒绝' : null,
        replayed: false,
      },
    };
  if (path === '/api/staff/admin-business-dashboard/summary' && method === 'GET')
    return dashboardSummary(parsed.searchParams.get('window') ?? 'TODAY');
  if (path === '/api/staff/admin-business-dashboard/acquisition-daily' && method === 'GET')
    return {
      from_date: '2026-08-01',
      to_date: '2026-08-11',
      timezone: 'Asia/Shanghai',
      data_as_of: NOW,
      reporting_precision: { configured: true, business_date: '2026-08-01' },
      anomalies: {
        identity_conflicts: 1,
        attribution_anomalies: 2,
        buyer_attribution_gaps: 1,
        seller_attribution_gaps: 1,
        finance_conflicts: 1,
      },
      totals: {
        new_buyer_customers: 27,
        new_seller_customers: 9,
        buyer_portal_registrations: 21,
        seller_portal_registrations: 5,
        formal_orders: 13,
        buyer_historical_unknown_orders: 2,
        seller_historical_unknown_orders: 1,
        buyer_attribution_anomaly_orders: 1,
        seller_attribution_anomaly_orders: 1,
      },
      daily: [
        {
          business_date: '2026-08-11',
          new_buyer_customers: 7,
          new_seller_customers: 2,
          buyer_portal_registrations: 5,
          seller_portal_registrations: 1,
          formal_orders: 4,
          buyer_historical_unknown_orders: 0,
          seller_historical_unknown_orders: 0,
          buyer_attribution_anomaly_orders: 1,
          seller_attribution_anomaly_orders: 0,
        },
      ],
      channel_daily: [
        {
          business_date: '2026-08-11',
          channel_id: 'review-channel-1',
          channel_name: '日本好物体验官',
          channel_label: '渠道1',
          platform_name: '小红书',
          channel_status: 'ACTIVE',
          lead_type: 'BUYER',
          marketplace_code: 'AMAZON_JP',
          new_customer_count: 7,
          formal_order_count: 4,
        },
      ],
    };
  if (path === '/api/staff/admin-business-dashboard/financial-projection' && method === 'GET')
    return {
      financial_projection: {
        from_date: '2026-08-01',
        to_date: '2026-08-11',
        timezone: 'Asia/Shanghai',
        data_as_of: NOW,
        seller_cash_in_cny_fen: '2865800',
        buyer_cash_out_cny_fen: '1688230',
        net_cash_flow_cny_fen: '1177570',
        seller_payable_due_cny_fen: '3486500',
        seller_payable_paid_cny_fen: '2185400',
        seller_payable_outstanding_cny_fen: '1301100',
        buyer_refund_due_cny_fen: '2268900',
        buyer_refund_paid_cny_fen: '1688230',
        buyer_refund_outstanding_cny_fen: '580670',
        projected_profit_cny_fen: '896520',
        completed_profit_cny_fen: '568230',
        projected_profit_adjustment_cny_fen: '-12800',
        completed_profit_adjustment_cny_fen: '6500',
      },
    };
  if (path === '/api/staff/acquisition/reporting-config' && method === 'GET')
    return {
      config: {
        precision_started_business_date: '2026-08-01',
        activated_at: NOW - 10 * DAY,
        activated_by_staff_id: 'review-staff-owner',
        version: 1,
        updated_at: NOW - 10 * DAY,
      },
    };
  if (path === '/api/staff/acquisition/channels' && method === 'GET')
    return { channels: clone(acquisitionChannels) };
  if (path === '/api/staff/acquisition/prospects' && method === 'GET')
    return { items: clone(acquisitionProspects), next_cursor: null };
  if (path === '/api/staff/acquisition/consultations' && method === 'GET')
    return {
      consultations: [
        {
          consultation_id: 'review-consultation-1',
          channel_id: 'review-channel-1',
          lead_type: 'BUYER',
          business_date: '2026-08-11',
          person_count: 18,
          version: 1,
          updated_by_staff_id: 'review-staff-acquisition',
          updated_at: NOW,
        },
      ],
    };
  if (path === '/api/staff/acquisition/funnel' && method === 'GET')
    return {
      funnel: {
        from_date: '2026-08-01',
        to_date: '2026-08-11',
        data_as_of: NOW,
        buyer: {
          consultation_count: 86,
          wechat_added_count: 27,
          registered_count: 21,
          reservation_submitted_count: 19,
          no_participation_count: 4,
          formal_order_count: 13,
          projected_gross_profit_cny_fen: '896520',
          completed_gross_profit_cny_fen: '568230',
        },
        seller: { consultation_count: 31, wechat_added_count: 9, cooperation_count: 5 },
      },
    };
  if (path === '/api/staff/acquisition/channel-stats' && method === 'GET')
    return {
      channels: acquisitionChannels.map((channel, index) => ({
        channel_id: channel.channel_id,
        channel_name: channel.display_name,
        platform_name: channel.platform_name,
        channel_status: channel.status,
        lead_type: channel.lead_type,
        marketplace_code: channel.marketplace_code,
        consultation_count: 30 + index * 18,
        consultation_data_complete: true,
        consultation_days_recorded: 11,
        consultation_days_expected: 11,
        prospect_count: 4 + index,
        codex_prospect_count: index,
        lead_count: 9 + index,
        registered_count: 7 + index,
        reservation_submitted_count: 5 + index,
        cooperation_count: 3 + index,
        formal_order_count: 4 + index,
        buyer_formal_order_count: channel.lead_type === 'BUYER' ? 4 : 0,
        seller_formal_order_count: channel.lead_type === 'SELLER' ? 5 : 0,
        buyer_projected_gross_profit_cny_fen: channel.lead_type === 'BUYER' ? '286500' : null,
        buyer_completed_gross_profit_cny_fen: channel.lead_type === 'BUYER' ? '168800' : null,
        seller_projected_gross_profit_cny_fen: channel.lead_type === 'SELLER' ? '448600' : null,
        seller_completed_gross_profit_cny_fen: channel.lead_type === 'SELLER' ? '318200' : null,
      })),
    };
  if (path === '/api/staff/acquisition/source-corrections/candidates' && method === 'GET')
    return {
      items: [
        {
          lead_id: 'review-lead-buyer-1',
          lead_type: 'BUYER',
          marketplace_code: 'AMAZON_JP',
          business_date: '2026-08-10',
          display_name: 'Demo 新买家',
          wechat_masked: 'demo****88',
          original_channel_id: 'review-channel-1',
          original_channel_name: '日本好物体验官',
          effective_channel_id: 'review-channel-1',
          effective_channel_name: '日本好物体验官',
          correction_count: 0,
        },
      ],
    };
  if (path === '/api/staff/acquisition/machines' && method === 'GET')
    return {
      machines: [
        {
          machine_id: 'review-machine-1',
          machine_name: 'Demo 日本买家获客 Codex',
          status: 'ACTIVE',
          hourly_request_limit: 120,
          marketplace_codes: ['AMAZON_JP'],
          channel_ids: ['review-channel-1'],
          created_at: NOW - 5 * DAY,
          revoked_at: null,
        },
      ],
    };
  if (path === '/api/staff/acquisition/leads' && method === 'GET')
    return {
      items: clone(
        acquisitionLeads((parsed.searchParams.get('lead_type') ?? 'BUYER') as 'BUYER' | 'SELLER'),
      ),
      next_cursor: null,
    };
  if (path === '/api/staff/acquisition/handoffs' && method === 'GET') {
    const type = (parsed.searchParams.get('lead_type') ?? 'BUYER') as 'BUYER' | 'SELLER';
    return {
      items: clone(
        acquisitionProspects
          .filter((item) => item.lead_type === type && item.status === 'HUMAN_HANDOFF')
          .map((item) => ({
            prospect_id: item.prospect_id,
            lead_type: item.lead_type,
            marketplace_code: item.marketplace_code,
            origin_channel_id: item.origin_channel_id,
            channel_label: item.origin_channel_id === 'review-channel-1' ? '渠道1' : '渠道2',
            display_name: item.display_name,
            contact_value: item.contact_value,
            status: 'HUMAN_HANDOFF',
            version: item.version,
            created_at: item.created_at,
            updated_at: item.updated_at,
          })),
      ),
    };
  }
  if (path === '/api/staff/customer-onboarding/lookup' && method === 'GET')
    return {
      matches: [
        {
          customer_type: parsed.searchParams.get('customer_type') ?? 'BUYER',
          subject_id: 'review-existing-customer-1',
          display_name: 'Demo 历史多身份客户',
          marketplace_code: 'AMAZON_JP',
          has_portal_account: true,
          historical_order_count: 18,
          source_status: 'HISTORICAL_UNKNOWN',
        },
      ],
      resolution_required: false,
      manual_resolution_applied: false,
    };
  if (path === '/api/staff/customer-identity-resolution/cases' && method === 'GET')
    return {
      cases: [
        {
          id: 'review-identity-case-1',
          identity_masked: 'demo****88',
          customer_type: 'BUYER',
          marketplace_code: 'AMAZON_JP',
          reason_code: 'AMBIGUOUS_HISTORY',
          staff_note: 'Demo 身份冲突',
          status: 'OPEN',
          reported_by_staff_id: 'review-staff-pre_sales',
          resolved_subject_id: null,
          resolution_note: null,
          resolved_by_staff_id: null,
          created_at: NOW - DAY,
          resolved_at: null,
        },
      ],
    };
  if (path === '/api/staff/operating-integrity/order-lookup' && method === 'GET') {
    const refundFinancials = ['owner', 'buyer_refund'].includes(currentStaffReviewRole());
    return {
      order: {
        formal_order_id: 'review-integrity-order-1',
        amazon_order_number:
          parsed.searchParams.get('amazon_order_number') ?? '503-5555555-6666666',
        buyer_customer_id: 'review-buyer-customer-1',
        seller_organization_id: 'review-seller-org',
        marketplace_code: 'AMAZON_JP',
        product_name: 'Demo Operating Integrity 产品',
        confirmed_at: NOW - 3 * DAY,
        marketplace_business_date: '2026-08-08',
        review_case_id: 'review-staff-review-1',
        review_status: 'APPROVED',
        has_refund_obligation: refundFinancials ? false : null,
        advance_full_amount_cny_fen: refundFinancials ? '48840' : null,
        advance_net_cny_fen: refundFinancials ? '0' : null,
        active_advance_payment_id: null,
        operational_state: 'MANUAL_INVESTIGATION',
        actions: {
          record_order_event: { allowed: true, reason: null },
          record_review_visibility: { allowed: true, reason: null },
          approve_review: { allowed: false, reason: 'ORDER_UNDER_INVESTIGATION' },
          record_advance_principal: { allowed: false, reason: 'ORDER_UNDER_INVESTIGATION' },
          record_profit_adjustment: {
            allowed: currentStaffReviewRole() === 'owner',
            reason: currentStaffReviewRole() === 'owner' ? null : 'ROLE_NOT_ALLOWED',
          },
        },
      },
    };
  }

  return blocked(`${method} ${request.path}`);
}

function filterStore<T extends { store: { id: string } }>(
  items: readonly T[],
  storeId: string | null,
): readonly T[] {
  return storeId ? items.filter((item) => item.store.id === storeId) : items;
}

export async function demoApiRequest<T extends z.ZodType>(
  request: ApiRequest<T>,
): Promise<ApiResult<z.output<T>>> {
  const data = resolve(request as ApiRequest<z.ZodType>);
  const parsed = request.schema.safeParse(data);
  if (!parsed.success) {
    throw new FrontendApiError(
      'MALFORMED_RESPONSE',
      200,
      'review-fixture-contract',
      'CONTRACT',
      null,
      {
        path: request.path.slice(0, 200),
        issue: parsed.error.issues[0]?.path.join('.').slice(0, 120) ?? 'unknown',
      },
    );
  }
  return { data: parsed.data, requestId: requestId() };
}

export function demoFileBytes(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    ),
    (character) => character.charCodeAt(0),
  );
}
