import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Alert, Button, Card, Dialog, EmptyState, MetricCard, PageHeader, StatusBadge } from '../../ui/primitives';
import { useBuyerMutation } from '../../buyer/mutations/useBuyerMutation';
import { BuyerMutationRecovery } from '../../buyer/shared/BuyerMutationRecovery';
import { ProtectedFileButton } from '../../buyer/shared/ProtectedFileButton';
import { SellerOrderChatScreenshotReadIntentAdapter } from '../../files/file-read-providers';
import { CursorPagination } from '../../ui/CursorPagination';
import { sellerApi } from '../api/client';
import { sellerQueryKeys } from '../queries/keys';
import { useSellerCursorPages } from '../queries/useSellerCursorPages';
import { useSellerStoreContext } from '../routes/SellerLayout';

const shanghai = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
const cny = (fen: string): string => {
  const value = BigInt(fen);
  return `¥${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
};
const money = (amount: string, currency: string, exponent: number): string => {
  const value = BigInt(amount);
  if (exponent === 0) return `${value} ${currency}`;
  const scale = 10n ** BigInt(exponent);
  return `${value / scale}.${(value % scale).toString().padStart(exponent, '0')} ${currency}`;
};
const rate = (value: string, scale: string, source: string): string => {
  const numerator = BigInt(value); const denominator = BigInt(scale);
  const precision = 6n; const multiplier = 10n ** precision;
  const scaled = (numerator * multiplier) / denominator;
  const fraction = (scaled % multiplier).toString().padStart(Number(precision), '0').replace(/0+$/u, '');
  return `1 ${source} = ${scaled / multiplier}${fraction ? `.${fraction}` : ''} CNY`;
};
const formatShanghai = (value: number): string => `${shanghai.format(new Date(value))}（日本时间）`;
const componentLabel = { PENDING: '待完成', COMPLETE: '已完成', NOT_APPLICABLE: '不适用' } as const;
const productStatusLabel = { ACTIVE: '启用中', DISABLED: '已停用' } as const;
const applicationStatusLabel = { SUBMITTED: '待审核', APPROVED: '已通过', REJECTED: '未通过', WITHDRAWN: '已撤回' } as const;
const demandStatusLabel = { SUBMITTED: '待审核', PUBLISHED: '已发布', REJECTED: '未通过', WITHDRAWN: '已撤回', CLOSED: '已关闭' } as const;
const reviewStatusLabel = { PENDING_REVIEW: '待审核', CHANGES_REQUESTED: '需修改', REJECTED: '未通过', WITHDRAWN: '已撤回', APPROVED: '已通过' } as const;
const payableStatusLabel = { UNPAID: '待结算', PARTIALLY_PAID: '部分结算', PAID: '已完成' } as const;
const taskTypeLabel = { RATING: '评分评价', TEXT: '文字评价', IMAGE: '图文评价', VIDEO: '视频评价' } as const;
const marketplaceLabel = {
  AMAZON_JP: '日本站', AMAZON_US: '美国站', COUPANG_KR: '韩国站',
  RAKUTEN_JP: '乐天日本站（未接入）', TIKTOK_JP: 'TikTok 日本站（未接入）',
} as const;
const roleLabel = {
  OWNER: '负责人',
  OPERATIONS: '运营成员',
  FINANCE: '财务成员',
  VIEWER: '查看成员',
} as const;
type Tone = 'neutral' | 'processing' | 'success' | 'warning' | 'danger';

function tone(status: string): Tone {
  if (['ACTIVE', 'APPROVED', 'PUBLISHED', 'PAID', 'COMPLETE'].includes(status)) return 'success';
  if (['REJECTED'].includes(status)) return 'danger';
  if (['CHANGES_REQUESTED', 'PARTIALLY_PAID'].includes(status)) return 'warning';
  if (['WITHDRAWN', 'CLOSED', 'DISABLED'].includes(status)) return 'neutral';
  return 'processing';
}

function RecordCard({ title, meta, status, statusTone, children, actions }: {
  title: string; meta: string; status: string; statusTone: Tone; children: ReactNode; actions?: ReactNode;
}): React.JSX.Element {
  return <Card as="article" className="seller-record-card">
    <header className="seller-record-heading"><div><h2>{title}</h2><p>{meta}</p></div><StatusBadge tone={statusTone}>{status}</StatusBadge></header>
    {children}
    {actions ? <div className="seller-record-actions">{actions}</div> : null}
  </Card>;
}

function FactGrid({ children }: { children: ReactNode }): React.JSX.Element {
  return <dl className="seller-record-facts">{children}</dl>;
}

function Fact({ label, value }: { label: string; value: ReactNode }): React.JSX.Element {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

export function SellerDashboardPage(): React.JSX.Element {
  const client = useQueryClient(); const { storeId } = useSellerStoreContext();
  const me = useQuery({ queryKey: sellerQueryKeys.me, queryFn: ({ signal }) => sellerApi.me(client, signal).then((r) => r.data.me) });
  const orders = useSellerCursorPages({
    resetKey: `seller-orders:${storeId ?? 'all'}:100`,
    queryKey: (cursor) => sellerQueryKeys.ordersPage(storeId, cursor),
    queryFn: (cursor, signal) => sellerApi.orders(client, storeId, cursor, signal),
  });
  const settlement = useQuery({ queryKey: sellerQueryKeys.settlement, queryFn: ({ signal }) => sellerApi.settlement(client, signal).then((r) => r.data.settlement) });
  const complete = orders.items.filter((item) => item.business_completion?.status === 'COMPLETE').length;
  const inProgress = orders.items.filter((item) => item.business_completion?.status === 'IN_PROGRESS');
  const ordersUnavailable = orders.initialError !== null;
  const count = (value: number): string => `${value}${orders.hasMore ? '+' : ''}`;
  return <section className="seller-page seller-dashboard-page">
    <PageHeader title="业务进度" eyebrow="当前授权范围">
      {me.data?.access.can_submit_product_applications ? <Link className="button secondary" to="/seller/products/new">提交产品申请</Link> : null}
      {me.data?.access.can_submit_demand_batches ? <Link className="button" to="/seller/demands/new">提交需求</Link> : null}
    </PageHeader>
    {orders.initialError || settlement.isError ? <Alert tone="danger">业务摘要暂时无法完整读取，请刷新后重试。</Alert> : null}
    <div className="seller-metrics"><MetricCard label="正式订单" value={orders.isInitialPending || ordersUnavailable ? '—' : count(orders.items.length)} detail={ordersUnavailable ? '订单数据暂时不可用' : orders.hasMore ? '当前已加载，仍有后一页' : '当前授权范围'} /><MetricCard label="业务完成" value={orders.isInitialPending || ordersUnavailable ? '—' : count(complete)} detail={ordersUnavailable ? '订单数据暂时不可用' : orders.hasMore ? '当前已加载订单，非最终总数' : '四项均完成或不适用'} /><MetricCard label="待结算" value={settlement.data ? cny(settlement.data.total_outstanding_cny_fen) : '—'} detail="卖家本金与卖家服务费" /></div>
    <Card className="seller-attention-card"><div className="seller-section-heading"><div><p className="eyebrow">待关注</p><h2>订单进度</h2></div><Link to="/seller/orders">查看全部订单</Link></div>
      {orders.isInitialPending ? <p role="status">读取订单进度中…</p> : ordersUnavailable ? <Alert tone="warning">订单进度暂时不可用，刷新后重试。</Alert> : inProgress.length === 0 && !orders.hasMore ? <EmptyState title="暂无待完成订单" description="当前授权范围内没有待办事项。" /> : inProgress.length === 0 ? <Alert tone="info">当前已加载的订单没有待办项，后面还有，去订单页继续看。</Alert> : <ul className="seller-attention-list">{inProgress.slice(0, 4).map((item) => <li key={item.formal_order_id}><span><strong>{item.product_name}</strong><small>{item.store.display_name} · {item.platform_order_identifier}</small></span><StatusBadge tone="processing">进行中</StatusBadge></li>)}</ul>}
    </Card>
  </section>;
}

export function SellerProductsPage(): React.JSX.Element {
  const client = useQueryClient(); const { storeId } = useSellerStoreContext();
  const [pendingWithdraw, setPendingWithdraw] = useState<{ id: string; version: number } | null>(null);
  const me = useQuery({ queryKey: sellerQueryKeys.me, queryFn: ({ signal }) => sellerApi.me(client, signal).then((r) => r.data.me) });
  const products = useSellerCursorPages({
    resetKey: `seller-products:${storeId ?? 'all'}:100`,
    queryKey: (cursor) => sellerQueryKeys.productsPage(storeId, cursor),
    queryFn: (cursor, signal) => sellerApi.products(client, storeId, cursor, signal),
  });
  const applications = useSellerCursorPages({
    resetKey: `seller-applications:${storeId ?? 'all'}:100`,
    queryKey: (cursor) => sellerQueryKeys.applicationsPage(storeId, cursor),
    queryFn: (cursor, signal) => sellerApi.applications(client, storeId, cursor, signal),
  });
  const withdraw = useBuyerMutation({ operation: (body: { id: string; version: number }, key, signal) => sellerApi.withdrawApplication(client, body.id, body.version, key, signal), onSuccess: async () => { await client.invalidateQueries({ queryKey: sellerQueryKeys.applications(storeId) }); setPendingWithdraw(null); } });
  const pending = products.isInitialPending || applications.isInitialPending;
  const failed = products.initialError || applications.initialError;
  return <section className="seller-page"><PageHeader title="商品与申请" eyebrow="商品资料">
    {me.data?.access.can_submit_product_applications ? <Link className="button" to="/seller/products/new">提交产品申请</Link> : null}
  </PageHeader>
    {pending ? <p role="status">加载中…</p> : failed ? <><Alert tone="danger">暂时加载不了商品与申请。</Alert><Button type="button" className="secondary" onClick={() => { products.retryInitial(); applications.retryInitial(); }}>重新加载</Button></> : products.items.length === 0 && applications.items.length === 0 ? <EmptyState title="暂无商品与申请" description="提交后可以在这儿看审核状态。" /> : <div className="seller-record-list">
      {products.items.map((item) => <RecordCard key={item.id} title={item.current_version.product_name} meta={`${item.store.display_name} · ${item.asin}`} status={productStatusLabel[item.status]} statusTone={tone(item.status)}>
        <FactGrid><Fact label="类型" value="已通过商品" /><Fact label="版本" value={`v${item.current_version_no}`} /><Fact label="搜索词" value={item.current_version.search_keywords.join('、') || '未填'} /><Fact label="更新时间" value={formatShanghai(item.updated_at)} /></FactGrid>
      </RecordCard>)}
      {applications.items.map((item) => <RecordCard key={item.id} title={item.product_name} meta={`${item.store.display_name} · ${item.asin}`} status={applicationStatusLabel[item.status]} statusTone={tone(item.status)} actions={<><Link className="button secondary" to={`/seller/products/${item.id}`}>查看申请</Link>{item.status === 'SUBMITTED' && me.data?.access.can_submit_product_applications ? <Button className="danger" onClick={() => setPendingWithdraw({ id: item.id, version: item.version })}>撤回申请</Button> : null}</>}>
        <FactGrid><Fact label="类型" value="产品申请" /><Fact label="提交时间" value={formatShanghai(item.submitted_at)} /><Fact label="搜索词" value={item.search_keywords.join('、') || '未填'} /><Fact label="审核说明" value={item.review_reason ?? '暂无'} /></FactGrid>
      </RecordCard>)}
    </div>}
    <CursorPagination {...products} onLoadMore={products.loadMore} onRetry={products.retryLater}
      loadLabel="加载更多商品" loadingLabel="正在加载更多商品" retryLabel="重试商品列表"
      errorMessage="后一页商品暂时无法读取，已加载商品仍会保留。" />
    <CursorPagination {...applications} onLoadMore={applications.loadMore} onRetry={applications.retryLater}
      loadLabel="加载更多申请" loadingLabel="正在加载更多申请" retryLabel="重试申请列表"
      errorMessage="后一页申请暂时无法读取，已加载申请仍会保留。" />
    <Dialog open={pendingWithdraw !== null} title="撤回产品申请" description="撤回后，这份申请就没法继续审核了。" busy={withdraw.isPending} onClose={() => setPendingWithdraw(null)}>
      <BuyerMutationRecovery mutation={withdraw} onRefresh={() => { setPendingWithdraw(null); applications.retryInitial(); }} />
      <div className="entry-actions"><Button className="secondary" onClick={() => setPendingWithdraw(null)}>取消</Button><Button className="danger" loading={withdraw.isPending} onClick={() => { if (pendingWithdraw) withdraw.mutate(pendingWithdraw); }}>确认撤回</Button></div>
    </Dialog>
  </section>;
}

export function SellerDemandsPage(): React.JSX.Element {
  const client = useQueryClient(); const { storeId } = useSellerStoreContext();
  const [pendingWithdraw, setPendingWithdraw] = useState<{ id: string; version: number } | null>(null);
  const me = useQuery({ queryKey: sellerQueryKeys.me, queryFn: ({ signal }) => sellerApi.me(client, signal).then((r) => r.data.me) });
  const demands = useSellerCursorPages({
    resetKey: `seller-demands:${storeId ?? 'all'}:100`,
    queryKey: (cursor) => sellerQueryKeys.demandsPage(storeId, cursor),
    queryFn: (cursor, signal) => sellerApi.demands(client, storeId, cursor, signal),
  });
  const withdraw = useBuyerMutation({ operation: (body: { id: string; version: number }, key, signal) => sellerApi.withdrawDemand(client, body.id, body.version, key, signal), onSuccess: async () => { await client.invalidateQueries({ queryKey: sellerQueryKeys.demands(storeId) }); setPendingWithdraw(null); } });
  return <section className="seller-page"><PageHeader title="需求批次" eyebrow="数量计划">{me.data?.access.can_submit_demand_batches ? <Link className="button" to="/seller/demands/new">提交需求</Link> : null}</PageHeader>
    {demands.isInitialPending ? <p role="status">加载中…</p> : demands.initialError ? <><Alert tone="danger">暂时加载不了需求批次。</Alert><Button type="button" className="secondary" onClick={demands.retryInitial}>重新加载</Button></> : demands.items.length === 0 ? <EmptyState title="暂无需求批次" description="选好已通过的产品就能提交新需求。" /> : <div className="seller-record-list">{demands.items.map((item) => <RecordCard key={item.id} title={item.product.product_name} meta={`${item.store.display_name} · ${item.product.asin}`} status={demandStatusLabel[item.status]} statusTone={tone(item.status)} actions={item.status === 'SUBMITTED' && me.data?.access.can_submit_demand_batches ? <Button className="danger" onClick={() => setPendingWithdraw({ id: item.id, version: item.version })}>撤回需求</Button> : null}>
      <FactGrid><Fact label="评价类型" value={taskTypeLabel[item.task_type]} /><Fact label="目标数量" value={item.target_quantity} /><Fact label="已批准" value={item.approved_quantity} /><Fact label="剩余名额" value={item.remaining_quantity} /><Fact label="开放时间" value={formatShanghai(item.open_at)} /><Fact label="预约截止" value={formatShanghai(item.reservation_deadline)} /><Fact label="下单截止" value={formatShanghai(item.order_deadline)} /><Fact label="审核说明" value={item.review_reason ?? item.close_reason ?? '暂无'} /></FactGrid>
    </RecordCard>)}</div>}
    <CursorPagination {...demands} onLoadMore={demands.loadMore} onRetry={demands.retryLater}
      loadLabel="加载更多需求" loadingLabel="正在加载更多需求" retryLabel="重试需求列表"
      errorMessage="后一页需求暂时无法读取，已加载需求仍会保留。" />
    <Dialog open={pendingWithdraw !== null} title="撤回需求" description="撤回后当前需求将不再继续审核。" busy={withdraw.isPending} onClose={() => setPendingWithdraw(null)}>
      <BuyerMutationRecovery mutation={withdraw} onRefresh={() => { setPendingWithdraw(null); demands.retryInitial(); }} />
      <div className="entry-actions"><Button className="secondary" onClick={() => setPendingWithdraw(null)}>取消</Button><Button className="danger" loading={withdraw.isPending} onClick={() => { if (pendingWithdraw) withdraw.mutate(pendingWithdraw); }}>确认撤回</Button></div>
    </Dialog>
  </section>;
}

export function SellerProductApplicationDetailPage(): React.JSX.Element {
  const { applicationId = '' } = useParams(); const client = useQueryClient();
  const query = useQuery({ queryKey: sellerQueryKeys.application(applicationId), queryFn: ({ signal }) => sellerApi.application(client, applicationId, signal).then((r) => r.data.application), enabled: applicationId.length > 0 });
  if (query.isPending) return <section className="seller-page"><p role="status">加载中…</p></section>;
  if (query.isError || !query.data) return <section className="seller-page"><EmptyState title="无法打开产品申请" description="请返回列表刷新后重试。" /></section>;
  const item = query.data;
  return <section className="seller-page"><PageHeader title="产品申请" eyebrow="申请详情"><Link className="button secondary" to="/seller/products">返回商品与申请</Link></PageHeader>
    <RecordCard title={item.product_name} meta={`${item.store.display_name} · ${item.asin}`} status={applicationStatusLabel[item.status]} statusTone={tone(item.status)}>
      <FactGrid><Fact label="搜索词" value={item.search_keywords.join('、') || '未填写'} /><Fact label="提交时间" value={formatShanghai(item.submitted_at)} /><Fact label="更新时间" value={formatShanghai(item.updated_at)} /><Fact label="审核时间" value={item.reviewed_at ? formatShanghai(item.reviewed_at) : '暂无'} /><Fact label="产品链接" value={item.product_url ? <a href={item.product_url} rel="noreferrer" target="_blank">打开产品页面</a> : '未填写'} /><Fact label="审核说明" value={item.review_reason ?? '暂无'} /><Fact label="买家说明" value={item.buyer_visible_notes ?? '未填写'} /><Fact label="备注" value={item.seller_notes ?? '未填写'} /></FactGrid>
    </RecordCard>
  </section>;
}

export function SellerReviewsPage(): React.JSX.Element {
  const client = useQueryClient(); const { storeId } = useSellerStoreContext();
  const reviews = useSellerCursorPages({
    resetKey: `seller-reviews:${storeId ?? 'all'}:100`,
    queryKey: (cursor) => sellerQueryKeys.reviewsPage(storeId, cursor),
    queryFn: (cursor, signal) => sellerApi.reviews(client, storeId, cursor, signal),
  });
  return <section className="seller-page"><PageHeader title="评论" eyebrow="评论进度" />
    {reviews.isInitialPending ? <p role="status">加载中…</p> : reviews.initialError ? <Alert tone="danger">暂时加载不了评论。</Alert> : reviews.items.length === 0 ? <EmptyState title="暂无评论" description="评论资料提交后会显示在这里。" /> : <div className="seller-record-list">{reviews.items.map((item) => <RecordCard key={item.review_case_id} title={item.product_name} meta={`${item.store.display_name} · ${item.formal_order.amazon_order_number}`} status={reviewStatusLabel[item.status]} statusTone={tone(item.status)}>
      <FactGrid><Fact label="产品标识" value={item.asin} /><Fact label="评价类型" value={taskTypeLabel[item.review_type]} /><Fact label="提交时间" value={formatShanghai(item.submitted_at)} /><Fact label="通过时间" value={item.approved_at ? formatShanghai(item.approved_at) : '暂无'} /><Fact label="资料数量" value={`${item.evidence.files.length} 份`} /><Fact label="卖家服务费" value={item.service_fee_accrued ? cny(item.service_fee_accrued.amount_cny_fen) : '尚未产生'} /></FactGrid>
    </RecordCard>)}</div>}
    <CursorPagination {...reviews} onLoadMore={reviews.loadMore} onRetry={reviews.retryLater}
      loadLabel="加载更多评论" loadingLabel="正在加载更多评论" retryLabel="重试评论列表"
      errorMessage="后一页评论暂时无法读取，已加载评论仍会保留。" />
  </section>;
}

export function SellerOrdersPage(): React.JSX.Element {
  const client = useQueryClient(); const { storeId } = useSellerStoreContext();
  const query = useSellerCursorPages({
    resetKey: `seller-orders:${storeId ?? 'all'}:100`,
    queryKey: (cursor) => sellerQueryKeys.ordersPage(storeId, cursor),
    queryFn: (cursor, signal) => sellerApi.orders(client, storeId, cursor, signal),
  });
  return <section className="seller-page"><PageHeader title="订单与业务完成" eyebrow="正式订单" />
    {query.isInitialPending ? <p role="status">加载中…</p> : query.initialError ? <Alert tone="danger">暂时加载不了正式订单。</Alert> : query.items.length === 0 ? <EmptyState title="暂无正式订单" description="正式订单确认后会显示在这里。" /> : <div className="seller-record-list">{query.items.map((item) => <RecordCard key={item.formal_order_id} title={item.product_name} meta={`${item.store.display_name} · ${item.platform_order_identifier}`} status={item.business_completion ? (item.business_completion.status === 'COMPLETE' ? '业务完成' : '进行中') : '平台基础记录'} statusTone={item.business_completion ? tone(item.business_completion.status) : 'neutral'}>
      <FactGrid><Fact label="站点" value={marketplaceLabel[item.canonical_marketplace_code]} /><Fact label="平台订单号" value={item.platform_order_identifier} /><Fact label="平台产品号" value={item.platform_product_identifier} />{item.payment ? <Fact label="买家支付" value={money(item.payment.amount_minor, item.payment.currency_code, item.payment.currency_exponent)} /> : <Fact label="买家支付" value="待后续导入" />}{item.seller_expected_principal_cny_fen !== null ? <Fact label="卖家本金" value={cny(item.seller_expected_principal_cny_fen)} /> : <Fact label="卖家本金" value="待后续导入" />}{item.locked_service_fee_snapshot ? <Fact label="卖家服务费" value={cny(item.locked_service_fee_snapshot.service_fee_cny_fen)} /> : <Fact label="卖家服务费" value="待后续导入" />}{item.seller_principal_rate_snapshot ? <><Fact label="平台下单日期" value={item.seller_principal_rate_snapshot.platform_order_date} /><Fact label="基准汇率" value={rate(item.seller_principal_rate_snapshot.base_rate_value, item.seller_principal_rate_snapshot.base_rate_scale, item.seller_principal_rate_snapshot.payment_currency_code)} /><Fact label="汇率加点" value={rate(item.seller_principal_rate_snapshot.markup_rate_value, item.seller_principal_rate_snapshot.markup_rate_scale, item.seller_principal_rate_snapshot.payment_currency_code)} /><Fact label="最终汇率" value={rate(item.seller_principal_rate_snapshot.final_rate_value, item.seller_principal_rate_snapshot.final_rate_scale, item.seller_principal_rate_snapshot.payment_currency_code)} /><Fact label="策略版本" value={`v${item.seller_principal_rate_snapshot.policy_version_no}`} /></> : item.seller_agreement_rate_snapshot ? <><Fact label="协议汇率" value={rate(item.seller_agreement_rate_snapshot.rate_value, item.seller_agreement_rate_snapshot.rate_scale, item.seller_agreement_rate_snapshot.source_currency_code)} /><Fact label="协议版本" value={`v${item.seller_agreement_rate_snapshot.version_no}`} /></> : <Fact label="汇率" value="待后续导入" />}<Fact label="评价类型" value={item.review_type ? taskTypeLabel[item.review_type] : '待后续导入'} /><Fact label="确认时间" value={formatShanghai(item.confirmed_at)} /><Fact label="聊天截图" value={<SellerChatScreenshotControl formalOrderId={item.formal_order_id} status={item.chat_screenshot.status} version={item.chat_screenshot.file_version} />} /></FactGrid>
      {item.business_completion ? <ul className="completion-grid"><li><span>评论</span><strong>{componentLabel[item.business_completion.review]}</strong></li><li><span>买家返款</span><strong>{componentLabel[item.business_completion.buyer_refund]}</strong></li><li><span>卖家本金</span><strong>{componentLabel[item.business_completion.seller_principal]}</strong></li><li><span>卖家服务费</span><strong>{componentLabel[item.business_completion.seller_service_fee]}</strong></li></ul> : <Alert tone="warning">该平台目前仅承载正式订单身份；财务与业务流程数据待后续导入。</Alert>}
    </RecordCard>)}</div>}
    <CursorPagination {...query} onLoadMore={query.loadMore} onRetry={query.retryLater}
      loadLabel="加载更多正式订单" loadingLabel="正在加载更多正式订单" retryLabel="重试正式订单列表"
      errorMessage="后一页正式订单暂时无法读取，已加载订单仍会保留。" />
  </section>;
}

function SellerChatScreenshotControl({
  formalOrderId,
  status,
  version,
}: {
  formalOrderId: string;
  status: 'AVAILABLE' | 'NONE';
  version: number | null;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const provider = useMemo(
    () => status === 'AVAILABLE' && version !== null
      ? new SellerOrderChatScreenshotReadIntentAdapter(formalOrderId, version)
      : null,
    [formalOrderId, status, version],
  );
  if (!provider) return <span>暂无聊天截图</span>;
  return <span className="seller-chat-screenshot-control">
    <span>已上传</span>
    <Button
      className="secondary"
      aria-expanded={expanded}
      onClick={() => setExpanded((value) => !value)}
    >{expanded ? '收起聊天截图' : '展开聊天截图'}</Button>
    {expanded
      ? <ProtectedFileButton provider={provider} label="查看聊天截图" />
      : null}
  </span>;
}

export function SellerSettlementsPage(): React.JSX.Element {
  const client = useQueryClient();
  const summary = useQuery({ queryKey: sellerQueryKeys.settlement, queryFn: ({ signal }) => sellerApi.settlement(client, signal).then((r) => r.data.settlement) });
  const payables = useSellerCursorPages({
    resetKey: 'seller-payables:100',
    queryKey: sellerQueryKeys.payablesPage,
    queryFn: (cursor, signal) => sellerApi.payables(client, cursor, signal),
  });
  return <section className="seller-page"><PageHeader title="本金与服务费" eyebrow="结算" />
    {summary.isError || payables.initialError ? <Alert tone="danger">结算信息暂时无法完整读取，请刷新后重试。</Alert> : null}
    <div className="seller-metrics"><MetricCard label="待结卖家本金" value={summary.data ? cny(summary.data.outstanding_principal_cny_fen) : '—'} /><MetricCard label="待结卖家服务费" value={summary.data ? cny(summary.data.outstanding_service_fee_cny_fen) : '—'} /><MetricCard label="未分配来款" value={summary.data ? cny(summary.data.unallocated_credit_cny_fen) : '—'} /></div>
    {payables.isInitialPending ? <p role="status">加载中…</p> : payables.initialError ? <Alert tone="warning">结算项目暂时用不了，刷新后重试。</Alert> : payables.items.length === 0 ? <EmptyState title="暂无结算项目" description="产生卖家本金或服务费后会显示在这里。" /> : <div className="seller-record-list">{payables.items.map((item) => <RecordCard key={item.payable_id} title={item.product.name} meta={`${item.store.display_name} · ${item.amazon_order_number}`} status={payableStatusLabel[item.status]} statusTone={tone(item.status)}>
      <FactGrid><Fact label="结算项目" value={item.payable_type === 'SELLER_PRINCIPAL' ? '卖家本金' : '卖家服务费'} /><Fact label="应结" value={cny(item.due_amount_cny_fen)} /><Fact label="已结" value={cny(item.paid_amount_cny_fen)} /><Fact label="未结" value={cny(item.outstanding_amount_cny_fen)} /><Fact label="应结时间" value={formatShanghai(item.due_at)} /><Fact label="产品标识" value={item.product.asin} /></FactGrid>
    </RecordCard>)}</div>}
    <CursorPagination {...payables} onLoadMore={payables.loadMore} onRetry={payables.retryLater}
      loadLabel="加载更多结算项目" loadingLabel="正在加载更多结算项目" retryLabel="重试结算项目"
      errorMessage="后一页结算项目暂时无法读取，已加载项目仍会保留。" />
  </section>;
}

export function SellerSettingsPage(): React.JSX.Element {
  const client = useQueryClient();
  const me = useQuery({ queryKey: sellerQueryKeys.me, queryFn: ({ signal }) => sellerApi.me(client, signal).then((r) => r.data.me) });
  return <section className="seller-page"><PageHeader title="账户" eyebrow="账户安全" />
    <Card className="seller-account-card"><div><h2>{me.data?.member.display_name ?? '正在读取账户'}</h2><p>{me.data ? `${roleLabel[me.data.member.role]} · ${me.data.organization.name}` : '请稍候'}</p></div><Link className="button" to="/seller/change-password">修改密码</Link></Card>
  </section>;
}
