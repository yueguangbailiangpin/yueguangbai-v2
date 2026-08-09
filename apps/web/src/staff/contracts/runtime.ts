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
const sellerPrincipalRatePolicyScopeSchema = z.enum([
  'CURRENCY_PAIR_DEFAULT', 'SELLER_ORGANIZATION',
]);
const sellerPrincipalRatePolicyVersionSchema = z.object({
  policy_version_id: z.string(),
  scope_type: sellerPrincipalRatePolicyScopeSchema,
  seller_organization_id: z.string().nullable(),
  source_currency_code: z.string(), quote_currency_code: z.literal('CNY'),
  version_no: z.number().int().positive(), decision_version: z.number().int().positive(),
  status: z.enum(['SUBMITTED', 'CONFIRMED', 'REJECTED']),
  markup_rate_value: z.string().regex(/^(0|[1-9][0-9]*)$/u),
  markup_rate_scale: z.string().regex(/^100000000$/u), effective_from: z.number().int().nonnegative(),
  submitted_at: z.number().int().nonnegative(), confirmed_at: z.number().int().nonnegative().nullable(),
  rejection_reason: z.string().nullable(), replayed: z.boolean(),
}).strict();
export const staffSellerPrincipalRatePolicySchema = z.object({
  source_currency_code: z.string(), quote_currency_code: z.literal('CNY'),
  seller_organization_id: z.string(),
  default_policy: sellerPrincipalRatePolicyVersionSchema.nullable(),
  seller_override_policy: sellerPrincipalRatePolicyVersionSchema.nullable(),
  default_pending_policy: sellerPrincipalRatePolicyVersionSchema.nullable(),
  seller_override_pending_policy: sellerPrincipalRatePolicyVersionSchema.nullable(),
  default_next_version: z.number().int().positive(),
  seller_override_next_version: z.number().int().positive(),
  selected_policy: sellerPrincipalRatePolicyVersionSchema.nullable(),
}).strict();
export const staffSellerPrincipalRatePolicyMutationSchema = z.object({
  policy: sellerPrincipalRatePolicyVersionSchema,
}).strict();
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

export const acquisitionChannelSchema = z.object({
  channel_id: z.string(), code: z.string(),
  channel_type: z.enum(['XIAOHONGSHU','PRIVATE_WECHAT','REFERRAL','OTHER']),
  display_name: z.string(), status: z.enum(['ACTIVE','DISABLED']),
  version: z.number().int().positive(), created_at: epoch, updated_at: epoch,
}).strict();
export const acquisitionAssignmentSchema = z.object({
  assignment_id: z.string(), staff_id: z.string(),
  lead_type: z.enum(['BUYER','SELLER']), channel_id: z.string(), channel_name: z.string(),
  effective_from: epoch, effective_until: epoch.nullable(),
  status: z.enum(['ACTIVE','REVOKED']), version: z.number().int().positive(),
}).strict();
export const acquisitionConsultationSchema = z.object({
  consultation_id: z.string(), channel_id: z.string(),
  lead_type: z.enum(['BUYER','SELLER']), business_date: z.string(),
  person_count: z.number().int().nonnegative(), version: z.number().int().positive(),
  updated_by_staff_id: z.string(), updated_at: epoch,
}).strict();
export const acquisitionConsultationEventSchema = z.object({
  event_id: z.string(), event_type: z.enum(['RECORDED','CORRECTED']),
  previous_count: z.number().int().nonnegative().nullable(),
  next_count: z.number().int().nonnegative(),
  previous_version: z.number().int().positive().nullable(),
  next_version: z.number().int().positive(), actor_staff_id: z.string(),
  reason: z.string(), created_at: epoch,
}).strict();
export const acquisitionLeadSchema = z.object({
  lead_id: z.string(), lead_type: z.enum(['BUYER','SELLER']), wechat_masked: z.string(),
  display_name: z.string().nullable(), note: z.string().nullable(),
  origin_channel_id: z.string(), origin_channel_name: z.string(),
  origin_staff_id: z.string(), current_owner_staff_id: z.string(),
  status: z.enum(['ACTIVE','INVALIDATED','ANONYMIZED']), version: z.number().int().positive(),
  created_business_date: z.string(), latest_followup_at: epoch, retention_due_at: epoch,
  retention_hold_reason: z.enum(['SECURITY','DISPUTE','LEGAL']).nullable(),
  registered: z.boolean(), reservation_submitted: z.boolean(), no_participation: z.boolean(),
  formal_order_count: z.number().int().nonnegative(), seller_cooperation: z.boolean(),
  created_at: epoch, updated_at: epoch,
}).strict();
const acquisitionFunnelBuyerSchema = z.object({
  consultation_count: z.number().int().nonnegative(), wechat_added_count: z.number().int().nonnegative(),
  registered_count: z.number().int().nonnegative(), reservation_submitted_count: z.number().int().nonnegative(),
  no_participation_count: z.number().int().nonnegative(), formal_order_count: z.number().int().nonnegative(),
  projected_gross_profit_cny_fen: signedIntegerString.nullable(),
  completed_gross_profit_cny_fen: signedIntegerString.nullable(),
}).strict();
export const acquisitionFunnelSchema = z.object({
  from_date: z.string(), to_date: z.string(), data_as_of: epoch,
  buyer: acquisitionFunnelBuyerSchema.nullable(),
  seller: z.object({ consultation_count: z.number().int().nonnegative(),
    wechat_added_count: z.number().int().nonnegative(), cooperation_count: z.number().int().nonnegative() }).strict().nullable(),
}).strict();

