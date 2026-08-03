import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/query-client';

export const CUSTOMER_TRANSPORT_INVALIDATION_GROUP = Object.freeze({
  async clear(client: QueryClient, remainsCurrent: () => boolean = () => true): Promise<void> {
    const cancellations = await Promise.allSettled([
      client.cancelQueries({ queryKey: queryKeys.buyer.root }),
      client.cancelQueries({ queryKey: queryKeys.seller.root }),
    ]);
    if (!remainsCurrent()) return;
    client.removeQueries({ queryKey: queryKeys.buyer.root });
    client.removeQueries({ queryKey: queryKeys.seller.root });
    const failedCancellation = cancellations.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failedCancellation) throw failedCancellation.reason;
  },
});

export async function clearStaffTransport(
  client: QueryClient,
  remainsCurrent: () => boolean = () => true,
): Promise<void> {
  const [cancellation] = await Promise.allSettled([
    client.cancelQueries({ queryKey: queryKeys.staff.root }),
  ]);
  if (!remainsCurrent()) return;
  client.removeQueries({ queryKey: queryKeys.staff.root });
  if (cancellation?.status === 'rejected') throw cancellation.reason;
}
