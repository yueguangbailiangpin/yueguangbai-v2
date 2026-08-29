import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { PageHeader, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys, cursorQuery } from '../queries/keys';
import { useCursorPages } from '../queries/useCursorPages';
import { formatCnyFen, formatShanghai } from '../shared/format';
import { BuyerPagination } from '../shared/BuyerPagination';
import { BuyerEmpty, BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { BuyerJourney } from '../shared/BuyerJourney';
import { reviewTypeLabel, statusLabel, statusTone } from '../shared/status';
import { StageContactCard, STAGE_FOR_ROUTE } from '../shared/StageContactCard';

export function BuyerReviewsPage(): React.JSX.Element {
  const client = useQueryClient();
  const reviews = useCursorPages({
    resetKey: 'reviews',
    queryKey: (cursor) => buyerQueryKeys.reviewsPage({ limit: 20, cursor }),
    queryFn: (cursor, signal) => buyerApi.reviews(client, cursorQuery({ limit: 20, cursor }), signal).then((r) => r.data),
  });
  const eligible = useCursorPages({
    resetKey: 'eligible',
    queryKey: (cursor) => buyerQueryKeys.reviewEligiblePage({ limit: 20, cursor }),
    queryFn: (cursor, signal) => buyerApi.reviewEligible(client, cursorQuery({ limit: 20, cursor }), signal).then((r) => r.data),
  });
  return <section className="buyer-page buyer-flow-page buyer-list-page">
    <BuyerJourney current="review" />
    <PageHeader eyebrow="评论阶段" title="评论资料" description="按订单要求提交 1–3 个评论文件。" />
    <StageContactCard stage={STAGE_FOR_ROUTE['/buyer/reviews']} />
    <section className="buyer-work-section buyer-action-section"><h2>可提交评论</h2>
      {eligible.isInitialPending ? <BuyerLoading label="正在确认能否提交…" />
        : eligible.initialError ? <BuyerQueryError error={eligible.initialError} title="暂时无法确认能否提交评论" />
          : <><div className="buyer-card-list">{eligible.items.filter((item) => item.allowed_actions.includes('SUBMIT')).map((item) => <Link className="buyer-record-card buyer-stage-card"
        key={item.order.formal_order_id} to={`/buyer/reviews/new?formal_order_id=${encodeURIComponent(item.order.formal_order_id)}`}>
        <strong>{item.order.product_name}</strong><p>{reviewTypeLabel(item.order.review_type)}</p>
      </Link>)}</div><BuyerPagination hasMore={eligible.hasMore} isLoadingMore={eligible.isLoadingMore}
        laterError={eligible.laterError} onLoadMore={eligible.loadMore} onRetry={eligible.retryLater} /></>}
    </section>
    <section className="buyer-work-section"><h2>已提交评论</h2>{reviews.isInitialPending ? <BuyerLoading /> : reviews.initialError ? <BuyerQueryError error={reviews.initialError} />
      : reviews.items.length === 0 ? <BuyerEmpty title="暂无评论资料" description="确认订单后会显示可提交入口。" />
        : <><div className="buyer-card-list">{reviews.items.map((item) => <Link className="buyer-record-card buyer-stage-card" key={item.review_case_id} to={`/buyer/reviews/${item.review_case_id}`}>
          <div className="record-card-heading"><strong>{item.order.product_name}</strong><StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></div>
          <p>更新于 {formatShanghai(item.updated_at)}</p>
          {item.buyer_refund_due ? <strong>返款金额 {formatCnyFen(item.buyer_refund_due.amount_cny_fen)}</strong> : null}
        </Link>)}</div><BuyerPagination hasMore={reviews.hasMore} isLoadingMore={reviews.isLoadingMore}
          laterError={reviews.laterError} onLoadMore={reviews.loadMore} onRetry={reviews.retryLater} /></>}</section>
  </section>;
}
