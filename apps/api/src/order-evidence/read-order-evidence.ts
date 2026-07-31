import type {
  BuyerOrderEvidenceProjection,
  OrderEvidenceFileProjection,
  SqlDatabase,
  StaffOrderEvidenceProjection,
} from '@ygb/contracts';
import {
  requireCurrentOrderEvidenceForBuyer,
  requireCurrentOrderEvidenceForStaff,
  type CurrentOrderEvidenceRow,
} from './order-evidence-records';
import {
  cleanOrderEvidenceIdentifier,
  requireOrderEvidenceViewPermission,
  validateBuyerOrderEvidenceActor,
  type BuyerOrderEvidenceActor,
  OrderEvidenceError,
  type StaffOrderEvidenceActor,
} from './order-evidence-shared';

export async function readBuyerOrderEvidence(
  database: SqlDatabase,
  input: { submissionId: string },
  actor: BuyerOrderEvidenceActor,
): Promise<BuyerOrderEvidenceProjection> {
  validateBuyerOrderEvidenceActor(actor);
  const submissionId = cleanOrderEvidenceIdentifier(
    input.submissionId,
    120,
  );
  const source = await requireCurrentOrderEvidenceForBuyer(
    database,
    submissionId,
    actor.buyerCustomerId,
  );
  return toBuyerProjection(
    source,
    await listCurrentVersionFiles(
      database,
      source.evidence_version_id,
    ),
  );
}

export async function readStaffOrderEvidence(
  database: SqlDatabase,
  input: { submissionId: string },
  actor: StaffOrderEvidenceActor,
): Promise<StaffOrderEvidenceProjection> {
  requireOrderEvidenceViewPermission(actor);
  const submissionId = cleanOrderEvidenceIdentifier(
    input.submissionId,
    120,
  );
  const source = await requireCurrentOrderEvidenceForStaff(
    database,
    submissionId,
  );
  return toStaffProjection(database, source);
}

export async function listOrderEvidenceForReview(
  database: SqlDatabase,
  input: { limit?: number } = {},
  actor: StaffOrderEvidenceActor,
): Promise<readonly StaffOrderEvidenceProjection[]> {
  requireOrderEvidenceViewPermission(actor);
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new OrderEvidenceError('VALIDATION_ERROR', 400);
  }
  const rows = await database.prepare(`
    SELECT submission.id AS submission_id
    FROM order_evidence_submissions submission
    WHERE submission.status='PENDING_VERIFICATION'
    ORDER BY submission.updated_at, submission.id
    LIMIT ?
  `).bind(limit).all<{ submission_id: string }>();

  return Promise.all(rows.results.map(async (row) => {
    const source = await requireCurrentOrderEvidenceForStaff(
      database,
      row.submission_id,
    );
    return toStaffProjection(database, source);
  }));
}

async function toStaffProjection(
  database: SqlDatabase,
  source: CurrentOrderEvidenceRow,
): Promise<StaffOrderEvidenceProjection> {
  const files = await listCurrentVersionFiles(
    database,
    source.evidence_version_id,
  );
  const duplicateRow = await database.prepare(`
    SELECT COUNT(*) AS duplicate_count
    FROM order_evidence_duplicate_signals
    WHERE source_version_id=?
  `).bind(
    source.evidence_version_id,
  ).first<{ duplicate_count: number }>();

  return {
    ...toBuyerProjection(source, files),
    buyer_customer_id: source.buyer_customer_id,
    internal_review_note: source.internal_review_note,
    verified_by_staff_id: source.verified_by_staff_id,
    duplicate_signal_count: Number(
      duplicateRow?.duplicate_count ?? 0,
    ),
  };
}

function toBuyerProjection(
  source: CurrentOrderEvidenceRow,
  files: readonly OrderEvidenceFileProjection[],
): BuyerOrderEvidenceProjection {
  return {
    submission_id: source.submission_id,
    reservation_id: source.reservation_id,
    marketplace: source.marketplace_code,
    status: source.status,
    version: source.aggregate_version,
    evidence_version_no: source.current_version_no,
    amazon_order_number_raw: source.amazon_order_number_raw,
    amazon_order_number_normalized:
      source.amazon_order_number_normalized,
    final_paid_jpy: source.final_paid_jpy,
    buyer_note: source.buyer_note,
    public_change_reason: source.public_change_reason,
    submitted_at: source.submitted_at,
    updated_at: source.updated_at,
    verified_at: source.verified_at,
    withdrawn_at: source.withdrawn_at,
    files,
  };
}

async function listCurrentVersionFiles(
  database: SqlDatabase,
  evidenceVersionId: string,
): Promise<readonly OrderEvidenceFileProjection[]> {
  const rows = await database.prepare(`
    SELECT
      file_object_id,
      visibility
    FROM order_evidence_version_files
    WHERE version_id=?
    ORDER BY created_at, id
  `).bind(
    evidenceVersionId,
  ).all<OrderEvidenceFileProjection>();
  return Object.freeze(rows.results.map((row) => Object.freeze({
    file_object_id: row.file_object_id,
    visibility: row.visibility,
  })));
}
