import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PageHeader, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys } from '../queries/keys';
import { formatShanghai } from '../shared/format';
import { BuyerEmpty, BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { statusLabel, statusTone } from '../shared/status';

export function BuyerReservationsPage(): React.JSX.Element {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: buyerQueryKeys.reservations(),
    queryFn: ({ signal }) => buyerApi.reservations(client, 'limit=20', signal).then((r) => r.data),
  });
  return <section className="buyer-page"><PageHeader eyebrow="预约" title="我的预约" />
    {query.isPending ? <BuyerLoading /> : query.isError ? <BuyerQueryError error={query.error} />
      : query.data.items.length === 0 ? <BuyerEmpty title="暂无预约" description="您可以先查看可预约需求。" />
        : <div className="buyer-card-list">{query.data.items.map((item) => <Link className="buyer-record-card"
            key={item.reservation_id} to={`/buyer/reservations/${item.reservation_id}`}>
            <div className="record-card-heading"><strong>{item.demand.product_name}</strong>
              <StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></div>
            <p>更新于 {formatShanghai(item.updated_at)}</p>
          </Link>)}</div>}
  </section>;
}
