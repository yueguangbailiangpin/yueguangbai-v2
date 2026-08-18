import { useQueries, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, RefreshCw } from 'lucide-react';
import { Link } from 'react-router';
import { Alert, Card, EmptyState, PageHeader, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys, cursorQuery } from '../queries/keys';
import { reviewTypeLabel } from '../shared/status';
import { BUYER_TASK_CURSOR_PAGE_LIMIT, fetchAllCursorPages } from './fetchAllCursorPages';
import { classifyBuyerTasks, type BuyerTask } from './task-classification';

const ACTIVE_EVIDENCE_STATUSES = ['CHANGES_REQUESTED', 'PENDING_VERIFICATION'];
const ACTIVE_REVIEW_STATUSES = ['CHANGES_REQUESTED', 'PENDING_REVIEW'];

export function BuyerTasksPage(): React.JSX.Element {
  const client = useQueryClient();
  const results = useQueries({ queries: [
    { queryKey: buyerQueryKeys.reservationsPage({ limit: BUYER_TASK_CURSOR_PAGE_LIMIT, cursor: null }), queryFn: ({ signal }) => fetchAllCursorPages({ source: 'reservations', signal, fetchPage: (cursor) => buyerApi.reservations(client, cursorQuery({ limit: BUYER_TASK_CURSOR_PAGE_LIMIT, cursor }), signal).then((r) => r.data), itemKey: (item) => `reservation:${item.reservation_id}` }) },
    { queryKey: buyerQueryKeys.evidenceEligiblePage({ limit: BUYER_TASK_CURSOR_PAGE_LIMIT, cursor: null }), queryFn: ({ signal }) => fetchAllCursorPages({ source: 'eligible order evidence', signal, fetchPage: (cursor) => buyerApi.evidenceEligible(client, cursorQuery({ limit: BUYER_TASK_CURSOR_PAGE_LIMIT, cursor }), signal).then((r) => r.data), itemKey: (item) => `eligible-evidence-reservation:${item.reservation_id}` }) },
    { queryKey: buyerQueryKeys.evidenceListPage({ limit: BUYER_TASK_CURSOR_PAGE_LIMIT, cursor: null, status: ACTIVE_EVIDENCE_STATUSES }), queryFn: ({ signal }) => fetchAllCursorPages({ source: 'order evidence', signal, fetchPage: (cursor) => buyerApi.evidenceList(client, cursorQuery({ limit: BUYER_TASK_CURSOR_PAGE_LIMIT, cursor, status: ACTIVE_EVIDENCE_STATUSES }), signal).then((r) => r.data), itemKey: (item) => `order-evidence:${item.submission_id}` }) },
    { queryKey: buyerQueryKeys.reviewEligiblePage({ limit: BUYER_TASK_CURSOR_PAGE_LIMIT, cursor: null }), queryFn: ({ signal }) => fetchAllCursorPages({ source: 'eligible reviews', signal, fetchPage: (cursor) => buyerApi.reviewEligible(client, cursorQuery({ limit: BUYER_TASK_CURSOR_PAGE_LIMIT, cursor }), signal).then((r) => r.data), itemKey: (item) => `eligible-review-order:${item.order.formal_order_id}` }) },
    { queryKey: buyerQueryKeys.reviewsPage({ limit: BUYER_TASK_CURSOR_PAGE_LIMIT, cursor: null, status: ACTIVE_REVIEW_STATUSES }), queryFn: ({ signal }) => fetchAllCursorPages({ source: 'reviews', signal, fetchPage: (cursor) => buyerApi.reviews(client, cursorQuery({ limit: BUYER_TASK_CURSOR_PAGE_LIMIT, cursor, status: ACTIVE_REVIEW_STATUSES }), signal).then((r) => r.data), itemKey: (item) => `review:${item.review_case_id}` }) },
    { queryKey: buyerQueryKeys.refundsPage({ limit: BUYER_TASK_CURSOR_PAGE_LIMIT, cursor: null, outstandingOnly: true }), queryFn: ({ signal }) => fetchAllCursorPages({ source: 'refunds', signal, fetchPage: (cursor) => buyerApi.refunds(client, cursorQuery({ limit: BUYER_TASK_CURSOR_PAGE_LIMIT, cursor, outstandingOnly: true }), signal).then((r) => r.data), itemKey: (item) => `refund:${item.refund_obligation_id}` }) },
  ] });

  const pending = results.some((result) => result.isPending);
  const failed = results.some((result) => result.isError);
  const reservations = results[0]?.data?.items ?? [];
  const eligibleEvidence = results[1]?.data?.items ?? [];
  const evidence = results[2]?.data?.items ?? [];
  const eligibleReviews = results[3]?.data?.items ?? [];
  const reviews = results[4]?.data?.items ?? [];
  const refunds = results[5]?.data?.items ?? [];

  const { urgent, action, system, actionableCount } = classifyBuyerTasks({
    reservations, eligibleEvidence, evidence, eligibleReviews, reviews, refunds,
  }, reviewTypeLabel);
  const title = failed ? '任务状态暂时无法完整读取' : actionableCount > 0 ? `您有 ${actionableCount} 件待办事项` : '暂时没有待办事项，休息一下～';
  return <section className="buyer-page buyer-tasks-page">
    <PageHeader eyebrow="买家任务" title={title}
      description="待办只统计您需要亲手操作的事情；审核中或返款中的项目会单独列出来。" />
    {pending ? <Card className="buyer-task-loading"><RefreshCw aria-hidden="true" /><span>正在整理您的任务…</span></Card> : null}
    {failed ? <Alert tone="warning">部分任务状态暂时无法加载，请稍后刷新；已成功读取的事项仍可继续处理。</Alert> : null}
    {!pending && !failed && urgent.length === 0 && action.length === 0 && system.length === 0
      ? <EmptyState title="暂无任务" description="新的预约、订单资料、评论或返款状态会出现在这里哦。" />
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
