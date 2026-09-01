import type { FixedIntegerString } from './pricing';
import type { SellerPayableType } from './seller-settlement';

/**
 * Stage 7.5 batch 3: immutable seller settlement batches. DRAFT/CONFIRMED/
 * CANCELLED are stored transitions; PARTIALLY_PAID/PAID are derived at read
 * time from the live payment ledger — batches never copy payment facts.
 */

export const SELLER_SETTLEMENT_BATCH_STATUSES = [
  'DRAFT',
  'CONFIRMED',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
] as const;
export type SellerSettlementBatchStatus = typeof SELLER_SETTLEMENT_BATCH_STATUSES[number];

export interface SellerSettlementBatchMemberDto {
  member_id: string;
  payable_id: string;
  formal_order_id: string;
  amazon_order_number: string;
  payable_type: SellerPayableType;
  frozen_amount_cny_fen: FixedIntegerString;
  paid_amount_cny_fen: FixedIntegerString;
  outstanding_amount_cny_fen: FixedIntegerString;
}

export interface SellerSettlementBatchDto {
  batch_id: string;
  seller_organization_id: string;
  status: SellerSettlementBatchStatus;
  frozen_total_cny_fen: FixedIntegerString;
  frozen_payable_count: number;
  paid_amount_cny_fen: FixedIntegerString;
  outstanding_amount_cny_fen: FixedIntegerString;
  version: number;
  created_at: number;
  confirmed_at: number | null;
  cancelled_at: number | null;
  cancel_reason: string | null;
}

export interface SellerSettlementBatchDetailDto extends SellerSettlementBatchDto {
  members: readonly SellerSettlementBatchMemberDto[];
  members_next_cursor: string | null;
}

export interface SellerSettlementBatchPageDto {
  batches: readonly SellerSettlementBatchDto[];
  next_cursor: string | null;
}

/**
 * Stage 7.5R seller-portal projections: one shared contract for the backend
 * route and the frontend strict schema — no passthrough, no internal staff
 * ids, no version/cancel metadata, no buyer-refund facts. Sellers never see
 * DRAFT/CANCELLED batches (filtered in SQL before pagination).
 */
export type SellerPortalSettlementBatchStatus =
  'CONFIRMED' | 'PARTIALLY_PAID' | 'PAID';

export interface SellerPortalSettlementBatchDto {
  batch_id: string;
  status: SellerPortalSettlementBatchStatus;
  frozen_total_cny_fen: FixedIntegerString;
  frozen_payable_count: number;
  paid_amount_cny_fen: FixedIntegerString;
  outstanding_amount_cny_fen: FixedIntegerString;
  confirmed_at: number;
}

export interface SellerPortalSettlementBatchMemberDto {
  amazon_order_number: string;
  payable_type: SellerPayableType;
  frozen_amount_cny_fen: FixedIntegerString;
  paid_amount_cny_fen: FixedIntegerString;
  outstanding_amount_cny_fen: FixedIntegerString;
}

export interface SellerPortalSettlementBatchDetailDto
  extends SellerPortalSettlementBatchDto {
  members: readonly SellerPortalSettlementBatchMemberDto[];
  members_next_cursor: string | null;
}

export interface SellerPortalSettlementBatchPageDto {
  batches: readonly SellerPortalSettlementBatchDto[];
  next_cursor: string | null;
}

export interface CreateSellerSettlementBatchRequest {
  reason: string | null;
}

export interface AddSellerSettlementBatchMembersRequest {
  payable_ids: readonly string[];
  expected_version: number;
  reason: string;
}

export interface RemoveSellerSettlementBatchMemberRequest {
  reason: string;
  expected_version: number;
}

export interface ConfirmSellerSettlementBatchRequest {
  expected_version: number;
  reason: string;
}

export interface CancelSellerSettlementBatchRequest {
  reason: string;
  expected_version: number;
}

export interface SellerSettlementBatchMutationDto {
  batch: SellerSettlementBatchDto;
  replayed: boolean;
}

export interface SellerSettlementBatchExportReceiptDto {
  batch_id: string;
  row_count: number;
  sha256: string;
  exported_at: number;
  replayed: boolean;
}
