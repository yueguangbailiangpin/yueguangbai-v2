import type { QueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { captureSessionCycle, invalidateSessionCycle } from '../auth/session-invalidation';
import { isFrontendApiError } from './errors';
import { apiRequest, type ApiRequest, type ApiResult } from './transport';

export type RequestIdentity = 'buyer' | 'seller' | 'staff';

export async function identityApiRequest<T extends z.ZodType>(
  identity: RequestIdentity,
  client: QueryClient,
  request: ApiRequest<T>,
): Promise<ApiResult<z.output<T>>> {
  const requestCycle = captureSessionCycle(client, identity);
  try {
    return await apiRequest(request);
  } catch (error: unknown) {
    if (!(isFrontendApiError(error) && error.httpStatus === 401)) throw error;
    try {
      await invalidateSessionCycle(client, identity, requestCycle, error.requestId);
    } finally {
      throw error;
    }
  }
}
