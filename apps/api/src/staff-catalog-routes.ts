import {
  apiFailure,
  apiSuccess,
  isApiErrorCode,
  isDemandReviewDecision,
  isProductApplicationReviewDecision,
  PRODUCT_COLOR_SPEC_MODES,
  type ApiErrorCode,
  type ProductColorSpecMode,
  type ProductVersionFields,
  type StaffRoleCode,
} from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { addProductVersion } from './catalog/add-product-version';
import { createApprovedProduct } from './catalog/create-product';
import type { CatalogStaffActor } from './catalog/catalog-shared';
import { reviewDemandBatch } from './demand-batches/review-demand-batch';
import type { DemandStaffActor } from './demand-batches/demand-shared';
import { requestIdFromContext } from './http-auth/errors';
import { reviewProductApplication } from './product-applications/review-product-application';
import type { ProductApplicationStaffActor } from './product-applications/product-application-shared';
import {
  resolveStaffDataScope,
  type AssignmentStaffAuthorization,
} from './staff-assignment';

const BODY_LIMIT = 32 * 1024;

export function registerStaffCatalogWorkflowRoutes(app: Hono<any>): void {
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
    '/api/staff/demand-batches/:id/review',
    withStaffWorkflowErrors(reviewDemand),
  );
}

async function reviewApplication(context: Context<any>): Promise<Response> {
  const authorization = requireAuthorization(context);
  const body = await bodyRecord(context);
  rejectUnknown(body, [
    'expected_version', 'decision', 'rejection_reason',
    'ordering_guide_expected_amount_jpy', 'color_spec_mode',
    'default_buyer_self_pay_bps',
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

async function reviewDemand(context: Context<any>): Promise<Response> {
  const authorization = requireAuthorization(context);
  const body = await bodyRecord(context);
  rejectUnknown(body, [
    'expected_version', 'decision', 'rejection_reason',
    'buyer_self_pay_bps', 'buyer_self_pay_override_reason',
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

function productVersion(value: unknown): ProductVersionFields {
  const input = record(value);
  rejectUnknown(input, [
    'product_name', 'search_keywords', 'product_url', 'buyer_visible_notes',
    'internal_notes', 'ordering_guide_expected_amount_jpy', 'color_spec_mode',
    'default_buyer_self_pay_bps',
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
  if (code === 'NOT_FOUND'
    || code.endsWith('_NOT_FOUND')) return '资源不存在';
  if (code === 'VALIDATION_ERROR') return '请求参数不正确';
  if (code === 'VERSION_CONFLICT') return '数据已发生变化，请刷新后重试';
  return '当前状态无法执行该操作';
}

function success(
  context: Context<any>,
  data: unknown,
  status: 200 | 201 = 200,
): Response {
  return context.json(apiSuccess(data, requestIdFromContext(context)), status);
}
