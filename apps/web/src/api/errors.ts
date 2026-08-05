export type ErrorCategory =
  | 'AUTHENTICATION' | 'PERMISSION' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION'
  | 'RATE_LIMIT' | 'DEPENDENCY' | 'NETWORK' | 'CANCELED' | 'CONTRACT' | 'UNKNOWN';

export type SafeDetailValue = string | number | boolean;
export type SafeDetails = Readonly<Record<string, SafeDetailValue>>;

export class FrontendApiError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly requestId: string | null,
    readonly category: ErrorCategory,
    readonly retryAfter: number | null = null,
    readonly safeDetails: SafeDetails | null = null,
  ) {
    super(code);
    this.name = 'FrontendApiError';
  }
}

const DETAIL_FIELDS = Object.freeze({
  VALIDATION_ERROR: Object.freeze(['field', 'reason']),
  STATE_CONFLICT: Object.freeze(['reason', 'current_version', 'expected_version']),
  VERSION_CONFLICT: Object.freeze(['reason', 'current_version', 'expected_version']),
  RATE_LIMITED: Object.freeze(['retry_after_seconds']),
} as const satisfies Readonly<Record<string, readonly string[]>>);

export function projectSafeDetails(code: string, details: unknown): SafeDetails | null {
  const allowed = DETAIL_FIELDS[code as keyof typeof DETAIL_FIELDS];
  if (!allowed || details === null || typeof details !== 'object' || Array.isArray(details)) {
    return null;
  }
  const source = details as Record<string, unknown>;
  const result: Record<string, SafeDetailValue> = {};
  for (const field of allowed) {
    const value = source[field];
    if (typeof value === 'string' && value.length <= 200) result[field] = value;
    else if (typeof value === 'boolean') result[field] = value;
    else if (typeof value === 'number' && Number.isSafeInteger(value)) result[field] = value;
  }
  return Object.keys(result).length > 0 ? Object.freeze(result) : null;
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

export function normalizeFrontendControllerError(error: unknown): FrontendApiError {
  if (isFrontendApiError(error)) return error;
  return new FrontendApiError('MALFORMED_RESPONSE', 0, null, 'CONTRACT');
}

export function isCanceledFrontendError(error: unknown): boolean {
  return isFrontendApiError(error) && error.code === 'CANCELED';
}
