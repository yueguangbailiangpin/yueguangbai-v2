import {
  DEMAND_TASK_TYPES,
  type DemandTaskType,
} from './demand';

export const PRICING_RULE_STATUSES = [
  'SUBMITTED',
  'CONFIRMED',
  'REJECTED',
] as const;

export type PricingRuleStatus =
  typeof PRICING_RULE_STATUSES[number];

export const PRICING_REVIEW_TYPES = DEMAND_TASK_TYPES;
export type PricingReviewType = DemandTaskType;

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

export interface SellerAgreementRateVersion {
  rate_version_id: string;
  seller_organization_id: string;
  version_no: number;
  decision_version: number;
  status: PricingRuleStatus;
  cny_per_jpy_e8: FixedIntegerString;
  effective_from: number;
  rejection_reason: string | null;
  confirmed_at: number | null;
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

export interface ResolvedSellerAgreementRate {
  rate_version_id: string;
  seller_organization_id: string;
  version_no: number;
  cny_per_jpy_e8: FixedIntegerString;
  effective_from: number;
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

export function isPricingReviewType(
  value: unknown,
): value is PricingReviewType {
  return typeof value === 'string'
    && (PRICING_REVIEW_TYPES as readonly string[]).includes(value);
}
