import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Filter, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import { staffApi } from '../api/client';
import type { StaffOrderListItem } from '../contracts/runtime';
import { formatCny, formatShanghai } from '../shared/format';

const PAGE_LIMIT = 20;

const STAGE_LABELS: Record<string, string> = {
  BUYER_REFUND: '买家返款',
  SELLER_SETTLEMENT: '卖家结算',
  COMPLETED: '已完成',
};

const NEXT_ACTION_LABELS: Record<string, string> = {
  PROCESS_BUYER_REFUND: '处理买家返款',
  FOLLOW_SELLER_SETTLEMENT: '跟进卖家结算',
  REVIEW_COMPLETED_ORDER: '复核已完成订单',
  RESOLVE_EXCEPTION: '处理订单异常',
  ASSIGN_RESPONSIBLE_STAFF: '待分配负责人',
};

interface FilterState {
  amazonOrderNumberPrefix: string;
  buyerCustomerNo: string;
  sellerOrganizationId: string;
  stage: string;
  exceptionState: string;
  confirmedFrom: string;
  confirmedTo: string;
}

const EMPTY_FILTERS: FilterState = {
  amazonOrderNumberPrefix: '',
  buyerCustomerNo: '',
  sellerOrganizationId: '',
  stage: '',
  exceptionState: '',
  confirmedFrom: '',
  confirmedTo: '',
};

function filtersFromParams(params: URLSearchParams): FilterState {
  return {
    amazonOrderNumberPrefix: params.get('amazon_order_number_prefix') ?? '',
    buyerCustomerNo: params.get('buyer_customer_no') ?? '',
    sellerOrganizationId: params.get('seller_organization_id') ?? '',
    stage: params.get('stage') ?? '',
    exceptionState: params.get('exception_state') ?? '',
    confirmedFrom: params.get('confirmed_from') ?? '',
    confirmedTo: params.get('confirmed_to') ?? '',
  };
}

function activeFilterCount(filters: FilterState): number {
  return Object.values(filters).filter((value) => value !== '').length;
}

function filtersToParams(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({
    amazon_order_number_prefix: filters.amazonOrderNumberPrefix || null,
    buyer_customer_no: filters.buyerCustomerNo || null,
    seller_organization_id: filters.sellerOrganizationId || null,
    stage: filters.stage || null,
    exception_state: filters.exceptionState || null,
    confirmed_from: filters.confirmedFrom || null,
    confirmed_to: filters.confirmedTo || null,
  })) {
    if (value !== null) params.set(key, value);
  }
  return params;
}

/**
 * 订单列表（7F-1 重做）：单行工具栏筛选 + 紧凑表格 + keyset 翻页。
 * 筛选条件全部进 URL；移动端筛选走 Drawer，列表退化为卡片。
 */
