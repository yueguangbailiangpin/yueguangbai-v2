import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PageHeader, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys } from '../queries/keys';
import { formatDateOnly, formatJpy, formatShanghai } from '../shared/format';
import { BuyerEmpty, BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { statusLabel, statusTone } from '../shared/status';

export function BuyerOrderMaterialsPage(): React.JSX.Element {
  const client = useQueryClient();
  const [evidence, eligible] = useQueries({ queries: [
    {
      queryKey: buyerQueryKeys.evidenceList(),
      queryFn: ({ signal }: { signal: AbortSignal }) => buyerApi.evidenceList(client, 'limit=20', signal).then((r) => r.data),
    },
    {
      queryKey: buyerQueryKeys.evidenceEligible(),
      queryFn: ({ signal }: { signal: AbortSignal }) => buyerApi.evidenceEligible(client, 'limit=20', signal).then((r) => r.data),
    },
  ] });
  return <section className="buyer-page"><PageHeader eyebrow="订单资料" title="订单资料" description="查看、提交或按审核意见修改资料。" />
    {eligible.data?.items.some((item) => item.allowed_actions.includes('SUBMIT'))
      ? <section aria-labelledby="evidence-ready-title"><h2 id="evidence-ready-title">可提交</h2>
        <div className="buyer-card-list">{eligible.data.items.filter((item) => item.allowed_actions.includes('SUBMIT')).map((item) => <Link
          className="buyer-record-card" key={item.reservation_id}
          to={`/buyer/order-materials/new?reservation_id=${encodeURIComponent(item.reservation_id)}`}>
          <strong>{item.product_name}</strong><p>{item.store_display_name}</p><small>截止 {formatShanghai(item.order_deadline)}</small>
        </Link>)}</div></section> : null}
    <section aria-labelledby="evidence-history-title"><h2 id="evidence-history-title">已提交资料</h2>
      {evidence.isPending ? <BuyerLoading /> : evidence.isError ? <BuyerQueryError error={evidence.error} />
        : evidence.data.items.length === 0 ? <BuyerEmpty title="暂无订单资料" description="符合条件的预约会显示提交入口。" />
          : <div className="buyer-card-list">{evidence.data.items.map((item) => <Link className="buyer-record-card"
            key={item.submission_id} to={`/buyer/order-materials/${item.submission_id}`}>
            <div className="record-card-heading"><strong>{item.reservation.product_name}</strong>
              <StatusBadge tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusBadge></div>
            <dl className="compact-facts"><div><dt>Amazon 下单日期</dt><dd>{formatDateOnly(item.amazon_order_date)}</dd></div>
              <div><dt>最终支付</dt><dd>{formatJpy(item.final_paid_jpy)}</dd></div></dl>
          </Link>)}</div>}
    </section>
  </section>;
}
