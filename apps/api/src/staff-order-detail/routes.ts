import type { SqlDatabase } from '@ygb/contracts';
import { apiFailure, apiSuccess } from '@ygb/contracts';
import type { Context, Hono } from 'hono';
import { listOrderCommunicationScreenshots } from '../order-communication-screenshots/read-model';
import { requestIdFromContext } from '../http-auth/errors';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffDataScope, scopeAllowsSellerOrganization } from '../staff-assignment';

/**
 * D-056 §4.5: the single aggregate staff formal-order detail endpoint. It
 * replaces the separate order-integrity detail, the operating-integrity order
 * lookup and the buyer-advance-principal lookup alias; sections outside the
 * caller's authority are omitted rather than concealed behind another route.
 */
export function registerStaffOrderDetailRoutes(app: Hono<any>): void {
  app.get('/api/staff/formal-orders/:id', withErrors(readOrderDetail));
  app.get('/api/staff/formal-orders', withErrors(lookupByOrderNumber));
}

async function lookupByOrderNumber(context: Context<any>): Promise<Response> {
  const actor = requireStaff(context);
  const url = new URL(context.req.url);
  if (
    [...url.searchParams.keys()].some((key) => key !== 'amazon_order_number') ||
    url.searchParams.get('amazon_order_number') === null
  )
    throw validationError();
  const number = url.searchParams.get('amazon_order_number')!;
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

interface OrderRow {
  id: string;
  marketplace_code: string;
  seller_organization_id: string;
  store_display_name: string;
  buyer_customer_id: string;
  buyer_display_name: string;
  buyer_customer_no: string;
  amazon_order_number: string;
  amazon_order_date: string;
  confirmed_at: number;
  status: string;
}

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

  const scope = await resolveStaffDataScope(context.env.DB, actor, {
    requiredPermission: 'ORDER_VIEW',
  });
  if (!scopeAllowsSellerOrganization(scope, order.seller_organization_id)) {
    return notFound(context, '订单不存在');
  }

  const canViewFinance =
    actor.roles.has('owner') && actor.permissions.has('FINANCIAL_VIEW');

  // Stage 6.6E: the minimal authoritative advance partition. Visible to the
  // owner and the buyer-refund role only; amounts come from the frozen
  // financial snapshot and the ledger, never computed client-side.
  const canViewAdvance =
    actor.roles.has('owner') || actor.roles.has('buyer_refund');

  const [paymentScreenshot, communicationScreenshots, operationalEvents] =
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
        recorded_advance_amount_cny_fen:
          advanceRow.recorded_advance_amount_cny_fen,
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
