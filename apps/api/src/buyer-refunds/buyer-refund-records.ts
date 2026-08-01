import type {
  BuyerRefundPaymentChannel,
  BuyerRefundStatus,
  SqlDatabase,
} from '@ygb/contracts';
import {
  BuyerRefundError,
  cleanBuyerRefundIdentifier,
} from './buyer-refund-shared';

export interface BuyerRefundDueSourceRow {
  source_review_event_id: string;
  review_case_id: string;
  formal_order_id: string;
  buyer_customer_id: string;
  due_amount_cny_fen: number;
  review_status: string;
  obligation_id: string | null;
  obligation_version: number | null;
}

export interface BuyerRefundLedgerRow {
  obligation_id: string;
  source_review_event_id: string;
  review_case_id: string;
  formal_order_id: string;
  buyer_customer_id: string;
  due_amount_cny_fen: number;
  gross_paid_cny_fen: number;
  reversed_cny_fen: number;
  net_paid_cny_fen: number;
  status: BuyerRefundStatus;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface BuyerRefundProofFileRow {
  id: string;
  upload_intent_id: string;
  purpose: string;
  visibility: string;
  status: string;
  version: number;
  intent_status: string;
  intent_purpose: string;
  intent_visibility: string;
  owner_actor_type: string;
  owner_actor_id: string;
}

export interface BuyerRefundPaymentRow {
  payment_entry_id: string;
  obligation_id: string;
  amount_cny_fen: number;
  payment_channel: BuyerRefundPaymentChannel;
  recorded_by_staff_id: string;
  paid_at: number;
  china_business_date: string;
  public_note: string | null;
  reversed_amount_cny_fen: number;
}

export async function requireBuyerRefundDueSource(
  database: SqlDatabase,
  sourceReviewEventId: string,
): Promise<BuyerRefundDueSourceRow> {
  const sourceId = cleanBuyerRefundIdentifier(sourceReviewEventId, 200);
  const row = await database.prepare(`
    SELECT
      source_event.id AS source_review_event_id,
      source_event.review_case_id,
      source_event.formal_order_id,
      review_case.buyer_customer_id,
      source_event.amount_cny_fen AS due_amount_cny_fen,
      review_case.status AS review_status,
      obligation.id AS obligation_id,
      obligation.version AS obligation_version
    FROM review_events source_event
    JOIN review_cases review_case
      ON review_case.id=source_event.review_case_id
      AND review_case.formal_order_id=source_event.formal_order_id
    JOIN formal_orders formal_order
      ON formal_order.id=source_event.formal_order_id
      AND formal_order.buyer_customer_id=review_case.buyer_customer_id
    LEFT JOIN buyer_refund_obligations obligation
      ON obligation.source_review_event_id=source_event.id
    WHERE source_event.id=?
      AND source_event.event_type='BUYER_REFUND_BECAME_DUE'
      AND source_event.next_status='APPROVED'
      AND source_event.amount_cny_fen IS NOT NULL
    LIMIT 1
  `).bind(sourceId).first<BuyerRefundDueSourceRow>();
  if (!row) {
    throw new BuyerRefundError('BUYER_REFUND_NOT_FOUND', 404);
  }
  return row;
}

export async function requireBuyerRefundLedger(
  database: SqlDatabase,
  obligationId: string,
): Promise<BuyerRefundLedgerRow> {
  const id = cleanBuyerRefundIdentifier(obligationId);
  const row = await database.prepare(`
    SELECT
      obligation_id,
      source_review_event_id,
      review_case_id,
      formal_order_id,
      buyer_customer_id,
      due_amount_cny_fen,
      gross_paid_cny_fen,
      reversed_cny_fen,
      net_paid_cny_fen,
      status,
      version,
      created_at,
      updated_at
    FROM buyer_refund_ledger_balances
    WHERE obligation_id=?
    LIMIT 1
  `).bind(id).first<BuyerRefundLedgerRow>();
  if (!row) throw new BuyerRefundError('BUYER_REFUND_NOT_FOUND', 404);
  return row;
}

export async function listBuyerRefundProofFiles(
  database: SqlDatabase,
  fileObjectIds: readonly string[],
): Promise<readonly BuyerRefundProofFileRow[]> {
  if (fileObjectIds.length < 1) return [];
  const placeholders = fileObjectIds.map(() => '?').join(', ');
  const rows = await database.prepare(`
    SELECT
      object.id,
      object.upload_intent_id,
      object.purpose,
      object.visibility,
      object.status,
      object.version,
      intent.status AS intent_status,
      intent.purpose AS intent_purpose,
      intent.visibility AS intent_visibility,
      intent.owner_actor_type,
      intent.owner_actor_id
    FROM file_objects object
    JOIN file_upload_intents intent
      ON intent.id=object.upload_intent_id
    WHERE object.id IN (${placeholders})
    ORDER BY object.id
  `).bind(...fileObjectIds).all<BuyerRefundProofFileRow>();
  return rows.results;
}

export async function assertBuyerRefundProofFilesUnused(
  database: SqlDatabase,
  fileObjectIds: readonly string[],
): Promise<void> {
  const placeholders = fileObjectIds.map(() => '?').join(', ');
  const row = await database.prepare(`
    SELECT 1 AS conflict
    FROM buyer_refund_payment_entry_files
    WHERE file_object_id IN (${placeholders})
    LIMIT 1
  `).bind(...fileObjectIds).first<{ conflict: number }>();
  if (row) throw new BuyerRefundError('BUYER_REFUND_FILE_CONFLICT', 409);
}

export async function requireBuyerRefundPayment(
  database: SqlDatabase,
  obligationId: string,
  paymentEntryId: string,
): Promise<BuyerRefundPaymentRow> {
  const row = await database.prepare(`
    SELECT
      payment.id AS payment_entry_id,
      payment.obligation_id,
      payment.amount_cny_fen,
      payment.payment_channel,
      payment.recorded_by_staff_id,
      payment.paid_at,
      payment.china_business_date,
      payment.public_note,
      COALESCE(SUM(reversal.amount_cny_fen), 0)
        AS reversed_amount_cny_fen
    FROM buyer_refund_payment_entries payment
    LEFT JOIN buyer_refund_payment_entries reversal
      ON reversal.original_payment_entry_id=payment.id
      AND reversal.entry_type='REVERSAL'
    WHERE payment.id=?
      AND payment.obligation_id=?
      AND payment.entry_type='PAYMENT'
    GROUP BY payment.id
  `).bind(
    cleanBuyerRefundIdentifier(paymentEntryId),
    cleanBuyerRefundIdentifier(obligationId),
  ).first<BuyerRefundPaymentRow>();
  if (!row) {
    throw new BuyerRefundError('BUYER_REFUND_PAYMENT_NOT_FOUND', 404);
  }
  return row;
}