export type AcquisitionChannel = z.output<typeof acquisitionChannelSchema>;
export type AcquisitionAssignment = z.output<typeof acquisitionAssignmentSchema>;
export type AcquisitionConsultation = z.output<typeof acquisitionConsultationSchema>;
export type AcquisitionLead = z.output<typeof acquisitionLeadSchema>;

export const orderCadenceSchema = z.object({
  order_interval_days: z.number().int().positive(),
  orders_per_run: z.number().int().positive(),
}).strict();
export const staffProductListItemSchema = z.object({
  product_id: z.string(), seller_organization_id: z.string(),
  store_id: z.string(), store_name: z.string(), marketplace_code: z.string(),
  asin: z.string(), status: z.enum(['ACTIVE', 'DISABLED']),
  aggregate_version: z.number().int().positive(),
  current_version_no: z.number().int().positive(), product_name: z.string(),
  cadence: orderCadenceSchema.nullable(), updated_at: epoch,
}).strict();
export const staffProductPageSchema = z.object({ page: z.object({
  items: z.array(staffProductListItemSchema),
  next_cursor: z.string().nullable(), data_as_of: epoch,
}).strict() }).strict();
export const staffProductVersionSchema = z.object({
  product_version_id: z.string(), version_no: z.number().int().positive(),
  product_name: z.string(), search_keywords: z.array(z.string()),
  ordering_guide_expected_amount_jpy: z.number().int().nonnegative(),
  color_spec_mode: z.enum(['MAIN_IMAGE_VARIANT', 'ANY_VARIANT']),
  default_buyer_self_pay_bps: z.number().int().min(0).max(10_000),
  product_url: z.string().nullable(), buyer_visible_notes: z.string().nullable(),
  internal_notes: z.string().nullable(), cadence: orderCadenceSchema.nullable(),
  created_at: epoch,
}).strict();
export const staffProductDemandSchema = z.object({
  demand_batch_id: z.string(),
  status: z.enum(['SUBMITTED','PUBLISHED','REJECTED','WITHDRAWN','CLOSED']),
  target_quantity: z.number().int().positive(),
  effective_reservation_count: z.number().int().nonnegative(),
  order_deadline: epoch, demand_version: z.number().int().positive(),
  schedule_version: z.number().int().positive().nullable(),
  first_order_date: z.string().nullable(),
}).strict();
export const staffProductDetailSchema = z.object({ product:
  staffProductListItemSchema.extend({
    versions: z.array(staffProductVersionSchema),
    demands: z.array(staffProductDemandSchema),
    timezone: z.literal('Asia/Shanghai'), data_as_of: epoch,
  }).strict(),
}).strict();
export const demandReviewContextSchema = z.object({ review_context: z.object({
  demand_batch_id: z.string(), demand_version: z.number().int().positive(),
  status: z.literal('SUBMITTED'), seller_organization_id: z.string(),
  store_id: z.string(), product_id: z.string(),
  product_version_no: z.number().int().positive(), product_name: z.string(),
  task_type: z.enum(['RATING', 'TEXT', 'IMAGE', 'VIDEO']),
  target_quantity: z.number().int().positive(),
  reservation_deadline: epoch, order_deadline: epoch,
  cadence: orderCadenceSchema.nullable(), can_publish: z.boolean(),
  timezone: z.literal('Asia/Shanghai'),
  data_as_of: epoch,
}).strict() }).strict();
export const demandOrderScheduleVersionSchema = orderCadenceSchema.extend({
  schedule_version_id: z.string(), version_no: z.number().int().positive(),
  demand_version: z.number().int().positive(), first_order_date: z.string(),
  theoretical_last_order_date: z.string(),
  affected_reservation_count: z.number().int().nonnegative(),
  preview_hash: z.string().regex(/^[0-9a-f]{64}$/u), change_reason: z.string(),
  changed_by_staff_id: z.string(), created_at: epoch,
}).strict();
export const staffReservationSchedulePageSchema = z.object({ page: z.object({
  demand: z.object({
    demand_batch_id: z.string(), product_id: z.string(), product_name: z.string(),
    target_quantity: z.number().int().positive(),
    effective_reservation_count: z.number().int().nonnegative(),
    order_deadline: epoch, demand_version: z.number().int().positive(),
    schedule: demandOrderScheduleVersionSchema.nullable(),
  }).strict(),
  items: z.array(z.object({
    reservation_id: z.string(),
    status: z.enum(['PENDING_REVIEW','APPROVED','REJECTED','CANCELLED','EXPIRED']),
    submitted_at: epoch, rank: z.number().int().positive().nullable(),
    planned_order_date: z.string().nullable(), buyer_reference: z.string(),
    buyer_customer_id: z.string().nullable(), buyer_display_name: z.string().nullable(),
    actual_order_status: z.string().nullable(), actual_order_date: z.string().nullable(),
  }).strict()),
  next_cursor: z.string().nullable(), timezone: z.literal('Asia/Shanghai'),
  sorting: z.literal('submitted_at ASC, id ASC'), data_as_of: epoch,
}).strict() }).strict();
export const demandSchedulePreviewSchema = z.object({ preview:
  orderCadenceSchema.extend({
    demand_batch_id: z.string(), expected_version: z.number().int().positive(),
    current_schedule_version: z.number().int().positive().nullable(),
    first_order_date: z.string(), theoretical_last_order_date: z.string(),
    order_deadline_date: z.string(),
    effective_reservation_count: z.number().int().nonnegative(),
    affected_reservation_count: z.number().int().nonnegative(),
    before_first_order_date: z.string().nullable(),
    before_theoretical_last_order_date: z.string().nullable(),
    preview_hash: z.string().regex(/^[0-9a-f]{64}$/u),
    timezone: z.literal('Asia/Shanghai'), data_as_of: epoch,
  }).strict(),
}).strict();
export const demandScheduleConfirmationSchema = z.object({
  schedule_confirmation: z.object({
    demand_batch_id: z.string(), demand_version: z.number().int().positive(),
    schedule: demandOrderScheduleVersionSchema, replayed: z.boolean(),
  }).strict(),
}).strict();
export const demandReviewMutationSchema = z.object({ demand_review: z.object({
  demand_batch_id: z.string(), status: z.enum(['PUBLISHED','REJECTED']),
  version: z.number().int().positive(), review_reason: z.string().nullable(),
  schedule: demandOrderScheduleVersionSchema.nullable(), replayed: z.boolean(),
}).strict() }).strict();
export const productVersionMutationSchema = z.object({ product_version: z.object({
  product_id: z.string(), product_version_id: z.string(),
  version_no: z.number().int().positive(), aggregate_version: z.number().int().positive(),
  product_version: z.object({
    productName: z.string(), searchKeywords: z.array(z.string()),
    orderingGuideExpectedAmountJpy: z.number().int().nonnegative(),
    colorSpecMode: z.enum(['MAIN_IMAGE_VARIANT','ANY_VARIANT']),
    defaultBuyerSelfPayBps: z.number().int().min(0).max(10_000),
    productUrl: z.string().nullable(), buyerVisibleNotes: z.string().nullable(),
    internalNotes: z.string().nullable(), orderIntervalDays: z.number().int().positive(),
    ordersPerRun: z.number().int().positive(),
  }).strict(),
  replayed: z.boolean(),
}).strict() }).strict();

