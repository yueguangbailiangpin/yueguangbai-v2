import { z } from 'zod';
// Stage 7.5R-2: the buyer service channel + SafeFileReference runtime
// contracts live once in `@ygb/contracts` and are shared with the backend
// contract tests and the file read controller — no local duplicates. The
// historic local names stay available as re-exports of the same objects.
import {
  buyerServiceChannelSchema,
  buyerServiceChannelsResponseSchema,
  safeFileReferenceSchema,
} from '@ygb/contracts';

export {
  buyerServiceChannelSchema,
  buyerServiceChannelsResponseSchema as buyerServiceChannelsSchema,
  safeFileReferenceSchema,
};
export type BuyerServiceChannel =
  z.output<typeof buyerServiceChannelSchema>;

export const identifierSchema = z.string().min(1).max(120)
  .regex(/^[^\u0000-\u001f\u007f]+$/u);
export const positiveIntegerSchema = z.number().int().positive()
  .max(Number.MAX_SAFE_INTEGER);
export const nonnegativeIntegerSchema = z.number().int().nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export const integerAmountSchema = z.string().regex(/^(?:0|[1-9][0-9]*)$/u);
export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf())
      && date.toISOString().slice(0, 10) === value;
  });

const marketplace = z.literal('AMAZON_JP');
const reviewType = z.enum(['RATING', 'TEXT', 'IMAGE', 'VIDEO']);
const epoch = nonnegativeIntegerSchema;
const nullableEpoch = epoch.nullable();
const page = <T extends z.ZodType>(item: T) => z.object({
  items: z.array(item),
  next_cursor: z.string().min(1).nullable(),
}).strict();

export const buyerMeSchema = z.object({
  // Stage 7.5 batch 2: stage contact projection (public names only).
  assigned_contacts: z.object({
    pre_sales_owner_display_name: z.string().nullable().optional(),
    refund_owner_display_name: z.string().nullable().optional(),
  }).strict().optional(),
  buyer: z.object({
    display_name: z.string(),
    marketplace_code: marketplace,
    identity_review_status: z.enum(['CLEAR', 'REVIEW_REQUIRED']),
    customer_number: z.string().nullable(),
    refund_account_name: z.string().nullable(),
    refund_account_identifier: z.string().nullable(),
  }).strict(),
}).strict();

// Stage 7.5R: QR renders through the controlled read-intent chain
// (SafeFileReference) instead of a bare internal file id — schema shared
// from `@ygb/contracts` (see re-exports above).

export const demandSchema = z.object({
  demand_id: identifierSchema,
  demand_version: positiveIntegerSchema,
  marketplace_code: marketplace,
  product_name: z.string(),
  main_image: z.object({
    file_object_id: identifierSchema,
    file_version: positiveIntegerSchema,
    purpose: z.literal('PRODUCT_IMAGE'),
    visibility: z.literal('SELLER_VISIBLE'),
  }).strict().nullable(),
  reference_order_amount_jpy: integerAmountSchema,
  buyer_self_pay_bps: nonnegativeIntegerSchema.max(10_000),
  estimated_buyer_self_pay_jpy: integerAmountSchema,
  estimated_refundable_principal_jpy: integerAmountSchema,
  buyer_visible_notes: z.string().nullable(),
  store_display_name: z.string(),
  task_type: reviewType,
  target_quantity: positiveIntegerSchema,
  remaining_quantity: nonnegativeIntegerSchema,
  open_at: epoch,
  reservation_deadline: epoch,
  order_deadline: epoch,
  reservation_eligibility: z.enum([
    'ELIGIBLE',
    'INELIGIBLE_ACTIVE_STORE_RESERVATION',
  ]),
  reservation_ineligibility_reason: z.literal('ACTIVE_STORE_RESERVATION').nullable(),
}).strict();
export const demandsPageSchema = page(demandSchema);
export const demandDetailSchema = z.object({ demand: demandSchema }).strict();

