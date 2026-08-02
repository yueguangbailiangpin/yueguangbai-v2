import type {
  PricingReviewType,
  ReviewCaseStatus,
  SqlDatabase,
  StaffReviewDto,
  StaffReviewEvidenceFileDto,
  StaffReviewEvidenceVersionDto,
  StaffReviewHistoryDto,
} from '@ygb/contracts';
import {
  requireSellerOrganizationScope,
  resolveStaffDataScope,
  type AssignmentStaffAuthorization,
} from '../staff-assignment';
import { ReviewError } from './review-shared';

interface ReviewRow {
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
}

interface EvidenceRow {
  evidence_version_id: string;
  version_no: number;
  review_type: PricingReviewType;
  review_url: string | null;
  buyer_note: string | null;
  submitted_by_buyer_id: string;
  submitted_at: number;
}

interface FileRow {
  evidence_version_id: string;
  file_object_id: string;
  file_entity_link_id: string;
  client_file_name: string;
  mime: string;
  byte_size: number;
  verified_at: number;
}

export async function getStaffReview(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  reviewCaseId: string,
): Promise<StaffReviewDto> {
  const review = await requireReview(database, reviewCaseId);
  await authorizeReviewRead(database, actor, review.seller_organization_id, false);
  const versions = await readVersions(database, reviewCaseId, [
    review.current_evidence_version_no,
  ]);
  const current = versions[0];
  if (!current) throw new ReviewError('DEPENDENCY_UNAVAILABLE', 503);
  return Object.freeze({
    ...normalizeReview(review),
    current_evidence: current,
  });
}

export async function getStaffReviewHistory(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  reviewCaseId: string,
): Promise<StaffReviewHistoryDto> {
  const review = await requireReview(database, reviewCaseId);
  await authorizeReviewRead(database, actor, review.seller_organization_id, true);
  const versions = await readVersions(database, reviewCaseId, null);
  return Object.freeze({
    review_case_id: review.review_case_id,
    current_evidence_version_no: Number(review.current_evidence_version_no),
    versions: Object.freeze(versions),
  });
}

async function authorizeReviewRead(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  sellerOrganizationId: string,
  history: boolean,
): Promise<void> {
  if (actor.staffStatus !== 'ACTIVE'
    || !actor.permissions.has('REVIEW_VIEW')
    || (history && !actor.permissions.has('REVIEW_DECIDE'))) {
    throw new ReviewError('FORBIDDEN', 403);
  }
  const scope = await resolveStaffDataScope(database, actor, {
    requiredPermission: history ? 'REVIEW_DECIDE' : 'REVIEW_VIEW',
  });
  try {
    requireSellerOrganizationScope(scope, sellerOrganizationId);
  } catch {
    throw new ReviewError('REVIEW_CASE_NOT_FOUND', 404);
  }
}

async function requireReview(
  database: SqlDatabase,
  reviewCaseId: string,
): Promise<ReviewRow> {
  const row = await database.prepare(`
    SELECT
      id AS review_case_id,
      formal_order_id,
      buyer_customer_id,
      seller_organization_id,
      review_type,
      status,
      version,
      current_evidence_version_no,
      public_change_reason,
      internal_review_note,
      submitted_at,
      updated_at,
      decided_at
    FROM review_cases
    WHERE id=?
  `).bind(reviewCaseId).first<ReviewRow>();
  if (!row) throw new ReviewError('REVIEW_CASE_NOT_FOUND', 404);
  return row;
}

async function readVersions(
  database: SqlDatabase,
  reviewCaseId: string,
  versionNos: readonly number[] | null,
): Promise<readonly StaffReviewEvidenceVersionDto[]> {
  const filter = versionNos === null
    ? { sql: '', values: [] as readonly number[] }
    : {
        sql: `AND evidence.version_no IN (${versionNos.map(() => '?').join(', ')})`,
        values: versionNos,
      };
  const evidence = await database.prepare(`
    SELECT
      evidence.id AS evidence_version_id,
      evidence.version_no,
      evidence.review_type,
      evidence.review_url,
      evidence.buyer_note,
      evidence.submitted_by_buyer_id,
      evidence.created_at AS submitted_at
    FROM review_evidence_versions evidence
    WHERE evidence.review_case_id=? ${filter.sql}
    ORDER BY evidence.version_no
  `).bind(reviewCaseId, ...filter.values).all<EvidenceRow>();
  const ids = evidence.results.map((row) => row.evidence_version_id);
  const files = ids.length === 0
    ? []
    : (await database.prepare(`
        SELECT
          version_file.evidence_version_id,
          object.id AS file_object_id,
          link.id AS file_entity_link_id,
          intent.client_file_name,
          COALESCE(object.detected_mime, object.declared_mime) AS mime,
          object.byte_size,
          object.verified_at
        FROM review_evidence_version_files version_file
        JOIN file_objects object ON object.id=version_file.file_object_id
        JOIN file_upload_intents intent ON intent.id=object.upload_intent_id
        JOIN file_entity_links link ON link.id=version_file.file_entity_link_id
        WHERE version_file.evidence_version_id IN (${ids.map(() => '?').join(', ')})
          AND object.status='VERIFIED'
          AND link.revoked_at IS NULL
        ORDER BY version_file.created_at, version_file.id
      `).bind(...ids).all<FileRow>()).results;
  const grouped = new Map<string, StaffReviewEvidenceFileDto[]>();
  for (const file of files) {
    const values = grouped.get(file.evidence_version_id) ?? [];
    values.push(Object.freeze({
      file_object_id: file.file_object_id,
      file_entity_link_id: file.file_entity_link_id,
      client_file_name: file.client_file_name,
      mime: file.mime,
      byte_size: Number(file.byte_size),
      verified_at: Number(file.verified_at),
    }));
    grouped.set(file.evidence_version_id, values);
  }
  return Object.freeze(evidence.results.map((row) => Object.freeze({
    evidence_version_id: row.evidence_version_id,
    version_no: Number(row.version_no),
    review_type: row.review_type,
    review_url: row.review_url,
    buyer_note: row.buyer_note,
    submitted_by_buyer_id: row.submitted_by_buyer_id,
    submitted_at: Number(row.submitted_at),
    files: Object.freeze(grouped.get(row.evidence_version_id) ?? []),
  })));
}

function normalizeReview(row: ReviewRow): Omit<StaffReviewDto, 'current_evidence'> {
  return {
    review_case_id: row.review_case_id,
    formal_order_id: row.formal_order_id,
    buyer_customer_id: row.buyer_customer_id,
    seller_organization_id: row.seller_organization_id,
    review_type: row.review_type,
    status: row.status,
    version: Number(row.version),
    current_evidence_version_no: Number(row.current_evidence_version_no),
    public_change_reason: row.public_change_reason,
    internal_review_note: row.internal_review_note,
    submitted_at: Number(row.submitted_at),
    updated_at: Number(row.updated_at),
    decided_at: row.decided_at === null ? null : Number(row.decided_at),
  };
}