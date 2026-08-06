import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Card, PageHeader, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys } from '../queries/keys';
import { formatCnyFen, formatShanghai } from '../shared/format';
import { BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { statusLabel, statusTone } from '../shared/status';

export function BuyerRefundDetailPage(): React.JSX.Element {
  const { refundId = '' } = useParams(); const client = useQueryClient();
  const query = useQuery({ queryKey: buyerQueryKeys.refund(refundId),
    queryFn: ({ signal }) => buyerApi.refund(client, refundId, signal).then((r) => r.data.refund), enabled: refundId.length > 0 });
  if (query.isPending) return <BuyerLoading />; if (query.isError) return <BuyerQueryError error={query.error} />;
  const item = query.data;
  return <section className="buyer-page"><PageHeader eyebrow="返款详情" title={item.order.product_name}>
    <StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></PageHeader>
    <Card><dl className="buyer-facts"><div><dt>对应订单</dt><dd>{item.order.formal_order_id}</dd></div><div><dt>Amazon 订单号</dt><dd>{item.order.amazon_order_number}</dd></div>
      <div><dt>应返金额</dt><dd>{formatCnyFen(item.due_amount_cny_fen)}</dd></div><div><dt>净已付</dt><dd>{formatCnyFen(item.net_paid_cny_fen)}</dd></div>
      <div><dt>剩余金额</dt><dd>{formatCnyFen(item.remaining_amount_cny_fen)}</dd></div><div><dt>超额金额</dt><dd>{formatCnyFen(item.overpaid_amount_cny_fen)}</dd></div>
      <div><dt>形成返款义务</dt><dd>{formatShanghai(item.became_due_at)}</dd></div><div><dt>首次付款</dt><dd>{formatShanghai(item.first_paid_at)}</dd></div>
      <div><dt>最后付款</dt><dd>{formatShanghai(item.last_paid_at)}</dd></div><div><dt>更新时间</dt><dd>{formatShanghai(item.updated_at)}</dd></div></dl></Card>
    <section aria-labelledby="refund-activity-title"><h2 id="refund-activity-title">支付活动</h2>
      {item.activities.length === 0 ? <p>暂无支付活动。</p> : <ol className="refund-activity-list">{item.activities.map((activity) => <li key={activity.activity_id}>
        <Card as="article"><div className="record-card-heading"><strong>{statusLabel(activity.activity_type)}</strong><span>{formatCnyFen(activity.amount_cny_fen)}</span></div>
          <p>{formatShanghai(activity.occurred_at)} · {activity.payment_channel}</p>
          <dl className="compact-facts"><div><dt>活动后净已付</dt><dd>{formatCnyFen(activity.balance_after.net_paid_cny_fen)}</dd></div>
            <div><dt>活动后剩余</dt><dd>{formatCnyFen(activity.balance_after.remaining_amount_cny_fen)}</dd></div>
            <div><dt>活动后超额</dt><dd>{formatCnyFen(activity.balance_after.overpaid_amount_cny_fen)}</dd></div></dl>
        </Card></li>)}</ol>}
    </section>
  </section>;
}