export type StaffProduct = z.output<typeof staffProductListItemSchema>;
export type StaffProductDetail = z.output<typeof staffProductDetailSchema>['product'];
export type DemandReviewContext = z.output<typeof demandReviewContextSchema>['review_context'];
export type StaffReservationSchedulePage = z.output<typeof staffReservationSchedulePageSchema>['page'];
export type DemandSchedulePreview = z.output<typeof demandSchedulePreviewSchema>['preview'];

export const dashboardProfitSchema = z.object({
  amount_cny_fen: signedIntegerString,
  valid_order_count: z.number().int().nonnegative(),
  conflict_order_count: z.number().int().nonnegative(),
}).strict();
const dashboardStageSchema = z.object({
  code: z.string(), label: z.string(), count: z.number().int().nonnegative(),
  conversion_rate_bps: z.number().int().min(0).max(10_000).nullable(),
}).strict();
const dashboardPerformanceSchema = z.object({
  dimension_id: z.string(), dimension_name: z.string(),
  buyer_lead_count: z.number().int().nonnegative(),
  buyer_registered_count: z.number().int().nonnegative(),
  buyer_reservation_count: z.number().int().nonnegative(),
  buyer_formal_order_count: z.number().int().nonnegative(),
  buyer_business_completed_count: z.number().int().nonnegative(),
  buyer_no_participation_count: z.number().int().nonnegative(),
  seller_lead_count: z.number().int().nonnegative(),
  seller_cooperation_count: z.number().int().nonnegative(),
  current_owner_active_lead_count: z.number().int().nonnegative().nullable(),
  consultation_count: z.number().int().nonnegative().nullable(),
  projected_profit: dashboardProfitSchema,
  completed_profit: dashboardProfitSchema,
}).strict();
export const adminDashboardSummarySchema = z.object({ summary: z.object({
  window: z.object({ key: z.enum(['TODAY','WEEK','MONTH']), from_date: z.string(),
    to_date: z.string(), timezone: z.literal('Asia/Shanghai'), data_as_of: epoch }).strict(),
  cards: z.object({ new_buyers: z.number().int().nonnegative(),
    reservations: z.number().int().nonnegative(), formal_orders: z.number().int().nonnegative(),
    business_completions: z.number().int().nonnegative() }).strict(),
  buyer_funnel: z.object({ stages: z.array(dashboardStageSchema),
    no_participation_count: z.number().int().nonnegative() }).strict(),
  seller_funnel: z.object({ stages: z.array(dashboardStageSchema) }).strict(),
  projected_profit: dashboardProfitSchema, completed_profit: dashboardProfitSchema,
  staff_performance: z.array(dashboardPerformanceSchema),
  channel_performance: z.array(dashboardPerformanceSchema),
}).strict() }).strict();
const trendPointSchema = z.object({
  from_date: z.string(), to_date: z.string(), new_buyers: z.number().int().nonnegative(),
  reservations: z.number().int().nonnegative(), formal_orders: z.number().int().nonnegative(),
  business_completions: z.number().int().nonnegative(),
  projected_profit: dashboardProfitSchema, completed_profit: dashboardProfitSchema,
}).strict();
export const adminDashboardTrendSchema = z.object({ trend: z.object({
  granularity: z.enum(['DAY','WEEK','MONTH']), from_date: z.string(), to_date: z.string(),
  timezone: z.literal('Asia/Shanghai'), data_as_of: epoch, points: z.array(trendPointSchema),
}).strict() }).strict();
export const adminDashboardDrillDownSchema = z.object({ drill_down: z.object({
  metric: z.enum(['NEW_BUYERS','RESERVATIONS','FORMAL_ORDERS','BUSINESS_COMPLETIONS',
    'PROJECTED_PROFIT_CONFLICTS','COMPLETED_PROFIT_CONFLICTS']),
  from_date: z.string(), to_date: z.string(), timezone: z.literal('Asia/Shanghai'),
  data_as_of: epoch, items: z.array(z.object({ reference_id: z.string(),
    business_date: z.string(), status: z.string() }).strict()), next_cursor: z.string().nullable(),
}).strict() }).strict();

