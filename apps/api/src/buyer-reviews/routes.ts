import {
  apiSuccess,
  isPricingReviewType,
  type BuyerReviewFileReadIntentDto,
  type BuyerReviewMutationDto,
  type CreateBuyerReviewFileReadIntentRequest,
  type PricingReviewType,
  type ResubmitBuyerReviewRequest,
  type SubmitBuyerReviewRequest,
  type WithdrawBuyerReviewRequest,
} from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { requireBuyerPortalContext } from '../buyer-portal/buyer-context';
import { DenyAllFileAuthorizationService } from '../files/authorization';
import { createFileReadIntent } from '../files/file-read-service';
import { requestIdFromContext } from '../http-auth/errors';
import {
  customerSessionMiddleware,
  requireCustomerSessionFromContext,
} from '../middleware/customer-auth';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import { submitReviewEvidence } from '../reviews/submit-review-evidence';
import { withdrawReview } from '../reviews/withdraw-review';
import {
  buyerReviewPortalFailure,
  BuyerReviewPortalError,
  normalizeBuyerReviewPortalError,
} from './errors';
import { buyerReviewFileAuthorization } from './file-authorization';
import {
  decodeBuyerReviewCursor,
  decodeEligibleReviewOrderCursor,
  parseBuyerReviewPageLimit,
} from './pagination';
import {
  assertBuyerReviewBusinessAccess,
  getBuyerReview,
  listBuyerReviewEligibleOrders,
  listBuyerReviews,
  requireBuyerReviewFileLink,
  requireBuyerReviewFormalOrderId,
} from './read-model';
import {
  attachBuyerReviewDetailUrl,
  attachBuyerReviewPageUrls,
} from './review-url-projection';

const SUBMIT_BODY_LIMIT_BYTES = 24 * 1024;
const SMALL_BODY_LIMIT_BYTES = 2048;
const MAX_IDENTIFIER_LENGTH = 120;
const MAX_FILES = 3;
const ALLOWED_LIST_QUERY_KEYS = new Set(['limit', 'cursor']);
const denyLegacyFileRead = new DenyAllFileAuthorizationService();

export function registerBuyerReviewRoutes(app: Hono<any>): void {
  const session = customerSessionMiddleware();
  app.get('/api/buyer-portal/reviews/eligible-orders', session, withBuyerReviewErrors(listEligibleOrders));
  app.post('/api/buyer-portal/reviews', customerAuthOriginGuard(), session, withBuyerReviewErrors(createReview));
  app.get('/api/buyer-portal/reviews', session, withBuyerReviewErrors(listOwnReviews));
  app.get('/api/buyer-portal/reviews/:id', session, withBuyerReviewErrors(getOwnReview));
  app.post('/api/buyer-portal/reviews/:id/resubmit', customerAuthOriginGuard(), session, withBuyerReviewErrors(resubmitReview));
  app.post('/api/buyer-portal/reviews/:id/withdraw', customerAuthOriginGuard(), session, withBuyerReviewErrors(withdrawOwnReview));
  app.post(
    '/api/buyer-portal/reviews/:id/files/:fileLinkId/read-intent',
    customerAuthOriginGuard(),
    session,
    withBuyerReviewErrors(createReviewFileReadIntent),
  );
}

async function listEligibleOrders(context: Context<any>): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  const url = new URL(context.req.url);
  rejectUnknownOrRepeatedQuery(url);
  return success(context, await listBuyerReviewEligibleOrders(context.env.DB, buyer, {
    limit: parseBuyerReviewPageLimit(singleQuery(url, 'limit') ?? undefined),
    cursor: decodeEligibleReviewOrderCursor(singleQuery(url, 'cursor') ?? undefined),
  }));
}

async function createReview(context: Context<any>): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  assertBuyerReviewBusinessAccess(buyer);
  const body = parseSubmitBody(await readBoundedJson(context.req.raw, SUBMIT_BODY_LIMIT_BYTES));
  const result = await submitReviewEvidence(context.env.DB, buyerReviewFileAuthorization, {
    formalOrderId: body.formal_order_id,
    expectedVersion: body.expected_version,
    reviewType: body.review_type,
    reviewUrl: body.review_url,
    evidenceFiles: body.evidence_files.map((file) => ({
      fileObjectId: file.file_object_id,
      expectedFileVersion: file.expected_file_version,
    })),
    buyerNote: body.buyer_note ?? null,
  }, {
    actor: { buyerCustomerId: buyer.buyerCustomerId },
    idempotencyKey: requireIdempotencyKey(context),
    requestId: requestIdFromContext(context),
  });
  const detail = await getBuyerReview(context.env.DB, buyer, result.review_case_id);
  const response: BuyerReviewMutationDto = {
    review: await attachBuyerReviewDetailUrl(context.env.DB, buyer, detail),
    replayed: result.replayed,
  };
  return success(context, response, result.replayed ? 200 : 201);
}

