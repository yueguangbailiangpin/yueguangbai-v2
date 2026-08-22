import type { SafeFileReferenceDto } from './file-http';
import type { OrderEvidenceStatus, StaffOrderEvidenceProjection } from './order-evidence';

export const STAFF_ORDER_EVIDENCE_PATHS = Object.freeze({
  list: '/api/staff/order-evidence',
  detail: '/api/staff/order-evidence/:id',
  approvalPreflight: '/api/staff/order-evidence/:id/preflight',
  requestChanges: '/api/staff/order-evidence/:id/request-changes',
  approve: '/api/staff/order-evidence/:id/approve',
} as const);

/**
 * Read-only prerequisite check for order-evidence approval.  It never creates
 * an order or reserves a number; the approval command repeats the checks in
 * the same atomic command before it writes financial facts.
 */
export interface StaffOrderEvidenceApprovalPreflightDto {
  submission_id: string;
  amazon_order_date: string | null;
  ready: boolean;
  checks: readonly StaffOrderEvidenceApprovalPreflightCheckDto[];
}

export interface StaffOrderEvidenceApprovalPreflightCheckDto {
  code: 'ORDER_DAY_BASE_RATE' | 'SELLER_PRINCIPAL_MARKUP' | 'SELLER_SERVICE_FEE';
  status: 'READY' | 'MISSING';
  message: string;
  action_path: string;
  required_access: string;
}

export const STAFF_ORDER_EVIDENCE_LIST_STATUSES = [
  'PENDING_VERIFICATION',
  'CHANGES_REQUESTED',
  'VERIFIED',
] as const satisfies readonly OrderEvidenceStatus[];

export interface StaffOrderEvidenceListQuery {
  limit?: number;
  cursor?: string;
  status?: (typeof STAFF_ORDER_EVIDENCE_LIST_STATUSES)[number];
}

export interface StaffOrderEvidenceListItem {
  submission_id: string;
  buyer_customer_id: string;
  reservation_id: string;
  instruction_id: string;
  instruction_version_id: string;
  marketplace: 'JP';
  amazon_order_number_raw: string;
  amazon_order_number_normalized: string;
  status: OrderEvidenceStatus;
  version: number;
  current_evidence_version_no: number;
  reference_order_amount_jpy: string;
  final_paid_jpy: string;
  price_difference_jpy: string;
  price_mismatch: boolean;
  resubmission_deadline_at: number | null;
  submitted_at: number;
  updated_at: number;
  buyer: StaffOrderEvidenceBuyerSummaryDto;
  screenshot: SafeFileReferenceDto;
  workflow: StaffOrderEvidenceWorkflowDto;
}

export interface StaffOrderEvidenceBuyerSummaryDto {
  buyer_customer_id: string;
  buyer_customer_no: string | null;
}

export interface StaffOrderEvidenceWorkflowDto {
  work_item_id: string | null;
  assigned_staff_id: string | null;
  assigned_team_id: string | null;
  fixed_assignment_id: string | null;
}

export interface StaffOrderEvidenceDetailDto
  extends Omit<StaffOrderEvidenceProjection, 'final_paid_jpy' | 'files'> {
  final_paid_jpy: string;
  reference_order_amount_jpy: string;
  price_difference_jpy: string;
  price_mismatch: boolean;
  screenshot: SafeFileReferenceDto;
  buyer: StaffOrderEvidenceBuyerSummaryDto;
  instruction: {
    instruction_id: string;
    instruction_version_id: string;
    buyer_self_pay_bps: number;
    buyer_self_pay_jpy: string;
    buyer_refundable_principal_jpy: string;
  };
  reservation: {
    reservation_id: string;
    status: string;
    version: number;
  };
  version_history: readonly {
    evidence_version_id: string;
    version_no: number;
    final_paid_jpy: string;
    submitted_at: number;
  }[];
  workflow: StaffOrderEvidenceWorkflowDto;
}

export interface RequestStaffOrderEvidenceChangesRequest {
  expected_version: number;
  public_reason: string;
  internal_note?: string;
}

export interface ApproveStaffOrderEvidenceRequest {
  expected_version: number;
  internal_note?: string;
  price_mismatch_acknowledged?: boolean;
  price_mismatch_reason?: string;
}

export interface ApproveStaffOrderEvidenceResult {
  formal_order_id: string;
  order_evidence_submission_id: string;
  status: 'CONFIRMED';
  version: number;
  reference_order_amount_jpy: string;
  final_paid_jpy: string;
  price_difference_jpy: string;
  price_mismatch_acknowledged: boolean;
  confirmed_at: number;
  replayed: boolean;
}
