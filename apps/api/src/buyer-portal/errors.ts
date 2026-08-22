import {
  apiFailure,
  isApiErrorCode,
  type ApiErrorCode,
} from '@ygb/contracts';
import type { Context } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';

export type BuyerPortalStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 503;

export class BuyerPortalError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: BuyerPortalStatus,
  ) {
    super(code);
    this.name = 'BuyerPortalError';
  }
}

const ERROR_MESSAGES: Readonly<
  Partial<Record<ApiErrorCode, string>>
> = Object.freeze({
  VALIDATION_ERROR: '请求参数不正确',
  UNAUTHENTICATED: '请先登录',
  SESSION_INVALID: '登录状态已失效，请重新登录',
  PASSWORD_CHANGE_REQUIRED: '请先修改初始密码',
  FORBIDDEN: '当前账号无权访问买家门户',
  NOT_FOUND: '请求的资源不存在',
  VERSION_CONFLICT: '资源已更新，请刷新后重试',
  IDEMPOTENCY_CONFLICT: '重复请求内容不一致',
  REQUEST_IN_PROGRESS: '请求正在处理中',
  CAPACITY_FULL: '当前需求名额已满',
  RESERVATION_ALREADY_EXISTS: '该需求已提交过预约',
  BUYER_STORE_RESERVATION_CONFLICT: '该店铺已有进行中的预约，请先完成或取消后再预约',
  RESERVATION_ALREADY_DECIDED: '当前预约状态不能执行此操作',
  DEMAND_BATCH_NOT_PUBLISHED: '当前需求不可预约',
  DEMAND_BATCH_EXPIRED: '当前需求已过预约时间',
  CUSTOMER_NOT_ACTIVE: '当前账号不可用',
  IDENTITY_REVIEW_REQUIRED: '账号资料需要先完成审核',
  DEPENDENCY_UNAVAILABLE: '服务暂时不可用，请稍后重试',
});

const CONFLICT_CODES = new Set<ApiErrorCode>([
  'CONFLICT',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'REQUEST_IN_PROGRESS',
  'STATE_CONFLICT',
  'DEMAND_BATCH_NOT_PUBLISHED',
  'DEMAND_BATCH_EXPIRED',
  'RESERVATION_ALREADY_EXISTS',
  'RESERVATION_ALREADY_DECIDED',
  'BUYER_STORE_RESERVATION_CONFLICT',
  'CAPACITY_FULL',
  'CUSTOMER_NOT_ACTIVE',
  'IDENTITY_REVIEW_REQUIRED',
]);

export function buyerPortalFailure(
  context: Context<any>,
  error: BuyerPortalError,
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

export function normalizeBuyerPortalError(
  error: unknown,
): BuyerPortalError {
  if (error instanceof BuyerPortalError) return error;

  const candidate = error as {
    code?: unknown;
    status?: unknown;
  };
  if (!isApiErrorCode(candidate?.code)) {
    return new BuyerPortalError(
      'DEPENDENCY_UNAVAILABLE',
      503,
    );
  }

  const code = candidate.code;
  if (code === 'DEMAND_BATCH_NOT_FOUND'
    || code === 'RESERVATION_NOT_FOUND'
    || code === 'NOT_FOUND') {
    return new BuyerPortalError('NOT_FOUND', 404);
  }
  if (code === 'VALIDATION_ERROR') {
    return new BuyerPortalError(code, 400);
  }
  if (code === 'UNAUTHENTICATED'
    || code === 'SESSION_INVALID') {
    return new BuyerPortalError(code, 401);
  }
  if (code === 'PASSWORD_CHANGE_REQUIRED'
    || code === 'FORBIDDEN') {
    return new BuyerPortalError(code, 403);
  }
  if (CONFLICT_CODES.has(code)) {
    return new BuyerPortalError(code, 409);
  }
  if (code === 'DEPENDENCY_UNAVAILABLE') {
    return new BuyerPortalError(code, 503);
  }

  return new BuyerPortalError(
    'DEPENDENCY_UNAVAILABLE',
    503,
  );
}
