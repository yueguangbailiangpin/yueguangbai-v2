import {
  apiFailure,
  apiSuccess,
  BUYER_REFUND_PAYMENT_CHANNELS,
  BUYER_REFUND_STATUSES,
  type ApiErrorCode,
  type BuyerRefundPaymentChannel,
  type BuyerRefundStatus,
  type FileActor,
  type StaffBuyerRefundDetailDto,
  type StaffBuyerRefundListItemDto,
  type StaffDataScope,
} from '@ygb/contracts';
import {
  chinaBusinessDate,
  chinaBusinessDateStartEpoch,
  addChinaBusinessDays,
  parseChinaBusinessDate,
} from '@ygb/domain';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../app';
import type { FileAuthorizationResource, FileAuthorizationService } from '../files/authorization';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  BuyerRefundError,
  recordBuyerRefundPayment,
  requireBuyerRefundRecordPermission,
  requireBuyerRefundViewPermission,
  reverseBuyerRefundPayment,
} from './index';

const BODY_LIMIT_BYTES = 24 * 1024;
const CURSOR_MAX_LENGTH = 2048;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
// 评论通过时间缺失时（LEFT JOIN 防御位）排组内最后；MAX_SAFE_INTEGER。
const UNSORTED_REVIEW_TS = 9_007_199_254_740_991;
const PROMISE_BUSINESS_DAYS = 7;

interface RefundListRow {
  obligation_id: string;
  buyer_customer_id: string;
  formal_order_id: string;
  due_amount_cny_fen: number;
  gross_paid_cny_fen: number;
  reversed_cny_fen: number;
  net_paid_cny_fen: number;
  status: BuyerRefundStatus;
  version: number;
  created_at: number;
  updated_at: number;
  review_approved_at: number | null;
  reminder_count: number;
  last_reminded_at: number | null;
  buyer_customer_no: string | null;
  marketplace_code: 'AMAZON_JP';
  amazon_order_number_normalized: string;
  product_id: string;
  asin_normalized: string;
  work_item_id: string | null;
  assigned_staff_id: string | null;
  fixed_assignment_id: string | null;
}

interface RefundDetailRow extends RefundListRow {
  source_review_event_id: string;
  review_case_id: string;
  refund_account_name: string | null;
  refund_account_identifier: string | null;
}

interface PaymentRow {
  id: string;
  amount_cny_fen: number;
  paid_at: number;
  china_business_date: string;
  payment_channel: BuyerRefundPaymentChannel;
  public_note: string | null;
  internal_note: string | null;
}

interface ReversalRow {
  id: string;
  original_payment_entry_id: string;
  amount_cny_fen: number;
  reversed_at: number;
  china_business_date: string;
  payment_channel: BuyerRefundPaymentChannel;
  public_note: string | null;
  internal_note: string | null;
}

interface ProofRow {
  payment_entry_id: string;
  file_object_id: string;
  file_version: number;
  purpose: string;
  visibility: string;
}

export function registerStaffBuyerRefundRoutes(app: Hono<AppEnv>): void {
  app.get(
    '/api/staff/buyer-refunds',
    withBuyerRefundHttpErrors(listStaffBuyerRefunds),
  );
  app.get(
    '/api/staff/buyer-refunds/:id',
    withBuyerRefundHttpErrors(getStaffBuyerRefund),
  );
  app.post(
    '/api/staff/buyer-refunds/:id/payments',
    withBuyerRefundHttpErrors(recordPayment),
  );
  app.post(
    '/api/staff/buyer-refunds/:id/payments/:paymentEntryId/reversals',
    withBuyerRefundHttpErrors(reversePayment),
  );
}

