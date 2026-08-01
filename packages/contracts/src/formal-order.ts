import type { MarketplaceCode } from './customer';
import type {
  FixedIntegerString,
  PricingReviewType,
} from './pricing';

export const FORMAL_ORDER_STATUSES = ['CONFIRMED'] as const;
export type FormalOrderStatus = typeof FORMAL_ORDER_STATUSES[number];

export const FORMAL_ORDER_EVENT_TYPES = [
  'FORMAL_ORDER_CONFIRMED',
] as const;
export type FormalOrderEventType =
  typeof FORMAL_ORDER_EVENT_TYPES[number];

export const FORMAL_ORDER_FINANCIAL_SNAPSHOT_VERSION = 1 as const;
export type FormalOrderFinancialSnapshotVersion =
  typeof FORMAL_ORDER_FINANCIAL_SNAPSHOT_VERSION;

export const FORMAL_ORDER_ROUNDING_RULES = ['HALF_UP'] as const;
export type FormalOrderRoundingRule =
  typeof FORMAL_ORDER_ROUNDING_RULES[number];

export interface FormalOrderFinancialSnapshotProjection {
  snapshot_id: string;
  snapshot_version: FormalOrderFinancialSnapshotVersion;
  buyer_rate_version_id: string;
  buyer_rate_version_no: number;
  buyer_rate_business_date: string;
  buyer_rate_confirmed_at: number;
  buyer_cny_per_jpy_e8: FixedIntegerString;
  seller_rate_version_id: string;
  seller_rate_version_no: number;
  seller_rate_effective_from: number;
  seller_rate_confirmed_at: number;
  seller_cny_per_jpy_e8: FixedIntegerString;
  service_fee_version_id: string;
  service_fee_version_no: number;
  service_fee_effective_from: number;
  service_fee_confirmed_at: number;
  service_fee_cny_fen: FixedIntegerString;
  buyer_expected_principal_cny_fen: FixedIntegerString;
  seller_expected_principal_cny_fen: FixedIntegerString;
  rounding_rule: FormalOrderRoundingRule;
}

export interface ConfirmFormalOrderResult {
  formal_order_id: string;
  status: 'CONFIRMED';
  version: 1;
  order_evidence_submission_id: string;
  order_evidence_version_id: string;
  reservation_id: string;
  demand_batch_id: string;
  buyer_customer_id: string;
  buyer_customer_no: string;
  buyer_number_allocated: boolean;
  seller_organization_id: string;
  store_id: string;
  marketplace_code: MarketplaceCode;
  product_id: string;
  product_version_id: string;
  product_version_no: number;
  asin: string;
  product_name: string;
  review_type: PricingReviewType;
  amazon_order_number: string;
  final_paid_jpy: FixedIntegerString;
  confirmed_at: number;
  confirmed_business_date: string;
  financial_snapshot: FormalOrderFinancialSnapshotProjection;
  replayed: boolean;
}

export function isFormalOrderStatus(
  value: unknown,
): value is FormalOrderStatus {
  return typeof value === 'string'
    && (FORMAL_ORDER_STATUSES as readonly string[]).includes(value);
}
