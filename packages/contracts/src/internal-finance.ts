import type { FixedIntegerString, PricingReviewType } from './pricing';

/** Base-10 signed integer encoded as a JSON-safe string. */
export type SignedIntegerString = string;

export const FINANCE_DATE_BASES = ['CONFIRMED', 'APPROVED', 'CASH'] as const;
export type FinanceDateBasis = typeof FINANCE_DATE_BASES[number];

export const ORDER_FINANCE_DATE_BASES = ['CONFIRMED', 'APPROVED'] as const;
export type OrderFinanceDateBasis = typeof ORDER_FINANCE_DATE_BASES[number];

export const FINANCE_GROUP_BYS = [
  'SELLER_ORGANIZATION', 'STORE', 'PRODUCT', 'ASIN', 'DAY', 'MONTH',
] as const;
export type FinanceGroupBy = typeof FINANCE_GROUP_BYS[number];

export const FINANCE_STATUSES = [
  'PROJECTED_ONLY',
  'COMPLETED',
  'MISSING_FINANCIAL_SNAPSHOT',
  'MULTIPLE_FINANCIAL_SNAPSHOTS',
  'MISSING_PRINCIPAL_PAYABLE',
  'MISSING_SERVICE_FEE_PAYABLE',
  'MISSING_BUYER_REFUND_OBLIGATION',
  'REVIEW_APPROVAL_CONFLICT',
  'SELLER_ORGANIZATION_MISMATCH',
  'AMOUNT_MISMATCH',
  'LEDGER_CONFLICT',
] as const;
export type FinanceStatus = typeof FINANCE_STATUSES[number];

export const FINANCIAL_EXPORT_TYPES = [
  'ORDER_DETAIL',
  'SELLER_SUMMARY',
  'STORE_SUMMARY',
  'PRODUCT_SUMMARY',
  'ASIN_SUMMARY',
  'MONTHLY_SUMMARY',
  'CASH_FLOW',
  'FINANCIAL_EXCEPTIONS',
] as const;
export type FinancialExportType = typeof FINANCIAL_EXPORT_TYPES[number];

export const FINANCE_EXCEPTION_ACTIONS = [
  'RUN_SELLER_PAYABLE_RECONCILIATION',
  'REVIEW_FORMAL_ORDER_SNAPSHOT',
  'REVIEW_BUYER_REFUND_OBLIGATION',
  'MANUAL_INTERNAL_INVESTIGATION',
] as const;
export type FinanceExceptionAction = typeof FINANCE_EXCEPTION_ACTIONS[number];

export interface InternalFinanceFilters {
  from_date: string;
  to_date: string;
  date_basis: FinanceDateBasis;
  seller_organization_id: string | null;
  store_id: string | null;
  product_id: string | null;
  asin: string | null;
  formal_order_id: string | null;
  amazon_order_number: string | null;
  review_type: PricingReviewType | null;
  finance_status: FinanceStatus | null;
}

export interface InternalOrderFinancePositionDto {
  formal_order_id: string;
  amazon_order_number: string;
  seller_organization_id: string;
  store_id: string;
  product_id: string;
  asin: string;
  product_name: string;
  review_type: PricingReviewType;
  confirmed_at: number;
  confirmed_business_date: string;
  review_approved_at: number | null;
  review_approved_business_date: string | null;
  last_cash_business_date: string | null;
  final_paid_jpy: FixedIntegerString;
  financial_snapshot_id: string | null;
  buyer_self_pay_bps: number | null;
  buyer_self_pay_jpy: FixedIntegerString | null;
  buyer_expected_principal_cny_fen: FixedIntegerString | null;
  seller_expected_principal_cny_fen: FixedIntegerString | null;
  service_fee_snapshot_cny_fen: FixedIntegerString | null;
  projected_gross_profit_cny_fen: SignedIntegerString | null;
  completed_gross_profit_cny_fen: SignedIntegerString | null;
  seller_principal_due_cny_fen: FixedIntegerString;
  seller_principal_collected_cny_fen: FixedIntegerString;
  seller_principal_outstanding_cny_fen: FixedIntegerString;
  seller_service_fee_due_cny_fen: FixedIntegerString;
  seller_service_fee_collected_cny_fen: FixedIntegerString;
  seller_service_fee_outstanding_cny_fen: FixedIntegerString;
  buyer_refund_due_cny_fen: FixedIntegerString;
  buyer_refund_net_paid_cny_fen: FixedIntegerString;
  buyer_refund_outstanding_cny_fen: FixedIntegerString;
  buyer_refund_overpaid_cny_fen: FixedIntegerString;
  attributed_cash_net_cny_fen: SignedIntegerString;
  finance_status: FinanceStatus;
}