async function listStaffBuyerRefunds(context: Context<AppEnv>): Promise<Response> {
  const actor = requireStaffAuthorization(context);
  requireBuyerRefundViewPermission(toRefundActor(actor));
  const query = parseListQuery(context);
  const scope = scopeSql(requireStaffDataScope(context));
  // P7c 超期看板排序：未结清在前，组内按承诺期限（评论通过时间）升序——
  // 期限是该时间的单调函数，按来源时间排即按期限排；已结清沉底。
  const cursor = query.cursor
    ? `AND ((ledger.status='PAID')>? OR ((ledger.status='PAID')=? AND
      (review_approved_at>? OR
      (review_approved_at=? AND ledger.obligation_id>?))))`
    : '';
  const status = query.status ? 'AND ledger.status=?' : '';
  const from = query.fromStart === undefined
    ? ''
    : 'AND ledger.created_at>=?';
  const to = query.toExclusive === undefined
    ? ''
    : 'AND ledger.created_at<?';
  const rows = await context.env.DB.prepare(`
    SELECT ledger.obligation_id, ledger.buyer_customer_id,
      ledger.formal_order_id, ledger.due_amount_cny_fen,
      ledger.gross_paid_cny_fen, ledger.reversed_cny_fen,
      ledger.net_paid_cny_fen, ledger.status, ledger.version,
      ledger.created_at, ledger.updated_at,
      COALESCE(review_event.created_at, ${UNSORTED_REVIEW_TS}) AS review_approved_at,
      (SELECT COUNT(*) FROM buyer_refund_reminders reminder
        WHERE reminder.obligation_id=ledger.obligation_id) AS reminder_count,
      (SELECT MAX(reminded_at) FROM buyer_refund_reminders reminder
        WHERE reminder.obligation_id=ledger.obligation_id) AS last_reminded_at,
      buyer.buyer_customer_no, formal_order.marketplace_code,
      formal_order.amazon_order_number_normalized,
      formal_order.product_id, formal_order.asin_normalized,
      work.id AS work_item_id, work.assigned_staff_id,
      work.fixed_assignment_id
    FROM buyer_refund_ledger_balances ledger
    JOIN formal_orders formal_order ON formal_order.id=ledger.formal_order_id
    JOIN buyer_customers buyer ON buyer.id=ledger.buyer_customer_id
    LEFT JOIN review_events review_event
      ON review_event.id=ledger.source_review_event_id
    LEFT JOIN staff_work_items work
      ON work.work_type='BUYER_REFUND_PROCESSING'
      AND work.source_entity_type='BUYER_REFUND_OBLIGATION'
      AND work.source_entity_id=ledger.obligation_id
      AND work.status='OPEN'
    WHERE ${scope.sql}
      ${status}
      ${from}
      ${to}
      ${cursor}
    ORDER BY (ledger.status='PAID'), review_approved_at, ledger.obligation_id
    LIMIT ?
  `).bind(
    ...scope.args,
    ...(query.status ? [query.status] : []),
    ...(query.fromStart === undefined ? [] : [query.fromStart]),
    ...(query.toExclusive === undefined ? [] : [query.toExclusive]),
    ...(query.cursor
      ? [
        query.cursor.settled,
        query.cursor.settled,
        query.cursor.reviewApprovedAt,
        query.cursor.reviewApprovedAt,
        query.cursor.id,
      ]
      : []),
    query.limit + 1,
  ).all<RefundListRow>();
  const hasMore = rows.results.length > query.limit;
  const visible = rows.results.slice(0, query.limit);
  const items = visible.map(projectListItem);
  const last = visible.at(-1);
  return success(context, {
    items,
    next_cursor: hasMore && last
      ? encodeCursor(
        Number(last.review_approved_at),
        last.status === 'PAID',
        last.obligation_id,
      )
      : null,
  });
}

async function getStaffBuyerRefund(context: Context<AppEnv>): Promise<Response> {
  const actor = requireStaffAuthorization(context);
  requireBuyerRefundViewPermission(toRefundActor(actor));
  const detail = await readRefundDetail(
    context,
    requireIdentifier(context.req.param('id')),
    requireStaffDataScope(context),
  );
  return success(context, { buyer_refund: detail });
}

