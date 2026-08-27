import type {
  RequestOrderEvidenceChangesResult,
  SqlDatabase,
  SqlStatement,
  VerifyOrderEvidenceResult,
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
  setChangesRequestedDeadlineStatements,
} from '../order-instructions/evidence-integration';
import {
  prepareWorkItemCompletionStatements,
  requireAssignedWorkflowActor,
} from '../staff-assignment';
import { requireCurrentOrderEvidenceForStaff } from './order-evidence-records';
import {
  cleanOptionalOrderEvidenceText,
  cleanOrderEvidenceIdentifier,
  cleanRequiredOrderEvidenceText,
  insertOrderEvidenceEventStatement,
  normalizeOrderEvidenceError,
  OrderEvidenceError,
  requireOrderEvidenceDecisionPermission,
  validateCommandTime,
  validateExpectedVersion,
  type StaffOrderEvidenceActor,
} from './order-evidence-shared';

type ReviewMode = 'REQUEST_CHANGES' | 'VERIFY';

type ReviewResult =
  | RequestOrderEvidenceChangesResult
  | VerifyOrderEvidenceResult;

export async function requestOrderEvidenceChanges(
  database: SqlDatabase,
  input: {
    submissionId: string;
    expectedVersion: number;
    publicReason: string;
    internalNote?: string | null;
  },
  command: {
    actor: StaffOrderEvidenceActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<RequestOrderEvidenceChangesResult> {
  return transitionOrderEvidence(
    database,
    {
      mode: 'REQUEST_CHANGES',
      submissionId: input.submissionId,
      expectedVersion: input.expectedVersion,
      publicReason: input.publicReason,
      internalNote: input.internalNote,
    },
    command,
  );
}

export async function verifyOrderEvidence(
  database: SqlDatabase,
  input: {
    submissionId: string;
    expectedVersion: number;
    internalNote?: string | null;
  },
  command: {
    actor: StaffOrderEvidenceActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<VerifyOrderEvidenceResult> {
  return transitionOrderEvidence(
    database,
    {
      mode: 'VERIFY',
      submissionId: input.submissionId,
      expectedVersion: input.expectedVersion,
      publicReason: null,
      internalNote: input.internalNote,
    },
    command,
  );
}

function transitionOrderEvidence(
  database: SqlDatabase,
  input: {
    mode: 'REQUEST_CHANGES';
    submissionId: string;
    expectedVersion: number;
    publicReason: string;
    internalNote: string | null | undefined;
  },
  command: {
    actor: StaffOrderEvidenceActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<RequestOrderEvidenceChangesResult>;
function transitionOrderEvidence(
  database: SqlDatabase,
  input: {
    mode: 'VERIFY';
    submissionId: string;
    expectedVersion: number;
    publicReason: null;
    internalNote: string | null | undefined;
  },
  command: {
    actor: StaffOrderEvidenceActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<VerifyOrderEvidenceResult>;
async function transitionOrderEvidence(
  database: SqlDatabase,
  input: {
    mode: ReviewMode;
    submissionId: string;
    expectedVersion: number;
    publicReason: string | null;
    internalNote: string | null | undefined;
  },
  command: {
    actor: StaffOrderEvidenceActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<ReviewResult> {
  requireOrderEvidenceDecisionPermission(command.actor);
  const submissionId = cleanOrderEvidenceIdentifier(
    input.submissionId,
    120,
  );
  const expectedVersion = validateExpectedVersion(
    input.expectedVersion,
  );
  const publicReason = input.mode === 'REQUEST_CHANGES'
    ? cleanRequiredOrderEvidenceText(input.publicReason, 2000)
    : null;
  const internalNote = cleanOptionalOrderEvidenceText(
    input.internalNote,
    4000,
  );
  const now = validateCommandTime(command.now ?? Date.now());
  const action = input.mode === 'REQUEST_CHANGES'
    ? 'REQUEST_ORDER_EVIDENCE_CHANGES'
    : 'VERIFY_ORDER_EVIDENCE';

  const requestHash = await hashCanonicalJson({
    action,
    submission_id: submissionId,
    expected_version: expectedVersion,
    public_reason: publicReason,
    internal_note: internalNote,
  });
  const acquired = await acquireIdempotency<ReviewResult>(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action,
      targetType: 'ORDER_EVIDENCE',
      targetId: submissionId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return {
      ...acquired.response,
      replayed: true,
    };
  }

  try {
    const source = await requireCurrentOrderEvidenceForStaff(
      database,
      submissionId,
    );
    if (source.aggregate_version !== expectedVersion) {
      throw new OrderEvidenceError('VERSION_CONFLICT', 409);
    }
    if (source.status !== 'PENDING_VERIFICATION') {
      throw new OrderEvidenceError(
        'ORDER_EVIDENCE_STATE_CONFLICT',
        409,
      );
    }

    const instruction = await database.prepare(`
      SELECT id, version FROM order_instructions
      WHERE reservation_id=? AND status='ACTIVE'
    `).bind(source.reservation_id).first<{ id: string; version: number }>();
    if (!instruction) {
      throw new OrderEvidenceError('ORDER_EVIDENCE_STATE_CONFLICT', 409);
    }

    const nextVersion = source.aggregate_version + 1;
    const nextStatus = input.mode === 'REQUEST_CHANGES'
      ? 'CHANGES_REQUESTED'
      : 'VERIFIED';
    const eventType = input.mode === 'REQUEST_CHANGES'
      ? 'ORDER_EVIDENCE_CHANGES_REQUESTED'
      : 'ORDER_EVIDENCE_VERIFIED';
    const response: ReviewResult = input.mode === 'REQUEST_CHANGES'
      ? {
          submission_id: source.submission_id,
          reservation_id: source.reservation_id,
          buyer_customer_id: source.buyer_customer_id,
          marketplace: source.marketplace_code,
          status: 'CHANGES_REQUESTED',
          version: nextVersion,
          current_evidence_version_no: source.current_version_no,
          current_evidence_version_id: source.evidence_version_id,
          public_change_reason: publicReason as string,
          replayed: false,
        }
      : {
          submission_id: source.submission_id,
          reservation_id: source.reservation_id,
          buyer_customer_id: source.buyer_customer_id,
          marketplace: source.marketplace_code,
          status: 'VERIFIED',
          version: nextVersion,
          current_evidence_version_no: source.current_version_no,
          current_evidence_version_id: source.evidence_version_id,
          verified_at: now,
          verified_by_staff_id: command.actor.staffId,
          replayed: false,
        };

    await requireAssignedWorkflowActor(database, {
      staffId: command.actor.staffId,
      workType: 'ORDER_EVIDENCE_REVIEW',
      sourceEntityType: 'ORDER_EVIDENCE',
      sourceEntityId: submissionId,
    });

    const statements: SqlStatement[] = [
      ...(input.mode === 'REQUEST_CHANGES'
        ? setChangesRequestedDeadlineStatements(database, {
            instructionId: instruction.id,
            instructionAggregateVersion: Number(instruction.version),
            submissionId,
            reservationId: source.reservation_id,
            actorStaffId: command.actor.staffId,
            idempotencyKey: acquired.claim.idempotencyKey,
            now,
          })
        : [
            database.prepare(`
              UPDATE order_instructions
              SET resubmission_deadline_at=NULL, version=version+1,
                  updated_at=MAX(?, updated_at+1)
              WHERE id=? AND status='ACTIVE' AND version=?
            `).bind(now, instruction.id, instruction.version),
            database.prepare(`
              UPDATE order_evidence_submissions
              SET resubmission_deadline_at=NULL WHERE id=?
            `).bind(submissionId),
          ]),
      // Phase 3H access was resolved from persisted Staff facts above.
      updateReviewStateStatement(database, {
        mode: input.mode,
        submissionId,
        expectedVersion,
        publicReason,
        internalNote,
        staffId: command.actor.staffId,
        now,
      }),
      insertOrderEvidenceEventStatement(database, {
        submissionId,
        reservationId: source.reservation_id,
        buyerCustomerId: source.buyer_customer_id,
        evidenceVersionId: source.evidence_version_id,
        eventType,
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        previousStatus: source.status,
        nextStatus,
        aggregateVersion: nextVersion,
        publicReason,
        internalNote,
        metadata: {
          evidence_version_no: source.current_version_no,
        },
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: crypto.randomUUID(),
        aggregateType: 'ORDER_EVIDENCE',
        aggregateId: submissionId,
        eventType,
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          status: source.status,
          version: source.aggregate_version,
          evidence_version_no: source.current_version_no,
        },
        nextState: response,
        reason: publicReason,
        metadata: {
          internal_review_note: internalNote,
        },
        createdAt: now,
      }),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        {
          resultReferences: {
            submission_id: submissionId,
            evidence_version_id: source.evidence_version_id,
          },
          now,
        },
      ),
      assertReviewTransitionStatement(database, {
        claim: acquired.claim,
        submissionId,
        expectedEvidenceVersionNo: source.current_version_no,
        nextVersion,
        nextStatus,
        staffId: command.actor.staffId,
        now,
      }),
      assertIdempotencyCompletionStatement(
        database,
        acquired.claim,
      ),
    ];
    await database.batch([
      ...statements,
      ...await prepareWorkItemCompletionStatements(database, {
        workType: 'ORDER_EVIDENCE_REVIEW',
        sourceEntityType: 'ORDER_EVIDENCE',
        sourceEntityId: submissionId,
        outcome: 'COMPLETED',
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        now,
      }),
    ]);
    return response;
  } catch (error) {
    const normalized = normalizeOrderEvidenceError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    ).catch(() => false);
    throw normalized;
  }
}

function updateReviewStateStatement(
  database: SqlDatabase,
  input: {
    mode: ReviewMode;
    submissionId: string;
    expectedVersion: number;
    publicReason: string | null;
    internalNote: string | null;
    staffId: string;
    now: number;
  },
): SqlStatement {
  if (input.mode === 'REQUEST_CHANGES') {
    return database.prepare(`
      UPDATE order_evidence_submissions
      SET
        status='CHANGES_REQUESTED',
        version=version+1,
        public_change_reason=?,
        internal_review_note=?,
        updated_at=MAX(?, updated_at+1),
        verified_by_staff_id=NULL,
        verified_at=NULL,
        withdrawn_at=NULL,
        consumed_at=NULL,
        resubmission_deadline_at=?
      WHERE id=?
        AND status='PENDING_VERIFICATION'
        AND version=?
    `).bind(
      input.publicReason,
      input.internalNote,
      input.now,
      input.now + 2 * 60 * 60 * 1000,
      input.submissionId,
      input.expectedVersion,
    );
  }
  return database.prepare(`
    UPDATE order_evidence_submissions
    SET
      status='VERIFIED',
      version=version+1,
      public_change_reason=NULL,
      internal_review_note=?,
      updated_at=MAX(?, updated_at+1),
      verified_by_staff_id=?,
      verified_at=?,
      withdrawn_at=NULL,
      consumed_at=NULL,
      resubmission_deadline_at=NULL
    WHERE id=?
      AND status='PENDING_VERIFICATION'
      AND version=?
  `).bind(
    input.internalNote,
    input.now,
    input.staffId,
    input.now,
    input.submissionId,
    input.expectedVersion,
  );
}

function assertReviewTransitionStatement(
  database: SqlDatabase,
  input: {
    claim: {
      actorType: string;
      actorId: string;
      idempotencyKey: string;
      leaseToken: string;
    };
    submissionId: string;
    expectedEvidenceVersionNo: number;
    nextVersion: number;
    nextStatus: 'CHANGES_REQUESTED' | 'VERIFIED';
    staffId: string;
    now: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM order_evidence_submissions
        WHERE id=?
          AND status=?
          AND version=?
          AND current_version_no=?
          AND (
            (?='CHANGES_REQUESTED'
              AND verified_by_staff_id IS NULL
              AND verified_at IS NULL
              AND public_change_reason IS NOT NULL)
            OR
            (?='VERIFIED'
              AND verified_by_staff_id=?
              AND verified_at=?)
          )
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
    input.submissionId,
    input.nextStatus,
    input.nextVersion,
    input.expectedEvidenceVersionNo,
    input.nextStatus,
    input.nextStatus,
    input.staffId,
    input.now,
    input.claim.actorType,
    input.claim.actorId,
    input.claim.idempotencyKey,
    input.claim.leaseToken,
  );
}
