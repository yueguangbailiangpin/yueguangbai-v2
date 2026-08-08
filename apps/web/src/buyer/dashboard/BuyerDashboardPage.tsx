import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Clock3 } from 'lucide-react';
import { Link } from 'react-router';
import { buyerApi } from '../api/client';
import { buyerQueryKeys, cursorQuery } from '../queries/keys';
import { formatShanghai } from '../shared/format';
import { BuyerEmpty, BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { PageHeader } from '../../ui/primitives';
import { BuyerPagination } from '../shared/BuyerPagination';
import { useCursorPages } from '../queries/useCursorPages';

export function BuyerDashboardPage(): React.JSX.Element {
  const client = useQueryClient();
  const pages = useCursorPages({
    resetKey: 'products:20',
    queryKey: (cursor) => buyerQueryKeys.demandsPage({ limit: 20, cursor }),
    queryFn: (cursor, signal) => buyerApi.demands(
      client,
      cursorQuery({ limit: 20, cursor }),
      signal,
    ).then((result) => result.data),
  });

  return <section className="buyer-page buyer-dashboard-page">
    <PageHeader title="产品" description="仅显示当前可预约的产品。" />
    {pages.isInitialPending ? <BuyerLoading label="正在读取产品" /> : null}
    {pages.initialError ? <BuyerQueryError error={pages.initialError} title="产品暂时无法读取" /> : null}
    {!pages.isInitialPending && !pages.initialError && pages.items.length === 0
      ? <BuyerEmpty title="暂无可预约产品" description="有可预约产品时会显示在这里。" />
      : <div className="buyer-task-list">{pages.items.map((product) => <Link
          key={product.demand_id}
          className="buyer-task-card"
          to={`/buyer/demands/${product.demand_id}`}
        ><div><strong>{product.product_name}</strong><p>{product.store_display_name}</p>
          <small><Clock3 aria-hidden="true" />预约截止 {formatShanghai(product.reservation_deadline)}</small>
        </div><ArrowRight aria-hidden="true" /></Link>)}</div>}
    {!pages.isInitialPending && !pages.initialError ? <BuyerPagination {...pages} onLoadMore={pages.loadMore} onRetry={pages.retryLater} /> : null}
  </section>;
}