async function recordPayment(context: Context<AppEnv>): Promise<Response> {
  const actor = requireStaffAuthorization(context);
  const refundActor = toRefundActor(actor);
  requireBuyerRefundRecordPermission(refundActor);
  const obligationId = requireIdentifier(context.req.param('id'));
  await assertVisibleRefund(context, obligationId, requireStaffDataScope(context));
  const body = await readExactJson(context, new Set([
    'expected_version',
    'amount_cny_fen',
    'paid_at',
    'china_business_date',
    'payment_channel',
    'public_note',
    'internal_note',
    'proof_files',
  ]), new Set([
    'expected_version',
    'amount_cny_fen',
    'paid_at',
    'china_business_date',
    'payment_channel',
    'proof_files',
  ]));
  const proofFiles = parseProofFiles(body['proof_files']);
  const paidAt = nonNegativeTimestamp(body['paid_at']);
  const submittedBusinessDate = canonicalBusinessDate(
    body['china_business_date'],
  );
  if (submittedBusinessDate !== chinaBusinessDate(paidAt)) {
    return validationError();
  }
  const result = await recordBuyerRefundPayment(
    context.env.DB,
    new BuyerRefundProofLinkAuthorization(actor),
    {
      obligationId,
      expectedVersion: positiveVersion(body['expected_version']),
      amountCnyFen: positiveMoney(body['amount_cny_fen']),
      paidAt,
      chinaBusinessDate: submittedBusinessDate,
      paymentChannel: paymentChannel(body['payment_channel']),
      proofFiles,
      publicNote: optionalText(body['public_note'], 2000),
      internalNote: optionalText(body['internal_note'], 4000),
    },
    {
      actor: refundActor,
      idempotencyKey: requireIdempotencyKey(context),
      requestId: requestId(context),
    },
  );
  return success(context, {
    obligation: projectLedger(result.obligation),
    payment: {
      payment_entry_id: result.payment.payment_entry_id,
      amount_cny_fen: result.payment.amount_cny_fen,
      paid_at: result.payment.paid_at,
      china_business_date: result.payment.china_business_date,
      payment_channel: result.payment.payment_channel,
      public_note: result.payment.public_note,
      internal_note: optionalText(body['internal_note'], 4000),
      proofs: proofFiles.map((proof) => ({
        file_object_id: proof.fileObjectId,
        file_version: proof.expectedFileVersion,
        purpose: 'BUYER_REFUND_PROOF' as const,
        visibility: 'INTERNAL_ONLY' as const,
      })),
    },
    replayed: result.replayed,
  });
}

async function reversePayment(context: Context<AppEnv>): Promise<Response> {
  const actor = requireStaffAuthorization(context);
  const refundActor = toRefundActor(actor);
  requireBuyerRefundRecordPermission(refundActor);
  const obligationId = requireIdentifier(context.req.param('id'));
  const paymentEntryId = requireIdentifier(
    context.req.param('paymentEntryId'),
  );
  await assertVisibleRefund(context, obligationId, requireStaffDataScope(context));
  const body = await readExactJson(context, new Set([
    'expected_version',
    'amount_cny_fen',
    'reversed_at',
    'reason',
    'internal_note',
  ]), new Set([
    'expected_version',
    'amount_cny_fen',
    'reversed_at',
    'reason',
  ]));
  const reversedAt = nonNegativeTimestamp(body['reversed_at']);
  const reason = requiredText(body['reason'], 2000);
  const result = await reverseBuyerRefundPayment(
    context.env.DB,
    {
      obligationId,
      originalPaymentEntryId: paymentEntryId,
      expectedVersion: positiveVersion(body['expected_version']),
      amountCnyFen: positiveMoney(body['amount_cny_fen']),
      reversedAt,
      chinaBusinessDate: chinaBusinessDate(reversedAt),
      publicNote: reason,
      internalNote: optionalText(body['internal_note'], 4000),
    },
    {
      actor: refundActor,
      idempotencyKey: requireIdempotencyKey(context),
      requestId: requestId(context),
    },
  );
  return success(context, {
    obligation: projectLedger(result.obligation),
    reversal: result.reversal,
    replayed: result.replayed,
  });
}

