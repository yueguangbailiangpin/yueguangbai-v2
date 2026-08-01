import type { FormalOrderStatus } from './formal-order';
import type {
  FixedIntegerString,
  PricingReviewType,
} from './pricing';
import type { SellerPortalPage } from './seller-portal';

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

export interface SellerAgreementRateSnapshotDto {
  rate_version_id: string;
  version_no: number;
  cny_per_jpy_e8: FixedIntegerString;
  effective_from: number;
  confirmed_at: number;
}

export interface LockedSellerServiceFeeSnapshotDto {
  fee_version_id: string;
  version_no: number;
  review_type: PricingReviewType;
  service_fee_cny_fen: FixedIntegerString;
  effective_from: number;
  confirmed_at: number;
}

export interface SellerFormalOrderPortalDto {
  formal_order_id: string;
  status: FormalOrderStatus;
  marketplace_code: 'JP';
  amazon_order_number: string;
  store: SellerFormalOrderStoreSummaryDto;
  asin: string;
  product_name: string;
  product_version: SellerFormalOrderProductVersionSummaryDto;
  review_type: PricingReviewType;
  final_paid_jpy: FixedIntegerString;
  seller_expected_principal_cny_fen: FixedIntegerString;
  seller_agreement_rate_snapshot: SellerAgreementRateSnapshotDto;
  locked_service_fee_snapshot: LockedSellerServiceFeeSnapshotDto;
  confirmed_at: number;
  confirmed_business_date: string;
}

export type SellerFormalOrderPortalPage =
  SellerPortalPage<SellerFormalOrderPortalDto>;

export interface SellerFormalOrderPortalFilters {
  store_id: string | null;
  marketplace_code: 'JP' | null;
  asin: string | null;
  product_name: string | null;
  review_type: PricingReviewType | null;
  confirmed_business_date: string | null;
  formal_order_id: string | null;
  amazon_order_number: string | null;
}
