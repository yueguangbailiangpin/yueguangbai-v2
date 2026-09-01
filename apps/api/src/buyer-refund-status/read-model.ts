import {
  isBuyerRefundPaymentChannel,
  isBuyerRefundStatus,
  isPricingReviewType,
  type BuyerRefundPaymentChannel,
  type BuyerRefundPortalActivityDto,
  type BuyerRefundPortalActivityType,
  type BuyerRefundPortalBalanceDto,
  type BuyerRefundPortalDetailDto,
  type BuyerRefundPortalPageDto,
  type BuyerRefundPortalSummaryDto,
  type BuyerRefundStatus,
  type PricingReviewType,
  type SqlDatabase,
} from '@ygb/contracts';
import type { BuyerPortalContext } from '../buyer-portal/buyer-context';
import {
  buyerRefundStatusFromAmounts,
  fixedIntegerString,
} from '../buyer-refunds/buyer-refund-shared';
import { BuyerRefundPortalError } from './errors';
import {
  encodeBuyerRefundPortalCursor,
  type BuyerRefundPortalCursor,
} from './pagination';
import { reminderSummary } from './remind';

interface BuyerRefundPortalRow {
  refund_obligation_id: string;
  buyer_customer_id: string;
  formal_order_id: string;
  marketplace_code: 'AMAZON_JP';
  amazon_order_number_normalized: string;
  product_name_snapshot: string;
  review_type: PricingReviewType;
  due_amount_cny_fen: number;
  net_paid_cny_fen: number;
  ledger_status: BuyerRefundStatus;
  became_due_at: number;
  first_paid_at: number | null;
  last_paid_at: number | null;
  updated_at: number;
}

interface BuyerRefundActivityRow {
  activity_id: string;
  event_type:
    | 'BUYER_REFUND_PAYMENT_RECORDED'
    | 'BUYER_REFUND_PAYMENT_REVERSED';
  entry_type: 'PAYMENT' | 'REVERSAL';
  amount_cny_fen: number;
  occurred_at: number;
  payment_channel: BuyerRefundPaymentChannel;
  net_paid_after_cny_fen: number;
  event_created_at: number;
}

const BUYER_REFUND_PORTAL_SELECT = `
  WITH payment_times AS (
    SELECT
      obligation_id,
      MIN(paid_at) AS first_paid_at,
      MAX(paid_at) AS last_paid_at
    FROM buyer_refund_payment_entries
    WHERE entry_type='PAYMENT'
    GROUP BY obligation_id
  )
  SELECT
    ledger.obligation_id AS refund_obligation_id,
    ledger.buyer_customer_id,
    ledger.formal_order_id,
    formal_order.marketplace_code,
    formal_order.amazon_order_number_normalized,
    formal_order.product_name_snapshot,
    formal_order.review_type,
    ledger.due_amount_cny_fen,
    ledger.net_paid_cny_fen,
    ledger.status AS ledger_status,
    source_event.created_at AS became_due_at,
    payment_times.first_paid_at,
    payment_times.last_paid_at,
    ledger.updated_at
  FROM buyer_refund_ledger_balances ledger
  JOIN buyer_refund_obligations obligation
    ON obligation.id=ledger.obligation_id
    AND obligation.buyer_customer_id=ledger.buyer_customer_id
    AND obligation.formal_order_id=ledger.formal_order_id
  JOIN review_events source_event
    ON source_event.id=ledger.source_review_event_id
    AND source_event.review_case_id=ledger.review_case_id
    AND source_event.formal_order_id=ledger.formal_order_id
    AND source_event.event_type='BUYER_REFUND_BECAME_DUE'
    AND source_event.next_status='APPROVED'
  JOIN formal_orders formal_order
    ON formal_order.id=ledger.formal_order_id
    AND formal_order.buyer_customer_id=ledger.buyer_customer_id
    AND formal_order.status='CONFIRMED'
  LEFT JOIN payment_times
    ON payment_times.obligation_id=ledger.obligation_id
`;

