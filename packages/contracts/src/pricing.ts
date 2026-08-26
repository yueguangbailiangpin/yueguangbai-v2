import { DEMAND_TASK_TYPES, type DemandTaskType } from './demand';

export const PRICING_REVIEW_TYPES = DEMAND_TASK_TYPES;
export type PricingReviewType = DemandTaskType;

/**
 * Base-10 integer encoded as a JSON-safe string. Runtime code must parse this
 * into BigInt before doing arithmetic.
 */
export type FixedIntegerString = string;

/**
 * Stage 6.6 (D-056): one save immediately forms a new effective, immutable
 * version of the order-date base rate. There is no submit/confirm dual
 * approval any more; `effective_from` always equals the version's creation
 * time.
 */
export interface BuyerDailyExchangeRateVersion {
  rate_version_id: string;
  business_date: string;
  version_no: number;
  rate_value: FixedIntegerString;
  rate_scale: FixedIntegerString;
  created_by_staff_id: string;
  created_at: number;
}

export interface BuyerDailyExchangeRateReadDto {
  business_date: string;
  versions: readonly BuyerDailyExchangeRateVersion[];
  active_version: BuyerDailyExchangeRateVersion | null;
  next_version: number;
}

export interface ResolvedBuyerDailyExchangeRate {
  rate_id: string;
  business_date: string;
  version_no: number;
  rate_value: FixedIntegerString;
  rate_scale: FixedIntegerString;
  created_at: number;
}

export interface ResolvedSellerServiceFee {
  fee_version_id: string;
  seller_organization_id: string;
  review_type: PricingReviewType;
  version_no: number;
  fee_cny_fen: FixedIntegerString;
  effective_from: number;
  created_at: number;
}

export function isPricingReviewType(value: unknown): value is PricingReviewType {
  return typeof value === 'string' && (PRICING_REVIEW_TYPES as readonly string[]).includes(value);
}
