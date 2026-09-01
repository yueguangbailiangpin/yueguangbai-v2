import type { SupportedFileMime } from './file-storage';
import type { FixedIntegerString, PricingReviewType } from './pricing';
import type { ReviewCaseStatus } from './review';
import type { SellerPortalPage } from './seller-portal';

export const SELLER_REVIEW_PORTAL_HTTP_PATHS = Object.freeze({
  reviews: '/api/seller-portal/reviews',
  review: '/api/seller-portal/reviews/:id',
  fileReadIntent:
    '/api/seller-portal/reviews/:id/files/:fileLinkId/read-intent',
});

export type SellerReviewAllowedAction =
  | 'VIEW'
  | 'READ_EVIDENCE';

export interface SellerReviewOrderSummaryDto {
  id: string;
  amazon_order_number: string;
}

export interface SellerReviewStoreSummaryDto {
  id: string;
  display_name: string;
}

export interface SellerReviewEvidenceFileDto {
  file_entity_link_id: string;
  file_version: number;
  content_type: SupportedFileMime;
  byte_size: number;
  created_at: number;
}

export interface SellerReviewEvidenceSummaryDto {
  version_id: string;
  version_no: number;
  submitted_at: number;
  files: readonly SellerReviewEvidenceFileDto[];
}

export interface SellerReviewServiceFeeAccruedDto {
  amount_cny_fen: FixedIntegerString;
  accrued_at: number;
}

export interface SellerReviewPortalDto {
  review_case_id: string;
  formal_order: SellerReviewOrderSummaryDto;
  store: SellerReviewStoreSummaryDto;
  marketplace_code: 'AMAZON_JP';
  asin: string;
  product_name: string;
  review_type: PricingReviewType;
  status: ReviewCaseStatus;
  version: number;
  review_url: string | null;
  submitted_at: number;
  approved_at: number | null;
  evidence: SellerReviewEvidenceSummaryDto;
  service_fee_accrued: SellerReviewServiceFeeAccruedDto | null;
  allowed_actions: readonly SellerReviewAllowedAction[];
}

export type SellerReviewPortalPage = SellerPortalPage<SellerReviewPortalDto>;

export interface SellerReviewPortalFilters {
  store_id: string | null;
  status: ReviewCaseStatus | null;
  asin: string | null;
  review_type: PricingReviewType | null;
  formal_order_id: string | null;
  amazon_order_number: string | null;
}

export interface CreateSellerReviewFileReadIntentRequest {
  expected_file_version: number;
}

export interface SellerReviewFileReadIntentDto {
  read_intent_id: string;
  access_token: string | null;
  access_token_available: boolean;
  expires_at: number;
  replayed: boolean;
}