const reservationDemandSchema = demandSchema.omit({
  target_quantity: true,
  remaining_quantity: true,
  open_at: true,
  main_image: true,
  reservation_eligibility: true,
  reservation_ineligibility_reason: true,
});
export const reservationSchema = z.object({
  reservation_id: identifierSchema,
  status: z.enum([
    'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED',
  ]),
  version: positiveIntegerSchema,
  submitted_at: epoch,
  updated_at: epoch,
  hold_expires_at: epoch,
  order_deadline_snapshot: epoch,
  buyer_self_pay_bps_snapshot: nonnegativeIntegerSchema.max(10_000),
  reference_order_amount_jpy_snapshot: integerAmountSchema,
  estimated_self_pay_jpy_snapshot: integerAmountSchema,
  estimated_refundable_principal_jpy_snapshot: integerAmountSchema,
  buyer_self_pay_accepted_at: epoch,
  buyer_self_pay_accepted_demand_version: positiveIntegerSchema,
  decided_at: nullableEpoch,
  cancelled_at: nullableEpoch,
  expired_at: nullableEpoch,
  can_cancel: z.boolean(),
  demand: reservationDemandSchema,
}).strict();
export const reservationsPageSchema = page(reservationSchema);
export const reservationDetailSchema = z.object({ reservation: reservationSchema }).strict();
export const reservationMutationSchema = z.object({
  reservation: reservationSchema,
  replayed: z.boolean(),
}).strict();

export const instructionStateSchema = z.object({
  status: z.enum(['UNPUBLISHED', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'COMPLETED']),
  instruction_version: positiveIntegerSchema,
  current_version_no: positiveIntegerSchema,
  initial_deadline_at: nullableEpoch,
  resubmission_deadline_at: nullableEpoch,
  evidence_status: z.enum([
    'NONE', 'NOT_SUBMITTED', 'PENDING_VERIFICATION', 'CHANGES_REQUESTED', 'VERIFIED',
    'WITHDRAWN', 'CONSUMED',
  ]),
  can_submit_evidence: z.boolean(),
  can_read_images: z.boolean(),
  content_updated: z.boolean(),
}).strict();
export const instructionStateResponseSchema = z.object({
  order_instruction: instructionStateSchema,
}).strict();
const instructionReadPathPrefix = '\\/api\\/buyer-portal\\/reservations\\/[A-Za-z0-9._~-]{1,120}'
  + '\\/order-instruction\\/images\\/';
export const instructionMainImageSchema = z.object({
  image_id: identifierSchema,
  position: z.null(),
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: positiveIntegerSchema.nullable(),
  height: positiveIntegerSchema.nullable(),
  read_intent_path: z.string().regex(new RegExp(`^${instructionReadPathPrefix}main\\/read-intent$`, 'u')),
}).strict();
export const instructionSchema = z.object({
  status: z.literal('ACTIVE'),
  instruction_version: positiveIntegerSchema,
  current_version_no: positiveIntegerSchema,
  evidence_status: z.enum([
    'NONE', 'NOT_SUBMITTED', 'PENDING_VERIFICATION', 'CHANGES_REQUESTED', 'VERIFIED',
    'WITHDRAWN', 'CONSUMED',
  ]),
  can_submit_evidence: z.boolean(),
  can_read_images: z.boolean(),
  product_name: z.string(),
  store_display_name: z.string(),
  search_keywords: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  color_spec_mode: z.enum(['MAIN_IMAGE_VARIANT', 'ANY_VARIANT']),
  staff_public_note: z.string().nullable(),
  buyer_visible_notes: z.string().nullable(),
  initial_deadline_at: nullableEpoch,
  resubmission_deadline_at: nullableEpoch,
  content_updated: z.boolean(),
  reference_order_amount_jpy: integerAmountSchema,
  buyer_self_pay_bps: nonnegativeIntegerSchema.max(10_000),
  estimated_buyer_self_pay_jpy: integerAmountSchema,
  estimated_refundable_principal_jpy: integerAmountSchema,
  main_image: instructionMainImageSchema,
}).strict();
export const instructionResponseSchema = z.object({
  order_instruction: instructionSchema,
}).strict();

