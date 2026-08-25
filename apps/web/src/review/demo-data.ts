const NOW = 1_786_368_000_000;
const DAY = 86_400_000;

function demand(
  index: number,
  input: Partial<{
    product_name: string;
    task_type: 'RATING' | 'TEXT' | 'IMAGE' | 'VIDEO';
    amount: string;
    remaining: number;
    deadlineDays: number;
    note: string | null;
  }> = {},
) {
  const amount = input.amount ?? String(2_980 + index * 1_327);
  return {
    demand_id: `review-buyer-demand-${String(index).padStart(3, '0')}`,
    demand_version: 1,
    marketplace_code: 'AMAZON_JP' as const,
    product_name: input.product_name ?? `Demo 日本站产品 ${index}`,
    reference_order_amount_jpy: amount,
    buyer_self_pay_bps: index % 3 === 0 ? 1500 : 0,
    estimated_buyer_self_pay_jpy: index % 3 === 0 ? String(Math.round(Number(amount) * 0.15)) : '0',
    estimated_refundable_principal_jpy:
      index % 3 === 0 ? String(Math.round(Number(amount) * 0.85)) : amount,
    buyer_visible_notes: input.note ?? (index % 2 === 0 ? '请按下单指引选择指定规格。' : null),
    store_display_name: index % 2 === 0 ? 'TEST 日本店 B' : 'TEST 日本店 A',
    task_type: input.task_type ?? (['RATING', 'TEXT', 'IMAGE', 'VIDEO'] as const)[(index - 1) % 4],
    target_quantity: 8,
    remaining_quantity: input.remaining ?? Math.max(0, 7 - index),
    open_at: NOW - DAY,
    reservation_deadline: NOW + (input.deadlineDays ?? index + 1) * DAY,
    order_deadline: NOW + (input.deadlineDays ?? index + 1) * DAY + 7 * DAY,
  };
}

const demands = [
  demand(1, { product_name: '轻量保温随行杯', task_type: 'IMAGE', remaining: 3 }),
  demand(2, { product_name: '无线静音鼠标', task_type: 'TEXT', remaining: 1, amount: '1890' }),
  demand(3, {
    product_name: '专业级家庭美容仪 Pro Max 长名称布局测试版',
    task_type: 'VIDEO',
    amount: '128000',
    remaining: 5,
  }),
  demand(4, { product_name: '日用清洁刷', task_type: 'RATING', amount: '980', remaining: 6 }),
  demand(5, {
    product_name: '旅行收纳套装',
    task_type: 'IMAGE',
    amount: '12580',
    remaining: 2,
    deadlineDays: 1,
  }),
  demand(6, { product_name: '人体工学坐垫', task_type: 'TEXT', amount: '15800', remaining: 0 }),
  demand(7, { product_name: '便携蓝牙音箱', task_type: 'VIDEO', amount: '49800', remaining: 4 }),
  demand(8, { product_name: '厨房电子秤', task_type: 'RATING', amount: '3280', remaining: 7 }),
];

function reservationDemand(source: (typeof demands)[number]) {
  const {
    target_quantity: _target,
    remaining_quantity: _remaining,
    open_at: _open,
    ...value
  } = source;
  return value;
}

function reservation(
  index: number,
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED',
  demandIndex = index,
) {
  const source = demands[Math.min(demandIndex - 1, demands.length - 1)]!;
  return {
    reservation_id: `review-buyer-reservation-${String(index).padStart(3, '0')}`,
    status,
    version: 1,
    submitted_at: NOW - index * DAY,
    updated_at: NOW - index * DAY + 3_600_000,
    hold_expires_at: NOW + DAY,
    order_deadline_snapshot: source.order_deadline,
    buyer_self_pay_bps_snapshot: source.buyer_self_pay_bps,
    reference_order_amount_jpy_snapshot: source.reference_order_amount_jpy,
    estimated_self_pay_jpy_snapshot: source.estimated_buyer_self_pay_jpy,
    estimated_refundable_principal_jpy_snapshot: source.estimated_refundable_principal_jpy,
    buyer_self_pay_accepted_at: NOW - index * DAY,
    buyer_self_pay_accepted_demand_version: source.demand_version,
    decided_at:
      status === 'APPROVED' || status === 'REJECTED' ? NOW - index * DAY + 7_200_000 : null,
    cancelled_at: status === 'CANCELLED' ? NOW - index * DAY + 7_200_000 : null,
    expired_at: status === 'EXPIRED' ? NOW - index * DAY + 7_200_000 : null,
    can_cancel: status === 'PENDING_REVIEW' || status === 'APPROVED',
    demand: reservationDemand(source),
  };
}