async function listOwnReviews(context: Context<any>): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  const url = new URL(context.req.url);
  rejectUnknownOrRepeatedQuery(url);
  const page = await listBuyerReviews(context.env.DB, buyer, {
    limit: parseBuyerReviewPageLimit(singleQuery(url, 'limit') ?? undefined),
    cursor: decodeBuyerReviewCursor(singleQuery(url, 'cursor') ?? undefined),
  });
  return success(context, await attachBuyerReviewPageUrls(context.env.DB, buyer, page));
}

async function getOwnReview(context: Context<any>): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  const value = await getBuyerReview(context.env.DB, buyer, requireRouteId(context));
  return success(context, {
    review: await attachBuyerReviewDetailUrl(context.env.DB, buyer, value),
  });
}

async function resubmitReview(context: Context<any>): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  assertBuyerReviewBusinessAccess(buyer);
  const reviewCaseId = requireRouteId(context);
  const body = parseResubmitBody(await readBoundedJson(context.req.raw, SUBMIT_BODY_LIMIT_BYTES));
  const formalOrderId = await requireBuyerReviewFormalOrderId(
    context.env.DB,
    buyer,
    reviewCaseId,
  );
  const result = await submitReviewEvidence(context.env.DB, buyerReviewFileAuthorization, {
    formalOrderId,
    expectedVersion: body.expected_version,
    reviewType: body.review_type,
    reviewUrl: body.review_url,
    evidenceFiles: body.evidence_files.map((file) => ({
      fileObjectId: file.file_object_id,
      expectedFileVersion: file.expected_file_version,
    })),
    buyerNote: body.buyer_note ?? null,
  }, {
    actor: { buyerCustomerId: buyer.buyerCustomerId },
    idempotencyKey: requireIdempotencyKey(context),
    requestId: requestIdFromContext(context),
  });
  const detail = await getBuyerReview(context.env.DB, buyer, result.review_case_id);
  const response: BuyerReviewMutationDto = {
    review: await attachBuyerReviewDetailUrl(context.env.DB, buyer, detail),
    replayed: result.replayed,
  };
  return success(context, response);
}

async function withdrawOwnReview(context: Context<any>): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  assertBuyerReviewBusinessAccess(buyer);
  const reviewCaseId = requireRouteId(context);
  const body = parseWithdrawBody(await readBoundedJson(context.req.raw, SMALL_BODY_LIMIT_BYTES));
  const result = await withdrawReview(context.env.DB, {
    reviewCaseId,
    expectedVersion: body.expected_version,
  }, {
    actor: { buyerCustomerId: buyer.buyerCustomerId },
    idempotencyKey: requireIdempotencyKey(context),
    requestId: requestIdFromContext(context),
  });
  const detail = await getBuyerReview(context.env.DB, buyer, result.review_case_id);
  const response: BuyerReviewMutationDto = {
    review: await attachBuyerReviewDetailUrl(context.env.DB, buyer, detail),
    replayed: result.replayed,
  };
  return success(context, response);
}

async function createReviewFileReadIntent(context: Context<any>): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  assertBuyerReviewBusinessAccess(buyer);
  const session = requireCustomerSessionFromContext(context);
  const source = await requireBuyerReviewFileLink(
    context.env.DB,
    buyer,
    requireRouteId(context),
    requireFileLinkRouteId(context),
  );
  const body = parseReadIntentBody(await readBoundedJson(context.req.raw, SMALL_BODY_LIMIT_BYTES));
  if (source.fileVersion !== body.expected_file_version) {
    throw new BuyerReviewPortalError('VERSION_CONFLICT', 409);
  }
  const result = await createFileReadIntent(context.env.DB, denyLegacyFileRead, {
    fileObjectId: source.fileObjectId,
    fileEntityLinkId: source.fileEntityLinkId,
    expectedFileVersion: body.expected_file_version,
  }, {
    actor: { type: 'BUYER_CUSTOMER', id: buyer.buyerCustomerId, roles: [] },
    principal: {
      type: 'BUYER_SESSION',
      accountId: session.accountId,
      identitySubjectId: session.identitySubjectId,
    },
    idempotencyKey: requireIdempotencyKey(context),
    requestId: requestIdFromContext(context),
  });
  const response: BuyerReviewFileReadIntentDto = {
    read_intent_id: result.readIntentId,
    file_object_id: result.fileObjectId,
    access_token: result.accessToken,
    access_token_available: result.accessTokenAvailable,
    expires_at: result.expiresAt,
    replayed: result.replayed,
  };
  return success(context, response, result.replayed ? 200 : 201);
}

