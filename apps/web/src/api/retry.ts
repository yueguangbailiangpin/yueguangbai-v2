import { isFrontendApiError } from './errors';

export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (!isFrontendApiError(error)) return true;
  return error.category === 'NETWORK' || error.category === 'DEPENDENCY' || error.category === 'RATE_LIMIT';
}

export function retryDelay(error: unknown): number {
  if (isFrontendApiError(error) && error.retryAfter !== null) return error.retryAfter;
  return 400;
}