export async function listBuyerRefunds(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  options: {
    limit: number;
    cursor: BuyerRefundPortalCursor | null;
    outstandingOnly?: boolean;
  },
): Promise<BuyerRefundPortalPageDto> {
  assertBuyerRefundBusinessAccess(buyer);
  validateLimit(options.limit);

  const where = ['ledger.buyer_customer_id=?'];
  const bindings: unknown[] = [buyer.buyerCustomerId];
  if (options.outstandingOnly) {
    where.push('ledger.status IN (?,?)');
    bindings.push('DUE', 'PARTIALLY_PAID');
  }
  if (options.cursor) {
    where.push(`(
      ledger.updated_at<?
      OR (
        ledger.updated_at=?
        AND ledger.obligation_id<?
      )
    )`);
    bindings.push(
      options.cursor.updatedAt,
      options.cursor.updatedAt,
      options.cursor.id,
    );
  }
  bindings.push(options.limit + 1);

  const result = await database.prepare(`
    ${BUYER_REFUND_PORTAL_SELECT}
    WHERE ${where.join('\n      AND ')}
    ORDER BY ledger.updated_at DESC, ledger.obligation_id DESC
    LIMIT ?
  `).bind(...bindings).all<BuyerRefundPortalRow>();

  const hasMore = result.results.length > options.limit;
  const visibleRows = hasMore
    ? result.results.slice(0, options.limit)
    : result.results;
  const last = visibleRows.at(-1) ?? null;
  return {
    items: Object.freeze(visibleRows.map(toSummaryDto)),
    next_cursor: hasMore && last
      ? encodeBuyerRefundPortalCursor({
          updatedAt: safeNonNegativeInteger(last.updated_at),
          id: validateIdentifier(last.refund_obligation_id, true),
        })
      : null,
  };
}

export async function getBuyerRefund(
  database: SqlDatabase,
  buyer: BuyerPortalContext,
  refundObligationId: string,
): Promise<BuyerRefundPortalDetailDto> {
  assertBuyerRefundBusinessAccess(buyer);
  validateIdentifier(refundObligationId, true);

  const row = await database.prepare(`
    ${BUYER_REFUND_PORTAL_SELECT}
    WHERE ledger.obligation_id=?
      AND ledger.buyer_customer_id=?
    LIMIT 1
  `).bind(
    refundObligationId,
    buyer.buyerCustomerId,
  ).first<BuyerRefundPortalRow>();
  if (!row) throw new BuyerRefundPortalError('NOT_FOUND', 404);

  const summary = toSummaryDto(row);
  const activities = await listBuyerRefundActivities(
    database,
    refundObligationId,
    safeNonNegativeInteger(row.due_amount_cny_fen),
  );
  const reminders = await reminderSummary(database, refundObligationId);
  return { ...summary, reminder: reminderDto(reminders), activities };
}

async function listBuyerRefundActivities(
  database: SqlDatabase,
  refundObligationId: string,
  dueAmountCnyFen: number,
): Promise<readonly BuyerRefundPortalActivityDto[]> {
  const result = await database.prepare(`
    SELECT
      event.id AS activity_id,
      event.event_type,
      entry.entry_type,
      entry.amount_cny_fen,
      CASE
        WHEN entry.entry_type='PAYMENT' THEN entry.paid_at
        ELSE entry.reversed_at
      END AS occurred_at,
      entry.payment_channel,
      event.net_paid_after_cny_fen,
      event.created_at AS event_created_at
    FROM buyer_refund_events event
    JOIN buyer_refund_payment_entries entry
      ON entry.id=event.payment_entry_id
      AND entry.obligation_id=event.obligation_id
    WHERE event.obligation_id=?
      AND event.event_type IN (
        'BUYER_REFUND_PAYMENT_RECORDED',
        'BUYER_REFUND_PAYMENT_REVERSED'
      )
    ORDER BY event.created_at ASC, event.id ASC
  `).bind(refundObligationId).all<BuyerRefundActivityRow>();
  return Object.freeze(result.results.map(
    (row) => toActivityDto(row, dueAmountCnyFen),
  ));
}

function toSummaryDto(
  row: BuyerRefundPortalRow,
): BuyerRefundPortalSummaryDto {
  const dueAmount = safeNonNegativeInteger(row.due_amount_cny_fen);
  const netPaid = safeNonNegativeInteger(row.net_paid_cny_fen);
  const balance = projectBalance(dueAmount, netPaid, row.ledger_status);
  if (row.marketplace_code !== 'AMAZON_JP'
    || !isPricingReviewType(row.review_type)) {
    return dependencyError();
  }
  return {
    refund_obligation_id: validateIdentifier(
      row.refund_obligation_id,
      false,
    ),
    order: {
      formal_order_id: validateIdentifier(row.formal_order_id, false),
      marketplace: row.marketplace_code,
      amazon_order_number: safeText(
        row.amazon_order_number_normalized,
        100,
      ),
      product_name: safeText(row.product_name_snapshot, 500),
      review_type: row.review_type,
      status: 'CONFIRMED',
    },
    ...balance,
    reminder: {
      reminder_count: 0,
      last_reminded_at: null,
      next_reminder_at: null,
    },
    allowed_actions: [],
  };
}

