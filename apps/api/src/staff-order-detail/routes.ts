import type {
  FormalOrderBusinessStage,
  FormalOrderExceptionState,
  SqlDatabase,
  StaffFormalOrderListItemDto,
  StaffFormalOrderListPageDto,
} from '@ygb/contracts';
import {
  apiFailure,
  apiSuccess,
  isFormalOrderBusinessStage,
  isFormalOrderExceptionState,
  STAFF_ORDER_LIST_DEFAULT_LIMIT,
  STAFF_ORDER_LIST_MAX_LIMIT,
} from '@ygb/contracts';
import type { Context, Hono } from 'hono';
import {
  decodeBase64UrlJson,
  encodeBase64UrlJson,
} from '../foundation/cursor-codec';
import { listOrderCommunicationScreenshots } from '../order-communication-screenshots/read-model';
import { requestIdFromContext } from '../http-auth/errors';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { orderVisibilityForActor } from '../staff-assignment';
import {
  buildResponsibility,
  fixedAmountOrNull,
  readResponsibilityRow,
  responsibilitySelects,
  stageOf,
  exceptionStateOf,
} from './responsibility';

/**
 * D-056 §4.5: the single aggregate staff formal-order detail endpoint. It
 * replaces the separate order-integrity detail, the operating-integrity order
 * lookup and the buyer-advance-principal lookup alias; sections outside the
 * caller's authority are omitted rather than concealed behind another route.
 *
 * Stage 7.5 batch 1: the same route now also serves the authoritative formal
 * order cursor list. When the query string carries exactly the single
 * parameter `amazon_order_number` the legacy exact-lookup semantics (resolve
 * then replay the detail aggregate) are preserved verbatim; every other
 * request shape enters list mode with keyset pagination and fixed-assignment
 * visibility (owner global, buyer duties by assigned buyers, seller_ops by
 * assigned seller organizations).
 */
export function registerStaffOrderDetailRoutes(app: Hono<any>): void {
  app.get('/api/staff/formal-orders/:id', withErrors(readOrderDetail));
  app.get('/api/staff/formal-orders', withErrors(listOrLookup));
}

const LIST_PARAM_KEYS = [
  'amazon_order_number_prefix',
  'buyer_customer_no',
  'seller_organization_id',
  'store_id',
  'stage',
  'exception_state',
  'responsible_staff_id',
  'confirmed_from',
  'confirmed_to',
  'limit',
  'cursor',
] as const;

interface OrderListFilters {
  amazonOrderNumberPrefix: string | null;
  buyerCustomerNo: string | null;
  sellerOrganizationId: string | null;
  storeId: string | null;
  stage: FormalOrderBusinessStage | null;
  exceptionState: FormalOrderExceptionState | null;
  responsibleStaffId: string | null;
  confirmedFrom: number | null;
  confirmedTo: number | null;
}

async function listOrLookup(context: Context<any>): Promise<Response> {
  const actor = requireStaff(context);
  const url = new URL(context.req.url);
  const keys = [...url.searchParams.keys()];
  if (
    keys.length === 1
    && keys[0] === 'amazon_order_number'
    && url.searchParams.getAll('amazon_order_number').length === 1
  ) {
    return lookupByOrderNumber(context, actor, url.searchParams.get('amazon_order_number')!);
  }
  return listOrders(context, actor);
}

async function lookupByOrderNumber(
  context: Context<any>,
  actor: AssignmentStaffAuthorization,
  number: string,
): Promise<Response> {
  const row = await context.env.DB
    .prepare(
      `SELECT id FROM formal_orders WHERE amazon_order_number_normalized=? LIMIT 1`,
    )
    .bind(number)
    .first() as { id: string } | null;
  if (!row) return notFound(context, '订单不存在');
  // Re-run the full aggregate for the resolved id.
  return readOrderDetailForId(context, actor, row.id);
}

// ---------------------------------------------------------------------------
// List mode
// ---------------------------------------------------------------------------

