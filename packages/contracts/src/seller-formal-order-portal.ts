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
  created_at: number;
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
  seller_principal: SellerBusinessCompletionComponentStatus;
  seller_service_fee: SellerBusinessCompletionComponentStatus;
}

export interface SellerFormalOrderMainImageDto {
  file_object_id: string;
  file_version: number;
  client_file_name: string;
}

export interface SellerFormalOrderScreenshotDto {
  file_object_id: string;
  file_version: number;
}

interface SellerFormalOrderPortalBaseDto {
  formal_order_id: string;
  status: FormalOrderStatus;
  platform_order_identifier: string;
  store: SellerFormalOrderStoreSummaryDto;
  platform_product_identifier: string;
  product_name: string;
  main_image: SellerFormalOrderMainImageDto | null;
  order_screenshot: SellerFormalOrderScreenshotDto | null;
  chat_screenshot: SellerOrderChatScreenshotStatusDto;
  confirmed_at: number;
}

export interface SellerFormalOrderPortalDto extends SellerFormalOrderPortalBaseDto {
  marketplace_code: 'AMAZON_JP';
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
