export type ErrorCategory =
  | 'AUTHENTICATION' | 'PERMISSION' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION'
  | 'RATE_LIMIT' | 'DEPENDENCY' | 'NETWORK' | 'CANCELED' | 'CONTRACT' | 'UNKNOWN';

export class FrontendApiError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly requestId: string | null,
    readonly category: ErrorCategory,
    readonly retryAfter: number | null = null,
  ) {
    super(code);
    this.name = 'FrontendApiError';
  }
}

export function categoryForStatus(status: number): ErrorCategory {
  if (status === 401) return 'AUTHENTICATION';
  if (status === 403) return 'PERMISSION';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422 || status === 400) return 'VALIDATION';
  if (status === 429) return 'RATE_LIMIT';
  if (status === 503) return 'DEPENDENCY';
  return 'UNKNOWN';
}

export function isFrontendApiError(value: unknown): value is FrontendApiError {
  return value instanceof FrontendApiError;
}
