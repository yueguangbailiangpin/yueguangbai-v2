import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { isFrontendApiError } from '../api/errors';
import { StaffCustomerSecurityPanel } from '../auth/staff/StaffCustomerSecurityPanel';
import { useFileUpload } from '../buyer/shared/useFileUpload';
import {
  Alert, Button, Card, EmptyState, FormField, RequestIdDisplay,
  Select, StatusBadge, TextInput,
} from '../ui/primitives';
import { staffApi } from './api/client';
import type { StaffBuyerRefund, StaffOrderEvidence, StaffReview, StaffWorkItem } from './contracts/runtime';
import { staffWorkbenchKeys } from './queries/keys';
import { StaffMutationAuthority, type StaffMutationRequest } from './mutations/StaffMutationAuthority';
import { formatCny, formatShanghai } from './shared/format';
import { StaffProtectedFileButton } from './shared/StaffProtectedFileButton';

const workLabels: Record<StaffWorkItem['work_type'], string> = {
  PRODUCT_APPLICATION_REVIEW: '商品申请审核', DEMAND_REVIEW: '需求审核', RESERVATION_DECISION: '预约处理',
  ORDER_INSTRUCTION_PUBLISH: '下单指引发布', ORDER_EVIDENCE_REVIEW: '订单证据核对',
  REVIEW_DECISION: '评论审核', BUYER_REFUND_PROCESSING: '买家返款',
};

