import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { identityApiRequest } from '../../api/identity-request';
import { operationHeaders } from '../../api/idempotency';
import { isFrontendApiError } from '../../api/errors';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import { useFileUpload } from '../../buyer/shared/useFileUpload';
import { FileDropZone } from '../../ui/FileDropZone';
import { uploadSingleFileMultipart } from '../../files/file-upload-transport';
import {
  completePurposeBoundUploadIntent,
  createPurposeBoundUploadIntent,
} from '../../files/file-upload-api';
import { validateFileSelection } from '../../files/file-descriptor';
import type { FileUploadWorkflow } from '../../files/file-purpose-config';
import { z } from 'zod';
import { Alert, Button, Card, Dialog, FormField, RequestIdDisplay, Select, TextInput } from '../../ui/primitives';
import { staffApi } from '../api/client';
import { fenToYuan } from '../finance/finance-format';
import type { StaffFormalOrderDetail } from '../contracts/runtime';
import { PricingBreakdownCard } from '../shared/PricingBreakdownCard';
import { StaffProtectedImage } from '../shared/StaffProtectedImage';
import { formatCny, formatShanghai } from '../shared/format';
import { describeStaffMutationError } from '../shared/staffMutationOutcome';

const OPERATIONAL_EVENT_LABELS: Record<string, string> = {
  PLATFORM_CANCELLED: '平台取消',
  RETURN_REFUND: '退货退款',
  BUSINESS_VOID: '业务作废',
  MANUAL_INVESTIGATION: '人工核查',
  RESOLVED: '已解决',
};

const ADJUSTMENT_SCOPE_LABELS: Record<string, string> = {
  PROJECTED_GROSS_PROFIT: '预估毛利调整',
  COMPLETED_GROSS_PROFIT: '已完成毛利调整',
};

const MARKET_LABELS: Record<string, string> = {
  AMAZON_JP: '亚马逊日本站',
  AMAZON_US: '亚马逊美国站',
  COUPANG_KR: 'Coupang 韩国站',
};

const COMMUNICATION_UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;
const COMMUNICATION_ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const eventMutationSchema = z
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
const advanceMutationSchema = z
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
const adjustmentMutationSchema = z
  .object({
    adjustment: z
      .object({
        adjustment_id: z.string(),
        formal_order_id: z.string(),
        source_operational_event_id: z.string().nullable(),
        adjustment_scope: z.string(),
        amount_cny_fen: z.string(),
        reason: z.string(),
        actor_staff_id: z.string(),
        created_at: z.number().int(),
      })
      .strict(),
  })
  .strict();
const advanceEntriesSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            entry_id: z.string(),
            formal_order_id: z.string(),
            buyer_customer_id: z.string(),
            entry_type: z.literal('PAYMENT'),
            original_payment_entry_id: z.null(),
            amount_cny_fen: z.string(),
            paid_at: z.number().int(),
            reversed_at: z.number().int().nullable(),
            china_business_date: z.string(),
            payment_channel: z.string(),
            note: z.string().nullable(),
            actor_staff_id: z.string(),
            created_at: z.number().int(),
          })
          .strict(),
      ),
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
const communicationAttachSchema = z
  .object({
    screenshot: z
      .object({
        formal_order_id: z.string(),
        file_object_id: z.string(),
        replayed: z.boolean(),
      })
      .strict(),
  })
  .strict();

/**
 * D-056 §4.5 统一员工订单详情：主数据来自唯一的聚合端点
 * `GET /api/staff/formal-orders/:id`（付款截图、订单沟通截图、运营事件；
 * Owner+FINANCIAL_VIEW 额外返回人工财务调整与不可变财务快照），计价与
 * 现金进度仍由 internal-finance 只读端点提供。运营事件、提前返本金、
 * 人工财务调整作为本页内的权限化操作区，不再形成独立工具页。
 */
