import type { PricingReviewType } from './pricing';
import type { ReviewCaseStatus } from './review';

export interface StaffReviewEvidenceFileDto {
  file_object_id: string;
  file_entity_link_id: string;
  file_version: number;
  purpose: 'REVIEW_EVIDENCE';
  visibility: 'SELLER_VISIBLE';
  client_file_name: string;
  mime: string;
  byte_size: number;
  verified_at: number;
}

export interface StaffReviewEvidenceVersionDto {
  evidence_version_id: string;
  version_no: number;
  review_type: PricingReviewType;
  review_url: string | null;
  buyer_note: string | null;
  submitted_by_buyer_id: string;
  submitted_at: number;
  files: readonly StaffReviewEvidenceFileDto[];
}

export interface StaffReviewDto {
  review_case_id: string;
  formal_order_id: string;
  buyer_customer_id: string;
  seller_organization_id: string;
  review_type: PricingReviewType;
  status: ReviewCaseStatus;
  version: number;
  current_evidence_version_no: number;
  public_change_reason: string | null;
  internal_review_note: string | null;
  submitted_at: number;
  updated_at: number;
  decided_at: number | null;
  current_evidence: StaffReviewEvidenceVersionDto;
}

export interface StaffReviewHistoryDto {
  review_case_id: string;
  current_evidence_version_no: number;
  versions: readonly StaffReviewEvidenceVersionDto[];
}
