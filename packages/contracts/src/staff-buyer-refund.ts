import type {
  BuyerRefundPaymentChannel,
  BuyerRefundStatus,
} from './buyer-refund';
import type { SafeFileReferenceDto } from './file-http';

export const STAFF_BUYER_REFUND_PATHS = Object.freeze({
  list: '/api/staff/buyer-refunds',
  detail: '/api/staff/buyer-refunds/:id',
  payment: '/api/staff/buyer-refunds/:id/payments',
  reversal:
    '/api/staff/buyer-refunds/:id/payments/:paymentEntryId/reversals',
} as const);

export interface StaffBuyerRefundListQuery {
  limit?: number;
  cursor?: string;
  status?: BuyerRefundStatus;
  from?: string;
  to?: string;
}

export interface StaffBuyerRefundListItemDto {
  obligation_id: string;
  buyer_customer_id: string;
  formal_order_id: string;
  due_amount_cny_fen: string;
  gross_paid_cny_fen: string;
  reversed_cny_fen: string;
  net_paid_cny_fen: string;
  outstanding_amount_cny_fen: string;
  overpaid_amount_cny_fen: string;
  status: BuyerRefundStatus;
  version: number;
  created_at: number;
  updated_at: number;
  buyer: StaffBuyerRefundBuyerSummaryDto;
  order: StaffBuyerRefundOrderSummaryDto;
  workflow: StaffBuyerRefundWorkflowDto;
}

export interface StaffBuyerRefundBuyerSummaryDto {
  buyer_customer_id: string;
  buyer_customer_no: string | null;
}

export interface StaffBuyerRefundOrderSummaryDto {
  formal_order_id: string;
  marketplace: 'JP';
  amazon_order_number_normalized: string;
  product_id: string;
  asin: string;
}

export interface StaffBuyerRefundWorkflowDto {
  work_item_id: string | null;
  assigned_staff_id: string | null;
  assigned_team_id: string | null;
  fixed_assignment_id: string | null;
}

export interface StaffBuyerRefundPaymentDto {
  payment_entry_id: string;
  amount_cny_fen: string;
  paid_at: number;
  china_business_date: string;
  payment_channel: BuyerRefundPaymentChannel;
  public_note: string | null;
  internal_note: string | null;
  proofs: readonly SafeFileReferenceDto[];
}

export interface StaffBuyerRefundReversalDto {
  reversal_entry_id: string;
  original_payment_entry_id: string;
  amount_cny_fen: string;
  reversed_at: number;
  china_business_date: string;
  payment_channel: BuyerRefundPaymentChannel;
  public_note: string | null;
  internal_note: string | null;
}

export interface StaffBuyerRefundDetailDto
  extends StaffBuyerRefundListItemDto {
  source_review_event_id: string;
  review_case_id: string;
  payments: readonly StaffBuyerRefundPaymentDto[];
  reversals: readonly StaffBuyerRefundReversalDto[];
}

export interface StaffBuyerRefundProofInput {
  file_object_id: string;
  expected_file_version: number;
}

export interface RecordStaffBuyerRefundPaymentRequest {
  expected_version: number;
  amount_cny_fen: string;
  paid_at: number;
  china_business_date: string;
  payment_channel: BuyerRefundPaymentChannel;
  public_note?: string;
  internal_note?: string;
  proof_files: readonly StaffBuyerRefundProofInput[];
}

export interface ReverseStaffBuyerRefundPaymentRequest {
  expected_version: number;
  amount_cny_fen: string;
  reversed_at: number;
  reason: string;
  internal_note?: string;
}