export function StaffOrderDetailPage(): React.JSX.Element {
  const session = useCurrentStaffSession();
  const client = useQueryClient();
  const { orderId } = useParams<{ orderId: string }>();
  const canViewFinance =
    session.role.code === 'owner' && session.permissions.includes('FINANCIAL_VIEW');
  const detail = useQuery({
    queryKey: ['staff', 'formal-order-detail', orderId],
    queryFn: ({ signal }) =>
      staffApi
        .formalOrderDetail(client, orderId!, signal)
        .then((response) => response.data),
    enabled: orderId !== undefined,
    retry: false,
  });
  const finance = useQuery({
    queryKey: ['staff', 'finance-order-detail', orderId],
    queryFn: ({ signal }) =>
      staffApi
        .financeOrderDetail(client, orderId!, signal)
        .then((response) => response.data),
    enabled: orderId !== undefined && canViewFinance,
    retry: false,
  });

  if (orderId === undefined)
    return (
      <main className="staff-order-detail">
        <Alert tone="danger">缺少订单 ID。</Alert>
      </main>
    );
  const value = detail.data ?? null;
  return (
    <main className="staff-order-detail">
      <section aria-labelledby="staff-order-detail-title">
        <p className="eyebrow">订单 · 仅 Staff</p>
        <h2 id="staff-order-detail-title">订单详情</h2>
        {!canViewFinance ? (
          <Alert tone="info">计价与财务金额仅 Owner 可见；以下为订单流程事实。</Alert>
        ) : null}
      </section>
      {detail.isPending ? (
        <p role="status">正在读取订单详情</p>
      ) : detail.isError ? (
        <Alert tone="danger">
          订单详情读取失败（{isFrontendApiError(detail.error) ? detail.error.code : 'NETWORK_FAILURE'}
          ）。订单可能不存在或不在当前负责范围内。
        </Alert>
      ) : value ? (
        <>
          <OrderIdentityCard value={value} />
          <PaymentScreenshotCard value={value} />
          <CommunicationScreenshotsCard orderId={orderId} value={value} />
          {canViewFinance && finance.data ? (
            <>
              <PricingBreakdownCard detail={finance.data} orderId={orderId} />
              <div className="staff-order-progress-grid">
                <Card className="customer-visible">
                  <h3>返款进度（买家）</h3>
                  <ul className="staff-order-facts">
                    <li>应返：{fenToYuan(finance.data.buyer_refund.due_cny_fen)}</li>
                    <li>已返：{fenToYuan(finance.data.buyer_refund.net_paid_cny_fen)}</li>
                    <li>
                      未返：
                      {fenToYuan(finance.data.buyer_refund.outstanding_cny_fen)}
                      {Number(finance.data.buyer_refund.overpaid_cny_fen) > 0
                        ? `（多付 ${fenToYuan(finance.data.buyer_refund.overpaid_cny_fen)}）`
                        : ''}
                    </li>
                  </ul>
                </Card>
                <Card className="customer-visible">
                  <h3>结算进度（卖家）</h3>
                  <ul className="staff-order-facts">
                    <li>
                      本金应收：
                      {fenToYuan(finance.data.seller_payables.principal_due_cny_fen)}
                      （已收 {fenToYuan(finance.data.seller_payables.principal_collected_cny_fen)}）
                    </li>
                    <li>
                      服务费应收：
                      {fenToYuan(finance.data.seller_payables.service_fee_due_cny_fen)}
                      （已收 {fenToYuan(finance.data.seller_payables.service_fee_collected_cny_fen)}）
                    </li>
                  </ul>
                </Card>
              </div>
            </>
          ) : null}
          {canViewFinance && finance.isError ? (
            <Alert tone="warning">计价明细读取失败；以下为订单流程事实。</Alert>
          ) : null}
          <TimelineCard value={value} />
          <OrderOperationBlocks orderId={orderId} value={value} />
        </>
      ) : null}
    </main>
  );
}

