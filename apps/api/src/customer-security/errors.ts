export type CustomerSecurityErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VERSION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_IN_PROGRESS'
  | 'RATE_LIMITED'
  | 'DEPENDENCY_UNAVAILABLE';

export class CustomerSecurityError extends Error {
  constructor(
    public readonly code: CustomerSecurityErrorCode,
    public readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 503,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(code);
    this.name = 'CustomerSecurityError';
  }
}

export function normalizeCustomerSecurityError(error: unknown): CustomerSecurityError {
  if (error instanceof CustomerSecurityError) return error;
  const code = (error as { code?: unknown })?.code;
  if (code === 'IDEMPOTENCY_CONFLICT') {
    return new CustomerSecurityError('IDEMPOTENCY_CONFLICT', 409);
  }
  if (code === 'REQUEST_IN_PROGRESS') {
    return new CustomerSecurityError('REQUEST_IN_PROGRESS', 409);
  }
  const message = String(error);
  if (message.includes('invalid_customer_password')
    || message.includes('invalid_one_time_token')
    || message.includes('invalid_wechat_id')) {
    return new CustomerSecurityError('VALIDATION_ERROR', 400);
  }
  if (message.includes('UNIQUE constraint failed')
    || message.includes('transaction_assertion_failed')
    || message.includes('invalid_transition')) {
    return new CustomerSecurityError('CONFLICT', 409);
  }
  return new CustomerSecurityError('DEPENDENCY_UNAVAILABLE', 503);
}
