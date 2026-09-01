import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { PageHeader, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys, cursorQuery } from '../queries/keys';
import { useCursorPages } from '../queries/useCursorPages';
import { BuyerPagination } from '../shared/BuyerPagination';
import { formatShanghai } from '../shared/format';
import { BuyerEmpty, BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { BuyerJourney } from '../shared/BuyerJourney';
import { statusLabel, statusTone } from '../shared/status';
import { StageContactCard, STAGE_FOR_ROUTE } from '../shared/StageContactCard';

export function BuyerReservationsPage(): React.JSX.Element {
  const client = useQueryClient();
  const pages = useCursorPages({ resetKey: 'reservations:20',
    queryKey: (cursor) => buyerQueryKeys.reservationsPage({ limit: 20, cursor }),
    queryFn: (cursor, signal) => buyerApi.reservations(client, cursorQuery({ limit: 20, cursor }), signal).then((r) => r.data) });
  return <section className="buyer-page buyer-flow-page buyer-list-page">
    <BuyerJourney current="reserved" />
    <PageHeader eyebrow="产品阶段" title="我的预约" description="查看预约状态和下一步。" />
    <StageContactCard stage={STAGE_FOR_ROUTE['/buyer/reservations']} />
    {pages.isInitialPending ? <BuyerLoading /> : pages.initialError ? <BuyerQueryError error={pages.initialError} />
      : pages.items.length === 0 ? <BuyerEmpty title="暂时还没有预约" description="去看看可预约的产品吧～" />
        : <div className="buyer-card-list">{pages.items.map((item) => <Link className="buyer-record-card buyer-stage-card"
            key={item.reservation_id} to={`/buyer/reservations/${item.reservation_id}`}>
            <div className="record-card-heading"><strong>{item.demand.product_name}</strong>
              <StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></div>
            <p>更新于 {formatShanghai(item.updated_at)}</p>
          </Link>)}</div>}
    <BuyerPagination {...pages} onLoadMore={pages.loadMore} onRetry={pages.retryLater} />
  </section>;
}
