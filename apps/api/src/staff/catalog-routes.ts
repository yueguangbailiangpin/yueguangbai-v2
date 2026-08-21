import {
  apiFailure,
  apiSuccess,
  isApiErrorCode,
  isDemandReviewDecision,
  isMarketplaceCode,
  isProductApplicationReviewDecision,
  PRODUCT_COLOR_SPEC_MODES,
  STAFF_PRODUCT_PAGE_DEFAULT_LIMIT,
  STAFF_PRODUCT_PAGE_MAX_LIMIT,
  STAFF_RESERVATION_SCHEDULE_PAGE_DEFAULT_LIMIT,
  STAFF_RESERVATION_SCHEDULE_PAGE_MAX_LIMIT,
  type ApiErrorCode,
  type ProductColorSpecMode,
  type ProductVersionFields,
  type StaffRoleCode,
} from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { addProductVersion } from '../catalog/add-product-version';
import { createApprovedProduct } from '../catalog/create-product';
import { createSellerStore } from '../catalog/create-store';
import { linkProductVersionMainImage } from '../catalog/link-product-version-main-image';
import type { CatalogStaffActor } from '../catalog/catalog-shared';
import type { FileActor } from '@ygb/contracts';
import type {
  FileAuthorizationResource,
  FileAuthorizationService,
} from '../files/authorization';
import {
  readDemandReviewContext,
  reviewDemandBatch,
} from '../demand-batches/review-demand-batch';
import type { DemandStaffActor } from '../demand-batches/demand-shared';
import { requestIdFromContext } from '../http-auth/errors';
import { reviewProductApplication } from '../product-applications/review-product-application';
import type { ProductApplicationStaffActor } from '../product-applications/product-application-shared';
import {
  listStaffProducts,
  readStaffProduct,
  readStaffReservationSchedule,
} from '../product-reservation-scheduling/read-model';
import {
  confirmDemandSchedule,
  previewDemandSchedule,
} from '../product-reservation-scheduling/schedule-command';
import {
  parsePageLimit,
  type SchedulingStaffActor,
} from '../product-reservation-scheduling/shared';
import {
  resolveStaffDataScope,
  type AssignmentStaffAuthorization,
} from '../staff-assignment';

const BODY_LIMIT = 32 * 1024;

export function registerStaffCatalogWorkflowRoutes(app: Hono<any>): void {
  app.get(
    '/api/staff/catalog/products',
    withStaffWorkflowErrors(listProducts),
  );
  app.get(
    '/api/staff/catalog/products/:id',
    withStaffWorkflowErrors(readProduct),
  );
  app.get(
    '/api/staff/demand-batches/:id/review-context',
    withStaffWorkflowErrors(readDemandReview),
  );
  app.get(
    '/api/staff/demand-batches/:id/reservation-schedule',
    withStaffWorkflowErrors(readReservationSchedule),
  );
  app.post(
    '/api/staff/product-applications/:id/review',
    withStaffWorkflowErrors(reviewApplication),
  );
  app.post(
    '/api/staff/catalog/products',
    withStaffWorkflowErrors(createProduct),
  );
  app.post(
    '/api/staff/catalog/products/:id/versions',
    withStaffWorkflowErrors(createProductVersion),
  );
  app.post(
    '/api/staff/catalog/stores',
    withStaffWorkflowErrors(createStore),
  );
  app.post(
    '/api/staff/catalog/product-versions/:versionId/main-image',
    withStaffWorkflowErrors(linkMainImage),
  );
  app.post(
    '/api/staff/demand-batches/:id/review',
    withStaffWorkflowErrors(reviewDemand),
  );
  app.post(
    '/api/staff/demand-batches/:id/schedule/preview',
    withStaffWorkflowErrors(previewSchedule),
  );
  app.post(
    '/api/staff/demand-batches/:id/schedule/confirm',
    withStaffWorkflowErrors(confirmSchedule),
  );
}

async function readDemandReview(context: Context<any>): Promise<Response> {
  exactQuery(context, new Set());
  const authorization = requireAuthorization(context);
  const reviewContext = await readDemandReviewContext(
    context.env.DB,
    requiredString(context.req.param('id')),
    workflowActor(authorization),
  );
  return success(context, { review_context: reviewContext });
}

