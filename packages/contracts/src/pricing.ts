import { DEMAND_TASK_TYPES, type DemandTaskType } from './demand';

export const PRICING_RULE_STATUSES = ['SUBMITTED', 'CONFIRMED', 'REJECTED'] as const;

export type PricingRuleStatus = (typeof PRICING_RULE_STATUSES)[number];

export const PRICING_REVIEW_TYPES = DEMAND_TASK_TYPES;
export type PricingReviewType = DemandTaskType;

/**
 * Business-approved default per-order service fees (CNY fen) applied when a
 * seller organization is created, and offered as a one-click fill for
 * existing organizations with unconfigured review types. Changing these
 * values is a code change + deploy; per-seller deviations keep using the
 * normal versioned submit/confirm flow.
 */
export const DEFAULT_SELLER_SERVICE_FEES: ReadonlyArray<{
  review_type: PricingReviewType;
  fee_cny_fen: string;
}> = Object.freeze([
  { review_type: 'RATING', fee_cny_fen: '3500' },
  { review_type: 'TEXT', fee_cny_fen: '6000' },
  { review_type: 'IMAGE', fee_cny_fen: '7000' },
  { review_type: 'VIDEO', fee_cny_fen: '8500' },
]);

/**
 * Base-10 integer encoded as a JSON-safe string. Runtime code must parse this
 * into BigInt before doing arithmetic.
 */
export type FixedIntegerString = string;

export interface BuyerDailyExchangeRateVersion {
  rate_id: string;
  business_date: string;
  version_no: number;
  decision_version: number;
  status: PricingRuleStatus;
  cny_per_jpy_e8: FixedIntegerString;
  rejection_reason: string | null;
  confirmed_at: number | null;
}

/**
 * The rate center exposes the authoritative order-date base rate through this
 * compatibility projection.  `buyer_daily_exchange_rates` remains the
 * physical source until historical financial-snapshot foreign keys can be
 * retired; its confirmed record is mirrored 1:1 into the canonical currency
 * rate foundation used by seller-principal snapshots.
 */
export interface BuyerDailyExchangeRateReadDto {
  business_date: string;
  confirmed_rate: BuyerDailyExchangeRateVersion | null;
  pending_rate: BuyerDailyExchangeRateVersion | null;
  next_version: number;
}

export interface SellerServiceFeeVersion {
  fee_version_id: string;
  seller_organization_id: string;
  review_type: PricingReviewType;
  version_no: number;
  decision_version: number;
  status: PricingRuleStatus;
  fee_cny_fen: FixedIntegerString;
  effective_from: number;
  rejection_reason: string | null;
  confirmed_at: number | null;
}

export interface ResolvedBuyerDailyExchangeRate {
  rate_id: string;
  business_date: string;
  version_no: number;
  cny_per_jpy_e8: FixedIntegerString;
  confirmed_at: number;
}

export interface ResolvedSellerServiceFee {
  fee_version_id: string;
  seller_organization_id: string;
  review_type: PricingReviewType;
  version_no: number;
  fee_cny_fen: FixedIntegerString;
  effective_from: number;
  confirmed_at: number;
}

export function isPricingReviewType(value: unknown): value is PricingReviewType {
  return typeof value === 'string' && (PRICING_REVIEW_TYPES as readonly string[]).includes(value);
}
