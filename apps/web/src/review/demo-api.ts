import type { z } from 'zod';
import { parseIdempotencyKey } from '@ygb/domain';
import { FrontendApiError } from '../api/errors';
import type { ApiRequest, ApiResult } from '../api/transport';
import { DAY, freshDemoData, NOW } from './demo-data';
import { currentSellerReviewRole, currentStaffReviewRole } from './runtime';

let state = freshDemoData();
let sequence = 100;
let reviewDemandClosed = false;
interface ReviewDemandCloseResponse {
  demand_close: {
    demand_batch_id: string;
    status: 'CLOSED';
    version: number;
    close_reason: string;
    replayed: boolean;
  };
}
interface ReviewDemandCloseIdempotencyRecord {
  fingerprint: string;
  response: ReviewDemandCloseResponse;
}
let reviewDemandCloseIdempotency = new Map<string, ReviewDemandCloseIdempotencyRecord>();
export type ReviewDemandCloseAccessForTests = 'DEFAULT' | 'MISSING' | 'PERSONAL_DENY';
let reviewDemandCloseAccessForTests: ReviewDemandCloseAccessForTests = 'DEFAULT';
const page = { limit: 100, next_cursor: null };

export function resetReviewDemoState(): void {
  state = freshDemoData();
  sequence = 100;
  reviewDemandClosed = false;
  reviewDemandCloseIdempotency = new Map();
  reviewDemandCloseAccessForTests = 'DEFAULT';
}

/** Test-only fixture control for effective DEMAND_PUBLISH authorization. */
export function setReviewDemandCloseAccessForTests(
  access: ReviewDemandCloseAccessForTests,
): void {
  reviewDemandCloseAccessForTests = access;
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

function reviewDemandCloseError(
  code: string,
  httpStatus: number,
  category: 'CONFLICT' | 'PERMISSION' | 'VALIDATION',
): never {
  throw new FrontendApiError(
    code,
    httpStatus,
    `review-demand-close-${code.toLowerCase()}-${sequence}`,
    category,
    null,
  );
}

function reviewDemandCloseHeader(
  headers: Readonly<Record<string, string>> | undefined,
  name: string,
): string | null {
  const entry = Object.entries(headers ?? {})
    .find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1] ?? null;
}

function parseReviewDemandCloseBody(value: unknown): {
  expected_version: number;
  close_reason: string;
} {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return reviewDemandCloseError('VALIDATION_ERROR', 400, 'VALIDATION');
  }
  const body = value as Record<string, unknown>;
  const allowed = new Set(['expected_version', 'close_reason']);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    return reviewDemandCloseError('VALIDATION_ERROR', 400, 'VALIDATION');
  }
  if (typeof body['expected_version'] !== 'number'
    || !Number.isSafeInteger(body['expected_version'])
    || body['expected_version'] < 1) {
    return reviewDemandCloseError('VALIDATION_ERROR', 400, 'VALIDATION');
  }
  if (typeof body['close_reason'] !== 'string') {
    return reviewDemandCloseError('VALIDATION_ERROR', 400, 'VALIDATION');
  }
  const closeReason = body['close_reason'].normalize('NFKC').trim();
  if (closeReason.length < 1
    || closeReason.length > 1000
    || /[\u0000-\u001f\u007f]/u.test(closeReason)) {
    return reviewDemandCloseError('VALIDATION_ERROR', 400, 'VALIDATION');
  }
  return {
    expected_version: body['expected_version'],
    close_reason: closeReason,
  };
}

function canReviewDemandClose(): boolean {
  const role = currentStaffReviewRole();
  return reviewDemandCloseAccessForTests === 'DEFAULT'
    && (role === 'owner' || role === 'seller_ops');
}

