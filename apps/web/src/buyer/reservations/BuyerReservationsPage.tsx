import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PageHeader, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys, cursorQuery } from '../queries/keys';
import { useCursorPages } from '../queries/useCursorPages';
import { BuyerPagination } from '../shared/BuyerPagination';
import { formatShanghai } from '../shared/format';
import { BuyerEmpty, BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { statusLabel, statusTone } from '../shared/status';

export function BuyerReservationsPage(): React.JSX.Element {
  const client = useQueryClient();
  const pages = useCursorPages({ resetKey: 'reservations:20',
    queryKey: (cursor) => buyerQueryKeys.reservationsPage({ limit: 20, cursor }),
    queryFn: (cursor, signal) => buyerApi.reservations(client, cursorQuery({ limit: 20, cursor }), signal).then((r) => r.data) });
  return <section className="buyer-page"><PageHeader eyebrow="预约" title="我的预约" />
    {pages.isInitialPending ? <BuyerLoading /> : pages.initialError ? <BuyerQueryError error={pages.initialError} />
      : pages.items.length === 0 ? <BuyerEmpty title="暂无预约" description="您可以先查看可预约需求。" />
        : <div className="buyer-card-list">{pages.items.map((item) => <Link className="buyer-record-card"
            key={item.reservation_id} to={`/buyer/reservations/${item.reservation_id}`}>
            <div className="record-card-heading"><strong>{item.demand.product_name}</strong>
              <StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></div>
            <p>更新于 {formatShanghai(item.updated_at)}</p>
          </Link>)}</div>}
    <BuyerPagination {...pages} onLoadMore={pages.loadMore} onRetry={pages.retryLater} />
  </section>;
}