interface OrderRow {
  id: string;
  marketplace_code: string;
  seller_organization_id: string;
  store_display_name: string;
  buyer_customer_id: string;
  buyer_display_name: string;
  buyer_customer_no: string;
  amazon_order_number: string;
  amazon_order_date: string | null;
  confirmed_at: number;
  status: string;
  product_name_snapshot: string;
  review_type: string;
  buyer_expected_principal_cny_fen: number | string | null;
  seller_expected_principal_cny_fen: number | string | null;
  refund_open: 0 | 1;
  settlement_open: 0 | 1;
  latest_event_type: string | null;
  latest_event_reason: string | null;
  refund_sla_anchor: number | null;
  settlement_due_at: number | null;
  refund_owner_staff_id: string | null;
  refund_owner_staff_name: string | null;
  seller_manager_staff_id: string | null;
  seller_manager_staff_name: string | null;
  owner_staff_id: string | null;
  owner_staff_name: string | null;
}

function parseListFilters(
  url: URL,
): { filters: OrderListFilters; limit: number; cursor: { confirmedAt: number; id: string } | null } {
  for (const key of url.searchParams.keys()) {
    if (
      !(LIST_PARAM_KEYS as readonly string[]).includes(key)
      || url.searchParams.getAll(key).length !== 1
    ) {
      throw validationError();
    }
  }
  const text = (key: string, min: number, max: number): string | null => {
    const raw = url.searchParams.get(key);
    if (raw === null) return null;
    const normalized = raw.normalize('NFKC').trim();
    if (normalized.length < min || normalized.length > max) throw validationError();
    return normalized;
  };
  const stageParam = url.searchParams.get('stage');
  if (stageParam !== null && !isFormalOrderBusinessStage(stageParam)) {
    throw validationError();
  }
  const exceptionParam = url.searchParams.get('exception_state');
  if (exceptionParam !== null && !isFormalOrderExceptionState(exceptionParam)) {
    throw validationError();
  }
  const epoch = (key: string): number | null => {
    const raw = url.searchParams.get(key);
    if (raw === null) return null;
    if (!/^[0-9]{1,15}$/u.test(raw)) throw validationError();
    return Number(raw);
  };
  const limitRaw = url.searchParams.get('limit');
  let limit: number = STAFF_ORDER_LIST_DEFAULT_LIMIT;
  if (limitRaw !== null) {
    if (!/^[1-9][0-9]{0,2}$/u.test(limitRaw)) throw validationError();
    limit = Number(limitRaw);
    if (limit < 1 || limit > STAFF_ORDER_LIST_MAX_LIMIT) throw validationError();
  }
  const filters: OrderListFilters = {
    amazonOrderNumberPrefix: text('amazon_order_number_prefix', 3, 100),
    buyerCustomerNo: text('buyer_customer_no', 3, 120),
    sellerOrganizationId: text('seller_organization_id', 1, 200),
    storeId: text('store_id', 1, 200),
    stage: stageParam,
    exceptionState: exceptionParam,
    responsibleStaffId: text('responsible_staff_id', 1, 200),
    confirmedFrom: epoch('confirmed_from'),
    confirmedTo: epoch('confirmed_to'),
  };
  const cursorRaw = url.searchParams.get('cursor');
  let cursor: { confirmedAt: number; id: string } | null = null;
  if (cursorRaw !== null) {
    const decoded = decodeCursor(cursorRaw);
    if (decoded.echo !== cursorFilterEcho(filters)) {
      throw validationError();
    }
    cursor = { confirmedAt: decoded.confirmedAt, id: decoded.id };
  }
  return { filters, limit, cursor };
}

function cursorFilterEcho(filters: OrderListFilters): string {
  return JSON.stringify([
    filters.amazonOrderNumberPrefix,
    filters.buyerCustomerNo,
    filters.sellerOrganizationId,
    filters.storeId,
    filters.stage,
    filters.exceptionState,
    filters.responsibleStaffId,
    filters.confirmedFrom,
    filters.confirmedTo,
  ]);
}

