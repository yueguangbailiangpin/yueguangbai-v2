import {
  apiFailure,
  apiSuccess,
  type ApiErrorCode,
} from '@ygb/contracts';
import type { Context, Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import { customerSessionMiddleware } from '../middleware/customer-auth';
import { resolveSellerPortalActor } from '../seller-portal/actor';
import { parseSellerPortalPagination } from '../seller-portal/pagination';
import {
  getSellerPayable,
  getSellerPayment,
  listSellerPayables,
  listSellerPayments,
  readSellerSettlementSummary,
  sellerScope,
} from './read-model';
import {
  cleanSettlementIdentifier,
  normalizeSettlementError,
} from './shared';

export function registerSellerSettlementRoutes(app: Hono<any>): void {
  const session = customerSessionMiddleware();
  app.get(
    '/api/seller-portal/settlement/summary',
    session,
    withErrors(summary),
  );
  app.get(
    '/api/seller-portal/settlement/payables',
    session,
    withErrors(payables),
  );
  app.get(
    '/api/seller-portal/settlement/payables/:id',
    session,
    withErrors(payable),
  );
  app.get(
    '/api/seller-portal/settlement/payments',
    session,
    withErrors(payments),
  );
  app.get(
    '/api/seller-portal/settlement/payments/:id',
    session,
    withErrors(payment),
  );
}

async function summary(context: Context<any>): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  return success(context, {
    settlement: await readSellerSettlementSummary(
      context.env.DB,
      sellerScope(actor),
    ),
  });
}

async function payables(context: Context<any>): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  const pagination = parseSellerPortalPagination(new URL(context.req.url));
  return success(context, await listSellerPayables(
    context.env.DB,
    sellerScope(actor),
    pagination,
  ));
}

async function payable(context: Context<any>): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  return success(context, {
    payable: await getSellerPayable(
      context.env.DB,
      sellerScope(actor),
      cleanSettlementIdentifier(context.req.param('id')),
    ),
  });
}

async function payments(context: Context<any>): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  const pagination = parseSellerPortalPagination(new URL(context.req.url));
  return success(context, await listSellerPayments(
    context.env.DB,
    sellerScope(actor),
    pagination,
  ));
}

async function payment(context: Context<any>): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  return success(context, {
    payment: await getSellerPayment(
      context.env.DB,
      sellerScope(actor),
      cleanSettlementIdentifier(context.req.param('id')),
    ),
  });
}

function withErrors(
  handler: (context: Context<any>) => Promise<Response>,
) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      const normalized = normalizeSettlementError(error);
      const code = normalized.code as ApiErrorCode;
      return context.json(apiFailure(
        code,
        publicMessage(code),
        requestIdFromContext(context),
      ), normalized.status);
    }
  };
}

function publicMessage(code: ApiErrorCode): string {
  if (code === 'UNAUTHENTICATED') return '登录状态无效';
  if (code === 'FORBIDDEN' || code === 'NOT_FOUND') return '资源不存在';
  if (code === 'VALIDATION_ERROR') return '请求参数不正确';
  if (code === 'VERSION_CONFLICT') return '数据已发生变化，请刷新后重试';
  return '当前无法读取结算数据';
}

function success(context: Context<any>, data: unknown): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(data, requestIdFromContext(context)));
}