import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  sellerPortalSettlementBatchDetailResponseSchema,
} from '@ygb/contracts';
import { identityApiRequest } from '../../api/identity-request';
import { isFrontendApiError } from '../../api/errors';
import { Alert, Button, StatusBadge } from '../../ui/primitives';
import { formatShanghai, formatCny } from '../../staff/shared/format';

/**
 * Stage 7.5R-2: the seller-side read-only settlement batch detail at
 * `/seller/settlements/:batchId`. Loads the real
 * `GET /api/seller-portal/settlement/batches/:batchId` and parses every
 * response with the shared strict runtime schema from `@ygb/contracts`.
 * Members load through the real `members_next_cursor` page by page (a
 * 250-member batch needs at least two pages). The payload carries only
 * seller-safe fields — no member_id, payable_id, formal_order_id,
 * organization ids or staff metadata. DRAFT/CANCELLED/foreign batches stay
 * concealed behind the backend's safe 404.
 */

type BatchDetailCursor = string | null;
const PAYABLE_TYPE_LABELS: Record<string, string> = {
  SELLER_PRINCIPAL: '本金',
  SELLER_SERVICE_FEE: '服务费',
};

const STATUS_LABELS: Record<string, string> = {
  CONFIRMED: '已确认',
  PARTIALLY_PAID: '部分支付',
  PAID: '已付清',
};

export function SellerBatchDetailSection({ batchId }: {
  batchId: string;
}): React.JSX.Element {
  const client = useQueryClient();
  const [memberCursors, setMemberCursors] = useState<readonly BatchDetailCursor[]>([null]);

  const pages = useQueries({
    queries: memberCursors.map((cursor) => ({
      queryKey: ['seller', 'settlement-batch-detail', batchId, cursor ?? 'first'],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        identityApiRequest('seller', client, {
          path: `/api/seller-portal/settlement/batches/${encodeURIComponent(batchId)}${
            cursor === null ? '' : `?members_cursor=${encodeURIComponent(cursor)}`
          }`,
          method: 'GET',
          schema: sellerPortalSettlementBatchDetailResponseSchema,
          signal,
        }).then((response) => response.data.batch),
      retry: false,
      refetchOnWindowFocus: false,
    })),
  });

  const first = pages[0];
  const last = pages.at(-1);
  const nextCursor = last?.data?.members_next_cursor ?? null;

  // 已翻过的旧页只为渲染保留；换批次时重置游标链。
  useEffect(() => {
    setMemberCursors((current) => (current.length > 1 ? [null] : current));
  }, [batchId]);

  const batch = first?.data ?? undefined;
  const members = pages.flatMap((page) => page.data?.members ?? []);
  const hasMore = last?.isSuccess === true
    && nextCursor !== null
    && !memberCursors.includes(nextCursor);
  const isLoadingMore = pages.length > 1 && last?.isPending === true;

  if (first?.isPending) {
    return (
      <section className="mws-page seller-page" aria-labelledby="seller-batch-detail-title">
        <h2 id="seller-batch-detail-title">结算批次详情</h2>
        <p role="status">正在读取结算批次</p>
      </section>
    );
  }

  if (first?.isError) {
    // Concealed batches (DRAFT/CANCELLED/other organizations) answer 404 —
    // shown as a safe "not available" state, never a fake normal page.
    if (isFrontendApiError(first.error) && first.error.code === 'NOT_FOUND') {
      return (
        <section className="mws-page seller-page" aria-labelledby="seller-batch-detail-title">
          <h2 id="seller-batch-detail-title">结算批次详情</h2>
          <p>结算批次不存在或对当前账号不可见。</p>
          <Link className="mws-tonal" to="/seller/settlements">返回批次列表</Link>
        </section>
      );
    }
    return (
      <section className="mws-page seller-page" aria-labelledby="seller-batch-detail-title">
        <h2 id="seller-batch-detail-title">结算批次详情</h2>
        <Alert tone="danger">结算批次读取失败。</Alert>
        <Button className="secondary" onClick={() => void first.refetch()}>
          重试
        </Button>
        <p>
          <Link className="mws-tonal" to="/seller/settlements">返回批次列表</Link>
        </p>
      </section>
    );
  }

  if (batch === undefined) {
    return (
      <section className="mws-page seller-page" aria-labelledby="seller-batch-detail-title">
        <h2 id="seller-batch-detail-title">结算批次详情</h2>
        <p>结算批次不存在或对当前账号不可见。</p>
        <Link className="mws-tonal" to="/seller/settlements">返回批次列表</Link>
      </section>
    );
  }

  return (
    <section className="mws-page seller-page" aria-labelledby="seller-batch-detail-title">
      <p>
        <Link className="mws-tonal" to="/seller/settlements">返回批次列表</Link>
      </p>
      <div className="mws-heading">
        <div>
          <p>结算批次</p>
          <h2 id="seller-batch-detail-title">批次详情</h2>
          <span>批次确认后成员与金额不可变动。</span>
        </div>
      </div>
      <section className="mws-surface" aria-label="批次概况">
        <div className="mws-section-heading">
          <div>
            <h3>批次概况</h3>
            <p>
              <StatusBadge tone={batch.status === 'PAID' ? 'success' : 'processing'}>
                {STATUS_LABELS[batch.status] ?? batch.status}
              </StatusBadge>
            </p>
          </div>
        </div>
        <div className="mws-settlement-numbers">
          <div>
            <span>确认时间</span>
            <strong>{formatShanghai(batch.confirmed_at)}</strong>
          </div>
          <div>
            <span>冻结总额</span>
            <strong>{formatCny(batch.frozen_total_cny_fen)}</strong>
            <small>{batch.frozen_payable_count} 笔</small>
          </div>
          <div>
            <span>已付金额</span>
            <strong>{formatCny(batch.paid_amount_cny_fen)}</strong>
          </div>
          <div>
            <span>未付金额</span>
            <strong>{formatCny(batch.outstanding_amount_cny_fen)}</strong>
          </div>
        </div>
      </section>
      <section className="mws-surface" aria-label="批次成员">
        <div className="mws-section-heading">
          <div>
            <h3>批次成员</h3>
            <p>按订单展示冻结与付款进度。</p>
          </div>
        </div>
        {members.length === 0 ? (
          <p>本批次暂无可展示的成员。</p>
        ) : (
          <ul className="seller-batch-members">
            {members.map((member, index) => (
              <li className="mws-settlement-row" key={`${member.amazon_order_number}-${index}`}>
                <div>
                  <span>订单 {member.amazon_order_number}</span>
                  <strong>{formatCny(member.frozen_amount_cny_fen)}</strong>
                  <small>
                    {PAYABLE_TYPE_LABELS[member.payable_type] ?? member.payable_type}
                    ・已付 {formatCny(member.paid_amount_cny_fen)}
                    ・未付 {formatCny(member.outstanding_amount_cny_fen)}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        )}
        {last?.isError ? (
          <>
            <Alert tone="warning">更多成员加载失败。</Alert>
            <Button className="secondary" onClick={() => void last.refetch()}>
              重试加载
            </Button>
          </>
        ) : null}
        {isLoadingMore ? <p role="status">正在加载更多成员</p> : null}
        {hasMore ? (
          <div className="entry-actions">
            <Button
              className="secondary"
              onClick={() => {
                if (nextCursor === null) return;
                setMemberCursors((current) => [...current, nextCursor]);
              }}
            >
              加载更多成员
            </Button>
          </div>
        ) : null}
      </section>
    </section>
  );
}
