import { apiFailure, apiSuccess, type BusinessActionCapabilityDto } from '@ygb/contracts';
import { normalizeAmazonOrderNumber } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../app';
import { readFormalOrderBusinessCapabilities } from '../formal-order-policy';
import { requestIdFromContext } from '../http-auth/errors';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';

export function registerAdvancePrincipalLookupRoute(app: Hono<AppEnv>): void {
  app.get('/api/staff/operating-integrity/order-lookup', lookup);
  app.get('/api/staff/buyer-advance-principal-lookup', lookup);
}

async function lookup(context: Context<AppEnv>) {
  const requestId = requestIdFromContext(context);
  const actor = context.get('staffAuthorization') as AssignmentStaffAuthorization | undefined;
  if (
    !actor ||
    actor.staffStatus !== 'ACTIVE' ||
    ![...actor.roles].some((role) =>
      ['owner', 'seller_ops', 'pre_sales', 'buyer_refund'].includes(role),
    )
  )
    return context.json(apiFailure('FORBIDDEN', '当前岗位不能查询该业务', requestId), 403);
  const url = new URL(context.req.url);
  if ([...url.searchParams.keys()].some((key) => key !== 'amazon_order_number'))
    return context.json(apiFailure('VALIDATION_ERROR', '查询参数不正确', requestId), 400);
  let orderNumber: string;
  try {
    orderNumber = normalizeAmazonOrderNumber(url.searchParams.get('amazon_order_number') ?? '');
  } catch {
    return context.json(apiFailure('VALIDATION_ERROR', 'Amazon 订单号格式不正确', requestId), 400);
  }
  try {
    const rows = await context.env.DB.prepare(
      `SELECT formal_order.id AS formal_order_id,formal_order.amazon_order_number_normalized,
        formal_order.buyer_customer_id,formal_order.seller_organization_id,formal_order.canonical_marketplace_code,
        formal_order.product_name_snapshot,formal_order.confirmed_at,formal_order.marketplace_business_date,
        (SELECT review_case.id FROM review_cases review_case WHERE review_case.formal_order_id=formal_order.id ORDER BY review_case.created_at DESC,review_case.id DESC LIMIT 1) AS review_case_id,
        (SELECT review_case.status FROM review_cases review_case WHERE review_case.formal_order_id=formal_order.id ORDER BY review_case.created_at DESC,review_case.id DESC LIMIT 1) AS review_status,
        EXISTS(SELECT 1 FROM buyer_refund_obligations obligation WHERE obligation.formal_order_id=formal_order.id) AS has_refund_obligation,
        (SELECT CAST(snapshot.buyer_expected_principal_cny_fen AS TEXT) FROM formal_order_financial_snapshots snapshot WHERE snapshot.formal_order_id=formal_order.id) AS advance_full_amount_cny_fen,
        COALESCE((SELECT SUM(CASE advance.entry_type WHEN 'PAYMENT' THEN advance.amount_cny_fen ELSE -advance.amount_cny_fen END)
          FROM buyer_advance_principal_entries advance WHERE advance.formal_order_id=formal_order.id),0) AS advance_net_cny_fen,
        (SELECT payment.id FROM buyer_advance_principal_entries payment WHERE payment.formal_order_id=formal_order.id AND payment.entry_type='PAYMENT' AND payment.amount_cny_fen>COALESCE((SELECT SUM(reversal.amount_cny_fen) FROM buyer_advance_principal_entries reversal WHERE reversal.entry_type='REVERSAL' AND reversal.original_payment_entry_id=payment.id),0) ORDER BY payment.created_at DESC,payment.id DESC LIMIT 1) AS active_advance_payment_id,
        COALESCE((SELECT state.operational_state FROM formal_order_effective_operational_state state WHERE state.formal_order_id=formal_order.id),'NORMAL') AS operational_state
      FROM formal_orders formal_order WHERE formal_order.amazon_order_number_normalized=? LIMIT 2`,
    )
      .bind(orderNumber)
      .all<any>();
    if (rows.results.length !== 1)
      return context.json(apiFailure('NOT_FOUND', '没有找到唯一的正式订单', requestId), 404);
    const value = rows.results[0];
    if (!actor.roles.has('owner')) {
      const markets = await resolveStaffMarketplaceCodes(context.env.DB, actor);
      if (!markets.includes(String(value.canonical_marketplace_code)))
        return context.json(apiFailure('NOT_FOUND', '没有找到唯一的正式订单', requestId), 404);
    }
    const policy = await readFormalOrderBusinessCapabilities(
      context.env.DB,
      String(value.formal_order_id),
    );
    const role = (...allowed: string[]) =>
      [...actor.roles].some((candidate) => allowed.includes(candidate));
    const actions = {
      record_order_event: capability(
        role('owner', 'seller_ops'),
        role('owner', 'seller_ops') ? null : 'ROLE_NOT_ALLOWED',
      ),
      record_review_visibility: capability(
        role('owner', 'pre_sales') &&
          value.review_case_id !== null &&
          String(value.review_status) === 'APPROVED',
        !role('owner', 'pre_sales')
          ? 'ROLE_NOT_ALLOWED'
          : value.review_case_id === null
            ? 'REVIEW_NOT_AVAILABLE'
            : String(value.review_status) !== 'APPROVED'
              ? 'REVIEW_NOT_APPROVED'
              : null,
      ),
      approve_review: capability(
        role('owner', 'buyer_refund') &&
          actor.permissions.has('REVIEW_DECIDE') &&
          value.review_case_id !== null &&
          String(value.review_status) === 'PENDING_REVIEW' &&
          policy.actions.APPROVE_REVIEW.allowed,
        !role('owner', 'buyer_refund') || !actor.permissions.has('REVIEW_DECIDE')
          ? 'ROLE_OR_PERMISSION_NOT_ALLOWED'
          : value.review_case_id === null
            ? 'REVIEW_NOT_AVAILABLE'
            : String(value.review_status) !== 'PENDING_REVIEW'
              ? 'REVIEW_NOT_PENDING'
              : policy.actions.APPROVE_REVIEW.reason,
      ),
      record_advance_principal: capability(
        role('owner', 'buyer_refund') &&
          Number(value.has_refund_obligation) !== 1 &&
          BigInt(String(value.advance_net_cny_fen)) === 0n &&
          policy.actions.RECORD_ADVANCE_PRINCIPAL.allowed,
        !role('owner', 'buyer_refund')
          ? 'ROLE_NOT_ALLOWED'
          : Number(value.has_refund_obligation) === 1
            ? 'REFUND_OBLIGATION_EXISTS'
            : BigInt(String(value.advance_net_cny_fen)) !== 0n
              ? 'ADVANCE_PAYMENT_EXISTS'
              : policy.actions.RECORD_ADVANCE_PRINCIPAL.reason,
      ),
      record_profit_adjustment: capability(
        actor.roles.has('owner') && actor.permissions.has('FINANCIAL_CORRECT'),
        actor.roles.has('owner') && actor.permissions.has('FINANCIAL_CORRECT')
          ? null
          : 'ROLE_OR_PERMISSION_NOT_ALLOWED',
      ),
    } as const;
    const refundFinancials = advancePrincipalFinancialsForActor(actor, value);
    context.header('Cache-Control', 'no-store');
    return context.json(
      apiSuccess(
        {
          order: {
            formal_order_id: String(value.formal_order_id),
            amazon_order_number: String(value.amazon_order_number_normalized),
            buyer_customer_id: String(value.buyer_customer_id),
            seller_organization_id: String(value.seller_organization_id),
            marketplace_code: String(value.canonical_marketplace_code),
            product_name: String(value.product_name_snapshot),
            confirmed_at: Number(value.confirmed_at),
            marketplace_business_date:
              value.marketplace_business_date === null
                ? null
                : String(value.marketplace_business_date),
            review_case_id: value.review_case_id === null ? null : String(value.review_case_id),
            review_status: value.review_status === null ? null : String(value.review_status),
            operational_state: String(value.operational_state),
            actions,
            ...refundFinancials,
          },
        },
        requestId,
      ),
    );
  } catch {
    return context.json(
      apiFailure('DEPENDENCY_UNAVAILABLE', '订单业务能力暂时无法读取，请稍后重试', requestId),
      503,
    );
  }
}

