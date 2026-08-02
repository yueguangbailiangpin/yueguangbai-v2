import type { PricingReviewType, FixedIntegerString } from './pricing';

export const REVIEW_CASE_STATUSES = [
  'PENDING_REVIEW',
  'CHANGES_REQUESTED',
  'REJECTED',
  'WITHDRAWN',
  'APPROVED',
] as const;

export type ReviewCaseStatus = typeof REVIEW_CASE_STATUSES[number];

export const REVIEW_EVENT_TYPES = [
  'REVIEW_EVIDENCE_SUBMITTED',
  'REVIEW_EVIDENCE_RESUBMITTED',
  'REVIEW_CHANGES_REQUESTED',
  'REVIEW_REJECTED',
  'REVIEW_WITHDRAWN',
  'REVIEW_APPROVED',
  'BUYER_REFUND_BECAME_DUE',
  'SELLER_SERVICE_FEE_ACCRUED',
] as const;

export type ReviewEventType = typeof REVIEW_EVENT_TYPES[number];

export interface ReviewEvidenceFileInput {
  fileObjectId: string;
  expectedFileVersion: number;
}

export interface ReviewEvidenceFileProjection {
  file_object_id: string;
  file_entity_link_id: string;
}

export interface SubmitReviewEvidenceResult {
  review_case_id: string;
  formal_order_id: string;
  buyer_customer_id: string;
  review_type: PricingReviewType;
  review_url: string | null;
  status: 'PENDING_REVIEW';
  version: number;
  current_evidence_version_no: number;
  current_evidence_version_id: string;
  submitted_at: number;
  evidence_files: readonly ReviewEvidenceFileProjection[];
  replayed: boolean;
}

export interface ReviewTransitionResult {
  review_case_id: string;
  formal_order_id: string;
  status:
    | 'CHANGES_REQUESTED'
    | 'REJECTED'
    | 'WITHDRAWN';
  version: number;
  current_evidence_version_no: number;
  current_evidence_version_id: string;
  replayed: boolean;
}

export interface ReviewFinancialEventProjection {
  event_id: string;
  event_type:
    | 'BUYER_REFUND_BECAME_DUE'
    | 'SELLER_SERVICE_FEE_ACCRUED';
  amount_cny_fen: FixedIntegerString;
  formal_order_financial_snapshot_id: string;
}

export interface ApproveReviewResult {
  review_case_id: string;
  formal_order_id: string;
  status: 'APPROVED';
  version: number;
  current_evidence_version_no: number;
  current_evidence_version_id: string;
  approved_event_id: string;
  financial_events: readonly ReviewFinancialEventProjection[];
  replayed: boolean;
}

export function isReviewCaseStatus(
  value: unknown,
): value is ReviewCaseStatus {
  return typeof value === 'string'
    && (REVIEW_CASE_STATUSES as readonly string[]).includes(value);
}