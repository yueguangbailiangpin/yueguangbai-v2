import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { isFrontendApiError } from '../../api/errors';
import type { ApiResult } from '../../api/transport';
import { useFileUpload } from '../../buyer/shared/useFileUpload';
import { FileDropZone } from '../../ui/FileDropZone';
import {
  Alert,
  Button,
  Card,
  Dialog,
  FormField,
  RequestIdDisplay,
  Select,
  TextInput,
} from '../../ui/primitives';
import { staffApi } from '../api/client';
import type { StaffWorkItem } from '../contracts/runtime';
import {
  StaffMutationAuthority,
  type StaffMutationRequest,
} from '../mutations/StaffMutationAuthority';
import { staffWorkbenchKeys } from '../queries/keys';
import { formatCny, formatShanghai } from '../shared/format';
import { describeBuyerRefundMutationError } from '../shared/staffMutationOutcome';
import { Audit, CustomerContext, Fact, PaneTitle } from './shared';

const STAFF_FACT_STALE_TIME_MS = 15_000;

/**
 * 第一批过渡面板：返款工作台（/staff/refunds，P7b）上线前，
 * BUYER_REFUND_PROCESSING 待办继续沿用原工作台的返款处理界面。
 * 第二批将其替换为直达返款工作台的跳转，本文件届时删除。
 */
