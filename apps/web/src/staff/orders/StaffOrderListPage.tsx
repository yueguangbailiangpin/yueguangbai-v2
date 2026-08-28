import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { isFrontendApiError } from '../../api/errors';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  StatusBadge,
  TextInput,
} from '../../ui/primitives';
import { staffApi } from '../api/client';
import { formatShanghai } from '../shared/format';
import { fenToYuan } from '../finance/finance-format';

/**
 * Stage 7.5 batch 1: the staff formal-order cursor list. Filters and the
 * cursor live in the URL search params so a filtered view is shareable and
 * survives reloads. Amounts and SLA values come from the backend projection;
 * the page never computes them.
 */

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

export function StaffOrderListPage(): React.JSX.Element {
  const session = useCurrentStaffSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const cursor = searchParams.get('cursor');
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const [draft, setDraft] = useState<FilterState>(filters);

  // Infinite query accumulates pages so 加载更多 keeps earlier rows rendered.
  const list = useInfiniteQuery({
    queryKey: ['staff', 'formal-order-list', filters, cursor === null ? '' : cursor],
    initialPageParam: cursor as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_LIMIT));
      for (const [key, value] of Object.entries({
        amazon_order_number_prefix: filters.amazonOrderNumberPrefix || null,
        buyer_customer_no: filters.buyerCustomerNo || null,
        seller_organization_id: filters.sellerOrganizationId || null,
        stage: filters.stage || null,
        exception_state: filters.exceptionState || null,
        confirmed_from: filters.confirmedFrom || null,
        confirmed_to: filters.confirmedTo || null,
        cursor: pageParam as string | null,
      })) {
        if (value !== null) params.set(key, value);
      }
      return staffApi
        .formalOrderList(client, `?${params.toString()}`, signal)
        .then((response) => response.data);
    },
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    retry: false,
  });

  function applyFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({
      amazon_order_number_prefix: draft.amazonOrderNumberPrefix || null,
      buyer_customer_no: draft.buyerCustomerNo || null,
      seller_organization_id: draft.sellerOrganizationId || null,
      stage: draft.stage || null,
      exception_state: draft.exceptionState || null,
      confirmed_from: draft.confirmedFrom || null,
      confirmed_to: draft.confirmedTo || null,
    })) {
      if (value !== null) params.set(key, value);
    }
    setSearchParams(params);
  }

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const nextCursor = list.data?.pages.at(-1)?.next_cursor ?? null;

  return (
    <main className="staff-order-list">
      <section aria-labelledby="staff-order-list-title">
        <p className="eyebrow">订单 · 仅 Staff</p>
        <h2 id="staff-order-list-title">正式订单</h2>
        <p>
          按确认时间倒序的正式订单游标列表；金额与下一步截止时间均为后端权威值。
        </p>
      </section>

      <Card className="staff-order-filters">
        <form onSubmit={applyFilters}>
          <div className="staff-order-filter-grid">
            <label>
              平台订单号前缀
              <TextInput
                value={draft.amazonOrderNumberPrefix}
                onChange={(event) =>
                  setDraft({ ...draft, amazonOrderNumberPrefix: event.target.value })
                }
                placeholder="123-1234567"
                minLength={3}
              />
            </label>
            <label>
              买家编号
              <TextInput
                value={draft.buyerCustomerNo}
                onChange={(event) =>
                  setDraft({ ...draft, buyerCustomerNo: event.target.value })
                }
                placeholder="20260801B00001"
              />
            </label>
            <label>
              卖家组织 ID
              <TextInput
                value={draft.sellerOrganizationId}
                onChange={(event) =>
                  setDraft({ ...draft, sellerOrganizationId: event.target.value })
                }
              />
            </label>
            <label>
              业务阶段
              <select
                value={draft.stage}
                onChange={(event) => setDraft({ ...draft, stage: event.target.value })}
              >
                <option value="">全部</option>
                <option value="BUYER_REFUND">买家返款</option>
                <option value="SELLER_SETTLEMENT">卖家结算</option>
                <option value="COMPLETED">已完成</option>
              </select>
            </label>
            <label>
              异常状态
              <select
                value={draft.exceptionState}
                onChange={(event) =>
                  setDraft({ ...draft, exceptionState: event.target.value })
                }
              >
                <option value="">全部</option>
                <option value="OPEN">有未解决异常</option>
                <option value="NONE">无异常</option>
              </select>
            </label>
            <label>
              确认时间从（毫秒）
              <TextInput
                value={draft.confirmedFrom}
                onChange={(event) =>
                  setDraft({ ...draft, confirmedFrom: event.target.value })
                }
                inputMode="numeric"
              />
            </label>
            <label>
              确认时间到（毫秒）
              <TextInput
                value={draft.confirmedTo}
                onChange={(event) =>
                  setDraft({ ...draft, confirmedTo: event.target.value })
                }
                inputMode="numeric"
              />
            </label>
          </div>
          <div className="entry-actions">
            <Button type="submit">应用筛选</Button>
            {activeFilterCount(filters) > 0 || cursor ? (
              <Button
                className="secondary"
                type="button"
                onClick={() => {
                  setDraft(EMPTY_FILTERS);
                  setSearchParams(new URLSearchParams());
                }}
              >
                清除筛选
              </Button>
            ) : null}
          </div>
        </form>
      </Card>

      {list.isPending ? (
        <p role="status">正在读取订单列表</p>
      ) : list.isError ? (
        <Alert tone="danger">
          订单列表读取失败（
          {isFrontendApiError(list.error) ? list.error.code : 'NETWORK_FAILURE'}
          ）。请调整筛选或重试。
          <Button
            className="secondary"
            onClick={() => void list.refetch()}
            loading={list.isRefetching}
          >
            重试
          </Button>
        </Alert>
      ) : items.length === 0 ? (
        <EmptyState
          title="没有符合条件的订单"
              description="当前负责范围内没有匹配筛选条件的正式订单。"
        />
      ) : (
        <>
          <div className="staff-order-table-wrap" role="region" aria-label="订单列表">
            <table className="staff-order-table">
              <thead>
                <tr>
                  <th>平台订单号</th>
                  <th>买家</th>
                  <th>店铺</th>
                  <th>产品</th>
                  <th>业务阶段</th>
                  <th>负责人</th>
                  <th>下一步</th>
                  <th>应返本金</th>
                  <th>确认时间</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.formal_order_id}
                    tabIndex={0}
                    onClick={() => navigate(`/staff/orders/${item.formal_order_id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter')
                        navigate(`/staff/orders/${item.formal_order_id}`);
                    }}
                  >
                    <td>
                      <button
                        className="link-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/staff/orders/${item.formal_order_id}`);
                        }}
                      >
                        {item.amazon_order_number}
                      </button>
                    </td>
                    <td>
                      {item.buyer_display_name}
                      <small>{item.buyer_customer_no}</small>
                    </td>
                    <td>{item.store_display_name}</td>
                    <td>{item.product_name_snapshot}</td>
                    <td>
                      <StatusBadge
                        tone={
                          item.responsibility.stage === 'COMPLETED'
                            ? 'success'
                            : 'processing'
                        }
                      >
                        {STAGE_LABELS[item.responsibility.stage] ?? item.responsibility.stage}
                      </StatusBadge>
                    </td>
                    <td>
                      {item.responsibility.responsible_staff?.display_name ?? '未分配'}
                    </td>
                    <td>
                      {NEXT_ACTION_LABELS[item.responsibility.next_action]
                        ?? item.responsibility.next_action}
                      {item.responsibility.is_overdue ? (
                        <span className="staff-overdue-mark">已逾期</span>
                      ) : item.responsibility.next_action_due_at !== null ? (
                        <small>{formatShanghai(item.responsibility.next_action_due_at)}</small>
                      ) : null}
                    </td>
                    <td>
                      {item.buyer_expected_principal_cny_fen === null
                        ? '—'
                        : fenToYuan(item.buyer_expected_principal_cny_fen)}
                    </td>
                    <td>{formatShanghai(item.confirmed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="staff-order-cards">
            {items.map((item) => (
              <li key={item.formal_order_id} className="staff-order-card">
                <button
                  className="link-button"
                  onClick={() => navigate(`/staff/orders/${item.formal_order_id}`)}
                >
                  {item.amazon_order_number}
                </button>
                <p>
                  {item.buyer_display_name}（{item.buyer_customer_no}）·{' '}
                  {item.store_display_name}
                </p>
                <p>
                  {STAGE_LABELS[item.responsibility.stage]} ·{' '}
                  {item.responsibility.responsible_staff?.display_name ?? '未分配'}
                </p>
                <p>
                  下一步：
                  {NEXT_ACTION_LABELS[item.responsibility.next_action]
                    ?? item.responsibility.next_action}
                  {item.responsibility.is_overdue ? '（已逾期）' : ''}
                </p>
                <p>
                  应返本金：
                  {item.buyer_expected_principal_cny_fen === null
                    ? '—'
                    : fenToYuan(item.buyer_expected_principal_cny_fen)}
                </p>
              </li>
            ))}
          </ul>
          {nextCursor ? (
            <div className="entry-actions">
              <Button onClick={() => void list.fetchNextPage()}>加载更多</Button>
            </div>
          ) : (
            <p className="staff-list-end">已显示全部匹配订单。</p>
          )}
        </>
      )}
      <p className="staff-order-list-scope">
        当前列表范围：{session.role.display_name}负责范围内的订单。
      </p>
    </main>
  );
}
