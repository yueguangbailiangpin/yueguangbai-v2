import {
  apiSuccess,
  isPricingReviewType,
  type PricingReviewType,
} from '@ygb/contracts';
import type { Context, Hono } from 'hono';
import { requireBuyerPortalContext } from '../buyer-portal/buyer-context';
import { requestIdFromContext } from '../http-auth/errors';
import { customerSessionMiddleware } from '../middleware/customer-auth';
import {
  buyerFormalOrderFailure,
  BuyerFormalOrderPortalError,
  normalizeBuyerFormalOrderError,
} from './errors';
import {
  decodeBuyerFormalOrderCursor,
  parseBuyerFormalOrderPageLimit,
} from './pagination';
import {
  getBuyerFormalOrder,
  listBuyerFormalOrders,
  type BuyerFormalOrderFilters,
} from './read-model';

const ALLOWED_LIST_QUERY_KEYS = new Set([
  'limit',
  'cursor',
  'marketplace',
  'asin',
  'product_name',
  'review_type',
  'confirmed_business_date',
  'formal_order_id',
  'amazon_order_number',
]);

export function registerBuyerFormalOrderRoutes(app: Hono<any>): void {
  const session = customerSessionMiddleware();
  app.get(
    '/api/buyer-portal/formal-orders',
    session,
    withBuyerFormalOrderErrors(listFormalOrders),
  );
  app.get(
    '/api/buyer-portal/formal-orders/:id',
    session,
    withBuyerFormalOrderErrors(getFormalOrder),
  );
}

async function listFormalOrders(context: Context<any>): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  const url = new URL(context.req.url);
  rejectUnknownOrRepeatedQuery(url);
  const page = await listBuyerFormalOrders(
    context.env.DB,
    buyer,
    {
      limit: parseBuyerFormalOrderPageLimit(
        singleQuery(url, 'limit') ?? undefined,
      ),
      cursor: decodeBuyerFormalOrderCursor(
        singleQuery(url, 'cursor') ?? undefined,
      ),
      filters: parseFilters(url),
    },
  );
  return success(context, page);
}

async function getFormalOrder(context: Context<any>): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  const id = context.req.param('id');
  const formalOrder = await getBuyerFormalOrder(
    context.env.DB,
    buyer,
    id,
  );
  return success(context, { formal_order: formalOrder });
}

function parseFilters(url: URL): BuyerFormalOrderFilters {
  return {
    marketplace: optionalMarketplace(singleQuery(url, 'marketplace')),
    asin: optionalAsin(singleQuery(url, 'asin')),
    productName: optionalText(
      singleQuery(url, 'product_name'),
      200,
    ),
    reviewType: optionalReviewType(singleQuery(url, 'review_type')),
    confirmedBusinessDate: optionalBusinessDate(
      singleQuery(url, 'confirmed_business_date'),
    ),
    formalOrderId: optionalIdentifier(
      singleQuery(url, 'formal_order_id'),
    ),
    amazonOrderNumber: optionalAmazonOrderNumber(
      singleQuery(url, 'amazon_order_number'),
    ),
  };
}

function optionalMarketplace(value: string | null): 'JP' | null {
  if (value === null) return null;
  if (value !== 'JP') return validationError();
  return value;
}

function optionalAsin(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.normalize('NFKC').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/u.test(normalized)) return validationError();
  return normalized;
}

function optionalReviewType(
  value: string | null,
): PricingReviewType | null {
  if (value === null) return null;
  if (!isPricingReviewType(value)) return validationError();
  return value;
}

function optionalBusinessDate(value: string | null): string | null {
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return validationError();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())
    || parsed.toISOString().slice(0, 10) !== value) {
    return validationError();
  }
  return value;
}

function optionalAmazonOrderNumber(value: string | null): string | null {
  if (value === null) return null;
  const compact = value
    .normalize('NFKC')
    .trim()
    .replace(/[‐‑‒–—―−﹘﹣－]/gu, '-')
    .replace(/[\s\u00a0]/gu, '');
  if (!/^[0-9-]+$/u.test(compact)) return validationError();
  const digits = compact.replaceAll('-', '');
  if (!/^\d{17}$/u.test(digits)) return validationError();
  return `${digits.slice(0, 3)}-${digits.slice(3, 10)}-${digits.slice(10)}`;
}

function optionalIdentifier(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > 120
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    return validationError();
  }
  return normalized;
}

function optionalText(
  value: string | null,
  maximum: number,
): string | null {
  if (value === null) return null;
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    return validationError();
  }
  return normalized;
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

function withBuyerFormalOrderErrors(
  handler: (context: Context<any>) => Promise<Response>,
) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      return buyerFormalOrderFailure(
        context,
        normalizeBuyerFormalOrderError(error),
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
  throw new BuyerFormalOrderPortalError('VALIDATION_ERROR', 400);
}
