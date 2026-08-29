import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { sellerPortalSettlementBatchPageSchema } from '@ygb/contracts';
import type { SellerPortalSettlementBatchPageDto } from '@ygb/contracts';
import { identityApiRequest } from '../../api/identity-request';
import { isFrontendApiError } from '../../api/errors';
import { Alert, Button, StatusBadge } from '../../ui/primitives';
import { formatShanghai } from '../../staff/shared/format';

/**
 * Stage 7.5 batch 3 + 7.5R/7.5R-2: the seller-side read-only settlement
 * batch list. DRAFT/CANCELLED batches are filtered out in the backend SQL
 * before pagination; the payload carries only seller-safe fields (no
 * profit, no buyer refund, no internal notes, no organization/version
 * metadata). Pages load through the real cursor (7.5R) instead of a single
 * fixed page, and every response is parsed with the shared strict runtime
 * schema from `@ygb/contracts` (7.5R-2) — the same schema the backend
 * request-level contract tests parse with. Each row links to the read-only
 * batch detail at `/seller/settlements/:batchId`.
 */

const batchListSchema = sellerPortalSettlementBatchPageSchema;

const STATUS_LABELS: Record<string, string> = {
  CONFIRMED: '已确认',
  PARTIALLY_PAID: '部分支付',
  PAID: '已付清',
};

export function SellerBatchListSection(): React.JSX.Element {
  const client = useQueryClient();
  const [laterPages, setLaterPages] = useState<
    SellerPortalSettlementBatchPageDto[]
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
          <p>结算批次对当前账号不可见。</p>
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
              <Link
                className="mws-tonal"
                to={`/seller/settlements/${encodeURIComponent(batch.batch_id)}`}
              >
                查看详情
              </Link>
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

/**
 * Stage 7.5R-2: the `/seller/settlements` page for OPERATIONS/VIEWER
 * members. Every ACTIVE member role may read settlement batches; the
 * settlement summary, payables and payment history remain owner/finance
 * only, so those roles get the batch list (and detail) without the
 * financial sections instead of a wall of permission warnings.
 */
export function SellerSettlementBatchesPage(): React.JSX.Element {
  return (
    <section className="mws-page seller-page">
      <div className="mws-heading">
        <div>
          <p>财务与结算</p>
          <h1>结算批次</h1>
          <span>按批次冻结的应付与付款进度；结算摘要与打款记录仅对负责人和财务成员展示。</span>
        </div>
      </div>
      <SellerBatchListSection />
    </section>
  );
}
