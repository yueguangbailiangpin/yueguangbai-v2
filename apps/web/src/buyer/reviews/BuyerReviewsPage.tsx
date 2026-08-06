import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PageHeader, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys } from '../queries/keys';
import { formatCnyFen, formatShanghai } from '../shared/format';
import { BuyerEmpty, BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { statusLabel, statusTone } from '../shared/status';

export function BuyerReviewsPage(): React.JSX.Element {
  const client = useQueryClient();
  const [reviews, eligible] = useQueries({ queries: [
    { queryKey: buyerQueryKeys.reviews(), queryFn: ({ signal }: { signal: AbortSignal }) => buyerApi.reviews(client, 'limit=20', signal).then((r) => r.data) },
    { queryKey: buyerQueryKeys.reviewEligible(), queryFn: ({ signal }: { signal: AbortSignal }) => buyerApi.reviewEligible(client, 'limit=20', signal).then((r) => r.data) },
  ] });
  return <section className="buyer-page"><PageHeader eyebrow="评论" title="评论资料" description="按正式订单要求提交 1–3 个已验证文件。" />
    {eligible.data?.items.some((item) => item.allowed_actions.includes('SUBMIT')) ? <section><h2>可提交评论</h2>
      <div className="buyer-card-list">{eligible.data.items.filter((item) => item.allowed_actions.includes('SUBMIT')).map((item) => <Link className="buyer-record-card"
        key={item.order.formal_order_id} to={`/buyer/reviews/new?formal_order_id=${encodeURIComponent(item.order.formal_order_id)}`}>
        <strong>{item.order.product_name}</strong><p>{item.order.review_type}</p>
      </Link>)}</div></section> : null}
    <section><h2>已提交评论</h2>{reviews.isPending ? <BuyerLoading /> : reviews.isError ? <BuyerQueryError error={reviews.error} />
      : reviews.data.items.length === 0 ? <BuyerEmpty title="暂无评论资料" description="确认订单后会显示可提交入口。" />
        : <div className="buyer-card-list">{reviews.data.items.map((item) => <Link className="buyer-record-card" key={item.review_case_id} to={`/buyer/reviews/${item.review_case_id}`}>
          <div className="record-card-heading"><strong>{item.order.product_name}</strong><StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></div>
          <p>更新于 {formatShanghai(item.updated_at)}</p>
          {item.buyer_refund_due ? <strong>应返 {formatCnyFen(item.buyer_refund_due.amount_cny_fen)}</strong> : null}
        </Link>)}</div>}</section>
  </section>;
}
