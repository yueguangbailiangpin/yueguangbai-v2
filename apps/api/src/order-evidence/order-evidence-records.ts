import type {
  OrderEvidenceStatus,
  SqlDatabase,
} from '@ygb/contracts';
import { OrderEvidenceError } from './order-evidence-shared';

export interface ReservationForOrderEvidence {
  reservation_id: string;
  buyer_customer_id: string;
  marketplace_code: 'JP';
  status: string;
  organization_id: string;
  store_id: string;
  product_id: string;
  product_version_no: number;
}

export interface OrderEvidenceSubmissionRow {
  submission_id: string;
  reservation_id: string;
  buyer_customer_id: string;
  marketplace_code: 'JP';
  status: OrderEvidenceStatus;
  current_version_no: number;
  aggregate_version: number;
  public_change_reason: string | null;
  internal_review_note: string | null;
  submitted_at: number;
  updated_at: number;
  verified_by_staff_id: string | null;
  verified_at: number | null;
  withdrawn_at: number | null;
  consumed_at: number | null;
}

export interface CurrentOrderEvidenceRow
extends OrderEvidenceSubmissionRow {
  evidence_version_id: string;
  amazon_order_number_raw: string;
  amazon_order_number_normalized: string;
  final_paid_jpy: number;
  buyer_note: string | null;
  version_created_at: number;
}

export interface VerifiedEvidenceFileRow {
  id: string;
  upload_intent_id: string;
  purpose: string;
  visibility: 'INTERNAL_ONLY' | 'BUYER_VISIBLE' | 'SELLER_VISIBLE';
  status: string;
  version: number;
  intent_status: string;
  owner_actor_type: string;
  owner_actor_id: string;
  detected_mime: string | null;
}

export async function requireApprovedReservationForBuyer(
  database: SqlDatabase,
  reservationId: string,
  buyerCustomerId: string,
): Promise<ReservationForOrderEvidence> {
  const row = await database.prepare(`
    SELECT
      id AS reservation_id,
      buyer_customer_id,
      marketplace_code,
      status,
      organization_id,
      store_id,
      product_id,
      product_version_no
    FROM product_reservations
    WHERE id=?
      AND buyer_customer_id=?
  `).bind(
    reservationId,
    buyerCustomerId,
  ).first<ReservationForOrderEvidence>();
  if (!row) {
    throw new OrderEvidenceError('RESERVATION_NOT_FOUND', 404);
  }
  if (row.status !== 'APPROVED') {
    throw new OrderEvidenceError(
      'ORDER_EVIDENCE_STATE_CONFLICT',
      409,
    );
  }
  return row;
}

export async function findSubmissionForBuyerByReservation(
  database: SqlDatabase,
  reservationId: string,
  buyerCustomerId: string,
): Promise<OrderEvidenceSubmissionRow | null> {
  return database.prepare(`
    SELECT
      id AS submission_id,
      reservation_id,
      buyer_customer_id,
      marketplace_code,
      status,
      current_version_no,
      version AS aggregate_version,
      public_change_reason,
      internal_review_note,
      submitted_at,
      updated_at,
      verified_by_staff_id,
      verified_at,
      withdrawn_at,
      consumed_at
    FROM order_evidence_submissions
    WHERE reservation_id=?
      AND buyer_customer_id=?
  `).bind(
    reservationId,
    buyerCustomerId,
  ).first<OrderEvidenceSubmissionRow>();
}

export async function requireSubmissionForBuyerById(
  database: SqlDatabase,
  submissionId: string,
  buyerCustomerId: string,
): Promise<OrderEvidenceSubmissionRow> {
  const row = await database.prepare(`
    SELECT
      id AS submission_id,
      reservation_id,
      buyer_customer_id,
      marketplace_code,
      status,
      current_version_no,
      version AS aggregate_version,
      public_change_reason,
      internal_review_note,
      submitted_at,
      updated_at,
      verified_by_staff_id,
      verified_at,
      withdrawn_at,
      consumed_at
    FROM order_evidence_submissions
    WHERE id=?
      AND buyer_customer_id=?
  `).bind(
    submissionId,
    buyerCustomerId,
  ).first<OrderEvidenceSubmissionRow>();
  if (!row) {
    throw new OrderEvidenceError('ORDER_EVIDENCE_NOT_FOUND', 404);
  }
  return row;
}