async function readRefundDetail(
  context: Context<AppEnv>,
  obligationId: string,
  dataScope: StaffDataScope,
): Promise<StaffBuyerRefundDetailDto> {
  const scope = scopeSql(dataScope);
  const ledger = await context.env.DB.prepare(`
    SELECT ledger.obligation_id, ledger.source_review_event_id,
      ledger.review_case_id, ledger.formal_order_id,
      ledger.buyer_customer_id, ledger.due_amount_cny_fen,
      ledger.gross_paid_cny_fen, ledger.reversed_cny_fen,
      ledger.net_paid_cny_fen, ledger.status, ledger.version,
      ledger.created_at, ledger.updated_at,
      review_event.created_at AS review_approved_at,
      (SELECT COUNT(*) FROM buyer_refund_reminders reminder
        WHERE reminder.obligation_id=ledger.obligation_id) AS reminder_count,
      (SELECT MAX(reminded_at) FROM buyer_refund_reminders reminder
        WHERE reminder.obligation_id=ledger.obligation_id) AS last_reminded_at,
      buyer.buyer_customer_no, formal_order.marketplace_code,
      formal_order.amazon_order_number_normalized,
      formal_order.product_id, formal_order.asin_normalized,
      buyer.refund_account_name, buyer.refund_account_identifier,
      work.id AS work_item_id, work.assigned_staff_id,
      work.fixed_assignment_id
    FROM buyer_refund_ledger_balances ledger
    JOIN formal_orders formal_order ON formal_order.id=ledger.formal_order_id
    JOIN buyer_customers buyer ON buyer.id=ledger.buyer_customer_id
    LEFT JOIN review_events review_event
      ON review_event.id=ledger.source_review_event_id
    LEFT JOIN staff_work_items work
      ON work.work_type='BUYER_REFUND_PROCESSING'
      AND work.source_entity_type='BUYER_REFUND_OBLIGATION'
      AND work.source_entity_id=ledger.obligation_id
      AND work.status='OPEN'
    WHERE ledger.obligation_id=? AND ${scope.sql}
    LIMIT 1
  `).bind(obligationId, ...scope.args).first<RefundDetailRow>();
  if (!ledger) throw new BuyerRefundHttpError('NOT_FOUND', 404);
  const [payments, reversals, proofs] = await Promise.all([
    context.env.DB.prepare(`
      SELECT id, amount_cny_fen, paid_at, china_business_date,
        payment_channel, public_note, internal_note
      FROM buyer_refund_payment_entries
      WHERE obligation_id=? AND entry_type='PAYMENT'
      ORDER BY created_at, id
    `).bind(obligationId).all<PaymentRow>(),
    context.env.DB.prepare(`
      SELECT id, original_payment_entry_id, amount_cny_fen,
        reversed_at, china_business_date, payment_channel,
        public_note, internal_note
      FROM buyer_refund_payment_entries
      WHERE obligation_id=? AND entry_type='REVERSAL'
      ORDER BY created_at, id
    `).bind(obligationId).all<ReversalRow>(),
    context.env.DB.prepare(`
      SELECT payment_file.payment_entry_id,
        file.id AS file_object_id, file.version AS file_version,
        file.purpose, file.visibility
      FROM buyer_refund_payment_entry_files payment_file
      JOIN file_objects file ON file.id=payment_file.file_object_id
      WHERE payment_file.obligation_id=?
      ORDER BY payment_file.payment_entry_id, payment_file.created_at,
        payment_file.id
    `).bind(obligationId).all<ProofRow>(),
  ]);
  const proofMap = new Map<string, StaffBuyerRefundDetailDto['payments'][number]['proofs'][number][]>();
  for (const proof of proofs.results) {
    if (proof.purpose !== 'BUYER_REFUND_PROOF'
      || proof.visibility !== 'INTERNAL_ONLY'
      || Number(proof.file_version) < 1) {
      throw new BuyerRefundHttpError('DEPENDENCY_UNAVAILABLE', 503);
    }
    const current = proofMap.get(proof.payment_entry_id) ?? [];
    current.push({
      file_object_id: proof.file_object_id,
      file_version: Number(proof.file_version),
      purpose: 'BUYER_REFUND_PROOF',
      visibility: 'INTERNAL_ONLY',
    });
    proofMap.set(proof.payment_entry_id, current);
  }
  const listItem = projectListItem(ledger);
  return {
    ...listItem,
    source_review_event_id: ledger.source_review_event_id,
    review_case_id: ledger.review_case_id,
    refund_account_name: ledger.refund_account_name,
    refund_account_identifier: ledger.refund_account_identifier,
    gross_paid_cny_fen: String(ledger.gross_paid_cny_fen),
    reversed_cny_fen: String(ledger.reversed_cny_fen),
    payments: payments.results.map((payment) => ({
      payment_entry_id: payment.id,
      amount_cny_fen: String(payment.amount_cny_fen),
      paid_at: Number(payment.paid_at),
      china_business_date: payment.china_business_date,
      payment_channel: payment.payment_channel,
      public_note: payment.public_note,
      internal_note: payment.internal_note,
      proofs: proofMap.get(payment.id) ?? [],
    })),
    reversals: reversals.results.map((reversal) => ({
      reversal_entry_id: reversal.id,
      original_payment_entry_id: reversal.original_payment_entry_id,
      amount_cny_fen: String(reversal.amount_cny_fen),
      reversed_at: Number(reversal.reversed_at),
      china_business_date: reversal.china_business_date,
      payment_channel: reversal.payment_channel,
      public_note: reversal.public_note,
      internal_note: reversal.internal_note,
    })),
  };
}

