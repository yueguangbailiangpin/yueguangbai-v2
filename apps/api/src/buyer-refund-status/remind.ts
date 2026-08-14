import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
} from '../foundation/idempotency';
import type { BuyerPortalContext } from '../buyer-portal/buyer-context';
import { BuyerRefundPortalError } from './errors';

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface BuyerRefundReminderResult {
  refund_obligation_id: string;
  reminder_count: number;
  last_reminded_at: number;
  next_reminder_at: number;
  replayed: boolean;
}

interface ReminderTargetRow {
  obligation_id: string;
  status: 'DUE' | 'PARTIALLY_PAID' | 'PAID' | 'OVERPAID';
}

interface ReminderSummaryRow {
  reminder_count: number;
  last_reminded_at: number | null;
}

export async function remindBuyerRefund(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  input: { obligationId: string; idempotencyKey: string; requestId: string | null },
  options: { now?: number } = {},
): Promise<BuyerRefundReminderResult> {
  assertBusinessAccess(buyer);
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new BuyerRefundPortalError('DEPENDENCY_UNAVAILABLE', 503);
  }
  const requestHash = await hashCanonicalJson({
    action: 'REMIND_BUYER_REFUND',
    obligation_id: input.obligationId,
  });
  const acquired = await acquireIdempotency<BuyerRefundReminderResult>(database, {
    actorType: 'BUYER',
    actorId: buyer.buyerCustomerId,
    action: 'REMIND_BUYER_REFUND',
    targetType: 'BUYER_REFUND_OBLIGATION',
    targetId: input.obligationId,
    idempotencyKey: input.idempotencyKey,
    requestHash,
  }, { now });
  if (acquired.kind === 'REPLAY') return { ...acquired.response, replayed: true };

  try {
    const target = await database.prepare(`
      SELECT obligation_id,status
      FROM buyer_refund_ledger_balances
      WHERE obligation_id=? AND buyer_customer_id=?
      LIMIT 1
    `).bind(input.obligationId, buyer.buyerCustomerId).first<ReminderTargetRow>();
    if (!target) throw new BuyerRefundPortalError('NOT_FOUND', 404);
    if (target.status !== 'DUE' && target.status !== 'PARTIALLY_PAID') {
      throw new BuyerRefundPortalError('NOT_FOUND', 404);
    }
    const before = await reminderSummary(database, input.obligationId);

    const reminderId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    const statements: SqlStatement[] = [
      database.prepare(`
        INSERT INTO buyer_refund_reminders (
          id,obligation_id,buyer_customer_id,idempotency_key,reminded_at,created_at
        )
        SELECT ?,?,?,?, ?,?
        WHERE NOT EXISTS (
          SELECT 1 FROM buyer_refund_reminders
          WHERE obligation_id=? AND reminded_at>?
        )
      `).bind(
        reminderId, input.obligationId, buyer.buyerCustomerId,
        acquired.claim.idempotencyKey, now, now,
        input.obligationId, now - REMINDER_WINDOW_MS,
      ),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END
      `),
      createAuditEventStatement(database, {
        id: auditId,
        aggregateType: 'BUYER_REFUND_OBLIGATION',
        aggregateId: input.obligationId,
        eventType: 'BUYER_REFUND_REMINDER_REQUESTED',
        actor: { type: 'BUYER', id: buyer.buyerCustomerId, roles: [] },
        requestId: input.requestId,
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: { reminder_id: reminderId, reminded_at: now },
        metadata: {},
        createdAt: now,
      }),
    ];
    const response: BuyerRefundReminderResult = {
      refund_obligation_id: input.obligationId,
      reminder_count: before.reminder_count + 1,
      last_reminded_at: now,
      next_reminder_at: now + REMINDER_WINDOW_MS,
      replayed: false,
    };
    statements.push(
      completeIdempotencyStatement(database, acquired.claim, response, {
        resultReferences: { reminder_id: reminderId, audit_id: auditId }, now,
      }),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    );
    await database.batch(statements);
    const summary = await reminderSummary(database, input.obligationId);
    if (summary.last_reminded_at !== now
      || summary.reminder_count !== response.reminder_count) {
      throw new BuyerRefundPortalError('DEPENDENCY_UNAVAILABLE', 503);
    }
    return response;
  } catch (error) {
    await markIdempotencyFailed(
      database,
      acquired.claim,
      error instanceof BuyerRefundPortalError ? error.code : 'DEPENDENCY_UNAVAILABLE',
      now,
    ).catch(() => undefined);
    if (String(error).includes('transaction_assertion_failed')) {
      throw new BuyerRefundPortalError('RATE_LIMITED', 429);
    }
    throw error;
  }
}

export async function reminderSummary(
  database: SqlDatabase,
  obligationId: string,
): Promise<ReminderSummaryRow> {
  const row = await database.prepare(`
    SELECT COUNT(*) AS reminder_count, MAX(reminded_at) AS last_reminded_at
    FROM buyer_refund_reminders WHERE obligation_id=?
  `).bind(obligationId).first<ReminderSummaryRow>();
  return { reminder_count: Number(row?.reminder_count ?? 0), last_reminded_at: row?.last_reminded_at ?? null };
}

function assertBusinessAccess(buyer: BuyerPortalContext): void {
  if (buyer.accessStatus !== 'ACTIVE') throw new BuyerRefundPortalError('CUSTOMER_NOT_ACTIVE', 409);
  if (buyer.identityReviewStatus !== 'CLEAR') throw new BuyerRefundPortalError('IDENTITY_REVIEW_REQUIRED', 409);
}