export function encodeCursor(
  filters: OrderListFilters,
  confirmedAt: number,
  id: string,
): string {
  return encodeBase64UrlJson({
    v: 1,
    kind: 'staff-order-list',
    at: confirmedAt,
    id,
    echo: cursorFilterEcho(filters),
  });
}

export function decodeCursor(
  raw: string,
): { confirmedAt: number; id: string; echo: string } {
  if (raw.length < 1 || raw.length > 2000) throw validationError();
  let parsed: unknown;
  try {
    parsed = decodeBase64UrlJson(raw);
  } catch {
    throw validationError();
  }
  const row = parsed as Record<string, unknown>;
  if (
    row['v'] !== 1
    || row['kind'] !== 'staff-order-list'
    || !Number.isSafeInteger(row['at'])
    || Number(row['at']) < 0
    || typeof row['id'] !== 'string'
    || row['id'].length < 1
    || row['id'].length > 120
    || typeof row['echo'] !== 'string'
  ) {
    throw validationError();
  }
  return { confirmedAt: Number(row['at']), id: row['id'], echo: row['echo'] };
}

/** Fixed-assignment visibility fragment; returns SQL + bind params. */
async function orderVisibility(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  alias: string,
): Promise<{ sql: string; params: unknown[]; marketplaceCodes: readonly string[] }> {
  return orderVisibilityForActor(database, actor, alias);
}