export function StaffOrderListPage(): React.JSX.Element {
  const session = useCurrentStaffSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const cursor = searchParams.get('cursor');
  const filters = filtersFromParams(searchParams);
  const [draft, setDraft] = useState<FilterState>(filters);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDraft(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 URL 筛选变化时同步草稿。
  }, [searchParams]);

  // Infinite query accumulates pages so 加载更多 keeps earlier rows rendered.
  const list = useInfiniteQuery({
    queryKey: ['staff', 'formal-order-list', filters, cursor === null ? '' : cursor],
    initialPageParam: cursor as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = filtersToParams(filters);
      params.set('limit', String(PAGE_LIMIT));
      if (pageParam !== null) params.set('cursor', pageParam as string);
      return staffApi
        .formalOrderList(client, `?${params.toString()}`, signal)
        .then((response) => response.data);
    },
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    retry: false,
  });

  function applyFilters(next: FilterState): void {
    setDrawerOpen(false);
    setSearchParams(filtersToParams(next));
  }
  function submitToolbar(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    applyFilters(draft);
  }
  function clearFilters(): void {
    setDraft(EMPTY_FILTERS);
    applyFilters(EMPTY_FILTERS);
  }

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const nextCursor = list.data?.pages.at(-1)?.next_cursor ?? null;
  const activeCount = activeFilterCount(filters);
  void session;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="sp-page-head">
        <div>
          <p className="sp-page-head__meta">
            共 {items.length}
            {activeCount > 0 ? ` 条（${activeCount} 项筛选生效）` : ' 条'} · 金额与下一步均为后端权威值
          </p>
        </div>
        <div className="sp-page-head__actions">
          <button type="button" className="sa-btn sa-btn--tonal sa-btn--small" onClick={() => void list.refetch()}>
            刷新
          </button>
        </div>
      </div>

      {/* 桌面单行工具栏：搜索 + 紧凑筛选 + 清除 */}
      <form className="sp-toolbar" onSubmit={submitToolbar} aria-label="订单筛选">
        <div className="sp-toolbar__search sa-field">
          <input
            className="sa-input sa-input--search"
            aria-label="搜索平台订单号前缀"
            placeholder="搜索订单号前缀，如 503-7770"
            value={draft.amazonOrderNumberPrefix}
            minLength={3}
            onChange={(event) => setDraft({ ...draft, amazonOrderNumberPrefix: event.target.value })}
          />
        </div>
        <div className="sp-toolbar__filters">
          <div className="sa-field sp-toolbar__always">
            <select
              className="sa-select sa-select--compact"
              aria-label="按业务阶段筛选"
              value={draft.stage}
              onChange={(event) => setDraft({ ...draft, stage: event.target.value })}
            >
              <option value="">全部阶段</option>
              {Object.entries(STAGE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="sa-field sp-toolbar__always">
            <select
              className="sa-select sa-select--compact"
              aria-label="按异常状态筛选"
              value={draft.exceptionState}
              onChange={(event) => setDraft({ ...draft, exceptionState: event.target.value })}
            >
              <option value="">全部异常</option>
              <option value="OPEN">有异常</option>
              <option value="NONE">无异常</option>
            </select>
          </div>
          <div className="sa-field">
            <input
              className="sa-input sa-input--compact"
              aria-label="按买家编号筛选"
              placeholder="买家编号"
              value={draft.buyerCustomerNo}
              onChange={(event) => setDraft({ ...draft, buyerCustomerNo: event.target.value })}
            />
          </div>
          <div className="sa-field">
            <input
              className="sa-input sa-input--compact"
              aria-label="确认日期起"
              type="date"
              aria-description="确认日期从"
              value={draft.confirmedFrom}
              onChange={(event) => setDraft({ ...draft, confirmedFrom: event.target.value })}
            />
          </div>
          <div className="sa-field">
            <input
              className="sa-input sa-input--compact"
              aria-label="确认日期止"
              type="date"
              value={draft.confirmedTo}
              onChange={(event) => setDraft({ ...draft, confirmedTo: event.target.value })}
            />
          </div>
          <button type="submit" className="sa-btn sa-btn--primary sa-btn--small">
            应用筛选
          </button>
          {activeCount > 0 ? (
            <button type="button" className="sa-btn sa-btn--ghost sa-btn--small" onClick={clearFilters}>
              <X aria-hidden="true" size={14} />
              清除筛选
            </button>
          ) : null}
        </div>
        {/* 移动端：筛选按钮打开 Drawer */}
        <button
          type="button"
          className="sa-btn sa-btn--secondary sa-btn--small sp-toolbar__drawer-trigger"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <Filter aria-hidden="true" size={14} />
          筛选{activeCount > 0 ? `（${activeCount}）` : ''}
        </button>
      </form>

      {/* 移动端筛选 Drawer */}
      {drawerOpen ? (
        <div className="sa-drawer-overlay" role="presentation" onClick={() => setDrawerOpen(false)}>
          <aside
            className="sa-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="订单筛选"
            onClick={(event) => event.stopPropagation()}
            style={{ top: 0, right: 0, left: 'auto' }}
          >
            <div className="sa-drawer__header">
              <strong>订单筛选</strong>
              <button
                type="button"
                className="sa-btn sa-btn--ghost sa-btn--small"
                aria-label="关闭筛选"
                onClick={() => setDrawerOpen(false)}
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <form
              style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '0 4px' }}
              onSubmit={(event) => {
                event.preventDefault();
                applyFilters(draft);
              }}
            >
              <div className="sa-field">
                <label htmlFor="sp-order-prefix">平台订单号前缀</label>
                <input
                  id="sp-order-prefix"
                  className="sa-input"
                  value={draft.amazonOrderNumberPrefix}
                  minLength={3}
                  onChange={(event) => setDraft({ ...draft, amazonOrderNumberPrefix: event.target.value })}
                />
              </div>
              <div className="sa-field">
                <label htmlFor="sp-order-stage">业务阶段</label>
                <select
                  id="sp-order-stage"
                  className="sa-select"
                  value={draft.stage}
                  onChange={(event) => setDraft({ ...draft, stage: event.target.value })}
                >
                  <option value="">全部阶段</option>
                  {Object.entries(STAGE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sa-field">
                <label htmlFor="sp-order-exception">异常状态</label>
                <select
                  id="sp-order-exception"
                  className="sa-select"
                  value={draft.exceptionState}
                  onChange={(event) => setDraft({ ...draft, exceptionState: event.target.value })}
                >
                  <option value="">全部异常</option>
                  <option value="OPEN">有异常</option>
                  <option value="NONE">无异常</option>
                </select>
              </div>
              <div className="sa-field">
                <label htmlFor="sp-order-buyer">买家编号</label>
                <input
                  id="sp-order-buyer"
                  className="sa-input"
                  value={draft.buyerCustomerNo}
                  onChange={(event) => setDraft({ ...draft, buyerCustomerNo: event.target.value })}
                />
              </div>
              <div className="sa-field">
                <label htmlFor="sp-order-from">确认日期起</label>
                <input
                  id="sp-order-from"
                  className="sa-input"
                  type="date"
                  value={draft.confirmedFrom}
                  onChange={(event) => setDraft({ ...draft, confirmedFrom: event.target.value })}
                />
              </div>
              <div className="sa-field">
                <label htmlFor="sp-order-to">确认日期止</label>
                <input
                  id="sp-order-to"
                  className="sa-input"
                  type="date"
                  value={draft.confirmedTo}
                  onChange={(event) => setDraft({ ...draft, confirmedTo: event.target.value })}
                />
              </div>
              <div className="sp-dialog-actions">
                <button type="button" className="sa-btn sa-btn--secondary sa-btn--small" onClick={clearFilters}>
                  清除
                </button>
                <button type="submit" className="sa-btn sa-btn--primary sa-btn--small">
                  应用筛选
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}

      {list.isPending ? (
        <p role="status" className="sp-page-head__meta">
          正在加载订单列表
        </p>
      ) : list.isError ? (
        <div className="sa-card">
          <div className="sa-state">
            <h3>订单列表读取失败</h3>
            <p>请调整筛选或重试。</p>
            <button
              type="button"
              className="sa-btn sa-btn--tonal sa-btn--small"
              onClick={() => void list.refetch()}
            >
              重试
            </button>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="sa-card">
          <div className="sa-state">
            <h3>没有符合条件的订单</h3>
            <p>试试放宽筛选条件。</p>
          </div>
        </div>
      ) : (
        <>
          {/* 桌面紧凑表格 */}
          <div className="sa-card sa-card--flush sp-table-only">
            <div style={{ overflowX: 'auto' }}>
              <table className="sa-table">
                <thead>
                  <tr>
                    <th>平台订单号</th>
                    <th>买家</th>
                    <th>店铺</th>
                    <th>产品</th>
                    <th>业务阶段</th>
                    <th>负责人</th>
                    <th>下一步</th>
                    <th>应返买家</th>
                    <th>确认时间</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <OrderRow key={item.formal_order_id} item={item} onOpen={() => navigate(`/staff/orders/${encodeURIComponent(item.formal_order_id)}`)} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 移动端卡片列表 */}
          <div className="sp-cards sp-cards-only">
            {items.map((item) => (
              <button
                key={item.formal_order_id}
                type="button"
                className="sp-card-item"
                style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() => navigate(`/staff/orders/${encodeURIComponent(item.formal_order_id)}`)}
              >
                <span className="sp-card-item__head">
                  <strong className="sp-card-item__title">{item.amazon_order_number}</strong>
                  <span className={`sa-badge ${item.responsibility.exception_state === 'OPEN' ? 'sa-badge--danger' : 'sa-badge--neutral'}`}>
                    {STAGE_LABELS[item.responsibility.stage] ?? item.responsibility.stage}
                  </span>
                </span>
                <span className="sp-card-item__meta">
                  {item.buyer_display_name}（{item.buyer_customer_no}）· {item.store_display_name}
                </span>
                <span className="sp-card-item__meta">
                  {item.product_name_snapshot} · 下一步：{NEXT_ACTION_LABELS[item.responsibility.next_action] ?? item.responsibility.next_action}
                </span>
              </button>
            ))}
          </div>

          <div className="sp-list-footer">
            <span>
              已加载 {items.length} 条{nextCursor !== null ? ' · 还有更多' : ' · 已全部加载'}
            </span>
            {nextCursor !== null ? (
              <button
                type="button"
                className="sa-btn sa-btn--secondary sa-btn--small"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? '加载中…' : '加载更多'}
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function OrderRow({
  item,
  onOpen,
}: {
  item: StaffOrderListItem;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <tr
      className="sa-table__row"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen();
      }}
    >
      <td>
        <strong>{item.amazon_order_number}</strong>
      </td>
      <td>
        {item.buyer_display_name}
        <br />
        <span className="sp-page-head__meta">{item.buyer_customer_no}</span>
      </td>
      <td>{item.store_display_name}</td>
      <td>{item.product_name_snapshot}</td>
      <td>
        <span className="sa-badge sa-badge--outline">{STAGE_LABELS[item.responsibility.stage] ?? item.responsibility.stage}</span>
      </td>
      <td>
        {item.responsibility.responsible_staff === null ? (
          <span className="sp-amount--muted">未分配</span>
        ) : (
          item.responsibility.responsible_staff.display_name
        )}
      </td>
      <td>
        <span
          className={
            item.responsibility.exception_state === 'OPEN'
              ? 'sa-badge sa-badge--danger'
              : item.responsibility.is_overdue
                ? 'sa-badge sa-badge--warning'
                : 'sa-badge sa-badge--neutral'
          }
        >
          {NEXT_ACTION_LABELS[item.responsibility.next_action] ?? item.responsibility.next_action}
        </span>
      </td>
      <td className="sa-table__num">
        {item.buyer_expected_principal_cny_fen === null ? (
          <span className="sp-amount--muted">—</span>
        ) : (
          formatCny(item.buyer_expected_principal_cny_fen)
        )}
      </td>
      <td className="sa-table__num">{formatShanghai(item.confirmed_at)}</td>
    </tr>
  );
}
