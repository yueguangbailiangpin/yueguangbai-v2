import type {
  ReverseBuyerRefundPaymentResult,
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
import { insertBuyerRefundEventStatement } from './buyer-refund-events';
import {
  requireBuyerRefundLedger,
  requireBuyerRefundPayment,
} from './buyer-refund-records';
import {
  BuyerRefundError,
  assertPreviousBuyerRefundStatementChangedOnce,
  buyerRefundStatusFromAmounts,
  cleanBuyerRefundAmount,
  cleanBuyerRefundBusinessDate,
  cleanBuyerRefundExpectedVersion,
  cleanBuyerRefundIdentifier,
  cleanBuyerRefundTimestamp,
  cleanOptionalBuyerRefundText,
  fixedIntegerString,
  normalizeBuyerRefundError,
  requireBuyerRefundRecordPermission,
  type BuyerRefundStaffActor,
} from './buyer-refund-shared';

export async function reverseBuyerRefundPayment(
  database: SqlDatabase,
  input: {
    obligationId: string;
    originalPaymentEntryId: string;
    expectedVersion: number;
    amountCnyFen: number;
    reversedAt: number;
    chinaBusinessDate: string;
    publicNote?: string | null;
    internalNote?: string | null;
  },
  command: {
    actor: BuyerRefundStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<ReverseBuyerRefundPaymentResult> {
  requireBuyerRefundRecordPermission(command.actor);
  const obligationId = cleanBuyerRefundIdentifier(input.obligationId);
  const originalPaymentEntryId = cleanBuyerRefundIdentifier(
    input.originalPaymentEntryId,
  );
  const expectedVersion = cleanBuyerRefundExpectedVersion(
    input.expectedVersion,
  );
  const amountCnyFen = cleanBuyerRefundAmount(input.amountCnyFen);
  const reversedAt = cleanBuyerRefundTimestamp(input.reversedAt);
  const chinaBusinessDate = cleanBuyerRefundBusinessDate(
    input.chinaBusinessDate,
  );
  const publicNote = cleanOptionalBuyerRefundText(input.publicNote, 2000);
  const internalNote = cleanOptionalBuyerRefundText(input.internalNote, 4000);
  const now = cleanBuyerRefundTimestamp(command.now ?? Date.now());
  const requestHash = await hashCanonicalJson({
    action: 'REVERSE_BUYER_REFUND_PAYMENT',
    obligation_id: obligationId,
    original_payment_entry_id: originalPaymentEntryId,
    expected_version: expectedVersion,
    amount_cny_fen: amountCnyFen,
    reversed_at: reversedAt,
    china_business_date: chinaBusinessDate,
    public_note: publicNote,
    internal_note: internalNote,
  });
  const acquired = await acquireIdempotency<
    ReverseBuyerRefundPaymentResult
  >(
    database,
    {
      actorType: 'STAFF',
      actorId: command.actor.staffId,
      action: 'REVERSE_BUYER_REFUND_PAYMENT',
      targetType: 'BUYER_REFUND_OBLIGATION',
      targetId: obligationId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
    },
    { now },
  );
  if (acquired.kind === 'REPLAY') {
    return { ...acquired.response, replayed: true };
  }

  try {
    const ledger = await requireBuyerRefundLedger(database, obligationId);
    if (ledger.version !== expectedVersion) {
      throw new BuyerRefundError('VERSION_CONFLICT', 409);
    }
    const original = await requireBuyerRefundPayment(
      database,
      obligationId,
      originalPaymentEntryId,
    );
    const remaining = original.amount_cny_fen
      - original.reversed_amount_cny_fen;
    if (amountCnyFen > remaining) {
      throw new BuyerRefundError(
        'BUYER_REFUND_REVERSAL_EXCEEDS_PAYMENT',
        409,
      );
    }
    if (amountCnyFen > ledger.net_paid_cny_fen) {
      throw new BuyerRefundError('BUYER_REFUND_STATE_CONFLICT', 409);
    }

    const reversalEntryId = crypto.randomUUID();
    const nextVersion = ledger.version + 1;
    const nextReversed = ledger.reversed_cny_fen + amountCnyFen;
    const nextNetPaid = ledger.net_paid_cny_fen - amountCnyFen;
    const nextStatus = buyerRefundStatusFromAmounts(
      ledger.due_amount_cny_fen,
      nextNetPaid,
    );
    const eventId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    const response: ReverseBuyerRefundPaymentResult = {
      obligation: {
        obligation_id: ledger.obligation_id,
        source_review_event_id: ledger.source_review_event_id,
        review_case_id: ledger.review_case_id,
        formal_order_id: ledger.formal_order_id,
        buyer_customer_id: ledger.buyer_customer_id,
        due_amount_cny_fen: fixedIntegerString(ledger.due_amount_cny_fen),
        gross_paid_cny_fen: fixedIntegerString(ledger.gross_paid_cny_fen),
        reversed_cny_fen: fixedIntegerString(nextReversed),
        net_paid_cny_fen: fixedIntegerString(nextNetPaid),
        status: nextStatus,
        version: nextVersion,
      },
      reversal: {
        reversal_entry_id: reversalEntryId,
        obligation_id: ledger.obligation_id,
        entry_type: 'REVERSAL',
        original_payment_entry_id: originalPaymentEntryId,
        amount_cny_fen: fixedIntegerString(amountCnyFen),
        reversed_at: reversedAt,
        china_business_date: chinaBusinessDate,
        payment_channel: original.payment_channel,
        public_note: publicNote,
      },
      replayed: false,
    };

    const statements: SqlStatement[] = [
      database.prepare(`
        UPDATE buyer_refund_obligations
        SET
          version=version+1,
          updated_at=MAX(?, updated_at+1)
        WHERE id=?
          AND version=?
      `).bind(now, obligationId, expectedVersion),
      assertPreviousBuyerRefundStatementChangedOnce(database),
      database.prepare(`
        INSERT INTO buyer_refund_payment_entries (
          id,
          obligation_id,
          entry_type,
          original_payment_entry_id,
          amount_cny_fen,
          paid_at,
          reversed_at,
          china_business_date,
          payment_channel,
          recorded_by_staff_id,
          public_note,
          internal_note,
          idempotency_key,
          request_hash,
          created_at
        ) VALUES (
          ?, ?, 'REVERSAL', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `).bind(
        reversalEntryId,
        obligationId,
        originalPaymentEntryId,
        amountCnyFen,
        reversedAt,
        chinaBusinessDate,
        original.payment_channel,
        command.actor.staffId,
        publicNote,
        internalNote,
        acquired.claim.idempotencyKey,
        acquired.claim.requestHash,
        now,
      ),
      insertBuyerRefundEventStatement(database, {
        eventId,
        obligationId,
        paymentEntryId: reversalEntryId,
        eventType: 'BUYER_REFUND_PAYMENT_REVERSED',
        actorType: 'STAFF',
        actorId: command.actor.staffId,
        obligationVersion: nextVersion,
        amountCnyFen,
        netPaidAfterCnyFen: nextNetPaid,
        metadata: {
          original_payment_entry_id: originalPaymentEntryId,
          payment_channel: original.payment_channel,
          china_business_date: chinaBusinessDate,
          public_note: publicNote,
          internal_note: internalNote,
        },
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: now,
      }),
      createAuditEventStatement(database, {
        id: auditId,
        aggregateType: 'BUYER_REFUND_OBLIGATION',
        aggregateId: obligationId,
        eventType: 'BUYER_REFUND_PAYMENT_REVERSED',
        actor: {
          type: 'STAFF',
          id: command.actor.staffId,
          roles: command.actor.roles,
        },
        requestId: command.requestId ?? null,
        idempotencyKey: acquired.claim.idempotencyKey,
        previousState: {
          net_paid_cny_fen: fixedIntegerString(ledger.net_paid_cny_fen),
          status: ledger.status,
          version: ledger.version,
        },
        nextState: response,
        reason: publicNote,
        metadata: {
          internal_note: internalNote,
          original_payment_entry_id: originalPaymentEntryId,
        },
        createdAt: now,
      }),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        {
          resultReferences: {
            obligation_id: obligationId,
            original_payment_entry_id: originalPaymentEntryId,
            reversal_entry_id: reversalEntryId,
          },
          now,
        },
      ),
      assertReversalRecordedStatement(database, {
        obligationId,
        expectedNextVersion: nextVersion,
        reversalEntryId,
        originalPaymentEntryId,
        amountCnyFen,
        nextNetPaid,
        nextStatus,
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

function assertReversalRecordedStatement(
  database: SqlDatabase,
  input: {
    obligationId: string;
    expectedNextVersion: number;
    reversalEntryId: string;
    originalPaymentEntryId: string;
    amountCnyFen: number;
    nextNetPaid: number;
    nextStatus: string;
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
        FROM buyer_refund_ledger_balances
        WHERE obligation_id=?
          AND version=?
          AND net_paid_cny_fen=?
          AND status=?
      )
      AND EXISTS (
        SELECT 1
        FROM buyer_refund_payment_entries
        WHERE id=?
          AND obligation_id=?
          AND entry_type='REVERSAL'
          AND original_payment_entry_id=?
          AND amount_cny_fen=?
      )
      AND EXISTS (
        SELECT 1
        FROM buyer_refund_events
        WHERE id=?
          AND payment_entry_id=?
          AND event_type='BUYER_REFUND_PAYMENT_REVERSED'
          AND net_paid_after_cny_fen=?
      )
      AND EXISTS (
        SELECT 1
        FROM audit_events
        WHERE id=?
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
    input.expectedNextVersion,
    input.nextNetPaid,
    input.nextStatus,
    input.reversalEntryId,
    input.obligationId,
    input.originalPaymentEntryId,
    input.amountCnyFen,
    input.eventId,
    input.reversalEntryId,
    input.nextNetPaid,
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
