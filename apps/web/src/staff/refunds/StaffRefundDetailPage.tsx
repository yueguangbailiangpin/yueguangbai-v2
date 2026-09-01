import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
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
  StatusBadge,
  TextInput,
} from '../../ui/primitives';
import { staffApi } from '../api/client';
import {
  StaffMutationAuthority,
  type StaffMutationRequest,
} from '../mutations/StaffMutationAuthority';
import { staffWorkbenchKeys } from '../queries/keys';
import { formatCny, formatShanghai } from '../shared/format';
import { describeBuyerRefundMutationError } from '../shared/staffMutationOutcome';

const STAFF_FACT_STALE_TIME_MS = 15_000;

type RefundDetail = Awaited<
  ReturnType<typeof staffApi.buyerRefund>
>['data']['buyer_refund'];

/**
 * 返款处理视图（/staff/refunds/:obligationId，P7b）。从第一批过渡面板
 * BuyerRefundLegacyPanel 迁移：登记多笔转账流水（元输入换算分 + 凭证上传）
 * 与冲正；累计到账=应返时后端自动结清并完成对应待办。
 */
export function StaffRefundDetailPage(): React.JSX.Element {
  const client = useQueryClient();
  const { obligationId } = useParams<{ obligationId: string }>();
  const query = useQuery({
    queryKey: staffWorkbenchKeys.refund(obligationId ?? ''),
    queryFn: ({ signal }) =>
      staffApi
        .buyerRefund(client, obligationId!, signal)
        .then((response) => response.data.buyer_refund),
    enabled: obligationId !== undefined,
    retry: false,
    staleTime: STAFF_FACT_STALE_TIME_MS,
  });
  const value = query.data ?? null;
  return (
    <main className="sp-refunds-page">
      <section aria-labelledby="staff-refund-detail-title">
        <p className="eyebrow">买家与订单 · 返款</p>
        <h2 id="staff-refund-detail-title">返款处理</h2>
        <p>
          <Link to="/staff/refunds">← 返回返款工作台</Link>
        </p>
      </section>
      {obligationId === undefined ? (
        <Alert tone="danger">缺少返款义务 ID。</Alert>
      ) : query.isPending ? (
        <p role="status">加载中…</p>
      ) : query.isError ? (
        <Alert tone="danger">
          返款信息读取失败（
          {isFrontendApiError(query.error) ? query.error.code : 'NETWORK_FAILURE'}），请刷新重试。
        </Alert>
      ) : value ? (
        <div className="staff-refund-detail-grid">
          <RefundFacts value={value} />
          <RefundPaymentForm
            obligationId={obligationId}
            value={value}
            onMutated={(settled) => {
              void query.refetch();
              void client.invalidateQueries({ queryKey: staffWorkbenchKeys.refundsRoot });
              if (settled) void client.invalidateQueries({ queryKey: staffWorkbenchKeys.queueRoot });
            }}
            onRefreshFacts={() => {
              void query.refetch();
            }}
          />
        </div>
      ) : null}
    </main>
  );
}

