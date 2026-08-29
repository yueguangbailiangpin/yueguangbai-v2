import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { identityApiRequest } from '../../api/identity-request';
import { isFrontendApiError } from '../../api/errors';
import { Alert, Button, StatusBadge } from '../../ui/primitives';
import { z } from 'zod';
import { formatShanghai } from '../../staff/shared/format';

/**
 * Stage 7.5 batch 3 + 7.5R: the seller-side read-only settlement batch list.
 * DRAFT/CANCELLED batches are filtered out in the backend SQL before
 * pagination; the payload carries only seller-safe fields (no profit, no
 * buyer refund, no internal notes, no organization/version metadata). Pages
 * load through the real cursor (7.5R) instead of a single fixed page.
 */

const sellerBatchSchema = z.object({
  batch_id: z.string(),
  status: z.enum(['CONFIRMED', 'PARTIALLY_PAID', 'PAID']),
  frozen_total_cny_fen: z.string(),
  frozen_payable_count: z.number().int().nonnegative(),
  paid_amount_cny_fen: z.string(),
  outstanding_amount_cny_fen: z.string(),
  confirmed_at: z.number().int(),
}).strict();

const batchListSchema = z.object({
  batches: z.array(sellerBatchSchema),
  next_cursor: z.string().nullable(),
}).strict();

const STATUS_LABELS: Record<string, string> = {
  CONFIRMED: '已确认',
  PARTIALLY_PAID: '部分支付',
  PAID: '已付清',
};

export function SellerBatchListSection(): React.JSX.Element {
  const client = useQueryClient();
  const [laterPages, setLaterPages] = useState<
    z.output<typeof batchListSchema>[]
  >([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const batches = useQuery({
    queryKey: ['seller', 'settlement-batches', 'first'],
    queryFn: ({ signal }) =>
      identityApiRequest('seller', client, {
        path: '/api/seller-portal/settlement/batches',
        method: 'GET',
        schema: batchListSchema,
        signal,
      }).then((response) => response.data),
    retry: false,
  });
  const list = batches.data === undefined
    ? []
    : [
      ...batches.data.batches,
      ...laterPages.flatMap((page) => page.batches),
    ];
  const lastPage = laterPages.at(-1) ?? batches.data;
  const nextCursor = lastPage === undefined ? null : lastPage.next_cursor;

  function loadMore(): void {
    if (nextCursor === null) return;
    setLoadError(null);
    void client
      .fetchQuery({
        queryKey: ['seller', 'settlement-batches', 'next', nextCursor],
        queryFn: ({ signal }) =>
          identityApiRequest('seller', client, {
            path: `/api/seller-portal/settlement/batches?cursor=${encodeURIComponent(nextCursor)}`,
            method: 'GET',
            schema: batchListSchema,
            signal,
          }).then((response) => response.data),
      })
      .then((page) => {
        setLaterPages((previous) => [...previous, page]);
      })
      .catch(() => {
        setLoadError('更多批次加载失败。');
      });
  }

  return (
    <section className="seller-batch-section" aria-labelledby="seller-batches-title">
      <h2 id="seller-batches-title">结算批次</h2>
      <p>按批次冻结的应付与付款进度；批次确认后成员与金额不可变动。</p>
      {batches.isPending ? (
        <p role="status">正在读取结算批次</p>
      ) : batches.isError ? (
        isFrontendApiError(batches.error) && batches.error.code === 'NOT_FOUND' ? (
          <p>当前角色没有结算批次查看权限。</p>
        ) : (
          <>
            <Alert tone="danger">结算批次读取失败。</Alert>
            <Button className="secondary" onClick={() => void batches.refetch()}>
              重试
            </Button>
          </>
        )
      ) : list.length === 0 ? (
        <p>暂无已确认的结算批次。</p>
      ) : (
        <ul className="seller-batch-list">
          {list.map((batch) => (
            <li key={batch.batch_id}>
              <StatusBadge tone={batch.status === 'PAID' ? 'success' : 'processing'}>
                {STATUS_LABELS[batch.status] ?? batch.status}
              </StatusBadge>
              <span>确认于 {formatShanghai(batch.confirmed_at)}</span>
              <span>{batch.frozen_payable_count} 笔</span>
            </li>
          ))}
        </ul>
      )}
      {nextCursor !== null ? (
        <div className="entry-actions">
          <Button className="secondary" onClick={loadMore}>
            加载更多批次
          </Button>
        </div>
      ) : null}
      {loadError ? <Alert tone="danger">{loadError}</Alert> : null}
    </section>
  );
}