export function advancePrincipalFinancialsForActor(
  actor: Pick<AssignmentStaffAuthorization, 'roles'>,
  value: {
    has_refund_obligation: unknown;
    advance_full_amount_cny_fen: unknown;
    advance_net_cny_fen: unknown;
    active_advance_payment_id: unknown;
  },
): {
  has_refund_obligation: boolean | null;
  advance_full_amount_cny_fen: string | null;
  advance_net_cny_fen: string | null;
  active_advance_payment_id: string | null;
} {
  if (!actor.roles.has('owner') && !actor.roles.has('buyer_refund'))
    return {
      has_refund_obligation: null,
      advance_full_amount_cny_fen: null,
      advance_net_cny_fen: null,
      active_advance_payment_id: null,
    };
  return {
    has_refund_obligation: Number(value.has_refund_obligation) === 1,
    advance_full_amount_cny_fen:
      value.advance_full_amount_cny_fen === null ? null : String(value.advance_full_amount_cny_fen),
    advance_net_cny_fen: String(value.advance_net_cny_fen),
    active_advance_payment_id:
      value.active_advance_payment_id === null ? null : String(value.active_advance_payment_id),
  };
}

function capability(allowed: boolean, reason: string | null): BusinessActionCapabilityDto {
  return Object.freeze({ allowed, reason });
}