async function listProducts(context: Context<any>): Promise<Response> {
  const actor = await schedulingActor(context);
  const query = exactQuery(context, new Set(['limit', 'cursor', 'search']));
  const page = await listStaffProducts(context.env.DB, actor, {
    limit: parsePageLimit(
      query.get('limit') ?? undefined,
      STAFF_PRODUCT_PAGE_DEFAULT_LIMIT,
      STAFF_PRODUCT_PAGE_MAX_LIMIT,
    ),
    ...(query.get('cursor') === null
      ? {}
      : { cursor: query.get('cursor')! }),
    ...(query.get('search') === null
      ? {}
      : { search: query.get('search')! }),
  });
  return success(context, { page });
}

async function readProduct(context: Context<any>): Promise<Response> {
  exactQuery(context, new Set());
  const detail = await readStaffProduct(
    context.env.DB,
    await schedulingActor(context),
    requiredString(context.req.param('id')),
  );
  return success(context, { product: detail });
}

async function readReservationSchedule(
  context: Context<any>,
): Promise<Response> {
  const query = exactQuery(context, new Set(['limit', 'cursor']));
  const page = await readStaffReservationSchedule(
    context.env.DB,
    await schedulingActor(context),
    requiredString(context.req.param('id')),
    {
      limit: parsePageLimit(
        query.get('limit') ?? undefined,
        STAFF_RESERVATION_SCHEDULE_PAGE_DEFAULT_LIMIT,
        STAFF_RESERVATION_SCHEDULE_PAGE_MAX_LIMIT,
      ),
      ...(query.get('cursor') === null
        ? {}
        : { cursor: query.get('cursor')! }),
    },
  );
  return success(context, { page });
}

async function previewSchedule(context: Context<any>): Promise<Response> {
  exactQuery(context, new Set());
  const body = await bodyRecord(context);
  rejectUnknown(body, [
    'expected_version', 'first_order_date', 'order_interval_days',
    'orders_per_run', 'reason',
  ]);
  const preview = await previewDemandSchedule(
    context.env.DB,
    await schedulingActor(context),
    {
      demandBatchId: requiredString(context.req.param('id')),
      expectedVersion: integer(body['expected_version']),
      firstOrderDate: body['first_order_date'],
      orderIntervalDays: body['order_interval_days'],
      ordersPerRun: body['orders_per_run'],
      reason: body['reason'],
    },
  );
  return success(context, { preview });
}

async function confirmSchedule(context: Context<any>): Promise<Response> {
  exactQuery(context, new Set());
  const body = await bodyRecord(context);
  rejectUnknown(body, [
    'expected_version', 'first_order_date', 'order_interval_days',
    'orders_per_run', 'reason', 'preview_hash',
  ]);
  const result = await confirmDemandSchedule(
    context.env.DB,
    await schedulingActor(context),
    {
      demandBatchId: requiredString(context.req.param('id')),
      expectedVersion: integer(body['expected_version']),
      firstOrderDate: body['first_order_date'],
      orderIntervalDays: body['order_interval_days'],
      ordersPerRun: body['orders_per_run'],
      reason: body['reason'],
      previewHash: body['preview_hash'],
    },
    {
      idempotencyKey: idempotencyKey(context),
      requestId: requestIdFromContext(context),
    },
  );
  return success(context, { schedule_confirmation: result });
}

async function reviewApplication(context: Context<any>): Promise<Response> {
  const authorization = requireAuthorization(context);
  const body = await bodyRecord(context);
  rejectUnknown(body, [
    'expected_version', 'decision', 'rejection_reason',
    'ordering_guide_expected_amount_jpy', 'color_spec_mode',
    'default_buyer_self_pay_bps', 'order_interval_days', 'orders_per_run',
  ]);
  const decision = body['decision'];
  if (!isProductApplicationReviewDecision(decision)) {
    throw validationError();
  }
  const result = await reviewProductApplication(context.env.DB, {
    applicationId: requiredString(context.req.param('id')),
    expectedVersion: integer(body['expected_version']),
    decision,
    ...(body['rejection_reason'] === undefined
      ? {}
      : { rejectionReason: nullableString(body['rejection_reason']) }),
    ...(body['ordering_guide_expected_amount_jpy'] === undefined
      ? {}
      : {
          orderingGuideExpectedAmountJpy:
            integer(body['ordering_guide_expected_amount_jpy']),
        }),
    ...(body['color_spec_mode'] === undefined
      ? {}
      : { colorSpecMode: colorSpecMode(body['color_spec_mode']) }),
    ...(body['default_buyer_self_pay_bps'] === undefined
      ? {}
      : { defaultBuyerSelfPayBps: bps(body['default_buyer_self_pay_bps']) }),
    ...(body['order_interval_days'] === undefined
      ? {}
      : { orderIntervalDays: positiveInteger(body['order_interval_days'], 36_500) }),
    ...(body['orders_per_run'] === undefined
      ? {}
      : { ordersPerRun: positiveInteger(body['orders_per_run']) }),
  }, {
    actor: workflowActor(authorization),
    idempotencyKey: idempotencyKey(context),
    requestId: requestIdFromContext(context),
  });
  return success(context, { product_application_review: result });
}

