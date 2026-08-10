import { useQueries, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, RefreshCw } from 'lucide-react';
import { Link } from 'react-router';
import { Alert, Card, EmptyState, PageHeader, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys } from '../queries/keys';
import { reviewTypeLabel } from '../shared/status';

interface BuyerTask {
  id: string;
  title: string;
  detail: string;
  href: string;
  kind: 'urgent' | 'action' | 'system';
}

export function BuyerTasksPage(): React.JSX.Element {
  const client = useQueryClient();
  const results = useQueries({ queries: [
    { queryKey: buyerQueryKeys.reservationsPage({ limit: 50, cursor: null }), queryFn: ({ signal }) => buyerApi.reservations(client, 'limit=50', signal).then((r) => r.data) },
    { queryKey: buyerQueryKeys.evidenceEligiblePage({ limit: 50, cursor: null }), queryFn: ({ signal }) => buyerApi.evidenceEligible(client, 'limit=50', signal).then((r) => r.data) },
    { queryKey: buyerQueryKeys.evidenceListPage({ limit: 50, cursor: null }), queryFn: ({ signal }) => buyerApi.evidenceList(client, 'limit=50', signal).then((r) => r.data) },
    { queryKey: buyerQueryKeys.reviewEligiblePage({ limit: 50, cursor: null }), queryFn: ({ signal }) => buyerApi.reviewEligible(client, 'limit=50', signal).then((r) => r.data) },
    { queryKey: buyerQueryKeys.reviewsPage({ limit: 50, cursor: null }), queryFn: ({ signal }) => buyerApi.reviews(client, 'limit=50', signal).then((r) => r.data) },
    { queryKey: buyerQueryKeys.refundsPage({ limit: 50, cursor: null }), queryFn: ({ signal }) => buyerApi.refunds(client, 'limit=50', signal).then((r) => r.data) },
  ] });

  const pending = results.some((result) => result.isPending);
  const failed = results.some((result) => result.isError);
  const reservations = results[0]?.data?.items ?? [];
  const eligibleEvidence = results[1]?.data?.items ?? [];
  const evidence = results[2]?.data?.items ?? [];
  const eligibleReviews = results[3]?.data?.items ?? [];
  const reviews = results[4]?.data?.items ?? [];
  const refunds = results[5]?.data?.items ?? [];

  const urgent: BuyerTask[] = [
    ...evidence.filter((item) => item.status === 'CHANGES_REQUESTED').map((item) => ({
      id: `evidence-change-${item.submission_id}`,
      title: '修改订单资料',
      detail: `${item.reservation.product_name}${item.public_change_reason ? ` · ${item.public_change_reason}` : ''}`,
      href: `/buyer/order-materials/${encodeURIComponent(item.submission_id)}`,
      kind: 'urgent' as const,
    })),
    ...reviews.filter((item) => item.status === 'CHANGES_REQUESTED').map((item) => ({
      id: `review-change-${item.review_case_id}`,
      title: '修改评论资料',
      detail: `${item.order.product_name}${item.public_change_reason ? ` · ${item.public_change_reason}` : ''}`,
      href: `/buyer/reviews/${encodeURIComponent(item.review_case_id)}`,
      kind: 'urgent' as const,
    })),
  ];

  const evidenceReservationIds = new Set(eligibleEvidence.map((item) => item.reservation_id));
  const action: BuyerTask[] = [
    ...eligibleEvidence.filter((item) => item.allowed_actions.includes('SUBMIT')).map((item) => ({
      id: `evidence-submit-${item.reservation_id}`,
      title: '提交订单资料',
      detail: `${item.product_name} · ${reviewTypeLabel(item.review_type)}`,
      href: `/buyer/order-materials/new?reservation_id=${encodeURIComponent(item.reservation_id)}`,
      kind: 'action' as const,
    })),
    ...eligibleReviews.filter((item) => item.allowed_actions.includes('SUBMIT')).map((item) => ({
      id: `review-submit-${item.order.formal_order_id}`,
      title: '提交评论资料',
      detail: `${item.order.product_name} · ${reviewTypeLabel(item.order.review_type)}`,
      href: `/buyer/reviews/new?formal_order_id=${encodeURIComponent(item.order.formal_order_id)}`,
      kind: 'action' as const,
    })),
    ...reservations.filter((item) => item.status === 'APPROVED' && !evidenceReservationIds.has(item.reservation_id)).map((item) => ({
      id: `instruction-${item.reservation_id}`,
      title: '查看下单指引',
      detail: item.demand.product_name,
      href: `/buyer/reservations/${encodeURIComponent(item.reservation_id)}/instruction`,
      kind: 'action' as const,
    })),
  ];

  const system: BuyerTask[] = [
    ...reservations.filter((item) => item.status === 'PENDING_REVIEW').map((item) => ({
      id: `reservation-pending-${item.reservation_id}`,
      title: '预约审核中', detail: item.demand.product_name,
      href: `/buyer/reservations/${encodeURIComponent(item.reservation_id)}`,
      kind: 'system' as const,
    })),
    ...evidence.filter((item) => item.status === 'PENDING_VERIFICATION').map((item) => ({
      id: `evidence-pending-${item.submission_id}`,
      title: '订单资料审核中', detail: item.reservation.product_name,
      href: `/buyer/order-materials/${encodeURIComponent(item.submission_id)}`,
      kind: 'system' as const,
    })),
    ...reviews.filter((item) => item.status === 'PENDING_REVIEW').map((item) => ({
      id: `review-pending-${item.review_case_id}`,
      title: '评论审核中', detail: item.order.product_name,
      href: `/buyer/reviews/${encodeURIComponent(item.review_case_id)}`,
      kind: 'system' as const,
    })),
    ...refunds.filter((item) => item.status === 'DUE' || item.status === 'PARTIALLY_PAID').map((item) => ({
      id: `refund-pending-${item.refund_obligation_id}`,
      title: '返款处理中', detail: item.order.product_name,
      href: `/buyer/refunds/${encodeURIComponent(item.refund_obligation_id)}`,
      kind: 'system' as const,
    })),
  ];

  const actionableCount = urgent.length + action.length;
  return <section className="buyer-page buyer-tasks-page">
    <PageHeader eyebrow="买家任务" title={actionableCount > 0 ? `你有 ${actionableCount} 件需要处理` : '当前没有需要处理的事项'}
      description="只把需要你本人操作的事项计入待办；审核和返款处理中会单独显示。" />
    {pending ? <Card className="buyer-task-loading"><RefreshCw aria-hidden="true" /><span>正在整理你的业务任务</span></Card> : null}
    {failed ? <Alert tone="warning">部分任务状态暂时无法加载，请稍后刷新；已成功读取的事项仍可继续处理。</Alert> : null}
    {!pending && urgent.length === 0 && action.length === 0 && system.length === 0
      ? <EmptyState title="暂无任务" description="新的预约、订单资料、评论或返款状态会显示在这里。" />
      : <div className="buyer-task-sections">
        {urgent.length > 0 ? <TaskSection title="紧急" icon={<AlertTriangle aria-hidden="true" />} items={urgent} /> : null}
        {action.length > 0 ? <TaskSection title="今天 / 接下来" icon={<CheckCircle2 aria-hidden="true" />} items={action} /> : null}
        {system.length > 0 ? <TaskSection title="系统处理中" icon={<Clock3 aria-hidden="true" />} items={system} system /> : null}
      </div>}
  </section>;
}

function TaskSection({ title, icon, items, system = false }: {
  title: string; icon: React.ReactNode; items: readonly BuyerTask[]; system?: boolean;
}): React.JSX.Element {
  return <section className={`buyer-task-section${system ? ' buyer-task-system' : ''}`}>
    <header><span>{icon}</span><h2>{title}</h2><StatusBadge tone={system ? 'neutral' : title === '紧急' ? 'warning' : 'processing'}>{items.length}</StatusBadge></header>
    <div className="buyer-task-list">{items.map((item) => <Link className={`buyer-task-row buyer-task-${item.kind}`} key={item.id} to={item.href}>
      <div><strong>{item.title}</strong><p>{item.detail}</p></div><ArrowRight aria-hidden="true" />
    </Link>)}</div>
  </section>;
}
