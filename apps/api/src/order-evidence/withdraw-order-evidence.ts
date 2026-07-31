import type {
  SqlDatabase,
  WithdrawOrderEvidenceResult,
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
import { requireCurrentOrderEvidenceForBuyer } from './order-evidence-records';
import {
  cleanOrderEvidenceIdentifier,
  insertOrderEvidenceEventStatement,
  normalizeOrderEvidenceError,
  OrderEvidenceError,
  validateBuyerOrderEvidenceActor,
  validateCommandTime,
  validateExpectedVersion,
  type BuyerOrderEvidenceActor,
} from './order-evidence-shared';

export async function withdrawOrderEvidence(
  database: SqlDatabase,
  input: {
    submissionId: string;
    expectedVersion: number;
  },
  command: {
    actor: BuyerOrderEvidenceActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<WithdrawOrderEvidenceResult> {
  validateBuyerOrderEvidenceActor(command.actor);
  const submissionId = cleanOrderEvidenceIdentifier(
    input.submissionId,
    120,
  );
  const expectedVersion = validateExpectedVersion(
    input.expectedVersion,
  );
  const now = validateCommandTime(command.now ?? Date.now());
  const requestHash = await hashCanonicalJson({
    action: 'WITHDRAW_ORDER_EVIDENCE',
    submission_id: submissionId,
    expected_version: expectedVersion,
    buyer_customer_id: command.actor.buyerCustomerId,
  });
  const acquired = await acquireIdempotency<WithdrawOrderEvidenceResult>(
    database,
    {
      actorType: 'BUYER_CUSTOMER',
      actorId: command.actor.buyerCustomerId,
      action: 'WITHDRAW_ORDER_EVIDENCE',
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
    const source = await requireCurrentOrderEvidenceForBuyer(
      database,
      submissionId,
      command.actor.buyerCustomerId,
    );
    if (source.aggregate_version !== expectedVersion) {
      throw new OrderEvidenceError('VERSION_CONFLICT', 409);
    }
    if (source.status !== 'PENDING_VERIFICATION'
      && source.status !== 'CHANGES_REQUESTED') {
      throw new OrderEvidenceError(
        'ORDER_EVIDENCE_STATE_CONFLICT',
        409,
      );
    }

    const response: WithdrawOrderEvidenceResult = {
      submission_id: source.submission_id,
      reservation_id: source.reservation_id,
      buyer_customer_id: source.buyer_customer_id,
      marketplace: source.marketplace_code,
      status: 'WITHDRAWN',
      version: source.aggregate_version + 1,
      current_evidence_version_no: source.current_version_no,
      current_evidence_version_id: source.evidence_version_id,
      withdrawn_at: now,
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey:
        `order-evidence-withdrawn:${submissionId}:${response.version}`,
      eventType: 'ORDER_EVIDENCE_WITHDRAWN',
      aggregateType: 'ORDER_EVIDENCE',
      aggregateId: submissionId,
      payload: {
        submission_id: submissionId,
        reservation_id: source.reservation_id,
        buyer_customer_id: source.buyer_customer_id,
        evidence_version_id: source.evidence_version_id,
        aggregate_version: response.version,
      },
      createdAt: now,
    });

    await database.batch([
      database.prepare(`
        UPDATE order_evidence_submissions
        SET
          status='WITHDRAWN',
          version=version+1,
          updated_at=MAX(?, updated_at+1),
          verified_by_staff_id=NULL,
          verified_at=NULL,
          withdrawn_at=?,
          consumed_at=NULL
        WHERE id=?
          AND buyer_customer_id=?
          AND status IN ('PENDING_VERIFICATION', 'CHANGES_REQUESTED')
          AND version=?
      `).bind(
        now,
        now,
        submissionId,
        command.actor.buyerCustomerId,
        expectedVersion,
      ),
      insertOrderEvidenceEventStatement(database, {
        submissionId,
        reservationId: source.reservation_id,
        buyerCustomerId: source.buyer_customer_id,
        evidenceVersionId: source.evidence_version_id,
        eventType: 'ORDER_EVIDENCE_WITHDRAWN',
        actorType: 'BUYER_CUSTOMER',
        actorId: command.actor.buyerCustomerId,
        previousStatus: source.status,
        nextStatus: 'WITHDRAWN',
        aggregateVersion: response.version,
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
        eventType: 'ORDER_EVIDENCE_WITHDRAWN',
        actor: {
          type: 'BUYER_CUSTOMER',
          id: command.actor.buyerCustomerId,
          roles: [],
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          status: source.status,
          version: source.aggregate_version,
          evidence_version_no: source.current_version_no,
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
            submission_id: submissionId,
            evidence_version_id: source.evidence_version_id,
          },
          now,
        },
      ),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN
          EXISTS (
            SELECT 1
            FROM order_evidence_submissions
            WHERE id=?
              AND buyer_customer_id=?
              AND status='WITHDRAWN'
              AND version=?
              AND current_version_no=?
              AND withdrawn_at=?
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
        submissionId,
        command.actor.buyerCustomerId,
        response.version,
        source.current_version_no,
        now,
        acquired.claim.actorType,
        acquired.claim.actorId,
        acquired.claim.idempotencyKey,
        acquired.claim.leaseToken,
      ),
      assertIdempotencyCompletionStatement(
        database,
        acquired.claim,
      ),
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
