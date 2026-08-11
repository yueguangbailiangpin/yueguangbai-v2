import { QueryClient } from '@tanstack/react-query';
import { retryDelay, shouldRetryQuery } from './retry';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: shouldRetryQuery, retryDelay, staleTime: 0, gcTime: 5 * 60_000 },
    mutations: { retry: false },
  },
});

export const reviewQueryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 0, gcTime: 5 * 60_000 },
    mutations: { retry: false },
  },
});

export const queryKeys = Object.freeze({
  buyer: Object.freeze({ root: ['buyer'] as const, session: ['buyer', 'session'] as const }),
  seller: Object.freeze({ root: ['seller'] as const, session: ['seller', 'session'] as const }),
  staff: Object.freeze({ root: ['staff'] as const, session: ['staff', 'session'] as const }),
});