export function StaffWorkbench(): React.JSX.Element {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [parameters, setParameters] = useSearchParams();
  const status = parameters.get('status') ?? 'OPEN';
  const workType = parameters.get('work_type');
  const selectedId = parameters.get('work_item');
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([]);
  const query = useQuery({
    queryKey: staffWorkbenchKeys.queue(status, workType, cursor),
    queryFn: ({ signal }) => staffApi.workItems(client, { status, workType, cursor }, signal).then((response) => response.data),
  });
  const selected = query.data?.work_items.find((item) => item.work_item_id === selectedId) ?? null;

  function changeFilter(name: 'status' | 'work_type', value: string): void {
    const next = new URLSearchParams(parameters);
    value ? next.set(name, value) : next.delete(name);
    next.delete('work_item'); setCursor(null); setCursorHistory([]); setParameters(next);
  }
  function select(item: StaffWorkItem): void {
    const next = new URLSearchParams(parameters); next.set('work_item', item.work_item_id); setParameters(next);
    navigate({ pathname: `/staff/work/${encodeURIComponent(item.work_item_id)}`, search: `?${next}` });
  }

  return <main className="staff-panes staff-workbench">
    <section className="staff-queue" aria-labelledby="staff-queue-title">
      <div className="pane-heading"><h2 id="staff-queue-title">待处理队列</h2>
        <StatusBadge tone={query.data?.work_items.length ? 'processing' : 'neutral'}>{query.data?.work_items.length ?? 0} 项（本页）</StatusBadge></div>
      <div className="staff-filter-grid" role="search" aria-label="工作队列筛选">
        <label htmlFor="staff-work-status">状态<Select id="staff-work-status" value={status} onChange={(event) => changeFilter('status', event.target.value)}>
          <option value="OPEN">待处理</option><option value="COMPLETED">已完成</option><option value="CANCELLED">已取消</option>
        </Select></label>
        <label htmlFor="staff-work-type">类型<Select id="staff-work-type" value={workType ?? ''} onChange={(event) => changeFilter('work_type', event.target.value)}>
          <option value="">全部类型</option>{Object.entries(workLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select></label>
      </div>
      {query.isPending ? <p role="status">正在加载工作队列</p>
        : query.isError ? <PanelError error={query.error} retry={() => { void query.refetch(); }} />
        : query.data.work_items.length === 0 ? <EmptyState title="当前队列为空" description="没有符合当前权限、范围和筛选条件的工作项。" />
        : <ol className="staff-work-list">{query.data.work_items.map((item) => <li key={item.work_item_id}>
          <button type="button" className={item.work_item_id === selectedId ? 'staff-work-item selected' : 'staff-work-item'} onClick={() => select(item)}>
            <span className="staff-work-item-heading"><strong>{workLabels[item.work_type]}</strong>
              <StatusBadge tone={item.status === 'OPEN' ? 'warning' : item.status === 'COMPLETED' ? 'success' : 'neutral'}>
                {item.status === 'OPEN' ? '待处理' : item.status === 'COMPLETED' ? '已完成' : '已取消'}
              </StatusBadge></span>
            <span>编号：{item.source_entity_id}</span>
            <small>创建：{formatShanghai(item.created_at)}</small><small>负责人：{item.assigned_staff_id}</small>
          </button></li>)}</ol>}
      <nav className="pagination-actions" aria-label="工作队列分页">
        <Button className="secondary" disabled={cursorHistory.length === 0} onClick={() => {
          const previous = cursorHistory.at(-1) ?? null; setCursor(previous); setCursorHistory((all) => all.slice(0, -1));
        }}>上一页</Button>
        <Button className="secondary" disabled={!query.data?.next_cursor} onClick={() => {
          setCursorHistory((all) => [...all, cursor]); setCursor(query.data?.next_cursor ?? null);
        }}>下一页</Button>
      </nav>
    </section>
    <section className="staff-detail" aria-labelledby="staff-detail-title">
      <div className="pane-heading"><h2 id="staff-detail-title">详情</h2>
        <StatusBadge tone={selected ? 'processing' : 'neutral'}>{selected ? workLabels[selected.work_type] : '等待选择'}</StatusBadge></div>
      {selected ? <WorkItemDetail item={selected} /> : <EmptyState title="请选择工作项" description="队列上下文会保留，详情和操作只显示服务器允许的事实。" />}
    </section>
    <aside className="staff-actions" aria-labelledby="staff-tools-title">
      <h2 id="staff-tools-title">客户安全与账户</h2>
      <StaffCustomerSecurityPanel />
    </aside>
  </main>;
}

function WorkItemDetail({ item }: { item: StaffWorkItem }): React.JSX.Element {
  if (item.work_type === 'DEMAND_REVIEW') return <DemandReviewPanel id={item.source_entity_id} />;
  if (item.work_type === 'ORDER_EVIDENCE_REVIEW') return <OrderEvidencePanel id={item.source_entity_id} />;
  if (item.work_type === 'REVIEW_DECISION') return <ReviewPanel id={item.source_entity_id} />;
  if (item.work_type === 'BUYER_REFUND_PROCESSING') return <RefundPanel id={item.source_entity_id} />;
  if (item.seller_organization_id) return <SellerSettlementPanel organizationId={item.seller_organization_id} item={item} />;
  return <><Card className="customer-visible"><h3>工作项事实</h3><Fact label="来源类型" value={item.source_entity_type} /><Fact label="来源编号" value={item.source_entity_id} /><Fact label="状态" value={item.status} /></Card>
    <Card className="internal-note"><h3>内部处理</h3><p>当前后端没有为此工作类型冻结独立详情读取合同；工作台不会猜测资源或发明操作。</p></Card></>;
}

function DemandReviewPanel({ id }: { id: string }): React.JSX.Element {
  const client = useQueryClient();
  const authority = useMemo(() => new StaffMutationAuthority(), []);
  const query = useQuery({
    queryKey: staffWorkbenchKeys.demandReview(id),
    queryFn: ({ signal }) => staffApi.demandReviewContext(client, id, signal)
      .then((response) => response.data.review_context),
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (request: StaffMutationRequest | null) => request === null
      ? authority.retry()
      : authority.execute(request, ({ body }, key) =>
          staffApi.reviewDemand(client, id, body, key)),
    onSuccess: () => { void client.invalidateQueries({ queryKey: staffWorkbenchKeys.queueRoot }); },
  });
  if (query.isPending) return <p role="status">正在加载需求审核事实</p>;
  if (query.isError) return <PanelError error={query.error} retry={() => { void query.refetch(); }} />;
  const value = query.data;
  const cadence = value.cadence
    ? `每隔 ${value.cadence.order_interval_days} 个自然日，每次 ${value.cadence.orders_per_run} 单`
    : '尚未配置排期';
  return <><Card className="customer-visible"><h3>需求发布事实</h3>
    <Fact label="产品" value={`${value.product_name} · 版本 ${value.product_version_no}`} />
    <Fact label="需求版本" value={`v${value.demand_version}`} />
    <Fact label="目标数量" value={`${value.target_quantity} 单`} />
    <Fact label="产品节奏" value={cadence} />
    <Fact label="预约截止" value={formatShanghai(value.reservation_deadline)} />
    <Fact label="下单截止" value={formatShanghai(value.order_deadline)} />
  </Card><Card className="sensitive-action"><h3>审核并发布需求</h3>
    <Alert tone="info">首个下单日期按北京时间填写；周六、周日及节假日均按自然日连续计入。</Alert>
    {value.can_publish ? <form onSubmit={(event) => {
      event.preventDefault();
      const firstOrderDate = String(new FormData(event.currentTarget)
        .get('first_order_date') ?? '');
      mutation.mutate({ action: 'publish-demand', path: `/api/staff/demand-batches/${encodeURIComponent(id)}/review`,
        body: { expected_version: value.demand_version, decision: 'PUBLISH', first_order_date: firstOrderDate } });
    }}><FormField label="首个下单日期" htmlFor={`demand-first-order-${id}`}>
      <TextInput id={`demand-first-order-${id}`} name="first_order_date" type="date" required />
    </FormField><Button className="danger" disabled={mutation.isPending || value.cadence === null}>确认发布需求</Button></form>
      : <Alert tone="warning">当前权限可拒绝需求，但不能发布并创建首个排期。</Alert>}
    <form onSubmit={(event) => {
      event.preventDefault();
      const rejectionReason = String(new FormData(event.currentTarget)
        .get('rejection_reason') ?? '');
      mutation.mutate({ action: 'reject-demand', path: `/api/staff/demand-batches/${encodeURIComponent(id)}/review`,
        body: { expected_version: value.demand_version, decision: 'REJECT', rejection_reason: rejectionReason } });
    }}><FormField label="拒绝原因" htmlFor={`demand-rejection-${id}`}>
      <TextInput id={`demand-rejection-${id}`} name="rejection_reason" required maxLength={1000} />
    </FormField><Button className="secondary" disabled={mutation.isPending}>拒绝需求</Button></form>
    {mutation.isSuccess ? <Alert tone="success">{mutation.variables?.action === 'publish-demand'
      ? '需求已发布并锁定首个下单日期与产品节奏。' : '需求已拒绝并保留审核事实。'}</Alert> : null}
    {mutation.isError ? <MutationError error={mutation.error} canRetry={authority.canRetry()}
      retry={() => mutation.mutate(null)} refresh={() => { mutation.reset(); void query.refetch(); }} /> : null}
  </Card></>;
}

function OrderEvidencePanel({ id }: { id: string }): React.JSX.Element {
  const client = useQueryClient();
  const query = useQuery({ queryKey: staffWorkbenchKeys.orderEvidence(id), queryFn: ({ signal }) => staffApi.orderEvidence(client, id, signal).then((r) => r.data.order_evidence) });
  if (query.isPending) return <p role="status">正在加载订单证据</p>;
  if (query.isError) return <PanelError error={query.error} retry={() => { void query.refetch(); }} />;
  return <><OrderEvidenceFacts value={query.data} /><OrderEvidenceActions value={query.data} refresh={() => query.refetch()} /></>;
}

function OrderEvidenceFacts({ value }: { value: StaffOrderEvidence }): React.JSX.Element {
  return <><Card className="customer-visible"><h3>客户可见内容</h3>
    <Fact label="订单号" value={value.amazon_order_number_normalized} /><Fact label="订单日期" value={value.amazon_order_date ?? '未知'} />
    <Fact label="买家最终支付" value={`${value.final_paid_jpy} JPY`} /><Fact label="买家备注" value={value.buyer_note ?? '无'} />
    <StaffProtectedFileButton reference={value.screenshot} label="查看订单截图" />
  </Card><Card className="internal-note"><h3>内部内容</h3>
    <Fact label="参考金额" value={`${value.reference_order_amount_jpy} JPY`} /><Fact label="价差" value={`${value.price_difference_jpy} JPY`} />
    <Fact label="证据版本" value={`v${value.version}`} /><Fact label="重复信号" value={String(value.duplicate_signal_count)} />
    <Fact label="内部备注" value={value.internal_review_note ?? '无'} />
  </Card></>;
}

function OrderEvidenceActions({ value, refresh }: { value: StaffOrderEvidence; refresh: () => Promise<unknown> }): React.JSX.Element {
  const client = useQueryClient(); const authority = useMemo(() => new StaffMutationAuthority(), []);
  const mutation = useMutation({ mutationFn: (request: StaffMutationRequest | null) => request === null
    ? authority.retry()
    : authority.execute(request, ({ action, body }, key) => staffApi.mutateOrderEvidence(
      client, value.submission_id, action as 'approve' | 'request-changes', body, key,
    )), onSuccess: () => { void refresh(); } });
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const action = (submitter?.getAttribute('value') ?? '') as 'approve' | 'request-changes';
    const internal = String(data.get('internal_note') ?? '').trim();
    const body = action === 'approve' ? { expected_version: value.version, ...(internal ? { internal_note: internal } : {}),
      ...(value.price_mismatch ? { price_mismatch_acknowledged: data.get('ack') === 'on', price_mismatch_reason: String(data.get('mismatch_reason') ?? '') } : {}) }
      : { expected_version: value.version, public_reason: String(data.get('public_reason') ?? ''), ...(internal ? { internal_note: internal } : {}) };
    mutation.mutate({ action, path: `/api/staff/order-evidence/${encodeURIComponent(value.submission_id)}/${action}`, body });
  }
  return <Card className="sensitive-action"><h3>受控操作</h3><form onSubmit={submit}>
    <FormField label="客户可见的修改原因" htmlFor="order-public-reason"><TextInput id="order-public-reason" name="public_reason" /></FormField>
    <FormField label="内部备注" htmlFor="order-internal-note"><TextInput id="order-internal-note" name="internal_note" /></FormField>
    {value.price_mismatch ? <><label><input type="checkbox" name="ack" /> 已核对截图并确认价差</label><FormField label="价差确认原因" htmlFor="mismatch-reason"><TextInput id="mismatch-reason" name="mismatch_reason" /></FormField></> : null}
    <div className="entry-actions"><Button name="action" value="request-changes" disabled={mutation.isPending}>要求修改</Button><Button className="danger" name="action" value="approve" disabled={mutation.isPending}>确认并形成正式订单</Button></div>
  </form>{mutation.isError ? <MutationError error={mutation.error} canRetry={authority.canRetry()} retry={() => mutation.mutate(null)} refresh={() => { mutation.reset(); void refresh(); }} /> : null}</Card>;
}

function ReviewPanel({ id }: { id: string }): React.JSX.Element {
  const client = useQueryClient(); const authority = useMemo(() => new StaffMutationAuthority(), []);
  const query = useQuery({ queryKey: staffWorkbenchKeys.review(id), queryFn: ({ signal }) => staffApi.review(client, id, signal).then((r) => r.data.review) });
  const mutation = useMutation({ mutationFn: (request: StaffMutationRequest | null) => request === null
    ? authority.retry()
    : authority.execute(request, ({ action, body }, key) => staffApi.mutateReview(
      client, id, action as 'approve' | 'reject' | 'request-changes', body, key,
    )), onSuccess: () => { void query.refetch(); } });
  if (query.isPending) return <p role="status">正在加载评论资料</p>;
  if (query.isError) return <PanelError error={query.error} retry={() => { void query.refetch(); }} />;
  const value = query.data;
  return <><ReviewFacts value={value} /><Card className="sensitive-action"><h3>评论正式确认</h3><form onSubmit={(event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const action = (submitter?.getAttribute('value') ?? '') as 'approve' | 'reject' | 'request-changes';
    const publicReason = String(data.get('public_reason') ?? '').trim(); const internal = String(data.get('internal_note') ?? '').trim();
    mutation.mutate({ action, path: `/api/staff/reviews/${encodeURIComponent(id)}/${action}`,
      body: action === 'approve' ? { expected_version: value.version, ...(internal ? { internal_note: internal } : {}) }
        : { expected_version: value.version, public_reason: publicReason, ...(internal ? { internal_note: internal } : {}) } });
  }}><FormField label="客户可见原因（拒绝/要求修改时必填）" htmlFor="review-public"><TextInput id="review-public" name="public_reason" /></FormField>
    <FormField label="内部备注" htmlFor="review-internal"><TextInput id="review-internal" name="internal_note" /></FormField>
    <div className="entry-actions"><Button name="action" value="request-changes">要求修改</Button><Button name="action" value="reject" className="secondary">拒绝</Button><Button name="action" value="approve" className="danger">确认通过</Button></div></form>
    {mutation.isError ? <MutationError error={mutation.error} canRetry={authority.canRetry()} retry={() => mutation.mutate(null)} refresh={() => { mutation.reset(); void query.refetch(); }} /> : null}</Card></>;
}

function ReviewFacts({ value }: { value: StaffReview }): React.JSX.Element {
  return <><Card className="customer-visible"><h3>客户提交内容</h3><Fact label="评论类型" value={value.review_type} /><Fact label="评论链接" value={value.current_evidence.review_url ?? '无'} /><Fact label="买家备注" value={value.current_evidence.buyer_note ?? '无'} />
    {value.current_evidence.files.map((file) => <StaffProtectedFileButton key={file.file_object_id} reference={file} label={`查看 ${file.client_file_name}`} />)}</Card>
    <Card className="internal-note"><h3>内部内容</h3><Fact label="状态/版本" value={`${value.status} / v${value.version}`} /><Fact label="正式订单" value={value.formal_order_id} /><Fact label="内部审核备注" value={value.internal_review_note ?? '无'} /></Card></>;
}

function RefundPanel({ id }: { id: string }): React.JSX.Element {
  const client = useQueryClient(); const [uploader, upload] = useFileUpload(); const authority = useMemo(() => new StaffMutationAuthority(), []);
  const query = useQuery({ queryKey: staffWorkbenchKeys.refund(id), queryFn: ({ signal }) => staffApi.buyerRefund(client, id, signal).then((r) => r.data.buyer_refund) });
  const payment = useMutation({ mutationFn: (request: StaffMutationRequest | null) => request === null
    ? authority.retry()
    : authority.execute(request, ({ body }, key) => staffApi.recordRefundPayment(client, id, body, key)), onSuccess: () => { void query.refetch(); } });
  const reversal = useMutation({ mutationFn: (request: StaffMutationRequest | null) => request === null
    ? authority.retry()
    : authority.execute(request, ({ path, body }, key) => {
      const paymentId = decodeURIComponent(path.split('/').at(-2)!);
      return staffApi.reverseRefundPayment(client, id, paymentId, body, key);
    }), onSuccess: () => { void query.refetch(); } });
  if (query.isPending) return <p role="status">正在加载买家返款</p>;
  if (query.isError) return <PanelError error={query.error} retry={() => { void query.refetch(); }} />;
  const value = query.data;
  return <><Card className="customer-visible"><h3>买家返款事实</h3><Fact label="订单号" value={value.order.amazon_order_number_normalized} /><Fact label="应返" value={formatCny(value.due_amount_cny_fen)} /><Fact label="已返净额" value={formatCny(value.net_paid_cny_fen)} /><Fact label="待返" value={formatCny(value.outstanding_amount_cny_fen)} /></Card>
    <Card className="internal-note"><h3>付款与冲正记录</h3>{value.payments.map((entry) => <section key={entry.payment_entry_id}><Fact label="付款" value={`${formatCny(entry.amount_cny_fen)} · ${formatShanghai(entry.paid_at)}`} />{entry.proofs.map((proof) => <StaffProtectedFileButton key={proof.file_object_id} reference={proof} label="查看返款凭证" />)}
      <form onSubmit={(event) => { event.preventDefault(); payment.reset(); const data = new FormData(event.currentTarget); reversal.mutate({ action: 'reverse-refund-payment', path: `/api/staff/buyer-refunds/${encodeURIComponent(id)}/payments/${encodeURIComponent(entry.payment_entry_id)}/reversals`, body: { expected_version: value.version, amount_cny_fen: String(data.get('amount')), reversed_at: Date.now(), reason: String(data.get('reason')) } }); }}>
        <FormField label="冲正金额（分）" htmlFor={`reverse-${entry.payment_entry_id}`}><TextInput id={`reverse-${entry.payment_entry_id}`} name="amount" inputMode="numeric" /></FormField><FormField label="冲正原因" htmlFor={`reason-${entry.payment_entry_id}`}><TextInput id={`reason-${entry.payment_entry_id}`} name="reason" /></FormField><Button className="danger">追加冲正事实</Button>
      </form></section>)}</Card>
    <Card className="sensitive-action"><h3>记录买家返款</h3><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploader.start('staffBuyerRefundProof', [file]); }} />
      <p role="status">凭证状态：{upload.state}</p><form onSubmit={(event) => { event.preventDefault(); reversal.reset(); const file = upload.manifest?.files[0]; if (!file) return; const data = new FormData(event.currentTarget); const paidAt = Date.now(); const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(paidAt)); payment.mutate({ action: 'record-refund-payment', path: `/api/staff/buyer-refunds/${encodeURIComponent(id)}/payments`, body: { expected_version: value.version, amount_cny_fen: String(data.get('amount')), paid_at: paidAt, china_business_date: date, payment_channel: String(data.get('channel')), public_note: String(data.get('public_note') ?? ''), internal_note: String(data.get('internal_note') ?? ''), proof_files: [{ file_object_id: file.file_object_id, expected_file_version: file.file_version }] } }); }}>
        <FormField label="实际返款（人民币分）" htmlFor="refund-amount"><TextInput id="refund-amount" name="amount" inputMode="numeric" required /></FormField><label htmlFor="refund-channel">渠道</label><Select id="refund-channel" name="channel"><option value="WECHAT">微信</option><option value="ALIPAY">支付宝</option><option value="BANK_TRANSFER">银行转账</option><option value="OTHER_MANUAL">其他人工方式</option></Select>
        <FormField label="客户可见备注" htmlFor="refund-public"><TextInput id="refund-public" name="public_note" /></FormField><FormField label="内部备注" htmlFor="refund-internal"><TextInput id="refund-internal" name="internal_note" /></FormField><Button className="danger" disabled={upload.state !== 'VERIFIED' || payment.isPending}>确认记录返款</Button>
      </form>{payment.isError ? <MutationError error={payment.error} canRetry={authority.canRetry()} retry={() => payment.mutate(null)} refresh={() => { payment.reset(); void query.refetch(); }} /> : null}{reversal.isError ? <MutationError error={reversal.error} canRetry={authority.canRetry()} retry={() => reversal.mutate(null)} refresh={() => { reversal.reset(); void query.refetch(); }} /> : null}</Card></>;
}

