import { z } from 'zod';

export const epoch = z.number().int().nonnegative();
export const integerString = z.string().regex(/^(0|[1-9][0-9]*)$/u);
export const signedIntegerString = z.string().regex(/^-?(0|[1-9][0-9]*)$/u);
export const workTypeSchema = z.enum([
  'PRODUCT_APPLICATION_REVIEW', 'DEMAND_REVIEW', 'RESERVATION_DECISION',
  'ORDER_INSTRUCTION_PUBLISH', 'ORDER_EVIDENCE_REVIEW', 'REVIEW_DECISION',
  'BUYER_REFUND_PROCESSING',
]);
export const workStatusSchema = z.enum(['OPEN', 'COMPLETED', 'CANCELLED']);
export const safeFileSchema = z.object({
  file_object_id: z.string(), file_version: z.number().int().positive(),
  purpose: z.enum(['ORDER_EVIDENCE', 'REVIEW_EVIDENCE', 'BUYER_REFUND_PROOF', 'SELLER_SETTLEMENT_PROOF']),
  visibility: z.enum(['BUYER_VISIBLE', 'SELLER_VISIBLE', 'INTERNAL_ONLY']),
}).strict();

export const staffWorkItemsSchema = z.object({
  work_items: z.array(z.object({
    work_item_id: z.string(), work_type: workTypeSchema,
    source_entity_type: z.string(), source_entity_id: z.string(),
    buyer_customer_id: z.string().nullable(), seller_organization_id: z.string().nullable(),
    store_id: z.string().nullable(),
    duty_code: z.enum(['SELLER_ACCOUNT_MANAGER', 'BUYER_PRE_SALES_OWNER', 'BUYER_AFTER_SALES_OWNER', 'BUYER_REFUND_OWNER']),
    fixed_assignment_id: z.string(), assigned_staff_id: z.string(),
    status: workStatusSchema, version: z.number().int().positive(),
    created_at: epoch, updated_at: epoch, completed_at: epoch.nullable(), cancelled_at: epoch.nullable(),
  }).strict()),
  next_cursor: z.string().nullable(),
}).strict();

const workflow = z.object({
  work_item_id: z.string().nullable(), assigned_staff_id: z.string().nullable(),
  assigned_team_id: z.string().nullable(), fixed_assignment_id: z.string().nullable(),
}).strict();

export const staffOrderEvidenceSchema = z.object({ order_evidence: z.object({
  submission_id: z.string(), reservation_id: z.string(), marketplace: z.literal('JP'),
  status: z.enum(['PENDING_VERIFICATION', 'CHANGES_REQUESTED', 'VERIFIED', 'WITHDRAWN', 'CONSUMED']),
  version: z.number().int().positive(), evidence_version_no: z.number().int().positive(),
  amazon_order_number_raw: z.string(), amazon_order_number_normalized: z.string(),
  amazon_order_date: z.string().nullable(), final_paid_jpy: integerString,
  buyer_note: z.string().nullable(), public_change_reason: z.string().nullable(),
  submitted_at: epoch, updated_at: epoch, verified_at: epoch.nullable(), withdrawn_at: epoch.nullable(),
  buyer_customer_id: z.string(), internal_review_note: z.string().nullable(),
  verified_by_staff_id: z.string().nullable(), duplicate_signal_count: z.number().int().nonnegative(),
  reference_order_amount_jpy: integerString, price_difference_jpy: signedIntegerString,
  price_mismatch: z.boolean(), screenshot: safeFileSchema,
  buyer: z.object({ buyer_customer_id: z.string(), buyer_customer_no: z.string().nullable() }).strict(),
  instruction: z.object({ instruction_id: z.string(), instruction_version_id: z.string(),
    buyer_self_pay_bps: z.number().int().nonnegative(), buyer_self_pay_jpy: integerString,
    buyer_refundable_principal_jpy: integerString }).strict(),
  reservation: z.object({ reservation_id: z.string(), status: z.string(), version: z.number().int().positive() }).strict(),
  version_history: z.array(z.object({ evidence_version_id: z.string(), version_no: z.number().int().positive(), final_paid_jpy: integerString, submitted_at: epoch }).strict()),
  workflow,
}).strict() }).strict();

