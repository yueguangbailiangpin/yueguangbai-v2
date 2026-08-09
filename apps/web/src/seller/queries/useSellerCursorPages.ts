import type { QueryKey } from '@tanstack/react-query';
import type { ApiResult } from '../../api/transport';
import { useCursorPages } from '../../api/useCursorPages';

type SellerPage<T> = Readonly<{
  items: readonly T[];
  page: Readonly<{ next_cursor: string | null }>;
}>;

export function useSellerCursorPages<T>(input: Readonly<{
  resetKey: string;
  queryKey: (cursor: string | null) => QueryKey;
  queryFn: (
    cursor: string | null,
    signal: AbortSignal,
  ) => Promise<ApiResult<SellerPage<T>>>;
}>) {
  return useCursorPages<T>({
    resetKey: input.resetKey,
    queryKey: input.queryKey,
    queryFn: async (cursor, signal) => {
      const response = await input.queryFn(cursor, signal);
      return {
        items: response.data.items,
        next_cursor: response.data.page.next_cursor,
      };
    },
  });
}
