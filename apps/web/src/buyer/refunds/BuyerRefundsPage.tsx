import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PageHeader, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys } from '../queries/keys';
import { formatCnyFen, formatShanghai } from '../shared/format';
import { BuyerEmpty, BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { statusLabel, statusTone } from '../shared/status';

export function BuyerRefundsPage(): React.JSX.Element {
  const client = useQueryClient();
  const query = useQuery({ queryKey: buyerQueryKeys.refunds(),
    queryFn: ({ signal }) => buyerApi.refunds(client, 'limit=20', signal).then((r) => r.data) });
  return <section className="buyer-page"><PageHeader eyebrow="返款" title="返款记录" description="只读展示付款、冲正和每次活动后的余额。" />
    {query.isPending ? <BuyerLoading /> : query.isError ? <BuyerQueryError error={query.error} />
      : query.data.items.length === 0 ? <BuyerEmpty title="暂无返款记录" description="评论审核通过并形成返款义务后会显示。" />
        : <div className="buyer-card-list">{query.data.items.map((item) => <Link className="buyer-record-card" key={item.refund_obligation_id} to={`/buyer/refunds/${item.refund_obligation_id}`}>
          <div className="record-card-heading"><strong>{item.order.product_name}</strong><StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></div>
          <dl className="compact-facts"><div><dt>应返</dt><dd>{formatCnyFen(item.due_amount_cny_fen)}</dd></div><div><dt>剩余</dt><dd>{formatCnyFen(item.remaining_amount_cny_fen)}</dd></div></dl>
          <small>更新于 {formatShanghai(item.updated_at)}</small>
        </Link>)}</div>}
  </section>;
}
