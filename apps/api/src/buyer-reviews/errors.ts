import {
  apiFailure,
  isApiErrorCode,
  type ApiErrorCode,
} from '@ygb/contracts';
import type { Context } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';

export type BuyerReviewPortalStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 503;

export class BuyerReviewPortalError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: BuyerReviewPortalStatus,
  ) {
    super(code);
    this.name = 'BuyerReviewPortalError';
  }
}

const ERROR_MESSAGES: Readonly<Partial<Record<ApiErrorCode, string>>> =
  Object.freeze({
    VALIDATION_ERROR: '请求参数不正确',
    UNAUTHENTICATED: '请先登录',
    SESSION_INVALID: '登录状态已失效，请重新登录',
    PASSWORD_CHANGE_REQUIRED: '请先修改初始密码',
    FORBIDDEN: '当前账号无权访问买家评论资料',
    NOT_FOUND: '请求的资源不存在',
    VERSION_CONFLICT: '评论资料已更新，请刷新后重试',
    IDEMPOTENCY_CONFLICT: '重复请求内容不一致',
    REQUEST_IN_PROGRESS: '请求正在处理中',
    REVIEW_ALREADY_EXISTS: '该订单已有评论资料',
    REVIEW_STATE_CONFLICT: '当前评论状态不能执行此操作',
    FORMAL_ORDER_STATE_CONFLICT: '当前正式订单不能提交评论资料',
    FILE_NOT_VERIFIED: '文件尚未完成验证',
    CUSTOMER_NOT_ACTIVE: '当前账号不可用',
    IDENTITY_REVIEW_REQUIRED: '账号资料需要先完成审核',
    DEPENDENCY_UNAVAILABLE: '服务暂时不可用，请稍后重试',
  });

const CONFLICT_CODES = new Set<ApiErrorCode>([
  'CONFLICT',
  'STATE_CONFLICT',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'REQUEST_IN_PROGRESS',
  'REVIEW_ALREADY_EXISTS',
  'REVIEW_STATE_CONFLICT',
  'FORMAL_ORDER_STATE_CONFLICT',
  'FILE_NOT_VERIFIED',
  'FILE_STORAGE_CONFLICT',
  'CUSTOMER_NOT_ACTIVE',
  'IDENTITY_REVIEW_REQUIRED',
]);

const HIDDEN_NOT_FOUND_CODES = new Set<ApiErrorCode>([
  'NOT_FOUND',
  'FORMAL_ORDER_NOT_FOUND',
  'BUYER_FORMAL_ORDER_NOT_FOUND',
  'REVIEW_CASE_NOT_FOUND',
  'FILE_OBJECT_NOT_FOUND',
  'FILE_READ_INTENT_NOT_FOUND',
  'REVIEW_FILE_CONFLICT',
]);

export function buyerReviewPortalFailure(
  context: Context<any>,
  error: BuyerReviewPortalError,
): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(
    apiFailure(
      error.code,
      ERROR_MESSAGES[error.code]
        ?? ERROR_MESSAGES.DEPENDENCY_UNAVAILABLE
        ?? '服务暂时不可用，请稍后重试',
      requestIdFromContext(context),
    ),
    error.status,
  );
}

export function normalizeBuyerReviewPortalError(
  error: unknown,
): BuyerReviewPortalError {
  if (error instanceof BuyerReviewPortalError) return error;

  const candidate = error as { code?: unknown } | null;
  if (!isApiErrorCode(candidate?.code)) {
    return new BuyerReviewPortalError('DEPENDENCY_UNAVAILABLE', 503);
  }

  const code = candidate.code;
  if (HIDDEN_NOT_FOUND_CODES.has(code)) {
    return new BuyerReviewPortalError('NOT_FOUND', 404);
  }
  if (code === 'VALIDATION_ERROR') {
    return new BuyerReviewPortalError(code, 400);
  }
  if (code === 'UNAUTHENTICATED' || code === 'SESSION_INVALID') {
    return new BuyerReviewPortalError(code, 401);
  }
  if (code === 'PASSWORD_CHANGE_REQUIRED' || code === 'FORBIDDEN') {
    return new BuyerReviewPortalError(code, 403);
  }
  if (CONFLICT_CODES.has(code)) {
    return new BuyerReviewPortalError(code, 409);
  }
  if (code === 'DEPENDENCY_UNAVAILABLE') {
    return new BuyerReviewPortalError(code, 503);
  }
  return new BuyerReviewPortalError('DEPENDENCY_UNAVAILABLE', 503);
}
