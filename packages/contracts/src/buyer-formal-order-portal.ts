import type { MarketplaceCode } from './customer';
import type {
  FixedIntegerString,
  PricingReviewType,
} from './pricing';

export const BUYER_FORMAL_ORDER_DEFAULT_PAGE_SIZE = 20 as const;
export const BUYER_FORMAL_ORDER_MAX_PAGE_SIZE = 100 as const;

export interface BuyerFormalOrderRateSnapshotDto {
  version_no: number;
  business_date: string;
  confirmed_at: number;
  cny_per_jpy_e8: FixedIntegerString;
}

export interface BuyerFormalOrderEvidenceSummaryDto {
  evidence_version_no: number;
  submitted_at: number;
  verified_at: number;
  file_count: number;
}

export interface BuyerFormalOrderDto {
  formal_order_id: string;
  buyer_customer_no: string;
  marketplace: MarketplaceCode;
  amazon_order_number: string;
  amazon_order_date: string | null;
  product_name: string;
  review_type: PricingReviewType;
  final_paid_jpy: FixedIntegerString;
  buyer_self_pay_bps: number;
  buyer_self_pay_jpy: FixedIntegerString;
  buyer_refundable_principal_jpy: FixedIntegerString;
  buyer_expected_principal_cny_fen: FixedIntegerString;
  buyer_exchange_rate_snapshot: BuyerFormalOrderRateSnapshotDto;
  confirmed_at: number;
  confirmed_business_date: string;
  status: 'CONFIRMED';
  order_evidence_summary: BuyerFormalOrderEvidenceSummaryDto;
}

export interface BuyerFormalOrderPageDto {
  items: readonly BuyerFormalOrderDto[];
  next_cursor: string | null;
}
