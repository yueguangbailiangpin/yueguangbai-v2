import {
  apiFailure,
  isApiErrorCode,
  type ApiErrorCode,
} from '@ygb/contracts';
import type { Context } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';

export type BuyerFormalOrderStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 503;

export class BuyerFormalOrderPortalError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: BuyerFormalOrderStatus,
  ) {
    super(code);
    this.name = 'BuyerFormalOrderPortalError';
  }
}

const ERROR_MESSAGES: Readonly<Partial<Record<ApiErrorCode, string>>> =
  Object.freeze({
    VALIDATION_ERROR: '请求参数不正确',
    UNAUTHENTICATED: '请先登录',
    SESSION_INVALID: '登录状态已失效，请重新登录',
    PASSWORD_CHANGE_REQUIRED: '请先修改初始密码',
    FORBIDDEN: '当前账号无权访问买家门户',
    BUYER_FORMAL_ORDER_NOT_FOUND: '正式订单不存在',
    CUSTOMER_NOT_ACTIVE: '当前账号不可用',
    IDENTITY_REVIEW_REQUIRED: '账号资料需要先完成审核',
    DEPENDENCY_UNAVAILABLE: '服务暂时不可用，请稍后重试',
  });

export function buyerFormalOrderFailure(
  context: Context<any>,
  error: BuyerFormalOrderPortalError,
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

export function normalizeBuyerFormalOrderError(
  error: unknown,
): BuyerFormalOrderPortalError {
  if (error instanceof BuyerFormalOrderPortalError) return error;

  const candidate = error as { code?: unknown; status?: unknown };
  if (!isApiErrorCode(candidate?.code)) {
    return dependencyUnavailable();
  }

  const code = candidate.code;
  if (code === 'BUYER_FORMAL_ORDER_NOT_FOUND'
    || code === 'NOT_FOUND') {
    return new BuyerFormalOrderPortalError(
      'BUYER_FORMAL_ORDER_NOT_FOUND',
      404,
    );
  }
  if (code === 'VALIDATION_ERROR') {
    return new BuyerFormalOrderPortalError(code, 400);
  }
  if (code === 'UNAUTHENTICATED' || code === 'SESSION_INVALID') {
    return new BuyerFormalOrderPortalError(code, 401);
  }
  if (code === 'PASSWORD_CHANGE_REQUIRED' || code === 'FORBIDDEN') {
    return new BuyerFormalOrderPortalError(code, 403);
  }
  if (code === 'CUSTOMER_NOT_ACTIVE'
    || code === 'IDENTITY_REVIEW_REQUIRED') {
    return new BuyerFormalOrderPortalError(code, 409);
  }
  if (code === 'DEPENDENCY_UNAVAILABLE') {
    return dependencyUnavailable();
  }
  return dependencyUnavailable();
}

function dependencyUnavailable(): BuyerFormalOrderPortalError {
  return new BuyerFormalOrderPortalError(
    'DEPENDENCY_UNAVAILABLE',
    503,
  );
}
