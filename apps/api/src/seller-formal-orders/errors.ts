import {
  apiFailure,
  isApiErrorCode,
  type ApiErrorCode,
} from '@ygb/contracts';
import type { Context } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';

export type SellerFormalOrderPortalErrorStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 503;

export class SellerFormalOrderPortalError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: SellerFormalOrderPortalErrorStatus,
  ) {
    super(code);
    this.name = 'SellerFormalOrderPortalError';
  }
}

const ERROR_MESSAGES: Readonly<Partial<Record<ApiErrorCode, string>>> =
  Object.freeze({
    VALIDATION_ERROR: '请求参数不正确',
    UNAUTHENTICATED: '请先登录',
    FORBIDDEN: '当前账号无权查看正式订单',
    PASSWORD_CHANGE_REQUIRED: '请先修改初始密码',
    SESSION_INVALID: '登录状态已失效，请重新登录',
    FORMAL_ORDER_NOT_FOUND: '正式订单不存在',
    DEPENDENCY_UNAVAILABLE: '服务暂时不可用，请稍后重试',
  });

export function sellerFormalOrderPortalFailure(
  context: Context<any>,
  error: SellerFormalOrderPortalError,
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

export function normalizeSellerFormalOrderPortalError(
  error: unknown,
): SellerFormalOrderPortalError {
  if (error instanceof SellerFormalOrderPortalError) return error;

  const candidate = error as {
    code?: unknown;
    status?: unknown;
  };
  if (isApiErrorCode(candidate?.code)) {
    return new SellerFormalOrderPortalError(
      candidate.code,
      normalizeStatus(candidate.status, candidate.code),
    );
  }
  return new SellerFormalOrderPortalError(
    'DEPENDENCY_UNAVAILABLE',
    503,
  );
}

export function withSellerFormalOrderPortalErrors(
  handler: (context: Context<any>) => Promise<Response>,
) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      return sellerFormalOrderPortalFailure(
        context,
        normalizeSellerFormalOrderPortalError(error),
      );
    }
  };
}

function normalizeStatus(
  value: unknown,
  code: ApiErrorCode,
): SellerFormalOrderPortalErrorStatus {
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
  if (code === 'FORMAL_ORDER_NOT_FOUND'
    || code === 'NOT_FOUND'
    || code.endsWith('_NOT_FOUND')) {
    return 404;
  }
  if (code === 'VALIDATION_ERROR') return 400;
  if (code === 'DEPENDENCY_UNAVAILABLE') return 503;
  return 409;
}
