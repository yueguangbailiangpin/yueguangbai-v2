import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { identityApiRequest } from '../api/identity-request';
import { operationHeaders } from '../api/idempotency';
import { isFrontendApiError } from '../api/errors';
import { useCurrentStaffSession } from '../auth/staff/StaffSessionBoundary';
import { Alert, Button, Card, StatusBadge } from '../ui/primitives';
import { z } from 'zod';
import { formatCny, formatShanghai } from './shared/format';

/**
 * Stage 7.5 batch 3: the staff settlement batches workspace. Drafts select
 * outstanding payables, confirmation freezes the totals, cancellation
 * releases members, export streams a whitelisted CSV. Every write carries an
 * idempotency key and expected_version; statuses are backend-derived.
 */

const batchSchema = z.object({
  batch_id: z.string(),
  seller_organization_id: z.string(),
  status: z.enum(['DRAFT', 'CONFIRMED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']),
  frozen_total_cny_fen: z.string(),
  frozen_payable_count: z.number().int().nonnegative(),
  paid_amount_cny_fen: z.string(),
  outstanding_amount_cny_fen: z.string(),
  version: z.number().int().positive(),
  created_at: z.number().int(),
  confirmed_at: z.number().int().nullable(),
  cancelled_at: z.number().int().nullable(),
  cancel_reason: z.string().nullable(),
});

const batchListSchema = z.object({
  batches: z.array(batchSchema),
  next_cursor: z.string().nullable(),
}).strict();

const batchMutationSchema = z.object({
  batch: batchSchema,
  replayed: z.boolean(),
}).strict();

const payableListSchema = z.object({
  items: z.array(z.object({
    payable_id: z.string(),
    amazon_order_number: z.string(),
    payable_type: z.enum(['SELLER_PRINCIPAL', 'SELLER_SERVICE_FEE']),
    outstanding_amount_cny_fen: z.string(),
    status: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID']),
  }).strict()),
  next_cursor: z.string().nullable(),
}).strict();

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿',
  CONFIRMED: '已确认',
  PARTIALLY_PAID: '部分支付',
  PAID: '已付清',
  CANCELLED: '已取消',
};

