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
}

export interface StaffBuyerRefundListItemDto {
  obligation_id: string;
  buyer_customer_id: string;
  formal_order_id: string;
  due_amount_cny_fen: string;
  net_paid_cny_fen: string;
  outstanding_amount_cny_fen: string;
  overpaid_amount_cny_fen: string;
  status: BuyerRefundStatus;
  version: number;
}

export interface StaffBuyerRefundPaymentDto {
  payment_entry_id: string;
  amount_cny_fen: string;
  paid_at: number;
  china_business_date: string;
  payment_channel: BuyerRefundPaymentChannel;
  public_note: string | null;
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
}

export interface StaffBuyerRefundDetailDto
  extends StaffBuyerRefundListItemDto {
  source_review_event_id: string;
  review_case_id: string;
  gross_paid_cny_fen: string;
  reversed_cny_fen: string;
  payments: readonly StaffBuyerRefundPaymentDto[];
  reversals: readonly StaffBuyerRefundReversalDto[];
}

export interface RecordStaffBuyerRefundPaymentRequest {
  expected_version: number;
  amount_cny_fen: string;
  paid_at: number;
  payment_channel: BuyerRefundPaymentChannel;
  public_note?: string;
  proof_file_object_ids?: readonly string[];
}

export interface ReverseStaffBuyerRefundPaymentRequest {
  expected_version: number;
  amount_cny_fen: string;
  reversed_at: number;
  reason: string;
}
