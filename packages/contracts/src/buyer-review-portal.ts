import type { MarketplaceCode } from './customer';
import type {
  FileObjectStatus,
  SupportedFileMime,
} from './file-storage';
import type {
  FixedIntegerString,
  PricingReviewType,
} from './pricing';
import type { ReviewCaseStatus } from './review';

export const BUYER_REVIEW_DEFAULT_PAGE_SIZE = 20 as const;
export const BUYER_REVIEW_MAX_PAGE_SIZE = 100 as const;

export const BUYER_REVIEW_ACTIONS = [
  'SUBMIT',
  'RESUBMIT',
  'WITHDRAW',
] as const;

export type BuyerReviewAction = typeof BUYER_REVIEW_ACTIONS[number];

export const BUYER_REVIEW_FILE_ACTIONS = [
  'CREATE_READ_INTENT',
] as const;

export type BuyerReviewFileAction =
  typeof BUYER_REVIEW_FILE_ACTIONS[number];

export interface BuyerReviewOrderSummaryDto {
  formal_order_id: string;
  marketplace: MarketplaceCode;
  amazon_order_number: string;
  product_name: string;
  review_type: PricingReviewType;
  confirmed_at: number;
  confirmed_business_date: string;
  status: 'CONFIRMED';
}

export interface BuyerReviewCurrentCaseSummaryDto {
  review_case_id: string;
  status: ReviewCaseStatus;
  version: number;
}

export interface BuyerReviewEligibleOrderDto {
  order: BuyerReviewOrderSummaryDto;
  current_review: BuyerReviewCurrentCaseSummaryDto | null;
  allowed_actions: readonly BuyerReviewAction[];
}

export interface BuyerReviewFileDto {
  file_object_id: string;
  file_entity_link_id: string;
  client_file_name: string;
  mime: SupportedFileMime;
  byte_size: number;
  status: Extract<FileObjectStatus, 'VERIFIED'>;
  version: number;
  verified_at: number;
  allowed_actions: readonly BuyerReviewFileAction[];
}

export interface BuyerReviewRefundDueDto {
  amount_cny_fen: FixedIntegerString;
  became_due_at: number;
}

export interface BuyerReviewSummaryDto {
  review_case_id: string;
  order: BuyerReviewOrderSummaryDto;
  review_type: PricingReviewType;
  status: ReviewCaseStatus;
  version: number;
  current_evidence_version_no: number;
  submitted_at: number;
  updated_at: number;
  public_change_reason: string | null;
  review_url: string | null;
  review_approved_at: number | null;
  buyer_refund_due: BuyerReviewRefundDueDto | null;
  file_count: number;
  allowed_actions: readonly BuyerReviewAction[];
}

export interface BuyerReviewDetailDto extends BuyerReviewSummaryDto {
  files: readonly BuyerReviewFileDto[];
}

export interface BuyerReviewPageDto<T> {
  items: readonly T[];
  next_cursor: string | null;
}

export interface BuyerReviewEvidenceFileRequest {
  file_object_id: string;
  expected_file_version: number;
}

export interface SubmitBuyerReviewRequest {
  formal_order_id: string;
  expected_version: 0;
  review_type: PricingReviewType;
  review_url: string | null;
  evidence_files: readonly BuyerReviewEvidenceFileRequest[];
  buyer_note?: string | null;
}

export interface ResubmitBuyerReviewRequest {
  expected_version: number;
  review_type: PricingReviewType;
  review_url: string | null;
  evidence_files: readonly BuyerReviewEvidenceFileRequest[];
  buyer_note?: string | null;
}

export interface WithdrawBuyerReviewRequest {
  expected_version: number;
}

export interface CreateBuyerReviewFileReadIntentRequest {
  expected_file_version: number;
}

export interface BuyerReviewMutationDto {
  review: BuyerReviewDetailDto;
  replayed: boolean;
}

export interface BuyerReviewFileReadIntentDto {
  read_intent_id: string;
  file_object_id: string;
  access_token: string | null;
  access_token_available: boolean;
  expires_at: number;
  replayed: boolean;
}