export function SettlementBatchesSection({
  organizationId,
}: {
  organizationId: string;
}): React.JSX.Element {
  const session = useCurrentStaffSession();
  const client = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const canRecord = session.permissions.includes('SELLER_SETTLEMENT_RECORD');

  const batches = useQuery({
    queryKey: ['staff', 'settlement-batches', organizationId],
    queryFn: ({ signal }) =>
      identityApiRequest('staff', client, {
        path: `/api/staff/seller-settlements/${encodeURIComponent(organizationId)}/batches`,
        method: 'GET',
        schema: batchListSchema,
        signal,
      }).then((response) => response.data),
    retry: false,
  });

  const refresh = (): void => {
    void client.invalidateQueries({
      queryKey: ['staff', 'settlement-batches', organizationId],
    });
  };

  const write = useMutation({
    mutationFn: (request: { path: string; body: unknown }) =>
      identityApiRequest('staff', client, {
        path: request.path,
        method: 'POST',
        schema: batchMutationSchema,
        body: request.body,
        headers: operationHeaders({
          key: crypto.randomUUID(),
          body: request.body,
        }),
      }),
    onSuccess: (response) => {
      setMessage(response.data.replayed ? '重复请求：批次状态保持不变。' : '批次操作已完成。');
      refresh();
    },
    onError: (error) => {
      setMessage(
        `操作未完成（${isFrontendApiError(error) ? error.code : 'NETWORK_FAILURE'}），请刷新后重试。`,
      );
    },
  });

  const base = `/api/staff/seller-settlements/${encodeURIComponent(organizationId)}/batches`;
  const list = batches.data?.batches ?? [];

  function onCreate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    write.mutate({ path: base, body: { reason: reason === '' ? null : reason } });
  }

  async function onAdd(batchId: string, batchVersion: number): Promise<void> {
    // Payables load lazily at member-selection time; the list itself stays
    // cheap and does not pollute settlement-fact reads.
    const page = await client.fetchQuery({
      queryKey: ['staff', 'settlement-batch-payables', organizationId],
      queryFn: ({ signal }) =>
        identityApiRequest('staff', client, {
          path: `/api/staff/seller-settlements/${encodeURIComponent(organizationId)}/payables?limit=100`,
          method: 'GET',
          schema: payableListSchema,
          signal,
        }).then((response) => response.data),
    });
    const pending = page.items
      .filter((payable) => payable.status !== 'PAID')
      .slice(0, 20)
      .map((payable) => payable.payable_id);
    if (pending.length === 0) {
      setMessage('当前没有可加入的未结清应付。');
      return;
    }
    write.mutate({
      path: `${base}/${encodeURIComponent(batchId)}/members`,
      body: { payable_ids: pending, expected_version: batchVersion, reason: '批量加入未结清应付' },
    });
  }

  function onConfirm(batchId: string, version: number): void {
    write.mutate({
      path: `${base}/${encodeURIComponent(batchId)}/confirm`,
      body: { expected_version: version, reason: '确认结算批次' },
    });
  }

  function onCancel(batchId: string, version: number): void {
    const reason = window.prompt('取消原因（必填）') ?? '';
    if (reason.trim() === '') return;
    write.mutate({
      path: `${base}/${encodeURIComponent(batchId)}/cancel`,
      body: { reason: reason.trim(), expected_version: version },
    });
  }

  async function onExport(batchId: string): Promise<void> {
    const response = await fetch(`${base}/${encodeURIComponent(batchId)}/export`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': crypto.randomUUID(),
        'content-type': 'application/json',
      },
      body: '{}',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as {
        error?: { code?: string };
      } | null;
      setMessage(
        payload?.error?.code === 'EXPORT_TOO_LARGE'
          ? '批次成员超过导出上限（5000 行 / 2 MiB），请拆分批次后再导出。'
          : '导出未完成，请稍后重试。',
      );
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `seller-settlement-batch-${batchId}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="staff-settlement-batches" aria-labelledby="settlement-batches-title">
      <h3 id="settlement-batches-title">结算批次</h3>
      <p>
        批次为不可变快照：确认后冻结成员与金额；付款进度由账本实时推导；同一应付不能进入两个有效批次。
      </p>
      {batches.isPending ? (
        <p role="status">正在读取结算批次</p>
      ) : batches.isError ? (
        <Alert tone="danger">
          结算批次读取失败（
          {isFrontendApiError(batches.error) ? batches.error.code : 'NETWORK_FAILURE'}）。
          <Button className="secondary" onClick={() => void batches.refetch()}>
            重试
          </Button>
        </Alert>
      ) : list.length === 0 ? (
        <p>暂无结算批次。</p>
      ) : (
        <ul className="staff-batch-list">
          {list.map((batch) => (
            <li key={batch.batch_id} className="staff-batch-row">
              <div>
                <StatusBadge
                  tone={
                    batch.status === 'CANCELLED'
                      ? 'neutral'
                      : batch.status === 'PAID'
                        ? 'success'
                        : 'processing'
                  }
                >
                  {STATUS_LABELS[batch.status] ?? batch.status}
                </StatusBadge>
                <small>创建 {formatShanghai(batch.created_at)}</small>
                {batch.confirmed_at !== null ? (
                  <small>确认 {formatShanghai(batch.confirmed_at)}</small>
                ) : null}
              </div>
              <dl>
                <div>
                  <dt>冻结总额</dt>
                  <dd>{formatCny(batch.frozen_total_cny_fen)}</dd>
                </div>
                <div>
                  <dt>笔数</dt>
                  <dd>{batch.frozen_payable_count}</dd>
                </div>
                <div>
                  <dt>已付 / 未付</dt>
                  <dd>
                    {formatCny(batch.paid_amount_cny_fen)} /{' '}
                    {formatCny(batch.outstanding_amount_cny_fen)}
                  </dd>
                </div>
              </dl>
              {canRecord && batch.status === 'DRAFT' ? (
                <div className="entry-actions">
                  <Button
                    className="secondary"
                    loading={write.isPending}
                    onClick={() => void onAdd(batch.batch_id, batch.version)}
                  >
                    加入未结清应付
                  </Button>
                  <Button
                    className="secondary"
                    disabled={batch.frozen_payable_count === 0}
                    onClick={() => onConfirm(batch.batch_id, batch.version)}
                  >
                    确认批次
                  </Button>
                </div>
              ) : null}
              {canRecord && batch.status !== 'CANCELLED' && batch.status !== 'PAID' ? (
                <div className="entry-actions">
                  <Button className="secondary" onClick={() => onCancel(batch.batch_id, batch.version)}>
                    取消批次
                  </Button>
                </div>
              ) : null}
              {batch.status !== 'DRAFT' && batch.status !== 'CANCELLED' ? (
                <div className="entry-actions">
                  <Button className="secondary" onClick={() => void onExport(batch.batch_id)}>
                    导出 CSV
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canRecord ? (
        <Card>
          <form onSubmit={onCreate}>
            <label>
              新建批次原因（可选）
              <input name="reason" />
            </label>
            <Button type="submit" loading={write.isPending}>
              新建结算批次草稿
            </Button>
          </form>
        </Card>
      ) : null}
      {message ? (
        <Alert tone={write.isSuccess ? 'success' : 'info'}>{message}</Alert>
      ) : null}
    </section>
  );
}
