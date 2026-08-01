import type {
  BuyerRefundEventType,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { canonicalJson } from '@ygb/domain';

export function insertBuyerRefundEventStatement(
  database: SqlDatabase,
  input: {
    eventId?: string;
    obligationId: string;
    paymentEntryId?: string | null;
    eventType: BuyerRefundEventType;
    actorType: 'STAFF' | 'SYSTEM';
    actorId: string;
    obligationVersion: number;
    amountCnyFen: number;
    netPaidAfterCnyFen: number;
    metadata?: unknown;
    idempotencyKey: string;
    createdAt: number;
  },
): SqlStatement {
  return database.prepare(`
    INSERT INTO buyer_refund_events (
      id,
      obligation_id,
      payment_entry_id,
      event_type,
      actor_type,
      actor_id,
      obligation_version,
      amount_cny_fen,
      net_paid_after_cny_fen,
      metadata_json,
      idempotency_key,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.eventId ?? crypto.randomUUID(),
    input.obligationId,
    input.paymentEntryId ?? null,
    input.eventType,
    input.actorType,
    input.actorId,
    input.obligationVersion,
    input.amountCnyFen,
    input.netPaidAfterCnyFen,
    canonicalJson(input.metadata ?? {}),
    input.idempotencyKey,
    input.createdAt,
  );
}
