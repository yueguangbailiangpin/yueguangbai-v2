import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { Card, PageHeader, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys } from '../queries/keys';
import { formatCnyFen, formatShanghai } from '../shared/format';
import { BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { BuyerJourney } from '../shared/BuyerJourney';
import { paymentChannelLabel, statusLabel, statusTone } from '../shared/status';
import { startOperation } from '../../api/idempotency';

export function BuyerRefundDetailPage(): React.JSX.Element {
  const { refundId = '' } = useParams(); const client = useQueryClient();
  const query = useQuery({ queryKey: buyerQueryKeys.refund(refundId),
    queryFn: ({ signal }) => buyerApi.refund(client, refundId, signal).then((r) => r.data.refund), enabled: refundId.length > 0 });
  const remind = useMutation({ mutationFn: () => buyerApi.remindRefund(client, refundId, startOperation({}).key).then((r) => r.data), onSuccess: () => query.refetch() });
  if (query.isPending) return <BuyerLoading />; if (query.isError) return <BuyerQueryError error={query.error} />;
  const item = query.data;
  return <section className="buyer-page buyer-flow-page buyer-detail-page buyer-refund-page">
    <BuyerJourney current={item.status === 'PAID' ? 'complete' : null} />
    <PageHeader eyebrow="返款详情" title={item.order.product_name} description="返款只包含商品本金">
      <StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></PageHeader>
    <Card className="buyer-summary-card buyer-refund-summary"><h2>返款信息</h2><dl className="buyer-facts"><div><dt>对应订单</dt><dd>{item.order.formal_order_id}</dd></div><div><dt>Amazon 订单号</dt><dd>{item.order.amazon_order_number}</dd></div>
      <div><dt>返款金额</dt><dd>{formatCnyFen(item.due_amount_cny_fen)}</dd></div><div><dt>净已付</dt><dd>{formatCnyFen(item.net_paid_cny_fen)}</dd></div>
      <div><dt>剩余金额</dt><dd>{formatCnyFen(item.remaining_amount_cny_fen)}</dd></div><div><dt>超额金额</dt><dd>{formatCnyFen(item.overpaid_amount_cny_fen)}</dd></div>
    </dl></Card>
    {item.status === 'DUE' || item.status === 'PARTIALLY_PAID' ? <Card className="buyer-refund-reminder"><h2>催返款</h2>
      {item.reminder.last_reminded_at === null ? <p>如尚未收到返款，可提交一次催办。</p> : <p>已于 {formatShanghai(item.reminder.last_reminded_at)} 催办，本单 24 小时内不能重复催办。</p>}
      <button type="button" disabled={remind.isPending || (item.reminder.next_reminder_at !== null && item.reminder.next_reminder_at > Date.now())} onClick={() => remind.mutate()}>催返款</button>
      {remind.isError ? <p role="alert">催办未提交，请刷新后重试。</p> : null}
    </Card> : null}
    <section aria-labelledby="refund-activity-title"><h2 id="refund-activity-title">付款与冲正</h2>
      {item.activities.length === 0 ? <p>暂无支付活动。</p> : <ol className="refund-activity-list">{item.activities.map((activity) => <li key={activity.activity_id}>
        <Card as="article"><div className="record-card-heading"><strong>{statusLabel(activity.activity_type)}</strong><span>{formatCnyFen(activity.amount_cny_fen)}</span></div>
          <p>{formatShanghai(activity.occurred_at)} · {paymentChannelLabel(activity.payment_channel)}</p>
          <dl className="compact-facts"><div><dt>活动后净已付</dt><dd>{formatCnyFen(activity.balance_after.net_paid_cny_fen)}</dd></div>
            <div><dt>活动后剩余</dt><dd>{formatCnyFen(activity.balance_after.remaining_amount_cny_fen)}</dd></div>
            <div><dt>活动后超额</dt><dd>{formatCnyFen(activity.balance_after.overpaid_amount_cny_fen)}</dd></div></dl>
        </Card></li>)}</ol>}
    </section>
  </section>;
}
