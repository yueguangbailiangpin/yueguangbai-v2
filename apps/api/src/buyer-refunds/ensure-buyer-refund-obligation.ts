import type {
  EnsureBuyerRefundObligationResult,
  SqlDatabase,
} from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import {
  requireBuyerRefundDueSource,
  requireBuyerRefundLedger,
} from './buyer-refund-records';
import { prepareBuyerRefundObligationStatements } from './prepare-buyer-refund-obligation';
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
      const ledger = await requireBuyerRefundLedger(
        database,
        source.obligation_id,
      );
      const response: EnsureBuyerRefundObligationResult = {
        obligation_id: ledger.obligation_id,
        source_review_event_id: ledger.source_review_event_id,
        review_case_id: ledger.review_case_id,
        formal_order_id: ledger.formal_order_id,
        buyer_customer_id: ledger.buyer_customer_id,
        due_amount_cny_fen: fixedIntegerString(ledger.due_amount_cny_fen),
        gross_paid_cny_fen: fixedIntegerString(ledger.gross_paid_cny_fen),
        reversed_cny_fen: fixedIntegerString(ledger.reversed_cny_fen),
        net_paid_cny_fen: fixedIntegerString(ledger.net_paid_cny_fen),
        status: ledger.status,
        version: ledger.version,
        replayed: false,
      };
      await database.batch([
        completeIdempotencyStatement(
          database,
          acquired.claim,
          response,
          {
            resultReferences: {
              obligation_id: ledger.obligation_id,
              source_review_event_id: ledger.source_review_event_id,
              formal_order_id: ledger.formal_order_id,
            },
            now,
          },
        ),
        assertIdempotencyCompletionStatement(database, acquired.claim),
      ]);
      return response;
    }
    if (source.review_status !== 'APPROVED') {
      throw new BuyerRefundError('BUYER_REFUND_STATE_CONFLICT', 409);
    }
    const dueAmountCnyFen = cleanBuyerRefundAmount(
      Number(source.due_amount_cny_fen),
      { allowZero: true },
    );
    const prepared = await prepareBuyerRefundObligationStatements(database, {
      sourceReviewEventId: source.source_review_event_id,
      reviewCaseId: source.review_case_id,
      formalOrderId: source.formal_order_id,
      buyerCustomerId: source.buyer_customer_id,
      dueAmountCnyFen,
      actorType: actor.actorType,
      actorId: actor.actorId,
      actorRoles: actor.actorRoles,
      requestId: command.requestId ?? null,
      idempotencyKey: acquired.claim.idempotencyKey,
      now,
    });
    const response: EnsureBuyerRefundObligationResult = {
      ...prepared.result,
      due_amount_cny_fen: fixedIntegerString(dueAmountCnyFen),
      replayed: false,
    };

    const statements = [
      ...prepared.statements,
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        {
          resultReferences: {
            obligation_id: prepared.obligationId,
            source_review_event_id: source.source_review_event_id,
            formal_order_id: source.formal_order_id,
          },
          now,
        },
      ),
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
