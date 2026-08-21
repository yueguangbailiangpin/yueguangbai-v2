import {
  apiFailure,
  apiSuccess,
  isApiErrorCode,
  isReservationDecision,
  type ApiErrorCode,
  type StaffRoleCode,
} from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { AppEnv } from '../app';
import type { Context, Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import { decideReservation } from '../reservations/decide-reservation';
import { reopenReservation } from '../reservations/reopen-reservation';
import type { ReservationStaffActor } from '../reservations/reservation-shared';
import {
  batchWithAssignmentRetry,
  prepareDirectWorkItem,
  requireAssignedWorkflowActor,
  requireSellerOrganizationScope,
  resolveStaffDataScope,
  type AssignmentStaffAuthorization,
} from '../staff-assignment';

const BODY_LIMIT = 8 * 1024;

interface ProductApplicationContextRow {
  application_id: string;
  organization_id: string;
  store_id: string;
  store_display_name: string;
  marketplace_code: string;
  asin: string;
  product_name: string;
  search_keywords_json: string;
  product_url: string | null;
  buyer_visible_notes: string | null;
  seller_notes: string | null;
  ordering_guide_expected_amount_jpy: number | null;
  status: string;
  version: number;
  submitted_at: number;
}

interface ReservationContextRow {
  reservation_id: string;
  buyer_customer_id: string;
  buyer_customer_no: string | null;
  buyer_display_name: string;
  buyer_display_wechat: string | null;
  organization_id: string;
  store_id: string;
  store_display_name: string;
  marketplace_code: string;
  status: string;
  version: number;
  submitted_at: number;
  hold_expires_at: number;
  order_deadline_snapshot: number;
  buyer_self_pay_bps_snapshot: number;
  reference_order_amount_jpy_snapshot: number;
  estimated_self_pay_jpy_snapshot: number;
  estimated_refundable_principal_jpy_snapshot: number;
  demand_batch_id: string;
  product_name: string;
  task_type: string;
  reservation_deadline: number;
  order_deadline: number;
}

export function registerStaffWorkflowClosureRoutes(app: Hono<any>): void {
  app.get(
    '/api/staff/product-applications/:id/review-context',
    withErrors(readProductApplicationReviewContext),
  );
  app.get(
    '/api/staff/reservations/:id/review-context',
    withErrors(readReservationReviewContext),
  );
  app.post(
    '/api/staff/reservations/:id/decision',
    withErrors(decideReservationHttp),
  );
  app.post(
    '/api/staff/reservations/:id/reopen',
    withErrors(reopenReservationHttp),
  );
}

async function readProductApplicationReviewContext(
  context: Context<any>,
): Promise<Response> {
  const session = requireAuthorization(context);
  const applicationId = requiredString(context.req.param('id'));
  const row = await context.env.DB.prepare(`
    SELECT
      application.id AS application_id,
      application.organization_id,
      application.store_id,
      store.display_name AS store_display_name,
      application.marketplace_code,
      application.asin_normalized AS asin,
      application.product_name,
      application.search_keywords_json,
      application.product_url,
      application.buyer_visible_notes,
      application.seller_notes,
      application.ordering_guide_expected_amount_jpy,
      application.status,
      application.version,
      application.submitted_at
    FROM product_applications application
    JOIN seller_stores store
      ON store.id=application.store_id
      AND store.organization_id=application.organization_id
    WHERE application.id=?
    LIMIT 1
  `).bind(applicationId).first() as ProductApplicationContextRow | null;
  if (!row) throw httpError('NOT_FOUND', 404);

  const actor = await requireAssignedWorkflowActor(context.env.DB, {
    staffId: session.staffId,
    workType: 'PRODUCT_APPLICATION_REVIEW',
    sourceEntityType: 'PRODUCT_APPLICATION',
    sourceEntityId: applicationId,
    authoritativeSellerOrganizationId: row.organization_id,
  });
  requireSellerOrganizationScope(
    await resolveStaffDataScope(context.env.DB, actor),
    row.organization_id,
  );

  return success(context, {
    review_context: {
      application_id: row.application_id,
      organization_id: row.organization_id,
      store: {
        id: row.store_id,
        display_name: row.store_display_name,
      },
      marketplace_code: row.marketplace_code,
      asin: row.asin,
      product_name: row.product_name,
      search_keywords: parseStringArray(row.search_keywords_json),
      product_url: row.product_url,
      buyer_visible_notes: row.buyer_visible_notes,
      seller_notes: row.seller_notes,
      ordering_guide_expected_amount_jpy:
        row.ordering_guide_expected_amount_jpy === null
          ? null
          : String(row.ordering_guide_expected_amount_jpy),
      status: row.status,
      version: Number(row.version),
      submitted_at: Number(row.submitted_at),
    },
  });
}

async function readReservationReviewContext(
  context: Context<any>,
): Promise<Response> {
  const session = requireAuthorization(context);
  const reservationId = requiredString(context.req.param('id'));
  const row = await context.env.DB.prepare(`
    SELECT
      reservation.id AS reservation_id,
      buyer.id AS buyer_customer_id,
      buyer.buyer_customer_no,
      buyer.display_name AS buyer_display_name,
      buyer_wechat.display_wechat AS buyer_display_wechat,
      reservation.organization_id,
      reservation.store_id,
      store.display_name AS store_display_name,
      reservation.marketplace_code,
      reservation.status,
      reservation.version,
      reservation.submitted_at,
      reservation.hold_expires_at,
      reservation.order_deadline_snapshot,
      reservation.buyer_self_pay_bps_snapshot,
      reservation.reference_order_amount_jpy_snapshot,
      reservation.estimated_self_pay_jpy_snapshot,
      reservation.estimated_refundable_principal_jpy_snapshot,
      demand.id AS demand_batch_id,
      version.product_name,
      demand.task_type,
      demand.reservation_deadline,
      demand.order_deadline
    FROM product_reservations reservation
    JOIN buyer_customers buyer
      ON buyer.id=reservation.buyer_customer_id
      AND buyer.marketplace_code=reservation.marketplace_code
    LEFT JOIN wechat_identity_claims buyer_wechat
      ON buyer_wechat.identity_subject_id=buyer.identity_subject_id
      AND buyer_wechat.status='ACTIVE'
    JOIN demand_batches demand ON demand.id=reservation.demand_batch_id
    JOIN product_versions version
      ON version.product_id=reservation.product_id
      AND version.version_no=reservation.product_version_no
    JOIN seller_stores store
      ON store.id=reservation.store_id
      AND store.organization_id=reservation.organization_id
    WHERE reservation.id=?
    LIMIT 1
  `).bind(reservationId).first() as ReservationContextRow | null;
  if (!row) throw httpError('NOT_FOUND', 404);

  const actor = await requireAssignedWorkflowActor(context.env.DB, {
    staffId: session.staffId,
    workType: 'RESERVATION_DECISION',
    sourceEntityType: 'RESERVATION',
    sourceEntityId: reservationId,
    authoritativeSellerOrganizationId: row.organization_id,
  });
  requireSellerOrganizationScope(
    await resolveStaffDataScope(context.env.DB, actor),
    row.organization_id,
  );

  return success(context, {
    review_context: {
      reservation_id: row.reservation_id,
      organization_id: row.organization_id,
      buyer: {
        id: row.buyer_customer_id,
        customer_no: row.buyer_customer_no,
        name: row.buyer_display_name,
        wechat: row.buyer_display_wechat,
      },
      store: {
        id: row.store_id,
        display_name: row.store_display_name,
      },
      marketplace_code: row.marketplace_code,
      status: row.status,
      version: Number(row.version),
      submitted_at: Number(row.submitted_at),
      hold_expires_at: Number(row.hold_expires_at),
      order_deadline_snapshot: Number(row.order_deadline_snapshot),
      buyer_self_pay_bps_snapshot: Number(row.buyer_self_pay_bps_snapshot),
      reference_order_amount_jpy_snapshot: String(row.reference_order_amount_jpy_snapshot),
      estimated_self_pay_jpy_snapshot: String(row.estimated_self_pay_jpy_snapshot),
      estimated_refundable_principal_jpy_snapshot:
        String(row.estimated_refundable_principal_jpy_snapshot),
      demand: {
        demand_batch_id: row.demand_batch_id,
        product_name: row.product_name,
        task_type: row.task_type,
        reservation_deadline: Number(row.reservation_deadline),
        order_deadline: Number(row.order_deadline),
      },
    },
  });
}

async function decideReservationHttp(context: Context<any>): Promise<Response> {
  const session = requireAuthorization(context);
  const body = record(await readBoundedJson(context.req.raw, BODY_LIMIT));
  rejectUnknown(body, ['expected_version', 'decision', 'rejection_reason']);
  const decision = body['decision'];
  if (!isReservationDecision(decision)) throw httpError('VALIDATION_ERROR', 400);
  const rejectionReason = body['rejection_reason'];
  if (rejectionReason !== undefined
    && rejectionReason !== null
    && typeof rejectionReason !== 'string') {
    throw httpError('VALIDATION_ERROR', 400);
  }
  const result = await decideReservation(context.env.DB, {
    reservationId: requiredString(context.req.param('id')),
    expectedVersion: positiveInteger(body['expected_version']),
    decision,
    ...(rejectionReason === undefined
      ? {}
      : { rejectionReason: rejectionReason as string | null }),
  }, {
    actor: reservationActor(session),
    idempotencyKey: idempotencyKey(context),
    requestId: requestIdFromContext(context),
  });
  return success(context, { reservation_decision: result });
}

interface ReservationWorkItemSourceRow {
  organization_id: string;
  store_id: string;
  marketplace_code: string;
  buyer_customer_id: string;
}

async function reopenReservationHttp(context: Context<AppEnv>): Promise<Response> {
  const session = requireAuthorization(context);
  const body = record(await readBoundedJson(context.req.raw, BODY_LIMIT));
  rejectUnknown(body, ['expected_version', 'reason']);
  const reservationId = requiredString(context.req.param('id'));
  const expectedVersion = positiveInteger(body['expected_version']);
  const reason = requiredString(body['reason'], 500);
  const idempotencyKeyValue = idempotencyKey(context);
  const requestId = requestIdFromContext(context);

  const result = await reopenReservation(context.env.DB, {
    reservationId,
    expectedVersion,
    reason,
  }, {
    actor: reservationActor(session),
    idempotencyKey: idempotencyKeyValue,
    requestId,
  });

  const source = await context.env.DB.prepare(`
    SELECT organization_id, store_id, marketplace_code, buyer_customer_id
    FROM product_reservations
    WHERE id=?
    LIMIT 1
  `).bind(reservationId).first<ReservationWorkItemSourceRow | null>();
  if (!source) throw httpError('NOT_FOUND', 404);

  await batchWithAssignmentRetry(
    context.env.DB,
    () => prepareDirectWorkItem(context.env.DB, {
      workType: 'RESERVATION_DECISION',
      sourceEntityType: 'RESERVATION',
      sourceEntityId: reservationId,
      marketplaceCode: source.marketplace_code,
      buyerCustomerId: source.buyer_customer_id,
      sellerOrganizationId: source.organization_id,
      storeId: source.store_id,
      actorType: 'STAFF',
      actorId: session.staffId,
      requestId,
      idempotencyKey: idempotencyKeyValue,
      reason: 'reservation reopened',
      now: Date.now(),
    }),
    [],
  );

  return success(context, { reservation_reopen: result });
}

function reservationActor(
  authorization: AssignmentStaffAuthorization,
): ReservationStaffActor {
  return {
    staffId: authorization.staffId,
    displayName: authorization.displayName,
    roles: Object.freeze([...authorization.roles]) as readonly StaffRoleCode[],
    permissions: authorization.permissions,
  };
}

function requireAuthorization(context: Context<any>): AssignmentStaffAuthorization {
  const authorization = context.get('staffAuthorization') as
    | AssignmentStaffAuthorization
    | null
    | undefined;
  if (!authorization) throw httpError('UNAUTHENTICATED', 401);
  return authorization;
}

function idempotencyKey(context: Context<any>): string {
  try {
    const key = parseIdempotencyKey(context.req.header('Idempotency-Key'));
    if (key === null) throw new Error('missing');
    return key;
  } catch {
    throw httpError('VALIDATION_ERROR', 400);
  }
}

function requiredString(value: unknown, maximum = 120): string {
  if (typeof value !== 'string') throw httpError('VALIDATION_ERROR', 400);
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw httpError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

function positiveInteger(value: unknown): number {
  if (typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 1) {
    throw httpError('VALIDATION_ERROR', 400);
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError('VALIDATION_ERROR', 400);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw httpError('VALIDATION_ERROR', 400);
  }
}

function parseStringArray(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
      throw new Error('invalid');
    }
    return Object.freeze(parsed);
  } catch {
    throw httpError('DEPENDENCY_UNAVAILABLE', 503);
  }
}