export async function requireSubmissionForStaff(
  database: SqlDatabase,
  submissionId: string,
): Promise<OrderEvidenceSubmissionRow> {
  const row = await database.prepare(`
    SELECT
      id AS submission_id,
      reservation_id,
      buyer_customer_id,
      marketplace_code,
      status,
      current_version_no,
      version AS aggregate_version,
      public_change_reason,
      internal_review_note,
      submitted_at,
      updated_at,
      verified_by_staff_id,
      verified_at,
      withdrawn_at,
      consumed_at
    FROM order_evidence_submissions
    WHERE id=?
  `).bind(submissionId).first<OrderEvidenceSubmissionRow>();
  if (!row) {
    throw new OrderEvidenceError('ORDER_EVIDENCE_NOT_FOUND', 404);
  }
  return row;
}

export async function requireCurrentOrderEvidenceForBuyer(
  database: SqlDatabase,
  submissionId: string,
  buyerCustomerId: string,
): Promise<CurrentOrderEvidenceRow> {
  const row = await currentOrderEvidenceQuery(
    database,
    'submission.id=? AND submission.buyer_customer_id=?',
    [submissionId, buyerCustomerId],
  );
  if (!row) {
    throw new OrderEvidenceError('ORDER_EVIDENCE_NOT_FOUND', 404);
  }
  return row;
}

export async function requireCurrentOrderEvidenceForStaff(
  database: SqlDatabase,
  submissionId: string,
): Promise<CurrentOrderEvidenceRow> {
  const row = await currentOrderEvidenceQuery(
    database,
    'submission.id=?',
    [submissionId],
  );
  if (!row) {
    throw new OrderEvidenceError('ORDER_EVIDENCE_NOT_FOUND', 404);
  }
  return row;
}

async function currentOrderEvidenceQuery(
  database: SqlDatabase,
  whereSql: string,
  bindings: readonly string[],
): Promise<CurrentOrderEvidenceRow | null> {
  return database.prepare(`
    SELECT
      submission.id AS submission_id,
      submission.reservation_id,
      submission.buyer_customer_id,
      submission.marketplace_code,
      submission.status,
      submission.current_version_no,
      submission.version AS aggregate_version,
      submission.public_change_reason,
      submission.internal_review_note,
      submission.submitted_at,
      submission.updated_at,
      submission.verified_by_staff_id,
      submission.verified_at,
      submission.withdrawn_at,
      submission.consumed_at,
      evidence.id AS evidence_version_id,
      evidence.amazon_order_number_raw,
      evidence.amazon_order_number_normalized,
      evidence.final_paid_jpy,
      evidence.buyer_note,
      evidence.created_at AS version_created_at
    FROM order_evidence_submissions submission
    JOIN order_evidence_versions evidence
      ON evidence.submission_id=submission.id
      AND evidence.version_no=submission.current_version_no
    WHERE ${whereSql}
  `).bind(...bindings).first<CurrentOrderEvidenceRow>();
}

export async function listVerifiedEvidenceFiles(
  database: SqlDatabase,
  fileObjectIds: readonly string[],
): Promise<readonly VerifiedEvidenceFileRow[]> {
  const placeholders = fileObjectIds.map(() => '?').join(', ');
  const rows = await database.prepare(`
    SELECT
      object.id,
      object.upload_intent_id,
      object.purpose,
      object.visibility,
      object.status,
      object.version,
      intent.status AS intent_status,
      intent.owner_actor_type,
      intent.owner_actor_id,
      object.detected_mime
    FROM file_objects object
    JOIN file_upload_intents intent
      ON intent.id=object.upload_intent_id
    WHERE object.id IN (${placeholders})
    ORDER BY object.id
  `).bind(...fileObjectIds).all<VerifiedEvidenceFileRow>();
  return rows.results;
}