async function createProduct(context: Context<any>): Promise<Response> {
  const authorization = requireAuthorization(context);
  const actor = await catalogActor(context, authorization);
  const body = await bodyRecord(context);
  rejectUnknown(body, ['store_id', 'asin', 'version']);
  const result = await createApprovedProduct(context.env.DB, {
    storeId: requiredString(body['store_id']),
    asin: requiredString(body['asin'], 40),
    version: productVersion(body['version']),
  }, {
    actor,
    idempotencyKey: idempotencyKey(context),
    requestId: requestIdFromContext(context),
  });
  return success(context, { product: result }, 201);
}

async function createProductVersion(context: Context<any>): Promise<Response> {
  const authorization = requireAuthorization(context);
  const actor = await catalogActor(context, authorization);
  const body = await bodyRecord(context);
  rejectUnknown(body, ['expected_version', 'version']);
  const result = await addProductVersion(context.env.DB, {
    productId: requiredString(context.req.param('id')),
    expectedVersion: integer(body['expected_version']),
    version: productVersion(body['version']),
  }, {
    actor,
    idempotencyKey: idempotencyKey(context),
    requestId: requestIdFromContext(context),
  });
  return success(context, { product_version: result }, 201);
}

async function createStore(context: Context<any>): Promise<Response> {
  const authorization = requireAuthorization(context);
  // SELLER_MANAGE is enforced inside createSellerStore via
  // requireCatalogPermission; dataScope is resolved here so the marketplace
  // scope check inside the command can reject out-of-scope store creation.
  const actor: CatalogStaffActor = {
    ...workflowActor(authorization),
    dataScope: await resolveStaffDataScope(context.env.DB, authorization, {
      requiredPermission: 'SELLER_MANAGE',
    }),
  };
  const body = await bodyRecord(context);
  rejectUnknown(body, ['seller_organization_id', 'marketplace_code', 'store_name']);
  const marketplace = requiredString(body['marketplace_code'], 20);
  if (!isMarketplaceCode(marketplace)) throw validationError();
  const result = await createSellerStore(context.env.DB, {
    sellerOrganizationId: requiredString(body['seller_organization_id']),
    marketplaceCode: marketplace,
    storeName: requiredString(body['store_name'], 200),
  }, {
    actor,
    idempotencyKey: idempotencyKey(context),
    requestId: requestIdFromContext(context),
  });
  return success(context, { store: result }, 201);
}

/**
 * Production file authorization for linking a PRODUCT_IMAGE as the main
 * image of a product version. Allows only STAFF actors linking SELLER_VISIBLE
 * PRODUCT_IMAGE uploads to a PRODUCT_VERSION entity. Organization/data-scope
 * enforcement is done by linkProductVersionMainImage via
 * requireCatalogOrganizationScope; the file ownership check here mirrors the
 * purpose/visibility/entity contract of the product main-image fact.
 * Staff share the product-image pool: an actor may link an image uploaded by
 * another staff member (files are SELLER_VISIBLE and the target organization
 * scope is enforced by the command), so no uploader-ownership check applies.
 */
class MainImageLinkAuthorization implements FileAuthorizationService {
  constructor(private readonly actor: FileActor) {}

  assertCanCreateUpload(): void {}
  assertCanUpload(): void {}
  assertCanCompleteUpload(): void {}
  assertCanRead(): void {}

  assertCanLink(
    actor: FileActor,
    resource: FileAuthorizationResource,
  ): void {
    if (actor.type !== 'STAFF'
      || actor.id !== this.actor.id
      || resource.purpose !== 'PRODUCT_IMAGE'
      || resource.visibility !== 'SELLER_VISIBLE'
      || resource.entityType !== 'PRODUCT_VERSION') {
      throw Object.assign(new Error('forbidden'), {
        code: 'FORBIDDEN', status: 403,
      });
    }
  }
}

