import type {
  EnsureBuyerRefundObligationResult,
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
  type IdempotencyClaim,
} from '../foundation/idempotency';
import {
  createOutboxStatements,
  prepareOutboxEvent,
} from '../foundation/outbox';
import { insertBuyerRefundEventStatement } from './buyer-refund-events';
import { requireBuyerRefundDueSource } from './buyer-refund-records';
import {
  BuyerRefundError,
  buyerRefundActorIdentity,
  cleanBuyerRefundAmount,
  cleanBuyerRefundExpectedVersion,
  cleanBuyerRefundIdentifier,
  cleanBuyerRefundTimestamp,
  fixedIntegerString,
  normalizeBuyerRefundError,
  type BuyerRefundObligationActor,
} from './buyer-refund-shared';

export async function ensureBuyerRefundObligationFromDueEvent(
  database: SqlDatabase,
  input: {
    sourceReviewEventId: string;
    expectedVersion: number;
  },
  command: {
    actor: BuyerRefundObligationActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<EnsureBuyerRefundObligationResult> {
  const sourceReviewEventId = cleanBuyerRefundIdentifier(
    input.sourceReviewEventId,
    200,
  );
  const expectedVersion = cleanBuyerRefundExpectedVersion(
    input.expectedVersion,
    { allowZero: true },
  );
  const actor = buyerRefundActorIdentity(command.actor);
  const now = cleanBuyerRefundTimestamp(command.now ?? Date.now());
  const requestHash = await hashCanonicalJson({
    action: 'ENSURE_BUYER_REFUND_OBLIGATION',
    source_review_event_id: sourceReviewEventId,
    expected_version: expectedVersion,
  });
  const acquired = await acquireIdempotency<
    EnsureBuyerRefundObligationResult
  >(
    database,
    {
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: 'ENSURE_BUYER_REFUND_OBLIGATION',
      targetType: 'REVIEW_EVENT',
      targetId: sourceReviewEventId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    if (expectedVersion !== 0) {
      throw new BuyerRefundError('VERSION_CONFLICT', 409);
    }
    const source = await requireBuyerRefundDueSource(
      database,
      sourceReviewEventId,
    );
    if (source.obligation_id !== null) {
      throw new BuyerRefundError('BUYER_REFUND_ALREADY_EXISTS', 409);
    }
    if (source.review_status !== 'APPROVED') {
      throw new BuyerRefundError('BUYER_REFUND_STATE_CONFLICT', 409);
    }
    const dueAmountCnyFen = cleanBuyerRefundAmount(
      Number(source.due_amount_cny_fen),
      { allowZero: true },
    );
    const obligationId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    const response: EnsureBuyerRefundObligationResult = {
      obligation_id: obligationId,
      source_review_event_id: source.source_review_event_id,
      review_case_id: source.review_case_id,
      formal_order_id: source.formal_order_id,
      buyer_customer_id: source.buyer_customer_id,
      due_amount_cny_fen: fixedIntegerString(dueAmountCnyFen),
      gross_paid_cny_fen: '0',
      reversed_cny_fen: '0',
      net_paid_cny_fen: '0',
      status: 'DUE',
      version: 1,
      replayed: false,
    };
    const outbox = await prepareOutboxEvent({
      id: crypto.randomUUID(),
      dedupKey: `buyer-refund-obligation:${source.source_review_event_id}`,
      eventType: 'BUYER_REFUND_OBLIGATION_CREATED',
      aggregateType: 'BUYER_REFUND_OBLIGATION',
      aggregateId: obligationId,
      payload: response,
      createdAt: now,
    });

    const statements: SqlStatement[] = [
      database.prepare(`
        INSERT INTO buyer_refund_obligations (
          id,
          source_review_event_id,
          review_case_id,
          formal_order_id,
          buyer_customer_id,
          due_amount_cny_fen,
          version,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).bind(
        obligationId,
        source.source_review_event_id,
        source.review_case_id,
        source.formal_order_id,
        source.buyer_customer_id,
        dueAmountCnyFen,
        now,
        now,
      ),
      insertBuyerRefundEventStatement(database, {
        eventId,
        obligationId,
        eventType: 'BUYER_REFUND_OBLIGATION_CREATED',
        actorType: actor.actorType,
        actorId: actor.actorId,
        obligationVersion: 1,
        amountCnyFen: dueAmountCnyFen,
        netPaidAfterCnyFen: 0,
        metadata: {
          source_review_event_id: source.source_review_event_id,
          source: 'BUYER_REFUND_BECAME_DUE.amount_cny_fen',
        },
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: auditId,
        aggregateType: 'BUYER_REFUND_OBLIGATION',
        aggregateId: obligationId,
        eventType: 'BUYER_REFUND_OBLIGATION_CREATED',
        actor: {
          type: actor.actorType,
          id: actor.actorId,
          roles: actor.actorRoles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: response,
        metadata: {
          source_review_event_id: source.source_review_event_id,
        },
        createdAt: now,
      }),
      ...createOutboxStatements(database, outbox),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        {
          resultReferences: {
            obligation_id: obligationId,
            source_review_event_id: source.source_review_event_id,
            formal_order_id: source.formal_order_id,
          },
          now,
        },
      ),
      assertObligationCreatedStatement(database, {
        obligationId,
        sourceReviewEventId: source.source_review_event_id,
        reviewCaseId: source.review_case_id,
        formalOrderId: source.formal_order_id,
        buyerCustomerId: source.buyer_customer_id,
        dueAmountCnyFen,
        eventId,
        auditId,
        claim: acquired.claim,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ];
    await database.batch(statements);
    return response;
  } catch (error) {
    const normalized = normalizeBuyerRefundError(error);
    await markIdempotencyFailed(
      database,
      acquired.claim,
      normalized.code,
      now,
    ).catch(() => false);
    throw normalized;
  }
}

function assertObligationCreatedStatement(
  database: SqlDatabase,
  input: {
    obligationId: string;
    sourceReviewEventId: string;
    reviewCaseId: string;
    formalOrderId: string;
    buyerCustomerId: string;
    dueAmountCnyFen: number;
    eventId: string;
    auditId: string;
    claim: IdempotencyClaim;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO transaction_assertions (assertion_value)
    SELECT CASE WHEN
      EXISTS (
        SELECT 1
        FROM buyer_refund_obligations
        WHERE id=?
          AND source_review_event_id=?
          AND review_case_id=?
          AND formal_order_id=?
          AND buyer_customer_id=?
          AND due_amount_cny_fen=?
          AND version=1
      )
      AND EXISTS (
        SELECT 1
        FROM buyer_refund_events
        WHERE id=?
          AND obligation_id=?
          AND event_type='BUYER_REFUND_OBLIGATION_CREATED'
          AND amount_cny_fen=?
          AND net_paid_after_cny_fen=0
      )
      AND EXISTS (
        SELECT 1
        FROM audit_events
        WHERE id=?
          AND aggregate_type='BUYER_REFUND_OBLIGATION'
          AND aggregate_id=?
      )
      AND EXISTS (
        SELECT 1
        FROM command_idempotency_records
        WHERE actor_type=?
          AND actor_id=?
          AND idempotency_key=?
          AND action=?
          AND target_type=?
          AND target_id=?
          AND request_hash=?
          AND lease_token=?
          AND status='COMMITTED'
      )
    THEN 1 ELSE 0 END
  `).bind(
    input.obligationId,
    input.sourceReviewEventId,
    input.reviewCaseId,
    input.formalOrderId,
    input.buyerCustomerId,
    input.dueAmountCnyFen,
    input.eventId,
    input.obligationId,
    input.dueAmountCnyFen,
    input.auditId,
    input.obligationId,
    input.claim.actorType,
    input.claim.actorId,
    input.claim.idempotencyKey,
    input.claim.action,
    input.claim.targetType,
    input.claim.targetId,
    input.claim.requestHash,
    input.claim.leaseToken,
  );
}
