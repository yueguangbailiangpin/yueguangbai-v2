import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/query-client';

export const CUSTOMER_TRANSPORT_INVALIDATION_GROUP = Object.freeze({
  async clear(client: QueryClient): Promise<void> {
    await Promise.all([
      client.cancelQueries({ queryKey: queryKeys.buyer.root }),
      client.cancelQueries({ queryKey: queryKeys.seller.root }),
    ]);
    client.removeQueries({ queryKey: queryKeys.buyer.root });
    client.removeQueries({ queryKey: queryKeys.seller.root });
  },
});

export async function clearStaffTransport(client: QueryClient): Promise<void> {
  await client.cancelQueries({ queryKey: queryKeys.staff.root });
  client.removeQueries({ queryKey: queryKeys.staff.root });
}