const reservations = [
  reservation(1, 'PENDING_REVIEW', 1),
  reservation(2, 'APPROVED', 2),
  reservation(3, 'APPROVED', 3),
  reservation(4, 'REJECTED', 4),
  reservation(5, 'CANCELLED', 5),
];

const evidenceFile = {
  file_object_id: 'review-file-order-001',
  file_entity_link_id: 'review-link-order-001',
  client_file_name: 'Demo-订单截图.png',
  mime: 'image/png' as const,
  byte_size: 48_216,
  status: 'VERIFIED' as const,
  visibility: 'BUYER_VISIBLE' as const,
  verified_at: NOW - DAY,
  version: 1,
  allowed_actions: ['CREATE_READ_INTENT'] as ['CREATE_READ_INTENT'],
};

function evidence(
  index: number,
  status: 'PENDING_VERIFICATION' | 'CHANGES_REQUESTED' | 'VERIFIED' | 'WITHDRAWN' | 'CONSUMED',
  mismatch = false,
) {
  const source = reservations[Math.min(index, reservations.length - 1)]!;
  const finalPaid = Number(source.reference_order_amount_jpy_snapshot) + (mismatch ? 860 : 0);
  return {
    submission_id: `review-buyer-evidence-${String(index).padStart(3, '0')}`,
    reservation: {
      reservation_id: source.reservation_id,
      demand_id: source.demand.demand_id,
      marketplace_code: 'AMAZON_JP' as const,
      product_name: source.demand.product_name,
      store_display_name: source.demand.store_display_name,
      review_type: source.demand.task_type,
      order_deadline: source.demand.order_deadline,
    },
    marketplace: 'AMAZON_JP' as const,
    amazon_order_number_display: `503-000000${index}-000000${index}`,
    amazon_order_date: `2026-08-${String(3 + index).padStart(2, '0')}`,
    final_paid_jpy: finalPaid,
    buyer_self_pay_bps: source.buyer_self_pay_bps_snapshot,
    buyer_self_pay_jpy: Number(source.estimated_self_pay_jpy_snapshot),
    buyer_refundable_principal_jpy: Math.max(
      0,
      finalPaid - Number(source.estimated_self_pay_jpy_snapshot),
    ),
    price_mismatch: mismatch,
    price_difference_jpy: mismatch ? 860 : 0,
    status,
    version: 1,
    evidence_version_no: 1,
    submitted_at: NOW - index * DAY,
    updated_at: NOW - index * DAY + 2_000,
    verified_at: status === 'VERIFIED' || status === 'CONSUMED' ? NOW - index * DAY + 5_000 : null,
    public_change_reason:
      status === 'CHANGES_REQUESTED' ? '订单金额与指引不一致，请核对后重新提交。' : null,
    files: [
      {
        ...evidenceFile,
        file_object_id: `review-file-order-${index}`,
        file_entity_link_id: `review-link-order-${index}`,
      },
    ],
    allowed_actions:
      status === 'CHANGES_REQUESTED'
        ? (['RESUBMIT'] as const)
        : status === 'PENDING_VERIFICATION'
          ? (['WITHDRAW'] as const)
          : [],
  };
}

const evidences = [
  evidence(1, 'PENDING_VERIFICATION'),
  evidence(2, 'CHANGES_REQUESTED', true),
  evidence(3, 'VERIFIED'),
];