function SellerSettlementPanel({ organizationId, item }: { organizationId: string; item: StaffWorkItem }): React.JSX.Element {
  const client = useQueryClient(); const [uploader, upload] = useFileUpload(); const authority = useMemo(() => new StaffMutationAuthority(), []);
  const summary = useQuery({ queryKey: staffWorkbenchKeys.settlement(organizationId), queryFn: ({ signal }) => staffApi.settlementSummary(client, organizationId, signal).then((r) => r.data.settlement) });
  const payables = useQuery({ queryKey: staffWorkbenchKeys.payables(organizationId), queryFn: ({ signal }) => staffApi.settlementPayables(client, organizationId, signal).then((r) => r.data.items) });
  const payments = useQuery({ queryKey: staffWorkbenchKeys.payments(organizationId), queryFn: ({ signal }) => staffApi.settlementPayments(client, organizationId, signal).then((r) => r.data.items) });
  const mutation = useMutation({ mutationFn: (request: StaffMutationRequest | null) => request === null
    ? authority.retry()
    : authority.execute(request, ({ action, path, body }, key) => {
      const paymentId = decodeURIComponent(path.split('/').at(-2)!);
      if (action === 'record-seller-payment') return staffApi.recordSellerPayment(client, organizationId, body, key);
      if (action === 'allocate-seller-payment') return staffApi.allocateSellerPayment(client, paymentId, body, key);
      if (action === 'reverse-seller-payment') return staffApi.reverseSellerPayment(client, paymentId, body, key);
      throw new Error('INVALID_SETTLEMENT_ACTION');
    }), onSuccess: () => { void Promise.all([summary.refetch(), payables.refetch(), payments.refetch()]); } });
  return <><Card className="customer-visible"><h3>卖家组织上下文</h3><Fact label="组织" value={organizationId} /><Fact label="店铺" value={item.store_id ?? '当前工作项未绑定店铺'} /><Fact label="Marketplace" value="以业务详情返回事实为准；韩国站不可用" /></Card>
    {summary.isError ? <PanelError error={summary.error} retry={() => { void summary.refetch(); }} /> : <div className="finance-separation"><Card><h3>卖家本金</h3><p>{summary.data ? formatCny(summary.data.outstanding_principal_cny_fen) : '加载中'}</p></Card><Card><h3>卖家服务费</h3><p>{summary.data ? formatCny(summary.data.outstanding_service_fee_cny_fen) : '加载中'}</p></Card></div>}
    {payables.isError ? <PanelError error={payables.error} retry={() => { void payables.refetch(); }} /> : <Card className="internal-note"><h3>独立应结项目</h3>{payables.data?.map((row) => <section key={row.payable_id}><strong>{row.payable_type === 'SELLER_PRINCIPAL' ? '本金' : '服务费'}</strong><p>{formatCny(row.outstanding_amount_cny_fen)} · {row.status}</p></section>)}</Card>}
    {payments.isError ? <PanelError error={payments.error} retry={() => { void payments.refetch(); }} /> : <Card className="internal-note"><h3>付款、分配与凭证</h3>{payments.data?.length === 0 ? <p>暂无付款事实。</p> : payments.data?.map((payment) => <section key={payment.payment_id}>
      <Fact label="付款" value={`${formatCny(payment.amount_cny_fen)} · ${formatShanghai(payment.paid_at)} · ${payment.status}`} />
      <StaffProtectedFileButton reference={payment.proof} label="查看卖家结算凭证" />
      {payment.status !== 'REVERSED' && payment.unallocated_amount_cny_fen !== '0' ? <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); mutation.mutate({ action: 'allocate-seller-payment', path: `/api/staff/seller-payments/${encodeURIComponent(payment.payment_id)}/allocations`, body: { payable_id: String(data.get('payable_id')), amount_cny_fen: String(data.get('amount')), expected_payment_version: payment.version } }); }}>
        <label htmlFor={`payable-${payment.payment_id}`}>分配至本金或服务费项目</label><Select id={`payable-${payment.payment_id}`} name="payable_id" required><option value="">请选择</option>{payables.data?.filter((row) => row.status !== 'PAID').map((row) => <option key={row.payable_id} value={row.payable_id}>{row.payable_type === 'SELLER_PRINCIPAL' ? '本金' : '服务费'} · {row.amazon_order_number} · {formatCny(row.outstanding_amount_cny_fen)}</option>)}</Select>
        <FormField label="分配金额（人民币分）" htmlFor={`allocation-${payment.payment_id}`}><TextInput id={`allocation-${payment.payment_id}`} name="amount" inputMode="numeric" required /></FormField><Button className="danger" disabled={mutation.isPending}>确认分配</Button>
      </form> : null}
      {payment.status !== 'REVERSED' && payment.allocated_amount_cny_fen === '0' ? <form onSubmit={(event) => { event.preventDefault(); const reason = String(new FormData(event.currentTarget).get('reason')); mutation.mutate({ action: 'reverse-seller-payment', path: `/api/staff/seller-payments/${encodeURIComponent(payment.payment_id)}/reverse`, body: { expected_version: payment.version, reason } }); }}><FormField label="整笔冲正原因" htmlFor={`payment-reason-${payment.payment_id}`}><TextInput id={`payment-reason-${payment.payment_id}`} name="reason" required /></FormField><Button className="danger" disabled={mutation.isPending}>整笔冲正</Button></form> : null}
    </section>)}</Card>}
    <Card className="sensitive-action"><h3>记录卖家付款</h3><Alert tone="info">付款入账后再明确分配到本金或服务费；两类应结事实不会合并。</Alert><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploader.start('staffSellerSettlementProof', [file]); }} /><p role="status">凭证状态：{upload.state}</p>
      <form onSubmit={(event) => { event.preventDefault(); const file = upload.manifest?.files[0]; if (!file) return; const data = new FormData(event.currentTarget); mutation.mutate({ action: 'record-seller-payment', path: `/api/staff/seller-settlements/${encodeURIComponent(organizationId)}/payments`, body: { amount_cny_fen: String(data.get('amount')), paid_at: Date.now(), proof_file: { file_object_id: file.file_object_id, expected_file_version: file.file_version } } }); }}><FormField label="付款金额（人民币分）" htmlFor="seller-payment-amount"><TextInput id="seller-payment-amount" name="amount" inputMode="numeric" required /></FormField><Button className="danger" disabled={upload.state !== 'VERIFIED' || mutation.isPending}>确认记录卖家付款</Button></form>
      {mutation.isError ? <MutationError error={mutation.error} canRetry={authority.canRetry()} retry={() => mutation.mutate(null)} refresh={() => { mutation.reset(); void Promise.all([summary.refetch(), payables.refetch(), payments.refetch()]); }} /> : null}</Card></>;
}

function Fact({ label, value }: { label: string; value: string }): React.JSX.Element { return <dl className="staff-fact"><dt>{label}</dt><dd>{value}</dd></dl>; }
function MutationError({ error, canRetry, retry, refresh }: { error: unknown; canRetry: boolean; retry: () => void; refresh: () => void }): React.JSX.Element {
  return <PanelError error={error} retry={canRetry ? retry : refresh} retryLabel={canRetry ? '重试原请求' : '刷新服务器事实'} />;
}
function PanelError({ error, retry, retryLabel = '重试' }: { error: unknown; retry: () => void; retryLabel?: string }): React.JSX.Element {
  const requestId = isFrontendApiError(error) ? error.requestId : null;
  const hidden = isFrontendApiError(error) && error.httpStatus === 404;
  return <div role="alert" className="state"><h3>{hidden ? '资源不存在或当前无权访问' : '当前面板加载失败'}</h3><p>{hidden ? '为保护客户与组织信息，系统不会透露范围外资源。' : '其他面板仍可继续使用，请按需重试。'}</p><RequestIdDisplay requestId={requestId} /><Button className="secondary" onClick={retry}>{retryLabel}</Button></div>;
}
