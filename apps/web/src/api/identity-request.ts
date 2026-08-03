import type { QueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { CUSTOMER_TRANSPORT_INVALIDATION_GROUP, clearStaffTransport } from '../auth/customer-transport-invalidation';
import { isFrontendApiError } from './errors';
import { apiRequest, type ApiRequest, type ApiResult } from './transport';

export type RequestIdentity = 'buyer' | 'seller' | 'staff';

export async function identityApiRequest<T extends z.ZodType>(
  identity: RequestIdentity,
  client: QueryClient,
  request: ApiRequest<T>,
): Promise<ApiResult<z.output<T>>> {
  try {
    return await apiRequest(request);
  } catch (error: unknown) {
    if (!(isFrontendApiError(error) && error.httpStatus === 401)) throw error;
    try {
      if (identity === 'staff') await clearStaffTransport(client);
      else await CUSTOMER_TRANSPORT_INVALIDATION_GROUP.clear(client);
    } finally {
      throw error;
    }
  }
}
