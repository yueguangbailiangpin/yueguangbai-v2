import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { useCurrentStaffSession } from '../auth/staff/StaffSessionBoundary';
import { staffApi } from './api/client';
import type { StaffOrderListItem, StaffWorkItem } from './contracts/runtime';
import { fenToYuan } from './finance/finance-format';
import { staffWorkbenchKeys } from './queries/keys';
import { StaffPanelError } from './shared/StaffPanelError';
import { MoonwhiteIcon, type MoonwhiteIconName } from './shared/MoonwhiteIcon';
import { workTypeLabels } from './work-panels/shared';

const STAFF_FACT_STALE_TIME_MS = 15_000;
const QUEUE_PAGE_LIMIT = 100;

const shanghaiDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const shanghaiMinuteFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const headingDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
});

const orderStageLabels: Record<string, string> = {
  BUYER_REFUND: '待返款',
  SELLER_SETTLEMENT: '待结算',
  COMPLETED: '已完成',
};
const workVisuals: Record<
  StaffWorkItem['work_type'],
  { icon: MoonwhiteIconName; tone: 'blue' | 'green' | 'purple' }
> = {
  PRODUCT_APPLICATION_REVIEW: { icon: 'storefront', tone: 'green' },
  DEMAND_REVIEW: { icon: 'groups', tone: 'green' },
  RESERVATION_DECISION: { icon: 'event_available', tone: 'blue' },
  ORDER_INSTRUCTION_PUBLISH: { icon: 'task_alt', tone: 'purple' },
  ORDER_EVIDENCE_REVIEW: { icon: 'receipt_long', tone: 'blue' },
  REVIEW_DECISION: { icon: 'task_alt', tone: 'purple' },
  BUYER_REFUND_PROCESSING: { icon: 'currency_exchange', tone: 'blue' },
};

function shanghaiDate(epoch: number): string {
  return shanghaiDayFormatter.format(new Date(epoch));
}

function greeting(now: number): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour: 'numeric',
      hour12: false,
    }).format(new Date(now)),
  );
  if (hour < 12) return '上午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function slaLabel(item: StaffWorkItem): string {
  if (item.is_overdue) return '已逾期';
  if (item.priority === 'DUE_TODAY') return '今日到期';
  if (item.sla_due_at !== null)
    return `${shanghaiMinuteFormatter.format(new Date(item.sla_due_at))} 前`;
  return '待处理';
}

function riskTone(item: StaffWorkItem): 'red' | 'amber' | 'blue' | 'green' | 'purple' {
  if (item.is_overdue) return 'red';
  if (item.priority === 'DUE_TODAY') return 'amber';
  return workVisuals[item.work_type].tone;
}

function comparePriority(a: StaffWorkItem, b: StaffWorkItem): number {
  const rank = (item: StaffWorkItem): number =>
    item.is_overdue ? 0 : item.priority === 'DUE_TODAY' ? 1 : 2;
  const risk = rank(a) - rank(b);
  return risk !== 0
    ? risk
    : (a.sla_due_at ?? Number.MAX_SAFE_INTEGER) - (b.sla_due_at ?? Number.MAX_SAFE_INTEGER);
}

function businessIdentifier(item: StaffWorkItem): string {
  return `${item.source_entity_id} · ${item.responsible_staff_name ?? item.responsible_role}`;
}

function workTitle(item: StaffWorkItem): string {
  return item.next_action.includes('_') ? workTypeLabels[item.work_type] : item.next_action;
}

function WorkIcon({ item }: { item: StaffWorkItem }): React.JSX.Element {
  const icon = workVisuals[item.work_type].icon;
  return (
    <span className={`sp-round-icon sp-round-icon--${riskTone(item)}`} aria-hidden="true">
      <MoonwhiteIcon name={icon} size={24} />
    </span>
  );
}

function WorkRow({
  item,
  action,
  onOpen,
}: {
  item: StaffWorkItem;
  action: boolean;
  onOpen: (item: StaffWorkItem) => void;
}): React.JSX.Element {
  return (
    <article className={action ? 'sp-priority-row' : 'sp-work-row'}>
      {!action ? (
        <time>
          {item.sla_due_at === null
            ? '待办'
            : shanghaiMinuteFormatter.format(new Date(item.sla_due_at))}
        </time>
      ) : null}
      <WorkIcon item={item} />
      <div className="sp-task-copy">
        <div className="sp-task-title-line">
          <strong>{workTitle(item)}</strong>
          {action ? (
            <em className={`sp-task-sla sp-task-sla--${riskTone(item)}`}>{slaLabel(item)}</em>
          ) : null}
        </div>
        <small>{businessIdentifier(item)}</small>
      </div>
      {action ? (
        <button
          type="button"
          className="sa-btn sa-btn--primary sa-btn--small"
          aria-label="去处理"
          onClick={() => onOpen(item)}
        >
          去处理
        </button>
      ) : (
        <button
          type="button"
          className="sp-row-action"
          aria-label={`打开 ${workTitle(item)}`}
          onClick={() => onOpen(item)}
        >
          <MoonwhiteIcon name="chevron_right" size={20} />
        </button>
      )}
    </article>
  );
}

