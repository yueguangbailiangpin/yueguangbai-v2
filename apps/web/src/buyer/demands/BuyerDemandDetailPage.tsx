import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, Checkbox, PageHeader } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { useBuyerMutation } from '../mutations/useBuyerMutation';
import { buyerQueryKeys } from '../queries/keys';
import { formatBps, formatJpy, formatShanghai } from '../shared/format';
import { BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { BuyerMutationRecovery } from '../shared/BuyerMutationRecovery';

export function BuyerDemandDetailPage(): React.JSX.Element {
  const { demandId = '' } = useParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [confirmed, setConfirmed] = useState(false);
  const query = useQuery({
    queryKey: buyerQueryKeys.demand(demandId),
    queryFn: ({ signal }) => buyerApi.demand(client, demandId, signal).then((r) => r.data.demand),
    enabled: demandId.length > 0,
  });
  const tuple = query.data
    ? `${query.data.demand_version}:${query.data.buyer_self_pay_bps}`
    : '';
  useEffect(() => setConfirmed(false), [tuple]);
  const mutation = useBuyerMutation({
    operation: (body: { expected_demand_version: number; accepted_buyer_self_pay_bps: number }, key, signal) => buyerApi.createReservation(client, demandId, body, key, signal),
    onSuccess: async (result) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: buyerQueryKeys.demandsRoot }),
        client.invalidateQueries({ queryKey: buyerQueryKeys.reservationsRoot }),
      ]);
      navigate(`/buyer/reservations/${result.data.reservation.reservation_id}`);
    },
    onError: async () => { setConfirmed(false); },
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
      <BuyerMutationRecovery mutation={mutation} deterministicMessage="需求事实已变化，请刷新事实后重新确认。"
        onRefresh={() => { void query.refetch(); }} />
      <Button disabled={!confirmed} loading={mutation.isPending} loadingLabel="正在预约"
        onClick={() => mutation.mutate({ expected_demand_version: demand.demand_version,
          accepted_buyer_self_pay_bps: demand.buyer_self_pay_bps })}>确认并预约</Button>
    </Card>
  </section>;
}
