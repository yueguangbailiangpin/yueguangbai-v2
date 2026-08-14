import {
  apiSuccess,
} from '@ygb/contracts';
import { parseIdempotencyKey } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { requireBuyerPortalContext } from '../buyer-portal/buyer-context';
import { requestIdFromContext } from '../http-auth/errors';
import { customerSessionMiddleware } from '../middleware/customer-auth';
import {
  buyerRefundPortalFailure,
  BuyerRefundPortalError,
  normalizeBuyerRefundPortalError,
} from './errors';
import {
  decodeBuyerRefundPortalCursor,
  parseBuyerRefundPortalPageLimit,
} from './pagination';
import {
  getBuyerRefund,
  listBuyerRefunds,
} from './read-model';
import { remindBuyerRefund } from './remind';

const MAX_IDENTIFIER_LENGTH = 120;
const ALLOWED_LIST_QUERY_KEYS = new Set(['limit', 'cursor']);

export function registerBuyerRefundStatusRoutes(app: Hono<any>): void {
  const session = customerSessionMiddleware();
  app.get(
    '/api/buyer-portal/refunds',
    session,
    withBuyerRefundErrors(listOwnRefunds),
  );
  app.get(
    '/api/buyer-portal/refunds/:id',
    session,
    withBuyerRefundErrors(getOwnRefund),
  );
  app.post(
    '/api/buyer-portal/refunds/:id/remind',
    session,
    withBuyerRefundErrors(remindOwnRefund),
  );
}

async function listOwnRefunds(context: Context<any>): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  const url = new URL(context.req.url);
  rejectUnknownOrRepeatedQuery(url);
  const page = await listBuyerRefunds(
    context.env.DB,
    buyer,
    {
      limit: parseBuyerRefundPortalPageLimit(
        singleQuery(url, 'limit') ?? undefined,
      ),
      cursor: decodeBuyerRefundPortalCursor(
        singleQuery(url, 'cursor') ?? undefined,
      ),
    },
  );
  return success(context, page);
}

async function getOwnRefund(context: Context<any>): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  const refund = await getBuyerRefund(
    context.env.DB,
    buyer,
    requireRouteId(context),
  );
  return success(context, { refund });
}

async function remindOwnRefund(context: Context<any>): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  const result = await remindBuyerRefund(context.env.DB, buyer, {
    obligationId: requireRouteId(context),
    idempotencyKey: requireIdempotencyKey(context),
    requestId: requestIdFromContext(context),
  });
  return success(context, {
    reminder: {
      refund_obligation_id: result.refund_obligation_id,
      reminder_count: result.reminder_count,
      last_reminded_at: result.last_reminded_at,
      next_reminder_at: result.next_reminder_at,
    },
    replayed: result.replayed,
  });
}

function rejectUnknownOrRepeatedQuery(url: URL): void {
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_LIST_QUERY_KEYS.has(key)
      || url.searchParams.getAll(key).length !== 1) {
      validationError();
    }
  }
}

function singleQuery(url: URL, key: string): string | null {
  return url.searchParams.get(key);
}

function requireRouteId(context: Context<any>): string {
  const value = context.req.param('id');
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > MAX_IDENTIFIER_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new BuyerRefundPortalError('NOT_FOUND', 404);
  }
  return value;
}

function requireIdempotencyKey(context: Context<any>): string {
  const value = parseIdempotencyKey(context.req.header('Idempotency-Key'));
  if (!value) validationError();
  return value;
}

function withBuyerRefundErrors(
  handler: (context: Context<any>) => Promise<Response>,
) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      return buyerRefundPortalFailure(
        context,
        normalizeBuyerRefundPortalError(error),
      );
    }
  };
}

function success<T>(context: Context<any>, data: T): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(
    apiSuccess(data, requestIdFromContext(context)),
    200,
  );
}

function validationError(): never {
  throw new BuyerRefundPortalError('VALIDATION_ERROR', 400);
}