async function listOrders(
  context: Context<any>,
  actor: AssignmentStaffAuthorization,
): Promise<Response> {
  const url = new URL(context.req.url);
  const { filters, limit, cursor } = parseListFilters(url);
  const visibility = await orderVisibility(context.env.DB, actor, 'o');
  // A marketplace-leading index cannot emit one global confirmed_at/id order
  // when SQLite scans more than one marketplace segment. The existing global
  // keyset index is the smallest equivalent path for the fixed buyer-refund
  // read in that case; single-market and owner paths keep their current plan.
  const orderIndexHint = actor.roles.has('buyer_refund')
    && visibility.marketplaceCodes.length > 1
    ? ' INDEXED BY idx_formal_orders_confirmed_id'
    : '';

  const where: string[] = [visibility.sql];
  const params: unknown[] = [...visibility.params];
  if (filters.amazonOrderNumberPrefix !== null) {
    where.push('o.amazon_order_number_normalized LIKE ? ESCAPE \'\\\'');
    params.push(likePrefix(filters.amazonOrderNumberPrefix));
  }
  if (filters.buyerCustomerNo !== null) {
    where.push('o.buyer_customer_no=?');
    params.push(filters.buyerCustomerNo);
  }
  if (filters.sellerOrganizationId !== null) {
    where.push('o.seller_organization_id=?');
    params.push(filters.sellerOrganizationId);
  }
  if (filters.storeId !== null) {
    where.push('o.store_id=?');
    params.push(filters.storeId);
  }
  if (filters.confirmedFrom !== null) {
    where.push('o.confirmed_at>=?');
    params.push(filters.confirmedFrom);
  }
  if (filters.confirmedTo !== null) {
    where.push('o.confirmed_at<=?');
    params.push(filters.confirmedTo);
  }
  const stageExpr = `(CASE WHEN EXISTS (
      SELECT 1 FROM buyer_refund_ledger_balances obligation
      WHERE obligation.formal_order_id=o.id
        AND obligation.status IN ('DUE','PARTIALLY_PAID')
    ) THEN 'BUYER_REFUND' WHEN EXISTS (
      SELECT 1 FROM seller_payable_balances payable
      WHERE payable.formal_order_id=o.id
        AND payable.outstanding_amount_cny_fen>0
    ) THEN 'SELLER_SETTLEMENT' ELSE 'COMPLETED' END)`;
  if (filters.stage !== null) {
    where.push(`${stageExpr}=?`);
    params.push(filters.stage);
  }
  const exceptionExpr = `COALESCE((
    SELECT CASE event.event_type WHEN 'RESOLVED' THEN 'NONE' ELSE 'OPEN' END
    FROM formal_order_operational_events event
    WHERE event.formal_order_id=o.id
    ORDER BY event.created_at DESC,event.id DESC LIMIT 1
  ),'NONE')`;
  if (filters.exceptionState !== null) {
    where.push(`${exceptionExpr}=?`);
    params.push(filters.exceptionState);
  }
  if (filters.responsibleStaffId !== null) {
    where.push(`(
      (${stageExpr}='BUYER_REFUND' AND (
        SELECT staff.id FROM buyer_staff_assignments assignment
        JOIN staff_users staff ON staff.id=assignment.staff_id AND staff.status='ACTIVE'
        WHERE assignment.buyer_customer_id=o.buyer_customer_id
          AND assignment.duty_code='BUYER_REFUND_OWNER' AND assignment.status='ACTIVE'
        ORDER BY assignment.created_at,assignment.id LIMIT 1
      )=?)
      OR (${stageExpr}='SELLER_SETTLEMENT' AND (
        SELECT staff.id FROM seller_staff_assignments assignment
        JOIN staff_users staff ON staff.id=assignment.staff_id AND staff.status='ACTIVE'
        WHERE assignment.seller_organization_id=o.seller_organization_id
          AND assignment.duty_code='SELLER_ACCOUNT_MANAGER' AND assignment.status='ACTIVE'
        ORDER BY assignment.created_at,assignment.id LIMIT 1
      )=?)
      OR (${stageExpr}='COMPLETED' AND (
        SELECT staff.id FROM staff_users staff
        JOIN staff_role_assignments role ON role.staff_id=staff.id
          AND role.status='ACTIVE' AND role.role_code='owner'
        WHERE staff.status='ACTIVE'
        ORDER BY staff.created_at,staff.id LIMIT 1
      )=?)
    )`);
    params.push(
      filters.responsibleStaffId,
      filters.responsibleStaffId,
      filters.responsibleStaffId,
    );
  }
  if (cursor !== null) {
    where.push('(o.confirmed_at<? OR (o.confirmed_at=? AND o.id<?))');
    params.push(cursor.confirmedAt, cursor.confirmedAt, cursor.id);
  }

  const rows = await (context.env.DB as SqlDatabase)
    .prepare(
      `SELECT o.id, o.marketplace_code,
        o.seller_organization_id,
        store.display_name AS store_display_name,
        o.buyer_customer_id,
        buyer.display_name AS buyer_display_name,
        o.buyer_customer_no,
        o.amazon_order_number_normalized AS amazon_order_number,
        o.amazon_order_date,
        o.confirmed_at,
        o.status,
        o.product_name_snapshot,
        o.review_type,
        CAST(snapshot.buyer_expected_principal_cny_fen AS TEXT)
          AS buyer_expected_principal_cny_fen,
        CAST(snapshot.seller_expected_principal_cny_fen AS TEXT)
          AS seller_expected_principal_cny_fen,
        ${responsibilitySelects('o')}
      FROM formal_orders o${orderIndexHint}
      JOIN seller_stores store ON store.id=o.store_id
      JOIN buyer_customers buyer ON buyer.id=o.buyer_customer_id
      LEFT JOIN formal_order_financial_snapshots snapshot
        ON snapshot.formal_order_id=o.id
      WHERE ${where.join(' AND ')}
      ORDER BY o.confirmed_at DESC, o.id DESC
      LIMIT ?`,
    )
    .bind(...params, limit + 1)
    .all<OrderRow>();

  const hasMore = rows.results.length > limit;
  const page = rows.results.slice(0, limit);
  const now = Date.now();
  const items: StaffFormalOrderListItemDto[] = page.map((row) => ({
    formal_order_id: row.id,
    marketplace_code: row.marketplace_code,
    amazon_order_number: row.amazon_order_number,
    amazon_order_date: row.amazon_order_date,
    confirmed_at: Number(row.confirmed_at),
    buyer_customer_id: row.buyer_customer_id,
    buyer_customer_no: row.buyer_customer_no,
    buyer_display_name: row.buyer_display_name,
    seller_organization_id: row.seller_organization_id,
    store_display_name: row.store_display_name,
    product_name_snapshot: row.product_name_snapshot,
    review_type: row.review_type as StaffFormalOrderListItemDto['review_type'],
    buyer_expected_principal_cny_fen: fixedAmountOrNull(
      row.buyer_expected_principal_cny_fen,
    ),
    seller_expected_principal_cny_fen: fixedAmountOrNull(
      row.seller_expected_principal_cny_fen,
    ),
    responsibility: buildResponsibility(row, actor, now),
  }));
  const last = page.at(-1);
  const response: StaffFormalOrderListPageDto = {
    items,
    next_cursor: hasMore && last
      ? encodeCursor(filters, Number(last.confirmed_at), last.id)
      : null,
  };
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(response, requestIdFromContext(context)));
}

