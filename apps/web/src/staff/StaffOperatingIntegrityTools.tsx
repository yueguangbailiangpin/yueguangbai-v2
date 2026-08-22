import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { isFrontendApiError } from '../api/errors';
import { identityApiRequest } from '../api/identity-request';
import { operationHeaders } from '../api/idempotency';
import { useCurrentStaffSession } from '../auth/staff/StaffSessionBoundary';
import { useFileUpload } from '../buyer/shared/useFileUpload';
import { FileDropZone } from '../ui/FileDropZone';
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
} from '../ui/primitives';
import { formatCny } from './shared/format';
import { describeStaffMutationError } from './shared/staffMutationOutcome';

const capability = z.object({ allowed: z.boolean(), reason: z.string().nullable() }).strict();
const orderSchema = z
  .object({
    order: z
      .object({
        formal_order_id: z.string(),
        amazon_order_number: z.string(),
        buyer_customer_id: z.string(),
        seller_organization_id: z.string(),
        marketplace_code: z.string(),
        product_name: z.string(),
        confirmed_at: z.number().int(),
        marketplace_business_date: z.string().nullable(),
        review_case_id: z.string().nullable(),
        review_status: z.string().nullable(),
        has_refund_obligation: z.boolean().nullable(),
        advance_full_amount_cny_fen: z.string().nullable(),
        advance_net_cny_fen: z.string().nullable(),
        active_advance_payment_id: z.string().nullable(),
        operational_state: z.string(),
        actions: z
          .object({
            record_order_event: capability,
            record_review_visibility: capability,
            approve_review: capability,
            record_advance_principal: capability,
            record_profit_adjustment: capability,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
const eventSchema = z
  .object({
    event: z
      .object({
        event_id: z.string(),
        formal_order_id: z.string(),
        event_type: z.string(),
        reason: z.string(),
        actor_staff_id: z.string(),
        created_at: z.number().int(),
      })
      .strict(),
  })
  .strict();
const visibilitySchema = z
  .object({
    observation: z
      .object({
        observation_id: z.string(),
        review_case_id: z.string(),
        formal_order_id: z.string(),
        visibility_status: z.string(),
        note: z.string().nullable(),
        observed_at: z.number().int(),
        actor_staff_id: z.string(),
        created_at: z.number().int(),
      })
      .strict(),
  })
  .strict();
const advanceSchema = z
  .object({
    entry: z
      .object({
        entry_id: z.string(),
        formal_order_id: z.string(),
        buyer_customer_id: z.string(),
        entry_type: z.literal('PAYMENT'),
        original_payment_entry_id: z.null(),
        amount_cny_fen: z.string(),
        paid_at: z.number().int(),
        reversed_at: z.null(),
        china_business_date: z.string(),
        payment_channel: z.string(),
        note: z.string().nullable(),
        actor_staff_id: z.string(),
        created_at: z.number().int(),
      })
      .strict(),
  })
  .strict();
const advanceReversalSchema = z
  .object({
    reversal: z
      .object({
        entry_id: z.string(),
        original_payment_entry_id: z.string(),
        amount_cny_fen: z.string(),
        reversed_at: z.number().int(),
        reason: z.string(),
      })
      .strict(),
  })
  .strict();
const adjustmentSchema = z
  .object({
    adjustment: z
      .object({
        adjustment_id: z.string(),
        formal_order_id: z.string(),
        source_operational_event_id: z.string().nullable(),
        adjustment_scope: z.enum(['PROJECTED_GROSS_PROFIT', 'COMPLETED_GROSS_PROFIT']),
        amount_cny_fen: z.string(),
        reason: z.string(),
        actor_staff_id: z.string(),
        created_at: z.number().int(),
      })
      .strict(),
  })
  .strict();
type Order = z.output<typeof orderSchema>['order'];
const MARKET: Record<string, string> = {
  AMAZON_JP: '亚马逊日本站',
  AMAZON_US: '亚马逊美国站',
  COUPANG_KR: 'Coupang 韩国站',
  RAKUTEN_JP: '乐天日本站',
  TIKTOK_JP: 'TikTok 日本站',
};

export function StaffOperatingIntegrityTools() {
  const session = useCurrentStaffSession(),
    role = session.role.code;
  if (!['owner', 'seller_ops', 'pre_sales', 'buyer_refund'].includes(role)) return null;
  const client = useQueryClient(),
    [uploader, upload] = useFileUpload(),
    [order, setOrder] = useState<Order | null>(null),
    [confirmAdvance, setConfirmAdvance] = useState<{ body: unknown; key: string } | null>(null),
    [message, setMessage] = useState<string | null>(null),
    [refreshWarning, setRefreshWarning] = useState<unknown>(null);
  const lookup = useMutation({
    mutationFn: (number: string) =>
      identityApiRequest('staff', client, {
        path: `/api/staff/operating-integrity/order-lookup?amazon_order_number=${encodeURIComponent(number)}`,
        method: 'GET',
        schema: orderSchema,
      }),
    onSuccess: (response) => {
      setOrder(response.data.order);
      setMessage(null);
    },
  });
  const event = useMutation({
    mutationFn: (request: { body: unknown; key: string }) =>
      write(
        client,
        `/api/staff/order-integrity/${encodeURIComponent(order!.formal_order_id)}/events`,
        request.body,
        eventSchema,
        request.key,
      ),
    onSuccess: (response) => {
      const eventType = response.data.event.event_type;
      void refreshOrderFacts(
        `订单状态已记录为 ${stateLabel(eventType === 'RESOLVED' ? 'NORMAL' : eventType)}。`,
      );
    },
  });
  const visibility = useMutation({
    mutationFn: (request: { body: unknown; key: string }) =>
      write(
        client,
        `/api/staff/reviews/${encodeURIComponent(order!.review_case_id!)}/visibility`,
        request.body,
        visibilitySchema,
        request.key,
      ),
    onSuccess: () => setMessage('评论当前展示状态已记录；原审核通过结果保持不变。'),
  });
  const advance = useMutation({
    mutationFn: (request: { body: unknown; key: string }) =>
      write(
        client,
        `/api/staff/buyer-advance-principal/${encodeURIComponent(order!.formal_order_id)}/payments`,
        request.body,
        advanceSchema,
        request.key,
      ),
    onSuccess: () => {
      setConfirmAdvance(null);
      void refreshOrderFacts('全额提前返本金和付款凭证已记录。正式返款义务形成后系统会自动抵扣。');
    },
  });
  const reverseAdvance = useMutation({
    mutationFn: (request: { paymentId: string; reason: string; key: string }) =>
      write(
        client,
        `/api/staff/buyer-advance-principal/${encodeURIComponent(order!.formal_order_id)}/payments/${encodeURIComponent(request.paymentId)}/reversals`,
        { reason: request.reason },
        advanceReversalSchema,
        request.key,
      ),
    onSuccess: () => {
      void refreshOrderFacts('提前返本金已整笔冲正；需要时可重新录入一笔全额付款。');
    },
  });
  const adjustment = useMutation({
    mutationFn: (request: { body: unknown; key: string }) =>
      write(
        client,
        `/api/staff/order-integrity/${encodeURIComponent(order!.formal_order_id)}/financial-adjustments`,
        request.body,
        adjustmentSchema,
        request.key,
      ),
    onSuccess: () => setMessage('公司利润补偿已追加；原财务快照没有修改。'),
  });
  function search(eventForm: FormEvent<HTMLFormElement>) {
    eventForm.preventDefault();
    const number = String(
      new FormData(eventForm.currentTarget).get('amazon_order_number') ?? '',
    ).trim();
    if (number) lookup.mutate(number);
  }
  function refreshOrderFacts(successMessage: string): void {
    const number = order?.amazon_order_number;
    if (!number) {
      setMessage(successMessage);
      return;
    }
    setRefreshWarning(null);
    // The write response already confirms success. This read only refreshes the
    // derived buttons and must never turn a completed write into a failure.
    void lookup.mutateAsync(number).then(() => {
      setMessage(`${successMessage} 后续按钮已按后端能力重新计算。`);
    }).catch((error: unknown) => {
      lookup.reset();
      setRefreshWarning(error);
      setMessage(`${successMessage} 服务器写入已成功，但刷新订单事实失败，请重新查询。`);
    });
  }
  return (
    <section className="staff-integrity-tools">
      <Card>
        <div className="staff-section-toolbar">
          <div>
            <h2>业务完整性工具</h2>
            <p>业务按钮是否可用由后端 Domain Policy 返回，页面不自行推断状态机。</p>
          </div>
          {order ? (
            <StatusBadge tone="processing">
              {MARKET[order.marketplace_code] ?? order.marketplace_code}
            </StatusBadge>
          ) : null}
        </div>
        <form onSubmit={search} className="historical-customer-search">
          <FormField label="Amazon 订单号" htmlFor="integrity-order-number">
            <TextInput id="integrity-order-number" name="amazon_order_number" required />
          </FormField>
          <Button className="secondary" loading={lookup.isPending}>
            查找正式订单
          </Button>
        </form>
        {lookup.isError && refreshWarning === null ? (
          <Alert tone="danger">没有找到当前岗位有权查看的唯一正式订单。</Alert>
        ) : null}
        {order ? (
          <div className="customer-registration-success">
            <strong>{order.product_name}</strong>
            <p>
              {order.amazon_order_number} ·{' '}
              {MARKET[order.marketplace_code] ?? order.marketplace_code} · 当前订单状态：
              {stateLabel(order.operational_state)}
            </p>
            {order.advance_net_cny_fen !== null && order.has_refund_obligation !== null ? (
              <p>
                提前返本金净额：{formatCny(order.advance_net_cny_fen)} ·{' '}
                {order.has_refund_obligation ? '正式返款义务已建立' : '正式返款义务尚未建立'}
              </p>
            ) : null}
          </div>
        ) : null}
        {message ? <Alert tone="success">{message}</Alert> : null}
        {refreshWarning ? <IntegrityMutationError label="刷新订单事实" error={refreshWarning} /> : null}
      </Card>
      {order && order.actions.record_order_event.allowed ? (
        <OrderEventCard
          busy={event.isPending}
          onSubmit={(body) => event.mutate({ body, key: crypto.randomUUID() })}
        />
      ) : null}
      {event.isError ? <IntegrityMutationError label="记录订单状态" error={event.error} /> : null}
      {order && order.actions.record_review_visibility.allowed ? (
        <ReviewVisibilityCard
          reviewCaseId={order.review_case_id}
          busy={visibility.isPending}
          onSubmit={(body) => visibility.mutate({ body, key: crypto.randomUUID() })}
        />
      ) : null}
      {visibility.isError ? <IntegrityMutationError label="记录评论展示状态" error={visibility.error} /> : null}
      {order && (role === 'owner' || role === 'buyer_refund') ? (
        <AdvancePrincipalCard
          authoritativeAmountCnyFen={order.advance_full_amount_cny_fen}
          disabled={!order.actions.record_advance_principal.allowed}
          disabledReason={order.actions.record_advance_principal.reason}
          busy={advance.isPending}
          uploadState={upload.state}
          onFile={(file) => {
            void uploader.start('staffBuyerRefundProof', [file]);
          }}
          onPrepare={(body) => {
            const file = upload.manifest?.files[0];
            if (!file) {
              setMessage('请先上传并完成验证付款凭证。');
              return;
            }
            setConfirmAdvance({
              body: {
                ...(body as Record<string, unknown>),
                proof_files: [
                  { file_object_id: file.file_object_id, expected_file_version: file.file_version },
                ],
              },
              key: crypto.randomUUID(),
            });
          }}
        />
      ) : null}
      {advance.isError ? <IntegrityMutationError label="记录提前返本金" error={advance.error} /> : null}
      {order &&
      (role === 'owner' || role === 'buyer_refund') &&
      order.has_refund_obligation === false &&
      order.active_advance_payment_id ? (
        <AdvanceReversalCard
          busy={reverseAdvance.isPending}
          onSubmit={(reason) =>
            reverseAdvance.mutate({
              paymentId: order.active_advance_payment_id!,
              reason,
              key: crypto.randomUUID(),
            })
          }
        />
      ) : null}
      {reverseAdvance.isError ? <IntegrityMutationError label="冲正提前返本金" error={reverseAdvance.error} /> : null}
      {order && order.actions.record_profit_adjustment.allowed ? (
        <FinancialAdjustmentCard
          busy={adjustment.isPending}
          onSubmit={(body) => adjustment.mutate({ body, key: crypto.randomUUID() })}
        />
      ) : null}
      {adjustment.isError ? <IntegrityMutationError label="追加利润补偿" error={adjustment.error} /> : null}
      <Dialog
        open={confirmAdvance !== null}
        title="确认提前返本金"
        description="这是实际资金支付事实。确认订单、买家、金额和付款凭证后再记录。"
        busy={advance.isPending}
        onClose={() => setConfirmAdvance(null)}
      >
        <div className="entry-actions">
          <Button className="secondary" onClick={() => setConfirmAdvance(null)}>
            取消
          </Button>
          <Button
            className="danger"
            loading={advance.isPending}
            onClick={() => confirmAdvance && advance.mutate(confirmAdvance)}
          >
            确认记录
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

function IntegrityMutationError({ label, error }: { label: string; error: unknown }): React.JSX.Element {
  const outcome = describeStaffMutationError(error);
  return (
    <Alert tone="danger">
      {label}未完成{outcome.code ? `（错误码：${outcome.code}）` : ''}：{outcome.hint}
      <RequestIdDisplay requestId={isFrontendApiError(error) ? error.requestId : null} />
    </Alert>
  );
}

function OrderEventCard({ busy, onSubmit }: { busy: boolean; onSubmit: (body: unknown) => void }) {
  return (
    <Card>
      <h3>订单后续异常</h3>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onSubmit({
            event_type: String(data.get('event_type')),
            reason: String(data.get('reason')),
          });
        }}
      >
        <FormField label="状态" htmlFor="order-event-type">
          <Select id="order-event-type" name="event_type">
            <option value="PLATFORM_CANCELLED">平台取消</option>
            <option value="RETURN_REFUND">退货 / 退款</option>
            <option value="BUSINESS_VOID">业务作废</option>
            <option value="MANUAL_INVESTIGATION">人工调查</option>
            <option value="RESOLVED">问题已解决 / 恢复正常</option>
          </Select>
        </FormField>
        <FormField label="原因" htmlFor="order-event-reason">
          <TextInput id="order-event-reason" name="reason" minLength={3} required />
        </FormField>
        <Button loading={busy}>记录订单状态</Button>
      </form>
    </Card>
  );
}
function ReviewVisibilityCard({
  reviewCaseId,
  busy,
  onSubmit,
}: {
  reviewCaseId: string | null;
  busy: boolean;
  onSubmit: (body: unknown) => void;
}) {
  if (!reviewCaseId) return null;
  return (
    <Card>
      <h3>评论展示状态</h3>
      <p>这里只记录 Amazon 当前展示情况，不修改“当时审核通过”的历史事实。</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onSubmit({
            visibility_status: String(data.get('visibility_status')),
            note: String(data.get('note') ?? '').trim() || null,
            observed_at: Date.now(),
          });
        }}
      >
        <FormField label="当前展示情况" htmlFor="review-visibility">
          <Select id="review-visibility" name="visibility_status">
            <option value="VISIBLE">正常显示</option>
            <option value="NOT_VISIBLE">一直未显示</option>
            <option value="DROPPED">掉评</option>
            <option value="RECHECK_REQUIRED">待复查</option>
          </Select>
        </FormField>
        <FormField label="备注（可选）" htmlFor="review-visibility-note">
          <TextInput id="review-visibility-note" name="note" />
        </FormField>
        <Button loading={busy}>记录展示状态</Button>
      </form>
    </Card>
  );
}
export function AdvancePrincipalCard({
  authoritativeAmountCnyFen,
  disabled,
  disabledReason,
  busy,
  uploadState,
  onFile,
  onPrepare,
}: {
  authoritativeAmountCnyFen: string | null;
  disabled: boolean;
  disabledReason: string | null;
  busy: boolean;
  uploadState: string;
  onFile: (file: File) => void;
  onPrepare: (body: unknown) => void;
}) {
  return (
    <Card>
      <h3>提前返本金</h3>
      {disabled ? (
        <Alert tone="info">{capabilityReason(disabledReason)}</Alert>
      ) : authoritativeAmountCnyFen === null ? (
        <Alert tone="danger">订单权威返款金额暂时无法读取，不能记录付款。</Alert>
      ) : (
        <>
          <p>
            <strong>本次全额付款：{formatCny(authoritativeAmountCnyFen)}</strong>
          </p>
          <p>金额由订单财务快照锁定，不支持分批提前返。</p>
          <FormField label="付款凭证" htmlFor="advance-proof">
            <FileDropZone
              id="advance-proof"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              maximumFiles={1}
              maximumBytes={20 * 1024 * 1024}
              buttonLabel="选择付款凭证"
              emptyLabel="尚未选择付款凭证"
              onFilesChange={(files) => {
                const file = files[0];
                if (file) onFile(file);
              }}
            />
          </FormField>
          <p className="staff-upload-state">
            凭证状态：{uploadState === 'VERIFIED' ? '已验证' : uploadState}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              onPrepare({
                paid_at: Date.now(),
                payment_channel: String(data.get('payment_channel')),
                note: String(data.get('note') ?? '').trim() || null,
              });
            }}
          >
            <FormField label="支付方式" htmlFor="advance-channel">
              <Select id="advance-channel" name="payment_channel">
                <option value="WECHAT">微信</option>
                <option value="ALIPAY">支付宝</option>
                <option value="BANK_TRANSFER">银行转账</option>
                <option value="OTHER_MANUAL">其他人工方式</option>
              </Select>
            </FormField>
            <FormField label="备注（可选）" htmlFor="advance-note">
              <TextInput id="advance-note" name="note" />
            </FormField>
            <Button className="danger" loading={busy} disabled={uploadState !== 'VERIFIED'}>
              准备记录全额提前本金
            </Button>
          </form>
        </>
      )}
    </Card>
  );
}
export function AdvanceReversalCard({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (reason: string) => void;
}) {
  return (
    <Card>
      <h3>整笔冲正提前返本金</h3>
      <Alert tone="warning">
        冲正会追加一条等额反向资金事实，不会删除原付款。部分冲正不受支持。
      </Alert>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
          if (reason) onSubmit(reason);
        }}
      >
        <FormField label="整笔冲正原因" htmlFor="advance-reversal-reason">
          <TextInput id="advance-reversal-reason" name="reason" minLength={3} required />
        </FormField>
        <Button className="danger" loading={busy}>
          整笔冲正
        </Button>
      </form>
    </Card>
  );
}
function FinancialAdjustmentCard({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: unknown) => void;
}) {
  return (
    <Card>
      <h3>公司利润补偿（仅总管理员）</h3>
      <Alert tone="warning">
        这里只修正公司预计/完成利润的经营视图，不直接改卖家本金、服务费或买家返款账本。
      </Alert>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onSubmit({
            adjustment_scope: String(data.get('scope')),
            amount_cny_fen: String(data.get('amount')),
            reason: String(data.get('reason')),
            source_operational_event_id: null,
          });
        }}
      >
        <FormField label="影响项目" htmlFor="adjustment-scope">
          <Select id="adjustment-scope" name="scope">
            <option value="PROJECTED_GROSS_PROFIT">预计利润</option>
            <option value="COMPLETED_GROSS_PROFIT">已完成利润</option>
          </Select>
        </FormField>
        <FormField label="调整金额（人民币分，可负数）" htmlFor="adjustment-amount">
          <TextInput id="adjustment-amount" name="amount" required />
        </FormField>
        <FormField label="调整原因" htmlFor="adjustment-reason">
          <TextInput id="adjustment-reason" name="reason" minLength={3} required />
        </FormField>
        <Button className="danger" loading={busy}>
          追加利润补偿
        </Button>
      </form>
    </Card>
  );
}
function write<T extends z.ZodType>(
  client: ReturnType<typeof useQueryClient>,
  path: string,
  body: unknown,
  schema: T,
  key: string,
) {
  return identityApiRequest('staff', client, {
    path,
    method: 'POST',
    schema,
    body,
    headers: operationHeaders({ key, body }),
  });
}
function stateLabel(value: string) {
  return (
    (
      {
        NORMAL: '正常',
        PLATFORM_CANCELLED: '平台取消',
        RETURN_REFUND: '退货 / 退款',
        BUSINESS_VOID: '业务作废',
        MANUAL_INVESTIGATION: '人工调查',
      } as Record<string, string>
    )[value] ?? value
  );
}
function capabilityReason(value: string | null) {
  return (
    (
      {
        REFUND_OBLIGATION_EXISTS: '这张订单已经建立正式返款义务，请回到正常“买家返款”任务处理。',
        ADVANCE_PAYMENT_EXISTS: '这张订单已有尚未整笔冲正的提前返本金。',
        ORDER_PLATFORM_CANCELLED: '订单已被平台取消，恢复正常前不能提前返本金。',
        ORDER_RETURN_REFUND: '订单处于退货/退款状态，恢复正常前不能提前返本金。',
        ORDER_BUSINESS_VOID: '订单已业务作废，恢复正常前不能提前返本金。',
        ORDER_UNDER_INVESTIGATION: '订单正在人工调查，恢复正常前不能提前返本金。',
        ROLE_NOT_ALLOWED: '当前岗位无权执行该操作。',
      } as Record<string, string>
    )[value ?? ''] ?? '当前业务状态不允许该操作。'
  );
}
