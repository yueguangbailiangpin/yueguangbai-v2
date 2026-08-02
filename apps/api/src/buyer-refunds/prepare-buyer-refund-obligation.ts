import type {
  EnsureBuyerRefundObligationResult,
  SqlDatabase,
  SqlStatement,
  StaffRoleCode,
} from '@ygb/contracts';
import { createAuditEventStatement } from '../foundation/audit';
import { createOutboxStatements, prepareOutboxEvent } from '../foundation/outbox';
import { prepareSellerPayableCreation } from '../seller-settlements/payable-statements';
import { insertBuyerRefundEventStatement } from './buyer-refund-events';

export interface PreparedBuyerRefundObligation {
  obligationId: string;
  eventId: string;
  auditId: string;
  statements: readonly SqlStatement[];
  result: EnsureBuyerRefundObligationResult;
  sellerServiceFeePayableId?: string;
}

interface ServiceFeeFacts {
  seller_organization_id: string;
  financial_snapshot_id: string;
  service_fee_cny_fen: number;
}

/**
 * Approval creates both financial obligations from the same immutable formal
 * snapshot. The caller appends these statements after the three approval
 * review events in one D1 batch.
 */
export async function prepareBuyerRefundObligationFromReviewApproval(
  database: SqlDatabase,
  input: {
    sourceReviewEventId: string;
    reviewCaseId: string;
    formalOrderId: string;
    buyerCustomerId: string;
    dueAmountCnyFen: number;
    actorStaffId: string;
    actorRoles: readonly StaffRoleCode[];
    requestId: string | null;
    idempotencyKey: string;
    now: number;
  },
): Promise<PreparedBuyerRefundObligation> {
  const base = await prepareBuyerRefundObligationStatements(database, {
    sourceReviewEventId: input.sourceReviewEventId,
    reviewCaseId: input.reviewCaseId,
    formalOrderId: input.formalOrderId,
    buyerCustomerId: input.buyerCustomerId,
    dueAmountCnyFen: input.dueAmountCnyFen,
    actorType: 'STAFF',
    actorId: input.actorStaffId,
    actorRoles: input.actorRoles,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    now: input.now,
  });
  const facts = await requireServiceFeeFacts(
    database,
    input.reviewCaseId,
    input.formalOrderId,
  );
  const payable = await prepareSellerPayableCreation(database, {
    sellerOrganizationId: facts.seller_organization_id,
    formalOrderId: input.formalOrderId,
    payableType: 'SELLER_SERVICE_FEE',
    amountCnyFen: Number(facts.service_fee_cny_fen),
    financialSnapshotId: facts.financial_snapshot_id,
    sourceType: 'REVIEW_APPROVAL',
    sourceId: input.reviewCaseId,
    dueAt: input.now,
    createdAt: input.now,
    actor: {
      type: 'STAFF',
      id: input.actorStaffId,
      roles: input.actorRoles,
    },
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
  });
  return Object.freeze({
    ...base,
    sellerServiceFeePayableId: payable.payableId,
    statements: Object.freeze([...base.statements, ...payable.statements]),
  });
}

