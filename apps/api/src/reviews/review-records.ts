import type {
  PricingReviewType,
  ReviewCaseStatus,
  SqlDatabase,
} from '@ygb/contracts';
import { ReviewError } from './review-shared';

export interface FormalOrderReviewSourceRow {
  formal_order_id: string;
  buyer_customer_id: string;
  seller_organization_id: string;
  review_type: PricingReviewType;
  order_status: string;
  financial_snapshot_id: string;
  buyer_expected_principal_cny_fen: number;
  service_fee_cny_fen: number;
  review_case_id: string | null;
  review_status: ReviewCaseStatus | null;
  current_evidence_version_no: number | null;
  review_case_version: number | null;
  public_change_reason: string | null;
  internal_review_note: string | null;
  review_submitted_at: number | null;
  review_updated_at: number | null;
}

export interface CurrentReviewCaseRow {
  review_case_id: string;
  formal_order_id: string;
  buyer_customer_id: string;
  seller_organization_id: string;
  review_type: PricingReviewType;
  status: ReviewCaseStatus;
  current_evidence_version_no: number;
  version: number;
  public_change_reason: string | null;
  internal_review_note: string | null;
  submitted_at: number;
  updated_at: number;
  current_evidence_version_id: string;
  financial_snapshot_id: string;
  buyer_expected_principal_cny_fen: number;
  service_fee_cny_fen: number;
}

export interface ReviewEvidenceFileRow {
  id: string;
  upload_intent_id: string;
  purpose: string;
  visibility: 'INTERNAL_ONLY' | 'BUYER_VISIBLE' | 'SELLER_VISIBLE';
  status: string;
  version: number;
  intent_status: string;
  intent_purpose: string;
  owner_actor_type: string;
  owner_actor_id: string;
}

export async function requireFormalOrderForBuyerReview(
  database: SqlDatabase,
  formalOrderId: string,
  buyerCustomerId: string,
): Promise<FormalOrderReviewSourceRow> {
  const row = await database.prepare(`
    SELECT
      formal_order.id AS formal_order_id,
      formal_order.buyer_customer_id,
      formal_order.seller_organization_id,
      formal_order.review_type,
      formal_order.status AS order_status,
      snapshot.id AS financial_snapshot_id,
      snapshot.buyer_expected_principal_cny_fen,
      snapshot.service_fee_cny_fen,
      review_case.id AS review_case_id,
      review_case.status AS review_status,
      review_case.current_evidence_version_no,
      review_case.version AS review_case_version,
      review_case.public_change_reason,
      review_case.internal_review_note,
      review_case.submitted_at AS review_submitted_at,
      review_case.updated_at AS review_updated_at
    FROM formal_orders formal_order
    JOIN formal_order_financial_snapshots snapshot
      ON snapshot.formal_order_id=formal_order.id
    LEFT JOIN review_cases review_case
      ON review_case.formal_order_id=formal_order.id
    WHERE formal_order.id=?
      AND formal_order.buyer_customer_id=?
    LIMIT 1
  `).bind(
    formalOrderId,
    buyerCustomerId,
  ).first<FormalOrderReviewSourceRow>();
  if (!row) {
    throw new ReviewError('FORMAL_ORDER_NOT_FOUND', 404);
  }
  return row;
}

export async function requireCurrentReviewCaseForBuyer(
  database: SqlDatabase,
  reviewCaseId: string,
  buyerCustomerId: string,
): Promise<CurrentReviewCaseRow> {
  const row = await currentReviewCaseQuery(
    database,
    'review_case.id=? AND review_case.buyer_customer_id=?',
    [reviewCaseId, buyerCustomerId],
  );
  if (!row) throw new ReviewError('REVIEW_CASE_NOT_FOUND', 404);
  return row;
}

export async function requireCurrentReviewCaseForStaff(
  database: SqlDatabase,
  reviewCaseId: string,
): Promise<CurrentReviewCaseRow> {
  const row = await currentReviewCaseQuery(
    database,
    'review_case.id=?',
    [reviewCaseId],
  );
  if (!row) throw new ReviewError('REVIEW_CASE_NOT_FOUND', 404);
  return row;
}

export async function listReviewEvidenceFiles(
  database: SqlDatabase,
  fileObjectIds: readonly string[],
): Promise<readonly ReviewEvidenceFileRow[]> {
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
      intent.purpose AS intent_purpose,
      intent.owner_actor_type,
      intent.owner_actor_id
    FROM file_objects object
    JOIN file_upload_intents intent
      ON intent.id=object.upload_intent_id
    WHERE object.id IN (${placeholders})
    ORDER BY object.id
  `).bind(...fileObjectIds).all<ReviewEvidenceFileRow>();
  return rows.results;
}

async function currentReviewCaseQuery(
  database: SqlDatabase,
  whereSql: string,
  bindings: readonly string[],
): Promise<CurrentReviewCaseRow | null> {
  return database.prepare(`
    SELECT
      review_case.id AS review_case_id,
      review_case.formal_order_id,
      review_case.buyer_customer_id,
      review_case.seller_organization_id,
      review_case.review_type,
      review_case.status,
      review_case.current_evidence_version_no,
      review_case.version,
      review_case.public_change_reason,
      review_case.internal_review_note,
      review_case.submitted_at,
      review_case.updated_at,
      evidence.id AS current_evidence_version_id,
      snapshot.id AS financial_snapshot_id,
      snapshot.buyer_expected_principal_cny_fen,
      snapshot.service_fee_cny_fen
    FROM review_cases review_case
    JOIN review_evidence_versions evidence
      ON evidence.review_case_id=review_case.id
      AND evidence.version_no=review_case.current_evidence_version_no
    JOIN formal_order_financial_snapshots snapshot
      ON snapshot.formal_order_id=review_case.formal_order_id
    WHERE ${whereSql}
  `).bind(...bindings).first<CurrentReviewCaseRow>();
}