function RefundFacts({ value }: { value: RefundDetail }): React.JSX.Element {
  const settled = value.status === 'PAID';
  return (
    <>
      <Card className="customer-visible">
        <h3>
          买家返款{' '}
          <StatusBadge tone={settled ? 'success' : 'warning'}>
            {settled ? '已结清' : '待处理'}
          </StatusBadge>
        </h3>
        <ul className="staff-order-facts">
          <li>买家编码：{value.buyer.buyer_customer_no ?? '未分配'}</li>
          <li>订单号：{value.order.amazon_order_number_normalized}（ASIN {value.order.asin}）</li>
          <li>应返：{formatCny(value.due_amount_cny_fen)}</li>
          <li>已返净额：{formatCny(value.net_paid_cny_fen)}</li>
          <li>待返：{formatCny(value.outstanding_amount_cny_fen)}</li>
          {Number(value.overpaid_amount_cny_fen) > 0 ? (
            <li>多付：{formatCny(value.overpaid_amount_cny_fen)}（请人工核实）</li>
          ) : null}
          <li>
            {value.promise_deadline_at === null
              ? '承诺期限未起算（缺评论通过事件）'
              : `承诺期限：${formatShanghai(value.promise_deadline_at)}（评论通过 + 7 个工作日，仅提醒口径）`}
          </li>
          {value.refund_account_name === null || value.refund_account_identifier === null ? (
            <li className="staff-refund-account-missing">
              <strong>买家收款账户缺失</strong>：请让买家在"我的"页面补充收款账户
            </li>
          ) : (
            <li>
              买家收款账户：{value.refund_account_name}（支付宝 {value.refund_account_identifier}）
            </li>
          )}
        </ul>
      </Card>
      <Card className="internal-note">
        <h3>买家催办</h3>
        <ul className="staff-order-facts">
          <li>催办次数：{value.reminder_count}</li>
          <li>最后催办：{value.last_reminded_at === null ? '暂无' : formatShanghai(value.last_reminded_at)}</li>
        </ul>
      </Card>
      <Card className="internal-note">
        <h3>已记录付款</h3>
        {value.payments.length === 0 ? (
          <p>暂无付款记录。</p>
        ) : (
          <div className="staff-payment-rows">
            {value.payments.map((entry) => (
              <div key={entry.payment_entry_id} className="staff-payment-row">
                <span>
                  {formatCny(entry.amount_cny_fen)} · {formatShanghai(entry.paid_at)}
                </span>
                <RefundReversalButton entry={entry} version={value.version} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function RefundReversalButton({
  entry,
  version,
}: {
  entry: RefundDetail['payments'][number];
  version: number;
}): React.JSX.Element | null {
  const client = useQueryClient();
  const obligationId = useParams<{ obligationId: string }>().obligationId ?? '';
  const authority = useMemo(
    () => new StaffMutationAuthority<ApiResult<{ obligation: { status: string } }>>(),
    [],
  );
  const [confirming, setConfirming] = useState(false);
  const mutation = useMutation({
    mutationFn: (request: StaffMutationRequest | null) =>
      request === null
        ? authority.retry()
        : authority.execute(request, (spec, key) =>
            staffApi.reverseRefundPayment(client, obligationId, entry.payment_entry_id, spec.body, key),
          ),
    onSuccess: () => {
      setConfirming(false);
      void client.invalidateQueries({ queryKey: staffWorkbenchKeys.refund(obligationId) });
      void client.invalidateQueries({ queryKey: staffWorkbenchKeys.refundsRoot });
    },
  });
  const failure = mutation.isError ? describeBuyerRefundMutationError(mutation.error) : null;
  return (
    <>
      <Button
        className="secondary"
        disabled={mutation.isPending}
        onClick={() => {
          authority.release();
          mutation.reset();
          setConfirming(true);
        }}
      >
        冲正
      </Button>
      <Dialog
        open={confirming}
        title="确认冲正"
        description="冲正会改变已记录的付款事实。"
        busy={mutation.isPending}
        onClose={() => {
          if (!mutation.isPending) setConfirming(false);
        }}
      >
        <p>
          冲正金额：<strong>{formatCny(entry.amount_cny_fen)}</strong>
        </p>
        {failure ? (
          <>
            <Alert tone="danger">
              冲正未完成。{failure.hint}
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
                      setConfirming(false);
                      mutation.reset();
                      void client.invalidateQueries({
                        queryKey: staffWorkbenchKeys.refund(obligationId),
                      });
                    }
              }
            >
              {authority.canRetry() ? '重试原请求' : '刷新返款事实'}
            </Button>
          </>
        ) : null}
        <div className="entry-actions">
          <Button
            className="secondary"
            disabled={mutation.isPending}
            onClick={() => setConfirming(false)}
          >
            取消
          </Button>
          <Button
            className="danger"
            loading={mutation.isPending}
            onClick={() => {
              mutation.mutate({
                action: 'reversal',
                path: '',
                body: {
                  expected_version: version,
                  amount_cny_fen: entry.amount_cny_fen,
                  reversed_at: Date.now(),
                  reason: '员工确认冲正',
                },
              });
            }}
          >
            确认冲正
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function RefundPaymentForm({
  obligationId,
  value,
  onMutated,
  onRefreshFacts,
}: {
  obligationId: string;
  value: RefundDetail;
  onMutated: (settled: boolean) => void;
  onRefreshFacts: () => void;
}): React.JSX.Element {
  const client = useQueryClient();
  const authority = useMemo(
    () => new StaffMutationAuthority<ApiResult<{ obligation: { status: string } }>>(),
    [],
  );
  const [uploader, upload] = useFileUpload();
  const [confirm, setConfirm] = useState<{ amountYuan: number; body: unknown } | null>(null);
  const mutation = useMutation({
    mutationFn: (request: StaffMutationRequest | null) =>
      request === null
        ? authority.retry()
        : authority.execute(request, (spec, key) =>
            staffApi.recordRefundPayment(client, obligationId, spec.body, key),
          ),
    onSuccess: (response) => {
      setConfirm(null);
      onMutated(response.data.obligation.status === 'PAID');
    },
  });
  const failure = mutation.isError ? describeBuyerRefundMutationError(mutation.error) : null;
  const settled = value.status === 'PAID';
  return (
    <>
      <Card className="internal-note">
        <h3>登记返款转账</h3>
        {settled ? (
          <p>该返款已结清；如需调整请先冲正对应付款。</p>
        ) : (
          <>
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
                // 金额以元输入（可带小数），换算为分提交；后端只接受整数分。
                const yuan = Number(data.get('amount'));
                if (!Number.isFinite(yuan) || yuan <= 0) return;
                const amountCnyFen = Math.round(yuan * 100);
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
                  amountYuan: yuan,
                  body: {
                    expected_version: value.version,
                    amount_cny_fen: String(amountCnyFen),
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
              <FormField label="实际返款（元，可带小数）" htmlFor="refund-amount">
                <TextInput id="refund-amount" name="amount" inputMode="decimal" required />
              </FormField>
              <label htmlFor="refund-channel">渠道</label>
              <Select id="refund-channel" name="channel">
                <option value="WECHAT">微信</option>
                <option value="ALIPAY">支付宝</option>
                <option value="BANK_TRANSFER">银行转账</option>
                <option value="OTHER_MANUAL">其他</option>
              </Select>
              <FormField label="客户备注" htmlFor="refund-public">
                <TextInput id="refund-public" name="public_note" />
              </FormField>
              <FormField label="内部备注" htmlFor="refund-internal">
                <TextInput id="refund-internal" name="internal_note" />
              </FormField>
              <Button disabled={upload.state !== 'VERIFIED' || mutation.isPending}>记录</Button>
            </form>
          </>
        )}
      </Card>
      <Dialog
        open={confirm !== null}
        title="确认记录返款"
        description="请确认客户、金额和渠道后再记录。"
        busy={mutation.isPending}
        onClose={() => {
          if (!mutation.isPending) setConfirm(null);
        }}
      >
        {confirm ? (
          <p>
            返款金额：<strong>{confirm.amountYuan.toFixed(2)} 元</strong>
            （提交 {Math.round(confirm.amountYuan * 100)} 分）
          </p>
        ) : null}
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
              mutation.mutate({ action: 'payment', path: '', body: confirm.body });
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
                      onRefreshFacts();
                    }
              }
            >
              {authority.canRetry() ? '重试原请求' : '刷新返款事实'}
            </Button>
          </>
        ) : null}
      </Dialog>
    </>
  );
}
