import type { FormalOrderStatus } from './formal-order';
import type {
  FixedIntegerString,
  PricingReviewType,
} from './pricing';
import type {
  CanonicalMarketplaceCode,
  MarketplaceCode,
} from './customer';
import type { CurrencyCode, CurrencyExponent } from './marketplace-money';
import type { SellerPortalPage } from './seller-portal';
import type { SellerOrderChatScreenshotStatusDto } from './seller-order-chat-screenshot';
import type { SellerPrincipalRateSnapshotDto } from './seller-principal-rate-policy';

export const SELLER_FORMAL_ORDER_PORTAL_HTTP_PATHS = Object.freeze({
  formalOrders: '/api/seller-portal/formal-orders',
  formalOrder: '/api/seller-portal/formal-orders/:id',
});

export interface SellerFormalOrderStoreSummaryDto {
  id: string;
  display_name: string;
}

export interface SellerFormalOrderProductVersionSummaryDto {
  id: string;
  version_no: number;
}

export interface LockedSellerServiceFeeSnapshotDto {
  fee_version_id: string;
  version_no: number;
  review_type: PricingReviewType;
  service_fee_cny_fen: FixedIntegerString;
  effective_from: number;
  confirmed_at: number;
  marketplace_code: CanonicalMarketplaceCode;
  currency_code: 'CNY';
  currency_exponent: 2;
}

export type SellerBusinessCompletionComponentStatus =
  | 'PENDING'
  | 'COMPLETE'
  | 'NOT_APPLICABLE';

export interface SellerBusinessCompletionDto {
  status: 'IN_PROGRESS' | 'COMPLETE';
  review: SellerBusinessCompletionComponentStatus;
  buyer_refund: SellerBusinessCompletionComponentStatus;
  seller_principal: SellerBusinessCompletionComponentStatus;
  seller_service_fee: SellerBusinessCompletionComponentStatus;
}

interface SellerFormalOrderPortalBaseDto {
  formal_order_id: string;
  status: FormalOrderStatus;
  platform_order_identifier: string;
  store: SellerFormalOrderStoreSummaryDto;
  platform_product_identifier: string;
  product_name: string;
  chat_screenshot: SellerOrderChatScreenshotStatusDto;
  confirmed_at: number;
}

export type SellerFormalOrderPortalDto = SellerFormalOrderPortalBaseDto & (
  | {
  legacy_projection: 'AMAZON';
  canonical_marketplace_code: Extract<
    CanonicalMarketplaceCode,
    'AMAZON_JP' | 'AMAZON_US'
  >;
  marketplace_code: 'JP';
  amazon_order_number: string;
  asin: string;
  product_version: SellerFormalOrderProductVersionSummaryDto;
  review_type: PricingReviewType;
  final_paid_jpy: FixedIntegerString;
  payment: {
    amount_minor: FixedIntegerString;
    currency_code: CurrencyCode;
    currency_exponent: CurrencyExponent;
  };
  seller_expected_principal_cny_fen: FixedIntegerString;
  seller_principal_rate_snapshot: SellerPrincipalRateSnapshotDto;
  locked_service_fee_snapshot: LockedSellerServiceFeeSnapshotDto;
  business_completion: SellerBusinessCompletionDto;
  confirmed_business_date: string;
  }
  | {
  legacy_projection: 'NONE';
  canonical_marketplace_code: Extract<
    CanonicalMarketplaceCode,
    'RAKUTEN_JP' | 'TIKTOK_JP'
  >;
  marketplace_code: null;
  amazon_order_number: null;
  asin: null;
  product_version: null;
  review_type: PricingReviewType | null;
  final_paid_jpy: null;
  payment: null;
  seller_expected_principal_cny_fen: null;
  seller_principal_rate_snapshot: null;
  locked_service_fee_snapshot: null;
  business_completion: null;
  confirmed_business_date: string | null;
  }
);

export type SellerFormalOrderPortalPage =
  SellerPortalPage<SellerFormalOrderPortalDto>;

export interface SellerFormalOrderPortalFilters {
  store_id: string | null;
  marketplace_code: MarketplaceCode | null;
  asin: string | null;
  product_name: string | null;
  review_type: PricingReviewType | null;
  confirmed_business_date: string | null;
  formal_order_id: string | null;
  amazon_order_number: string | null;
}