const evidenceAction = z.enum(['SUBMIT', 'RESUBMIT', 'WITHDRAW']);
const evidenceReservationSchema = z.object({
  reservation_id: identifierSchema,
  demand_id: identifierSchema,
  marketplace_code: marketplace,
  product_name: z.string(),
  store_display_name: z.string(),
  review_type: reviewType,
  order_deadline: epoch,
}).strict();
export const eligibleEvidenceReservationSchema = evidenceReservationSchema.extend({
  current_order_evidence_status: z.enum([
    'PENDING_VERIFICATION', 'CHANGES_REQUESTED', 'VERIFIED', 'WITHDRAWN', 'CONSUMED',
  ]).nullable(),
  current_order_evidence_version: positiveIntegerSchema.nullable(),
  allowed_actions: z.array(evidenceAction),
}).strict();
const evidenceFileBase = z.object({
  file_object_id: identifierSchema,
  client_file_name: z.string(),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  byte_size: nonnegativeIntegerSchema,
  status: z.enum(['RESERVED', 'UPLOADING', 'UPLOADED', 'VERIFYING', 'VERIFIED', 'REJECTED', 'EXPIRED', 'DELETED']),
  visibility: z.enum(['INTERNAL_ONLY', 'BUYER_VISIBLE']),
  verified_at: nullableEpoch,
});
export const evidenceFileSchema = z.union([
  evidenceFileBase.extend({
    file_entity_link_id: identifierSchema,
    version: positiveIntegerSchema,
    allowed_actions: z.tuple([z.literal('CREATE_READ_INTENT')]),
  }).strict(),
  evidenceFileBase.extend({
    file_entity_link_id: z.null(),
    version: z.null(),
    allowed_actions: z.tuple([]),
  }).strict(),
]);
export const orderEvidenceSchema = z.object({
  submission_id: identifierSchema,
  reservation: evidenceReservationSchema,
  marketplace,
  amazon_order_number_display: z.string(),
  amazon_order_date: dateOnlySchema.nullable(),
  final_paid_jpy: nonnegativeIntegerSchema,
  buyer_self_pay_bps: nonnegativeIntegerSchema.max(10_000),
  buyer_self_pay_jpy: nonnegativeIntegerSchema,
  buyer_refundable_principal_jpy: nonnegativeIntegerSchema,
  price_mismatch: z.boolean(),
  price_difference_jpy: z.number().int().safe(),
  status: z.enum(['PENDING_VERIFICATION', 'CHANGES_REQUESTED', 'VERIFIED', 'WITHDRAWN', 'CONSUMED']),
  version: positiveIntegerSchema,
  evidence_version_no: positiveIntegerSchema,
  submitted_at: epoch,
  updated_at: epoch,
  verified_at: nullableEpoch,
  public_change_reason: z.string().nullable(),
  files: z.array(evidenceFileSchema),
  allowed_actions: z.array(evidenceAction),
}).strict().superRefine((evidence, context) => {
  if (evidence.price_mismatch !== (evidence.price_difference_jpy !== 0)) {
    context.addIssue({ code: 'custom', path: ['price_mismatch'], message: 'price_mismatch_difference_inconsistent' });
  }
});
export const eligibleEvidencePageSchema = page(eligibleEvidenceReservationSchema);
export const orderEvidencePageSchema = page(orderEvidenceSchema);
export const orderEvidenceDetailSchema = z.object({ order_evidence: orderEvidenceSchema }).strict();
export const orderEvidenceMutationSchema = z.object({
  order_evidence: orderEvidenceSchema,
  replayed: z.boolean(),
}).strict();

const rateSnapshotSchema = z.object({
  version_no: positiveIntegerSchema,
  business_date: dateOnlySchema,
  confirmed_at: epoch,
  cny_per_jpy_e8: integerAmountSchema,
}).strict();
export const formalOrderSchema = z.object({
  formal_order_id: identifierSchema,
  marketplace,
  amazon_order_number: z.string(),
  amazon_order_date: dateOnlySchema.nullable(),
  product_name: z.string(),
  review_type: reviewType,
  final_paid_jpy: integerAmountSchema,
  buyer_self_pay_bps: nonnegativeIntegerSchema.max(10_000),
  buyer_self_pay_jpy: integerAmountSchema,
  buyer_refundable_principal_jpy: integerAmountSchema,
  buyer_expected_principal_cny_fen: integerAmountSchema,
  buyer_exchange_rate_snapshot: rateSnapshotSchema,
  confirmed_at: epoch,
  confirmed_business_date: dateOnlySchema,
  status: z.literal('CONFIRMED'),
  order_evidence_summary: z.object({
    evidence_version_no: positiveIntegerSchema,
    submitted_at: epoch,
    verified_at: epoch,
    file_count: nonnegativeIntegerSchema,
  }).strict(),
}).strict();
export const formalOrdersPageSchema = page(formalOrderSchema);
export const formalOrderDetailSchema = z.object({ formal_order: formalOrderSchema }).strict();