function requireReviewDemandClosePermission(): void {
  if (!canReviewDemandClose()) {
    reviewDemandCloseError('FORBIDDEN', 403, 'PERMISSION');
  }
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
        marketplace_code: 'AMAZON_JP',
        status: 'ACTIVE',
        settlement_account_name: null,
        settlement_account_identifier: null,
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
    marketplace_code: 'AMAZON_JP',
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
    marketplace_code: 'AMAZON_JP',
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
  marketplace_code: 'AMAZON_JP',
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
    marketplace_code: 'AMAZON_JP',
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

// ---------------------------------------------------------------------------
// Stage 7.5 batch 1：work-item SLA/负责人投影 + 工作台权威摘要。
// workTypes 与 demo 各业务事实的 source_entity_id 一一对应，工作项详情、
// 处理面板与订单详情通过同一组 ID 互联。
// ---------------------------------------------------------------------------
const workTypes = [
  'PRODUCT_APPLICATION_REVIEW',
  'DEMAND_REVIEW',
  'RESERVATION_DECISION',
  'ORDER_INSTRUCTION_PUBLISH',
  'ORDER_EVIDENCE_REVIEW',
  'REVIEW_DECISION',
  'BUYER_REFUND_PROCESSING',
] as const;
const workSource: Record<(typeof workTypes)[number], string> = {
  PRODUCT_APPLICATION_REVIEW: 'review-app-1',
  DEMAND_REVIEW: 'review-seller-demand-1',
  RESERVATION_DECISION: 'review-buyer-reservation-001',
  ORDER_INSTRUCTION_PUBLISH: 'review-instruction-1',
  ORDER_EVIDENCE_REVIEW: 'review-staff-evidence-1',
  REVIEW_DECISION: 'review-staff-review-1',
  BUYER_REFUND_PROCESSING: 'review-staff-refund-1',
};
const workItemIds: Record<(typeof workTypes)[number], string> = {
  PRODUCT_APPLICATION_REVIEW: 'review-work-product',
  DEMAND_REVIEW: 'review-work-demand',
  RESERVATION_DECISION: 'review-work-reservation',
  ORDER_INSTRUCTION_PUBLISH: 'review-work-instruction',
  ORDER_EVIDENCE_REVIEW: 'review-work-evidence',
  REVIEW_DECISION: 'review-work-review',
  BUYER_REFUND_PROCESSING: 'review-work-refund',
};
const roleWorkTypes: Record<string, readonly (typeof workTypes)[number][]> = {
  owner: workTypes,
  seller_ops: ['PRODUCT_APPLICATION_REVIEW', 'DEMAND_REVIEW', 'ORDER_EVIDENCE_REVIEW'],
  pre_sales: ['RESERVATION_DECISION', 'ORDER_INSTRUCTION_PUBLISH', 'REVIEW_DECISION'],
  buyer_refund: ['BUYER_REFUND_PROCESSING'],
};
const workTypeDuty: Record<(typeof workTypes)[number], string> = {
  PRODUCT_APPLICATION_REVIEW: 'SELLER_ACCOUNT_MANAGER',
  DEMAND_REVIEW: 'SELLER_ACCOUNT_MANAGER',
  RESERVATION_DECISION: 'BUYER_PRE_SALES_OWNER',
  ORDER_INSTRUCTION_PUBLISH: 'BUYER_PRE_SALES_OWNER',
  ORDER_EVIDENCE_REVIEW: 'BUYER_PRE_SALES_OWNER',
  REVIEW_DECISION: 'BUYER_AFTER_SALES_OWNER',
  BUYER_REFUND_PROCESSING: 'BUYER_REFUND_OWNER',
};
const workTypeResponsibleRole: Record<(typeof workTypes)[number], string> = {
  PRODUCT_APPLICATION_REVIEW: 'seller_ops',
  DEMAND_REVIEW: 'seller_ops',
  RESERVATION_DECISION: 'pre_sales',
  ORDER_INSTRUCTION_PUBLISH: 'pre_sales',
  ORDER_EVIDENCE_REVIEW: 'pre_sales',
  REVIEW_DECISION: 'pre_sales',
  BUYER_REFUND_PROCESSING: 'buyer_refund',
};
const workTypeNextAction: Record<(typeof workTypes)[number], string> = {
  PRODUCT_APPLICATION_REVIEW: '审核卖家产品申请',
  DEMAND_REVIEW: '审核需求批次并发布预约',
  RESERVATION_DECISION: '审核买家预约申请',
  ORDER_INSTRUCTION_PUBLISH: '发布买家下单指引',
  ORDER_EVIDENCE_REVIEW: '核对买家订单截图',
  REVIEW_DECISION: '审核买家评论凭证',
  BUYER_REFUND_PROCESSING: '处理买家返款付款',
};
function workItems(status: string) {
  const role = currentStaffReviewRole();
  const allowed = roleWorkTypes[role] ?? [];
  return allowed.map((type, index) => {
    // 第一条给 OVERDUE、第二条 DUE_TODAY，其余 NORMAL，让 SLA 徽标有真实层次。
    const priority = status === 'OPEN' && index === 0 ? 'OVERDUE' : status === 'OPEN' && index === 1 ? 'DUE_TODAY' : 'NORMAL';
    const overdue = priority === 'OVERDUE';
    const dueToday = priority === 'DUE_TODAY';
    const slaDueAt = status !== 'OPEN' ? null : overdue ? NOW - DAY : dueToday ? NOW + 2 * 3_600_000 : NOW + (index + 2) * DAY;
    const responsibleRole = workTypeResponsibleRole[type]!;
    return {
      work_item_id: workItemIds[type]!,
      work_type: type,
      source_entity_type: type.replace(/_REVIEW|_PROCESSING|_PUBLISH|_DECISION/u, ''),
      source_entity_id: workSource[type]!,
      buyer_customer_id:
        type === 'PRODUCT_APPLICATION_REVIEW' || type === 'DEMAND_REVIEW'
          ? null
          : 'review-buyer-customer-1',
      seller_organization_id:
        type === 'PRODUCT_APPLICATION_REVIEW' || type === 'DEMAND_REVIEW' ? 'review-seller-org' : null,
      store_id: type === 'PRODUCT_APPLICATION_REVIEW' || type === 'DEMAND_REVIEW' ? 'review-store-a' : null,
      duty_code: workTypeDuty[type]!,
      fixed_assignment_id: `review-assignment-${type.toLowerCase()}`,
      assigned_staff_id: `review-staff-${role}`,
      status,
      version: 1,
      created_at: NOW - (index + 1) * 3_600_000,
      updated_at: NOW,
      completed_at: status === 'COMPLETED' ? NOW : null,
      cancelled_at: status === 'CANCELLED' ? NOW : null,
      sla_due_at: slaDueAt,
      is_overdue: status === 'OPEN' && overdue,
      overdue_since: status === 'OPEN' && overdue ? NOW - 6 * 3_600_000 : null,
      next_action: workTypeNextAction[type]!,
      responsible_role: responsibleRole,
      responsible_staff_name: `Demo ${roleDisplay[responsibleRole as keyof typeof roleDisplay]}`,
      priority: status === 'OPEN' ? priority : 'NORMAL',
    };
  });
}
function workbenchSummary() {
  const role = currentStaffReviewRole();
  const open = workItems('OPEN');
  const overdue = open.filter((item) => item.is_overdue);
  const dueToday = open.filter((item) => item.priority === 'DUE_TODAY');
  return {
    summary: {
      open_count: open.length,
      due_today_count: dueToday.length,
      overdue_count: overdue.length,
      exception_order_count: 1,
      refund_due_today_cny_fen:
        role === 'owner' || role === 'buyer_refund' ? '108800' : null,
      recent: workItems('COMPLETED').slice(0, 3),
    },
  };
}

// ---------------------------------------------------------------------------
// Stage 7.5 batch 1：员工正式订单游标列表（含权威 responsibility 投影）。
// ---------------------------------------------------------------------------
interface DemoStaffOrder {
  id: string;
  amazonOrderNumber: string;
  amazonOrderDate: string;
  confirmedAt: number;
  buyerNo: string;
  buyerName: string;
  sellerOrganizationId: string;
  storeId: string;
  storeName: string;
  productName: string;
  reviewType: 'RATING' | 'TEXT' | 'IMAGE' | 'VIDEO';
  buyerExpectedPrincipal: string | null;
  sellerExpectedPrincipal: string | null;
  stage: 'BUYER_REFUND' | 'SELLER_SETTLEMENT' | 'COMPLETED';
  nextAction: 'PROCESS_BUYER_REFUND' | 'FOLLOW_SELLER_SETTLEMENT' | 'REVIEW_COMPLETED_ORDER' | 'RESOLVE_EXCEPTION' | 'ASSIGN_RESPONSIBLE_STAFF';
  exceptionState: 'NONE' | 'OPEN';
  finalPaidJpy: string;
}
const staffOrders: DemoStaffOrder[] = [
  {
    id: 'review-seller-order-1',
    amazonOrderNumber: '503-7770001-0003001',
    amazonOrderDate: '2026-08-08',
    confirmedAt: NOW - 3 * DAY,
    buyerNo: '20260808B00042',
    buyerName: '张三丰（演示）',
    sellerOrganizationId: 'review-seller-org',
    storeId: 'review-store-a',
    storeName: 'TEST 日本店 A',
    productName: '轻量保温随行杯',
    reviewType: 'IMAGE',
    buyerExpectedPrincipal: '165000',
    sellerExpectedPrincipal: '182500',
    stage: 'BUYER_REFUND',
    nextAction: 'PROCESS_BUYER_REFUND',
    exceptionState: 'NONE',
    finalPaidJpy: '39800',
  },
  {
    id: 'review-seller-order-2',
    amazonOrderNumber: '503-7770002-0003002',
    amazonOrderDate: '2026-08-10',
    confirmedAt: NOW - 2 * DAY,
    buyerNo: '20260810B00051',
    buyerName: '李逍遥（演示）',
    sellerOrganizationId: 'review-seller-org',
    storeId: 'review-store-b',
    storeName: 'TEST 日本店 B',
    productName: '无线静音鼠标',
    reviewType: 'TEXT',
    buyerExpectedPrincipal: '88200',
    sellerExpectedPrincipal: '96400',
    stage: 'SELLER_SETTLEMENT',
    nextAction: 'FOLLOW_SELLER_SETTLEMENT',
    exceptionState: 'OPEN',
    finalPaidJpy: '21800',
  },
  {
    id: 'review-seller-order-3',
    amazonOrderNumber: '503-7770003-0003003',
    amazonOrderDate: '2026-08-12',
    confirmedAt: NOW - DAY,
    buyerNo: '20260812B00058',
    buyerName: '赵灵儿（演示）',
    sellerOrganizationId: 'review-seller-org',
    storeId: 'review-store-a',
    storeName: 'TEST 日本店 A',
    productName: '专业级家庭美容仪 Pro Max',
    reviewType: 'VIDEO',
    buyerExpectedPrincipal: '612400',
    sellerExpectedPrincipal: '652800',
    stage: 'BUYER_REFUND',
    nextAction: 'RESOLVE_EXCEPTION',
    exceptionState: 'OPEN',
    finalPaidJpy: '128600',
  },
  {
    id: 'review-seller-order-4',
    amazonOrderNumber: '503-7770004-0003004',
    amazonOrderDate: '2026-08-14',
    confirmedAt: NOW - 6 * 3_600_000,
    buyerNo: '20260814B00066',
    buyerName: '林月如（演示）',
    sellerOrganizationId: 'review-seller-org',
    storeId: 'review-store-b',
    storeName: 'TEST 日本店 B',
    productName: '旅行收纳套装',
    reviewType: 'RATING',
    buyerExpectedPrincipal: '24600',
    sellerExpectedPrincipal: '27300',
    stage: 'COMPLETED',
    nextAction: 'REVIEW_COMPLETED_ORDER',
    exceptionState: 'NONE',
    finalPaidJpy: '5820',
  },
  {
    id: 'review-seller-order-5',
    amazonOrderNumber: '503-7770005-0003005',
    amazonOrderDate: '2026-08-16',
    confirmedAt: NOW - 3_600_000,
    buyerNo: '20260816B00071',
    buyerName: '阿奴（演示）',
    sellerOrganizationId: 'review-seller-org',
    storeId: 'review-store-a',
    storeName: 'TEST 日本店 A',
    productName: '厨房电子秤',
    reviewType: 'IMAGE',
    buyerExpectedPrincipal: null,
    sellerExpectedPrincipal: null,
    stage: 'SELLER_SETTLEMENT',
    nextAction: 'ASSIGN_RESPONSIBLE_STAFF',
    exceptionState: 'NONE',
    finalPaidJpy: '3280',
  },
];
function orderResponsibility(order: DemoStaffOrder) {
  return {
    stage: order.stage,
    responsible_role:
      order.stage === 'BUYER_REFUND'
        ? 'buyer_refund'
        : order.stage === 'SELLER_SETTLEMENT'
          ? 'seller_ops'
          : 'owner',
    responsible_staff: {
      staff_id: 'review-staff-owner',
      display_name: 'Demo 总管理员',
    },
    next_action: order.nextAction,
    next_action_due_at: order.stage === 'COMPLETED' ? null : NOW + 2 * DAY,
    is_overdue: order.exceptionState === 'OPEN',
    overdue_since: order.exceptionState === 'OPEN' ? NOW - 4 * 3_600_000 : null,
    exception_state: order.exceptionState,
    exception_reason: order.exceptionState === 'OPEN' ? '评论展示状态与审核结果不一致，需要人工复核。' : null,
    available_actions: ['VIEW'],
  };
}
function staffOrderList(searchParams: URLSearchParams) {
  const prefix = searchParams.get('amazon_order_number_prefix');
  const buyerNo = searchParams.get('buyer_customer_no');
  const sellerOrganizationId = searchParams.get('seller_organization_id');
  const stage = searchParams.get('stage');
  const exceptionState = searchParams.get('exception_state');
  const confirmedFrom = searchParams.get('confirmed_from');
  const confirmedTo = searchParams.get('confirmed_to');
  const items = staffOrders
    .filter((item) => !prefix || item.amazonOrderNumber.startsWith(prefix))
    .filter((item) => !buyerNo || item.buyerNo === buyerNo)
    .filter((item) => !sellerOrganizationId || item.sellerOrganizationId === sellerOrganizationId)
    .filter((item) => !stage || item.stage === stage)
    .filter((item) => !exceptionState || item.exceptionState === exceptionState)
    .filter(
      (item) =>
        !confirmedFrom || item.confirmedAt >= Date.parse(`${confirmedFrom}T00:00:00Z`),
    )
    .filter(
      (item) => !confirmedTo || item.confirmedAt <= Date.parse(`${confirmedTo}T23:59:59Z`),
    )
    .sort((a, b) => b.confirmedAt - a.confirmedAt)
    .map((order) => ({
      formal_order_id: order.id,
      marketplace_code: 'AMAZON_JP',
      amazon_order_number: order.amazonOrderNumber,
      amazon_order_date: order.amazonOrderDate,
      confirmed_at: order.confirmedAt,
      buyer_customer_id: 'review-buyer-customer-1',
      buyer_customer_no: order.buyerNo,
      buyer_display_name: order.buyerName,
      seller_organization_id: 'review-seller-org',
      store_display_name: order.storeName,
      product_name_snapshot: order.productName,
      review_type: order.reviewType,
      buyer_expected_principal_cny_fen: order.buyerExpectedPrincipal,
      seller_expected_principal_cny_fen: order.sellerExpectedPrincipal,
      responsibility: orderResponsibility(order),
    }));
  return { items, next_cursor: null };
}

const staffEvidence = {
  submission_id: 'review-staff-evidence-1',
  reservation_id: 'review-buyer-reservation-003',
  marketplace: 'AMAZON_JP',
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
    work_item_id: 'review-work-evidence',
    assigned_staff_id: 'review-staff-owner',
    assigned_team_id: null,
    fixed_assignment_id: 'review-assignment-order_evidence_review',
  },
};
const staffReview = {
  review_case_id: 'review-staff-review-1',
  formal_order_id: 'review-seller-order-1',
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
  formal_order_id: 'review-seller-order-1',
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
  review_approved_at: NOW - 4 * DAY - 3_600_000,
  promise_deadline_at: NOW + 6 * DAY,
  reminder_count: 1,
  last_reminded_at: NOW - DAY,
  buyer: { buyer_customer_id: 'review-buyer-customer-1', buyer_customer_no: '20260808B00042' },
  order: {
    formal_order_id: 'review-seller-order-1',
    marketplace: 'AMAZON_JP',
    amazon_order_number_normalized: '503-7770001-0003001',
    product_id: 'review-product-1',
    asin: 'B0DEMO001X',
  },
  workflow: {
    work_item_id: 'review-work-refund',
    assigned_staff_id: 'review-staff-owner',
    assigned_team_id: null,
    fixed_assignment_id: 'review-assignment-buyer_refund_processing',
  },
  source_review_event_id: 'review-approved-event',
  review_case_id: 'review-staff-review-1',
  refund_account_name: null,
  refund_account_identifier: null,
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
  primary_contact_member_id: 'review-member-owner',
  primary_contact_member_name: 'Demo Owner',
}));