export interface InternalFinanceOrderDetailDto {
  position: InternalOrderFinancePositionDto;
  frozen_snapshot: {
    financial_snapshot_id: string | null;
    buyer_self_pay_bps: number | null;
    buyer_self_pay_jpy: FixedIntegerString | null;
    buyer_expected_principal_cny_fen: FixedIntegerString | null;
    seller_expected_principal_cny_fen: FixedIntegerString | null;
    service_fee_cny_fen: FixedIntegerString | null;
  };
  seller_payables: {
    principal_due_cny_fen: FixedIntegerString;
    principal_collected_cny_fen: FixedIntegerString;
    principal_outstanding_cny_fen: FixedIntegerString;
    service_fee_due_cny_fen: FixedIntegerString;
    service_fee_collected_cny_fen: FixedIntegerString;
    service_fee_outstanding_cny_fen: FixedIntegerString;
  };
  buyer_refund: {
    due_cny_fen: FixedIntegerString;
    net_paid_cny_fen: FixedIntegerString;
    outstanding_cny_fen: FixedIntegerString;
    overpaid_cny_fen: FixedIntegerString;
  };
  attributed_cash: {
    seller_allocated_net_cny_fen: FixedIntegerString;
    buyer_refund_net_paid_cny_fen: FixedIntegerString;
    net_cny_fen: SignedIntegerString;
  };
  calculations: {
    projected_gross_profit: {
      formula: 'SELLER_EXPECTED_PRINCIPAL_PLUS_SERVICE_FEE_MINUS_BUYER_EXPECTED_PRINCIPAL';
      seller_expected_principal_cny_fen: FixedIntegerString | null;
      service_fee_cny_fen: FixedIntegerString | null;
      buyer_expected_principal_cny_fen: FixedIntegerString | null;
      result_cny_fen: SignedIntegerString | null;
    };
    completed_gross_profit: {
      formula: 'SELLER_PRINCIPAL_PAYABLE_PLUS_SERVICE_FEE_PAYABLE_MINUS_BUYER_REFUND_DUE';
      eligible: boolean;
      seller_principal_payable_cny_fen: FixedIntegerString;
      seller_service_fee_payable_cny_fen: FixedIntegerString;
      buyer_refund_due_cny_fen: FixedIntegerString;
      result_cny_fen: SignedIntegerString | null;
    };
    current_attributed_cash: {
      formula: 'SELLER_CURRENT_NET_ALLOCATION_MINUS_BUYER_REFUND_NET_PAID';
      seller_current_net_allocation_cny_fen: FixedIntegerString;
      buyer_refund_net_paid_cny_fen: FixedIntegerString;
      result_cny_fen: SignedIntegerString;
    };
  };
  finance_status: FinanceStatus;
  exception_codes: readonly string[];
  suggested_actions: readonly FinanceExceptionAction[];
}

