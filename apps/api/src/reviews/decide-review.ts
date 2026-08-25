import type {
  ApproveReviewResult,
  ReviewTransitionResult,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import { prepareBuyerRefundObligationFromReviewApproval } from '../buyer-refunds';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import {
  createOutboxStatements,
  prepareOutboxEvent,
  type PreparedOutboxEvent,
} from '../foundation/outbox';
import {
  batchWithAssignmentRetry,
  prepareWorkItemCompletionStatements,
  prepareDirectWorkItem,
  requireAssignedWorkflowActor,
} from '../staff-assignment';
import { requireCurrentReviewCaseForStaff } from './review-records';
import { insertReviewEventStatement } from './review-events';
import {
  assertPreviousStatementChangedOnce,
  cleanExpectedVersion,
  cleanOptionalReviewText,
  cleanRequiredReviewText,
  cleanReviewIdentifier,
  cleanReviewTimestamp,
  normalizeReviewError,
  requireReviewDecisionPermission,
  ReviewError,
  type StaffReviewActor,
} from './review-shared';

type DecisionMode = 'REQUEST_CHANGES' | 'REJECT' | 'APPROVE';
type DecisionResult = ReviewTransitionResult | ApproveReviewResult;

export async function requestReviewChanges(
  database: SqlDatabase,
  input: {
    reviewCaseId: string;
    expectedVersion: number;
    publicReason: string;
    internalNote?: string | null;
  },
  command: StaffReviewCommand,
): Promise<ReviewTransitionResult> {
  return transitionReview(database, {
    mode: 'REQUEST_CHANGES',
    reviewCaseId: input.reviewCaseId,
    expectedVersion: input.expectedVersion,
    publicReason: input.publicReason,
    internalNote: input.internalNote,
  }, command) as Promise<ReviewTransitionResult>;
}

export async function rejectReview(
  database: SqlDatabase,
  input: {
    reviewCaseId: string;
    expectedVersion: number;
    publicReason: string;
    internalNote?: string | null;
  },
  command: StaffReviewCommand,
): Promise<ReviewTransitionResult> {
  return transitionReview(database, {
    mode: 'REJECT',
    reviewCaseId: input.reviewCaseId,
    expectedVersion: input.expectedVersion,
    publicReason: input.publicReason,
    internalNote: input.internalNote,
  }, command) as Promise<ReviewTransitionResult>;
}

export async function approveReview(
  database: SqlDatabase,
  input: {
    reviewCaseId: string;
    expectedVersion: number;
    internalNote?: string | null;
  },
  command: StaffReviewCommand,
): Promise<ApproveReviewResult> {
  return transitionReview(database, {
    mode: 'APPROVE',
    reviewCaseId: input.reviewCaseId,
    expectedVersion: input.expectedVersion,
    publicReason: null,
    internalNote: input.internalNote,
  }, command) as Promise<ApproveReviewResult>;
}

interface StaffReviewCommand {
  actor: StaffReviewActor;
  idempotencyKey: string;
  requestId?: string | null;
  now?: number;
}

async function transitionReview(
  database: SqlDatabase,
  input: {
    mode: DecisionMode;
    reviewCaseId: string;
    expectedVersion: number;
    publicReason: string | null;
    internalNote: string | null | undefined;
  },
  command: StaffReviewCommand,
): Promise<DecisionResult> {
  requireReviewDecisionPermission(command.actor);
  const reviewCaseId = cleanReviewIdentifier(input.reviewCaseId);
  const expectedVersion = cleanExpectedVersion(input.expectedVersion);
  const publicReason = input.mode === 'APPROVE'
    ? null
    : cleanRequiredReviewText(input.publicReason ?? '', 2000);
  const internalNote = cleanOptionalReviewText(input.internalNote, 4000);
  const now = cleanReviewTimestamp(command.now ?? Date.now());
  const action = decisionAction(input.mode);

  const requestHash = await hashCanonicalJson({
    action,
    review_case_id: reviewCaseId,
    expected_version: expectedVersion,
    public_reason: publicReason,
    internal_note: internalNote,
  });
  const acquired = await acquireIdempotency<DecisionResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action,
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
    const source = await requireCurrentReviewCaseForStaff(
      database,
      reviewCaseId,
    );
    if (source.version !== expectedVersion) {
      throw new ReviewError('VERSION_CONFLICT', 409);
    }
    if (source.status !== 'PENDING_REVIEW') {
      throw new ReviewError('REVIEW_STATE_CONFLICT', 409);
    }

    await requireAssignedWorkflowActor(database, {
      staffId: command.actor.staffId,
      workType: 'REVIEW_DECISION',
      sourceEntityType: 'REVIEW_CASE',
      sourceEntityId: reviewCaseId,
    });

    const nextVersion = source.version + 1;
    const nextStatus = decisionStatus(input.mode);
    const eventType = decisionEventType(input.mode);
    const approvedEventId = input.mode === 'APPROVE'
      ? crypto.randomUUID()
      : null;
    const buyerRefundEventId = input.mode === 'APPROVE'
      ? crypto.randomUUID()
      : null;
    const sellerFeeEventId = input.mode === 'APPROVE'
      ? crypto.randomUUID()
      : null;

    const response: DecisionResult = input.mode === 'APPROVE'
      ? {
          review_case_id: source.review_case_id,
          formal_order_id: source.formal_order_id,
          status: 'APPROVED',
          version: nextVersion,
          current_evidence_version_no: source.current_evidence_version_no,
          current_evidence_version_id: source.current_evidence_version_id,
          approved_event_id: approvedEventId as string,
          financial_events: [
            {
              event_id: buyerRefundEventId as string,
              event_type: 'BUYER_REFUND_BECAME_DUE',
              amount_cny_fen: String(
                source.buyer_expected_principal_cny_fen,
              ),
              formal_order_financial_snapshot_id:
                source.financial_snapshot_id,
            },
            {
              event_id: sellerFeeEventId as string,
              event_type: 'SELLER_SERVICE_FEE_ACCRUED',
              amount_cny_fen: String(source.service_fee_cny_fen),
              formal_order_financial_snapshot_id:
                source.financial_snapshot_id,
            },
          ],
          replayed: false,
        }
      : {
          review_case_id: source.review_case_id,
          formal_order_id: source.formal_order_id,
          status: nextStatus as 'CHANGES_REQUESTED' | 'REJECTED',
          version: nextVersion,
          current_evidence_version_no: source.current_evidence_version_no,
          current_evidence_version_id: source.current_evidence_version_id,
          replayed: false,
        };

    const outboxes = await prepareDecisionOutboxes(
      input.mode,
      source,
      response,
      now,
    );
    const preparedRefund = input.mode === 'APPROVE'
      ? await prepareBuyerRefundObligationFromReviewApproval(database, {
          sourceReviewEventId: buyerRefundEventId as string,
          reviewCaseId: source.review_case_id,
          formalOrderId: source.formal_order_id,
          buyerCustomerId: source.buyer_customer_id,
          dueAmountCnyFen: source.buyer_expected_principal_cny_fen,
          actorStaffId: command.actor.staffId,
          actorRoles: command.actor.roles,
          requestId: command.requestId ?? null,
          idempotencyKey: acquired.claim.idempotencyKey,
          now,
        })
      : null;

    const statements: SqlStatement[] = [
      updateReviewCaseDecisionStatement(database, {
        mode: input.mode,
        reviewCaseId,
        expectedVersion,
        publicReason,
        internalNote,
        staffId: command.actor.staffId,
        now,
      }),
      assertPreviousStatementChangedOnce(database),
      insertReviewEventStatement(database, {
        ...(approvedEventId === null ? {} : { eventId: approvedEventId }),
        reviewCaseId: source.review_case_id,
        formalOrderId: source.formal_order_id,
        evidenceVersionId: source.current_evidence_version_id,
        eventType,
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        previousStatus: 'PENDING_REVIEW',
        nextStatus,
        caseVersion: nextVersion,
        publicReason,
        internalNote,
        metadata: {
          review_type: source.review_type,
          evidence_version_no: source.current_evidence_version_no,
        },
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
    ];

    if (input.mode === 'APPROVE') {
      statements.push(
        insertReviewEventStatement(database, {
          eventId: buyerRefundEventId as string,
          reviewCaseId: source.review_case_id,
          formalOrderId: source.formal_order_id,
          evidenceVersionId: source.current_evidence_version_id,
          eventType: 'BUYER_REFUND_BECAME_DUE',
          actorType: 'STAFF',
          actorId: command.actor.staffId,
          previousStatus: 'PENDING_REVIEW',
          nextStatus: 'APPROVED',
          caseVersion: nextVersion,
          amountCnyFen: source.buyer_expected_principal_cny_fen,
          financialSnapshotId: source.financial_snapshot_id,
          internalNote,
          metadata: {
            source: 'FORMAL_ORDER_FINANCIAL_SNAPSHOT',
            creates_actual_refund: false,
          },
          idempotencyKey: acquired.claim.idempotencyKey,
          createdAt: now,
        }),
        insertReviewEventStatement(database, {
          eventId: sellerFeeEventId as string,
          reviewCaseId: source.review_case_id,
          formalOrderId: source.formal_order_id,
          evidenceVersionId: source.current_evidence_version_id,
          eventType: 'SELLER_SERVICE_FEE_ACCRUED',
          actorType: 'STAFF',
          actorId: command.actor.staffId,
          previousStatus: 'PENDING_REVIEW',
          nextStatus: 'APPROVED',
          caseVersion: nextVersion,
          amountCnyFen: source.service_fee_cny_fen,
          financialSnapshotId: source.financial_snapshot_id,
          internalNote,
          metadata: {
            source: 'FORMAL_ORDER_FINANCIAL_SNAPSHOT',
            creates_actual_settlement: false,
          },
          idempotencyKey: acquired.claim.idempotencyKey,
          createdAt: now,
        }),
      );
    }

    statements.push(
      ...(preparedRefund?.statements ?? []),
      ...decisionAuditStatements(database, {
        mode: input.mode,
        source,
        response,
        actor: command.actor,
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        publicReason,
        internalNote,
        now,
      }),
      ...outboxes.flatMap((outbox) => createOutboxStatements(
        database,
        outbox,
      )),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        {
          resultReferences: {
            review_case_id: source.review_case_id,
            formal_order_id: source.formal_order_id,
            financial_snapshot_id: input.mode === 'APPROVE'
              ? source.financial_snapshot_id
              : null,
          },
          now,
        },
      ),
      assertDecisionCompletedStatement(database, {
        mode: input.mode,
        reviewCaseId: source.review_case_id,
        nextStatus,
        nextVersion,
        financialSnapshotId: source.financial_snapshot_id,
        buyerRefundAmount: source.buyer_expected_principal_cny_fen,
        sellerFeeAmount: source.service_fee_cny_fen,
        claim: acquired.claim,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    );

    const reviewCompletion = await prepareWorkItemCompletionStatements(database, {
      workType: 'REVIEW_DECISION',
      sourceEntityType: 'REVIEW_CASE',
      sourceEntityId: reviewCaseId,
      outcome: 'COMPLETED',
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      requestId: command.requestId ?? null,
      idempotencyKey: acquired.claim.idempotencyKey,
      now,
    });
    if (preparedRefund !== null
      && source.buyer_expected_principal_cny_fen > 0) {
      await batchWithAssignmentRetry(
        database,
        () => prepareDirectWorkItem(database, {
          workType: 'BUYER_REFUND_PROCESSING',
          sourceEntityType: 'BUYER_REFUND_OBLIGATION',
          sourceEntityId: preparedRefund.obligationId,
          marketplaceCode: 'AMAZON_JP',
          buyerCustomerId: source.buyer_customer_id,
          sellerOrganizationId: source.seller_organization_id,
          actorType: 'STAFF',
          actorId: command.actor.staffId,
          requestId: command.requestId ?? null,
          idempotencyKey: acquired.claim.idempotencyKey,
          reason: 'buyer refund became due',
          now,
        }),
        [...statements, ...reviewCompletion],
      );
    } else {
      await database.batch([...statements, ...reviewCompletion]);
    }
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

function updateReviewCaseDecisionStatement(
  database: SqlDatabase,
  input: {
    mode: DecisionMode;
    reviewCaseId: string;
    expectedVersion: number;
    publicReason: string | null;
    internalNote: string | null;
    staffId: string;
    now: number;
  },
): SqlStatement {
  return database.prepare(`
    UPDATE review_cases
    SET
      status=?,
      version=version+1,
      public_change_reason=?,
      internal_review_note=?,
      updated_at=MAX(?, updated_at+1),
      decided_by_staff_id=?,
      decided_at=?,
      withdrawn_at=NULL
    WHERE id=?
      AND status='PENDING_REVIEW'
      AND version=?
  `).bind(
    decisionStatus(input.mode),
    input.publicReason,
    input.internalNote,
    input.now,
    input.staffId,
    input.now,
    input.reviewCaseId,
    input.expectedVersion,
  );
}

async function prepareDecisionOutboxes(
  mode: DecisionMode,
  source: Awaited<ReturnType<typeof requireCurrentReviewCaseForStaff>>,
  response: DecisionResult,
  now: number,
): Promise<readonly PreparedOutboxEvent[]> {
  const baseOutboxId = crypto.randomUUID();
  const base = await prepareOutboxEvent({
    id: baseOutboxId,
    dedupKey: `review-decision:${baseOutboxId}`,
    eventType: decisionEventType(mode),
    aggregateType: 'REVIEW_CASE',
    aggregateId: source.review_case_id,
    payload: response,
    createdAt: now,
  });
  if (mode !== 'APPROVE') return [base];
  const approved = response as ApproveReviewResult;
  const financial = await Promise.all(approved.financial_events.map(
    (event) => prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `review-financial:${event.event_id}`,
      eventType: event.event_type,
      aggregateType: 'FORMAL_ORDER',
      aggregateId: source.formal_order_id,
      payload: {
        review_case_id: source.review_case_id,
        formal_order_id: source.formal_order_id,
        event_id: event.event_id,
        amount_cny_fen: event.amount_cny_fen,
        formal_order_financial_snapshot_id:
          event.formal_order_financial_snapshot_id,
        creates_actual_payment: false,
        creates_settlement: false,
        creates_profit: false,
      },
      createdAt: now,
    }),
  ));
  return [base, ...financial];
}

function decisionAuditStatements(
  database: SqlDatabase,
  input: {
    mode: DecisionMode;
    source: Awaited<ReturnType<typeof requireCurrentReviewCaseForStaff>>;
    response: DecisionResult;
    actor: StaffReviewActor;
    requestId: string | null;
    idempotencyKey: string;
    publicReason: string | null;
    internalNote: string | null;
    now: number;
  },
): readonly SqlStatement[] {
  const base = createAuditEventStatement(database, {
    id: crypto.randomUUID(),
    aggregateType: 'REVIEW_CASE',
    aggregateId: input.source.review_case_id,
    eventType: decisionEventType(input.mode),
    actor: {
      type: 'STAFF',
      id: input.actor.staffId,
      roles: input.actor.roles,
    },
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    previousState: {
      status: input.source.status,
      version: input.source.version,
      evidence_version_no: input.source.current_evidence_version_no,
    },
    nextState: input.response,
    reason: input.publicReason,
    metadata: { internal_review_note: input.internalNote },
    createdAt: input.now,
  });
  if (input.mode !== 'APPROVE') return [base];
  const approval = input.response as ApproveReviewResult;
  return [
    base,
    ...approval.financial_events.map((event) => createAuditEventStatement(
      database,
      {
        id: crypto.randomUUID(),
        aggregateType: 'FORMAL_ORDER',
        aggregateId: input.source.formal_order_id,
        eventType: event.event_type,
        actor: {
          type: 'STAFF',
          id: input.actor.staffId,
          roles: input.actor.roles,
        },
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        previousState: null,
        nextState: event,
        metadata: {
          review_case_id: input.source.review_case_id,
          source: 'FORMAL_ORDER_FINANCIAL_SNAPSHOT',
          creates_actual_payment: false,
        },
        createdAt: input.now,
      },
    )),
  ];
}

function assertDecisionCompletedStatement(
  database: SqlDatabase,
  input: {
    mode: DecisionMode;
    reviewCaseId: string;
    nextStatus: 'CHANGES_REQUESTED' | 'REJECTED' | 'APPROVED';
    nextVersion: number;
    financialSnapshotId: string;
    buyerRefundAmount: number;
    sellerFeeAmount: number;
    claim: {
      actorType: string;
      actorId: string;
      idempotencyKey: string;
      leaseToken: string;
    };
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM review_cases
        WHERE id=?
          AND status=?
          AND version=?
      )
      AND (
        (?<>'APPROVE' AND (
          SELECT COUNT(*) FROM review_events
          WHERE review_case_id=? AND case_version=?
        )=1)
        OR
        (?='APPROVE'
          AND (
            SELECT COUNT(*) FROM review_events
            WHERE review_case_id=?
              AND event_type IN (
                'REVIEW_APPROVED',
                'BUYER_REFUND_BECAME_DUE',
                'SELLER_SERVICE_FEE_ACCRUED'
              )
          )=3
          AND EXISTS (
            SELECT 1 FROM review_events
            WHERE review_case_id=?
              AND event_type='BUYER_REFUND_BECAME_DUE'
              AND amount_cny_fen=?
              AND formal_order_financial_snapshot_id=?
          )
          AND EXISTS (
            SELECT 1 FROM review_events
            WHERE review_case_id=?
              AND event_type='SELLER_SERVICE_FEE_ACCRUED'
              AND amount_cny_fen=?
              AND formal_order_financial_snapshot_id=?
          ))
      )
      AND EXISTS (
        SELECT 1
        FROM command_idempotency_records
        WHERE actor_type=?
          AND actor_id=?
          AND idempotency_key=?
          AND status='COMMITTED'
          AND lease_token=?
      )
    THEN 1 ELSE 0 END
  `).bind(
    input.reviewCaseId,
    input.nextStatus,
    input.nextVersion,
    input.mode,
    input.reviewCaseId,
    input.nextVersion,
    input.mode,
    input.reviewCaseId,
    input.reviewCaseId,
    input.buyerRefundAmount,
    input.financialSnapshotId,
    input.reviewCaseId,
    input.sellerFeeAmount,
    input.financialSnapshotId,
    input.claim.actorType,
    input.claim.actorId,
    input.claim.idempotencyKey,
    input.claim.leaseToken,
  );
}

function decisionAction(mode: DecisionMode): string {
  if (mode === 'REQUEST_CHANGES') return 'REQUEST_REVIEW_CHANGES';
  if (mode === 'REJECT') return 'REJECT_REVIEW';
  return 'APPROVE_REVIEW';
}

function decisionStatus(
  mode: DecisionMode,
): 'CHANGES_REQUESTED' | 'REJECTED' | 'APPROVED' {
  if (mode === 'REQUEST_CHANGES') return 'CHANGES_REQUESTED';
  if (mode === 'REJECT') return 'REJECTED';
  return 'APPROVED';
}

function decisionEventType(
  mode: DecisionMode,
): 'REVIEW_CHANGES_REQUESTED' | 'REVIEW_REJECTED' | 'REVIEW_APPROVED' {
  if (mode === 'REQUEST_CHANGES') return 'REVIEW_CHANGES_REQUESTED';
  if (mode === 'REJECT') return 'REVIEW_REJECTED';
  return 'REVIEW_APPROVED';
}