async function linkMainImage(context: Context<any>): Promise<Response> {
  const authorization = requireAuthorization(context);
  const actor = await catalogActor(context, authorization);
  const body = await bodyRecord(context);
  rejectUnknown(body, ['file_object_id', 'expected_file_version']);
  const fileObjectId = requiredString(body['file_object_id'], 120);
  const expectedFileVersion = positiveInteger(body['expected_file_version']);
  const productVersionId = requiredString(
    context.req.param('versionId'),
    120,
  );
  const fileActor: FileActor = {
    type: 'STAFF',
    id: authorization.staffId,
    roles: [...authorization.roles],
  };
  const result = await linkProductVersionMainImage(
    context.env.DB,
    new MainImageLinkAuthorization(fileActor),
    {
      productVersionId,
      fileObjectId,
      expectedFileVersion,
    },
    {
      actor,
      idempotencyKey: idempotencyKey(context),
      requestId: requestIdFromContext(context),
    },
  );
  return success(context, { main_image: result }, 201);
}

async function reviewDemand(context: Context<any>): Promise<Response> {
  const authorization = requireAuthorization(context);
  const body = await bodyRecord(context);
  rejectUnknown(body, [
    'expected_version', 'decision', 'rejection_reason',
    'buyer_self_pay_bps', 'buyer_self_pay_override_reason', 'first_order_date',
  ]);
  const decision = body['decision'];
  if (!isDemandReviewDecision(decision)) throw validationError();
  const result = await reviewDemandBatch(context.env.DB, {
    demandBatchId: requiredString(context.req.param('id')),
    expectedVersion: integer(body['expected_version']),
    decision,
    ...(body['rejection_reason'] === undefined
      ? {}
      : { rejectionReason: nullableString(body['rejection_reason']) }),
    ...(body['buyer_self_pay_bps'] === undefined
      ? {}
      : { buyerSelfPayBps: nullableBps(body['buyer_self_pay_bps']) }),
    ...(body['buyer_self_pay_override_reason'] === undefined
      ? {}
      : {
          buyerSelfPayOverrideReason:
            nullableString(body['buyer_self_pay_override_reason']),
        }),
    ...(body['first_order_date'] === undefined
      ? {}
      : { firstOrderDate: nullableString(body['first_order_date']) }),
  }, {
    actor: workflowActor(authorization),
    idempotencyKey: idempotencyKey(context),
    requestId: requestIdFromContext(context),
  });
  return success(context, { demand_review: result });
}

function requireAuthorization(context: Context<any>): AssignmentStaffAuthorization {
  const authorization = context.get('staffAuthorization') as
    | AssignmentStaffAuthorization
    | null
    | undefined;
  if (!authorization) {
    throw Object.assign(new Error('unauthenticated'), {
      code: 'UNAUTHENTICATED', status: 401,
    });
  }
  return authorization;
}

function workflowActor(
  authorization: AssignmentStaffAuthorization,
): ProductApplicationStaffActor & DemandStaffActor {
  return {
    staffId: authorization.staffId,
    displayName: authorization.displayName,
    roles: Object.freeze([...authorization.roles]) as readonly StaffRoleCode[],
    permissions: authorization.permissions,
  };
}

async function catalogActor(
  context: Context<any>,
  authorization: AssignmentStaffAuthorization,
): Promise<CatalogStaffActor> {
  if (!authorization.permissions.has('PRODUCT_REVIEW')) {
    throw Object.assign(new Error('forbidden'), {
      code: 'FORBIDDEN', status: 403,
    });
  }
  return {
    ...workflowActor(authorization),
    dataScope: await resolveStaffDataScope(context.env.DB, authorization, {
      requiredPermission: 'PRODUCT_REVIEW',
    }),
  };
}

async function schedulingActor(
  context: Context<any>,
): Promise<SchedulingStaffActor> {
  const authorization = requireAuthorization(context);
  return {
    ...workflowActor(authorization),
    dataScope: await resolveStaffDataScope(context.env.DB, authorization),
  };
}