export async function prepareBuyerRefundObligationStatements(
  database: SqlDatabase,
  input: {
    sourceReviewEventId: string;
    reviewCaseId: string;
    formalOrderId: string;
    buyerCustomerId: string;
    dueAmountCnyFen: number;
    actorType: 'STAFF' | 'SYSTEM';
    actorId: string;
    actorRoles: readonly StaffRoleCode[];
    requestId: string | null;
    idempotencyKey: string;
    now: number;
  },
): Promise<PreparedBuyerRefundObligation> {
  if (!Number.isSafeInteger(input.dueAmountCnyFen)
    || input.dueAmountCnyFen < 0
    || !Number.isSafeInteger(input.now)
    || input.now < 0) {
    throw new Error('invalid_buyer_refund_obligation_facts');
  }
  const obligationId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const response: EnsureBuyerRefundObligationResult = {
    obligation_id: obligationId,
    source_review_event_id: input.sourceReviewEventId,
    review_case_id: input.reviewCaseId,
    formal_order_id: input.formalOrderId,
    buyer_customer_id: input.buyerCustomerId,
    due_amount_cny_fen: String(input.dueAmountCnyFen),
    gross_paid_cny_fen: '0',
    reversed_cny_fen: '0',
    net_paid_cny_fen: '0',
    status: 'DUE' as const,
    version: 1 as const,
    replayed: false,
  };
  const outbox = await prepareOutboxEvent({
    id: crypto.randomUUID(),
    dedupKey: `buyer-refund-obligation:${input.sourceReviewEventId}`,
    eventType: 'BUYER_REFUND_OBLIGATION_CREATED',
    aggregateType: 'BUYER_REFUND_OBLIGATION',
    aggregateId: obligationId,
    payload: response,
    createdAt: input.now,
  });
  return {
    obligationId,
    eventId,
    auditId,
    result: response,
    statements: [
      database.prepare(`
        INSERT INTO buyer_refund_obligations (
          id, source_review_event_id, review_case_id, formal_order_id,
          buyer_customer_id, due_amount_cny_fen, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).bind(
        obligationId,
        input.sourceReviewEventId,
        input.reviewCaseId,
        input.formalOrderId,
        input.buyerCustomerId,
        input.dueAmountCnyFen,
        input.now,
        input.now,
      ),
      insertBuyerRefundEventStatement(database, {
        eventId,
        obligationId,
        eventType: 'BUYER_REFUND_OBLIGATION_CREATED',
        actorType: input.actorType,
        actorId: input.actorId,
        obligationVersion: 1,
        amountCnyFen: input.dueAmountCnyFen,
        netPaidAfterCnyFen: 0,
        metadata: {
          source_review_event_id: input.sourceReviewEventId,
          source: 'BUYER_REFUND_BECAME_DUE.amount_cny_fen',
        },
        idempotencyKey: input.idempotencyKey,
        createdAt: input.now,
      }),
      createAuditEventStatement(database, {
        id: auditId,
        aggregateType: 'BUYER_REFUND_OBLIGATION',
        aggregateId: obligationId,
        eventType: 'BUYER_REFUND_OBLIGATION_CREATED',
        actor: {
          type: input.actorType,
          id: input.actorId,
          roles: input.actorRoles,
        },
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey,
        previousState: null,
        nextState: response,
        metadata: { source_review_event_id: input.sourceReviewEventId },
        createdAt: input.now,
      }),
      ...createOutboxStatements(database, outbox),
      database.prepare(`
        INSERT INTO transaction_assertions (assertion_value)
        SELECT CASE WHEN
          EXISTS (
            SELECT 1 FROM buyer_refund_obligations
            WHERE id=? AND source_review_event_id=? AND review_case_id=?
              AND formal_order_id=? AND buyer_customer_id=?
              AND due_amount_cny_fen=? AND version=1
          )
          AND EXISTS (
            SELECT 1 FROM buyer_refund_events
            WHERE id=? AND obligation_id=?
              AND event_type='BUYER_REFUND_OBLIGATION_CREATED'
              AND amount_cny_fen=? AND net_paid_after_cny_fen=0
          )
          AND (
            SELECT COUNT(*) FROM review_events
            WHERE id=? AND event_type='BUYER_REFUND_BECAME_DUE'
              AND amount_cny_fen=?
          )=1
          AND EXISTS (
            SELECT 1 FROM audit_events
            WHERE id=? AND aggregate_type='BUYER_REFUND_OBLIGATION'
              AND aggregate_id=?
          )
        THEN 1 ELSE 0 END
      `).bind(
        obligationId,
        input.sourceReviewEventId,
        input.reviewCaseId,
        input.formalOrderId,
        input.buyerCustomerId,
        input.dueAmountCnyFen,
        eventId,
        obligationId,
        input.dueAmountCnyFen,
        input.sourceReviewEventId,
        input.dueAmountCnyFen,
        auditId,
        obligationId,
      ),
    ],
  };
}

async function requireServiceFeeFacts(
  database: SqlDatabase,
  reviewCaseId: string,
  formalOrderId: string,
): Promise<ServiceFeeFacts> {
  const row = await database.prepare(`
    SELECT
      review_case.seller_organization_id,
      snapshot.id AS financial_snapshot_id,
      snapshot.service_fee_cny_fen
    FROM review_cases review_case
    JOIN formal_orders formal_order
      ON formal_order.id=review_case.formal_order_id
      AND formal_order.seller_organization_id=review_case.seller_organization_id
    JOIN formal_order_financial_snapshots snapshot
      ON snapshot.formal_order_id=formal_order.id
    WHERE review_case.id=? AND formal_order.id=?
  `).bind(reviewCaseId, formalOrderId).first<ServiceFeeFacts>();
  if (!row
    || !Number.isSafeInteger(Number(row.service_fee_cny_fen))
    || Number(row.service_fee_cny_fen) < 0) {
    throw new Error('invalid_seller_service_fee_payable_facts');
  }
  return { ...row, service_fee_cny_fen: Number(row.service_fee_cny_fen) };
}