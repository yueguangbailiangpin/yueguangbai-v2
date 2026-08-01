import type { FixedIntegerString } from './pricing';

export const BUYER_REFUND_STATUSES = [
  'DUE',
  'PARTIALLY_PAID',
  'PAID',
  'OVERPAID',
] as const;

export type BuyerRefundStatus = typeof BUYER_REFUND_STATUSES[number];

export const BUYER_REFUND_PAYMENT_CHANNELS = [
  'WECHAT',
  'ALIPAY',
  'BANK_TRANSFER',
  'OTHER_MANUAL',
] as const;

export type BuyerRefundPaymentChannel =
  typeof BUYER_REFUND_PAYMENT_CHANNELS[number];

export const BUYER_REFUND_ENTRY_TYPES = [
  'PAYMENT',
  'REVERSAL',
] as const;

export type BuyerRefundEntryType =
  typeof BUYER_REFUND_ENTRY_TYPES[number];

export const BUYER_REFUND_EVENT_TYPES = [
  'BUYER_REFUND_OBLIGATION_CREATED',
  'BUYER_REFUND_PAYMENT_RECORDED',
  'BUYER_REFUND_PAYMENT_REVERSED',
] as const;

export type BuyerRefundEventType =
  typeof BUYER_REFUND_EVENT_TYPES[number];

export interface BuyerRefundProofFileInput {
  fileObjectId: string;
  expectedFileVersion: number;
}

export interface BuyerRefundProofFileProjection {
  file_object_id: string;
  file_entity_link_id: string;
}

export interface BuyerRefundLedgerProjection {
  obligation_id: string;
  source_review_event_id: string;
  review_case_id: string;
  formal_order_id: string;
  buyer_customer_id: string;
  due_amount_cny_fen: FixedIntegerString;
  gross_paid_cny_fen: FixedIntegerString;
  reversed_cny_fen: FixedIntegerString;
  net_paid_cny_fen: FixedIntegerString;
  status: BuyerRefundStatus;
  version: number;
}

export interface EnsureBuyerRefundObligationResult
extends BuyerRefundLedgerProjection {
  replayed: boolean;
}

export interface BuyerRefundPaymentEntryProjection {
  payment_entry_id: string;
  obligation_id: string;
  entry_type: 'PAYMENT';
  amount_cny_fen: FixedIntegerString;
  paid_at: number;
  china_business_date: string;
  payment_channel: BuyerRefundPaymentChannel;
  public_note: string | null;
  proof_files: readonly BuyerRefundProofFileProjection[];
}

export interface RecordBuyerRefundPaymentResult {
  obligation: BuyerRefundLedgerProjection;
  payment: BuyerRefundPaymentEntryProjection;
  replayed: boolean;
}

export interface BuyerRefundReversalEntryProjection {
  reversal_entry_id: string;
  obligation_id: string;
  entry_type: 'REVERSAL';
  original_payment_entry_id: string;
  amount_cny_fen: FixedIntegerString;
  reversed_at: number;
  china_business_date: string;
  payment_channel: BuyerRefundPaymentChannel;
  public_note: string | null;
}

export interface ReverseBuyerRefundPaymentResult {
  obligation: BuyerRefundLedgerProjection;
  reversal: BuyerRefundReversalEntryProjection;
  replayed: boolean;
}

export function isBuyerRefundStatus(
  value: unknown,
): value is BuyerRefundStatus {
  return typeof value === 'string'
    && (BUYER_REFUND_STATUSES as readonly string[]).includes(value);
}

export function isBuyerRefundPaymentChannel(
  value: unknown,
): value is BuyerRefundPaymentChannel {
  return typeof value === 'string'
    && (BUYER_REFUND_PAYMENT_CHANNELS as readonly string[]).includes(value);
}
