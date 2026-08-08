import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, Card, Dialog, PageHeader, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { useBuyerMutation } from '../mutations/useBuyerMutation';
import { buyerQueryKeys } from '../queries/keys';
import { formatBps, formatJpy, formatShanghai } from '../shared/format';
import { BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { BuyerMutationRecovery } from '../shared/BuyerMutationRecovery';
import { BuyerJourney } from '../shared/BuyerJourney';
import { reviewTypeLabel, statusLabel, statusTone } from '../shared/status';

export function BuyerReservationDetailPage(): React.JSX.Element {
  const { reservationId = '' } = useParams();
  const client = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const query = useQuery({
    queryKey: buyerQueryKeys.reservation(reservationId),
    queryFn: ({ signal }) => buyerApi.reservation(client, reservationId, signal).then((r) => r.data.reservation),
    enabled: reservationId.length > 0,
  });
  const cancel = useBuyerMutation({
    operation: (body: { expected_version: number }, key, signal) => buyerApi.cancelReservation(client, reservationId, body.expected_version, key, signal),
    onSuccess: async (result) => {
      client.setQueryData(buyerQueryKeys.reservation(reservationId), result.data.reservation);
      await client.invalidateQueries({ queryKey: buyerQueryKeys.reservationsRoot });
      setConfirmCancel(false);
    },
    onError: async () => {},
  });
  if (query.isPending) return <BuyerLoading />;
  if (query.isError) return <BuyerQueryError error={query.error} />;
  const item = query.data;
  return <section className="buyer-page buyer-flow-page buyer-detail-page">
    <BuyerJourney current="products" />
    <PageHeader eyebrow="预约详情" title={item.demand.product_name} description={item.demand.store_display_name}>
      <StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></PageHeader>
    <Card className="buyer-summary-card"><h2>预约信息</h2><dl className="buyer-facts"><div><dt>店铺</dt><dd>{item.demand.store_display_name}</dd></div>
      <div><dt>评论类型</dt><dd>{reviewTypeLabel(item.demand.task_type)}</dd></div>
      <div><dt>参考金额</dt><dd>{formatJpy(item.reference_order_amount_jpy_snapshot)}</dd></div>
      <div><dt>自费比例</dt><dd>{formatBps(item.buyer_self_pay_bps_snapshot)}</dd></div>
      <div><dt>预计自费</dt><dd>{formatJpy(item.estimated_self_pay_jpy_snapshot)}</dd></div>
      <div><dt>订单截止</dt><dd>{formatShanghai(item.order_deadline_snapshot)}</dd></div></dl></Card>
    <div className="buyer-primary-actions buyer-next-actions">
      {item.status === 'APPROVED' ? <Link className="button" to={`/buyer/reservations/${item.reservation_id}/instruction`}>查看下单指引</Link> : null}
      {item.can_cancel ? <Button className="danger" onClick={() => setConfirmCancel(true)}>取消预约</Button> : null}
    </div>
    <Dialog open={confirmCancel} title="取消预约" description="取消后无法从当前预约继续下单。"
      busy={cancel.isPending} onClose={() => setConfirmCancel(false)}>
      <BuyerMutationRecovery mutation={cancel} deterministicMessage="预约事实可能已经变化，请刷新事实后重新提交。"
        onRefresh={() => { void query.refetch(); }} />
      <div className="entry-actions"><Button className="secondary" onClick={() => setConfirmCancel(false)}>返回</Button>
        <Button className="danger" loading={cancel.isPending} onClick={() => cancel.mutate({ expected_version: item.version })}>确认取消</Button></div>
    </Dialog>
  </section>;
}
