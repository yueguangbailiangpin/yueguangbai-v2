import {
  apiSuccess,
  DEMAND_BATCH_STATUSES,
  isDemandTaskType,
  isMarketplaceCode,
  PRODUCT_APPLICATION_STATUSES,
  PRODUCT_STATUSES,
  type DemandBatchStatus,
  type DemandTaskType,
  type ProductApplicationStatus,
  type ProductStatus,
  type SubmitSellerPortalDemandBatchBody,
  type SubmitSellerPortalProductApplicationBody,
} from '@ygb/contracts';
import type { Context, Hono } from 'hono';
import { createSellerStore } from '../catalog/create-store';
import { submitDemandBatch } from '../demand-batches/submit-demand-batch';
import { withdrawDemandBatch } from '../demand-batches/withdraw-demand-batch';
import { requestIdFromContext } from '../http-auth/errors';
import { customerSessionMiddleware } from '../middleware/customer-auth';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import { submitProductApplication } from '../product-applications/submit-product-application';
import { withdrawProductApplication } from '../product-applications/withdraw-product-application';
import { productApplicationFileAuthorization } from '../product-applications/file-authorization';
import {
  requireSellerPortalWriteRole,
  resolveSellerPortalActor,
} from './actor';
import {
  SellerPortalError,
  withSellerPortalErrors,
} from './errors';
import { parseSellerPortalPagination } from './pagination';
import {
  getSellerPortalDemandBatch,
  getSellerPortalProduct,
  getSellerPortalProductApplication,
  listSellerPortalDemandBatches,
  listSellerPortalProductApplications,
  listSellerPortalProducts,
  listSellerPortalProductVersions,
  listSellerPortalStores,
  requireScopedDemandBatch,
  requireScopedProduct,
  requireScopedProductApplication,
  requireScopedStore,
} from './queries';

export function registerSellerPortalRoutes(app: Hono<any>): void {
  const session = customerSessionMiddleware();
  const origin = customerAuthOriginGuard();

  app.get(
    '/api/seller-portal/me',
    session,
    withSellerPortalErrors(me),
  );
  app.get(
    '/api/seller-portal/stores',
    session,
    withSellerPortalErrors(stores),
  );
  app.post(
    '/api/seller-portal/stores',
    origin,
    session,
    withSellerPortalErrors(createStore),
  );
  app.get(
    '/api/seller-portal/products',
    session,
    withSellerPortalErrors(products),
  );
  app.get(
    '/api/seller-portal/products/:id/versions',
    session,
    withSellerPortalErrors(productVersions),
  );
  app.get(
    '/api/seller-portal/products/:id',
    session,
    withSellerPortalErrors(product),
  );
  app.get(
    '/api/seller-portal/product-applications',
    session,
    withSellerPortalErrors(productApplications),
  );
  app.get(
    '/api/seller-portal/product-applications/:id',
    session,
    withSellerPortalErrors(productApplication),
  );
  app.post(
    '/api/seller-portal/product-applications',
    origin,
    session,
    withSellerPortalErrors(createProductApplication),
  );
  app.post(
    '/api/seller-portal/product-applications/:id/withdraw',
    origin,
    session,
    withSellerPortalErrors(withdrawApplication),
  );
  app.get(
    '/api/seller-portal/demand-batches',
    session,
    withSellerPortalErrors(demandBatches),
  );
  app.get(
    '/api/seller-portal/demand-batches/:id',
    session,
    withSellerPortalErrors(demandBatch),
  );
  app.post(
    '/api/seller-portal/demand-batches',
    origin,
    session,
    withSellerPortalErrors(createDemandBatch),
  );
  app.post(
    '/api/seller-portal/demand-batches/:id/withdraw',
    origin,
    session,
    withSellerPortalErrors(withdrawDemand),
  );
}

async function me(context: Context<any>): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  return success(context, { me: actor.me });
}

async function stores(context: Context<any>): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  const pagination = parseSellerPortalPagination(
    new URL(context.req.url),
  );
  return success(context, await listSellerPortalStores(
    context.env.DB,
    actor,
    pagination,
  ));
}

async function createStore(context: Context<any>): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  const body = await readObject(context);
  const marketplace = requiredString(body, 'marketplace_code');
  if (!isMarketplaceCode(marketplace)) validation();
  const result = await createSellerStore(
    context.env.DB,
    {
      sellerOrganizationId: actor.sellerOrganizationId,
      marketplaceCode: marketplace,
      storeName: requiredString(body, 'store_name'),
    },
    {
      actor: {
        memberId: actor.memberId,
        sellerOrganizationId: actor.sellerOrganizationId,
        role: actor.role,
      },
      idempotencyKey: idempotencyKey(context),
      requestId: requestIdFromContext(context),
    },
  );
  return success(
    context,
    { store: result },
    result.replayed ? 200 : 201,
  );
}

