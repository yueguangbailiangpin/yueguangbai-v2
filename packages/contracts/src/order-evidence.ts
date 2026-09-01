export const ORDER_EVIDENCE_STATUSES = [
  'PENDING_VERIFICATION',
  'CHANGES_REQUESTED',
  'VERIFIED',
  'WITHDRAWN',
  'CONSUMED',
] as const;

export type OrderEvidenceStatus =
  typeof ORDER_EVIDENCE_STATUSES[number];

export const ORDER_EVIDENCE_EVENT_TYPES = [
  'ORDER_EVIDENCE_SUBMITTED',
  'ORDER_EVIDENCE_RESUBMITTED',
  'ORDER_EVIDENCE_CHANGES_REQUESTED',
  'ORDER_EVIDENCE_VERIFIED',
  'ORDER_EVIDENCE_WITHDRAWN',
] as const;

export type OrderEvidenceEventType =
  typeof ORDER_EVIDENCE_EVENT_TYPES[number];

export type OrderEvidenceMarketplace = 'AMAZON_JP';

export interface OrderEvidenceCommandResult {
  submission_id: string;
  reservation_id: string;
  buyer_customer_id: string;
  marketplace: OrderEvidenceMarketplace;
  status: OrderEvidenceStatus;
  version: number;
  current_evidence_version_no: number;
  current_evidence_version_id: string;
  replayed: boolean;
}

export interface SubmitOrderEvidenceResult
extends OrderEvidenceCommandResult {
  status: 'PENDING_VERIFICATION';
  amazon_order_number_normalized: string;
  amazon_order_date: string;
  final_paid_jpy: number;
  evidence_file_count: number;
}

export interface RequestOrderEvidenceChangesResult
extends OrderEvidenceCommandResult {
  status: 'CHANGES_REQUESTED';
  public_change_reason: string;
}

export interface VerifyOrderEvidenceResult
extends OrderEvidenceCommandResult {
  status: 'VERIFIED';
  verified_at: number;
  verified_by_staff_id: string;
}

export interface WithdrawOrderEvidenceResult
extends OrderEvidenceCommandResult {
  status: 'WITHDRAWN';
  withdrawn_at: number;
}

export interface OrderEvidenceFileProjection {
  file_object_id: string;
  visibility: 'INTERNAL_ONLY' | 'BUYER_VISIBLE';
}

export interface BuyerOrderEvidenceProjection {
  submission_id: string;
  reservation_id: string;
  marketplace: OrderEvidenceMarketplace;
  status: OrderEvidenceStatus;
  version: number;
  evidence_version_no: number;
  amazon_order_number_raw: string;
  amazon_order_number_normalized: string;
  amazon_order_date: string | null;
  final_paid_jpy: number;
  buyer_note: string | null;
  public_change_reason: string | null;
  submitted_at: number;
  updated_at: number;
  verified_at: number | null;
  withdrawn_at: number | null;
  files: readonly OrderEvidenceFileProjection[];
}

export interface StaffOrderEvidenceProjection
extends BuyerOrderEvidenceProjection {
  buyer_customer_id: string;
  internal_review_note: string | null;
  verified_by_staff_id: string | null;
  duplicate_signal_count: number;
}

export function isOrderEvidenceStatus(
  value: unknown,
): value is OrderEvidenceStatus {
  return typeof value === 'string'
    && (ORDER_EVIDENCE_STATUSES as readonly string[])
      .includes(value);
}