export type AdminDashboardSummary = z.output<typeof adminDashboardSummarySchema>['summary'];

const staffAccessRoleSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('owner'), display_name: z.literal('总管理员') }).strict(),
  z.object({ code: z.literal('pre_sales'), display_name: z.literal('售前') }).strict(),
  z.object({ code: z.literal('seller_ops'), display_name: z.literal('卖家对接') }).strict(),
  z.object({ code: z.literal('buyer_refund'), display_name: z.literal('买家返款') }).strict(),
]);
const staffAccessTeamSchema = z.object({
  team_id: z.string(), team_name: z.string(), department_name: z.string(),
}).strict();
export const staffAccessEmployeeSchema = z.object({
  staff_id: z.string(), display_name: z.string(),
  status: z.enum(['ACTIVE', 'DISABLED']), version: z.number().int().positive(),
  role: staffAccessRoleSchema,
  feishu_binding: z.object({
    status: z.enum(['ACTIVE', 'REVOKED', 'MISSING']),
    verified_at: epoch.nullable(),
  }).strict(),
  updated_at: epoch,
}).strict();
export const staffBindingInvitationSchema = z.object({
  invitation_id: z.string(), display_name: z.string(), role: staffAccessRoleSchema,
  team: staffAccessTeamSchema.nullable(),
  status: z.enum(['ISSUED', 'CONSUMED', 'CANCELLED', 'EXPIRED']),
  version: z.number().int().positive(), issued_at: epoch, expires_at: epoch,
  consumed_at: epoch.nullable(), cancelled_at: epoch.nullable(),
}).strict();
export const staffAccessOverviewSchema = z.object({
  employees: z.array(staffAccessEmployeeSchema),
  invitations: z.array(staffBindingInvitationSchema),
  available_teams: z.array(staffAccessTeamSchema),
}).strict();
export const createStaffBindingInvitationSchema = z.object({
  invitation: staffBindingInvitationSchema,
  invitation_path: z.string().nullable(), replayed: z.boolean(),
}).strict();
export const cancelStaffBindingInvitationSchema = z.object({
  invitation: staffBindingInvitationSchema, replayed: z.boolean(),
}).strict();
export const staffAccessMutationSchema = z.object({
  employee: staffAccessEmployeeSchema, replayed: z.boolean(),
}).strict();

export type StaffAccessEmployee = z.output<typeof staffAccessEmployeeSchema>;
export type StaffBindingInvitation = z.output<typeof staffBindingInvitationSchema>;