const reviewFile = z.object({
  file_object_id: z.string(), file_entity_link_id: z.string(), file_version: z.number().int().positive(),
  purpose: z.literal('REVIEW_EVIDENCE'), visibility: z.literal('SELLER_VISIBLE'),
  client_file_name: z.string(), mime: z.string(), byte_size: z.number().int().nonnegative(), verified_at: epoch,
}).strict();
const reviewEvidence = z.object({
  evidence_version_id: z.string(), version_no: z.number().int().positive(),
  review_type: z.enum(['RATING', 'TEXT', 'IMAGE', 'VIDEO']), review_url: z.string().nullable(),
  buyer_note: z.string().nullable(), submitted_by_buyer_id: z.string(), submitted_at: epoch,
  files: z.array(reviewFile),
}).strict();
export const staffReviewValueSchema = z.object({
  review_case_id: z.string(), formal_order_id: z.string(), buyer_customer_id: z.string(),
  seller_organization_id: z.string(), review_type: z.enum(['RATING', 'TEXT', 'IMAGE', 'VIDEO']),
  status: z.enum(['PENDING_REVIEW', 'CHANGES_REQUESTED', 'REJECTED', 'WITHDRAWN', 'APPROVED']),
  version: z.number().int().positive(), current_evidence_version_no: z.number().int().positive(),
  public_change_reason: z.string().nullable(), internal_review_note: z.string().nullable(),
  submitted_at: epoch, updated_at: epoch, decided_at: epoch.nullable(), current_evidence: reviewEvidence,
}).strict();
export const staffReviewSchema = z.object({ review: staffReviewValueSchema }).strict();

const refundBase = z.object({
  obligation_id: z.string(), buyer_customer_id: z.string(), formal_order_id: z.string(),
  due_amount_cny_fen: integerString, gross_paid_cny_fen: integerString,
  reversed_cny_fen: integerString, net_paid_cny_fen: integerString,
  outstanding_amount_cny_fen: integerString, overpaid_amount_cny_fen: integerString,
  status: z.enum(['DUE', 'PARTIALLY_PAID', 'PAID', 'OVERPAID']), version: z.number().int().positive(),
  created_at: epoch, updated_at: epoch,
  buyer: z.object({ buyer_customer_id: z.string(), buyer_customer_no: z.string().nullable() }).strict(),
  order: z.object({ formal_order_id: z.string(), marketplace: z.literal('JP'),
    amazon_order_number_normalized: z.string(), product_id: z.string(), asin: z.string() }).strict(),
  workflow,
}).strict();
export const staffBuyerRefundSchema = z.object({ buyer_refund: refundBase.extend({
  source_review_event_id: z.string(), review_case_id: z.string(),
  payments: z.array(z.object({ payment_entry_id: z.string(), amount_cny_fen: integerString,
    paid_at: epoch, china_business_date: z.string(),
    payment_channel: z.enum(['WECHAT', 'ALIPAY', 'BANK_TRANSFER', 'OTHER_MANUAL']),
    public_note: z.string().nullable(), internal_note: z.string().nullable(),
    proofs: z.array(safeFileSchema),
  }).strict()),
  reversals: z.array(z.object({ reversal_entry_id: z.string(), original_payment_entry_id: z.string(),
    amount_cny_fen: integerString, reversed_at: epoch, china_business_date: z.string(),
    payment_channel: z.enum(['WECHAT', 'ALIPAY', 'BANK_TRANSFER', 'OTHER_MANUAL']),
    public_note: z.string().nullable(), internal_note: z.string().nullable(),
  }).strict()),
}).strict() }).strict();