async function assertVisibleRefund(
  context: Context<AppEnv>,
  obligationId: string,
  dataScope: StaffDataScope,
): Promise<void> {
  const scope = scopeSql(dataScope);
  const row = await context.env.DB.prepare(`
    SELECT 1 AS visible
    FROM buyer_refund_ledger_balances ledger
    JOIN formal_orders formal_order ON formal_order.id=ledger.formal_order_id
    WHERE ledger.obligation_id=? AND ${scope.sql}
    LIMIT 1
  `).bind(obligationId, ...scope.args).first<{ visible: number }>();
  if (!row) throw new BuyerRefundHttpError('NOT_FOUND', 404);
}

function projectListItem(row: RefundListRow): StaffBuyerRefundListItemDto {
  const due = Number(row.due_amount_cny_fen);
  const gross = Number(row.gross_paid_cny_fen);
  const reversed = Number(row.reversed_cny_fen);
  const net = Number(row.net_paid_cny_fen);
  const reminderCount = Number(row.reminder_count);
  const lastRemindedAt = row.last_reminded_at === null
    ? null : Number(row.last_reminded_at);
  // P7c：承诺期限 = 评论通过时间 + 7 个工作日（周一至周五，P13-A）；
  // 来源事件缺失（防御位）时两个期限字段均为 null（“期限未起算”）。
  const rawReviewApprovedAt = Number(row.review_approved_at);
  const reviewApprovedAt = row.review_approved_at === null
    || !Number.isSafeInteger(rawReviewApprovedAt)
    || rawReviewApprovedAt < 0
    || rawReviewApprovedAt === UNSORTED_REVIEW_TS
    ? null
    : rawReviewApprovedAt;
  if (!Number.isSafeInteger(due) || due < 0
    || !Number.isSafeInteger(gross) || gross < 0
    || !Number.isSafeInteger(reversed) || reversed < 0
    || !Number.isSafeInteger(net) || net < 0
    || !Number.isSafeInteger(reminderCount) || reminderCount < 0
    || (lastRemindedAt !== null
      && (!Number.isSafeInteger(lastRemindedAt) || lastRemindedAt < 0))) {
    throw new BuyerRefundHttpError('DEPENDENCY_UNAVAILABLE', 503);
  }
  return {
    obligation_id: row.obligation_id,
    buyer_customer_id: row.buyer_customer_id,
    formal_order_id: row.formal_order_id,
    due_amount_cny_fen: String(due),
    gross_paid_cny_fen: String(gross),
    reversed_cny_fen: String(reversed),
    net_paid_cny_fen: String(net),
    outstanding_amount_cny_fen: String(Math.max(due - net, 0)),
    overpaid_amount_cny_fen: String(Math.max(net - due, 0)),
    status: row.status,
    version: Number(row.version),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    review_approved_at: reviewApprovedAt,
    promise_deadline_at: reviewApprovedAt === null
      ? null
      : addChinaBusinessDays(reviewApprovedAt, PROMISE_BUSINESS_DAYS),
    reminder_count: reminderCount,
    last_reminded_at: lastRemindedAt,
    buyer: {
      buyer_customer_id: row.buyer_customer_id,
      buyer_customer_no: row.buyer_customer_no,
    },
    order: {
      formal_order_id: row.formal_order_id,
      marketplace: row.marketplace_code,
      amazon_order_number_normalized: row.amazon_order_number_normalized,
      product_id: row.product_id,
      asin: row.asin_normalized,
    },
    workflow: {
      work_item_id: row.work_item_id,
      assigned_staff_id: row.assigned_staff_id,
      assigned_team_id: null,
      fixed_assignment_id: row.fixed_assignment_id,
    },
  };
}

