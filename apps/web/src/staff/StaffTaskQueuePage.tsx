import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useCurrentStaffSession } from '../auth/staff/StaffSessionBoundary';
import { Button, EmptyState, StatusBadge } from '../ui/primitives';
import { staffApi } from './api/client';
import { fenToYuan } from './finance/finance-format';
import type { StaffWorkItem } from './contracts/runtime';
import { staffWorkbenchKeys } from './queries/keys';
import { StaffPanelError } from './shared/StaffPanelError';
import { workTypeLabels } from './work-panels/shared';

const STAFF_FACT_STALE_TIME_MS = 15_000;
const QUEUE_PAGE_LIMIT = 100;

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'processing' | 'amber' | 'danger' | 'neutral' | 'red';
}): React.JSX.Element {
  return (
    <div className={`staff-metric-card staff-metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function waitedLabel(createdAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - createdAt) / 60_000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} 小时`;
  return `${Math.floor(hours / 24)} 天`;
}

// Intl.DateTimeFormat 构造昂贵且队列页逐行调用：模块级缓存（同
// staff/shared/format.ts 先例），避免每次渲染每行重建。
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

// 标题问候语里的日期（如「2026年8月28日 · 周五」）
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

/** 工作类型 → 圆形图标底色（Material 3 tinted container） */
const WORK_TYPE_TONE: Record<StaffWorkItem['work_type'], string> = {
  BUYER_REFUND_PROCESSING: 'red',
  DEMAND_REVIEW: 'amber',
  RESERVATION_DECISION: 'amber',
  ORDER_EVIDENCE_REVIEW: 'blue',
  REVIEW_DECISION: 'blue',
  ORDER_INSTRUCTION_PUBLISH: 'purple',
  PRODUCT_APPLICATION_REVIEW: 'green',
};

function itemSummary(item: StaffWorkItem): string {
  const parties = [
    item.buyer_customer_id ? `买家 ${item.buyer_customer_id}` : null,
    item.seller_organization_id ? `卖家 ${item.seller_organization_id}` : null,
    item.store_id ? `店铺 ${item.store_id}` : null,
  ].filter(Boolean);
  return parties.length > 0 ? `${item.source_entity_id} · ${parties.join(' · ')}` : item.source_entity_id;
}

/**
 * 工作台首页：只展示固定分配给当前员工的“我的待办”（D-056：无公共池、
 * 无认领、无轮转/兜底；owner 可切到全员视图辅助全局查看）。
 */
export function StaffTaskQueuePage(): React.JSX.Element {
  const client = useQueryClient();
  const session = useCurrentStaffSession();
  const navigate = useNavigate();
  const owner = session.role.code === 'owner';
  const [view, setView] = useState<'mine' | 'all'>('mine');
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
  const openItems = openQuery.data?.work_items ?? [];
  // D-056：任务由固定分配产生，后端只返回当前岗位/站点相关的待办；
  // “我的待办”即其中固定分配给本人的工作项。
  const mine = openItems
    .filter((item) => item.assigned_staff_id === session.staff_id)
    .sort((a, b) => a.created_at - b.created_at);
  const today = shanghaiDate(Date.now());
  const completedToday = (completedQuery.data?.work_items ?? []).filter(
    (item) =>
      item.completed_at !== null &&
      shanghaiDate(item.completed_at) === today &&
      (owner || item.assigned_staff_id === session.staff_id),
  );
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
  }
  const now = Date.now();
  const recommended = mine.slice(0, 3);
  return (
    <main className="staff-task-queue staff-workbench">
      {/* 页首：日期问候 + 统计 + 主操作 */}
      <div className="staff-workbench-heading">
        <div>
          <p>{headingDateFormatter.format(new Date(now))}</p>
          <h1>{`${greeting(now)}，${session.display_name}`}</h1>
          <span>
            今天有 {mine.length} 件固定分配给你的工作，等待最久的排最前。
          </span>
        </div>
        <div className="staff-workbench-heading-actions">
          {owner ? (
            <div className="entry-actions" role="group" aria-label="视图切换">
              <Button
                className={view === 'mine' ? '' : 'secondary'}
                aria-pressed={view === 'mine'}
                onClick={() => setView('mine')}
              >
                我的
              </Button>
              <Button
                className={view === 'all' ? '' : 'secondary'}
                aria-pressed={view === 'all'}
                onClick={() => setView('all')}
              >
                全部
              </Button>
            </div>
          ) : null}
          <Button className="secondary" onClick={refresh}>
            刷新
          </Button>
        </div>
      </div>

      {summaryQuery.data ? (
        <section className="staff-workbench-metrics" aria-label="工作台指标" data-testid="staff-workbench-metrics">
          <MetricCard label="我的待处理" value={String(summaryQuery.data.summary.open_count)} tone="processing" />
          <MetricCard label="今日到期" value={String(summaryQuery.data.summary.due_today_count)} tone="amber" />
          <MetricCard label="已逾期" value={String(summaryQuery.data.summary.overdue_count)} tone={summaryQuery.data.summary.overdue_count > 0 ? 'danger' : 'neutral'} />
          <MetricCard label="异常订单" value={String(summaryQuery.data.summary.exception_order_count)} tone={summaryQuery.data.summary.exception_order_count > 0 ? 'danger' : 'neutral'} />
          {summaryQuery.data.summary.refund_due_today_cny_fen !== null ? (
            <MetricCard
              label="今日应处理返款"
              value={fenToYuan(summaryQuery.data.summary.refund_due_today_cny_fen)}
              tone="red"
            />
          ) : null}
        </section>
      ) : null}

      <div className="staff-workbench-layout">
        <div className="staff-workbench-main">
          {/* 建议先处理：固定分配中最久的三件 */}
          {view === 'mine' && recommended.length > 0 ? (
            <section className="staff-surface staff-workbench-recommended" aria-labelledby="staff-queue-recommended">
              <header className="staff-section-heading">
                <div>
                  <h2 id="staff-queue-recommended">建议先处理</h2>
                  <p>按等待时间排序的优先事项</p>
                </div>
                <StatusBadge tone={openItems.length ? 'processing' : 'neutral'}>{openItems.length}</StatusBadge>
              </header>
              {recommended.map((item) => (
                <article key={item.work_item_id} className="staff-recommended-row">
                  <span className={`staff-round-icon ${WORK_TYPE_TONE[item.work_type]}`} aria-hidden="true">
                    <WorkTypeGlyph type={item.work_type} />
                  </span>
                  <div>
                    <div className="staff-recommended-title">
                      <strong>{workTypeLabels[item.work_type]}</strong>
                      <em className="staff-tone-warn">已等待 {waitedLabel(item.created_at, now)}</em>
                      {item.is_overdue ? (
                        <span className="staff-sla-badge staff-sla-overdue">SLA 已逾期</span>
                      ) : item.priority === 'DUE_TODAY' ? (
                        <span className="staff-sla-badge staff-sla-today">今日到期</span>
                      ) : null}
                    </div>
                    <p>{itemSummary(item)}</p>
                  </div>
                  <Button className="secondary" onClick={() => open(item)}>
                    开始处理
                  </Button>
                </article>
              ))}
            </section>
          ) : null}

          {openQuery.isPending ? (
            <p role="status">正在加载任务队列</p>
          ) : openQuery.isError ? (
            <StaffPanelError
              error={openQuery.error}
              retry={() => {
                void openQuery.refetch();
              }}
            />
          ) : view === 'all' && owner ? (
            <section className="staff-surface" aria-labelledby="staff-queue-all">
              <header className="staff-section-heading">
                <div>
                  <h2 id="staff-queue-all">全部待办（{openItems.length}）</h2>
                  <p>当前岗位与负责站点范围内的全部工作项</p>
                </div>
              </header>
              {openItems.length === 0 ? (
                <EmptyState title="当前没有待办" description="没有符合当前岗位和负责站点的工作项。" />
              ) : (
                <ol className="staff-work-list">
                  {openItems
                    .slice()
                    .sort((a, b) => a.created_at - b.created_at)
                    .map((item) => (
                      <li key={item.work_item_id}>
                        <QueueRow
                          item={item}
                          waited={waitedLabel(item.created_at, now)}
                          mine={item.assigned_staff_id === session.staff_id}
                          onOpen={open}
                        />
                      </li>
                    ))}
                </ol>
              )}
            </section>
          ) : (
            <section className="staff-surface" aria-labelledby="staff-queue-mine">
              <header className="staff-section-heading">
                <div>
                  <h2 id="staff-queue-mine">我的待办（{mine.length}）</h2>
                  <p>只显示固定分配给你的事项</p>
                </div>
              </header>
              {mine.length === 0 ? (
                <EmptyState title="暂无我的待办" description="固定分配给你的工作项会出现在这里。" />
              ) : (
                <ol className="staff-work-list">
                  {mine.map((item) => (
                    <li key={item.work_item_id}>
                      <QueueRow
                        item={item}
                        waited={waitedLabel(item.created_at, now)}
                        mine
                        onOpen={open}
                      />
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          <details className="staff-today-completed staff-surface">
            <summary>
              今日已处理（{completedToday.length}
              {owner ? ' · 全员' : ''}）
            </summary>
            {completedQuery.isError ? (
              <p className="inline-error" role="alert">
                今日已处理暂时无法加载，可稍后展开重试。
              </p>
            ) : completedToday.length === 0 ? (
              <p>今天还没有已完成的工作项。</p>
            ) : (
              <ol className="staff-work-list">
                {completedToday.map((item) => (
                  <li key={item.work_item_id}>
                    <span className="staff-work-item-heading">
                      <strong>{workTypeLabels[item.work_type]}</strong>
                      <small>{itemSummary(item)}</small>
                    </span>
                    <small>
                      {item.completed_at === null
                        ? ''
                        : `${shanghaiMinuteFormatter.format(new Date(item.completed_at))} 完成`}
                    </small>
                  </li>
                ))}
              </ol>
            )}
          </details>

          <p className="staff-queue-footnote">
            队列按当前岗位与负责站点过滤，最多展示最近 {QUEUE_PAGE_LIMIT} 条。
          </p>
        </div>

        {/* 今日概览：仅来自 work-items 接口的真实数字 */}
        <aside className="staff-workbench-side">
          <section className="staff-surface staff-today-overview-card" aria-labelledby="staff-today-overview">
            <header className="staff-section-heading">
              <div>
                <h2 id="staff-today-overview">今日概览</h2>
                <p>截至 {shanghaiMinuteFormatter.format(new Date(now))}</p>
              </div>
            </header>
            <dl>
              <div>
                <dt>我的待办</dt>
                <dd>{mine.length}</dd>
              </div>
              {owner ? (
                <div>
                  <dt>全部待办</dt>
                  <dd>{openItems.length}</dd>
                </div>
              ) : null}
              <div>
                <dt>今日已完成{owner ? '（全员）' : ''}</dt>
                <dd>{completedToday.length}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </main>
  );
}

/** 工作类型的圆形图标底色内的字符标识（不引入新图标依赖） */
function WorkTypeGlyph({ type }: { type: StaffWorkItem['work_type'] }): React.JSX.Element {
  const glyph: Record<StaffWorkItem['work_type'], string> = {
    BUYER_REFUND_PROCESSING: '返',
    DEMAND_REVIEW: '需',
    RESERVATION_DECISION: '约',
    ORDER_INSTRUCTION_PUBLISH: '指',
    ORDER_EVIDENCE_REVIEW: '证',
    REVIEW_DECISION: '评',
    PRODUCT_APPLICATION_REVIEW: '申',
  };
  return <span aria-hidden="true">{glyph[type]}</span>;
}

function QueueRow({
  item,
  waited,
  mine,
  onOpen,
}: {
  item: StaffWorkItem;
  waited: string;
  mine: boolean;
  onOpen: (item: StaffWorkItem) => void;
}): React.JSX.Element {
  return (
    <div className="staff-work-item staff-task-row">
      <span className={`staff-round-icon small ${WORK_TYPE_TONE[item.work_type]}`} aria-hidden="true">
        <WorkTypeGlyph type={item.work_type} />
      </span>
      <span className="staff-work-item-heading">
        <strong>{workTypeLabels[item.work_type]}</strong>
        <StatusBadge tone={mine ? 'warning' : 'neutral'}>
          {mine ? `已等待 ${waited}` : `等待 ${waited}`}
        </StatusBadge>
      </span>
      <span className="staff-work-item-summary">{itemSummary(item)}</span>
      <span className="entry-actions">
        <Button onClick={() => onOpen(item)}>去处理</Button>
      </span>
    </div>
  );
}