function productVersion(value: unknown): ProductVersionFields {
  const input = record(value);
  rejectUnknown(input, [
    'product_name', 'search_keywords', 'product_url', 'buyer_visible_notes',
    'internal_notes', 'ordering_guide_expected_amount_jpy', 'color_spec_mode',
    'default_buyer_self_pay_bps', 'order_interval_days', 'orders_per_run',
  ]);
  const keywords = input['search_keywords'];
  if (!Array.isArray(keywords)
    || keywords.some((keyword) => typeof keyword !== 'string')) {
    throw validationError();
  }
  return {
    productName: requiredString(input['product_name'], 200),
    searchKeywords: keywords,
    productUrl: nullableString(input['product_url']),
    buyerVisibleNotes: nullableString(input['buyer_visible_notes']),
    internalNotes: nullableString(input['internal_notes']),
    orderingGuideExpectedAmountJpy:
      integer(input['ordering_guide_expected_amount_jpy']),
    colorSpecMode: colorSpecMode(input['color_spec_mode']),
    orderIntervalDays: positiveInteger(input['order_interval_days'], 36_500),
    ordersPerRun: positiveInteger(input['orders_per_run']),
    ...(input['default_buyer_self_pay_bps'] === undefined
      ? {}
      : { defaultBuyerSelfPayBps: bps(input['default_buyer_self_pay_bps']) }),
  };
}

function colorSpecMode(value: unknown): ProductColorSpecMode {
  if (typeof value !== 'string'
    || !(PRODUCT_COLOR_SPEC_MODES as readonly string[]).includes(value)) {
    throw validationError();
  }
  return value as ProductColorSpecMode;
}

async function bodyRecord(context: Context<any>): Promise<Record<string, unknown>> {
  return record(await readBoundedJson(context.req.raw, BODY_LIMIT));
}

function exactQuery(
  context: Context<any>,
  allowed: ReadonlySet<string>,
): URLSearchParams {
  const parameters = new URL(context.req.url).searchParams;
  for (const key of new Set(parameters.keys())) {
    if (!allowed.has(key) || parameters.getAll(key).length !== 1) {
      throw validationError();
    }
  }
  return parameters;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError();
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw validationError();
  }
}

function requiredString(value: unknown, maximum = 120): string {
  if (typeof value !== 'string') throw validationError();
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1 || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw validationError();
  }
  return normalized;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value, 4000);
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw validationError();
  }
  return value;
}

function bps(value: unknown): number {
  const parsed = integer(value);
  if (parsed < 0 || parsed > 10_000) throw validationError();
  return parsed;
}

function positiveInteger(value: unknown, maximum = 100_000): number {
  const parsed = integer(value);
  if (parsed < 1 || parsed > maximum) throw validationError();
  return parsed;
}

function nullableBps(value: unknown): number | null {
  return value === null ? null : bps(value);
}

function idempotencyKey(context: Context<any>): string {
  try {
    const key = parseIdempotencyKey(context.req.header('Idempotency-Key'));
    if (key === null) throw new Error('missing');
    return key;
  } catch {
    throw validationError();
  }
}

function validationError(): Error & { code: ApiErrorCode; status: 400 } {
  return Object.assign(new Error('validation'), {
    code: 'VALIDATION_ERROR' as const,
    status: 400 as const,
  });
}

function withStaffWorkflowErrors(
  handler: (context: Context<any>) => Promise<Response>,
) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      const candidate = error as {
        code?: unknown;
        status?: unknown;
        details?: unknown;
      };
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
        safeFailureDetails(candidate?.details),
      ), status);
    }
  };
}

/**
 * Only short, field-scoped string details may leave the Worker. The frontend
 * additionally filters by error code, so this is defense in depth rather than
 * the only boundary.
 */
function safeFailureDetails(value: unknown): Record<string, string> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(source)) {
    if (!/^[a-z_]{1,40}$/u.test(key)) continue;
    if (typeof item !== 'string' || item.length > 200) continue;
    result[key] = item;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function publicMessage(code: ApiErrorCode): string {
  if (code === 'UNAUTHENTICATED') return '员工会话无效';
  if (code === 'FORBIDDEN') return '无权执行该操作';
  if (code === 'NOT_FOUND'
    || code.endsWith('_NOT_FOUND')) return '资源不存在';
  if (code === 'VALIDATION_ERROR') return '请求参数不正确';
  if (code === 'VERSION_CONFLICT') return '数据已发生变化，请刷新后重试';
  if (code === 'MARKETPLACE_NOT_SUPPORTED') return '该站点暂不支持开店';
  return '当前状态无法执行该操作';
}

function success(
  context: Context<any>,
  data: unknown,
  status: 200 | 201 = 200,
): Response {
  return context.json(apiSuccess(data, requestIdFromContext(context)), status);
}