// Stage 7.5 batch 3：卖家结算批次（与 payables/payments 同一组织）。
const settlementBatches = [
  {
    batch_id: 'review-settlement-batch-1',
    seller_organization_id: 'review-seller-org',
    status: 'DRAFT',
    frozen_total_cny_fen: '0',
    frozen_payable_count: 0,
    paid_amount_cny_fen: '0',
    outstanding_amount_cny_fen: '0',
    version: 1,
    created_at: NOW - 3_600_000,
    confirmed_at: null,
    cancelled_at: null,
    cancel_reason: null,
  },
  {
    batch_id: 'review-settlement-batch-2',
    seller_organization_id: 'review-seller-org',
    status: 'CONFIRMED',
    frozen_total_cny_fen: '47400',
    frozen_payable_count: 3,
    paid_amount_cny_fen: '0',
    outstanding_amount_cny_fen: '47400',
    version: 2,
    created_at: NOW - 2 * DAY,
    confirmed_at: NOW - DAY,
    cancelled_at: null,
    cancel_reason: null,
  },
  {
    batch_id: 'review-settlement-batch-3',
    seller_organization_id: 'review-seller-org',
    status: 'PARTIALLY_PAID',
    frozen_total_cny_fen: '486500',
    frozen_payable_count: 5,
    paid_amount_cny_fen: '200000',
    outstanding_amount_cny_fen: '286500',
    version: 3,
    created_at: NOW - 8 * DAY,
    confirmed_at: NOW - 7 * DAY,
    cancelled_at: null,
    cancel_reason: null,
  },
  {
    batch_id: 'review-settlement-batch-4',
    seller_organization_id: 'review-seller-org',
    status: 'CANCELLED',
    frozen_total_cny_fen: '9600',
    frozen_payable_count: 1,
    paid_amount_cny_fen: '0',
    outstanding_amount_cny_fen: '0',
    version: 2,
    created_at: NOW - 12 * DAY,
    confirmed_at: NOW - 11 * DAY,
    cancelled_at: NOW - 10 * DAY,
    cancel_reason: '成员金额核对有出入，取消后重新建批次。',
  },
];
const staffSettlementPayments = [
  {
    payment_id: 'review-seller-payment-1',
    amount_cny_fen: '200000',
    paid_at: NOW - 5 * DAY,
    recorded_at: NOW - 5 * DAY,
    allocated_amount_cny_fen: '200000',
    unallocated_amount_cny_fen: '0',
    status: 'FULLY_ALLOCATED',
    version: 1,
    allocations: [
      {
        allocation_id: 'review-allocation-1',
        payable_id: 'review-payable-3',
        payable_type: 'SELLER_PRINCIPAL',
        allocated_amount_cny_fen: '200000',
        reversed_amount_cny_fen: '0',
        net_amount_cny_fen: '200000',
        allocated_at: NOW - 5 * DAY,
      },
    ],
    proof: {
      file_object_id: 'review-file-settlement-proof',
      file_version: 1,
      purpose: 'SELLER_SETTLEMENT_PROOF',
      visibility: 'INTERNAL_ONLY',
    },
  },
  {
    payment_id: 'review-seller-payment-2',
    amount_cny_fen: '50000',
    paid_at: NOW - 2 * DAY,
    recorded_at: NOW - 2 * DAY,
    allocated_amount_cny_fen: '10000',
    unallocated_amount_cny_fen: '40000',
    status: 'PARTIALLY_ALLOCATED',
    version: 1,
    allocations: [
      {
        allocation_id: 'review-allocation-2',
        payable_id: 'review-payable-2',
        payable_type: 'SELLER_SERVICE_FEE',
        allocated_amount_cny_fen: '10000',
        reversed_amount_cny_fen: '0',
        net_amount_cny_fen: '10000',
        allocated_at: NOW - 2 * DAY,
      },
    ],
    proof: {
      file_object_id: 'review-file-settlement-proof-2',
      file_version: 1,
      purpose: 'SELLER_SETTLEMENT_PROOF',
      visibility: 'INTERNAL_ONLY',
    },
  },
];

