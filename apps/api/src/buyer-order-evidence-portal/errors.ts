import {
  apiFailure,
  isApiErrorCode,
  type ApiErrorCode,
} from '@ygb/contracts';
import type { Context } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';

export type BuyerOrderEvidencePortalStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 503;

export class BuyerOrderEvidencePortalError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly status: BuyerOrderEvidencePortalStatus,
  ) {
    super(code);
    this.name = 'BuyerOrderEvidencePortalError';
  }
}

const ERROR_MESSAGES: Readonly<
  Partial<Record<ApiErrorCode, string>>
> = Object.freeze({
  VALIDATION_ERROR: '请求参数不正确',
  UNAUTHENTICATED: '请先登录',
  SESSION_INVALID: '登录状态已失效，请重新登录',
  PASSWORD_CHANGE_REQUIRED: '请先修改初始密码',
  FORBIDDEN: '当前账号无权访问买家订单资料',
  NOT_FOUND: '请求的资源不存在',
  VERSION_CONFLICT: '资料已更新，请刷新后重试',
  IDEMPOTENCY_CONFLICT: '重复请求内容不一致',
  REQUEST_IN_PROGRESS: '请求正在处理中',
  ORDER_EVIDENCE_ALREADY_EXISTS: '该预约已有订单资料',
  ORDER_EVIDENCE_STATE_CONFLICT: '当前订单资料状态不能执行此操作',
  ORDER_EVIDENCE_FILE_CONFLICT: '文件不可用于当前订单资料',
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
  'ORDER_EVIDENCE_ALREADY_EXISTS',
  'ORDER_EVIDENCE_STATE_CONFLICT',
  'FILE_NOT_VERIFIED',
  'CUSTOMER_NOT_ACTIVE',
  'IDENTITY_REVIEW_REQUIRED',
]);

const HIDDEN_NOT_FOUND_CODES = new Set<ApiErrorCode>([
  'NOT_FOUND',
  'RESERVATION_NOT_FOUND',
  'ORDER_EVIDENCE_NOT_FOUND',
  'FILE_OBJECT_NOT_FOUND',
  'ORDER_EVIDENCE_FILE_CONFLICT',
]);

export function buyerOrderEvidencePortalFailure(
  context: Context<any>,
  error: BuyerOrderEvidencePortalError,
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

export function normalizeBuyerOrderEvidencePortalError(
  error: unknown,
): BuyerOrderEvidencePortalError {
  if (error instanceof BuyerOrderEvidencePortalError) return error;

  const candidate = error as { code?: unknown } | null;
  if (!isApiErrorCode(candidate?.code)) {
    return new BuyerOrderEvidencePortalError(
      'DEPENDENCY_UNAVAILABLE',
      503,
    );
  }

  const code = candidate.code;
  if (HIDDEN_NOT_FOUND_CODES.has(code)) {
    return new BuyerOrderEvidencePortalError('NOT_FOUND', 404);
  }
  if (code === 'VALIDATION_ERROR') {
    return new BuyerOrderEvidencePortalError(code, 400);
  }
  if (code === 'UNAUTHENTICATED'
    || code === 'SESSION_INVALID') {
    return new BuyerOrderEvidencePortalError(code, 401);
  }
  if (code === 'PASSWORD_CHANGE_REQUIRED'
    || code === 'FORBIDDEN') {
    return new BuyerOrderEvidencePortalError(code, 403);
  }
  if (CONFLICT_CODES.has(code)) {
    return new BuyerOrderEvidencePortalError(code, 409);
  }
  if (code === 'DEPENDENCY_UNAVAILABLE') {
    return new BuyerOrderEvidencePortalError(code, 503);
  }

  return new BuyerOrderEvidencePortalError(
    'DEPENDENCY_UNAVAILABLE',
    503,
  );
}
