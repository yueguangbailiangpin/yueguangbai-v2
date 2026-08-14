import {
  apiFailure,
  isApiErrorCode,
  type ApiErrorCode,
} from '@ygb/contracts';
import type { Context } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';

export type BuyerRefundPortalStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 429
  | 503;

export class BuyerRefundPortalError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: BuyerRefundPortalStatus,
  ) {
    super(code);
    this.name = 'BuyerRefundPortalError';
  }
}

const ERROR_MESSAGES: Readonly<Partial<Record<ApiErrorCode, string>>> =
  Object.freeze({
    VALIDATION_ERROR: '请求参数不正确',
    UNAUTHENTICATED: '请先登录',
    SESSION_INVALID: '登录状态已失效，请重新登录',
    PASSWORD_CHANGE_REQUIRED: '请先修改初始密码',
    FORBIDDEN: '当前账号无权访问买家返款资料',
    NOT_FOUND: '请求的返款资料不存在',
    CUSTOMER_NOT_ACTIVE: '当前账号不可用',
    IDENTITY_REVIEW_REQUIRED: '账号资料需要先完成审核',
    IDEMPOTENCY_CONFLICT: '幂等键不能用于不同催办请求',
    REQUEST_IN_PROGRESS: '相同催办请求正在处理中',
    RATE_LIMITED: '该返款已催办，请 24 小时后再试',
    DEPENDENCY_UNAVAILABLE: '服务暂时不可用，请稍后重试',
  });

export function buyerRefundPortalFailure(
  context: Context<any>,
  error: BuyerRefundPortalError,
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

export function normalizeBuyerRefundPortalError(
  error: unknown,
): BuyerRefundPortalError {
  if (error instanceof BuyerRefundPortalError) return error;

  const candidate = error as { code?: unknown } | null;
  if (!isApiErrorCode(candidate?.code)) {
    return dependencyUnavailable();
  }
  const code = candidate.code;
  if (code === 'BUYER_REFUND_NOT_FOUND' || code === 'NOT_FOUND') {
    return new BuyerRefundPortalError('NOT_FOUND', 404);
  }
  if (code === 'VALIDATION_ERROR') {
    return new BuyerRefundPortalError(code, 400);
  }
  if (code === 'UNAUTHENTICATED' || code === 'SESSION_INVALID') {
    return new BuyerRefundPortalError(code, 401);
  }
  if (code === 'PASSWORD_CHANGE_REQUIRED' || code === 'FORBIDDEN') {
    return new BuyerRefundPortalError(code, 403);
  }
  if (code === 'CUSTOMER_NOT_ACTIVE'
    || code === 'IDENTITY_REVIEW_REQUIRED'
    || code === 'IDEMPOTENCY_CONFLICT'
    || code === 'REQUEST_IN_PROGRESS') {
    return new BuyerRefundPortalError(code, 409);
  }
  if (code === 'RATE_LIMITED') {
    return new BuyerRefundPortalError(code, 429);
  }
  if (code === 'DEPENDENCY_UNAVAILABLE') {
    return dependencyUnavailable();
  }
  return dependencyUnavailable();
}

function dependencyUnavailable(): BuyerRefundPortalError {
  return new BuyerRefundPortalError('DEPENDENCY_UNAVAILABLE', 503);
}
