import { useQueries, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, RefreshCw } from 'lucide-react';
import { Link } from 'react-router';
import { Alert, Card, EmptyState, PageHeader, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys } from '../queries/keys';
import { reviewTypeLabel } from '../shared/status';
import { classifyBuyerTasks, type BuyerTask } from './task-classification';

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

  const { urgent, action, system, actionableCount } = classifyBuyerTasks({
    reservations, eligibleEvidence, evidence, eligibleReviews, reviews, refunds,
  }, reviewTypeLabel);
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
