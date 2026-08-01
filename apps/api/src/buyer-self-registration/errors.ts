import {
  apiFailure,
  type ApiErrorCode,
} from '@ygb/contracts';
import type { Context } from 'hono';

export type BuyerRegistrationFailureReason =
  | 'INVALID_REQUEST'
  | 'FEATURE_DISABLED'
  | 'HUMAN_VERIFICATION_FAILED'
  | 'RATE_LIMITED'
  | 'ACCOUNT_ALREADY_EXISTS'
  | 'BUYER_NOT_ELIGIBLE'
  | 'REGISTRATION_CONFLICT'
  | 'CONCURRENT_REGISTRATION'
  | 'CONFIGURATION_INVALID'
  | 'DEPENDENCY_UNAVAILABLE';

export class BuyerSelfRegistrationError extends Error {
  constructor(
    public readonly reason: BuyerRegistrationFailureReason,
    public readonly status: 400 | 409 | 429 | 503,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(reason);
    this.name = 'BuyerSelfRegistrationError';
  }
}

export function normalizeBuyerSelfRegistrationError(
  error: unknown,
): BuyerSelfRegistrationError {
  if (error instanceof BuyerSelfRegistrationError) return error;
  const message = String(error);
  if (message.includes('invalid_customer_password')
    || message.includes('invalid_wechat_id')
    || message.includes('invalid_registration_request')) {
    return new BuyerSelfRegistrationError('INVALID_REQUEST', 400);
  }
  if (message.includes('UNIQUE constraint failed')
    || message.includes('transaction_assertion_failed')) {
    return new BuyerSelfRegistrationError(
      'CONCURRENT_REGISTRATION',
      409,
    );
  }
  return new BuyerSelfRegistrationError(
    'DEPENDENCY_UNAVAILABLE',
    503,
  );
}

export function buyerSelfRegistrationFailure(
  context: Context<any>,
  error: BuyerSelfRegistrationError,
): Response {
  context.header('Cache-Control', 'no-store');
  if (error.retryAfterSeconds !== null) {
    context.header('Retry-After', String(error.retryAfterSeconds));
  }
  const requestId = String(
    context.get('requestId') ?? crypto.randomUUID(),
  );
  const code: ApiErrorCode = error.status === 400
    ? 'VALIDATION_ERROR'
    : error.status === 429
      ? 'RATE_LIMITED'
      : error.status === 503
        ? 'DEPENDENCY_UNAVAILABLE'
        : 'CONFLICT';
  const message = error.status === 429
    ? '注册尝试过多，请稍后重试'
    : '暂时无法完成注册，请联系客服';
  return context.json(
    apiFailure(code, message, requestId),
    error.status,
  );
}
