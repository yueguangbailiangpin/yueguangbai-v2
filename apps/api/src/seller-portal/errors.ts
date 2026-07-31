import {
  apiFailure,
  isApiErrorCode,
  type ApiErrorCode,
} from '@ygb/contracts';
import type { Context } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';

export type SellerPortalErrorStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 503;

export class SellerPortalError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: SellerPortalErrorStatus,
  ) {
    super(code);
    this.name = 'SellerPortalError';
  }
}

const ERROR_MESSAGES: Readonly<Partial<Record<ApiErrorCode, string>>> =
  Object.freeze({
    VALIDATION_ERROR: '请求参数不正确',
    UNAUTHENTICATED: '请先登录',
    FORBIDDEN: '当前账号无权执行此操作',
    NOT_FOUND: '请求的资源不存在',
    STORE_NOT_FOUND: '店铺不存在',
    PRODUCT_NOT_FOUND: '产品不存在',
    PRODUCT_APPLICATION_NOT_FOUND: '新品申请不存在',
    DEMAND_BATCH_NOT_FOUND: '需求批次不存在',
    VERSION_CONFLICT: '资源已更新，请刷新后重试',
    IDEMPOTENCY_CONFLICT: '重复请求内容不一致',
    REQUEST_IN_PROGRESS: '请求正在处理中',
    PRODUCT_APPLICATION_ALREADY_REVIEWED: '新品申请当前不可撤回',
    PRODUCT_APPLICATION_CONFLICT: '该 ASIN 已有待处理申请',
    DUPLICATE_PRODUCT: '产品已存在',
    ASIN_STORE_CONFLICT: '该 ASIN 已归属其他店铺',
    DEMAND_BATCH_ALREADY_REVIEWED: '需求批次当前不可撤回',
    DEPENDENCY_UNAVAILABLE: '服务暂时不可用，请稍后重试',
  });

export function sellerPortalFailure(
  context: Context<any>,
  error: SellerPortalError,
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

export function normalizeSellerPortalError(
  error: unknown,
): SellerPortalError {
  if (error instanceof SellerPortalError) return error;

  const candidate = error as {
    code?: unknown;
    status?: unknown;
  };
  if (isApiErrorCode(candidate?.code)) {
    const status = normalizeStatus(candidate.status, candidate.code);
    return new SellerPortalError(candidate.code, status);
  }
  return new SellerPortalError('DEPENDENCY_UNAVAILABLE', 503);
}

export function withSellerPortalErrors(
  handler: (context: Context<any>) => Promise<Response>,
) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      return sellerPortalFailure(
        context,
        normalizeSellerPortalError(error),
      );
    }
  };
}

function normalizeStatus(
  value: unknown,
  code: ApiErrorCode,
): SellerPortalErrorStatus {
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
  if (code === 'NOT_FOUND'
    || code.endsWith('_NOT_FOUND')) {
    return 404;
  }
  if (code === 'VALIDATION_ERROR') return 400;
  if (code === 'DEPENDENCY_UNAVAILABLE') return 503;
  return 409;
}