function parseSubmitBody(value: unknown): SubmitBuyerReviewRequest {
  const body = requireRecord(value);
  requireAllowedKeys(body, [
    'formal_order_id', 'expected_version', 'review_type', 'review_url',
    'evidence_files', 'buyer_note',
  ], [
    'formal_order_id', 'expected_version', 'review_type', 'review_url',
    'evidence_files',
  ]);
  if (body['expected_version'] !== 0) validationError();
  return {
    formal_order_id: identifier(body['formal_order_id']),
    expected_version: 0,
    review_type: reviewType(body['review_type']),
    review_url: nullableUrl(body['review_url']),
    evidence_files: evidenceFiles(body['evidence_files']),
    ...(Object.hasOwn(body, 'buyer_note')
      ? { buyer_note: optionalText(body['buyer_note']) }
      : {}),
  };
}

function parseResubmitBody(value: unknown): ResubmitBuyerReviewRequest {
  const body = requireRecord(value);
  requireAllowedKeys(body, [
    'expected_version', 'review_type', 'review_url', 'evidence_files', 'buyer_note',
  ], [
    'expected_version', 'review_type', 'review_url', 'evidence_files',
  ]);
  return {
    expected_version: positiveVersion(body['expected_version']),
    review_type: reviewType(body['review_type']),
    review_url: nullableUrl(body['review_url']),
    evidence_files: evidenceFiles(body['evidence_files']),
    ...(Object.hasOwn(body, 'buyer_note')
      ? { buyer_note: optionalText(body['buyer_note']) }
      : {}),
  };
}

function parseWithdrawBody(value: unknown): WithdrawBuyerReviewRequest {
  const body = requireRecord(value);
  requireAllowedKeys(body, ['expected_version'], ['expected_version']);
  return { expected_version: positiveVersion(body['expected_version']) };
}
function parseReadIntentBody(value: unknown): CreateBuyerReviewFileReadIntentRequest {
  const body = requireRecord(value);
  requireAllowedKeys(body, ['expected_file_version'], ['expected_file_version']);
  return { expected_file_version: positiveVersion(body['expected_file_version']) };
}
function evidenceFiles(value: unknown): SubmitBuyerReviewRequest['evidence_files'] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FILES) {
    return validationError();
  }
  const files = value.map((item) => {
    const record = requireRecord(item);
    requireAllowedKeys(
      record,
      ['file_object_id', 'expected_file_version'],
      ['file_object_id', 'expected_file_version'],
    );
    return {
      file_object_id: identifier(record['file_object_id']),
      expected_file_version: positiveVersion(record['expected_file_version']),
    };
  });
  if (new Set(files.map((file) => file.file_object_id)).size !== files.length) {
    validationError();
  }
  return Object.freeze(files);
}
function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return validationError();
  return value as Record<string, unknown>;
}
function requireAllowedKeys(
  body: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(body).some((key) => !allowedSet.has(key))
    || required.some((key) => !Object.hasOwn(body, key))) validationError();
}
function identifier(value: unknown): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > MAX_IDENTIFIER_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(value)) return validationError();
  return value;
}
function reviewType(value: unknown): PricingReviewType {
  if (!isPricingReviewType(value)) return validationError();
  return value;
}
function positiveVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) return validationError();
  return Number(value);
}
function nullableUrl(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 4096) return validationError();
  return value;
}
function optionalText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 2000) return validationError();
  return value;
}
function requireRouteId(context: Context<any>): string {
  const value = context.req.param('id');
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > MAX_IDENTIFIER_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new BuyerReviewPortalError('NOT_FOUND', 404);
  }
  return value;
}
function requireFileLinkRouteId(context: Context<any>): string {
  const value = context.req.param('fileLinkId');
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > MAX_IDENTIFIER_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new BuyerReviewPortalError('NOT_FOUND', 404);
  }
  return value;
}
function requireIdempotencyKey(context: Context<any>): string {
  const value = parseIdempotencyKey(context.req.header('Idempotency-Key'));
  if (!value) return validationError();
  return value;
}
function rejectUnknownOrRepeatedQuery(url: URL): void {
  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_LIST_QUERY_KEYS.has(key) || seen.has(key)) validationError();
    seen.add(key);
  }
}
function singleQuery(url: URL, key: string): string | null {
  const values = url.searchParams.getAll(key);
  if (values.length > 1) return validationError();
  return values[0] ?? null;
}
function success(
  context: Context<any>,
  data: unknown,
  status: 200 | 201 = 200,
): Response {
  return context.json(apiSuccess(data, requestIdFromContext(context)), status);
}
function withBuyerReviewErrors(handler: (context: Context<any>) => Promise<Response>) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      return buyerReviewPortalFailure(
        context,
        normalizeBuyerReviewPortalError(error),
      );
    }
  };
}
function validationError(): never {
  throw new BuyerReviewPortalError('VALIDATION_ERROR', 400);
}