async function products(context: Context<any>): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  const url = new URL(context.req.url);
  const pagination = parseSellerPortalPagination(url);
  const storeId = optionalIdentifier(url.searchParams.get('store_id'));
  const status = optionalEnum<ProductStatus>(
    url.searchParams.get('status'),
    PRODUCT_STATUSES,
  );
  const asin = optionalAsin(url.searchParams.get('asin'));
  return success(context, await listSellerPortalProducts(
    context.env.DB,
    actor,
    pagination,
    { storeId, status, asin },
  ));
}

async function product(context: Context<any>): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  const id = identifier(context.req.param('id'));
  return success(context, {
    product: await getSellerPortalProduct(
      context.env.DB,
      actor,
      id,
    ),
  });
}

async function productVersions(
  context: Context<any>,
): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  const id = identifier(context.req.param('id'));
  const pagination = parseSellerPortalPagination(
    new URL(context.req.url),
  );
  return success(context, await listSellerPortalProductVersions(
    context.env.DB,
    actor,
    id,
    pagination,
  ));
}

async function productApplications(
  context: Context<any>,
): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  const url = new URL(context.req.url);
  const pagination = parseSellerPortalPagination(url);
  const storeId = optionalIdentifier(url.searchParams.get('store_id'));
  const status = optionalEnum<ProductApplicationStatus>(
    url.searchParams.get('status'),
    PRODUCT_APPLICATION_STATUSES,
  );
  return success(
    context,
    await listSellerPortalProductApplications(
      context.env.DB,
      actor,
      pagination,
      { storeId, status },
    ),
  );
}

async function productApplication(
  context: Context<any>,
): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  const id = identifier(context.req.param('id'));
  return success(context, {
    application: await getSellerPortalProductApplication(
      context.env.DB,
      actor,
      id,
    ),
  });
}

async function createProductApplication(
  context: Context<any>,
): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  requireSellerPortalWriteRole(actor);
  const body = await readProductApplicationBody(context);
  await requireScopedStore(
    context.env.DB,
    actor,
    body.store_id,
    true,
  );
  const result = await submitProductApplication(
    context.env.DB,
    productApplicationFileAuthorization,
    {
      storeId: body.store_id,
      asin: body.asin,
      product: {
        productName: body.product_name,
        searchKeywords: body.search_keywords,
        productUrl: body.product_url,
        buyerVisibleNotes: body.buyer_visible_notes,
        internalNotes: null,
      },
      sellerNotes: body.seller_notes,
      imageFiles: body.image_files.map((file) => ({
        fileObjectId: file.file_object_id,
        expectedFileVersion: file.expected_file_version,
      })),
    },
    {
      actor,
      idempotencyKey: idempotencyKey(context),
      requestId: requestIdFromContext(context),
    },
  );
  const application = await getSellerPortalProductApplication(
    context.env.DB,
    actor,
    result.application_id,
  );
  return success(
    context,
    { application, replayed: result.replayed },
    result.replayed ? 200 : 201,
  );
}

async function withdrawApplication(
  context: Context<any>,
): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  requireSellerPortalWriteRole(actor);
  const id = identifier(context.req.param('id'));
  const body = await readExpectedVersionBody(context);
  await requireScopedProductApplication(
    context.env.DB,
    actor,
    id,
  );
  const result = await withdrawProductApplication(
    context.env.DB,
    {
      applicationId: id,
      expectedVersion: body.expected_version,
    },
    {
      actor,
      idempotencyKey: idempotencyKey(context),
      requestId: requestIdFromContext(context),
    },
  );
  return success(context, {
    application: await getSellerPortalProductApplication(
      context.env.DB,
      actor,
      id,
    ),
    replayed: result.replayed,
  });
}

async function demandBatches(
  context: Context<any>,
): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  const url = new URL(context.req.url);
  const pagination = parseSellerPortalPagination(url);
  const storeId = optionalIdentifier(url.searchParams.get('store_id'));
  const status = optionalEnum<DemandBatchStatus>(
    url.searchParams.get('status'),
    DEMAND_BATCH_STATUSES,
  );
  return success(context, await listSellerPortalDemandBatches(
    context.env.DB,
    actor,
    pagination,
    { storeId, status },
  ));
}

async function demandBatch(context: Context<any>): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  const id = identifier(context.req.param('id'));
  return success(context, {
    demand_batch: await getSellerPortalDemandBatch(
      context.env.DB,
      actor,
      id,
    ),
  });
}

async function createDemandBatch(
  context: Context<any>,
): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  requireSellerPortalWriteRole(actor);
  const body = await readDemandBatchBody(context);
  await requireScopedProduct(
    context.env.DB,
    actor,
    body.product_id,
    true,
  );
  const result = await submitDemandBatch(
    context.env.DB,
    {
      productId: body.product_id,
      taskType: body.task_type,
      targetQuantity: body.target_quantity,
      buyerVisibleNotes: body.buyer_visible_notes,
      sellerNotes: body.seller_notes,
      openAt: body.open_at,
      reservationDeadline: body.reservation_deadline,
      orderDeadline: body.order_deadline,
    },
    {
      actor,
      idempotencyKey: idempotencyKey(context),
      requestId: requestIdFromContext(context),
    },
  );
  const demand = await getSellerPortalDemandBatch(
    context.env.DB,
    actor,
    result.demand_batch_id,
  );
  return success(
    context,
    { demand_batch: demand, replayed: result.replayed },
    result.replayed ? 200 : 201,
  );
}

