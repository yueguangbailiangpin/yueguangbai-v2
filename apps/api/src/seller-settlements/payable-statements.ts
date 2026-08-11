import type {
  SellerPayableType,
  SqlDatabase,
  SqlStatement,
} from '@ygb/contracts';
import { canonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import { requireFormalOrderAction,FormalOrderPolicyError } from '../formal-order-policy';
import { createOutboxStatements, prepareOutboxEvent } from '../foundation/outbox';
import { SellerSettlementError } from './shared';

export interface PreparedSellerPayable {
  payableId: string;
  eventId: string;
  statements: readonly SqlStatement[];
}

export async function prepareSellerPayableCreation(
  database: SqlDatabase,
  input: {
    sellerOrganizationId: string;
    formalOrderId: string;
    payableType: SellerPayableType;
    amountCnyFen: number;
    financialSnapshotId: string;
    sourceType: 'FORMAL_ORDER' | 'REVIEW_APPROVAL';
    sourceId: string;
    dueAt: number;
    createdAt: number;
    actor: {
      type: 'STAFF' | 'SYSTEM';
      id: string;
      roles: readonly string[];
    };
    requestId?: string | null;
    idempotencyKey: string;
  },
): Promise<PreparedSellerPayable> {
  if (input.payableType === 'SELLER_SERVICE_FEE') {
    try {
      await requireFormalOrderAction(
        database,
        input.formalOrderId,
        'ACCRUE_SELLER_SERVICE_FEE',
      );
    } catch (error) {
      if (error instanceof FormalOrderPolicyError) {
        throw new SellerSettlementError(
          error.code === 'FORMAL_ORDER_NOT_FOUND'
            ? 'NOT_FOUND'
            : 'SELLER_SETTLEMENT_CONFLICT',
          error.code === 'FORMAL_ORDER_NOT_FOUND' ? 404 : 409,
        );
      }
      throw error;
    }
  }
  const payableId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const payload = {
    seller_organization_id: input.sellerOrganizationId,
    payable_id: payableId,
    formal_order_id: input.formalOrderId,
    payable_type: input.payableType,
    amount_cny_fen: String(input.amountCnyFen),
    financial_snapshot_id: input.financialSnapshotId,
    source_type: input.sourceType,
    source_id: input.sourceId,
    due_at: input.dueAt,
    created_at: input.createdAt,
  };
  const outbox = await prepareOutboxEvent({
    id: crypto.randomUUID(),
    dedupKey: `seller-payable-created:${payableId}`,
    eventType: 'SELLER_PAYABLE_CREATED',
    aggregateType: 'SELLER_PAYABLE',
    aggregateId: payableId,
    payload,
    createdAt: input.createdAt,
  });
  const statements: SqlStatement[] = [
    database.prepare(`
      INSERT INTO seller_payables (
        id, seller_organization_id, formal_order_id, payable_type,
        amount_cny_fen, financial_snapshot_id, source_type, source_id,
        due_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      payableId,
      input.sellerOrganizationId,
      input.formalOrderId,
      input.payableType,
      input.amountCnyFen,
      input.financialSnapshotId,
      input.sourceType,
      input.sourceId,
      input.dueAt,
      input.createdAt,
    ),
    database.prepare(`
      INSERT INTO seller_payable_events (
        id, payable_id, event_type, actor_type, actor_id,
        amount_cny_fen, metadata_json, idempotency_key, created_at
      ) VALUES (?, ?, 'PAYABLE_CREATED', ?, ?, ?, ?, ?, ?)
    `).bind(
      eventId,
      payableId,
      input.actor.type,
      input.actor.id,
      input.amountCnyFen,
      canonicalJson({
        formal_order_id: input.formalOrderId,
        financial_snapshot_id: input.financialSnapshotId,
        source_type: input.sourceType,
        source_id: input.sourceId,
      }),
      input.idempotencyKey,
      input.createdAt,
    ),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'SELLER_PAYABLE',
      aggregateId: payableId,
      eventType: 'SELLER_PAYABLE_CREATED',
      actor: input.actor,
      requestId: input.requestId ?? null,
      idempotencyKey: input.idempotencyKey,
      nextState: payload,
      createdAt: input.createdAt,
    }),
    ...createOutboxStatements(database, outbox),
    database.prepare(`
      INSERT INTO transaction_assertions (assertion_value)
      SELECT CASE WHEN
        EXISTS (
          SELECT 1 FROM seller_payables payable
          WHERE payable.id=?
            AND payable.seller_organization_id=?
            AND payable.formal_order_id=?
            AND payable.payable_type=?
            AND payable.amount_cny_fen=?
            AND payable.financial_snapshot_id=?
            AND payable.source_type=?
            AND payable.source_id=?
            AND payable.due_at=?
        )
        AND EXISTS (
          SELECT 1 FROM seller_payable_events event
          WHERE event.id=? AND event.payable_id=?
            AND event.event_type='PAYABLE_CREATED'
            AND event.amount_cny_fen=?
        )
      THEN 1 ELSE 0 END
    `).bind(
      payableId,
      input.sellerOrganizationId,
      input.formalOrderId,
      input.payableType,
      input.amountCnyFen,
      input.financialSnapshotId,
      input.sourceType,
      input.sourceId,
      input.dueAt,
      eventId,
      payableId,
      input.amountCnyFen,
    ),
  ];
  return Object.freeze({
    payableId,
    eventId,
    statements: Object.freeze(statements),
  });
}