function dashboardSummary(windowKey: string) {
  // D-056：经营看板只读精简摘要（待办、异常、最近订单事实、owner 少量财务摘要）；
  // 旧漏斗/渠道归因/financial-projection 读模型已退役。
  return {
    summary: {
      window: {
        key: windowKey,
        from_date: '2026-08-01',
        to_date: '2026-08-11',
        timezone: 'Asia/Shanghai',
        data_as_of: NOW,
      },
      cards: { new_customers_buyer: 27, new_customers_seller: 9, reservations: 19, formal_orders: 13 },
      pending: { buyer_refunds: 6, seller_settlements: 4 },
      overdue: { open_work_items: 3, finance_exceptions: 1 },
      owner_summary: {
        projected_profit: {
          amount_cny_fen: '896520',
          valid_order_count: 13,
          conflict_order_count: 1,
        },
        completed_profit: {
          amount_cny_fen: '568230',
          valid_order_count: 8,
          conflict_order_count: 0,
        },
      },
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
function batchReadIntent(body: unknown) {
  // file-read-api 校验：access_token_available=true 时 access_token 必须非空，
  // 且 replayed !== access_token_available；intents 必须覆盖请求的每个文件。
  const requested = Array.isArray((body as { requests?: unknown }).requests)
    ? ((body as { requests: { file_object_id: string }[] }).requests)
    : [];
  return {
    intents: requested.map((item) => ({
      read_intent_id: `review-read-${sequence}`,
      file_object_id: item.file_object_id,
      access_token: demoReadCredential(),
      access_token_available: true,
      expires_at: NOW + 10 * 60_000,
      replayed: false,
    })),
  };
}

function resolve(request: ApiRequest<z.ZodType>): unknown {
  const parsed = url(request.path);
  const path = parsed.pathname;
  const method = request.method;

  if (method === 'POST' && /\/files\/[^/]+\/read-intents$/u.test(path))
    return reviewFileReadIntent(path);
  if (method === 'POST' && /\/file-read-intents\/batch$/u.test(path))
    return batchReadIntent(request.body);
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
  if (path === '/api/buyer-portal/me' && method === 'GET')
    return {
      buyer: {
        display_name: 'Demo 多身份客户',
        marketplace_code: 'AMAZON_JP',
        identity_review_status: 'CLEAR',
        customer_number: '20260822B03585',
        refund_account_name: null,
        refund_account_identifier: null,
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
      demand: reservationDemandView(source),
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
        instruction_version: 1,
        current_version_no: 1,
        evidence_status: 'NONE',
        can_submit_evidence: true,
        can_read_images: true,
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
            marketplace_code: 'AMAZON_JP',
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
        settlement_account_name: null,
        settlement_account_identifier: null,
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
  if (path === '/api/seller-portal/me/settlement-account' && method === 'PATCH') {
    const me = sellerMe();
    return {
      me: {
        ...me.me,
        organization: {
          ...me.me.organization,
          settlement_account_name: 'Demo 收款人',
          settlement_account_identifier: 'demo@example.invalid',
        },
      },
    };
  }
  if (path === '/api/seller-portal/settlement/payments' && method === 'GET')
    return {
      // 卖家视角付款列表不带 INTERNAL_ONLY 凭证文件。
      items: staffSettlementPayments.map(({ proof: _proof, ...payment }) => payment),
      page: { limit: 100, next_cursor: null },
    };
  if (path === '/api/seller-portal/settlement/batches' && method === 'GET') {
    // 卖家侧只读且只见 CONFIRMED/PARTIALLY_PAID/PAID（DRAFT/CANCELLED 后端过滤）。
    const sellerSafe = settlementBatches
      .filter((batch) => batch.status !== 'DRAFT' && batch.status !== 'CANCELLED')
      .map((batch) => ({
        batch_id: batch.batch_id,
        status: batch.status,
        frozen_total_cny_fen: batch.frozen_total_cny_fen,
        frozen_payable_count: batch.frozen_payable_count,
        paid_amount_cny_fen: batch.paid_amount_cny_fen,
        outstanding_amount_cny_fen: batch.outstanding_amount_cny_fen,
        confirmed_at: batch.confirmed_at ?? NOW,
      }));
    return { batches: sellerSafe, next_cursor: null };
  }
  if (/^\/api\/seller-portal\/settlement\/batches\/[^/]+$/u.test(path) && method === 'GET') {
    const id = idAfter(path, '/api/seller-portal/settlement/batches/');
    const batch = settlementBatches.find((item) => item.batch_id === id) ?? settlementBatches[1]!;
    return {
      batch: {
        batch_id: batch.batch_id,
        status: batch.status === 'DRAFT' || batch.status === 'CANCELLED' ? 'CONFIRMED' : batch.status,
        frozen_total_cny_fen: batch.frozen_total_cny_fen,
        frozen_payable_count: batch.frozen_payable_count,
        paid_amount_cny_fen: batch.paid_amount_cny_fen,
        outstanding_amount_cny_fen: batch.outstanding_amount_cny_fen,
        confirmed_at: batch.confirmed_at ?? NOW,
        members: [
          {
            amazon_order_number: '503-7770001-0003001',
            payable_type: 'SELLER_PRINCIPAL',
            frozen_amount_cny_fen: '128800',
            paid_amount_cny_fen: '100000',
            outstanding_amount_cny_fen: '28800',
          },
          {
            amazon_order_number: '503-7770002-0003002',
            payable_type: 'SELLER_SERVICE_FEE',
            frozen_amount_cny_fen: '28600',
            paid_amount_cny_fen: '28600',
            outstanding_amount_cny_fen: '0',
          },
        ],
        members_next_cursor: null,
      },
    };
  }
  if (path === '/api/buyer-portal/service-channels' && method === 'GET') {
    // 客服渠道种子为空：与后端初始状态一致，买家端显示“请联系工作人员”。
    return { channels: [] };
  }
  if (path === '/api/buyer-portal/me/refund-account' && method === 'PATCH')
    return {
      buyer: {
        display_name: 'Demo 多身份客户',
        marketplace_code: 'AMAZON_JP',
        identity_review_status: 'CLEAR',
        customer_number: '20260822B03585',
        refund_account_name: 'Demo 收款人',
        refund_account_identifier: 'demo@example.invalid',
      },
    };

  // -------------------------------------------------------------------------
  // 员工端：工作台、工作项、订单、财务、客户、设置（Schema 37 / 241 合同）。
  // -------------------------------------------------------------------------
  if (path === '/api/staff/me/work-items' && method === 'GET') {
    const status = parsed.searchParams.get('status') ?? 'OPEN';
    const type = parsed.searchParams.get('work_type');
    return {
      work_items: clone(workItems(status).filter((item) => !type || item.work_type === type)),
      next_cursor: null,
    };
  }
  if (path === '/api/staff/me/work-items/summary' && method === 'GET')
    return clone(workbenchSummary());
  if (/^\/api\/staff\/me\/work-items\/[^/]+$/u.test(path) && method === 'GET') {
    const id = idAfter(path, '/api/staff/me/work-items/');
    const match =
      workItems('OPEN').find((item) => item.work_item_id === id) ??
      workItems('COMPLETED').find((item) => item.work_item_id === id);
    if (!match) {
      throw new FrontendApiError('NOT_FOUND', 404, 'review-work-item-missing', 'CONTRACT', null, {
        path: path.slice(0, 200),
      });
    }
    return { work_item: clone(match) };
  }
  if (path === '/api/staff/formal-orders' && method === 'GET') {
    // 仅含 amazon_order_number 单参数时保持“按订单号查单”语义：重放完整聚合。
    const keys = [...parsed.searchParams.keys()];
    if (keys.length === 1 && keys[0] === 'amazon_order_number') {
      return formalOrderAggregate(parsed.searchParams.get('amazon_order_number') ?? undefined);
    }
    return staffOrderList(parsed.searchParams);
  }
  if (/^\/api\/staff\/formal-orders\/[^/]+$/u.test(path) && method === 'GET') {
    return formalOrderAggregate(idAfter(path, '/api/staff/formal-orders/'));
  }
  if (/^\/api\/staff\/finance\/orders\/[^/]+$/u.test(path) && method === 'GET') {
    return { order: clone(internalFinanceOrder()) };
  }
  if (
    /^\/api\/staff\/formal-orders\/[^/]+\/communication-screenshots\/intents$/u.test(path) &&
    method === 'POST'
  ) {
    return {
      upload_intent_id: `review-upload-intent-${sequence}`,
      purpose: 'ORDER_COMMUNICATION_SCREENSHOT',
      visibility: 'SELLER_VISIBLE',
      status: 'ISSUED',
      version: 1,
      expires_at: NOW + 10 * 60_000,
      uploads: [
        {
          file_object_id: `review-comm-file-${sequence}`,
          slot_no: 1,
          upload_token: 'review-demo-upload-token-0123456789abcdef',
          upload_token_available: true,
          expires_at: NOW + 10 * 60_000,
        },
      ],
      replayed: false,
    };
  }
  if (
    /^\/api\/staff\/formal-orders\/[^/]+\/communication-screenshots$/u.test(path) &&
    method === 'POST'
  ) {
    return {
      screenshot: {
        formal_order_id: 'review-seller-order-1',
        file_object_id: `review-comm-file-${sequence}`,
        replayed: false,
      },
    };
  }
  if (/\/file-upload-intents\/[^/]+\/complete$/u.test(path) && method === 'POST') {
    return {
      upload_intent_id: `review-upload-intent-${sequence}`,
      status: 'VERIFIED',
      version: 2,
      files: [
        {
          file_object_id: `review-comm-file-${sequence}`,
          purpose: 'ORDER_COMMUNICATION_SCREENSHOT',
          visibility: 'SELLER_VISIBLE',
          detected_mime: 'image/png',
          byte_size: 2048,
          sha256: '0'.repeat(64),
          version: 2,
        },
      ],
      replayed: false,
    };
  }
  if (/^\/api\/staff\/buyer-advance-principal\/[^/]+$/u.test(path) && method === 'GET') {
    return { entries: [] };
  }
  if (/^\/api\/staff\/order-integrity\/[^/]+\/(events|financial-adjustments)$/u.test(path) && method === 'POST') {
    return {
      event: { event_id: `review-op-event-${sequence}`, replayed: false },
    };
  }
  if (/^\/api\/staff\/order-evidence\/[^/]+\/preflight$/u.test(path) && method === 'GET') {
    return {
      preflight: {
        submission_id: idAfter(path, '/api/staff/order-evidence/'),
        amazon_order_date: '2026-08-08',
        ready: true,
        checks: [
          {
            code: 'ORDER_DAY_BASE_RATE',
            status: 'READY',
            message: '订单日汇率已配置。',
            action_path: '/staff/finance',
            required_access: 'FINANCIAL_VIEW',
          },
        ],
      },
    };
  }
  if (/^\/api\/staff\/order-evidence\/[^/]+\/approve$/u.test(path) && method === 'POST') {
    return {
      formal_order_id: 'review-seller-order-1',
      order_evidence_submission_id: idAfter(path, '/api/staff/order-evidence/'),
      status: 'CONFIRMED',
      version: 1,
      reference_order_amount_jpy: '12000',
      final_paid_jpy: '12860',
      price_difference_jpy: '860',
      price_mismatch_acknowledged: true,
      confirmed_at: NOW,
      replayed: false,
    };
  }
  if (/^\/api\/staff\/order-evidence\/[^/]+\/request-changes$/u.test(path) && method === 'POST') {
    return {
      submission_id: idAfter(path, '/api/staff/order-evidence/'),
      reservation_id: 'review-buyer-reservation-003',
      buyer_customer_id: 'review-buyer-customer-1',
      marketplace: 'AMAZON_JP',
      status: 'CHANGES_REQUESTED',
      version: 2,
      current_evidence_version_no: 1,
      current_evidence_version_id: 'review-evidence-version-1',
      replayed: false,
      public_change_reason: '订单金额与指引不一致，请核对后重新提交。',
    };
  }
  if (path.startsWith('/api/staff/order-evidence/') && method === 'GET')
    return { order_evidence: clone(staffEvidence) };
  if (/^\/api\/staff\/reviews\/[^/]+\/approve$/u.test(path) && method === 'POST') {
    return {
      review: {
        review_case_id: idAfter(path, '/api/staff/reviews/'),
        formal_order_id: 'review-seller-order-1',
        status: 'APPROVED',
        version: 2,
        current_evidence_version_no: 1,
        current_evidence_version_id: 'review-staff-review-evidence-1',
        approved_event_id: `review-approved-event-${sequence}`,
        financial_events: [
          {
            event_id: `review-financial-event-${sequence}`,
            event_type: 'BUYER_REFUND_BECAME_DUE',
            amount_cny_fen: '168800',
            formal_order_financial_snapshot_id: 'review-snapshot-1',
          },
        ],
        replayed: false,
      },
    };
  }
  if (/^\/api\/staff\/reviews\/[^/]+\/(reject|request-changes)$/u.test(path) && method === 'POST') {
    const action = path.endsWith('/reject') ? 'REJECTED' : 'CHANGES_REQUESTED';
    return {
      review: {
        review_case_id: idAfter(path, '/api/staff/reviews/'),
        formal_order_id: 'review-seller-order-1',
        status: action,
        version: 2,
        current_evidence_version_no: 1,
        current_evidence_version_id: 'review-staff-review-evidence-1',
        replayed: false,
      },
    };
  }
  if (/^\/api\/staff\/reviews\/[^/]+\/visibility$/u.test(path) && method === 'POST') {
    return {
      observation: {
        observation_id: `review-observation-${sequence}`,
        review_case_id: idAfter(path, '/api/staff/reviews/'),
        formal_order_id: 'review-seller-order-1',
        visibility_status: 'VISIBLE',
        note: 'Demo 展示状态观察',
        observed_at: NOW,
        actor_staff_id: 'review-staff-owner',
        created_at: NOW,
      },
    };
  }
  if (path.startsWith('/api/staff/reviews/') && method === 'GET')
    return { review: clone(staffReview) };
  if (path === '/api/staff/search' && method === 'GET') {
    const query = parsed.searchParams.get('q') ?? '';
    return {
      query,
      buyers: query.includes('张') || query.toLowerCase().includes('zhang')
        ? [{
          buyer_customer_id: 'review-buyer-customer-1',
          buyer_customer_no: '20260808B00042',
          display_name: '张三丰（演示）',
          marketplace_code: 'AMAZON_JP',
        }]
        : [],
      products: query.toLowerCase().startsWith('b0') || query.includes('杯')
        ? [{
          product_id: 'review-product-1',
          product_name: '轻量保温随行杯',
          asin_display: 'B0DEMO001X',
          marketplace_code: 'AMAZON_JP',
          status: 'ACTIVE',
        }]
        : [],
      orders: query.startsWith('503')
        ? [{
          formal_order_id: 'review-seller-order-1',
          amazon_order_number_normalized: '503-7770001-0003001',
          asin_display: 'B0DEMO001X',
          marketplace_code: 'AMAZON_JP',
        }]
        : [],
      demands: query.includes('杯')
        ? [{
          demand_batch_id: 'review-seller-demand-1',
          product_name: '轻量保温随行杯',
          status: 'PUBLISHED',
          marketplace_code: 'AMAZON_JP',
        }]
        : [],
    };
  }
  if (path === '/api/staff/buyer-refunds' && method === 'GET') {
    // 列表项是 detail 的严格子集（refundBase）；剥掉 payments 等扩展字段。
    const {
      source_review_event_id: _sourceReviewEventId,
      review_case_id: _reviewCaseId,
      refund_account_name: _refundAccountName,
      refund_account_identifier: _refundAccountIdentifier,
      payments: _payments,
      reversals: _reversals,
      ...listItem
    } = clone(staffRefund);
    return { items: [listItem], next_cursor: null };
  }
  if (path.startsWith('/api/staff/buyer-refunds/') && method === 'GET')
    return { buyer_refund: clone(staffRefund) };
  if (/^\/api\/staff\/buyer-refunds\/[^/]+\/payments$/u.test(path) && method === 'POST') {
    return {
      obligation: {
        obligation_id: 'review-staff-refund-1',
        buyer_customer_id: 'review-buyer-customer-1',
        formal_order_id: 'review-seller-order-1',
        due_amount_cny_fen: '168800',
        net_paid_cny_fen: '108800',
        outstanding_amount_cny_fen: '60000',
        overpaid_amount_cny_fen: '0',
        status: 'PARTIALLY_PAID',
        version: 3,
      },
      payment: {
        payment_entry_id: `review-refund-payment-${sequence}`,
        amount_cny_fen: '48800',
        paid_at: NOW,
        china_business_date: '2026-08-29',
        payment_channel: 'WECHAT',
        public_note: 'Demo 追加返款',
        internal_note: null,
        proofs: [
          {
            file_object_id: `review-file-refund-proof-${sequence}`,
            file_version: 1,
            purpose: 'BUYER_REFUND_PROOF',
            visibility: 'INTERNAL_ONLY',
          },
        ],
      },
      replayed: false,
    };
  }
  if (
    /^\/api\/staff\/buyer-refunds\/[^/]+\/payments\/[^/]+\/reversals$/u.test(path) &&
    method === 'POST'
  ) {
    return {
      obligation: {
        obligation_id: 'review-staff-refund-1',
        buyer_customer_id: 'review-buyer-customer-1',
        formal_order_id: 'review-seller-order-1',
        due_amount_cny_fen: '168800',
        net_paid_cny_fen: '11200',
        outstanding_amount_cny_fen: '157600',
        overpaid_amount_cny_fen: '0',
        status: 'PARTIALLY_PAID',
        version: 4,
      },
      reversal: {
        reversal_entry_id: `review-refund-reversal-${sequence}`,
        obligation_id: 'review-staff-refund-1',
        entry_type: 'REVERSAL',
        original_payment_entry_id: 'review-refund-payment-1',
        amount_cny_fen: '48800',
        reversed_at: NOW,
        china_business_date: '2026-08-29',
        payment_channel: 'WECHAT',
        public_note: null,
      },
      replayed: false,
    };
  }
  if (
    /^\/api\/staff\/demand-batches\/[^/]+\/reservation-schedule$/u.test(path) &&
    method === 'GET'
  ) {
    const demandId = idAfter(path, '/api/staff/demand-batches/');
    const source =
      state.sellerDemands.find((item) => item.id === demandId) ?? state.sellerDemands[1]!;
    const status =
      demandId === 'review-seller-demand-1'
        ? reviewDemandClosed
          ? 'CLOSED'
          : 'PUBLISHED'
        : source.status;
    const canClose = status === 'PUBLISHED' && canReviewDemandClose();
    return {
      page: {
        demand: {
          demand_batch_id: demandId,
          product_id: 'review-product-1',
          product_name: '轻量保温随行杯',
          target_quantity: 12,
          effective_reservation_count: 5,
          order_deadline: NOW + 9 * DAY,
          demand_version: status === 'CLOSED' ? 2 : 1,
          status,
          can_close: canClose,
          schedule: {
            schedule_version_id: 'review-schedule-version-1',
            version_no: 1,
            demand_version: status === 'CLOSED' ? 2 : 1,
            order_interval_days: 2,
            orders_per_run: 3,
            first_order_date: '2026-08-12',
            theoretical_last_order_date: '2026-08-22',
            affected_reservation_count: 5,
            preview_hash: '0'.repeat(64),
            change_reason: '初始排期',
            changed_by_staff_id: 'review-staff-owner',
            created_at: NOW - DAY,
          },
        },
        items: [
          {
            reservation_id: 'review-buyer-reservation-001',
            status: 'APPROVED',
            decision_source: 'STAFF',
            version: 1,
            submitted_at: NOW - 3 * DAY,
            rank: 1,
            planned_order_date: '2026-08-12',
            buyer_reference: '张三丰（演示）',
            buyer_customer_id: 'review-buyer-customer-1',
            buyer_display_name: '张三丰（演示）',
            actual_order_status: 'CONFIRMED',
            actual_order_date: '2026-08-12',
          },
          {
            reservation_id: 'review-buyer-reservation-002',
            status: 'PENDING_REVIEW',
            decision_source: null,
            version: 1,
            submitted_at: NOW - 2 * DAY,
            rank: null,
            planned_order_date: null,
            buyer_reference: '李逍遥（演示）',
            buyer_customer_id: 'review-buyer-customer-2',
            buyer_display_name: '李逍遥（演示）',
            actual_order_status: null,
            actual_order_date: null,
          },
          {
            reservation_id: 'review-buyer-reservation-003',
            status: 'APPROVED',
            decision_source: 'AUTO',
            version: 1,
            submitted_at: NOW - DAY,
            rank: 3,
            planned_order_date: '2026-08-16',
            buyer_reference: '赵灵儿（演示）',
            buyer_customer_id: 'review-buyer-customer-3',
            buyer_display_name: '赵灵儿（演示）',
            actual_order_status: null,
            actual_order_date: null,
          },
        ],
        next_cursor: null,
        timezone: 'Asia/Tokyo',
        sorting: 'submitted_at ASC, id ASC',
        data_as_of: NOW,
      },
    };
  }
  if (/^\/api\/staff\/demand-batches\/[^/]+\/close$/u.test(path) && method === 'POST') {
    const demandId = idAfter(path, '/api/staff/demand-batches/');
    const source = state.sellerDemands.find((item) => item.id === demandId);
    requireReviewDemandClosePermission();
    const body = parseReviewDemandCloseBody(request.body);
    const idempotencyKey = parseIdempotencyKey(
      reviewDemandCloseHeader(request.headers, 'Idempotency-Key'),
    );
    if (!idempotencyKey) {
      reviewDemandCloseError('VALIDATION_ERROR', 400, 'VALIDATION');
    }
    const fingerprint = JSON.stringify({
      demand_batch_id: demandId,
      expected_version: body.expected_version,
      close_reason: body.close_reason,
    });
    const previous = reviewDemandCloseIdempotency.get(idempotencyKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        reviewDemandCloseError('IDEMPOTENCY_CONFLICT', 409, 'CONFLICT');
      }
      return {
        demand_close: {
          ...clone(previous.response.demand_close),
          replayed: true,
        },
      };
    }
    if (demandId !== 'review-seller-demand-1' || reviewDemandClosed) {
      reviewDemandCloseError('DEMAND_BATCH_NOT_PUBLISHED', 409, 'CONFLICT');
    }
    if (!source || source.version !== body.expected_version) {
      reviewDemandCloseError('VERSION_CONFLICT', 409, 'CONFLICT');
    }
    const version = source.version + 1;
    const response: ReviewDemandCloseResponse = {
      demand_close: {
        demand_batch_id: demandId,
        status: 'CLOSED',
        version,
        close_reason: body.close_reason,
        replayed: false,
      },
    };
    Object.assign(source, {
      status: 'CLOSED',
      version,
      close_reason: body.close_reason,
      closed_at: NOW,
      updated_at: NOW,
    });
    reviewDemandClosed = true;
    reviewDemandCloseIdempotency.set(idempotencyKey, {
      fingerprint,
      response: clone(response),
    });
    return response;
  }
  if (/^\/api\/staff\/demand-batches\/[^/]+\/schedule\/preview$/u.test(path) && method === 'POST') {
    return {
      preview: {
        demand_batch_id: idAfter(path, '/api/staff/demand-batches/'),
        expected_version: 1,
        current_schedule_version: 1,
        order_interval_days: 3,
        orders_per_run: 2,
        first_order_date: '2026-08-13',
        theoretical_last_order_date: '2026-08-25',
        order_deadline_date: '2026-09-05',
        effective_reservation_count: 5,
        affected_reservation_count: 5,
        before_first_order_date: '2026-08-12',
        before_theoretical_last_order_date: '2026-08-22',
        preview_hash: '1'.repeat(64),
        timezone: 'Asia/Tokyo',
        data_as_of: NOW,
      },
    };
  }
  if (/^\/api\/staff\/demand-batches\/[^/]+\/schedule\/confirm$/u.test(path) && method === 'POST') {
    return {
      schedule_confirmation: {
        demand_batch_id: idAfter(path, '/api/staff/demand-batches/'),
        demand_version: 1,
        schedule: {
          schedule_version_id: `review-schedule-version-${sequence}`,
          version_no: 2,
          demand_version: 1,
          order_interval_days: 3,
          orders_per_run: 2,
          first_order_date: '2026-08-13',
          theoretical_last_order_date: '2026-08-25',
          affected_reservation_count: 5,
          preview_hash: '1'.repeat(64),
          change_reason: '调整下单节奏',
          changed_by_staff_id: 'review-staff-owner',
          created_at: NOW,
        },
        replayed: false,
      },
    };
  }
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
        main_image: {
          file_object_id: 'review-product-main-image',
          file_version: 1,
          client_file_name: 'main.webp',
        },
        ordering_guide_expected_amount_jpy: 2980,
        color_spec_mode: 'MAIN_IMAGE_VARIANT',
        buyer_self_pay_bps_snapshot: null,
        can_publish: true,
        timezone: 'Asia/Tokyo',
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
        schedule: {
          schedule_version_id: `review-schedule-version-${sequence}`,
          version_no: 1,
          demand_version: 2,
          order_interval_days: 2,
          orders_per_run: 3,
          first_order_date: '2026-08-12',
          theoretical_last_order_date: '2026-08-22',
          affected_reservation_count: 5,
          preview_hash: '0'.repeat(64),
          change_reason: '审核通过时生成初始排期',
          changed_by_staff_id: 'review-staff-owner',
          created_at: NOW,
        },
        replayed: false,
      },
    };
  if (/^\/api\/staff\/product-applications\/[^/]+\/review-context$/u.test(path) && method === 'GET')
    return {
      review_context: {
        application_id: idAfter(path, '/api/staff/product-applications/'),
        store: { id: 'review-store-a', display_name: 'TEST 日本店 A' },
        marketplace_code: 'AMAZON_JP',
        asin: 'B0DEMOAPP0',
        product_name: 'Demo 商品申请 1',
        search_keywords: ['Demo', '日本'],
        product_url: 'https://example.invalid/product',
        buyer_visible_notes: 'Demo 买家可见说明',
        seller_notes: 'Demo 卖家内部备注',
        ordering_guide_expected_amount_jpy: '2980',
        status: 'SUBMITTED',
        version: 1,
        submitted_at: NOW - DAY,
        images: [
          {
            file_object_id: 'review-application-image-1',
            file_version: 1,
            client_file_name: 'demo-application-main.png',
          },
        ],
      },
    };
  if (/^\/api\/staff\/product-applications\/[^/]+\/review$/u.test(path) && method === 'POST')
    return {
      product_application_review: {
        application_id: idAfter(path, '/api/staff/product-applications/'),
        status: 'APPROVED',
        application_version: 2,
        product_id: 'review-product-6',
        product_version_id: 'review-product-version-6',
        main_image_file_object_id: 'review-application-image-1',
        review_reason: null,
        replayed: false,
      },
    };
  if (/^\/api\/staff\/reservations\/[^/]+\/review-context$/u.test(path) && method === 'GET')
    return {
      review_context: {
        reservation_id: idAfter(path, '/api/staff/reservations/'),
        buyer: {
          id: 'review-buyer-customer-1',
          customer_no: '20260808B00042',
          name: '张三丰（演示）',
          wechat: 'demo_buyer_wechat',
        },
        store: { id: 'review-store-a', display_name: 'TEST 日本店 A' },
        marketplace_code: 'AMAZON_JP',
        status: 'PENDING_REVIEW',
        version: 1,
        submitted_at: NOW - DAY,
        hold_expires_at: NOW + 6 * 3_600_000,
        order_deadline_snapshot: NOW + 9 * DAY,
        buyer_self_pay_bps_snapshot: 0,
        reference_order_amount_jpy_snapshot: '128000',
        estimated_self_pay_jpy_snapshot: '0',
        estimated_refundable_principal_jpy_snapshot: '108800',
        demand: {
          demand_batch_id: 'review-seller-demand-1',
          product_name: '专业级家庭美容仪 Pro Max',
          task_type: 'VIDEO',
          reservation_deadline: NOW + 2 * DAY,
          order_deadline: NOW + 9 * DAY,
          store_display_name: 'TEST 日本店 A',
        },
      },
    };
  if (/^\/api\/staff\/reservations\/[^/]+\/decision$/u.test(path) && method === 'POST')
    return {
      reservation_decision: {
        reservation_id: idAfter(path, '/api/staff/reservations/'),
        demand_batch_id: 'review-seller-demand-1',
        buyer_customer_id: 'review-buyer-customer-1',
        status: 'APPROVED',
        version: 2,
        decision_reason: null,
        replayed: false,
      },
    };
  if (/^\/api\/staff\/reservations\/[^/]+\/reopen$/u.test(path) && method === 'POST')
    return {
      reservation_reopen: {
        reservation_id: idAfter(path, '/api/staff/reservations/'),
        demand_batch_id: 'review-seller-demand-1',
        status: 'PENDING_REVIEW',
        version: 3,
        reopened_count: 1,
        reason: 'Demo 重新打开预约',
        replayed: false,
      },
    };
  if (/^\/api\/staff\/order-instructions\/[^/]+\/publish$/u.test(path) && method === 'POST')
    return {
      publication: {
        instruction: {
          instruction_id: idAfter(path, '/api/staff/order-instructions/'),
          status: 'ACTIVE',
          version: 2,
        },
        instruction_version_id: `review-instruction-version-${sequence}`,
        content_hash: '2'.repeat(64),
        replayed: false,
        unchanged: false,
      },
    };
  if (/^\/api\/staff\/order-instructions\/[^/]+$/u.test(path) && method === 'GET')
    return {
      order_instruction: {
        instruction_id: idAfter(path, '/api/staff/order-instructions/'),
        reservation_id: 'review-buyer-reservation-003',
        status: 'UNPUBLISHED',
        current_version_no: 1,
        version: 1,
        published_at: null,
        initial_deadline_at: NOW + 5 * DAY,
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
            main_image: {
              file_object_id: `review-product-main-${id}`,
              file_version: 1,
              client_file_name: 'demo-main.webp',
              bound_at: NOW - DAY,
            },
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
        timezone: 'Asia/Tokyo',
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
  if (path === '/api/staff/access-management/seller-organization-assignments' && method === 'GET')
    return {
      seller_organizations: [
        {
          seller_organization_id: 'review-seller-org',
          seller_organization_name: '月光白 Demo 卖家组织',
          marketplace_code: 'AMAZON_JP',
          manager: {
            assignment_id: 'review-assignment-seller-org',
            staff_id: 'review-employee-seller_ops',
            staff_display_name: 'Demo 卖家对接',
            version: 1,
          },
        },
      ],
    };
  if (path === '/api/staff/access-management/buyer-assignments' && method === 'GET')
    return {
      buyers: [
        {
          buyer_customer_id: 'review-buyer-customer-1',
          buyer_display_name: '张三丰（演示）',
          marketplace_code: 'AMAZON_JP',
          pre_sales_owner: {
            assignment_id: 'review-assignment-buyer-pre-sales',
            staff_id: 'review-employee-pre_sales',
            staff_display_name: 'Demo 售前',
            version: 1,
          },
          refund_owner: {
            assignment_id: 'review-assignment-buyer-refund',
            staff_id: 'review-employee-buyer_refund',
            staff_display_name: 'Demo 买家返款',
            version: 1,
          },
        },
      ],
    };
  if (path === '/api/staff/access-management/personal-denies' && method === 'GET')
    return {
      denies: [
        {
          staff_id: 'review-employee-pre_sales',
          staff_display_name: 'Demo 售前',
          permission_code: 'ORDER_CONFIRM',
          status: 'ACTIVE',
          reason: '演示期间临时收窄权限',
          assigned_by_staff_id: 'review-employee-owner',
          assigned_at: NOW - DAY,
          revoked_at: null,
        },
      ],
    };
  if (path.startsWith('/api/staff/access-management/employees') && method === 'POST')
    return { employee: clone(staffEmployees[1]), replayed: false };
  if (/^\/api\/staff\/access-management\/employees\/[^/]+\/status$/u.test(path) && method === 'POST')
    return { employee: clone(staffEmployees[1]), replayed: false };
  if (path === '/api/staff/service-channels' && method === 'GET') {
    // 种子即空：演示环境与后端初始状态一致（未配置联系方式），不编造真实渠道。
    return {
      channels: [
        {
          code: 'BUYER_PRE_SALES',
          display_name: '',
          wechat_id: null,
          qr_file: null,
          version: 1,
          updated_at: NOW - 7 * DAY,
        },
        {
          code: 'BUYER_AFTER_SALES',
          display_name: '',
          wechat_id: null,
          qr_file: null,
          version: 1,
          updated_at: NOW - 7 * DAY,
        },
      ],
    };
  }
  if (/^\/api\/staff\/service-channels\/[^/]+(\/qr)?$/u.test(path) && method !== 'GET') {
    return {
      channel: {
        code: 'BUYER_PRE_SALES',
        display_name: '月光白客服',
        wechat_id: null,
        qr_file: null,
        version: 2,
        updated_at: NOW,
      },
      replayed: false,
    };
  }
  if (
    /^\/api\/staff\/seller-settlements\/[^/]+\/summary$/u.test(path) &&
    method === 'GET'
  ) {
    return {
      settlement: {
        outstanding_principal_cny_fen: '615300',
        outstanding_service_fee_cny_fen: '18600',
        total_outstanding_cny_fen: '633900',
        unallocated_credit_cny_fen: '40000',
        settlement_account_name: null,
        settlement_account_identifier: null,
      },
    };
  }
  if (
    /^\/api\/staff\/seller-settlements\/[^/]+\/payables$/u.test(path) &&
    method === 'GET'
  ) {
    return { items: clone(sellerPayables), page: { limit: 25, next_cursor: null } };
  }
  if (
    /^\/api\/staff\/seller-settlements\/[^/]+\/payments$/u.test(path) &&
    method === 'GET'
  ) {
    return { items: clone(staffSettlementPayments), page: { limit: 25, next_cursor: null } };
  }
  if (
    /^\/api\/staff\/seller-settlements\/[^/]+\/payments$/u.test(path) &&
    method === 'POST'
  ) {
    return {
      payment: clone(staffSettlementPayments[0]),
      replayed: false,
    };
  }
  if (
    /^\/api\/staff\/seller-settlements\/[^/]+\/batches$/u.test(path) &&
    method === 'GET'
  ) {
    return { batches: clone(settlementBatches), next_cursor: null };
  }
  if (/^\/api\/staff\/seller-settlements\/[^/]+\/batches/u.test(path) && method === 'POST') {
    return { batch: clone(settlementBatches[1]), replayed: false };
  }
  if (/^\/api\/staff\/seller-payments\/[^/]+\/(allocations|reverse)$/u.test(path) && method === 'POST') {
    return {
      payment: clone(staffSettlementPayments[1]),
      replayed: false,
    };
  }
  if (path === '/api/staff/seller-principal-rate-policies' && method === 'GET') {
    const policy = {
      policy_version_id: 'review-policy-confirmed',
      scope_type: 'CURRENCY_PAIR_DEFAULT',
      seller_organization_id: null,
      source_currency_code: 'JPY',
      quote_currency_code: 'CNY',
      version_no: 3,
      markup_rate_value: '1500000',
      markup_rate_scale: '100000000',
      effective_from: NOW - 30 * DAY,
      created_by_staff_id: 'staff-demo-1',
      created_at: NOW - 30 * DAY,
      replayed: false,
    };
    return {
      policies: {
        source_currency_code: 'JPY',
        quote_currency_code: 'CNY',
        seller_organization_id: parsed.searchParams.get('seller_organization_id'),
        default_policy: policy,
        seller_override_policy: null,
        default_next_version: 4,
        seller_override_next_version: parsed.searchParams.has('seller_organization_id') ? 1 : null,
        selected_policy: policy,
      },
    };
  }
  if (path === '/api/staff/seller-principal-rate-policies/save' && method === 'POST')
    return {
      policy: {
        policy_version_id: `review-policy-${sequence}`,
        scope_type: 'CURRENCY_PAIR_DEFAULT',
        seller_organization_id: null,
        source_currency_code: 'JPY',
        quote_currency_code: 'CNY',
        version_no: 4,
        markup_rate_value: '400000',
        markup_rate_scale: '100000000',
        effective_from: NOW,
        created_by_staff_id: 'staff-demo-1',
        created_at: NOW,
        replayed: false,
      },
    };
  if (path === '/api/staff/rate-center' && method === 'GET') {
    const businessDate = parsed.searchParams.get('business_date') ?? '2026-08-11';
    const activeRate = {
      rate_version_id: 'review-base-rate-1',
      business_date: businessDate,
      version_no: 1,
      rate_value: '4600000',
      rate_scale: '100000000',
      created_by_staff_id: 'staff-demo-1',
      created_at: NOW - DAY / 2,
    };
    const policy = {
      policy_version_id: 'review-policy-confirmed',
      scope_type: 'CURRENCY_PAIR_DEFAULT',
      seller_organization_id: null,
      source_currency_code: 'JPY',
      quote_currency_code: 'CNY',
      version_no: 3,
      markup_rate_value: '1500000',
      markup_rate_scale: '100000000',
      effective_from: NOW - 30 * DAY,
      created_by_staff_id: 'staff-demo-1',
      created_at: NOW - 30 * DAY,
      replayed: false,
    };
    return {
      business_date: businessDate,
      source_currency_code: 'JPY',
      quote_currency_code: 'CNY',
      base_rate: {
        business_date: businessDate,
        versions: [activeRate],
        active_version: activeRate,
        next_version: 2,
      },
      seller_organizations: [
        {
          seller_organization_id: 'review-seller-org-1',
          seller_organization_name: 'Demo 卖家组织',
          marketplace_code: 'AMAZON_JP',
        },
      ],
      policies: {
        source_currency_code: 'JPY',
        quote_currency_code: 'CNY',
        seller_organization_id: parsed.searchParams.get('seller_organization_id'),
        default_policy: policy,
        seller_override_policy: null,
        default_next_version: 4,
        seller_override_next_version: parsed.searchParams.has('seller_organization_id') ? 1 : null,
        selected_policy: policy,
      },
    };
  }
  if (path === '/api/staff/rate-center/base-rates' && method === 'POST')
    return {
      base_rate: {
        rate_version_id: `review-base-rate-${sequence}`,
        business_date: '2026-08-12',
        version_no: 1,
        rate_value: '4600000',
        rate_scale: '100000000',
        effective_from: NOW,
        replayed: false,
      },
    };
  if (path === '/api/staff/seller-service-fees' && method === 'GET')
    return {
      seller_organization_id: parsed.searchParams.get('seller_organization_id') ?? '',
      fees: (['RATING', 'TEXT', 'IMAGE', 'VIDEO'] as const).map((reviewType, index) => ({
        review_type: reviewType,
        effective_fee: index === 0
          ? {
              rule_version_id: 'review-fee-rating-1',
              version_no: 1,
              fee_cny_fen: '1250',
              effective_from: NOW - 20 * DAY,
              created_at: NOW - 20 * DAY,
            }
          : null,
        next_version: index === 0 ? 2 : 1,
      })),
    };
  if (path === '/api/staff/seller-service-fees' && method === 'POST')
    return {
      fee: {
        rule_version_id: `review-fee-${sequence}`,
        seller_organization_id: parsed.searchParams.get('seller_organization_id') ?? '',
        marketplace_code: 'AMAZON_JP',
        review_type: 'RATING',
        version_no: 1,
        fee_cny_fen: '1250',
        effective_from: NOW,
        replayed: false,
      },
    };
  if (path === '/api/staff/admin-business-dashboard/summary' && method === 'GET')
    return dashboardSummary(parsed.searchParams.get('window') ?? 'TODAY');
  if (path === '/api/staff/customer-onboarding/lookup' && method === 'GET')
    return {
      matches: [
        {
          customer_type: parsed.searchParams.get('customer_type') ?? 'BUYER',
          subject_id: 'review-existing-customer-1',
          display_name: 'Demo 历史多身份客户',
          customer_number: '20260822B03585',
          marketplace_code: 'AMAZON_JP',
          has_portal_account: true,
          historical_order_count: 18,
          source_status: 'HISTORICAL_UNKNOWN',
        },
      ],
      resolution_required: false,
      manual_resolution_applied: false,
    };
  if (path === '/api/staff/customer-onboarding/seller-directory' && method === 'GET')
    return {
      items: [
        {
          seller_organization_id: 'review-seller-org',
          seller_code: 'TEST-S001',
          display_name: '月光白 Demo 卖家组织',
          wechat_masked: 'demo****01',
          marketplace_code: 'AMAZON_JP',
          source_status: 'CURRENT_OR_NEW',
          source_file_count: 0,
          product_names: ['轻量保温随行杯', '无线静音鼠标'],
          active_offering_count: 2,
          has_portal_account: true,
        },
        {
          seller_organization_id: 'review-seller-org-2',
          seller_code: 'TEST-S002',
          display_name: 'Demo 历史进口卖家',
          wechat_masked: 'hist****88',
          marketplace_code: 'AMAZON_JP',
          source_status: 'HISTORICAL_FROZEN_IMPORT',
          source_file_count: 6,
          product_names: ['历史保温壶（存档）'],
          active_offering_count: 0,
          has_portal_account: false,
        },
      ],
    };
  if (path === '/api/staff/customer-onboarding/buyer-registration-invitations' && method === 'POST')
    return {
      invitation: {
        invitation_id: `review-buyer-invite-${sequence}`,
        registration_token: 'review-buyer-token',
        registration_path: '/review/buyer/register?token=demo',
        wechat_id: 'demo_new_buyer',
        marketplace_code: 'AMAZON_JP',
        status: 'ACTIVE',
        version: 1,
        expires_at: NOW + 7 * DAY,
        replayed: false,
      },
    };
  if (path === '/api/staff/buyer-customers' && method === 'POST')
    return {
      buyer_customer: {
        buyer_customer_id: `review-buyer-customer-${sequence}`,
        buyer_number: '20260829B00001',
        access_status: 'INVITED',
        activated: false,
        initial_pre_sales_owner: {
          assignment_id: `review-assignment-${sequence}`,
          staff_id: 'review-staff-pre_sales',
          staff_display_name: 'Demo 售前',
          version: 1,
        },
      },
      replayed: false,
    };
  if (path === '/api/staff/customer-security/seller-invitations' && method === 'POST')
    return {
      invitation: {
        invitation_id: `review-seller-invite-${sequence}`,
        registration_token: 'review-seller-token',
        registration_path: '/review/seller/register?token=demo',
        wechat_id: 'demo_new_seller',
        marketplace_code: 'AMAZON_JP',
        seller_organization_id: 'review-seller-org-2',
        seller_name: 'Demo 历史进口卖家',
        onboarding_kind: 'HISTORICAL_ACCOUNT_ONLY',
        status: 'ACTIVE',
        version: 1,
        expires_at: NOW + 7 * DAY,
        replayed: false,
      },
    };
  if (
    path === '/api/staff/customer-security/seller-invitations/current' &&
    method === 'GET'
  ) {
    const organizationId = parsed.searchParams.get('seller_organization_id');
    if (organizationId === 'review-seller-org-2') {
      return {
        invitation: {
          invitation_id: 'review-seller-invite-active',
          wechat_id: 'demo_new_seller',
          marketplace_code: 'AMAZON_JP',
          seller_organization_id: 'review-seller-org-2',
          seller_member_id: null,
          onboarding_kind: 'HISTORICAL_ACCOUNT_ONLY',
          issued_by_staff_id: 'review-staff-seller_ops',
          status: 'ACTIVE',
          version: 1,
          issued_at: NOW - DAY,
          expires_at: NOW + 6 * DAY,
          consumed_at: null,
          revoked_at: null,
          registration_link_recoverable: false,
        },
      };
    }
    return { invitation: null };
  }
  if (/^\/api\/staff\/customer-security\/[^/]+-invitations\/[^/]+\/revoke$/u.test(path) && method === 'POST')
    return {
      invitation: {
        invitation_id: idAfter(path.split('/revoke')[0]!, '/api/staff/customer-security/'),
        status: 'REVOKED',
        version: 2,
        revoked_at: NOW,
      },
    };
  if (/^\/api\/staff\/customer-onboarding\/[^/]+\/[^/]+\/password-reset$/u.test(path) && method === 'POST')
    return {
      password_reset: {
        reset_id: `review-reset-${sequence}`,
        reset_token: 'review-reset-token',
        reset_path: '/review/customer/reset-password?token=demo',
        expires_at: NOW + 3_600_000,
        affected_personas: ['BUYER'],
        replayed: false,
      },
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
  if (path === '/api/staff/customer-identity-resolution/cases' && method === 'POST')
    return {
      case: {
        id: `review-identity-case-${sequence}`,
        identity_masked: 'demo****99',
        customer_type: 'BUYER',
        marketplace_code: 'AMAZON_JP',
        reason_code: 'AMBIGUOUS_HISTORY',
        staff_note: '员工查询历史客户时同一站点匹配到多个业务主体，请总管理员人工核对。',
        status: 'OPEN',
        reported_by_staff_id: 'review-staff-pre_sales',
        resolved_subject_id: null,
        resolution_note: null,
        resolved_by_staff_id: null,
        created_at: NOW,
        resolved_at: null,
      },
    };
  return blocked(`${method} ${request.path}`);
}

function formalOrderAggregate(orderNumber?: string) {
  const owner = currentStaffReviewRole() === 'owner';
  const target =
    (orderNumber !== undefined
      ? staffOrders.find((order) => order.amazonOrderNumber === orderNumber)
      : undefined) ?? staffOrders[0]!;
  const base = {
    order: {
      formal_order_id: target.id,
      marketplace_code: 'AMAZON_JP',
      amazon_order_number: target.amazonOrderNumber,
      amazon_order_date: target.amazonOrderDate,
      status: 'CONFIRMED',
      confirmed_at: target.confirmedAt,
    },
    buyer: {
      buyer_customer_id: 'review-buyer-customer-1',
      display_name: target.buyerName,
      customer_no: target.buyerNo,
    },
    seller: {
      seller_organization_id: 'review-seller-org',
      store_display_name: target.storeName,
    },
    payment_screenshot: {
      file_object_id: 'review-payment-file-1',
      file_version: 2,
    },
    communication_screenshots: [
      {
        file_object_id: 'review-comm-file-1',
        file_version: 1,
        purpose: 'ORDER_COMMUNICATION_SCREENSHOT',
        visibility: 'SELLER_VISIBLE',
        uploaded_at: NOW - DAY,
        uploaded_by_staff_id: 'review-staff-seller_ops',
        uploaded_by_staff_name: 'Demo 卖家对接',
      },
    ],
    operational_events: [
      {
        event_id: 'review-op-event-1',
        event_type: 'MANUAL_INVESTIGATION',
        reason: 'Demo 人工核查',
        actor_staff_id: 'review-staff-owner',
        created_at: NOW - DAY,
      },
    ],
    responsibility: orderResponsibility(target),
  };
  if (!owner) return base;
  return {
    ...base,
    buyer_advance: {
      authoritative_advance_amount_cny_fen: '0',
      recorded_advance_amount_cny_fen: '0',
      remaining_advance_amount_cny_fen: '0',
      can_record_advance_payment: true,
    },
    financial_adjustments: [],
    financial_snapshot: {
      financial_snapshot_id: 'review-snapshot-1',
      buyer_self_pay_bps: 1000,
      buyer_self_pay_jpy: '398',
      buyer_expected_principal_cny_fen: target.buyerExpectedPrincipal ?? '165000',
      seller_expected_principal_cny_fen: target.sellerExpectedPrincipal ?? '182500',
      service_fee_cny_fen: '1250',
    },
    finance_source: 'internal-finance',
  };
}

function internalFinanceOrder() {
  const target = staffOrders[0]!;
  return {
    position: {
      formal_order_id: target.id,
      amazon_order_number: target.amazonOrderNumber,
      seller_organization_id: 'review-seller-org',
      store_id: target.storeId,
      product_id: 'review-product-1',
      asin: 'B0DEMO001X',
      product_name: target.productName,
      review_type: target.reviewType,
      confirmed_at: target.confirmedAt,
      confirmed_business_date: '2026-08-08',
      review_approved_at: NOW - 2 * DAY,
      review_approved_business_date: '2026-08-27',
      last_cash_business_date: '2026-08-28',
      final_paid_jpy: target.finalPaidJpy,
      financial_snapshot_id: 'review-snapshot-1',
      buyer_self_pay_bps: 1000,
      buyer_self_pay_jpy: '398',
      buyer_expected_principal_cny_fen: '165000',
      seller_expected_principal_cny_fen: '182500',
      service_fee_snapshot_cny_fen: '1250',
      projected_gross_profit_cny_fen: '18750',
      completed_gross_profit_cny_fen: null,
      seller_principal_due_cny_fen: '182500',
      seller_principal_collected_cny_fen: '0',
      seller_principal_outstanding_cny_fen: '182500',
      seller_service_fee_due_cny_fen: '1250',
      seller_service_fee_collected_cny_fen: '0',
      seller_service_fee_outstanding_cny_fen: '1250',
      buyer_refund_due_cny_fen: '165000',
      buyer_refund_net_paid_cny_fen: '60000',
      buyer_refund_outstanding_cny_fen: '105000',
      buyer_refund_overpaid_cny_fen: '0',
      attributed_cash_net_cny_fen: '60000',
      finance_status: 'BUYER_REFUND_OUTSTANDING',
    },
    frozen_snapshot: {
      financial_snapshot_id: 'review-snapshot-1',
      buyer_self_pay_bps: 1000,
      buyer_self_pay_jpy: '398',
      buyer_expected_principal_cny_fen: '165000',
      seller_expected_principal_cny_fen: '182500',
      service_fee_cny_fen: '1250',
      rate_detail: {
        buyer_rate_business_date: '2026-08-08',
        buyer_cny_per_jpy_e8: '4850000',
        markup_rate_value: '1500000',
        final_rate_value: '5000000',
        policy_scope_type: 'CURRENCY_PAIR_DEFAULT',
        policy_version_no: 3,
        policy_effective_from: NOW - 30 * DAY,
      },
    },
    seller_payables: {
      principal_due_cny_fen: '182500',
      principal_collected_cny_fen: '0',
      principal_outstanding_cny_fen: '182500',
      service_fee_due_cny_fen: '1250',
      service_fee_collected_cny_fen: '0',
      service_fee_outstanding_cny_fen: '1250',
    },
    buyer_refund: {
      due_cny_fen: '165000',
      net_paid_cny_fen: '60000',
      outstanding_cny_fen: '105000',
      overpaid_cny_fen: '0',
    },
    attributed_cash: {
      seller_allocated_net_cny_fen: '0',
      buyer_refund_net_paid_cny_fen: '60000',
      net_cny_fen: '60000',
    },
    calculations: {
      projected_gross_profit: {
        formula: 'seller_expected_principal - service_fee - buyer_expected_principal',
        seller_expected_principal_cny_fen: '182500',
        service_fee_cny_fen: '1250',
        buyer_expected_principal_cny_fen: '165000',
        result_cny_fen: '16250',
      },
      completed_gross_profit: {
        formula: 'seller_principal_payable + seller_service_fee_payable - buyer_refund_due',
        eligible: false,
        seller_principal_payable_cny_fen: '0',
        seller_service_fee_payable_cny_fen: '0',
        buyer_refund_due_cny_fen: '165000',
        result_cny_fen: null,
      },
      current_attributed_cash: {
        formula: 'seller_current_net_allocation + buyer_refund_net_paid',
        seller_current_net_allocation_cny_fen: '0',
        buyer_refund_net_paid_cny_fen: '60000',
        result_cny_fen: '60000',
      },
    },
    finance_status: 'BUYER_REFUND_OUTSTANDING',
    exception_codes: [],
    suggested_actions: ['PROCESS_BUYER_REFUND'],
  };
}

function reservationDemandView(source: (typeof state.demands)[number]) {
  // reservation DTO 内嵌的 demand 是严格子集（见 buyer reservationDemandSchema）。
  const {
    target_quantity: _a,
    remaining_quantity: _b,
    open_at: _c,
    main_image: _d,
    reservation_eligibility: _e,
    reservation_ineligibility_reason: _f,
    ...rest
  } = source;
  return rest;
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
