import {
  apiSuccess,
  isPricingReviewType,
  isReviewCaseStatus,
  type CreateSellerReviewFileReadIntentRequest,
  type SellerReviewFileReadIntentDto,
  type SellerReviewPortalFilters,
} from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { DenyAllFileAuthorizationService } from '../files/authorization';
import { createFileReadIntent } from '../files/file-read-service';
import { requestIdFromContext } from '../http-auth/errors';
import { customerSessionMiddleware } from '../middleware/customer-auth';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import { resolveSellerPortalActor } from '../seller-portal/actor';
import { parseSellerPortalPagination } from '../seller-portal/pagination';
import { SellerReviewPortalError, withSellerReviewPortalErrors } from './errors';
import {
  getSellerReview,
  listSellerReviews,
  requireSellerReviewEvidenceFile,
} from './read-model';
import {
  attachSellerReviewPageUrls,
  attachSellerReviewUrl,
} from './review-url-projection';

const READ_INTENT_BODY_LIMIT_BYTES = 2048;
const LEGACY_FILE_AUTHORIZATION = new DenyAllFileAuthorizationService();

export function registerSellerReviewRoutes(app: Hono<any>): void {
  const session = customerSessionMiddleware();
  const origin = customerAuthOriginGuard();
  app.get('/api/seller-portal/reviews', session, withSellerReviewPortalErrors(reviews));
  app.get('/api/seller-portal/reviews/:id', session, withSellerReviewPortalErrors(review));
  app.post(
    '/api/seller-portal/reviews/:id/files/:fileLinkId/read-intent',
    origin,
    session,
    withSellerReviewPortalErrors(createEvidenceReadIntent),
  );
}

async function reviews(context: Context<any>): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  const url = new URL(context.req.url);
  const pagination = parseSellerPortalPagination(url);
  const filters: SellerReviewPortalFilters = {
    store_id: optionalIdentifier(url.searchParams.get('store_id')),
    status: optionalReviewStatus(url.searchParams.get('status')),
    asin: optionalAsin(url.searchParams.get('asin')),
    review_type: optionalReviewType(url.searchParams.get('review_type')),
    formal_order_id: optionalIdentifier(url.searchParams.get('formal_order_id')),
    amazon_order_number: optionalAmazonOrderNumber(
      url.searchParams.get('amazon_order_number'),
    ),
  };
  const page = await listSellerReviews(
    context.env.DB,
    actor,
    pagination,
    filters,
  );
  return success(context, await attachSellerReviewPageUrls(
    context.env.DB,
    actor,
    page,
  ));
}

async function review(context: Context<any>): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  const value = await getSellerReview(
    context.env.DB,
    actor,
    identifier(context.req.param('id')),
  );
  return success(context, {
    review: await attachSellerReviewUrl(context.env.DB, actor, value),
  });
}

async function createEvidenceReadIntent(context: Context<any>): Promise<Response> {
  const actor = await resolveSellerPortalActor(context);
  const reviewCaseId = identifier(context.req.param('id'));
  const fileEntityLinkId = identifier(context.req.param('fileLinkId'));
  const body = parseReadIntentBody(await readBoundedJson(
    context.req.raw,
    READ_INTENT_BODY_LIMIT_BYTES,
  ));
  const now = Date.now();
  const access = await requireSellerReviewEvidenceFile(
    context.env.DB,
    actor,
    reviewCaseId,
    fileEntityLinkId,
    now,
  );
  if (body.expected_file_version !== access.fileVersion) {
    throw new SellerReviewPortalError('VERSION_CONFLICT', 409);
  }
  let result: Awaited<ReturnType<typeof createFileReadIntent>>;
  try {
    result = await createFileReadIntent(
      context.env.DB,
      LEGACY_FILE_AUTHORIZATION,
      {
        fileObjectId: access.fileObjectId,
        fileEntityLinkId: access.fileEntityLinkId,
        expectedFileVersion: body.expected_file_version,
      },
      {
        actor: {
          type: 'SELLER_MEMBER',
          id: actor.memberId,
          roles: Object.freeze([actor.role]),
        },
        principal: {
          type: 'SELLER_SESSION',
          accountId: actor.accountId,
          identitySubjectId: actor.identitySubjectId,
        },
        idempotencyKey: idempotencyKey(context),
        requestId: requestIdFromContext(context),
        now,
      },
    );
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code === 'FORBIDDEN'
      || code === 'FILE_OBJECT_NOT_FOUND'
      || code === 'FILE_NOT_VERIFIED') {
      throw new SellerReviewPortalError('SELLER_REVIEW_FILE_NOT_FOUND', 404);
    }
    throw error;
  }
  const readIntent: SellerReviewFileReadIntentDto = Object.freeze({
    read_intent_id: result.readIntentId,
    access_token: result.accessToken,
    access_token_available: result.accessTokenAvailable,
    expires_at: result.expiresAt,
    replayed: result.replayed,
  });
  return success(
    context,
    { read_intent: readIntent },
    result.replayed ? 200 : 201,
  );
}

function parseReadIntentBody(
  value: Record<string, unknown> | null,
): CreateSellerReviewFileReadIntentRequest {
  if (value === null
    || Object.keys(value).length !== 1
    || !Object.hasOwn(value, 'expected_file_version')) validation();
  const version = value['expected_file_version'];
  if (!Number.isSafeInteger(version) || Number(version) < 1) validation();
  return { expected_file_version: Number(version) };
}

function success(
  context: Context<any>,
  data: unknown,
  status: 200 | 201 = 200,
): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(data, requestIdFromContext(context)), status);
}

function identifier(value: unknown): string {
  if (typeof value !== 'string') validation();
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > 120
    || /[\u0000-\u001f\u007f]/u.test(normalized)) validation();
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
function optionalReviewType(
  value: string | null,
): SellerReviewPortalFilters['review_type'] {
  if (value === null) return null;
  if (!isPricingReviewType(value)) validation();
  return value;
}
function optionalReviewStatus(
  value: string | null,
): SellerReviewPortalFilters['status'] {
  if (value === null) return null;
  if (!isReviewCaseStatus(value)) validation();
  return value;
}
function optionalAmazonOrderNumber(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.normalize('NFKC').trim();
  if (!/^\d{3}-\d{7}-\d{7}$/u.test(normalized)) validation();
  return normalized;
}
function idempotencyKey(context: Context<any>): string {
  const value = parseIdempotencyKey(context.req.header('Idempotency-Key'));
  if (!value) validation();
  return value;
}
function validation(): never {
  throw new SellerReviewPortalError('VALIDATION_ERROR', 400);
}