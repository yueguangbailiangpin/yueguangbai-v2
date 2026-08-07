import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { Card, PageHeader, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys } from '../queries/keys';
import { formatBps, formatCnyFen, formatDateOnly, formatJpy, formatShanghai } from '../shared/format';
import { BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';

export function BuyerFormalOrderDetailPage(): React.JSX.Element {
  const { formalOrderId = '' } = useParams();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: buyerQueryKeys.formalOrder(formalOrderId),
    queryFn: ({ signal }) => buyerApi.formalOrder(client, formalOrderId, signal).then((r) => r.data.formal_order),
    enabled: formalOrderId.length > 0,
  });
  if (query.isPending) return <BuyerLoading />;
  if (query.isError) return <BuyerQueryError error={query.error} />;
  const item = query.data;
  return <section className="buyer-page"><PageHeader eyebrow="正式订单详情" title={item.product_name}>
    <StatusBadge tone="success">已确认</StatusBadge></PageHeader>
    <Card><dl className="buyer-facts"><div><dt>正式订单号</dt><dd>{item.formal_order_id}</dd></div>
      <div><dt>Amazon 订单号</dt><dd>{item.amazon_order_number}</dd></div>
      <div><dt>Amazon 下单日期</dt><dd>{formatDateOnly(item.amazon_order_date)}</dd></div>
      <div><dt>确认业务日期</dt><dd>{item.confirmed_business_date}</dd></div>
      <div><dt>市场</dt><dd>{item.marketplace}</dd></div><div><dt>评论类型</dt><dd>{item.review_type}</dd></div>
      <div><dt>最终支付</dt><dd>{formatJpy(item.final_paid_jpy)}</dd></div>
      <div><dt>自费比例</dt><dd>{formatBps(item.buyer_self_pay_bps)}</dd></div>
      <div><dt>自费金额</dt><dd>{formatJpy(item.buyer_self_pay_jpy)}</dd></div>
      <div><dt>可返本金</dt><dd>{formatJpy(item.buyer_refundable_principal_jpy)}</dd></div>
      <div><dt>预计 CNY 本金</dt><dd>{formatCnyFen(item.buyer_expected_principal_cny_fen)}</dd></div>
      <div><dt>汇率快照 e8</dt><dd>{item.buyer_exchange_rate_snapshot.cny_per_jpy_e8}</dd></div>
      <div><dt>汇率业务日期</dt><dd>{item.buyer_exchange_rate_snapshot.business_date}</dd></div>
      <div><dt>确认时间</dt><dd>{formatShanghai(item.confirmed_at)}</dd></div></dl></Card>
    <Card><h2>订单资料摘要</h2><dl className="buyer-facts"><div><dt>证据版本</dt><dd>{item.order_evidence_summary.evidence_version_no}</dd></div>
      <div><dt>文件数量</dt><dd>{item.order_evidence_summary.file_count}</dd></div>
      <div><dt>提交时间</dt><dd>{formatShanghai(item.order_evidence_summary.submitted_at)}</dd></div>
      <div><dt>核验时间</dt><dd>{formatShanghai(item.order_evidence_summary.verified_at)}</dd></div></dl></Card>
  </section>;
}
