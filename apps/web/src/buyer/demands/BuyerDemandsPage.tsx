import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys, cursorQuery } from '../queries/keys';
import { useCursorPages } from '../queries/useCursorPages';
import { BuyerPagination } from '../shared/BuyerPagination';
import { formatBps, formatJpy, formatShanghai } from '../shared/format';
import { BuyerEmpty, BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';

export function BuyerDemandsPage(): React.JSX.Element {
  const client = useQueryClient();
  const pages = useCursorPages({
    resetKey: 'demands:20',
    queryKey: (cursor) => buyerQueryKeys.demandsPage({ limit: 20, cursor }),
    queryFn: (cursor, signal) => buyerApi.demands(client, cursorQuery({ limit: 20, cursor }), signal).then((r) => r.data),
  });
  return <section className="buyer-page">
    <PageHeader eyebrow="需求" title="可预约需求" description="确认自费规则后再提交预约。" />
    {pages.isInitialPending ? <BuyerLoading /> : pages.initialError
      ? <BuyerQueryError error={pages.initialError} />
      : pages.items.length === 0
        ? <BuyerEmpty title="暂无可预约需求" description="有新的公开需求时会显示在这里。" />
        : <div className="buyer-card-list">{pages.items.map((item) => <Link
            className="buyer-record-card" key={item.demand_id} to={`/buyer/demands/${item.demand_id}`}>
            <div className="record-card-heading"><strong>{item.product_name}</strong>
              <StatusBadge tone="processing">{item.task_type}</StatusBadge></div>
            <p>{item.store_display_name}</p>
            <dl className="compact-facts"><div><dt>参考金额</dt><dd>{formatJpy(item.reference_order_amount_jpy)}</dd></div>
              <div><dt>自费比例</dt><dd>{formatBps(item.buyer_self_pay_bps)}</dd></div>
              <div><dt>剩余名额</dt><dd>{item.remaining_quantity}</dd></div></dl>
            <small>预约截止 {formatShanghai(item.reservation_deadline)}</small><ArrowRight aria-hidden="true" />
          </Link>)}</div>}
    <BuyerPagination {...pages} onLoadMore={pages.loadMore} onRetry={pages.retryLater} />
  </section>;
}