function RecentOrderRow({ item }: { item: StaffOrderListItem }): React.JSX.Element {
  const stage = orderStageLabels[item.responsibility.stage] ?? item.responsibility.stage;
  const tone =
    item.responsibility.exception_state === 'OPEN'
      ? 'red'
      : item.responsibility.stage === 'COMPLETED'
        ? 'green'
        : 'blue';
  return (
    <Link
      className="sp-recent-order"
      to={`/staff/orders/${encodeURIComponent(item.formal_order_id)}`}
    >
      <span>
        <strong>{item.amazon_order_number}</strong>
        <small>
          {item.buyer_customer_no} · {item.product_name_snapshot}
        </small>
      </span>
      <em className={`sp-task-sla sp-task-sla--${tone}`}>{stage}</em>
    </Link>
  );
}

export function StaffTaskQueuePage(): React.JSX.Element {
  const client = useQueryClient();
  const session = useCurrentStaffSession();
  const navigate = useNavigate();
  const owner = session.role.code === 'owner';
  const effectiveScopeFingerprint = JSON.stringify({
    role: session.role.code,
    permissions: [...session.permissions].sort(),
    data_scope: {
      type: session.data_scope.type,
      marketplaceCodes: [...session.data_scope.marketplaceCodes].sort(),
      buyerCustomerIds: [...session.data_scope.buyerCustomerIds].sort(),
      sellerOrganizationIds: [...session.data_scope.sellerOrganizationIds].sort(),
      teamIds: [...session.data_scope.teamIds].sort(),
    },
  });
  const openQuery = useQuery({
    queryKey: staffWorkbenchKeys.queue(
      session.staff_id,
      session.authorization_version,
      session.session_version,
      effectiveScopeFingerprint,
      'OPEN',
      null,
      null,
    ),
    queryFn: ({ signal }) =>
      staffApi
        .workItems(
          client,
          { status: 'OPEN', workType: null, cursor: null, limit: QUEUE_PAGE_LIMIT },
          signal,
        )
        .then((response) => response.data),
    retry: false,
    staleTime: STAFF_FACT_STALE_TIME_MS,
  });
  const completedQuery = useQuery({
    queryKey: staffWorkbenchKeys.queue(
      session.staff_id,
      session.authorization_version,
      session.session_version,
      effectiveScopeFingerprint,
      'COMPLETED',
      null,
      null,
    ),
    queryFn: ({ signal }) =>
      staffApi
        .workItems(
          client,
          { status: 'COMPLETED', workType: null, cursor: null, limit: QUEUE_PAGE_LIMIT },
          signal,
        )
        .then((response) => response.data),
    retry: false,
    staleTime: STAFF_FACT_STALE_TIME_MS,
  });
  const summaryQuery = useQuery({
    queryKey: staffWorkbenchKeys.metrics(
      session.staff_id,
      session.authorization_version,
      session.session_version,
    ),
    queryFn: ({ signal }) =>
      staffApi.workbenchSummary(client, signal).then((response) => response.data),
    retry: false,
    staleTime: STAFF_FACT_STALE_TIME_MS,
  });
  const recentOrdersQuery = useQuery({
    queryKey: ['staff', 'workbench', 'recent-orders', session.authorization_version],
    queryFn: ({ signal }) =>
      staffApi.formalOrderList(client, '?limit=3', signal).then((response) => response.data),
    retry: false,
    staleTime: STAFF_FACT_STALE_TIME_MS,
  });

  const openItems = openQuery.data?.work_items ?? [];
  const mine = openItems
    .filter((item) => item.assigned_staff_id === session.staff_id)
    .sort(comparePriority);
  const recommended = mine.slice(0, 3);
  const now = Date.now();
  const today = shanghaiDate(now);
  const completedToday = (completedQuery.data?.work_items ?? []).filter(
    (item) =>
      item.completed_at !== null &&
      shanghaiDate(item.completed_at) === today &&
      (owner || item.assigned_staff_id === session.staff_id),
  );
  const summary = summaryQuery.data?.summary;
  const recentOrders = recentOrdersQuery.data?.items.slice(0, 3) ?? [];

  function open(item: StaffWorkItem): void {
    void navigate(
      item.work_type === 'BUYER_REFUND_PROCESSING'
        ? `/staff/refunds/${encodeURIComponent(item.source_entity_id)}`
        : `/staff/work/${encodeURIComponent(item.work_item_id)}`,
    );
  }
  function refresh(): void {
    void openQuery.refetch();
    void completedQuery.refetch();
    void summaryQuery.refetch();
    void recentOrdersQuery.refetch();
  }

  const mayCreateBuyer = session.role.code === 'owner' || session.role.code === 'pre_sales';
  const mayOpenRefunds = session.role.code === 'owner' || session.role.code === 'buyer_refund';

  return (
    <div className="sp-workbench-root">
      <header className="sp-hello">
        <div>
          <p className="sp-hello__date">{headingDateFormatter.format(new Date(now))}</p>
          <h1 className="sp-hello__title">
            {greeting(now)}，{session.display_name}
          </h1>
          <p className="sp-hello__summary">
            今天有 <strong>{mine.length} 件</strong>固定分配给你的工作
            {summary && summary.overdue_count > 0
              ? `，其中 ${summary.overdue_count} 件需要优先处理。`
              : '。'}
          </p>
        </div>
        <div className="sp-hello__actions">
          <Link className="sa-btn sa-btn--tonal" to="/staff/orders">
            <MoonwhiteIcon name="search" size={20} />
            查订单
          </Link>
          {mayCreateBuyer ? (
            <Link className="sa-btn sa-btn--primary" to="/staff/buyer-customers">
              <MoonwhiteIcon name="person_add" size={20} />
              新建买家
            </Link>
          ) : null}
          {mayOpenRefunds && !mayCreateBuyer ? (
            <Link className="sa-btn sa-btn--primary" to="/staff/refunds">
              <MoonwhiteIcon name="currency_exchange" size={20} />
              买家返款
            </Link>
          ) : null}
          <button
            type="button"
            className="sa-btn sa-btn--ghost sp-refresh-action"
            onClick={refresh}
          >
            刷新
          </button>
        </div>
      </header>

      <div className="sp-mobile-actions" aria-label="快捷入口">
        {mayCreateBuyer ? (
          <Link to="/staff/buyer-customers">
            <MoonwhiteIcon name="person_add" size={20} />
            <span>新建买家</span>
          </Link>
        ) : null}
        <Link to="/staff/orders">
          <MoonwhiteIcon name="search" size={20} />
          <span>查订单</span>
        </Link>
        {mayOpenRefunds ? (
          <Link to="/staff/refunds">
            <MoonwhiteIcon name="currency_exchange" size={20} />
            <span>买家返款</span>
          </Link>
        ) : (
          <Link to="/staff/products">
            <MoonwhiteIcon name="event_available" size={20} />
            <span>产品预约</span>
          </Link>
        )}
      </div>

      <div className="sp-workbench">
        <div className="sp-workbench__main">
          <section className="sp-surface sp-recommended" aria-label={`我的待办（${mine.length}）`}>
            <div className="sp-section-heading">
              <div>
                <h2>建议先处理</h2>
                <p>按照超时风险和业务顺序排列</p>
              </div>
              <span className="sp-section-count">共 {mine.length} 件</span>
            </div>
            {openQuery.isPending ? (
              <p role="status" className="sp-surface-state">
                正在加载任务队列
              </p>
            ) : openQuery.isError ? (
              <StaffPanelError error={openQuery.error} retry={() => void openQuery.refetch()} />
            ) : recommended.length === 0 ? (
              <div className="sp-surface-state">
                <h3>暂无待办</h3>
                <p>当前没有固定分配给你的工作。</p>
              </div>
            ) : (
              recommended.map((item) => (
                <WorkRow key={item.work_item_id} item={item} action onOpen={open} />
              ))
            )}
          </section>

          <section className="sp-surface sp-my-work" aria-labelledby="sp-my-work-title">
            <div className="sp-section-heading">
              <div>
                <h2 id="sp-my-work-title">我的工作</h2>
                <p>只显示固定分配给你的事项</p>
              </div>
            </div>
            <div className="sp-material-tabs" aria-label="我的工作摘要">
              <span className="is-active">
                待处理 <b>{mine.length}</b>
              </span>
              <span>
                今天完成 <b>{completedToday.length}</b>
              </span>
            </div>
            {mine.slice(0, 4).map((item) => (
              <WorkRow key={item.work_item_id} item={item} action={false} onOpen={open} />
            ))}
            {completedToday.slice(0, 2).map((item) => (
              <article
                className="sp-work-row sp-work-row--completed"
                key={`completed-${item.work_item_id}`}
              >
                <time>
                  {item.completed_at === null
                    ? '完成'
                    : shanghaiMinuteFormatter.format(new Date(item.completed_at))}
                </time>
                <span className="sp-round-icon sp-round-icon--green" aria-hidden="true">
                  <MoonwhiteIcon name="task_alt" size={20} />
                </span>
                <div className="sp-task-copy">
                  <strong>{workTitle(item)}</strong>
                  <small>{businessIdentifier(item)} · 已完成</small>
                </div>
              </article>
            ))}
            {mine.length === 0 && completedToday.length === 0 ? (
              <p className="sp-surface-state">今天还没有工作记录。</p>
            ) : null}
            {owner ? (
              <details className="sp-all-work">
                <summary>全部待办（{openItems.length}）</summary>
                <p>当前岗位与负责站点范围内共 {openItems.length} 件开放工作项。</p>
                {openItems.map((item) => (
                  <p key={`all-${item.work_item_id}`}>{workTitle(item)}</p>
                ))}
              </details>
            ) : null}
          </section>
        </div>

        <aside className="sp-workbench__side">
          <section className="sp-surface sp-overview-card" aria-labelledby="sp-overview-title">
            <div className="sp-section-heading">
              <div>
                <h2 id="sp-overview-title">今日概览</h2>
                <p>实时工作项摘要</p>
              </div>
            </div>
            {summary ? (
              <dl>
                <div>
                  <dt>待处理</dt>
                  <dd>{summary.open_count}</dd>
                </div>
                <div>
                  <dt>临近超时</dt>
                  <dd className="sp-overview-warn">{summary.due_today_count}</dd>
                </div>
                <div>
                  <dt>今日已完成</dt>
                  <dd>{completedToday.length}</dd>
                </div>
                {summary.refund_due_today_cny_fen !== null ? (
                  <div>
                    <dt>今日应处理返款</dt>
                    <dd>{fenToYuan(summary.refund_due_today_cny_fen)}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="sp-surface-state">概览读取中</p>
            )}
          </section>

          <section className="sp-surface sp-attention" aria-labelledby="sp-attention-title">
            <div className="sp-section-heading">
              <div>
                <h2 id="sp-attention-title">需要关注</h2>
                <p>来自当前权威摘要</p>
              </div>
            </div>
            {summary && summary.overdue_count > 0 ? (
              <Link to="/staff" className="sp-attention-row">
                <span className="sp-round-icon sp-round-icon--red">
                  <MoonwhiteIcon name="warning" size={20} />
                </span>
                <span>
                  <strong>{summary.overdue_count} 件工作已逾期</strong>
                  <small>请优先处理固定分配事项</small>
                </span>
                <MoonwhiteIcon name="chevron_right" size={20} />
              </Link>
            ) : null}
            {summary && summary.exception_order_count > 0 ? (
              <Link to="/staff/orders?exception_state=OPEN" className="sp-attention-row">
                <span className="sp-round-icon sp-round-icon--amber">
                  <MoonwhiteIcon name="receipt_long" size={20} />
                </span>
                <span>
                  <strong>{summary.exception_order_count} 单存在异常</strong>
                  <small>查看订单权威异常状态</small>
                </span>
                <MoonwhiteIcon name="chevron_right" size={20} />
              </Link>
            ) : null}
            {summary && summary.overdue_count === 0 && summary.exception_order_count === 0 ? (
              <p className="sp-surface-state">当前没有异常事项。</p>
            ) : null}
          </section>

          <section className="sp-surface sp-recent-orders" aria-labelledby="sp-recent-orders-title">
            <div className="sp-section-heading">
              <div>
                <h2 id="sp-recent-orders-title">最近订单</h2>
              </div>
              <Link to="/staff/orders">全部</Link>
            </div>
            {recentOrdersQuery.isPending ? (
              <p role="status" className="sp-surface-state">
                正在加载最近订单
              </p>
            ) : null}
            {recentOrders.map((item) => (
              <RecentOrderRow key={item.formal_order_id} item={item} />
            ))}
            {!recentOrdersQuery.isPending && recentOrders.length === 0 ? (
              <p className="sp-surface-state">暂无可见订单。</p>
            ) : null}
          </section>
          <p className="sp-scope-note">
            按当前岗位与负责站点过滤，最多展示最近 {QUEUE_PAGE_LIMIT} 条。
          </p>
        </aside>
      </div>
    </div>
  );
}