function OrderIdentityCard({ value }: { value: StaffFormalOrderDetail }): React.JSX.Element {
  return (
    <Card className="customer-visible">
      <h3>订单信息</h3>
      <ul className="staff-order-facts">
        <li>平台订单号：{value.order.amazon_order_number}</li>
        <li>
          站点：{MARKET_LABELS[value.order.marketplace_code] ?? value.order.marketplace_code}
          {' · '}订单日期：{value.order.amazon_order_date}
        </li>
        <li>
          确认时间：{formatShanghai(value.order.confirmed_at)} · 状态：{value.order.status}
        </li>
        <li>
          买家：{value.buyer.display_name}
          {value.buyer.customer_no ? `（编号 ${value.buyer.customer_no}）` : ''}
        </li>
        <li>
          卖家组织：{value.seller.seller_organization_id} · 店铺：{value.seller.store_display_name}
        </li>
      </ul>
    </Card>
  );
}

function PaymentScreenshotCard({ value }: { value: StaffFormalOrderDetail }): React.JSX.Element {
  return (
    <Card className="customer-visible">
      <h3>订单付款截图</h3>
      <p>买家提交订单资料时上传，每个订单资料版本严格一张，须可见订单号与金额。</p>
      {value.payment_screenshot === null ? (
        <p>暂无付款截图。</p>
      ) : (
        <StaffProtectedImage
          reference={{
            file_object_id: value.payment_screenshot.file_object_id,
            file_version: value.payment_screenshot.file_version,
            purpose: 'ORDER_EVIDENCE',
            visibility: 'BUYER_VISIBLE',
          }}
          alt="订单付款截图"
          className="protected-evidence-thumbnail"
          fallback={<span className="protected-image-placeholder">付款截图加载中</span>}
        />
      )}
    </Card>
  );
}

/**
 * 订单沟通截图（D-056 §4.1：买家聊天与卖家订单沟通统一为一种业务图片）：
 * 挂在正式订单、员工上传、一单多张、卖家组织全部有效成员可见、买家不可见。
 */
