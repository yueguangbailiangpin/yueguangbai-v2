import {
  apiFailure,
  type ApiErrorCode,
} from '@ygb/contracts';
import type { Context } from 'hono';

export type CustomerHttpAuthStatus =
  | 400
  | 401
  | 403
  | 409
  | 429
  | 503;

export class CustomerHttpAuthError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: CustomerHttpAuthStatus,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(code);
    this.name = 'CustomerHttpAuthError';
  }
}

const ERROR_MESSAGES: Readonly<
  Partial<Record<ApiErrorCode, string>>
> = Object.freeze({
  VALIDATION_ERROR: '请求参数不正确',
  UNAUTHENTICATED: '请先登录',
  FORBIDDEN: '请求来源或权限不允许',
  INVALID_CREDENTIALS: '登录标识或密码不正确',
  PASSWORD_CHANGE_REQUIRED: '请先修改初始密码',
  SESSION_INVALID: '登录状态已失效，请重新登录',
  RATE_LIMITED: '登录尝试过多，请稍后重试',
  IDEMPOTENCY_CONFLICT: '重复请求内容不一致',
  REQUEST_IN_PROGRESS: '请求正在处理中',
  DEPENDENCY_UNAVAILABLE: '服务暂时不可用，请稍后重试',
});

export function customerHttpAuthFailure(
  context: Context<any>,
  error: CustomerHttpAuthError,
): Response {
  context.header('Cache-Control', 'no-store');
  if (error.retryAfterSeconds !== null) {
    context.header(
      'Retry-After',
      String(error.retryAfterSeconds),
    );
  }
  const requestId = requestIdFromContext(context);
  return context.json(
    apiFailure(
      error.code,
      ERROR_MESSAGES[error.code]
        ?? ERROR_MESSAGES.DEPENDENCY_UNAVAILABLE
        ?? '服务暂时不可用，请稍后重试',
      requestId,
    ),
    error.status,
  );
}

export function normalizeCustomerHttpAuthError(
  error: unknown,
): CustomerHttpAuthError {
  if (error instanceof CustomerHttpAuthError) return error;

  const candidate = error as {
    code?: unknown;
    status?: unknown;
  };
  if (candidate?.code === 'INVALID_CREDENTIALS') {
    return new CustomerHttpAuthError(
      'INVALID_CREDENTIALS',
      401,
    );
  }
  if (candidate?.code === 'VALIDATION_ERROR') {
    return new CustomerHttpAuthError(
      'VALIDATION_ERROR',
      400,
    );
  }
  if (candidate?.code === 'IDEMPOTENCY_CONFLICT') {
    return new CustomerHttpAuthError(
      'IDEMPOTENCY_CONFLICT',
      409,
    );
  }
  if (candidate?.code === 'REQUEST_IN_PROGRESS') {
    return new CustomerHttpAuthError(
      'REQUEST_IN_PROGRESS',
      409,
    );
  }
  if (candidate?.code === 'CUSTOMER_NOT_ACTIVE') {
    return new CustomerHttpAuthError(
      'SESSION_INVALID',
      401,
    );
  }
  if (candidate?.code === 'FORBIDDEN') {
    return new CustomerHttpAuthError('FORBIDDEN', 403);
  }
  if (candidate?.code === 'DEPENDENCY_UNAVAILABLE') {
    return new CustomerHttpAuthError(
      'DEPENDENCY_UNAVAILABLE',
      503,
    );
  }
  return new CustomerHttpAuthError(
    'DEPENDENCY_UNAVAILABLE',
    503,
  );
}

export function requestIdFromContext(
  context: Context<any>,
): string {
  const value = context.get('requestId') as unknown;
  return typeof value === 'string' && value.length > 0
    ? value
    : crypto.randomUUID();
}
