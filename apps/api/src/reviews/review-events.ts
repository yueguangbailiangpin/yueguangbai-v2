import type {
  ReviewCaseStatus,
  ReviewEventType,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { canonicalJson } from '@ygb/domain';

export function insertReviewEventStatement(
  database: SqlDatabase,
  input: {
    eventId?: string;
    reviewCaseId: string;
    formalOrderId: string;
    evidenceVersionId: string;
    eventType: ReviewEventType;
    actorType: 'BUYER_CUSTOMER' | 'STAFF';
    actorId: string;
    previousStatus: ReviewCaseStatus | null;
    nextStatus: ReviewCaseStatus;
    caseVersion: number;
    amountCnyFen?: number | null;
    financialSnapshotId?: string | null;
    publicReason?: string | null;
    internalNote?: string | null;
    metadata?: unknown;
    idempotencyKey: string;
    createdAt: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO review_events (
      id,
      review_case_id,
      formal_order_id,
      evidence_version_id,
      event_type,
      actor_type,
      actor_id,
      previous_status,
      next_status,
      case_version,
      amount_cny_fen,
      formal_order_financial_snapshot_id,
      public_reason,
      internal_note,
      metadata_json,
      idempotency_key,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.eventId ?? crypto.randomUUID(),
    input.reviewCaseId,
    input.formalOrderId,
    input.evidenceVersionId,
    input.eventType,
    input.actorType,
    input.actorId,
    input.previousStatus,
    input.nextStatus,
    input.caseVersion,
    input.amountCnyFen ?? null,
    input.financialSnapshotId ?? null,
    input.publicReason ?? null,
    input.internalNote ?? null,
    canonicalJson(input.metadata ?? {}),
    input.idempotencyKey,
    input.createdAt,
  );
}
