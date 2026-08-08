import { ArrowRight, Clock3, Tag, UsersRound } from 'lucide-react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys, cursorQuery } from '../queries/keys';
import { useCursorPages } from '../queries/useCursorPages';
import { BuyerPagination } from '../shared/BuyerPagination';
import { formatBps, formatJpy, formatShanghai } from '../shared/format';
import { BuyerEmpty, BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { reviewTypeLabel } from '../shared/status';

export function BuyerDemandsPage(): React.JSX.Element {
  const client = useQueryClient();
  const pages = useCursorPages({
    resetKey: 'demands:20',
    queryKey: (cursor) => buyerQueryKeys.demandsPage({ limit: 20, cursor }),
    queryFn: (cursor, signal) => buyerApi.demands(client, cursorQuery({ limit: 20, cursor }), signal).then((r) => r.data),
  });
  return <section className="buyer-page buyer-products-page">
    <PageHeader eyebrow="买家产品" title="当前开放产品" description="查看预约信息后决定是否预约。" />
    {pages.isInitialPending ? <BuyerLoading /> : pages.initialError
      ? <BuyerQueryError error={pages.initialError} />
      : pages.items.length === 0
        ? <BuyerEmpty title="暂无可预约产品" description="有可预约产品时会显示在这里。" />
        : <div className="buyer-product-grid">{pages.items.map((item) => <Link
            className="buyer-product-card buyer-product-card-detailed" key={item.demand_id} to={`/buyer/demands/${item.demand_id}`}>
            <div className="buyer-product-heading"><span className="buyer-product-icon" aria-hidden="true"><Tag /></span>
              <div><p>{item.store_display_name}</p><h2>{item.product_name}</h2></div>
              <StatusBadge tone="processing">{reviewTypeLabel(item.task_type)}</StatusBadge></div>
            <dl className="buyer-product-meta"><div><dt>参考金额</dt><dd>{formatJpy(item.reference_order_amount_jpy)}</dd></div>
              <div><dt>自费比例</dt><dd>{formatBps(item.buyer_self_pay_bps)}</dd></div>
              <div><dt><UsersRound aria-hidden="true" />剩余名额</dt><dd>{item.remaining_quantity}</dd></div>
              <div><dt><Clock3 aria-hidden="true" />预约截止</dt><dd>{formatShanghai(item.reservation_deadline)}</dd></div></dl>
            <span className="buyer-product-action">查看产品 <ArrowRight aria-hidden="true" /></span>
          </Link>)}</div>}
    <BuyerPagination {...pages} onLoadMore={pages.loadMore} onRetry={pages.retryLater} />
  </section>;
}
