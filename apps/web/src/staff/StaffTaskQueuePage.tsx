import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useCurrentStaffSession } from '../auth/staff/StaffSessionBoundary';
import { Button, EmptyState, StatusBadge } from '../ui/primitives';
import { staffApi } from './api/client';
import type { StaffWorkItem } from './contracts/runtime';
import { staffWorkbenchKeys } from './queries/keys';
import { StaffPanelError } from './shared/StaffPanelError';
import { workTypeLabels } from './work-panels/shared';

const STAFF_FACT_STALE_TIME_MS = 15_000;
const QUEUE_PAGE_LIMIT = 100;
const CLAIM_STORAGE_KEY = 'ygb-staff-claimed-work-items';

/**
 * 第一批过渡：后端尚未提供工作项“认领”写接口（V1 队列只读，
 * assigned_staff_id 由 assignment-service 维护），认领先落在本浏览器，
 * 用于验证两段式任务流的方向。第二批上线返款工作台时一并决策
 * 服务端认领（新增 API 需 255→N 路由守卫双写）或维持本地标记。
 */
function readClaimedIds(staffId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(CLAIM_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const list = Array.isArray(parsed[staffId]) ? (parsed[staffId] as unknown[]) : [];
    return new Set(list.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

function writeClaimedIds(staffId: string, ids: Set<string>): void {
  try {
    window.localStorage.setItem(CLAIM_STORAGE_KEY, JSON.stringify({ [staffId]: [...ids] }));
  } catch {
    // 本地认领是尽力而为的过渡状态；存储不可用时功能降级为仅本次会话。
  }
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

function itemSummary(item: StaffWorkItem): string {
  const parties = [
    item.buyer_customer_id ? `买家 ${item.buyer_customer_id}` : null,
    item.seller_organization_id ? `卖家 ${item.seller_organization_id}` : null,
    item.store_id ? `店铺 ${item.store_id}` : null,
  ].filter(Boolean);
  return parties.length > 0 ? `${item.source_entity_id} · ${parties.join(' · ')}` : item.source_entity_id;
}

/** 首页任务队列（P10 两段式）：上半“我的待办”，下半“可认领”公共池。 */
export function StaffTaskQueuePage(): React.JSX.Element {
  const client = useQueryClient();
  const session = useCurrentStaffSession();
  const navigate = useNavigate();
  const owner = session.role.code === 'owner';
  const [view, setView] = useState<'mine' | 'all'>('mine');
  const [claimedVersion, setClaimedVersion] = useState(0);
  const claimedIds = useMemo(
    () => readClaimedIds(session.staff_id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session.staff_id, claimedVersion],
  );
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
  const openItems = openQuery.data?.work_items ?? [];
  const mine = openItems
    .filter((item) => item.assigned_staff_id === session.staff_id || claimedIds.has(item.work_item_id))
    .sort((a, b) => a.created_at - b.created_at);
  const claimable = openItems
    .filter(
      (item) =>
        item.assigned_staff_id !== session.staff_id && !claimedIds.has(item.work_item_id),
    )
    .sort((a, b) => a.created_at - b.created_at);
  const claimableByType = new Map<StaffWorkItem['work_type'], StaffWorkItem[]>();
  for (const item of claimable) {
    const list = claimableByType.get(item.work_type) ?? [];
    list.push(item);
    claimableByType.set(item.work_type, list);
  }
  const today = shanghaiDate(Date.now());
  const completedToday = (completedQuery.data?.work_items ?? []).filter(
    (item) =>
      item.completed_at !== null &&
      shanghaiDate(item.completed_at) === today &&
      (owner || item.assigned_staff_id === session.staff_id),
  );
  function claim(item: StaffWorkItem): void {
    const next = new Set(claimedIds);
    next.add(item.work_item_id);
    writeClaimedIds(session.staff_id, next);
    setClaimedVersion((version) => version + 1);
  }
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
  return (
    <main className="staff-task-queue">
      <div className="pane-heading">
        <div>
          <h2>任务队列</h2>
          <p>上半是我的待办，下半是可认领的公共池；等待最久的排最前。</p>
        </div>
        <StatusBadge tone={openItems.length ? 'processing' : 'neutral'}>{openItems.length}</StatusBadge>
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
      </div>
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
        <section aria-labelledby="staff-queue-all">
          <h3 id="staff-queue-all">全部待办（{openItems.length}）</h3>
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
                      waited={waitedLabel(item.created_at, Date.now())}
                      mine={item.assigned_staff_id === session.staff_id || claimedIds.has(item.work_item_id)}
                      onOpen={open}
                    />
                  </li>
                ))}
            </ol>
          )}
        </section>
      ) : (
        <>
          <section aria-labelledby="staff-queue-mine">
            <h3 id="staff-queue-mine">我的待办（{mine.length}）</h3>
            {mine.length === 0 ? (
              <EmptyState title="暂无我的待办" description="分配给你的工作项会出现在这里。" />
            ) : (
              <ol className="staff-work-list">
                {mine.map((item) => (
                  <li key={item.work_item_id}>
                    <QueueRow
                      item={item}
                      waited={waitedLabel(item.created_at, Date.now())}
                      mine
                      onOpen={open}
                    />
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section aria-labelledby="staff-queue-claimable">
            <h3 id="staff-queue-claimable">可认领（{claimable.length}）</h3>
            {claimable.length === 0 ? (
              <EmptyState title="暂无可认领的待办" description="公共池里没有等待认领的工作项。" />
            ) : (
              [...claimableByType.entries()].map(([type, items]) => (
                <div key={type} className="staff-claimable-group">
                  <h4>{workTypeLabels[type]}（{items.length}）</h4>
                  <ol className="staff-work-list">
                    {items.map((item) => (
                      <li key={item.work_item_id}>
                        <QueueRow
                          item={item}
                          waited={waitedLabel(item.created_at, Date.now())}
                          mine={false}
                          onOpen={open}
                          onClaim={claim}
                        />
                      </li>
                    ))}
                  </ol>
                </div>
              ))
            )}
          </section>
        </>
      )}
      <details className="staff-today-completed">
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
        <Button className="secondary" onClick={refresh}>
          刷新
        </Button>
      </p>
    </main>
  );
}

function QueueRow({
  item,
  waited,
  mine,
  onOpen,
  onClaim,
}: {
  item: StaffWorkItem;
  waited: string;
  mine: boolean;
  onOpen: (item: StaffWorkItem) => void;
  onClaim?: (item: StaffWorkItem) => void;
}): React.JSX.Element {
  return (
    <div className="staff-work-item staff-task-row">
      <span className="staff-work-item-heading">
        <strong>{workTypeLabels[item.work_type]}</strong>
        <StatusBadge tone={mine ? 'warning' : 'neutral'}>
          {mine ? '我的' : `等待 ${waited}`}
        </StatusBadge>
      </span>
      <span>{itemSummary(item)}</span>
      <small>已等待 {waited}</small>
      <span className="entry-actions">
        {onClaim ? (
          <Button className="secondary" onClick={() => onClaim(item)}>
            认领
          </Button>
        ) : null}
        <Button onClick={() => onOpen(item)}>去处理</Button>
      </span>
    </div>
  );
}