function projectLedger(row: {
  obligation_id: string;
  buyer_customer_id: string;
  formal_order_id: string;
  due_amount_cny_fen: string;
  net_paid_cny_fen: string;
  status: BuyerRefundStatus;
  version: number;
}) {
  const due = Number(row.due_amount_cny_fen);
  const net = Number(row.net_paid_cny_fen);
  return {
    obligation_id: row.obligation_id,
    buyer_customer_id: row.buyer_customer_id,
    formal_order_id: row.formal_order_id,
    due_amount_cny_fen: row.due_amount_cny_fen,
    net_paid_cny_fen: row.net_paid_cny_fen,
    outstanding_amount_cny_fen: String(Math.max(due - net, 0)),
    overpaid_amount_cny_fen: String(Math.max(net - due, 0)),
    status: row.status,
    version: row.version,
  };
}

class BuyerRefundProofLinkAuthorization implements FileAuthorizationService {
  constructor(private readonly authorization: AssignmentStaffAuthorization) {}

  assertCanLink(actor: FileActor, resource: FileAuthorizationResource): void {
    if (actor.type !== 'STAFF'
      || actor.id !== this.authorization.staffId
      || !this.authorization.permissions.has('BUYER_REFUND_RECORD')
      || resource.ownerActorType !== 'STAFF'
      || resource.ownerActorId !== this.authorization.staffId
      || resource.purpose !== 'BUYER_REFUND_PROOF'
      || resource.visibility !== 'INTERNAL_ONLY'
      || resource.entityType !== 'BUYER_REFUND') {
      throw new BuyerRefundError('BUYER_REFUND_FILE_CONFLICT', 409);
    }
  }
  assertCanCreateUpload(): never { return denyFileLink(); }
  assertCanUpload(): never { return denyFileLink(); }
  assertCanCompleteUpload(): never { return denyFileLink(); }
  assertCanRead(): never { return denyFileLink(); }
}

function denyFileLink(): never {
  throw new BuyerRefundError('BUYER_REFUND_FILE_CONFLICT', 409);
}

function scopeSql(scope: StaffDataScope): {
  sql: string;
  args: readonly string[];
} {
  if (scope.type === 'GLOBAL') return { sql: '1=1', args: [] };
  const clauses: string[] = [];
  const args: string[] = [];
  if (scope.buyerCustomerIds.length > 0) {
    clauses.push(`ledger.buyer_customer_id IN (
      SELECT value FROM json_each(?)
    )`);
    args.push(JSON.stringify(scope.buyerCustomerIds));
  }
  if (scope.sellerOrganizationIds.length > 0) {
    clauses.push(`formal_order.seller_organization_id IN (
      SELECT value FROM json_each(?)
    )`);
    args.push(JSON.stringify(scope.sellerOrganizationIds));
  }
  return clauses.length > 0
    ? { sql: `(${clauses.join(' OR ')})`, args }
    : { sql: '0=1', args: [] };
}

function parseListQuery(context: Context<AppEnv>): {
  limit: number;
  status?: BuyerRefundStatus;
  from?: string;
  to?: string;
  fromStart?: number;
  toExclusive?: number;
  cursor?: { settled: number; reviewApprovedAt: number; id: string };
} {
  const parameters = new URL(context.req.url).searchParams;
  const allowed = new Set(['limit', 'status', 'cursor', 'from', 'to']);
  for (const key of parameters.keys()) {
    if (!allowed.has(key) || parameters.getAll(key).length !== 1) {
      return validationError();
    }
  }
  const limitRaw = parameters.get('limit');
  const statusRaw = parameters.get('status');
  const cursorRaw = parameters.get('cursor');
  const fromRaw = parameters.get('from');
  const toRaw = parameters.get('to');
  const status = statusRaw === null
    ? undefined
    : BUYER_REFUND_STATUSES.includes(statusRaw as BuyerRefundStatus)
      ? statusRaw as BuyerRefundStatus
      : validationError();
  const fromDate = fromRaw === null
    ? undefined
    : canonicalBusinessDate(fromRaw);
  const toDate = toRaw === null
    ? undefined
    : canonicalBusinessDate(toRaw);
  const fromStart = fromDate === undefined
    ? undefined
    : businessDateStart(fromDate);
  const toStart = toDate === undefined
    ? undefined
    : businessDateStart(toDate);
  if (fromStart !== undefined && toStart !== undefined
    && fromStart > toStart) return validationError();
  return {
    limit: limitRaw === null ? DEFAULT_LIMIT : parseLimit(limitRaw),
    ...(status ? { status } : {}),
    ...(fromDate === undefined
      ? {}
      : { from: fromDate, fromStart: fromStart! }),
    ...(toDate === undefined
      ? {}
      : { to: toDate, toExclusive: toStart! + 86_400_000 }),
    ...(cursorRaw === null ? {} : { cursor: decodeCursor(cursorRaw) }),
  };
}