async function withdrawDemand(
  context: Context<any>,
): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  requireSellerPortalWriteRole(actor);
  const id = identifier(context.req.param('id'));
  const body = await readExpectedVersionBody(context);
  await requireScopedDemandBatch(context.env.DB, actor, id);
  const result = await withdrawDemandBatch(
    context.env.DB,
    {
      demandBatchId: id,
      expectedVersion: body.expected_version,
    },
    {
      actor,
      idempotencyKey: idempotencyKey(context),
      requestId: requestIdFromContext(context),
    },
  );
  return success(context, {
    demand_batch: await getSellerPortalDemandBatch(
      context.env.DB,
      actor,
      id,
    ),
    replayed: result.replayed,
  });
}

function success(
  context: Context<any>,
  data: unknown,
  status: 200 | 201 = 200,
): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(
    apiSuccess(data, requestIdFromContext(context)),
    status,
  );
}

async function readProductApplicationBody(
  context: Context<any>,
): Promise<SubmitSellerPortalProductApplicationBody> {
  const body = await readObject(context);
  return {
    store_id: requiredString(body, 'store_id'),
    asin: requiredString(body, 'asin'),
    product_name: requiredString(body, 'product_name'),
    search_keywords: requiredStringArray(body, 'search_keywords'),
    product_url: nullableString(body, 'product_url'),
    buyer_visible_notes: nullableString(body, 'buyer_visible_notes'),
    seller_notes: nullableString(body, 'seller_notes'),
    image_files: requiredFileReferences(body, 'image_files'),
  };
}

function requiredFileReferences(
  body: Record<string, unknown>,
  key: string,
): readonly { file_object_id: string; expected_file_version: number }[] {
  const value = body[key];
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) validation();
  return Object.freeze(value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) validation();
    const file = item as Record<string, unknown>;
    return {
      file_object_id: requiredString(file, 'file_object_id'),
      expected_file_version: requiredInteger(file, 'expected_file_version'),
    };
  }));
}

async function readDemandBatchBody(
  context: Context<any>,
): Promise<SubmitSellerPortalDemandBatchBody> {
  const body = await readObject(context);
  const taskType = body['task_type'];
  if (!isDemandTaskType(taskType)) validation();
  return {
    product_id: requiredString(body, 'product_id'),
    task_type: taskType as DemandTaskType,
    target_quantity: requiredInteger(body, 'target_quantity'),
    buyer_visible_notes: nullableString(body, 'buyer_visible_notes'),
    seller_notes: nullableString(body, 'seller_notes'),
    open_at: requiredInteger(body, 'open_at'),
    reservation_deadline:
      requiredInteger(body, 'reservation_deadline'),
    order_deadline: requiredInteger(body, 'order_deadline'),
  };
}

async function readExpectedVersionBody(
  context: Context<any>,
): Promise<{ expected_version: number }> {
  const body = await readObject(context);
  return {
    expected_version: requiredInteger(body, 'expected_version'),
  };
}

async function readObject(
  context: Context<any>,
): Promise<Record<string, unknown>> {
  try {
    const value = await context.req.json() as unknown;
    if (typeof value !== 'object'
      || value === null
      || Array.isArray(value)) {
      validation();
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SellerPortalError) throw error;
    validation();
  }
}

function requiredString(
  body: Record<string, unknown>,
  key: string,
): string {
  const value = body[key];
  if (typeof value !== 'string') validation();
  return value as string;
}

function nullableString(
  body: Record<string, unknown>,
  key: string,
): string | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') validation();
  return value as string;
}

function requiredStringArray(
  body: Record<string, unknown>,
  key: string,
): readonly string[] {
  const value = body[key];
  if (!Array.isArray(value)
    || value.some((item) => typeof item !== 'string')) {
    validation();
  }
  return Object.freeze([...(value as string[])]);
}

function requiredInteger(
  body: Record<string, unknown>,
  key: string,
): number {
  const value = body[key];
  if (!Number.isSafeInteger(value)) validation();
  return Number(value);
}

function idempotencyKey(context: Context<any>): string {
  const value = context.req.header('Idempotency-Key');
  if (!value
    || value.length < 8
    || value.length > 128
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    validation();
  }
  return value;
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

function optionalAsin(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.normalize('NFKC').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/u.test(normalized)) validation();
  return normalized;
}

function optionalEnum<T extends string>(
  value: string | null,
  allowed: readonly T[],
): T | null {
  if (value === null) return null;
  if (!(allowed as readonly string[]).includes(value)) validation();
  return value as T;
}

function validation(): never {
  throw new SellerPortalError('VALIDATION_ERROR', 400);
}