function CommunicationScreenshotsCard({
  orderId,
  value,
}: {
  orderId: string;
  value: StaffFormalOrderDetail;
}): React.JSX.Element {
  const client = useQueryClient();
  const session = useCurrentStaffSession();
  const [message, setMessage] = useState<string | null>(null);
  const canUpload = session.permissions.includes('ORDER_CONFIRM');
  const fileInput = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      // 通用控制器的 intent 路径不含订单参数，这里按同一套文件合同手动走
      // intents → PUT content → complete → attach（幂等键全程一致）。
      const workflow: FileUploadWorkflow = {
        identity: 'staff',
        intentPath: `/api/staff/formal-orders/${encodeURIComponent(orderId)}/communication-screenshots/intents`,
        lifecyclePrefix: '/api/staff',
        purpose: 'ORDER_COMMUNICATION_SCREENSHOT',
        visibility: 'SELLER_VISIBLE',
        maximumFileCount: 8,
        maximumByteSize: COMMUNICATION_UPLOAD_LIMIT_BYTES,
        allowedMimes: COMMUNICATION_ALLOWED_MIMES,
      };
      const selection = validateFileSelection(workflow, [file])[0]!;
      const idempotencyKey = crypto.randomUUID();
      const intent = await createPurposeBoundUploadIntent({
        client,
        workflow,
        files: [selection],
        idempotencyKey,
        signal: new AbortController().signal,
      });
      const slot = intent.data.uploads[0]!;
      const uploaded = await uploadSingleFileMultipart({
        client,
        identity: 'staff',
        lifecyclePrefix: '/api/staff',
        intentId: intent.data.upload_intent_id,
        fileObjectId: slot.file_object_id,
        file: selection.file,
        uploadToken: slot.upload_token ?? '',
        idempotencyKey: crypto.randomUUID(),
        signal: new AbortController().signal,
        onProgress: () => undefined,
      });
      const completed = await completePurposeBoundUploadIntent({
        client,
        workflow,
        intentId: intent.data.upload_intent_id,
        expectedVersion: intent.data.version,
        uploadedReceipts: new Map([
          [
            slot.file_object_id,
            {
              detectedMime: uploaded.data.detected_mime,
              byteSize: uploaded.data.byte_size,
              sha256: uploaded.data.sha256,
              uploadedVersion: uploaded.data.version,
            },
          ],
        ]),
        idempotencyKey: crypto.randomUUID(),
        signal: new AbortController().signal,
      });
      const verified = completed.data.files[0]!;
      const attachBody = {
        file_object_id: verified.file_object_id,
        expected_file_version: verified.version,
      };
      return identityApiRequest('staff', client, {
        path: `/api/staff/formal-orders/${encodeURIComponent(orderId)}/communication-screenshots`,
        method: 'POST',
        schema: communicationAttachSchema,
        body: attachBody,
        headers: operationHeaders({ key: idempotencyKey, body: attachBody }),
      });
    },
    onSuccess: () => {
      setMessage('沟通截图已上传并挂到本订单。');
      void client.invalidateQueries({ queryKey: ['staff', 'formal-order-detail', orderId] });
    },
    onError: (error) => {
      setMessage(
        `上传未完成${isFrontendApiError(error) ? `（${error.code}）` : ''}，请重试。`,
      );
    },
  });

  function onPick(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!file) return;
    if (!COMMUNICATION_ALLOWED_MIMES.includes(file.type as (typeof COMMUNICATION_ALLOWED_MIMES)[number])) {
      setMessage('仅支持 JPG、PNG 或 WebP 图片。');
      return;
    }
    if (file.size > COMMUNICATION_UPLOAD_LIMIT_BYTES) {
      setMessage('图片超过 5 MiB，请压缩后重试。');
      return;
    }
    setMessage(null);
    setPendingFile(file);
  }

  function confirmUpload(): void {
    if (!pendingFile) return;
    const file = pendingFile;
    setPendingFile(null);
    upload.mutate(file);
  }

  return (
    <Card className="internal-note">
      <h3>订单沟通截图（{value.communication_screenshots.length}）</h3>
      <p>与买家、卖家的微信沟通截图统一挂在本订单上；卖家组织成员可见，买家不可见。</p>
      {value.communication_screenshots.length === 0 ? (
        <p>暂无沟通截图。</p>
      ) : (
        <div className="buyer-chat-screenshots order-communication-screenshots">
          {value.communication_screenshots.map((reference) => (
            <StaffProtectedImage
              key={reference.file_object_id}
              reference={reference}
              alt="订单沟通截图"
              className="protected-evidence-thumbnail"
              fallback={<span className="protected-image-placeholder">截图加载中</span>}
            />
          ))}
        </div>
      )}
      {canUpload ? (
        <>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={onPick}
          />
          <div className="entry-actions">
            <Button
              className="secondary"
              loading={upload.isPending}
              onClick={() => fileInput.current?.click()}
            >
              上传沟通截图
            </Button>
          </div>
          {pendingFile ? (
            <Dialog
              open
              title="上传沟通截图"
              description={`将上传 ${pendingFile.name} 并挂到本订单；一单可多张。`}
              busy={upload.isPending}
              onClose={() => setPendingFile(null)}
            >
              <div className="entry-actions">
                <Button className="secondary" onClick={() => setPendingFile(null)}>
                  取消
                </Button>
                <Button onClick={confirmUpload}>确认上传</Button>
              </div>
            </Dialog>
          ) : null}
        </>
      ) : null}
      {message ? (
        <Alert tone={upload.isSuccess ? 'success' : 'info'}>{message}</Alert>
      ) : null}
      {upload.isError ? (
        <RequestIdDisplay requestId={isFrontendApiError(upload.error) ? upload.error.requestId : null} />
      ) : null}
    </Card>
  );
}