export interface InternalFinanceTotalsDto {
  order_count: number;
  projected_order_count: number;
  completed_order_count: number;
  conflict_order_count: number;
  projected_gross_profit_cny_fen: SignedIntegerString;
  completed_gross_profit_cny_fen: SignedIntegerString;
  attributed_cash_net_cny_fen: SignedIntegerString;
  seller_principal_due_cny_fen: FixedIntegerString;
  seller_principal_collected_cny_fen: FixedIntegerString;
  seller_principal_outstanding_cny_fen: FixedIntegerString;
  seller_service_fee_due_cny_fen: FixedIntegerString;
  seller_service_fee_collected_cny_fen: FixedIntegerString;
  seller_service_fee_outstanding_cny_fen: FixedIntegerString;
  buyer_refund_due_cny_fen: FixedIntegerString;
  buyer_refund_net_paid_cny_fen: FixedIntegerString;
  buyer_refund_outstanding_cny_fen: FixedIntegerString;
  buyer_refund_overpaid_cny_fen: FixedIntegerString;
}

export interface InternalFinanceGroupDto extends InternalFinanceTotalsDto {
  group_by: FinanceGroupBy;
  group_key: string;
  group_label: string;
  seller_unallocated_credit_cny_fen: FixedIntegerString | null;
}

export interface InternalFinanceSummaryDto extends InternalFinanceTotalsDto {
  seller_unallocated_credit_cny_fen: FixedIntegerString;
  data_as_of: number;
  filters: InternalFinanceFilters;
}

export interface InternalFinanceCashFlowDto {
  seller_cash_inflow_cny_fen: FixedIntegerString;
  seller_payment_reversal_cny_fen: FixedIntegerString;
  buyer_refund_outflow_cny_fen: FixedIntegerString;
  buyer_refund_reversal_cny_fen: FixedIntegerString;
  buyer_advance_outflow_cny_fen: FixedIntegerString;
  buyer_advance_reversal_cny_fen: FixedIntegerString;
  net_cash_flow_cny_fen: SignedIntegerString;
  from_date: string;
  to_date: string;
  data_as_of: number;
}

export interface InternalFinanceExceptionDto {
  formal_order_id: string;
  seller_organization_id: string;
  store_id: string;
  finance_status: FinanceStatus;
  exception_codes: readonly string[];
  detected_facts_summary: Readonly<Record<string, string | number | null>>;
  suggested_actions: readonly FinanceExceptionAction[];
}

export interface InternalFinanceOrderPageDto {
  items: readonly InternalOrderFinancePositionDto[];
  page: { limit: number; next_cursor: string | null };
  filters: InternalFinanceFilters;
  data_as_of: number;
}

export interface InternalFinanceExceptionPageDto {
  items: readonly InternalFinanceExceptionDto[];
  page: { limit: number; next_cursor: string | null };
  filters: InternalFinanceFilters;
  data_as_of: number;
}

export interface FinancialCsvExportRequest {
  export_type: FinancialExportType;
  filters: Partial<InternalFinanceFilters>;
  date_basis: FinanceDateBasis;
}

export function isFinanceDateBasis(value: unknown): value is FinanceDateBasis {
  return typeof value === 'string'
    && (FINANCE_DATE_BASES as readonly string[]).includes(value);
}
export function isOrderFinanceDateBasis(
  value: unknown,
): value is OrderFinanceDateBasis {
  return typeof value === 'string'
    && (ORDER_FINANCE_DATE_BASES as readonly string[]).includes(value);
}
export function isFinanceGroupBy(value: unknown): value is FinanceGroupBy {
  return typeof value === 'string'
    && (FINANCE_GROUP_BYS as readonly string[]).includes(value);
}
export function isFinanceStatus(value: unknown): value is FinanceStatus {
  return typeof value === 'string'
    && (FINANCE_STATUSES as readonly string[]).includes(value);
}
export function isFinancialExportType(value: unknown): value is FinancialExportType {
  return typeof value === 'string'
    && (FINANCIAL_EXPORT_TYPES as readonly string[]).includes(value);
}
