import type {
  BuyerRefundLedgerProjection,
  SqlDatabase,
} from '@ygb/contracts';
import { requireBuyerRefundLedger } from './buyer-refund-records';
import {
  fixedIntegerString,
  requireBuyerRefundViewPermission,
  type BuyerRefundStaffActor,
} from './buyer-refund-shared';

export async function getBuyerRefundLedger(
  database: SqlDatabase,
  obligationId: string,
  actor: BuyerRefundStaffActor,
): Promise<BuyerRefundLedgerProjection> {
  requireBuyerRefundViewPermission(actor);
  const row = await requireBuyerRefundLedger(database, obligationId);
  return {
    obligation_id: row.obligation_id,
    source_review_event_id: row.source_review_event_id,
    review_case_id: row.review_case_id,
    formal_order_id: row.formal_order_id,
    buyer_customer_id: row.buyer_customer_id,
    due_amount_cny_fen: fixedIntegerString(row.due_amount_cny_fen),
    gross_paid_cny_fen: fixedIntegerString(row.gross_paid_cny_fen),
    reversed_cny_fen: fixedIntegerString(row.reversed_cny_fen),
    net_paid_cny_fen: fixedIntegerString(row.net_paid_cny_fen),
    status: row.status,
    version: row.version,
  };
}
