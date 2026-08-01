import {
  apiFailure,
  isApiErrorCode,
  type ApiErrorCode,
} from '@ygb/contracts';
import type { Context } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';

export type SellerReviewPortalErrorStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 503;

export class SellerReviewPortalError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: SellerReviewPortalErrorStatus,
  ) {
    super(code);
    this.name = 'SellerReviewPortalError';
  }
}

const ERROR_MESSAGES: Readonly<Partial<Record<ApiErrorCode, string>>> =
  Object.freeze({
    VALIDATION_ERROR: '请求参数不正确',
    UNAUTHENTICATED: '请先登录',
    FORBIDDEN: '当前账号无权查看评论',
    PASSWORD_CHANGE_REQUIRED: '请先修改初始密码',
    SESSION_INVALID: '登录状态已失效，请重新登录',
    SELLER_REVIEW_NOT_FOUND: '评论不存在',
    SELLER_REVIEW_FILE_NOT_FOUND: '评论证据不存在',
    VERSION_CONFLICT: '文件版本已变化，请刷新后重试',
    IDEMPOTENCY_CONFLICT: '请求标识与已有请求冲突',
    REQUEST_IN_PROGRESS: '相同请求正在处理中',
    FILE_STORAGE_CONFLICT: '文件状态不允许读取',
    DEPENDENCY_UNAVAILABLE: '服务暂时不可用，请稍后重试',
  });

export function sellerReviewPortalFailure(
  context: Context<any>,
  error: SellerReviewPortalError,
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

export function normalizeSellerReviewPortalError(
  error: unknown,
): SellerReviewPortalError {
  if (error instanceof SellerReviewPortalError) return error;

  const candidate = error as {
    code?: unknown;
    status?: unknown;
  };
  if (isApiErrorCode(candidate?.code)) {
    return new SellerReviewPortalError(
      candidate.code,
      normalizeStatus(candidate.status, candidate.code),
    );
  }
  return new SellerReviewPortalError(
    'DEPENDENCY_UNAVAILABLE',
    503,
  );
}

export function withSellerReviewPortalErrors(
  handler: (context: Context<any>) => Promise<Response>,
) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      return sellerReviewPortalFailure(
        context,
        normalizeSellerReviewPortalError(error),
      );
    }
  };
}

function normalizeStatus(
  value: unknown,
  code: ApiErrorCode,
): SellerReviewPortalErrorStatus {
  if (value === 400
    || value === 401
    || value === 403
    || value === 404
    || value === 409
    || value === 503) {
    return value;
  }
  if (code === 'UNAUTHENTICATED' || code === 'SESSION_INVALID') {
    return 401;
  }
  if (code === 'FORBIDDEN' || code === 'PASSWORD_CHANGE_REQUIRED') {
    return 403;
  }
  if (code === 'SELLER_REVIEW_NOT_FOUND'
    || code === 'SELLER_REVIEW_FILE_NOT_FOUND'
    || code === 'NOT_FOUND'
    || code.endsWith('_NOT_FOUND')) {
    return 404;
  }
  if (code === 'VALIDATION_ERROR') return 400;
  if (code === 'DEPENDENCY_UNAVAILABLE') return 503;
  return 409;
}
