import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { isFrontendApiError } from '../../api/errors';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import { Alert, Card } from '../../ui/primitives';
import { staffApi } from '../api/client';
import { fenToYuan } from '../finance/finance-format';
import { PricingBreakdownCard } from '../shared/PricingBreakdownCard';
import { formatShanghai } from '../shared/format';

type IntegrityData = Awaited<ReturnType<typeof staffApi.orderIntegrity>>['data'];
type IntegrityEvent = IntegrityData['events'][number];
type IntegrityAdjustment = IntegrityData['adjustments'][number];

const OPERATIONAL_EVENT_LABELS: Record<string, string> = {
  PLATFORM_CANCELLED: '平台取消',
  RETURN_REFUND: '退货退款',
  BUSINESS_VOID: '业务作废',
  MANUAL_INVESTIGATION: '人工核查',
  RESOLVED: '已解决',
};

const ADJUSTMENT_SCOPE_LABELS: Record<string, string> = {
  PROJECTED_GROSS_PROFIT: '预估毛利调整',
  COMPLETED_GROSS_PROFIT: '已完成毛利调整',
};

const FINANCE_STATUS_LABELS: Record<string, string> = {
  PROJECTED_ONLY: '预估中（评论未完成）',
  COMPLETED: '已完成',
};

/**
 * Staff order detail (/staff/orders/:orderId): the full-chain timeline
 * (confirmation, review, refund progress, settlement progress, operational
 * events) plus the pricing breakdown card for the Owner.  The backbone is
 * the owner-only internal-finance read; the order-integrity event stream is
 * readable by every active staff member within their marketplace scope, so
 * non-Owner roles still see the timeline skeleton.
 */
export function StaffOrderDetailPage(): React.JSX.Element {
  const session = useCurrentStaffSession();
  const client = useQueryClient();
  const { orderId } = useParams<{ orderId: string }>();
  const canViewFinance =
    session.role.code === 'owner' && session.permissions.includes('FINANCIAL_VIEW');
  const finance = useQuery({
    queryKey: ['staff', 'finance-order-detail', orderId],
    queryFn: ({ signal }) =>
      staffApi
        .financeOrderDetail(client, orderId!, signal)
        .then((response) => response.data),
    enabled: orderId !== undefined && canViewFinance,
    retry: false,
  });
  const integrity = useQuery({
    queryKey: ['staff', 'order-integrity', orderId],
    queryFn: ({ signal }) =>
      staffApi
        .orderIntegrity(client, orderId!, signal)
        .then((response) => response.data),
    enabled: orderId !== undefined,
    retry: false,
  });

  if (orderId === undefined)
    return (
      <main className="staff-order-detail">
        <Alert tone="danger">缺少订单 ID。</Alert>
      </main>
    );
  const position = finance.data?.position ?? null;
  return (
    <main className="staff-order-detail">
      <section aria-labelledby="staff-order-detail-title">
        <p className="eyebrow">买家与订单 · 仅 Staff</p>
        <h2 id="staff-order-detail-title">订单详情</h2>
        {!canViewFinance ? (
          <Alert tone="info">计价与财务金额仅 Owner 可见；以下为订单流程时间线。</Alert>
        ) : null}
      </section>
      {canViewFinance && finance.isError ? (
        <Alert tone="danger">
          计价明细读取失败（{isFrontendApiError(finance.error) ? finance.error.code : 'NETWORK_FAILURE'}）。订单可能不存在。
        </Alert>
      ) : null}
      {position ? (
        <>
          <Card className="customer-visible">
            <h3>订单信息</h3>
            <ul className="staff-order-facts">
              <li>订单号：{position.amazon_order_number}</li>
              <li>ASIN：{position.asin} · {position.product_name}</li>
              <li>评价类型：{position.review_type}</li>
              <li>
                实付金额：¥{Number(position.final_paid_jpy)} JPY · 确认：
                {formatShanghai(position.confirmed_at)}（{position.confirmed_business_date}）
              </li>
              <li>
                财务状态：
                {FINANCE_STATUS_LABELS[position.finance_status] ?? position.finance_status}
                {position.review_approved_at
                  ? ` · 评论通过 ${formatShanghai(position.review_approved_at)}`
                  : ' · 评论未通过'}
              </li>
              <li>
                卖家组织：{position.seller_organization_id} · 店铺：{position.store_id}
              </li>
            </ul>
          </Card>
          <PricingBreakdownCard detail={finance.data!} orderId={orderId} />
          <div className="staff-order-progress-grid">
            <Card className="customer-visible">
              <h3>返款进度（买家）</h3>
              <ul className="staff-order-facts">
                <li>应返：{fenToYuan(finance.data!.buyer_refund.due_cny_fen)}</li>
                <li>已返：{fenToYuan(finance.data!.buyer_refund.net_paid_cny_fen)}</li>
                <li>
                  未返：
                  {fenToYuan(finance.data!.buyer_refund.outstanding_cny_fen)}
                  {Number(finance.data!.buyer_refund.overpaid_cny_fen) > 0
                    ? `（多付 ${fenToYuan(finance.data!.buyer_refund.overpaid_cny_fen)}）`
                    : ''}
                </li>
              </ul>
            </Card>
            <Card className="customer-visible">
              <h3>结算进度（卖家）</h3>
              <ul className="staff-order-facts">
                <li>
                  本金应收：
                  {fenToYuan(finance.data!.seller_payables.principal_due_cny_fen)}
                  （已收 {fenToYuan(finance.data!.seller_payables.principal_collected_cny_fen)}）
                </li>
                <li>
                  服务费应收：
                  {fenToYuan(finance.data!.seller_payables.service_fee_due_cny_fen)}
                  （已收 {fenToYuan(finance.data!.seller_payables.service_fee_collected_cny_fen)}）
                </li>
              </ul>
            </Card>
          </div>
        </>
      ) : null}
      <Card className="customer-visible">
        <h3>全链路时间线</h3>
        {integrity.isPending ? (
          <p role="status">正在读取订单事件</p>
        ) : integrity.isError ? (
          <Alert tone="warning">
            订单事件读取失败（{isFrontendApiError(integrity.error) ? integrity.error.code : 'NETWORK_FAILURE'}），请刷新重试。
          </Alert>
        ) : (
          <OrderTimeline
            events={integrity.data.events}
            adjustments={integrity.data.adjustments}
            reviewApprovedAt={position?.review_approved_at ?? null}
            confirmedAt={position?.confirmed_at ?? null}
            operationalState={integrity.data.operational_state}
          />
        )}
      </Card>
    </main>
  );
}