function TimelineCard({ value }: { value: StaffFormalOrderDetail }): React.JSX.Element {
  type Node = { at: number; title: string; detail: string | null; tone: 'normal' | 'warning' };
  const nodes: Node[] = [
    {
      at: value.order.confirmed_at,
      title: '订单确认',
      detail: '订单资料审核通过，冻结计价配置',
      tone: 'normal',
    },
  ];
  for (const event of value.operational_events)
    nodes.push({
      at: event.created_at,
      title: OPERATIONAL_EVENT_LABELS[event.event_type] ?? event.event_type,
      detail: event.reason,
      tone: 'warning',
    });
  for (const adjustment of value.financial_adjustments ?? [])
    nodes.push({
      at: adjustment.created_at,
      title: ADJUSTMENT_SCOPE_LABELS[adjustment.adjustment_scope] ?? adjustment.adjustment_scope,
      detail: `${adjustment.reason}（${fenToYuan(adjustment.amount_cny_fen)}）`,
      tone: 'warning',
    });
  nodes.sort((left, right) => left.at - right.at);
  return (
    <Card className="customer-visible">
      <h3>全链路时间线</h3>
      <ol className="staff-order-timeline">
        {nodes.map((node, index) => (
          <li
            key={`${node.at}-${index}`}
            className={node.tone === 'warning' ? 'staff-order-timeline-warning' : ''}
          >
            <strong>{node.title}</strong>
            <time dateTime={new Date(node.at).toISOString()}>{formatShanghai(node.at)}</time>
            {node.detail ? <span>{node.detail}</span> : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/**
 * 权限化操作区：运营事件（owner/seller_ops）、提前返本金（owner/buyer_refund）、
 * 人工财务调整（owner + FINANCIAL_CORRECT）。后端逐次校验，前端只做入口收敛。
 */
function OrderOperationBlocks({
  orderId,
  value,
}: {
  orderId: string;
  value: StaffFormalOrderDetail;
}): React.JSX.Element | null {
  const session = useCurrentStaffSession();
  const role = session.role.code;
  const canRecordEvent = role === 'owner' || role === 'seller_ops';
  const canAdvance = role === 'owner' || role === 'buyer_refund';
  const canAdjust = role === 'owner' && session.permissions.includes('FINANCIAL_CORRECT');
  if (!canRecordEvent && !canAdvance && !canAdjust) return null;
  return (
    <section className="staff-order-operations" aria-labelledby="staff-order-operations-title">
      <h3 id="staff-order-operations-title">订单操作</h3>
      {canRecordEvent ? <OrderEventBlock orderId={orderId} /> : null}
      {canAdvance ? (
        <AdvanceBlock
          orderId={orderId}
          // 权威全额来自不可变财务快照；无快照投影时保持失败关闭，不接受客户端金额。
          authoritativeAmountCnyFen={
            value.financial_snapshot?.buyer_expected_principal_cny_fen ?? null
          }
        />
      ) : null}
      {canAdjust ? <FinancialAdjustmentBlock orderId={orderId} /> : null}
    </section>
  );
}

function OrderEventBlock({ orderId }: { orderId: string }): React.JSX.Element {
  const client = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const event = useMutation({
    mutationFn: (request: { body: unknown; key: string }) =>
      identityApiRequest('staff', client, {
        path: `/api/staff/order-integrity/${encodeURIComponent(orderId)}/events`,
        method: 'POST',
        schema: eventMutationSchema,
        body: request.body,
        headers: operationHeaders({ key: request.key, body: request.body }),
      }),
    onSuccess: () => {
      setMessage('订单状态已记录。');
      void client.invalidateQueries({ queryKey: ['staff', 'formal-order-detail', orderId] });
    },
  });
  return (
    <Card>
      <h4>记录订单后续异常</h4>
      <form
        onSubmit={(formEvent: FormEvent<HTMLFormElement>) => {
          formEvent.preventDefault();
          const data = new FormData(formEvent.currentTarget);
          event.mutate({
            body: {
              event_type: String(data.get('event_type')),
              reason: String(data.get('reason')),
            },
            key: crypto.randomUUID(),
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
        <Button loading={event.isPending}>记录订单状态</Button>
      </form>
      {message ? <Alert tone="success">{message}</Alert> : null}
      {event.isError ? <MutationErrorAlert error={event.error} /> : null}
    </Card>
  );
}

function AdvanceBlock({
  orderId,
  authoritativeAmountCnyFen,
}: {
  orderId: string;
  authoritativeAmountCnyFen: string | null;
}): React.JSX.Element {
  const client = useQueryClient();
  const [uploader, upload] = useFileUpload();
  const [confirmAdvance, setConfirmAdvance] = useState<{ body: unknown; key: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const advanceEntries = useQuery({
    queryKey: ['staff', 'buyer-advance-principal', orderId],
    queryFn: ({ signal }) =>
      identityApiRequest('staff', client, {
        path: `/api/staff/buyer-advance-principal/${encodeURIComponent(orderId)}`,
        method: 'GET',
        schema: advanceEntriesSchema,
        signal,
      }).then((response) => response.data.entries),
    retry: false,
  });
  const activeAdvance = (advanceEntries.data ?? []).find((entry) => entry.reversed_at === null) ?? null;
  const advance = useMutation({
    mutationFn: (request: { body: unknown; key: string }) =>
      identityApiRequest('staff', client, {
        path: `/api/staff/buyer-advance-principal/${encodeURIComponent(orderId)}/payments`,
        method: 'POST',
        schema: advanceMutationSchema,
        body: request.body,
        headers: operationHeaders({ key: request.key, body: request.body }),
      }),
    onSuccess: () => {
      setConfirmAdvance(null);
      setMessage('全额提前返本金和付款凭证已记录。正式返款义务形成后系统会自动抵扣。');
      void client.invalidateQueries({ queryKey: ['staff', 'formal-order-detail', orderId] });
    },
  });
  const reverseAdvance = useMutation({
    mutationFn: (request: { reason: string; key: string }) =>
      identityApiRequest('staff', client, {
        path: `/api/staff/buyer-advance-principal/${encodeURIComponent(orderId)}/payments/${encodeURIComponent(activeAdvance!.entry_id)}/reversals`,
        method: 'POST',
        schema: advanceReversalSchema,
        body: { reason: request.reason },
        headers: operationHeaders({ key: request.key, body: { reason: request.reason } }),
      }),
    onSuccess: () => {
      setMessage('提前返本金已整笔冲正；需要时可重新录入一笔全额付款。');
      void client.invalidateQueries({ queryKey: ['staff', 'formal-order-detail', orderId] });
      void client.invalidateQueries({ queryKey: ['staff', 'buyer-advance-principal', orderId] });
    },
  });
  return (
    <Card>
      <h4>提前返本金</h4>
      {activeAdvance ? (
        <p>
          已有一笔未冲正的提前返本金：{formatCny(activeAdvance.amount_cny_fen)}（
          {formatShanghai(activeAdvance.paid_at)} · {activeAdvance.payment_channel}）
        </p>
      ) : null}
      {authoritativeAmountCnyFen === null ? (
        <Alert tone="info">
          当前岗位读取不到本订单的权威返款全额（财务快照仅 Owner 可见），不能记录付款。
        </Alert>
      ) : (
        <>
          <p>
            <strong>本次全额付款：{formatCny(authoritativeAmountCnyFen)}</strong>
          </p>
          <p>金额由订单财务快照锁定，不支持分批提前返。</p>
          <FileDropZone
            id="advance-proof"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            maximumFiles={1}
            maximumBytes={20 * 1024 * 1024}
            buttonLabel="选择付款凭证"
            emptyLabel="尚未选择付款凭证"
            onFilesChange={(files) => {
              const file = files[0];
              if (file) void uploader.start('staffBuyerRefundProof', [file]);
            }}
          />
          <p className="staff-upload-state">
            凭证状态：{upload.state === 'VERIFIED' ? '已验证' : upload.state}
          </p>
          <form
            onSubmit={(formEvent: FormEvent<HTMLFormElement>) => {
              formEvent.preventDefault();
              const data = new FormData(formEvent.currentTarget);
              const file = upload.manifest?.files[0];
              if (!file) {
                setMessage('请先上传并完成验证付款凭证。');
                return;
              }
              setConfirmAdvance({
                body: {
                  paid_at: Date.now(),
                  payment_channel: String(data.get('payment_channel')),
                  note: String(data.get('note') ?? '').trim() || null,
                  proof_files: [
                    { file_object_id: file.file_object_id, expected_file_version: file.file_version },
                  ],
                },
                key: crypto.randomUUID(),
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
            <Button className="danger" loading={advance.isPending} disabled={upload.state !== 'VERIFIED'}>
              准备记录全额提前本金
            </Button>
          </form>
          {activeAdvance ? (
            <form
              onSubmit={(formEvent: FormEvent<HTMLFormElement>) => {
                formEvent.preventDefault();
                const reason = String(new FormData(formEvent.currentTarget).get('reason') ?? '').trim();
                if (reason) reverseAdvance.mutate({ reason, key: crypto.randomUUID() });
              }}
            >
              <FormField label="整笔冲正原因" htmlFor="advance-reversal-reason">
                <TextInput id="advance-reversal-reason" name="reason" minLength={3} required />
              </FormField>
              <Button className="danger" loading={reverseAdvance.isPending}>
                整笔冲正提前返本金
              </Button>
            </form>
          ) : null}
        </>
      )}
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
      {message ? <Alert tone="success">{message}</Alert> : null}
      {advance.isError ? <MutationErrorAlert error={advance.error} /> : null}
      {reverseAdvance.isError ? <MutationErrorAlert error={reverseAdvance.error} /> : null}
    </Card>
  );
}

function FinancialAdjustmentBlock({ orderId }: { orderId: string }): React.JSX.Element {
  const client = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const adjustment = useMutation({
    mutationFn: (request: { body: unknown; key: string }) =>
      identityApiRequest('staff', client, {
        path: `/api/staff/order-integrity/${encodeURIComponent(orderId)}/financial-adjustments`,
        method: 'POST',
        schema: adjustmentMutationSchema,
        body: request.body,
        headers: operationHeaders({ key: request.key, body: request.body }),
      }),
    onSuccess: () => {
      setMessage('公司利润补偿已追加；原财务快照没有修改。');
      void client.invalidateQueries({ queryKey: ['staff', 'formal-order-detail', orderId] });
    },
  });
  return (
    <Card>
      <h4>公司利润补偿（仅总管理员）</h4>
      <Alert tone="warning">
        这里只修正公司预计/完成利润的经营视图，不直接改卖家本金、服务费或买家返款账本。
      </Alert>
      <form
        onSubmit={(formEvent: FormEvent<HTMLFormElement>) => {
          formEvent.preventDefault();
          const data = new FormData(formEvent.currentTarget);
          adjustment.mutate({
            body: {
              adjustment_scope: String(data.get('scope')),
              amount_cny_fen: String(data.get('amount')),
              reason: String(data.get('reason')),
              source_operational_event_id: null,
            },
            key: crypto.randomUUID(),
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
        <Button className="danger" loading={adjustment.isPending}>
          追加利润补偿
        </Button>
      </form>
      {message ? <Alert tone="success">{message}</Alert> : null}
      {adjustment.isError ? <MutationErrorAlert error={adjustment.error} /> : null}
    </Card>
  );
}

function MutationErrorAlert({ error }: { error: unknown }): React.JSX.Element {
  const outcome = describeStaffMutationError(error);
  return (
    <Alert tone="danger">
      操作未完成{outcome.code ? `（错误码：${outcome.code}）` : ''}：{outcome.hint}
      <RequestIdDisplay requestId={isFrontendApiError(error) ? error.requestId : null} />
    </Alert>
  );
}
