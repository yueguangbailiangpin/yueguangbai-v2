import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { PageHeader, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys, cursorQuery } from '../queries/keys';
import { useCursorPages } from '../queries/useCursorPages';
import { formatDateOnly, formatJpy, formatShanghai } from '../shared/format';
import { BuyerPagination } from '../shared/BuyerPagination';
import { BuyerEmpty, BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { BuyerJourney } from '../shared/BuyerJourney';
import { statusLabel, statusTone } from '../shared/status';

export function BuyerOrderMaterialsPage(): React.JSX.Element {
  const client = useQueryClient();
  const evidence = useCursorPages({
    resetKey: 'evidence',
    queryKey: (cursor) => buyerQueryKeys.evidenceListPage({ limit: 20, cursor }),
    queryFn: (cursor, signal) => buyerApi.evidenceList(client, cursorQuery({ limit: 20, cursor }), signal).then((r) => r.data),
  });
  const eligible = useCursorPages({
    resetKey: 'eligible',
    queryKey: (cursor) => buyerQueryKeys.evidenceEligiblePage({ limit: 20, cursor }),
    queryFn: (cursor, signal) => buyerApi.evidenceEligible(client, cursorQuery({ limit: 20, cursor }), signal).then((r) => r.data),
  });
  return <section className="buyer-page buyer-flow-page buyer-list-page">
    <BuyerJourney current="evidence" />
    <PageHeader eyebrow="订单资料阶段" title="订单资料" description="可以查看、提交资料，或根据审核意见修改。" />
    <section className="buyer-work-section buyer-action-section" aria-labelledby="evidence-ready-title"><h2 id="evidence-ready-title">现在可提交</h2>
      {eligible.isInitialPending ? <BuyerLoading label="正在读取可提交的资料" />
        : eligible.initialError ? <BuyerQueryError error={eligible.initialError} title="暂时无法确认能否提交" />
          : <><div className="buyer-card-list">{eligible.items.filter((item) => item.allowed_actions.includes('SUBMIT')).map((item) => <Link
          className="buyer-record-card buyer-stage-card" key={item.reservation_id}
          to={`/buyer/order-materials/new?reservation_id=${encodeURIComponent(item.reservation_id)}`}>
          <strong>{item.product_name}</strong><p>{item.store_display_name}</p><small>截止 {formatShanghai(item.order_deadline)}</small>
        </Link>)}</div><BuyerPagination hasMore={eligible.hasMore} isLoadingMore={eligible.isLoadingMore}
          laterError={eligible.laterError} onLoadMore={eligible.loadMore} onRetry={eligible.retryLater} /></>}
    </section>
    <section className="buyer-work-section" aria-labelledby="evidence-history-title"><h2 id="evidence-history-title">已提交资料</h2>
      {evidence.isInitialPending ? <BuyerLoading /> : evidence.initialError ? <BuyerQueryError error={evidence.initialError} />
        : evidence.items.length === 0 ? <BuyerEmpty title="暂无订单资料" description="符合条件的预约会出现提交入口哦。" />
          : <><div className="buyer-card-list">{evidence.items.map((item) => <Link className="buyer-record-card buyer-stage-card"
            key={item.submission_id} to={`/buyer/order-materials/${item.submission_id}`}>
            <div className="record-card-heading"><strong>{item.reservation.product_name}</strong>
              <StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></div>
            <dl className="compact-facts"><div><dt>Amazon 下单日期</dt><dd>{formatDateOnly(item.amazon_order_date)}</dd></div>
              <div><dt>最终支付金额</dt><dd>{formatJpy(item.final_paid_jpy)}</dd></div></dl>
          </Link>)}</div><BuyerPagination hasMore={evidence.hasMore} isLoadingMore={evidence.isLoadingMore}
            laterError={evidence.laterError} onLoadMore={evidence.loadMore} onRetry={evidence.retryLater} /></>}
    </section>
  </section>;
}
