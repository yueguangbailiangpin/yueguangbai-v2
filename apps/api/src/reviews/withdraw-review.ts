import type {
  ReviewTransitionResult,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import {
  createOutboxStatements,
  prepareOutboxEvent,
} from '../foundation/outbox';
import { requireCurrentReviewCaseForBuyer } from './review-records';
import { insertReviewEventStatement } from './review-events';
import {
  assertPreviousStatementChangedOnce,
  cleanExpectedVersion,
  cleanReviewIdentifier,
  cleanReviewTimestamp,
  normalizeReviewError,
  ReviewError,
  validateBuyerReviewActor,
  type BuyerReviewActor,
} from './review-shared';

export async function withdrawReview(
  database: SqlDatabase,
  input: {
    reviewCaseId: string;
    expectedVersion: number;
  },
  command: {
    actor: BuyerReviewActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<ReviewTransitionResult> {
  validateBuyerReviewActor(command.actor);
  const reviewCaseId = cleanReviewIdentifier(input.reviewCaseId);
  const expectedVersion = cleanExpectedVersion(input.expectedVersion);
  const now = cleanReviewTimestamp(command.now ?? Date.now());
  const requestHash = await hashCanonicalJson({
    action: 'WITHDRAW_REVIEW',
    review_case_id: reviewCaseId,
    expected_version: expectedVersion,
  });
  const acquired = await acquireIdempotency<ReviewTransitionResult>(
    database,
    {
      actorType: 'BUYER_CUSTOMER',
      actorId: command.actor.buyerCustomerId,
      action: 'WITHDRAW_REVIEW',
      targetType: 'REVIEW_CASE',
      targetId: reviewCaseId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const source = await requireCurrentReviewCaseForBuyer(
      database,
      reviewCaseId,
      command.actor.buyerCustomerId,
    );
    if (source.version !== expectedVersion) {
      throw new ReviewError('VERSION_CONFLICT', 409);
    }
    if (source.status !== 'PENDING_REVIEW'
      && source.status !== 'CHANGES_REQUESTED') {
      throw new ReviewError('REVIEW_STATE_CONFLICT', 409);
    }
    const nextVersion = source.version + 1;
    const response: ReviewTransitionResult = {
      review_case_id: source.review_case_id,
      formal_order_id: source.formal_order_id,
      status: 'WITHDRAWN',
      version: nextVersion,
      current_evidence_version_no: source.current_evidence_version_no,
      current_evidence_version_id: source.current_evidence_version_id,
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `review-withdrawn:${source.review_case_id}`,
      eventType: 'REVIEW_WITHDRAWN',
      aggregateType: 'REVIEW_CASE',
      aggregateId: source.review_case_id,
      payload: response,
      createdAt: now,
    });
    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE review_cases
        SET
          status='WITHDRAWN',
          version=version+1,
          updated_at=MAX(?, updated_at+1),
          decided_by_staff_id=NULL,
          decided_at=NULL,
          withdrawn_at=?
        WHERE id=?
          AND buyer_customer_id=?
          AND status IN ('PENDING_REVIEW', 'CHANGES_REQUESTED')
          AND version=?
      `).bind(
        now,
        now,
        source.review_case_id,
        source.buyer_customer_id,
        expectedVersion,
      ),
      assertPreviousStatementChangedOnce(database),
      insertReviewEventStatement(database, {
        reviewCaseId: source.review_case_id,
        formalOrderId: source.formal_order_id,
        evidenceVersionId: source.current_evidence_version_id,
        eventType: 'REVIEW_WITHDRAWN',
        actorType: 'BUYER_CUSTOMER',
        actorId: source.buyer_customer_id,
        previousStatus: source.status,
        nextStatus: 'WITHDRAWN',
        caseVersion: nextVersion,
        metadata: {
          evidence_version_no: source.current_evidence_version_no,
        },
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'REVIEW_CASE',
        aggregateId: source.review_case_id,
        eventType: 'REVIEW_WITHDRAWN',
        actor: {
          type: 'BUYER_CUSTOMER',
          id: source.buyer_customer_id,
          roles: [],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          status: source.status,
          version: source.version,
        },
        nextState: response,
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        {
          resultReferences: {
            review_case_id: source.review_case_id,
            formal_order_id: source.formal_order_id,
          },
          now,
        },
      ),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN
          EXISTS (
            SELECT 1 FROM review_cases
            WHERE id=?
              AND buyer_customer_id=?
              AND status='WITHDRAWN'
              AND version=?
              AND withdrawn_at=?
          )
          AND EXISTS (
            SELECT 1 FROM review_events
            WHERE review_case_id=?
              AND event_type='REVIEW_WITHDRAWN'
              AND case_version=?
          )
          AND EXISTS (
            SELECT 1 FROM command_idempotency_records
            WHERE actor_type=?
              AND actor_id=?
              AND idempotency_key=?
              AND status='COMMITTED'
              AND lease_token=?
          )
        THEN 1 ELSE 0 END
      `).bind(
        source.review_case_id,
        source.buyer_customer_id,
        nextVersion,
        now,
        source.review_case_id,
        nextVersion,
        acquired.claim.actorType,
        acquired.claim.actorId,
        acquired.claim.idempotencyKey,
        acquired.claim.leaseToken,
      ),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ];
    await database.batch(statements);
    return response;
  } catch (error) {
    const normalized = normalizeReviewError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    ).catch(() => false);
    throw normalized;
  }
}