function canonicalBusinessDate(value: unknown): string {
  if (typeof value !== 'string' || value.length !== 10) {
    return validationError();
  }
  try {
    const normalized = parseChinaBusinessDate(value);
    if (normalized !== value) return validationError();
    return normalized;
  } catch {
    return validationError();
  }
}

function businessDateStart(value: string): number {
  try {
    return chinaBusinessDateStartEpoch(value);
  } catch {
    return validationError();
  }
}

function parseProofFiles(value: unknown): readonly {
  fileObjectId: string;
  expectedFileVersion: number;
}[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    return validationError();
  }
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return validationError();
    }
    const record = item as Record<string, unknown>;
    if (Object.keys(record).sort().join(',')
      !== 'expected_file_version,file_object_id') {
      return validationError();
    }
    const fileObjectId = requireIdentifier(record['file_object_id']);
    if (seen.has(fileObjectId)) return validationError();
    seen.add(fileObjectId);
    return {
      fileObjectId,
      expectedFileVersion: positiveVersion(record['expected_file_version']),
    };
  });
}

async function readExactJson(
  context: Context<AppEnv>,
  allowed: ReadonlySet<string>,
  required: ReadonlySet<string>,
): Promise<Record<string, unknown>> {
  const contentType = context.req.header('Content-Type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return validationError();
  }
  const length = context.req.header('Content-Length');
  if (length && (!/^\d+$/u.test(length) || Number(length) > BODY_LIMIT_BYTES)) {
    return validationError();
  }
  const text = await context.req.text();
  if (new TextEncoder().encode(text).byteLength > BODY_LIMIT_BYTES) {
    return validationError();
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return validationError(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return validationError();
  }
  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return validationError();
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) return validationError();
  }
  return record;
}

function paymentChannel(value: unknown): BuyerRefundPaymentChannel {
  if (!BUYER_REFUND_PAYMENT_CHANNELS.includes(
    value as BuyerRefundPaymentChannel,
  )) return validationError();
  return value as BuyerRefundPaymentChannel;
}

function positiveMoney(value: unknown): number {
  if (typeof value !== 'string'
    || !/^[1-9]\d*$/u.test(value)
    || value.length > 16) return validationError();
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 1) return validationError();
  return amount;
}

function positiveVersion(value: unknown): number {
  if (typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 1) return validationError();
  return value;
}

function nonNegativeTimestamp(value: unknown): number {
  if (typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 0) return validationError();
  return value;
}

function optionalText(value: unknown, maximum: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return validationError();
  const normalized = value.normalize('NFKC').trim();
  if (!normalized) return null;
  if (normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) return validationError();
  return normalized;
}

function requiredText(value: unknown, maximum: number): string {
  const normalized = optionalText(value, maximum);
  if (normalized === null) return validationError();
  return normalized;
}

function requireIdentifier(value: unknown): string {
  return requiredText(value, 120);
}

function requireIdempotencyKey(context: Context<AppEnv>): string {
  const value = context.req.header('Idempotency-Key')?.trim() ?? '';
  if (value.length < 8 || value.length > 128
    || value.includes(',')
    || /[\u0000-\u001f\u007f]/u.test(value)) return validationError();
  return value;
}

function requireStaffAuthorization(
  context: Context<AppEnv>,
): AssignmentStaffAuthorization {
  const value = context.get('staffAuthorization') as
    | AssignmentStaffAuthorization
    | undefined;
  if (!value) throw new BuyerRefundHttpError('UNAUTHENTICATED', 401);
  return value;
}

function requireStaffDataScope(context: Context<AppEnv>): StaffDataScope {
  const value = context.get('staffDataScope') as StaffDataScope | undefined;
  if (!value) throw new BuyerRefundHttpError('UNAUTHENTICATED', 401);
  return value;
}

