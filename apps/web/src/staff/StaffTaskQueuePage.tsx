import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useNavigate } from 'react-router';
import { useCurrentStaffSession } from '../auth/staff/StaffSessionBoundary';
import { staffApi } from './api/client';
import { fenToYuan } from './finance/finance-format';
import type { StaffWorkItem } from './contracts/runtime';
import { staffWorkbenchKeys } from './queries/keys';
import { StaffPanelError } from './shared/StaffPanelError';
import { workTypeLabels } from './work-panels/shared';

const STAFF_FACT_STALE_TIME_MS = 15_000;
const QUEUE_PAGE_LIMIT = 100;

function waitedLabel(createdAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - createdAt) / 60_000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} 小时`;
  return `${Math.floor(hours / 24)} 天`;
}

// Intl.DateTimeFormat 构造昂贵且队列页逐行调用：模块级缓存。
const shanghaiDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function shanghaiDate(epoch: number): string {
  return shanghaiDayFormatter.format(new Date(epoch));
}

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
  weekday: 'short',
});

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

function itemSummary(item: StaffWorkItem): string {
  const parties = [
    item.buyer_customer_id ? `买家 ${item.buyer_customer_id}` : null,
    item.seller_organization_id ? `卖家 ${item.seller_organization_id}` : null,
    item.store_id ? `店铺 ${item.store_id}` : null,
  ].filter(Boolean);
  return parties.length > 0 ? `${item.source_entity_id} · ${parties.join(' · ')}` : item.source_entity_id;
}

function slaBadge(item: StaffWorkItem): React.JSX.Element | null {
  if (item.is_overdue) {
    return <span className="sa-badge sa-badge--danger">已逾期</span>;
  }
  if (item.priority === 'DUE_TODAY') {
    return <span className="sa-badge sa-badge--warning">今日到期</span>;
  }
  if (item.sla_due_at !== null) {
    const hours = Math.round((item.sla_due_at - Date.now()) / 3_600_000);
    if (hours >= 0 && hours <= 48) {
      return <span className="sa-badge sa-badge--outline">{hours} 小时内到期</span>;
    }
  }
  return null;
}

/**
 * 工作台（7F-1 重做）：员工第一眼知道“今天要处理什么”。
 * 布局 = 问候行 + 指标带 + 两栏（待办队列 / 即将超时·异常·最近处理·Owner 摘要）。
 * 不展示公共池、抢任务、获客中心；不做大面积财务 BI。
 */
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
  const queryKey = staffWorkbenchKeys.queue(
    session.staff_id,
    session.authorization_version,
    session.session_version,
    effectiveScopeFingerprint,
    'OPEN',
    null,
    null,
  );
  const openQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      staffApi
        .workItems(client, { status: 'OPEN', workType: null, cursor: null, limit: QUEUE_PAGE_LIMIT }, signal)
        .then((r) => r.data),
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
        .workItems(client, { status: 'COMPLETED', workType: null, cursor: null, limit: QUEUE_PAGE_LIMIT }, signal)
        .then((r) => r.data),
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
      staffApi.workbenchSummary(client, signal).then((r) => r.data),
    retry: false,
    staleTime: STAFF_FACT_STALE_TIME_MS,
  });
  // Owner-only 简化经营摘要（链接到完整经营看板）。
  const ownerSummaryQuery = useQuery({
    queryKey: ['staff', 'admin-dashboard-summary', 'TODAY', session.authorization_version],
    queryFn: ({ signal }) =>
      staffApi.adminDashboardSummary(client, 'TODAY', signal).then((r) => r.data),
    enabled: owner,
    retry: false,
    staleTime: STAFF_FACT_STALE_TIME_MS,
  });
  const openItems = openQuery.data?.work_items ?? [];
  // D-056：任务由固定分配产生，后端只返回当前岗位/站点相关的待办；
  // “我的待办”即其中固定分配给本人的工作项。
  const mine = openItems
    .filter((item) => item.assigned_staff_id === session.staff_id)
    .sort((a, b) => a.created_at - b.created_at);
  const now = Date.now();
  const today = shanghaiDate(now);
  const completedItems = completedQuery.data?.work_items ?? [];
  const completedToday = completedItems.filter(
    (item) =>
      item.completed_at !== null &&
      shanghaiDate(item.completed_at) === today &&
      (owner || item.assigned_staff_id === session.staff_id),
  );
  const dueSoon = mine
    .filter((item) => !item.is_overdue && (item.priority === 'DUE_TODAY' || (item.sla_due_at !== null && item.sla_due_at - now < 48 * 3_600_000)))
    .slice(0, 5);
  const exceptions = openItems.filter((item) => item.is_overdue).slice(0, 5);
  const recent = completedToday.slice(0, 5);

  function open(item: StaffWorkItem): void {
    // 返款待办直达返款工作台（P7b），其余走工作项分发面板。
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
    if (owner) void ownerSummaryQuery.refetch();
  }

  return (
    <div className="sp-workbench-root">
      <div className="sp-hello">
        <div>
          <p className="sp-hello__date">{headingDateFormatter.format(new Date(now))}</p>
          <h2>
            {greeting(now)}，{session.display_name}
          </h2>
          <p className="sp-hello__date">
            今天有 {mine.length} 件固定分配给你的工作，等待最久的排最前。
          </p>
        </div>
        <button type="button" className="sa-btn sa-btn--tonal sa-btn--small" onClick={refresh}>
          刷新
        </button>
      </div>

      {summaryQuery.data ? (
        <section className="sp-metrics" aria-label="工作台指标" data-testid="staff-workbench-metrics">
          <div className="sp-metric">
            <span className="sp-metric__label">我的待处理</span>
            <span className="sp-metric__value">{summaryQuery.data.summary.open_count}</span>
          </div>
          <div className="sp-metric">
            <span className="sp-metric__label">今日到期</span>
            <span className="sp-metric__value sp-metric__value--warning">
              {summaryQuery.data.summary.due_today_count}
            </span>
          </div>
          <div className="sp-metric">
            <span className="sp-metric__label">已逾期</span>
            <span
              className={
                summaryQuery.data.summary.overdue_count > 0
                  ? 'sp-metric__value sp-metric__value--danger'
                  : 'sp-metric__value'
              }
            >
              {summaryQuery.data.summary.overdue_count}
            </span>
          </div>
          <div className="sp-metric">
            <span className="sp-metric__label">异常订单</span>
            <span
              className={
                summaryQuery.data.summary.exception_order_count > 0
                  ? 'sp-metric__value sp-metric__value--danger'
                  : 'sp-metric__value'
              }
            >
              {summaryQuery.data.summary.exception_order_count}
            </span>
          </div>
          {summaryQuery.data.summary.refund_due_today_cny_fen !== null ? (
            <div className="sp-metric">
              <span className="sp-metric__label">今日应处理返款</span>
              <span className="sp-metric__value sp-metric__value--danger">
                {fenToYuan(summaryQuery.data.summary.refund_due_today_cny_fen)}
              </span>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="sp-workbench">
        <div className="sp-workbench__main sp-stack">
          {openQuery.isPending ? (
            <p role="status" className="sp-hello__date">
              正在加载任务队列
            </p>
          ) : openQuery.isError ? (
            <StaffPanelError
              error={openQuery.error}
              retry={() => {
                void openQuery.refetch();
              }}
            />
          ) : mine.length === 0 ? (
            <div className="sa-card">
              <div className="sa-state">
                <h3>暂无待办</h3>
                <p>固定分配给你的工作项会出现在这里。</p>
              </div>
            </div>
          ) : (
            <section className="sa-card sa-card--flush" aria-labelledby="sp-queue-mine">
              <div className="sa-card__header">
                <div>
                  <h3 className="sa-card__title" id="sp-queue-mine">
                    我的待办（{mine.length}）
                  </h3>
                  <p className="sa-card__desc">只显示固定分配给你的事项</p>
                </div>
              </div>
              <div>
                {mine.map((item) => (
                  <div key={item.work_item_id} className="sp-workitem">
                    <div className="sp-workitem__main">
                      <span className="sp-workitem__title">{workTypeLabels[item.work_type]}</span>
                      <span className="sp-workitem__meta">
                        {itemSummary(item)} · 已等待 {waitedLabel(item.created_at, now)}
                      </span>
                    </div>
                    <span className="sp-workitem__sla">{slaBadge(item)}</span>
                    <button
                      type="button"
                      className="sa-btn sa-btn--primary sa-btn--small"
                      onClick={() => open(item)}
                    >
                      去处理
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          {owner ? (
            <details className="sa-card">
              <summary className="sp-summary-trigger">
                全部待办（{openItems.length}）
              </summary>
              {openItems.length === 0 ? (
                <p className="sa-card__desc sp-desc-mt">
                  当前岗位与负责站点范围内暂无工作项。
                </p>
              ) : (
                <div>
                  {openItems
                    .slice()
                    .sort((a, b) => a.created_at - b.created_at)
                    .map((item) => (
                      <div key={item.work_item_id} className="sp-workitem">
                        <div className="sp-workitem__main">
                          <span className="sp-workitem__title">{workTypeLabels[item.work_type]}</span>
                          <span className="sp-workitem__meta">{itemSummary(item)}</span>
                        </div>
                        <span className="sp-workitem__sla">{slaBadge(item)}</span>
                        <button
                          type="button"
                          className="sa-btn sa-btn--ghost sa-btn--small"
                          onClick={() => open(item)}
                        >
                          去处理
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </details>
          ) : null}
          <p className="sp-hello__date">
            队列按当前岗位与负责站点过滤，最多展示最近 {QUEUE_PAGE_LIMIT} 条。
          </p>
        </div>

        <aside className="sp-stack">
          <section className="sa-card sa-card--flush" aria-labelledby="sp-due-soon">
            <div className="sa-card__header">
              <h3 className="sa-card__title" id="sp-due-soon">
                即将超时
              </h3>
            </div>
            <div>
              {dueSoon.length === 0 ? (
                <p className="sa-card__desc sp-inset">
                  48 小时内没有到期的工作项。
                </p>
              ) : (
                dueSoon.map((item) => (
                  <div key={item.work_item_id} className="sp-workitem">
                    <div className="sp-workitem__main">
                      <span className="sp-workitem__title">{workTypeLabels[item.work_type]}</span>
                      <span className="sp-workitem__meta">{itemSummary(item)}</span>
                    </div>
                    <span className="sp-workitem__sla">{slaBadge(item)}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="sa-card sa-card--flush" aria-labelledby="sp-exceptions">
            <div className="sa-card__header">
              <h3 className="sa-card__title" id="sp-exceptions">
                异常工作项
              </h3>
            </div>
            <div>
              {exceptions.length === 0 ? (
                <p className="sa-card__desc sp-inset">
                  当前没有逾期的工作项。
                </p>
              ) : (
                exceptions.map((item) => (
                  <div key={item.work_item_id} className="sp-workitem">
                    <div className="sp-workitem__main">
                      <span className="sp-workitem__title">{workTypeLabels[item.work_type]}</span>
                      <span className="sp-workitem__meta">{itemSummary(item)}</span>
                    </div>
                    <span className="sp-workitem__sla">
                      <span className="sa-badge sa-badge--danger">已逾期</span>
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="sa-card sa-card--flush" aria-labelledby="sp-recent">
            <div className="sa-card__header">
              <h3 className="sa-card__title" id="sp-recent">
                最近处理
              </h3>
            </div>
            <div>
              {recent.length === 0 ? (
                <p className="sa-card__desc sp-inset">
                  今天还没有已完成的工作项。
                </p>
              ) : (
                recent.map((item) => (
                  <div key={item.work_item_id} className="sp-workitem">
                    <div className="sp-workitem__main">
                      <span className="sp-workitem__title">{workTypeLabels[item.work_type]}</span>
                      <span className="sp-workitem__meta">{itemSummary(item)}</span>
                    </div>
                    <span className="sp-workitem__sla">
                      {item.completed_at === null
                        ? ''
                        : `${shanghaiMinuteFormatter.format(new Date(item.completed_at))} 完成`}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          {owner && ownerSummaryQuery.data ? (
            <section className="sa-card sa-card--flush" aria-labelledby="sp-owner-summary">
              <div className="sa-card__header">
                <h3 className="sa-card__title" id="sp-owner-summary">
                  今日经营摘要
                </h3>
                <Link
                  to="/staff/admin-business-dashboard"
                  className="sa-btn sa-btn--ghost sa-btn--small"
                >
                  经营看板
                </Link>
              </div>
              <div className="sp-inset--grid">
                <dl className="sa-defs">
                  <dt>新买家</dt>
                  <dd>{ownerSummaryQuery.data.summary.cards.new_customers_buyer}</dd>
                  <dt>新卖家</dt>
                  <dd>{ownerSummaryQuery.data.summary.cards.new_customers_seller}</dd>
                  <dt>预约</dt>
                  <dd>{ownerSummaryQuery.data.summary.cards.reservations}</dd>
                  <dt>正式订单</dt>
                  <dd>{ownerSummaryQuery.data.summary.cards.formal_orders}</dd>
                  <dt>待处理返款</dt>
                  <dd>{ownerSummaryQuery.data.summary.pending.buyer_refunds}</dd>
                  <dt>待结算批次</dt>
                  <dd>{ownerSummaryQuery.data.summary.pending.seller_settlements}</dd>
                </dl>
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