function formalOrder(index: number, reviewType: 'RATING' | 'TEXT' | 'IMAGE' | 'VIDEO' = 'IMAGE') {
  return {
    formal_order_id: `review-buyer-order-${String(index).padStart(3, '0')}`,
    marketplace: 'AMAZON_JP' as const,
    amazon_order_number: `503-100000${index}-900000${index}`,
    amazon_order_date: `2026-08-0${index}`,
    product_name: demands[index + 1]!.product_name,
    review_type: reviewType,
    final_paid_jpy: String(6_480 + index * 12_345),
    buyer_self_pay_bps: index === 2 ? 1000 : 0,
    buyer_self_pay_jpy: index === 2 ? '3117' : '0',
    buyer_refundable_principal_jpy: String(6_480 + index * 9_228),
    buyer_expected_principal_cny_fen: String(3_180 + index * 44_321),
    buyer_exchange_rate_snapshot: {
      version_no: index,
      business_date: `2026-08-0${index}`,
      confirmed_at: NOW - index * DAY,
      cny_per_jpy_e8: '486000',
    },
    confirmed_at: NOW - index * DAY,
    confirmed_business_date: `2026-08-0${index}`,
    status: 'CONFIRMED' as const,
    order_evidence_summary: {
      evidence_version_no: 1,
      submitted_at: NOW - index * DAY - 4_000,
      verified_at: NOW - index * DAY - 2_000,
      file_count: 1,
    },
  };
}
const formalOrders = [formalOrder(1, 'IMAGE'), formalOrder(2, 'TEXT'), formalOrder(3, 'VIDEO')];

function review(
  index: number,
  status: 'PENDING_REVIEW' | 'CHANGES_REQUESTED' | 'REJECTED' | 'WITHDRAWN' | 'APPROVED',
) {
  const order = formalOrders[Math.min(index - 1, formalOrders.length - 1)]!;
  const allowed =
    status === 'CHANGES_REQUESTED'
      ? (['RESUBMIT'] as const)
      : status === 'PENDING_REVIEW'
        ? (['WITHDRAW'] as const)
        : [];
  return {
    review_case_id: `review-buyer-review-${String(index).padStart(3, '0')}`,
    order: {
      formal_order_id: order.formal_order_id,
      marketplace: 'AMAZON_JP' as const,
      amazon_order_number: order.amazon_order_number,
      amazon_order_date: order.amazon_order_date,
      product_name: order.product_name,
      review_type: order.review_type,
      confirmed_at: order.confirmed_at,
      confirmed_business_date: order.confirmed_business_date,
      status: 'CONFIRMED' as const,
    },
    review_type: order.review_type,
    status,
    version: 1,
    current_evidence_version_no: 1,
    submitted_at: NOW - index * DAY,
    updated_at: NOW - index * DAY + 2_000,
    public_change_reason: status === 'CHANGES_REQUESTED' ? '图片需要更清晰地显示评论内容。' : null,
    review_url: status === 'APPROVED' ? 'https://example.invalid/review/demo' : null,
    review_approved_at: status === 'APPROVED' ? NOW - index * DAY + 3_000 : null,
    buyer_refund_due:
      status === 'APPROVED' ? { amount_cny_fen: String(12_800 + index * 9_700) } : null,
    file_count: 1,
    allowed_actions: [...allowed],
    files: [
      {
        file_object_id: `review-file-review-${index}`,
        file_entity_link_id: `review-link-review-${index}`,
        client_file_name: `Demo-评论截图-${index}.png`,
        mime: 'image/png' as const,
        byte_size: 36_000 + index,
        status: 'VERIFIED' as const,
        version: 1,
        verified_at: NOW - index * DAY,
        allowed_actions: ['CREATE_READ_INTENT'] as ['CREATE_READ_INTENT'],
      },
    ],
  };
}
const reviews = [
  review(1, 'PENDING_REVIEW'),
  review(2, 'CHANGES_REQUESTED'),
  review(3, 'APPROVED'),
];

function refund(index: number, status: 'DUE' | 'PARTIALLY_PAID' | 'PAID' | 'OVERPAID') {
  const order = formalOrders[Math.min(index - 1, formalOrders.length - 1)]!;
  const due = 18_800 + index * 22_100;
  const paid =
    status === 'DUE'
      ? 0
      : status === 'PARTIALLY_PAID'
        ? Math.floor(due / 2)
        : status === 'OVERPAID'
          ? due + 500
          : due;
  const balance = {
    due_amount_cny_fen: String(due),
    net_paid_cny_fen: String(paid),
    remaining_amount_cny_fen: String(Math.max(0, due - paid)),
    overpaid_amount_cny_fen: String(Math.max(0, paid - due)),
    status,
  };
  return {
    refund_obligation_id: `review-buyer-refund-${String(index).padStart(3, '0')}`,
    ...balance,
    order: {
      formal_order_id: order.formal_order_id,
      marketplace: 'AMAZON_JP' as const,
      amazon_order_number: order.amazon_order_number,
      product_name: order.product_name,
      review_type: order.review_type,
      status: 'CONFIRMED' as const,
    },
    allowed_actions: [] as [],
    activities:
      paid > 0
        ? [
            {
              activity_id: `review-refund-activity-${index}`,
              activity_type: 'PAYMENT_RECORDED' as const,
              amount_cny_fen: String(paid),
              occurred_at: NOW - index * DAY,
              payment_channel: 'WECHAT_PAY' as const,
              balance_after: balance,
            },
          ]
        : [],
  };
}
const refunds = [refund(1, 'DUE'), refund(2, 'PARTIALLY_PAID'), refund(3, 'PAID')];

