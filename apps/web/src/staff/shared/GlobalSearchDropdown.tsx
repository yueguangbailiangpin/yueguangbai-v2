import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { staffApi } from '../api/client';
import type { StaffSearchResults } from '../contracts/runtime';

const DEBOUNCE_MS = 300;

/**
 * 顶栏全局搜索（P9）：防抖 300ms 调 GET /api/staff/search，分组下拉
 * 直达详情（买家工作台 / 产品详情 / 订单详情 / 投放排期）。输入少于
 * 2 个字符不发请求；点击结果或点击面板外收起。
 */
export function GlobalSearchDropdown(): React.JSX.Element {
  const client = useQueryClient();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const trimmed = term.trim();
    const timer = window.setTimeout(
      () => setDebounced(trimmed.length >= 2 ? trimmed : ''),
      DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [term]);
  useEffect(() => {
    function onPointerDown(event: PointerEvent): void {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);
  const query = useQuery({
    queryKey: ['staff', 'search', debounced],
    queryFn: ({ signal }) =>
      staffApi.search(client, debounced, signal).then((response) => response.data),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
    retry: false,
  });
  const results = query.data;
  const total = results
    ? results.buyers.length + results.products.length
      + results.orders.length + results.demands.length
    : 0;
  return (
    <div className="staff-global-search" ref={boxRef}>
      <input
        type="search"
        role="searchbox"
        aria-label="全局搜索：客户编码、微信号、ASIN、订单号等"
        placeholder="搜索客户编码 / 微信号 / ASIN / 订单号"
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && debounced.length >= 2 ? (
        <div className="staff-search-results" role="listbox" aria-label="搜索结果">
          {query.isPending ? (
            <p role="status">搜索中…</p>
          ) : query.isError ? (
            <p className="inline-error" role="alert">搜索失败，请重试。</p>
          ) : total === 0 ? (
            <p>没有匹配「{results?.query}」的结果。</p>
          ) : (
            <>
              <SearchGroup label="买家" kind="buyers" results={results} onNavigate={() => setOpen(false)} />
              <SearchGroup label="产品" kind="products" results={results} onNavigate={() => setOpen(false)} />
              <SearchGroup label="订单" kind="orders" results={results} onNavigate={() => setOpen(false)} />
              <SearchGroup label="投放（需求）" kind="demands" results={results} onNavigate={() => setOpen(false)} />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SearchGroup({
  label,
  kind,
  results,
  onNavigate,
}: {
  label: string;
  kind: 'buyers' | 'products' | 'orders' | 'demands';
  results: StaffSearchResults;
  onNavigate: () => void;
}): React.JSX.Element | null {
  const group = results[kind];
  if (group.length === 0) return null;
  return (
    <div className="staff-search-group">
      <p className="staff-search-group-label">{label}</p>
      {group.map((item) => {
        const target
          = kind === 'buyers'
            ? {
              to: '/staff/buyer-customers',
              primary: item.display_name,
              secondary: item.buyer_customer_no ?? '未分配编码',
            }
            : kind === 'products'
              ? {
                to: `/staff/products/${encodeURIComponent(item.product_id)}`,
                primary: item.product_name,
                secondary: `ASIN ${item.asin_display}`,
              }
              : kind === 'orders'
                ? {
                  to: `/staff/orders/${encodeURIComponent(item.formal_order_id)}`,
                  primary: item.amazon_order_number_normalized,
                  secondary: `ASIN ${item.asin_display}`,
                }
                : {
                  to: `/staff/demands/${encodeURIComponent(item.demand_batch_id)}/reservations`,
                  primary: item.product_name,
                  secondary: DEMAND_STATUS_LABELS[item.status] ?? item.status,
                };
        return (
          <Link
            key={`${kind}-${target.to}-${target.primary}`}
            className="staff-search-item"
            role="option"
            aria-selected={false}
            to={target.to}
            onClick={onNavigate}
          >
            <strong>{target.primary}</strong>
            <span>{target.secondary}</span>
          </Link>
        );
      })}
    </div>
  );
}

const DEMAND_STATUS_LABELS: Record<string, string> = {
  SUBMITTED: '待审核',
  PUBLISHED: '已发布',
  REJECTED: '已拒绝',
  WITHDRAWN: '已撤回',
  CLOSED: '已关闭',
};
