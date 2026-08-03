import { isFrontendApiError } from './errors';

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (!isFrontendApiError(error)) return true;
  return error.category === 'NETWORK';
}

export function retryDelay(_failureCount: number, error: unknown): number {
  if (isFrontendApiError(error) && error.category === 'RATE_LIMIT' && error.retryAfter !== null) return error.retryAfter;
  return 400;
}