function sellerOrder(index: number, completion: 'IN_PROGRESS' | 'COMPLETE', paymentAmount: string) {
  const parts =
    completion === 'COMPLETE'
      ? {
          review: 'COMPLETE',
          buyer_refund: 'COMPLETE',
          seller_principal: 'COMPLETE',
          seller_service_fee: 'COMPLETE',
        }
      : index % 3 === 0
        ? {
            review: 'COMPLETE',
            buyer_refund: 'COMPLETE',
            seller_principal: 'PENDING',
            seller_service_fee: 'PENDING',
          }
        : {
            review: index % 2 === 0 ? 'COMPLETE' : 'PENDING',
            buyer_refund: index % 2 === 0 ? 'COMPLETE' : 'PENDING',
            seller_principal: 'PENDING',
            seller_service_fee: 'PENDING',
          };
  return {
    formal_order_id: `review-seller-order-${index}`,
    status: 'CONFIRMED' as const,
    platform_order_identifier: `503-777000${index}-000300${index}`,
    store: {
      id: index % 2 ? 'review-store-a' : 'review-store-b',
      display_name: index % 2 ? 'TEST 日本店 A' : 'TEST 日本店 B',
    },
    platform_product_identifier: `B0DEMO00${index}X`,
    product_name: demands[index % demands.length]!.product_name,
    chat_screenshot: {
      status: index % 2 ? ('AVAILABLE' as const) : ('NONE' as const),
      file_version: index % 2 ? 1 : null,
    },
    confirmed_at: NOW - index * DAY,
    legacy_projection: 'AMAZON' as const,
    marketplace_code: 'AMAZON_JP' as const,
    canonical_marketplace_code: 'AMAZON_JP' as const,
    amazon_order_number: `503-777000${index}-000300${index}`,
    asin: `B0DEMO00${index}X`,
    product_version: { id: `review-product-version-${index}`, version_no: 1 },
    review_type: (['RATING', 'TEXT', 'IMAGE', 'VIDEO'] as const)[index % 4],
    final_paid_jpy: paymentAmount,
    payment: {
      amount_minor: paymentAmount,
      currency_code: 'JPY' as const,
      currency_exponent: 0 as const,
    },
    seller_expected_principal_cny_fen: String(Number(paymentAmount) * 5),
    seller_principal_rate_snapshot: {
      platform_order_date: `2026-08-${String(index).padStart(2, '0')}`,
      payment_amount_minor: paymentAmount,
      payment_currency_code: 'JPY' as const,
      base_rate_version_id: 'review-base-rate',
      base_rate_business_date: '2026-08-01',
      base_rate_confirmed_at: NOW - 10 * DAY,
      base_rate_value: '485000',
      base_rate_scale: '100000000',
      policy_version_id: 'review-policy',
      policy_scope_type: 'CURRENCY_PAIR_DEFAULT' as const,
      policy_seller_organization_id: null,
      policy_version_no: 2,
      policy_effective_from: NOW - 30 * DAY,
      policy_confirmed_at: NOW - 20 * DAY,
      markup_rate_value: '1500000',
      markup_rate_scale: '100000000',
      final_rate_value: '500000',
      final_rate_scale: '100000000',
      rounding_rule: 'HALF_UP' as const,
      seller_expected_principal_amount_minor: String(Number(paymentAmount) * 5),
    },
    locked_service_fee_snapshot: {
      fee_version_id: 'review-fee',
      version_no: 1,
      review_type: 'IMAGE',
      service_fee_cny_fen: String(2_000 + index * 275),
      effective_from: NOW - 30 * DAY,
      confirmed_at: NOW - 20 * DAY,
      marketplace_code: 'AMAZON_JP' as const,
      currency_code: 'CNY' as const,
      currency_exponent: 2 as const,
    },
    business_completion: { status: completion, ...parts },
    confirmed_business_date: `2026-08-${String(index).padStart(2, '0')}`,
  };
}

