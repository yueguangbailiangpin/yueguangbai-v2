import type { FixedIntegerString } from './pricing';
import type { SafeFileReferenceDto } from './file-http';
import type { SellerPortalPage } from './seller-portal';

export const SELLER_PAYABLE_TYPES = [
  'SELLER_PRINCIPAL',
  'SELLER_SERVICE_FEE',
] as const;
export type SellerPayableType = typeof SELLER_PAYABLE_TYPES[number];

export const SELLER_PAYABLE_STATUSES = [
  'UNPAID',
  'PARTIALLY_PAID',
  'PAID',
] as const;
export type SellerPayableStatus = typeof SELLER_PAYABLE_STATUSES[number];

export const SELLER_PAYMENT_STATUSES = [
  'REVERSED',
  'UNALLOCATED',
  'PARTIALLY_ALLOCATED',
  'FULLY_ALLOCATED',
] as const;
export type SellerPaymentStatus = typeof SELLER_PAYMENT_STATUSES[number];

export interface SellerSettlementStoreSummaryDto {
  id: string;
  display_name: string;
}

export interface SellerSettlementProductSummaryDto {
  id: string;
  asin: string;
  name: string;
}

export interface SellerPayableDto {
  payable_id: string;
  formal_order_id: string;
  amazon_order_number: string;
  store: SellerSettlementStoreSummaryDto;
  product: SellerSettlementProductSummaryDto;
  payable_type: SellerPayableType;
  due_amount_cny_fen: FixedIntegerString;
  paid_amount_cny_fen: FixedIntegerString;
  outstanding_amount_cny_fen: FixedIntegerString;
  status: SellerPayableStatus;
  due_at: number;
  created_at: number;
}

export interface SellerPaymentAllocationSummaryDto {
  allocation_id: string;
  payable_id: string;
  payable_type: SellerPayableType;
  allocated_amount_cny_fen: FixedIntegerString;
  reversed_amount_cny_fen: FixedIntegerString;
  net_amount_cny_fen: FixedIntegerString;
  allocated_at: number;
}

export interface SellerPaymentDto {
  payment_id: string;
  amount_cny_fen: FixedIntegerString;
  paid_at: number;
  recorded_at: number;
  allocated_amount_cny_fen: FixedIntegerString;
  unallocated_amount_cny_fen: FixedIntegerString;
  status: SellerPaymentStatus;
  version: number;
  allocations: readonly SellerPaymentAllocationSummaryDto[];
}

export interface StaffSellerPaymentDto extends SellerPaymentDto {
  proof: SafeFileReferenceDto;
}

export type StaffSellerPaymentPageDto = SellerPortalPage<StaffSellerPaymentDto>;

export interface SellerSettlementSummaryDto {
  outstanding_principal_cny_fen: FixedIntegerString;
  outstanding_service_fee_cny_fen: FixedIntegerString;
  total_outstanding_cny_fen: FixedIntegerString;
  unallocated_credit_cny_fen: FixedIntegerString;
  /** 卖家结算收款人姓名（P16；null = 未填写，员工结算面板提示后补）。 */
  settlement_account_name: string | null;
  /** 卖家结算收款支付宝账号（P16；null = 未填写）。 */
  settlement_account_identifier: string | null;
}

export type SellerPayablePageDto = SellerPortalPage<SellerPayableDto>;
export type SellerPaymentPageDto = SellerPortalPage<SellerPaymentDto>;

export interface SellerSettlementProofFileRequest {
  file_object_id: string;
  expected_file_version: number;
}

export interface RecordSellerPaymentRequest {
  seller_organization_id: string;
  amount_cny_fen: FixedIntegerString;
  paid_at: number;
  proof_file: SellerSettlementProofFileRequest;
}

export interface CorrectSellerPaymentPaidAtRequest {
  expected_version: number;
  paid_at: number;
  reason: string;
}

export interface AllocateSellerPaymentRequest {
  payable_id: string;
  amount_cny_fen: FixedIntegerString;
  expected_payment_version: number;
}

export interface ReverseSellerAllocationRequest {
  amount_cny_fen: FixedIntegerString;
  reason: string;
  expected_payment_version: number;
}

export interface ReallocateSellerAllocationRequest {
  target_payable_id: string;
  amount_cny_fen: FixedIntegerString;
  reason: string;
  expected_payment_version: number;
}

export interface ReverseSellerPaymentRequest {
  reason: string;
  expected_version: number;
}

export interface SellerPaymentMutationDto {
  payment: SellerPaymentDto;
  replayed: boolean;
}

export interface SellerPayableReconciliationResultDto {
  scanned_count: number;
  created_count: number;
  conflict_count: number;
  next_cursor: string | null;
  replayed: boolean;
}

export interface SellerPayableReconciliationConflictDto {
  conflict_id: string;
  entity_type: 'FORMAL_ORDER' | 'REVIEW_CASE';
  entity_id: string;
  reason_code:
    | 'FINANCIAL_SNAPSHOT_MISSING'
    | 'FINANCIAL_SNAPSHOT_MULTIPLE'
    | 'REVIEW_APPROVAL_SOURCE_CONFLICT'
    | 'SELLER_ORGANIZATION_MISMATCH'
    | 'SOURCE_RELATION_CONFLICT';
  detected_at: number;
}

export function isSellerPayableType(value: unknown): value is SellerPayableType {
  return typeof value === 'string'
    && (SELLER_PAYABLE_TYPES as readonly string[]).includes(value);
}

export function isSellerPayableStatus(value: unknown): value is SellerPayableStatus {
  return typeof value === 'string'
    && (SELLER_PAYABLE_STATUSES as readonly string[]).includes(value);
}

export function isSellerPaymentStatus(value: unknown): value is SellerPaymentStatus {
  return typeof value === 'string'
    && (SELLER_PAYMENT_STATUSES as readonly string[]).includes(value);
}
