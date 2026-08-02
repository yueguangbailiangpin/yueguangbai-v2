import {
  apiFailure,
  apiSuccess,
  type ApiErrorCode,
} from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  approveReview,
  rejectReview,
  requestReviewChanges,
} from './decide-review';
import {
  getStaffReview,
  getStaffReviewHistory,
} from './staff-read-model';
import {
  cleanReviewIdentifier,
  normalizeReviewError,
  ReviewError,
} from './review-shared';

const BODY_LIMIT = 8 * 1024;

export function registerStaffReviewRoutes(app: Hono<any>): void {
  app.get('/api/staff/reviews/:id', withErrors(readCurrent));
  app.get('/api/staff/reviews/:id/evidence-versions', withErrors(readHistory));
  app.post('/api/staff/reviews/:id/request-changes', withErrors(requestChanges));
  app.post('/api/staff/reviews/:id/reject', withErrors(reject));
  app.post('/api/staff/reviews/:id/approve', withErrors(approve));
}

async function readCurrent(context: Context<any>): Promise<Response> {
  return success(context, {
    review: await getStaffReview(
      context.env.DB,
      authorization(context),
      reviewId(context),
    ),
  });
}

async function readHistory(context: Context<any>): Promise<Response> {
  return success(context, {
    history: await getStaffReviewHistory(
      context.env.DB,
      authorization(context),
      reviewId(context),
    ),
  });
}

async function requestChanges(context: Context<any>): Promise<Response> {
  const body = await bodyRecord(context);
  exactKeys(body, ['expected_version', 'public_reason', 'internal_note'], ['internal_note']);
  const actor = authorization(context);
  const result = await requestReviewChanges(context.env.DB, {
    reviewCaseId: reviewId(context),
    expectedVersion: positiveInteger(body['expected_version']),
    publicReason: text(body['public_reason'], 2000),
    internalNote: optionalText(body['internal_note'], 4000),
  }, command(context, actor));
  return success(context, { review: result });
}

async function reject(context: Context<any>): Promise<Response> {
  const body = await bodyRecord(context);
  exactKeys(body, ['expected_version', 'public_reason', 'internal_note'], ['internal_note']);
  const actor = authorization(context);
  const result = await rejectReview(context.env.DB, {
    reviewCaseId: reviewId(context),
    expectedVersion: positiveInteger(body['expected_version']),
    publicReason: text(body['public_reason'], 2000),
    internalNote: optionalText(body['internal_note'], 4000),
  }, command(context, actor));
  return success(context, { review: result });
}

async function approve(context: Context<any>): Promise<Response> {
  const body = await bodyRecord(context);
  exactKeys(body, ['expected_version', 'internal_note'], ['internal_note']);
  const actor = authorization(context);
  const result = await approveReview(context.env.DB, {
    reviewCaseId: reviewId(context),
    expectedVersion: positiveInteger(body['expected_version']),
    internalNote: optionalText(body['internal_note'], 4000),
  }, command(context, actor));
  return success(context, { review: result });
}

function authorization(context: Context<any>): AssignmentStaffAuthorization {
  const value = context.get('staffAuthorization') as
    | AssignmentStaffAuthorization
    | null
    | undefined;
  if (!value) throw new ReviewError('FORBIDDEN', 403);
  return value;
}

function reviewId(context: Context<any>): string {
  const id = context.req.param('id');
  if (id === undefined) throw new ReviewError('VALIDATION_ERROR', 400);
  return cleanReviewIdentifier(id);
}

function command(context: Context<any>, actor: AssignmentStaffAuthorization) {
  const key = parseIdempotencyKey(context.req.header('Idempotency-Key'));
  if (!key) throw new ReviewError('VALIDATION_ERROR', 400);
  return {
    actor: {
      staffId: actor.staffId,
      displayName: actor.displayName,
      roles: Object.freeze([...actor.roles]),
      permissions: actor.permissions,
    },
    idempotencyKey: key,
    requestId: requestIdFromContext(context),
  };
}

async function bodyRecord(context: Context<any>): Promise<Record<string, unknown>> {
  const value = await readBoundedJson(context.req.raw, BODY_LIMIT);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReviewError('VALIDATION_ERROR', 400);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  body: Record<string, unknown>,
  keys: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set(keys);
  const optionalSet = new Set(optional);
  if (Object.keys(body).some((key) => !allowed.has(key))
    || keys.some((key) => !optionalSet.has(key) && !Object.hasOwn(body, key))) {
    throw new ReviewError('VALIDATION_ERROR', 400);
  }
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new ReviewError('VALIDATION_ERROR', 400);
  }
  return Number(value);
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string') throw new ReviewError('VALIDATION_ERROR', 400);
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1 || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new ReviewError('VALIDATION_ERROR', 400);
  }
  return normalized;
}

function optionalText(value: unknown, maximum: number): string | null {
  if (value === undefined || value === null) return null;
  return text(value, maximum);
}

function withErrors(handler: (context: Context<any>) => Promise<Response>) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      const normalized = normalizeReviewError(error);
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
  if (code === 'FORBIDDEN') return '无权访问该评论';
  if (code === 'REVIEW_CASE_NOT_FOUND') return '评论不存在';
  if (code === 'VALIDATION_ERROR') return '请求参数不正确';
  if (code === 'VERSION_CONFLICT') return '评论已发生变化，请刷新后重试';
  return '当前评论状态无法执行该操作';
}

function success(context: Context<any>, data: unknown): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(data, requestIdFromContext(context)));
}