function createDemoData() {
  const sellerApplications = [
    ['review-app-1', 'SUBMITTED', null],
    ['review-app-2', 'APPROVED', null],
    ['review-app-3', 'REJECTED', '产品链接与 ASIN 不一致'],
    ['review-app-4', 'WITHDRAWN', null],
  ].map(([id, status, reason], index) => ({
    id,
    store: {
      id: index % 2 ? 'review-store-b' : 'review-store-a',
      display_name: index % 2 ? 'TEST 日本店 B' : 'TEST 日本店 A',
    },
    marketplace_code: 'AMAZON_JP',
    asin: `B0DEMOAPP${index}`,
    product_name: `Demo 商品申请 ${index + 1}`,
    search_keywords: ['Demo', '日本'],
    product_url: 'https://example.invalid/product',
    buyer_visible_notes: 'Demo 买家可见说明',
    seller_notes: 'Demo 卖家内部备注',
    status,
    review_reason: reason,
    product_id: status === 'APPROVED' ? `review-product-${index}` : null,
    version: 1,
    submitted_at: NOW - index * DAY,
    updated_at: NOW - index * DAY,
    reviewed_at: status === 'APPROVED' || status === 'REJECTED' ? NOW - index * DAY : null,
    withdrawn_at: status === 'WITHDRAWN' ? NOW - index * DAY : null,
  }));
  const sellerDemands = ['SUBMITTED', 'PUBLISHED', 'REJECTED', 'CLOSED', 'WITHDRAWN'].map(
    (status, index) => ({
      id: `review-seller-demand-${index + 1}`,
      store: {
        id: index % 2 ? 'review-store-b' : 'review-store-a',
        display_name: index % 2 ? 'TEST 日本店 B' : 'TEST 日本店 A',
      },
      product: {
        id: `review-product-${index + 1}`,
        version_no: 1,
        asin: `B0DEMO00${index + 1}X`,
        product_name: demands[index]!.product_name,
        search_keywords: ['Demo', '评审'],
        product_url: 'https://example.invalid/product',
      },
      marketplace_code: 'AMAZON_JP',
      task_type: (['RATING', 'TEXT', 'IMAGE', 'VIDEO'] as const)[index % 4],
      target_quantity: 12 + index,
      held_quantity: index,
      approved_quantity: index + 2,
      remaining_quantity: Math.max(0, 8 - index),
      buyer_visible_notes: 'Demo 需求说明',
      seller_notes: '内部 Demo 说明',
      open_at: NOW - 2 * DAY,
      reservation_deadline: NOW + (index + 1) * DAY,
      order_deadline: NOW + (index + 8) * DAY,
      status,
      review_reason: status === 'REJECTED' ? '截止时间不足' : null,
      close_reason: status === 'CLOSED' ? '名额已完成' : null,
      version: 1,
      submitted_at: NOW - index * DAY,
      updated_at: NOW,
      reviewed_at: ['PUBLISHED', 'REJECTED'].includes(status) ? NOW : null,
      published_at: status === 'PUBLISHED' ? NOW : null,
      withdrawn_at: status === 'WITHDRAWN' ? NOW : null,
      closed_at: status === 'CLOSED' ? NOW : null,
    }),
  );
  return {
    demands,
    reservations,
    evidences,
    formalOrders,
    reviews,
    refunds,
    sellerApplications,
    sellerDemands,
    sellerOrders: [
      sellerOrder(1, 'IN_PROGRESS', '3480'),
      sellerOrder(2, 'IN_PROGRESS', '21800'),
      sellerOrder(3, 'IN_PROGRESS', '123456'),
      sellerOrder(4, 'IN_PROGRESS', '9850'),
      sellerOrder(5, 'COMPLETE', '64999'),
      sellerOrder(6, 'COMPLETE', '198000'),
    ],
  };
}

export type DemoData = ReturnType<typeof createDemoData>;
export function freshDemoData(): DemoData {
  return structuredClone(createDemoData());
}
export { NOW, DAY };