export function BuyerRefundLegacyPanel({
  item,
  onCompleted,
}: {
  item: StaffWorkItem;
  onCompleted: (item: StaffWorkItem) => void;
}): React.JSX.Element {
  const client = useQueryClient();
  const authority = useMemo(
    () => new StaffMutationAuthority<ApiResult<{ obligation: { status: string } }>>(),
    [],
  );
  const [uploader, upload] = useFileUpload();
  const query = useQuery({
    queryKey: staffWorkbenchKeys.refund(item.source_entity_id),
    queryFn: ({ signal }) =>
      staffApi.buyerRefund(client, item.source_entity_id, signal).then((r) => r.data.buyer_refund),
    retry: false,
    staleTime: STAFF_FACT_STALE_TIME_MS,
  });
  const [confirm, setConfirm] = useState<{
    kind: 'payment' | 'reversal';
    body: unknown;
    paymentId?: string;
  } | null>(null);
  const mutation = useMutation({
    mutationFn: (request: StaffMutationRequest | null) =>
      request === null
        ? authority.retry()
        : authority.execute(request, ({ action, path, body }, key) => {
            if (action === 'payment')
              return staffApi.recordRefundPayment(client, item.source_entity_id, body, key);
            if (action === 'reversal') {
              const paymentId = decodeURIComponent(path.split('/').at(-2)!);
              return staffApi.reverseRefundPayment(
                client,
                item.source_entity_id,
                paymentId,
                body,
                key,
              );
            }
            throw new Error('INVALID_BUYER_REFUND_ACTION');
          }),
    onSuccess: (response) => {
      if (response.data.obligation.status === 'PAID') {
        // 结清返款会完成工作项；不要再依赖旧详情读取确认成功。
        onCompleted(item);
        return;
      }
      setConfirm(null);
      void query.refetch();
      void client.invalidateQueries({ queryKey: staffWorkbenchKeys.queueRoot });
    },
  });
  const value = query.data;
  const failure = mutation.isError ? describeBuyerRefundMutationError(mutation.error) : null;
  return (
    <>
      <section className="staff-detail">
        <PaneTitle item={item} />
        {query.isPending ? (
          <p role="status">加载中…</p>
        ) : value ? (
          <>
            <Card className="customer-visible">
              <h3>买家返款</h3>
              <Fact label="订单号" value={value.order.amazon_order_number_normalized} />
              <Fact label="应返" value={formatCny(value.due_amount_cny_fen)} />
              <Fact label="已返净额" value={formatCny(value.net_paid_cny_fen)} />
              <Fact label="待返" value={formatCny(value.outstanding_amount_cny_fen)} />
            </Card>
            <Card className="internal-note">
              <h3>买家催办</h3>
              <Fact label="催办次数" value={String(value.reminder_count)} />
              <Fact
                label="最后催办时间"
                value={
                  value.last_reminded_at === null ? '暂无' : formatShanghai(value.last_reminded_at)
                }
              />
            </Card>
            <Card className="internal-note">
              <h3>已记录付款</h3>
              {value.payments.length === 0 ? (
                <p>暂无付款记录。</p>
              ) : (
                value.payments.map((entry) => (
                  <div key={entry.payment_entry_id} className="staff-payment-row">
                    <span>
                      {formatCny(entry.amount_cny_fen)} · {formatShanghai(entry.paid_at)}
                    </span>
                    <Button
                      className="secondary"
                      disabled={mutation.isPending}
                      onClick={() => {
                        authority.release();
                        mutation.reset();
                        setConfirm({
                          kind: 'reversal',
                          paymentId: entry.payment_entry_id,
                          body: {
                            expected_version: value.version,
                            amount_cny_fen: entry.amount_cny_fen,
                            reversed_at: Date.now(),
                            reason: '员工确认冲正',
                          },
                        });
                      }}
                    >
                      冲正
                    </Button>
                  </div>
                ))
              )}
            </Card>
          </>
        ) : (
          <Alert tone="danger">返款信息暂时加载不了。</Alert>
        )}
      </section>
      <aside className="staff-actions">
        <CustomerContext item={item} />
        {value ? (
          <Card>
            <h3>记录返款</h3>
            <FileDropZone
              id="buyer-refund-proof"
              aria-label="买家返款凭证"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              disabled={mutation.isPending}
              maximumFiles={1}
              maximumBytes={20 * 1024 * 1024}
              buttonLabel="选择返款凭证"
              emptyLabel="尚未选择返款凭证"
              onFilesChange={(files) => {
                if (!mutation.isPending) {
                  authority.release();
                  mutation.reset();
                }
                const file = files[0];
                if (file) void uploader.start('staffBuyerRefundProof', [file]);
              }}
            />
            <p className="staff-upload-state">凭证：{upload.state}</p>
            <form
              onChange={() => {
                if (!mutation.isPending) {
                  authority.release();
                  mutation.reset();
                }
              }}
              onSubmit={(event) => {
                event.preventDefault();
                const file = upload.manifest?.files[0];
                if (!file) return;
                const data = new FormData(event.currentTarget);
                const paidAt = Date.now();
                const date = new Intl.DateTimeFormat('en-CA', {
                  timeZone: 'Asia/Shanghai',
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                }).format(new Date(paidAt));
                authority.release();
                mutation.reset();
                setConfirm({
                  kind: 'payment',
                  body: {
                    expected_version: value.version,
                    amount_cny_fen: String(data.get('amount')),
                    paid_at: paidAt,
                    china_business_date: date,
                    payment_channel: String(data.get('channel')),
                    public_note: String(data.get('public_note') ?? ''),
                    internal_note: String(data.get('internal_note') ?? ''),
                    proof_files: [
                      {
                        file_object_id: file.file_object_id,
                        expected_file_version: file.file_version,
                      },
                    ],
                  },
                });
              }}
            >
              <FormField
                label="实际返款（人民币分）"
                htmlFor={`refund-amount-${item.work_item_id}`}
              >
                <TextInput
                  id={`refund-amount-${item.work_item_id}`}
                  name="amount"
                  inputMode="numeric"
                  required
                />
              </FormField>
              <label htmlFor={`refund-channel-${item.work_item_id}`}>渠道</label>
              <Select id={`refund-channel-${item.work_item_id}`} name="channel">
                <option value="WECHAT">微信</option>
                <option value="ALIPAY">支付宝</option>
                <option value="BANK_TRANSFER">银行转账</option>
                <option value="OTHER_MANUAL">其他</option>
              </Select>
              <FormField label="客户备注" htmlFor={`refund-public-${item.work_item_id}`}>
                <TextInput id={`refund-public-${item.work_item_id}`} name="public_note" />
              </FormField>
              <FormField label="内部备注" htmlFor={`refund-internal-${item.work_item_id}`}>
                <TextInput id={`refund-internal-${item.work_item_id}`} name="internal_note" />
              </FormField>
              <Button disabled={upload.state !== 'VERIFIED' || mutation.isPending}>记录</Button>
            </form>
          </Card>
        ) : null}
        <Audit />
        <Dialog
          open={confirm !== null}
          title={confirm?.kind === 'payment' ? '确认记录返款' : '确认冲正'}
          description={
            confirm?.kind === 'payment'
              ? '请确认客户、金额和渠道后再记录。'
              : '冲正会改变已记录的付款事实。'
          }
          busy={mutation.isPending}
          onClose={() => {
            if (!mutation.isPending) setConfirm(null);
          }}
        >
          <div className="entry-actions">
            <Button
              className="secondary"
              disabled={mutation.isPending}
              onClick={() => setConfirm(null)}
            >
              取消
            </Button>
            <Button
              className="danger"
              loading={mutation.isPending}
              onClick={() => {
                if (!confirm) return;
                mutation.mutate({
                  action: confirm.kind,
                  path:
                    confirm.kind === 'payment'
                      ? `/api/staff/buyer-refunds/${encodeURIComponent(item.source_entity_id)}/payments`
                      : `/api/staff/buyer-refunds/${encodeURIComponent(item.source_entity_id)}/payments/${encodeURIComponent(confirm.paymentId!)}/reversals`,
                  body: confirm.body,
                });
              }}
            >
              确认
            </Button>
          </div>
          {failure ? (
            <>
              <Alert tone="danger">
                返款操作未完成。{failure.hint}
                {failure.code ? `（错误码：${failure.code}）` : ''}
              </Alert>
              <RequestIdDisplay
                requestId={isFrontendApiError(mutation.error) ? mutation.error.requestId : null}
              />
              <Button
                className="secondary"
                onClick={
                  authority.canRetry()
                    ? () => mutation.mutate(null)
                    : () => {
                        setConfirm(null);
                        mutation.reset();
                        void query.refetch();
                      }
                }
              >
                {authority.canRetry() ? '重试原请求' : '刷新返款事实'}
              </Button>
            </>
          ) : null}
        </Dialog>
      </aside>
    </>
  );
}
