import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Clock3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { isFrontendApiError } from '../../api/errors';
import { buyerApi } from '../api/client';
import { buyerQueryKeys } from '../queries/keys';
import { formatShanghai } from '../shared/format';
import { BuyerEmpty, BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { Button, Card, PageHeader, RequestIdDisplay, StatusBadge } from '../../ui/primitives';
import { rankBuyerTasks, type BuyerTask } from './tasks';

export function BuyerDashboardPage({ full = false }: { full?: boolean }): React.JSX.Element {
  const client = useQueryClient();
  const evidence = useQuery({
    queryKey: buyerQueryKeys.evidenceListPage({ limit: 8, cursor: null }),
    queryFn: ({ signal }) => buyerApi.evidenceList(client, 'limit=8', signal).then((r) => r.data),
  });
  const evidenceEligible = useQuery({
    queryKey: buyerQueryKeys.evidenceEligiblePage({ limit: 8, cursor: null }),
    queryFn: ({ signal }) => buyerApi.evidenceEligible(client, 'limit=8', signal).then((r) => r.data),
  });
  const reviews = useQuery({
    queryKey: buyerQueryKeys.reviewsPage({ limit: 8, cursor: null }),
    queryFn: ({ signal }) => buyerApi.reviews(client, 'limit=8', signal).then((r) => r.data),
  });
  const reviewEligible = useQuery({
    queryKey: buyerQueryKeys.reviewEligiblePage({ limit: 8, cursor: null }),
    queryFn: ({ signal }) => buyerApi.reviewEligible(client, 'limit=8', signal).then((r) => r.data),
  });
  const refunds = useQuery({
    queryKey: buyerQueryKeys.refundsPage({ limit: 8, cursor: null }),
    queryFn: ({ signal }) => buyerApi.refunds(client, 'limit=8', signal).then((r) => r.data),
  });
  const demands = useQuery({
    queryKey: buyerQueryKeys.demandsPage({ limit: 8, cursor: null }),
    queryFn: ({ signal }) => buyerApi.demands(client, 'limit=8', signal).then((r) => r.data),
  });
  const reservations = useQuery({
    queryKey: buyerQueryKeys.reservationsPage({ limit: 5, cursor: null }),
    queryFn: ({ signal }) => buyerApi.reservations(client, 'limit=5', signal).then((r) => r.data),
  });
  const instructionStates = useQueries({
    queries: (reservations.data?.items ?? []).slice(0, 5).map((reservation) => ({
      queryKey: buyerQueryKeys.instructionState(reservation.reservation_id),
      queryFn: ({ signal }: { signal: AbortSignal }) => buyerApi.instructionState(
        client,
        reservation.reservation_id,
        signal,
      ).then((r) => ({ reservation, state: r.data.order_instruction })),
      enabled: reservation.status === 'APPROVED',
    })),
  });

  const tasks: BuyerTask[] = [];
  for (const item of evidence.data?.items ?? []) {
    if (item.status === 'CHANGES_REQUESTED') tasks.push({
      taskId: `evidence:${item.submission_id}`,
      businessObjectKey: `reservation:${item.reservation.reservation_id}`,
      priority: 1,
      title: '修改订单资料',
      detail: item.public_change_reason ?? item.reservation.product_name,
      href: `/buyer/order-materials/${item.submission_id}`,
      deadline: item.reservation.order_deadline,
    });
    if (item.status === 'PENDING_VERIFICATION') tasks.push({
      taskId: `evidence:${item.submission_id}`,
      businessObjectKey: `reservation:${item.reservation.reservation_id}`,
      priority: 6,
      title: '订单资料审核中',
      detail: item.reservation.product_name,
      href: `/buyer/order-materials/${item.submission_id}`,
      deadline: null,
    });
  }
  for (const item of reviews.data?.items ?? []) {
    if (item.status === 'CHANGES_REQUESTED') tasks.push({
      taskId: `review:${item.review_case_id}`,
      businessObjectKey: `formal-order:${item.order.formal_order_id}`,
      priority: 2,
      title: '修改评论资料',
      detail: item.public_change_reason ?? item.order.product_name,
      href: `/buyer/reviews/${item.review_case_id}`,
      deadline: null,
    });
    if (item.status === 'PENDING_REVIEW') tasks.push({
      taskId: `review:${item.review_case_id}`,
      businessObjectKey: `formal-order:${item.order.formal_order_id}`,
      priority: 6,
      title: '评论审核中',
      detail: item.order.product_name,
      href: `/buyer/reviews/${item.review_case_id}`,
      deadline: null,
    });
  }
  for (const result of instructionStates) {
    if (result.data?.state.status === 'ACTIVE') tasks.push({
      taskId: `instruction:${result.data.reservation.reservation_id}`,
      businessObjectKey: `reservation:${result.data.reservation.reservation_id}`,
      priority: 3,
      title: '查看下单指引',
      detail: result.data.reservation.demand.product_name,
      href: `/buyer/reservations/${result.data.reservation.reservation_id}/instruction`,
      deadline: result.data.state.resubmission_deadline_at
        ?? result.data.state.initial_deadline_at,
    });
  }
  for (const item of evidenceEligible.data?.items ?? []) {
    if (item.allowed_actions.includes('SUBMIT')) tasks.push({
      taskId: `eligible-evidence:${item.reservation_id}`,
      businessObjectKey: `reservation:${item.reservation_id}`,
      priority: 4,
      title: '提交订单资料',
      detail: item.product_name,
      href: `/buyer/order-materials/new?reservation_id=${encodeURIComponent(item.reservation_id)}`,
      deadline: item.order_deadline,
    });
  }
  for (const item of reviewEligible.data?.items ?? []) {
    if (item.allowed_actions.includes('SUBMIT')) tasks.push({
      taskId: `eligible-review:${item.order.formal_order_id}`,
      businessObjectKey: `formal-order:${item.order.formal_order_id}`,
      priority: 5,
      title: '提交评论资料',
      detail: item.order.product_name,
      href: `/buyer/reviews/new?formal_order_id=${encodeURIComponent(item.order.formal_order_id)}`,
      deadline: null,
    });
  }
  for (const item of refunds.data?.items ?? []) {
    if (['DUE', 'PARTIALLY_PAID', 'OVERPAID'].includes(item.status)) tasks.push({
      taskId: `refund:${item.refund_obligation_id}`,
      businessObjectKey: `refund:${item.refund_obligation_id}`,
      priority: 7,
      title: item.status === 'OVERPAID' ? '查看超额返款' : '查看返款进度',
      detail: item.order.product_name,
      href: `/buyer/refunds/${item.refund_obligation_id}`,
      deadline: null,
    });
  }
  for (const item of demands.data?.items ?? []) tasks.push({
    taskId: `demand:${item.demand_id}`,
    businessObjectKey: `demand:${item.demand_id}`,
    priority: 8,
    title: '可预约需求',
    detail: item.product_name,
    href: `/buyer/demands/${item.demand_id}`,
    deadline: item.reservation_deadline,
  });
  const ranked = rankBuyerTasks(tasks);
  const visible = full ? ranked : ranked.slice(0, 5);
  const sources = [
    { name: '订单资料', description: '已提交订单资料暂时无法读取。', query: evidence },
    { name: '可提交订单资料', description: '订单资料提交资格暂时无法读取。', query: evidenceEligible },
    { name: '评论资料', description: '已提交评论资料暂时无法读取。', query: reviews },
    { name: '可提交评论', description: '评论提交资格暂时无法读取。', query: reviewEligible },
    { name: '返款', description: '返款进度暂时无法读取。', query: refunds },
    { name: '需求', description: '可预约需求暂时无法读取。', query: demands },
    { name: '预约', description: '预约与下单指引状态暂时无法读取。', query: reservations },
  ] as const;
  const loading = sources.every((source) => source.query.isPending);
  const failures = sources.filter((source) => source.query.isError);
  const instructionFailures = instructionStates.map((query, index) => ({ query, index }))
    .filter(({ query }) => query.isError);
  const hasMore = sources.some((source) => source.query.data?.next_cursor);

  return <section className="buyer-page buyer-dashboard-page">
    <PageHeader eyebrow="买家工作区" title={full ? '任务' : '首页'}
      description={full ? '按业务优先级查看需要处理的事项。' : '查看接下来最值得处理的事项。'} />
    {loading ? <BuyerLoading label="正在读取下一步" /> : null}
    {failures.map((source) => <Card className="buyer-partial-error" as="div" key={source.name}>
      <StatusBadge tone="warning">{source.name}暂不可用</StatusBadge>
      <p>{source.description}其他可用事项仍会正常显示。</p>
      <RequestIdDisplay requestId={isFrontendApiError(source.query.error) ? source.query.error.requestId : null} />
      <Button className="secondary" onClick={() => { void source.query.refetch(); }}>仅重试此来源</Button>
    </Card>)}
    {instructionFailures.map(({ query: source, index }) => <Card className="buyer-partial-error" as="div" key={`instruction-${index}`}>
      <StatusBadge tone="warning">下单指引状态暂不可用</StatusBadge>
      <p>该预约的指引状态暂时无法读取，其他事项仍会显示。</p>
      <RequestIdDisplay requestId={isFrontendApiError(source.error) ? source.error.requestId : null} />
      <Button className="secondary" onClick={() => { void source.refetch(); }}>仅重试此预约</Button>
    </Card>)}
    {!loading && visible.length === 0
      ? <BuyerEmpty title="暂无需要优先处理的事项" description="您仍可查看需求、订单资料、评论和个人信息。" />
      : <div className="buyer-task-list">{visible.map((task) => <Link
          key={task.taskId}
          className="buyer-task-card"
          to={task.href}
        ><div><strong>{task.title}</strong><p>{task.detail}</p>
          {task.deadline !== null ? <small><Clock3 aria-hidden="true" />截止 {formatShanghai(task.deadline)}</small> : null}
        </div><ArrowRight aria-hidden="true" /></Link>)}</div>}
    {!full && (ranked.length > visible.length || hasMore)
      ? <Link className="button secondary buyer-more-link" to="/buyer/tasks">查看全部</Link>
      : null}
    {full && failures.length === sources.length
      ? <BuyerQueryError error={failures[0]?.query.error} title="任务暂时无法读取" />
      : null}
  </section>;
}
