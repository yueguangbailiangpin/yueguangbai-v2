import {
  apiSuccess,
  isPricingReviewType,
  type SellerFormalOrderPortalFilters,
} from '@ygb/contracts';
import type { Context, Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import { customerSessionMiddleware } from '../middleware/customer-auth';
import { resolveSellerPortalActor } from '../seller-portal/actor';
import { parseSellerPortalPagination } from '../seller-portal/pagination';
import {
  SellerFormalOrderPortalError,
  withSellerFormalOrderPortalErrors,
} from './errors';
import {
  getSellerFormalOrder,
  listSellerFormalOrders,
} from './read-model';

export function registerSellerFormalOrderRoutes(app: Hono<any>): void {
  const session = customerSessionMiddleware();

  app.get(
    '/api/seller-portal/formal-orders',
    session,
    withSellerFormalOrderPortalErrors(formalOrders),
  );
  app.get(
    '/api/seller-portal/formal-orders/:id',
    session,
    withSellerFormalOrderPortalErrors(formalOrder),
  );
}

async function formalOrders(context: Context<any>): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  const url = new URL(context.req.url);
  const pagination = parseSellerPortalPagination(url);
  const filters: SellerFormalOrderPortalFilters = {
    store_id: optionalIdentifier(url.searchParams.get('store_id')),
    marketplace_code:
      optionalMarketplace(url.searchParams.get('marketplace_code')),
    asin: optionalAsin(url.searchParams.get('asin')),
    product_name:
      optionalText(url.searchParams.get('product_name'), 200),
    review_type:
      optionalReviewType(url.searchParams.get('review_type')),
    confirmed_business_date: optionalBusinessDate(
      url.searchParams.get('confirmed_business_date'),
    ),
    formal_order_id:
      optionalIdentifier(url.searchParams.get('formal_order_id')),
    amazon_order_number: optionalAmazonOrderNumber(
      url.searchParams.get('amazon_order_number'),
    ),
  };
  return success(context, await listSellerFormalOrders(
    context.env.DB,
    actor,
    pagination,
    filters,
  ));
}

async function formalOrder(context: Context<any>): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  const id = identifier(context.req.param('id'));
  return success(context, {
    formal_order: await getSellerFormalOrder(
      context.env.DB,
      actor,
      id,
    ),
  });
}

function success(context: Context<any>, data: unknown): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(
    apiSuccess(data, requestIdFromContext(context)),
    200,
  );
}

function identifier(value: unknown): string {
  if (typeof value !== 'string') validation();
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > 120
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    validation();
  }
  return normalized;
}

function optionalIdentifier(value: string | null): string | null {
  return value === null ? null : identifier(value);
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
    validation();
  }
  return normalized;
}

function optionalMarketplace(value: string | null): 'JP' | null {
  if (value === null) return null;
  if (value !== 'JP') validation();
  return 'JP';
}

function optionalAsin(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.normalize('NFKC').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/u.test(normalized)) validation();
  return normalized;
}

function optionalReviewType(
  value: string | null,
): SellerFormalOrderPortalFilters['review_type'] {
  if (value === null) return null;
  if (!isPricingReviewType(value)) validation();
  return value;
}

function optionalBusinessDate(value: string | null): string | null {
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) validation();
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp)
    || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    validation();
  }
  return value;
}

function optionalAmazonOrderNumber(
  value: string | null,
): string | null {
  if (value === null) return null;
  const normalized = value.normalize('NFKC').trim();
  if (!/^\d{3}-\d{7}-\d{7}$/u.test(normalized)) validation();
  return normalized;
}

function validation(): never {
  throw new SellerFormalOrderPortalError('VALIDATION_ERROR', 400);
}