function likePrefix(value: string): string {
  return `${value.replace(/[\\%_]/gu, (char) => `\\${char}`)}%`;
}

// ---------------------------------------------------------------------------
// Detail (single aggregate)
// ---------------------------------------------------------------------------

async function readOrderDetail(context: Context<any>): Promise<Response> {
  const actor = requireStaff(context);
  const orderId = requiredId(context.req.param('id'));
  return readOrderDetailForId(context, actor, orderId);
}

async function readOrderDetailForId(
  context: Context<any>,
  actor: AssignmentStaffAuthorization,
  orderId: string,
): Promise<Response> {
  const order = await context.env.DB
    .prepare(
      `SELECT formal_order.id, formal_order.marketplace_code,
        formal_order.seller_organization_id,
        store.display_name AS store_display_name,
        formal_order.buyer_customer_id,
        buyer.display_name AS buyer_display_name,
        buyer.buyer_customer_no,
        formal_order.amazon_order_number_normalized AS amazon_order_number,
        formal_order.amazon_order_date,
        formal_order.confirmed_at,
        formal_order.status
      FROM formal_orders formal_order
      JOIN seller_stores store ON store.id=formal_order.store_id
      JOIN buyer_customers buyer ON buyer.id=formal_order.buyer_customer_id
      WHERE formal_order.id=?`,
    )
    .bind(orderId)
    .first() as OrderRow | null;
  if (!order) return notFound(context, '订单不存在');

  // Stage 7.5 batch 1: fixed-assignment visibility (owner global; buyer
  // duties by assigned buyers; seller_ops by assigned seller organizations),
  // intersected with marketplace scope. Out-of-scope orders conceal as 404.
  const visibility = await orderVisibility(context.env.DB, actor, 'formal_order');
  const visible = await context.env.DB
    .prepare(
      `SELECT 1 AS visible FROM formal_orders formal_order
      WHERE formal_order.id=? AND ${visibility.sql}`,
    )
    .bind(orderId, ...visibility.params)
    .first();
  if (!visible) return notFound(context, '订单不存在');

  const canViewFinance =
    actor.roles.has('owner') && actor.permissions.has('FINANCIAL_VIEW');

  // Stage 6.6E: the minimal authoritative advance partition. Visible to the
  // owner and the buyer-refund role only; amounts come from the frozen
  // financial snapshot and the ledger, never computed client-side.
  const canViewAdvance =
    actor.roles.has('owner') || actor.roles.has('buyer_refund');

  const [paymentScreenshot, communicationScreenshots, operationalEvents, responsibilityRow] =
    await Promise.all([
      readPaymentScreenshot(context.env.DB, orderId),
      listOrderCommunicationScreenshots(context.env.DB, [orderId]),
      context.env.DB
        .prepare(
          `SELECT id AS event_id,event_type,reason,actor_staff_id,created_at
          FROM formal_order_operational_events WHERE formal_order_id=?
          ORDER BY created_at,id`,
        )
        .bind(orderId)
        .all(),
      readResponsibilityRow(context.env.DB, orderId),
    ]);

  const sections: Record<string, unknown> = {
    order: {
      formal_order_id: order.id,
      marketplace_code: order.marketplace_code,
      amazon_order_number: order.amazon_order_number,
      amazon_order_date: order.amazon_order_date,
      status: order.status,
      confirmed_at: Number(order.confirmed_at),
    },
    buyer: {
      buyer_customer_id: order.buyer_customer_id,
      display_name: order.buyer_display_name,
      customer_no: order.buyer_customer_no,
    },
    seller: {
      seller_organization_id: order.seller_organization_id,
      store_display_name: order.store_display_name,
    },
    payment_screenshot: paymentScreenshot,
    communication_screenshots: communicationScreenshots.get(orderId) ?? [],
    operational_events: operationalEvents.results,
  };

  // Stage 7.5 batch 1: authoritative responsibility projection.
  if (responsibilityRow) {
    sections['responsibility'] = buildResponsibility(
      responsibilityRow,
      actor,
      Date.now(),
    );
  }

  if (canViewFinance) {
    const [adjustments, snapshot] = await Promise.all([
      context.env.DB
        .prepare(
          `SELECT id AS adjustment_id,adjustment_scope,
            CAST(amount_cny_fen AS TEXT) AS amount_cny_fen,reason,
            actor_staff_id,created_at
          FROM formal_order_financial_adjustments WHERE formal_order_id=?
          ORDER BY created_at,id`,
        )
        .bind(orderId)
        .all(),
      context.env.DB
        .prepare(
          `SELECT id AS financial_snapshot_id,
            buyer_self_pay_bps, buyer_self_pay_jpy,
            CAST(buyer_expected_principal_cny_fen AS TEXT) AS buyer_expected_principal_cny_fen,
            CAST(seller_expected_principal_cny_fen AS TEXT) AS seller_expected_principal_cny_fen,
            CAST(service_fee_cny_fen AS TEXT) AS service_fee_cny_fen
          FROM formal_order_financial_snapshots WHERE formal_order_id=?
          ORDER BY created_at DESC,id DESC LIMIT 1`,
        )
        .bind(orderId)
        .first(),
    ]);
    sections['financial_adjustments'] = adjustments.results;
    sections['financial_snapshot'] = snapshot;
    // The authoritative money numbers stay in internal-finance; this endpoint
    // only repeats the frozen snapshot facts for one-page context.
    sections['finance_source'] = 'internal-finance';
  }

  if (canViewAdvance) {
    const advanceRow = await context.env.DB
      .prepare(
        `SELECT CAST(snapshot.buyer_expected_principal_cny_fen AS TEXT)
            AS authoritative_advance_amount_cny_fen,
          CAST(COALESCE((
            SELECT SUM(payment.amount_cny_fen)
            FROM buyer_advance_principal_entries payment
            WHERE payment.formal_order_id=snapshot.formal_order_id
              AND payment.entry_type='PAYMENT'
          ),0) - COALESCE((
            SELECT SUM(reversal.amount_cny_fen)
            FROM buyer_advance_principal_entries reversal
            WHERE reversal.formal_order_id=snapshot.formal_order_id
              AND reversal.entry_type='REVERSAL'
          ),0) AS TEXT) AS recorded_advance_amount_cny_fen
        FROM formal_order_financial_snapshots snapshot
        WHERE snapshot.formal_order_id=?`,
      )
      .bind(orderId)
      .first() as {
        authoritative_advance_amount_cny_fen: string;
        recorded_advance_amount_cny_fen: string;
      } | null;
    if (advanceRow) {
      const authoritative = Number(advanceRow.authoritative_advance_amount_cny_fen);
      const recorded = Number(advanceRow.recorded_advance_amount_cny_fen);
      const outstanding = await context.env.DB
        .prepare(
          `SELECT 1 AS present FROM buyer_advance_principal_entries payment
          WHERE payment.formal_order_id=? AND payment.entry_type='PAYMENT'
            AND payment.amount_cny_fen>COALESCE((
              SELECT SUM(reversal.amount_cny_fen)
              FROM buyer_advance_principal_entries reversal
              WHERE reversal.entry_type='REVERSAL'
                AND reversal.original_payment_entry_id=payment.id
            ),0) LIMIT 1`,
        )
        .bind(orderId)
        .first();
      const refundLocked = await context.env.DB
        .prepare(
          `SELECT 1 AS present FROM buyer_refund_obligations
          WHERE formal_order_id=? LIMIT 1`,
        )
        .bind(orderId)
        .first();
      sections['buyer_advance'] = Object.freeze({
        authoritative_advance_amount_cny_fen:
          advanceRow.authoritative_advance_amount_cny_fen,
        recorded_advance_amount_cny_fen: advanceRow.recorded_advance_amount_cny_fen,
        remaining_advance_amount_cny_fen: String(
          Math.max(authoritative - recorded, 0),
        ),
        can_record_advance_payment:
          actor.permissions.has('BUYER_REFUND_RECORD')
          && outstanding === null
          && refundLocked === null,
      });
    }
  }

  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(sections, requestIdFromContext(context)));
}