function reminderDto(summary: {
  reminder_count: number;
  last_reminded_at: number | null;
}) {
  const last = summary.last_reminded_at === null
    ? null
    : safeNonNegativeInteger(summary.last_reminded_at);
  return {
    reminder_count: safeNonNegativeInteger(summary.reminder_count),
    last_reminded_at: last,
    next_reminder_at: last === null ? null : last + 24 * 60 * 60 * 1000,
  };
}

function toActivityDto(
  row: BuyerRefundActivityRow,
  dueAmountCnyFen: number,
): BuyerRefundPortalActivityDto {
  const activityType = activityTypeFromRow(row);
  if (!isBuyerRefundPaymentChannel(row.payment_channel)) {
    return dependencyError();
  }
  return {
    activity_id: validateIdentifier(row.activity_id, false, 200),
    activity_type: activityType,
    amount_cny_fen: fixedIntegerString(
      safePositiveInteger(row.amount_cny_fen),
    ),
    occurred_at: safeNonNegativeInteger(row.occurred_at),
    payment_channel: row.payment_channel,
    balance_after: projectBalance(
      dueAmountCnyFen,
      safeNonNegativeInteger(row.net_paid_after_cny_fen),
    ),
  };
}

function activityTypeFromRow(
  row: BuyerRefundActivityRow,
): BuyerRefundPortalActivityType {
  if (row.event_type === 'BUYER_REFUND_PAYMENT_RECORDED'
    && row.entry_type === 'PAYMENT') {
    return 'PAYMENT_RECORDED';
  }
  if (row.event_type === 'BUYER_REFUND_PAYMENT_REVERSED'
    && row.entry_type === 'REVERSAL') {
    return 'PAYMENT_REVERSED';
  }
  return dependencyError();
}

function projectBalance(
  dueAmountCnyFen: number,
  netPaidCnyFen: number,
  storedStatus?: unknown,
): BuyerRefundPortalBalanceDto {
  const status = buyerRefundStatusFromAmounts(
    dueAmountCnyFen,
    netPaidCnyFen,
  );
  if (storedStatus !== undefined
    && (!isBuyerRefundStatus(storedStatus) || storedStatus !== status)) {
    return dependencyError();
  }
  return {
    due_amount_cny_fen: fixedIntegerString(dueAmountCnyFen),
    net_paid_cny_fen: fixedIntegerString(netPaidCnyFen),
    remaining_amount_cny_fen: fixedIntegerString(
      Math.max(dueAmountCnyFen - netPaidCnyFen, 0),
    ),
    overpaid_amount_cny_fen: fixedIntegerString(
      Math.max(netPaidCnyFen - dueAmountCnyFen, 0),
    ),
    status,
  };
}

function assertBuyerRefundBusinessAccess(buyer: BuyerPortalContext): void {
  if (buyer.accessStatus !== 'ACTIVE') {
    throw new BuyerRefundPortalError('CUSTOMER_NOT_ACTIVE', 409);
  }
  if (buyer.identityReviewStatus !== 'CLEAR') {
    throw new BuyerRefundPortalError(
      'IDENTITY_REVIEW_REQUIRED',
      409,
    );
  }
}

function validateLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new BuyerRefundPortalError('VALIDATION_ERROR', 400);
  }
}

function validateIdentifier(
  value: string,
  notFound: boolean,
  maximum = 120,
): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new BuyerRefundPortalError(
      notFound ? 'NOT_FOUND' : 'DEPENDENCY_UNAVAILABLE',
      notFound ? 404 : 503,
    );
  }
  return value;
}

function safeText(value: string, maximum: number): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    return dependencyError();
  }
  return value;
}

function safePositiveInteger(value: number): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1) {
    return dependencyError();
  }
  return numeric;
}

function safeNonNegativeInteger(value: number): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    return dependencyError();
  }
  return numeric;
}

function dependencyError(): never {
  throw new BuyerRefundPortalError('DEPENDENCY_UNAVAILABLE', 503);
}
