import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buyerApi } from '../api/client';
import { buyerQueryKeys } from '../queries/keys';
import { formatBps, formatJpy, formatShanghai } from '../shared/format';
import { BuyerEmpty, BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { PageHeader, StatusBadge } from '../../ui/primitives';

export function BuyerDemandsPage(): React.JSX.Element {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: buyerQueryKeys.demands(),
    queryFn: ({ signal }) => buyerApi.demands(client, 'limit=20', signal).then((r) => r.data),
  });
  return <section className="buyer-page">
    <PageHeader eyebrow="需求" title="可预约需求" description="确认自费规则后再提交预约。" />
    {query.isPending ? <BuyerLoading /> : query.isError
      ? <BuyerQueryError error={query.error} />
      : query.data.items.length === 0
        ? <BuyerEmpty title="暂无可预约需求" description="有新的公开需求时会显示在这里。" />
        : <div className="buyer-card-list">{query.data.items.map((item) => <Link
            className="buyer-record-card"
            key={item.demand_id}
            to={`/buyer/demands/${item.demand_id}`}
          ><div className="record-card-heading"><strong>{item.product_name}</strong>
            <StatusBadge tone="processing">{item.task_type}</StatusBadge></div>
            <p>{item.store_display_name}</p>
            <dl className="compact-facts"><div><dt>参考金额</dt><dd>{formatJpy(item.reference_order_amount_jpy)}</dd></div>
              <div><dt>自费比例</dt><dd>{formatBps(item.buyer_self_pay_bps)}</dd></div>
              <div><dt>剩余名额</dt><dd>{item.remaining_quantity}</dd></div></dl>
            <small>预约截止 {formatShanghai(item.reservation_deadline)}</small><ArrowRight aria-hidden="true" />
          </Link>)}</div>}
    {query.data?.next_cursor ? <p className="buyer-more-note">还有更多需求，请稍后继续查看。</p> : null}
  </section>;
}