async function readPaymentScreenshot(
  database: SqlDatabase,
  orderId: string,
): Promise<unknown> {
  const row = await database
    .prepare(
      `SELECT link.file_object_id, object.version AS file_version
      FROM file_entity_links link
      JOIN file_objects object ON object.id=link.file_object_id
      WHERE link.entity_type='ORDER' AND link.entity_id=?
        AND link.purpose='ORDER_EVIDENCE'
        AND link.visibility='BUYER_VISIBLE'
        AND link.revoked_at IS NULL
        AND object.status='VERIFIED'
      ORDER BY link.created_at, link.id LIMIT 1`,
    )
    .bind(orderId)
    .first<{ file_object_id: string; file_version: number }>();
  return row === null
    ? null
    : Object.freeze({
        file_object_id: row.file_object_id,
        file_version: Number(row.file_version),
      });
}

function requireStaff(context: Context<any>): AssignmentStaffAuthorization {
  const actor = context.get('staffAuthorization') as
    | AssignmentStaffAuthorization
    | null
    | undefined;
  if (!actor || actor.staffStatus !== 'ACTIVE' || !actor.permissions.has('ORDER_VIEW')) {
    throw Object.assign(new Error('forbidden'), { status: 403, code: 'FORBIDDEN' });
  }
  return actor;
}

function requiredId(value: unknown): string {
  if (typeof value !== 'string') throw validationError();
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1 || normalized.length > 120) throw validationError();
  return normalized;
}

function validationError(): Error & { status: number; code: string } {
  return Object.assign(new Error('validation'), { status: 400, code: 'VALIDATION_ERROR' });
}

function notFound(context: Context<any>, message: string): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(
    apiFailure('NOT_FOUND', message, requestIdFromContext(context)),
    404,
  );
}

function withErrors(handler: (context: Context<any>) => Promise<Response>) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
      const status = candidate?.status === 403 || candidate?.status === 400
        ? (candidate.status as 400 | 403)
        : 503;
      const code = candidate?.code === 'FORBIDDEN' || candidate?.code === 'VALIDATION_ERROR'
        ? candidate.code
        : 'DEPENDENCY_UNAVAILABLE';
      context.header('Cache-Control', 'no-store');
      return context.json(
        apiFailure(code as never, '请求无法完成', requestIdFromContext(context)),
        status,
      );
    }
  };
}

// Re-exported for tests: stage/exception helpers stay reachable.
export { stageOf, exceptionStateOf };
