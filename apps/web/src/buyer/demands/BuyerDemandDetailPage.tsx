import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { isFrontendApiError } from '../../api/errors';
import { Alert, Button, Card, Checkbox, PageHeader, RequestIdDisplay } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys } from '../queries/keys';
import { formatBps, formatJpy, formatShanghai } from '../shared/format';
import { BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';

export function BuyerDemandDetailPage(): React.JSX.Element {
  const { demandId = '' } = useParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [confirmed, setConfirmed] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: buyerQueryKeys.demand(demandId),
    queryFn: ({ signal }) => buyerApi.demand(client, demandId, signal).then((r) => r.data.demand),
    enabled: demandId.length > 0,
  });
  const tuple = query.data
    ? `${query.data.demand_version}:${query.data.buyer_self_pay_bps}`
    : '';
  useEffect(() => setConfirmed(false), [tuple]);
  const mutation = useMutation({
    mutationFn: () => buyerApi.createReservation(client, demandId, {
      expected_demand_version: query.data!.demand_version,
      accepted_buyer_self_pay_bps: query.data!.buyer_self_pay_bps,
    }, crypto.randomUUID()),
    onSuccess: async (result) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: buyerQueryKeys.demands() }),
        client.invalidateQueries({ queryKey: buyerQueryKeys.reservations() }),
      ]);
      navigate(`/buyer/reservations/${result.data.reservation.reservation_id}`);
    },
    onError: async (error) => {
      setRequestId(isFrontendApiError(error) ? error.requestId : null);
      if (isFrontendApiError(error) && error.httpStatus === 409) {
        setConfirmed(false);
        await query.refetch();
      }
    },
  });

  if (query.isPending) return <BuyerLoading />;
  if (query.isError) return <BuyerQueryError error={query.error} />;
  const demand = query.data;
  return <section className="buyer-page">
    <PageHeader eyebrow="需求详情" title={demand.product_name} description={demand.store_display_name} />
    <Card className="buyer-fact-card">
      <dl className="buyer-facts"><div><dt>评论类型</dt><dd>{demand.task_type}</dd></div>
        <div><dt>参考订单金额</dt><dd>{formatJpy(demand.reference_order_amount_jpy)}</dd></div>
        <div><dt>买家自费比例</dt><dd>{formatBps(demand.buyer_self_pay_bps)}</dd></div>
        <div><dt>预计自费</dt><dd>{formatJpy(demand.estimated_buyer_self_pay_jpy)}</dd></div>
        <div><dt>预计可返本金</dt><dd>{formatJpy(demand.estimated_refundable_principal_jpy)}</dd></div>
        <div><dt>预约截止</dt><dd>{formatShanghai(demand.reservation_deadline)}</dd></div>
        <div><dt>下单截止</dt><dd>{formatShanghai(demand.order_deadline)}</dd></div></dl>
      {demand.buyer_visible_notes ? <p className="buyer-public-note">{demand.buyer_visible_notes}</p> : null}
    </Card>
    <Card className="buyer-confirm-card">
      <h2>确认自费规则</h2><p>提交预约表示您接受当前需求版本和自费比例。事实发生变化时需要重新确认。</p>
      <Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.currentTarget.checked)}
        label={`我确认接受 ${formatBps(demand.buyer_self_pay_bps)} 的买家自费比例`} />
      {mutation.isError ? <Alert tone="danger">{isFrontendApiError(mutation.error) && mutation.error.httpStatus === 409
        ? '需求事实已变化，请检查刷新后的内容并重新确认。'
        : '预约未完成，请稍后重试。'}</Alert> : null}
      <RequestIdDisplay requestId={requestId} />
      <Button disabled={!confirmed} loading={mutation.isPending} loadingLabel="正在预约"
        onClick={() => mutation.mutate()}>确认并预约</Button>
    </Card>
  </section>;
}