const refundLedgerMutation = z.object({
  obligation_id: z.string(), buyer_customer_id: z.string(), formal_order_id: z.string(),
  due_amount_cny_fen: integerString, net_paid_cny_fen: integerString,
  outstanding_amount_cny_fen: integerString, overpaid_amount_cny_fen: integerString,
  status: z.enum(['DUE', 'PARTIALLY_PAID', 'PAID', 'OVERPAID']), version: z.number().int().positive(),
}).strict();
export const refundPaymentMutationSchema = z.object({
  obligation: refundLedgerMutation,
  payment: z.object({ payment_entry_id: z.string(), amount_cny_fen: integerString,
    paid_at: epoch, china_business_date: z.string(),
    payment_channel: z.enum(['WECHAT', 'ALIPAY', 'BANK_TRANSFER', 'OTHER_MANUAL']),
    public_note: z.string().nullable(), internal_note: z.string().nullable(),
    proofs: z.array(safeFileSchema) }).strict(),
  replayed: z.boolean(),
}).strict();
export const refundReversalMutationSchema = z.object({
  obligation: refundLedgerMutation,
  reversal: z.object({ reversal_entry_id: z.string(), obligation_id: z.string(), entry_type: z.literal('REVERSAL'),
    original_payment_entry_id: z.string(), amount_cny_fen: integerString, reversed_at: epoch,
    china_business_date: z.string(), payment_channel: z.enum(['WECHAT', 'ALIPAY', 'BANK_TRANSFER', 'OTHER_MANUAL']),
    public_note: z.string().nullable() }).strict(),
  replayed: z.boolean(),
}).strict();

export const settlementSummarySchema = z.object({ settlement: z.object({
  outstanding_principal_cny_fen: integerString, outstanding_service_fee_cny_fen: integerString,
  total_outstanding_cny_fen: integerString, unallocated_credit_cny_fen: integerString,
}).strict() }).strict();
export const settlementPayablesSchema = z.object({
  items: z.array(z.object({ payable_id: z.string(), formal_order_id: z.string(),
    amazon_order_number: z.string(), store: z.object({ id: z.string(), display_name: z.string() }).strict(),
    product: z.object({ id: z.string(), asin: z.string(), name: z.string() }).strict(),
    payable_type: z.enum(['SELLER_PRINCIPAL', 'SELLER_SERVICE_FEE']),
    due_amount_cny_fen: integerString, paid_amount_cny_fen: integerString,
    outstanding_amount_cny_fen: integerString, status: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID']),
    due_at: epoch, created_at: epoch,
  }).strict()),
  page: z.object({ limit: z.number().int().positive(), next_cursor: z.string().nullable() }).strict(),
}).strict();

const settlementPaymentSchema = z.object({
  payment_id: z.string(), amount_cny_fen: integerString, paid_at: epoch,
  recorded_at: epoch, allocated_amount_cny_fen: integerString,
  unallocated_amount_cny_fen: integerString,
  status: z.enum(['REVERSED', 'UNALLOCATED', 'PARTIALLY_ALLOCATED', 'FULLY_ALLOCATED']),
  version: z.number().int().positive(),
  allocations: z.array(z.object({ allocation_id: z.string(), payable_id: z.string(),
    payable_type: z.enum(['SELLER_PRINCIPAL', 'SELLER_SERVICE_FEE']),
    allocated_amount_cny_fen: integerString, reversed_amount_cny_fen: integerString,
    net_amount_cny_fen: integerString, allocated_at: epoch }).strict()),
  proof: safeFileSchema.extend({
    purpose: z.literal('SELLER_SETTLEMENT_PROOF'), visibility: z.literal('INTERNAL_ONLY'),
  }).strict(),
}).strict();
export const settlementPaymentsSchema = z.object({
  items: z.array(settlementPaymentSchema),
  page: z.object({ limit: z.number().int().positive(), next_cursor: z.string().nullable() }).strict(),
}).strict();
export const settlementPaymentMutationSchema = z.object({
  payment: settlementPaymentSchema, replayed: z.boolean(),
}).strict();

export const invitationViewSchema = z.object({ invitation: z.object({
  invitation_id: z.string(), wechat_id: z.string(),
  marketplace_code: z.enum(['AMAZON_JP', 'AMAZON_US', 'COUPANG_KR']),
  issued_by_staff_id: z.string(), status: z.enum(['ACTIVE', 'CONSUMED', 'REVOKED', 'EXPIRED']),
  version: z.number().int().positive(), issued_at: epoch, expires_at: epoch,
  consumed_at: epoch.nullable(), revoked_at: epoch.nullable(),
}).strict() }).strict();

export type StaffWorkItem = z.output<typeof staffWorkItemsSchema>['work_items'][number];
export type StaffOrderEvidence = z.output<typeof staffOrderEvidenceSchema>['order_evidence'];
export type StaffReview = z.output<typeof staffReviewSchema>['review'];
export type StaffBuyerRefund = z.output<typeof staffBuyerRefundSchema>['buyer_refund'];