const reviewOrderSchema = z.object({
  formal_order_id: identifierSchema,
  marketplace,
  amazon_order_number: z.string(),
  amazon_order_date: dateOnlySchema.nullable(),
  product_name: z.string(),
  review_type: reviewType,
  confirmed_at: epoch,
  confirmed_business_date: dateOnlySchema,
  status: z.literal('CONFIRMED'),
}).strict();
const reviewAction = z.enum(['SUBMIT', 'RESUBMIT', 'WITHDRAW']);
export const eligibleReviewOrderSchema = z.object({
  order: reviewOrderSchema,
  current_review: z.object({
    review_case_id: identifierSchema,
    status: z.enum(['PENDING_REVIEW', 'CHANGES_REQUESTED', 'REJECTED', 'WITHDRAWN', 'APPROVED']),
    version: positiveIntegerSchema,
  }).strict().nullable(),
  allowed_actions: z.array(reviewAction),
}).strict();
const reviewFileSchema = z.object({
  file_object_id: identifierSchema,
  file_entity_link_id: identifierSchema,
  client_file_name: z.string(),
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  byte_size: nonnegativeIntegerSchema,
  status: z.literal('VERIFIED'),
  version: positiveIntegerSchema,
  verified_at: epoch,
  allowed_actions: z.tuple([z.literal('CREATE_READ_INTENT')]),
}).strict();
export const reviewSchema = z.object({
  review_case_id: identifierSchema,
  order: reviewOrderSchema,
  review_type: reviewType,
  status: z.enum(['PENDING_REVIEW', 'CHANGES_REQUESTED', 'REJECTED', 'WITHDRAWN', 'APPROVED']),
  version: positiveIntegerSchema,
  current_evidence_version_no: positiveIntegerSchema,
  submitted_at: epoch,
  updated_at: epoch,
  public_change_reason: z.string().nullable(),
  review_url: z.string().url().nullable(),
  review_approved_at: nullableEpoch,
  buyer_refund_due: z.object({
    amount_cny_fen: integerAmountSchema,
  }).strict().nullable(),
  file_count: nonnegativeIntegerSchema,
  allowed_actions: z.array(reviewAction),
}).strict();
export const reviewDetailValueSchema = reviewSchema.extend({ files: z.array(reviewFileSchema) }).strict();
export const eligibleReviewOrdersPageSchema = page(eligibleReviewOrderSchema);
export const reviewsPageSchema = page(reviewSchema);
export const reviewDetailSchema = z.object({ review: reviewDetailValueSchema }).strict();
export const reviewMutationSchema = z.object({
  review: reviewDetailValueSchema,
  replayed: z.boolean(),
}).strict();

const refundBalanceSchema = z.object({
  due_amount_cny_fen: integerAmountSchema,
  net_paid_cny_fen: integerAmountSchema,
  remaining_amount_cny_fen: integerAmountSchema,
  overpaid_amount_cny_fen: integerAmountSchema,
  status: z.enum(['DUE', 'PARTIALLY_PAID', 'PAID', 'OVERPAID']),
}).strict();
const refundOrderSchema = z.object({
  formal_order_id: identifierSchema,
  marketplace,
  amazon_order_number: z.string(),
  product_name: z.string(),
  review_type: reviewType,
  status: z.literal('CONFIRMED'),
}).strict();
const refundReminderSchema = z.object({
  reminder_count: nonnegativeIntegerSchema,
  last_reminded_at: nullableEpoch,
  next_reminder_at: nullableEpoch,
}).strict();
export const refundSchema = refundBalanceSchema.extend({
  refund_obligation_id: identifierSchema,
  order: refundOrderSchema,
  reminder: refundReminderSchema,
  allowed_actions: z.tuple([]),
}).strict();
export const refundDetailValueSchema = refundSchema.extend({
  activities: z.array(z.object({
    activity_id: identifierSchema,
    activity_type: z.enum(['PAYMENT_RECORDED', 'PAYMENT_REVERSED']),
    amount_cny_fen: integerAmountSchema,
    occurred_at: epoch,
    payment_channel: z.enum(['ALIPAY', 'WECHAT_PAY', 'BANK_TRANSFER', 'OTHER']),
    balance_after: refundBalanceSchema,
  }).strict()),
}).strict();
export const refundsPageSchema = page(refundSchema);
export const refundDetailSchema = z.object({ refund: refundDetailValueSchema }).strict();
export const refundReminderMutationSchema = z.object({
  reminder: refundReminderSchema.extend({
    refund_obligation_id: identifierSchema,
    last_reminded_at: epoch,
    next_reminder_at: epoch,
  }).strict(),
  replayed: z.boolean(),
}).strict();

export const fileReadIntentSchema = z.object({
  read_intent_id: identifierSchema,
  file_object_id: identifierSchema,
  access_token: z.string().min(32).max(512).nullable(),
  access_token_available: z.boolean(),
  expires_at: epoch,
  replayed: z.boolean(),
}).strict();

export type Demand = z.output<typeof demandSchema>;
export type Reservation = z.output<typeof reservationSchema>;
export type OrderEvidence = z.output<typeof orderEvidenceSchema>;
export type FormalOrder = z.output<typeof formalOrderSchema>;
export type Review = z.output<typeof reviewSchema>;
export type Refund = z.output<typeof refundSchema>;