function OrderTimeline({
  events,
  adjustments,
  reviewApprovedAt,
  confirmedAt,
  operationalState,
}: {
  events: readonly IntegrityEvent[];
  adjustments: readonly IntegrityAdjustment[];
  reviewApprovedAt: number | null;
  confirmedAt: number | null;
  operationalState: string;
}): React.JSX.Element {
  type Node = { at: number; title: string; detail: string | null; tone: 'normal' | 'warning' };
  const nodes: Node[] = [];
  if (confirmedAt !== null)
    nodes.push({ at: confirmedAt, title: '订单确认', detail: '订单资料审核通过，冻结计价配置', tone: 'normal' });
  if (reviewApprovedAt !== null)
    nodes.push({ at: reviewApprovedAt, title: '评论通过', detail: '返款义务生效', tone: 'normal' });
  for (const event of events)
    nodes.push({
      at: event.created_at,
      title: OPERATIONAL_EVENT_LABELS[event.event_type] ?? event.event_type,
      detail: event.reason,
      tone: 'warning',
    });
  for (const adjustment of adjustments)
    nodes.push({
      at: adjustment.created_at,
      title: ADJUSTMENT_SCOPE_LABELS[adjustment.adjustment_scope] ?? adjustment.adjustment_scope,
      detail: `${adjustment.reason}（${fenToYuan(adjustment.amount_cny_fen)}）`,
      tone: 'warning',
    });
  nodes.sort((left, right) => left.at - right.at);
  return (
    <>
      {operationalState !== 'NORMAL' ? (
        <p className="inline-warning">运营状态：{operationalState}</p>
      ) : null}
      {nodes.length === 0 ? (
        <p>暂无事件记录。</p>
      ) : (
        <ol className="staff-order-timeline">
          {nodes.map((node, index) => (
            <li key={`${node.at}-${index}`} className={node.tone === 'warning' ? 'staff-order-timeline-warning' : ''}>
              <strong>{node.title}</strong>
              <time dateTime={new Date(node.at).toISOString()}>{formatShanghai(node.at)}</time>
              {node.detail ? <span>{node.detail}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
