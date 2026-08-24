import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { PageHeader, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys, cursorQuery } from '../queries/keys';
import { useCursorPages } from '../queries/useCursorPages';
import { BuyerPagination } from '../shared/BuyerPagination';
import { formatCnyFen } from '../shared/format';
import { BuyerEmpty, BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { BuyerJourney } from '../shared/BuyerJourney';
import { statusLabel, statusTone } from '../shared/status';

export function BuyerRefundsPage(): React.JSX.Element {
  const client = useQueryClient();
  const pages = useCursorPages({
    resetKey: 'refunds:20',
    queryKey: (cursor) => buyerQueryKeys.refundsPage({ limit: 20, cursor }),
    queryFn: (cursor, signal) =>
      buyerApi.refunds(client, cursorQuery({ limit: 20, cursor }), signal).then((r) => r.data),
  });
  return (
    <section className="buyer-page buyer-flow-page buyer-list-page">
      <BuyerJourney current="refund" />
      <PageHeader
        eyebrow="返款阶段"
        title="返款记录"
        description="查看返款金额和每笔付款记录。"
      />
      {pages.isInitialPending ? (
        <BuyerLoading />
      ) : pages.initialError ? (
        <BuyerQueryError error={pages.initialError} />
      ) : pages.items.length === 0 ? (
        <BuyerEmpty title="暂无返款记录" description="评论审核通过后，返款记录会显示在这里。" />
      ) : (
        <div className="buyer-card-list">
          {pages.items.map((item) => (
            <Link
              className="buyer-record-card buyer-stage-card"
              key={item.refund_obligation_id}
              to={`/buyer/refunds/${item.refund_obligation_id}`}
            >
              <div className="record-card-heading">
                <strong>{item.order.product_name}</strong>
                <StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge>
              </div>
              <dl className="compact-facts">
                <div>
                  <dt>返款金额</dt>
                  <dd>{formatCnyFen(item.due_amount_cny_fen)}</dd>
                </div>
                <div>
                  <dt>剩余</dt>
                  <dd>{formatCnyFen(item.remaining_amount_cny_fen)}</dd>
                </div>
              </dl>
            </Link>
          ))}
        </div>
      )}
      <BuyerPagination {...pages} onLoadMore={pages.loadMore} onRetry={pages.retryLater} />
    </section>
  );
}