function httpError(code: ApiErrorCode, status: number): Error & {
  code: ApiErrorCode;
  status: number;
} {
  return Object.assign(new Error(code), { code, status });
}

function success(context: Context<any>, data: unknown): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(data, requestIdFromContext(context)));
}

function withErrors(handler: (context: Context<any>) => Promise<Response>) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      const candidate = error as { code?: unknown; status?: unknown };
      const code = isApiErrorCode(candidate?.code)
        ? candidate.code
        : 'DEPENDENCY_UNAVAILABLE';
      const status = candidate?.status === 400
        || candidate?.status === 401
        || candidate?.status === 403
        || candidate?.status === 404
        || candidate?.status === 409
        || candidate?.status === 503
        ? candidate.status
        : 503;
      return context.json(apiFailure(
        code,
        publicMessage(code),
        requestIdFromContext(context),
      ), status);
    }
  };
}

function publicMessage(code: ApiErrorCode): string {
  if (code === 'UNAUTHENTICATED') return '员工会话无效';
  if (code === 'FORBIDDEN') return '无权执行该操作';
  if (code === 'NOT_FOUND' || code.endsWith('_NOT_FOUND')) return '资源不存在';
  if (code === 'VALIDATION_ERROR') return '请求参数不正确';
  if (code === 'VERSION_CONFLICT') return '数据已发生变化，请刷新后重试';
  return '当前状态无法执行该操作';
}