function toRefundActor(actor: AssignmentStaffAuthorization) {
  return {
    staffId: actor.staffId,
    displayName: actor.displayName,
    roles: [...actor.roles],
    permissions: actor.permissions,
  } as const;
}

function parseLimit(value: string): number {
  if (!/^(?:[1-9]|[1-9]\d|100)$/u.test(value)) return validationError();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > MAX_LIMIT) {
    return validationError();
  }
  return number;
}

function encodeCursor(
  reviewApprovedAt: number,
  settled: boolean,
  id: string,
): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify({
    v: 2,
    review_approved_at: reviewApprovedAt,
    settled: settled ? 1 : 0,
    id,
  })));
}

function decodeCursor(value: string): {
  settled: number;
  reviewApprovedAt: number;
  id: string;
} {
  if (value.length < 1 || value.length > CURSOR_MAX_LENGTH
    || !/^[A-Za-z0-9_-]+$/u.test(value)) return validationError();
  try {
    const parsed = (
      JSON.parse(new TextDecoder().decode(decodeBase64Url(value)))
    ) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || Object.keys(parsed).sort().join(',')
        !== 'id,review_approved_at,settled,v'
      || parsed['v'] !== 2
      || (parsed['settled'] !== 0 && parsed['settled'] !== 1)
      || !Number.isSafeInteger(parsed['review_approved_at'])
      || Number(parsed['review_approved_at']) < 0) return validationError();
    return {
      settled: Number(parsed['settled']),
      reviewApprovedAt: Number(parsed['review_approved_at']),
      id: requireIdentifier(parsed['id']),
    };
  } catch { return validationError(); }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

class BuyerRefundHttpError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: 400 | 401 | 403 | 404 | 409 | 503,
  ) { super(code); }
}

function normalizeHttpError(error: unknown): BuyerRefundHttpError {
  if (error instanceof BuyerRefundHttpError) return error;
  const code = (error as { code?: unknown })?.code;
  if (code === 'VALIDATION_ERROR') return new BuyerRefundHttpError(code, 400);
  if (code === 'FORBIDDEN') return new BuyerRefundHttpError(code, 403);
  if (code === 'BUYER_REFUND_NOT_FOUND'
    || code === 'BUYER_REFUND_PAYMENT_NOT_FOUND'
    || code === 'FILE_OBJECT_NOT_FOUND') {
    return new BuyerRefundHttpError('NOT_FOUND', 404);
  }
  if (code === 'VERSION_CONFLICT') {
    return new BuyerRefundHttpError('VERSION_CONFLICT', 409);
  }
  if (code === 'IDEMPOTENCY_CONFLICT') {
    return new BuyerRefundHttpError('IDEMPOTENCY_CONFLICT', 409);
  }
  if (code === 'REQUEST_IN_PROGRESS') {
    return new BuyerRefundHttpError('REQUEST_IN_PROGRESS', 409);
  }
  if (code === 'BUYER_REFUND_STATE_CONFLICT'
    || code === 'BUYER_REFUND_FILE_CONFLICT'
    || code === 'BUYER_REFUND_REVERSAL_EXCEEDS_PAYMENT'
    || code === 'FILE_NOT_VERIFIED') {
    return new BuyerRefundHttpError('STATE_CONFLICT', 409);
  }
  return new BuyerRefundHttpError('DEPENDENCY_UNAVAILABLE', 503);
}

function withBuyerRefundHttpErrors(
  handler: (context: Context<AppEnv>) => Promise<Response>,
) {
  return async (context: Context<AppEnv>): Promise<Response> => {
    try { return await handler(context); }
    catch (error) {
      const normalized = normalizeHttpError(error);
      context.header('Cache-Control', 'no-store');
      return context.json(apiFailure(
        normalized.code,
        normalized.code,
        requestId(context),
      ), normalized.status);
    }
  };
}

function requestId(context: Context<AppEnv>): string {
  return String(context.get('requestId') ?? crypto.randomUUID());
}

function success<T>(context: Context<AppEnv>, data: T): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(data, requestId(context)));
}

function validationError(): never {
  throw new BuyerRefundHttpError('VALIDATION_ERROR', 400);
}
