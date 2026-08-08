import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, Card, Dialog, EmptyState, MetricCard, PageHeader, StatusBadge } from '../../ui/primitives';
import { useBuyerMutation } from '../../buyer/mutations/useBuyerMutation';
import { BuyerMutationRecovery } from '../../buyer/shared/BuyerMutationRecovery';
import { sellerApi } from '../api/client';
import type {
  SellerDemandStatus,
  SellerProductStatus,
  SellerReviewStatus,
} from '../contracts/runtime';
import { sellerQueryKeys } from '../queries/keys';
import { useSellerStoreContext } from '../routes/SellerLayout';

const cny = (fen: string): string => `¥${(BigInt(fen) / 100n).toString()}.${(BigInt(fen) % 100n).toString().padStart(2, '0')}`;
const money = (amount: string, currency: string, exponent: number): string => exponent === 0 ? `${amount} ${currency}` : `${amount.slice(0, -2) || '0'}.${amount.slice(-2).padStart(2, '0')} ${currency}`;
const componentLabel = { PENDING: '待完成', COMPLETE: '已完成', NOT_APPLICABLE: '不适用' } as const;
const productStatusLabel = {
  ACTIVE: '启用中', DISABLED: '已停用',
} as const satisfies Record<SellerProductStatus, string>;
const demandStatusLabel = {
  SUBMITTED: '待审核', PUBLISHED: '已发布', REJECTED: '未通过',
  WITHDRAWN: '已撤回', CLOSED: '已关闭',
} as const satisfies Record<SellerDemandStatus, string>;
const reviewStatusLabel = {
  PENDING_REVIEW: '待审核', CHANGES_REQUESTED: '需修改', REJECTED: '未通过',
  WITHDRAWN: '已撤回', APPROVED: '已通过',
} as const satisfies Record<SellerReviewStatus, string>;
const sellerStatusLabel = {
  ...productStatusLabel, ...demandStatusLabel, ...reviewStatusLabel,
} as const;

export function SellerDashboardPage(): React.JSX.Element {
  const client = useQueryClient(); const { storeId } = useSellerStoreContext();
  const orders = useQuery({ queryKey: sellerQueryKeys.orders(storeId), queryFn: ({ signal }) => sellerApi.orders(client, storeId, signal).then((r) => r.data.items) });
  const settlement = useQuery({ queryKey: sellerQueryKeys.settlement, queryFn: ({ signal }) => sellerApi.settlement(client, signal).then((r) => r.data.settlement) });
  const complete = orders.data?.filter((item) => item.business_completion.status === 'COMPLETE').length ?? 0;
  return <section className="seller-page"><PageHeader title="业务进度" />
    <div className="seller-metrics"><MetricCard label="正式订单" value={String(orders.data?.length ?? '—')} detail="当前返回范围" /><MetricCard label="业务完成" value={String(complete)} detail="四项均完成或不适用" /><MetricCard label="待结算" value={settlement.data ? cny(settlement.data.total_outstanding_cny_fen) : '—'} detail="本金与服务费独立核算" /></div>
    <Card><h2>接下来关注</h2>{orders.data?.some((item) => item.business_completion.status === 'IN_PROGRESS') ? <p>仍有订单存在未完成评论、买家返款、本金或服务费。请进入订单查看真实进度。</p> : <EmptyState title="暂无待完成订单" description="当前返回范围内没有待完成事项。" />}<Link className="button" to="/seller/orders">查看订单</Link></Card>
  </section>;
}

function SimpleRecords({ kind }: { kind: 'products' | 'demands' | 'reviews' }): React.JSX.Element {
  const client = useQueryClient(); const { storeId } = useSellerStoreContext();
  const query = useQuery({ queryKey: sellerQueryKeys[kind](storeId), queryFn: ({ signal }) => sellerApi[kind](client, storeId, signal).then((r) => r.data.items) });
  const me = useQuery({ queryKey: sellerQueryKeys.me, queryFn: ({ signal }) => sellerApi.me(client, signal).then((r) => r.data.me), enabled: kind !== 'reviews' });
  const title = kind === 'products' ? '商品与申请' : kind === 'demands' ? '需求批次' : '评论';
  const submission = kind === 'products' && me.data?.access.can_submit_product_applications ? <Link className="button" to="/seller/products/new">提交产品申请</Link>
    : kind === 'demands' && me.data?.access.can_submit_demand_batches ? <Link className="button" to="/seller/demands/new">提交需求</Link> : null;
  return <section className="seller-page"><PageHeader title={title}>{submission}</PageHeader>
    {query.isPending ? <p role="status">正在加载</p> : query.isError ? <p role="alert">暂时无法读取，请稍后重试。</p> : query.data.length === 0 ? <EmptyState title={`暂无${title}`} description="没有符合当前店铺范围的记录。" /> : <div className="seller-card-list">{query.data.map((item) => {
      const key = 'review_case_id' in item ? item.review_case_id : item.id;
      const label = 'review_case_id' in item ? item.product_name
        : 'current_version' in item ? item.current_version.product_name : item.product.product_name;
      return <Card key={key}><strong>{label}</strong><p>{sellerStatusLabel[item.status]}</p></Card>;
    })}</div>}
  </section>;
}
export function SellerProductsPage(): React.JSX.Element {
  const client = useQueryClient(); const { storeId } = useSellerStoreContext();
  const [pendingWithdraw, setPendingWithdraw] = useState<{ id: string; version: number } | null>(null);
  const me = useQuery({ queryKey: sellerQueryKeys.me, queryFn: ({ signal }) => sellerApi.me(client, signal).then((r) => r.data.me) });
  const products = useQuery({ queryKey: sellerQueryKeys.products(storeId), queryFn: ({ signal }) => sellerApi.products(client, storeId, signal).then((r) => r.data.items) });
  const applications = useQuery({ queryKey: sellerQueryKeys.applications(storeId), queryFn: ({ signal }) => sellerApi.applications(client, storeId, signal).then((r) => r.data.items) });
  const withdraw = useBuyerMutation({ operation: (body: { id: string; version: number }, key, signal) => sellerApi.withdrawApplication(client, body.id, body.version, key, signal), onSuccess: async () => { await client.invalidateQueries({ queryKey: sellerQueryKeys.applications(storeId) }); setPendingWithdraw(null); } });
  return <section className="seller-page"><PageHeader title="商品与申请">{me.data?.access.can_submit_product_applications ? <Link className="button" to="/seller/products/new">提交产品申请</Link> : null}</PageHeader>
    {products.isPending || applications.isPending ? <p role="status">正在加载</p> : products.isError || applications.isError ? <><p role="alert">暂时无法读取商品与申请。</p><Button className="secondary" onClick={() => { void Promise.all([products.refetch(), applications.refetch()]); }}>重新读取</Button></> : products.data.length === 0 && applications.data.length === 0 ? <EmptyState title="暂无商品与申请" description="提交后可在这里查看审核状态。" /> : <div className="seller-card-list">{products.data.map((item) => <Card key={item.id}><strong>{item.current_version.product_name}</strong><p>{item.store.display_name} · {item.asin}</p><StatusBadge tone={item.status === 'ACTIVE' ? 'success' : 'neutral'}>{productStatusLabel[item.status]}</StatusBadge></Card>)}{applications.data.map((item) => <Card key={item.id}><strong>{item.product_name}</strong><p>{item.store.display_name} · {item.asin}</p><StatusBadge tone={item.status === 'APPROVED' ? 'success' : item.status === 'REJECTED' ? 'danger' : 'processing'}>{({ SUBMITTED: '待审核', APPROVED: '已通过', REJECTED: '未通过', WITHDRAWN: '已撤回' } as const)[item.status]}</StatusBadge>{item.review_reason ? <p>{item.review_reason}</p> : null}{item.status === 'SUBMITTED' && me.data?.access.can_submit_product_applications ? <Button className="danger" onClick={() => setPendingWithdraw({ id: item.id, version: item.version })}>撤回申请</Button> : null}</Card>)}</div>}
    <Dialog open={pendingWithdraw !== null} title="撤回产品申请" description="撤回后当前申请将不再继续审核。" busy={withdraw.isPending} onClose={() => setPendingWithdraw(null)}>
      <BuyerMutationRecovery mutation={withdraw} onRefresh={() => { setPendingWithdraw(null); void applications.refetch(); }} />
      <div className="entry-actions"><Button className="secondary" onClick={() => setPendingWithdraw(null)}>取消</Button><Button className="danger" loading={withdraw.isPending} onClick={() => { if (pendingWithdraw) withdraw.mutate(pendingWithdraw); }}>确认撤回</Button></div>
    </Dialog>
  </section>;
}

export function SellerDemandsPage(): React.JSX.Element {
  const client = useQueryClient(); const { storeId } = useSellerStoreContext();
  const [pendingWithdraw, setPendingWithdraw] = useState<{ id: string; version: number } | null>(null);
  const me = useQuery({ queryKey: sellerQueryKeys.me, queryFn: ({ signal }) => sellerApi.me(client, signal).then((r) => r.data.me) });
  const demands = useQuery({ queryKey: sellerQueryKeys.demands(storeId), queryFn: ({ signal }) => sellerApi.demands(client, storeId, signal).then((r) => r.data.items) });
  const withdraw = useBuyerMutation({ operation: (body: { id: string; version: number }, key, signal) => sellerApi.withdrawDemand(client, body.id, body.version, key, signal), onSuccess: async () => { await client.invalidateQueries({ queryKey: sellerQueryKeys.demands(storeId) }); setPendingWithdraw(null); } });
  return <section className="seller-page"><PageHeader title="需求批次">{me.data?.access.can_submit_demand_batches ? <Link className="button" to="/seller/demands/new">提交需求</Link> : null}</PageHeader>
    {demands.isPending ? <p role="status">正在加载</p> : demands.isError ? <><p role="alert">暂时无法读取需求批次。</p><Button className="secondary" onClick={() => { void demands.refetch(); }}>重新读取</Button></> : demands.data.length === 0 ? <EmptyState title="暂无需求批次" description="选择已通过产品后可提交新的需求。" /> : <div className="seller-card-list">{demands.data.map((item) => <Card key={item.id}><strong>{item.product.product_name}</strong><p>{item.store.display_name} · 目标数量 {item.target_quantity}</p><StatusBadge tone={item.status === 'PUBLISHED' ? 'success' : item.status === 'REJECTED' ? 'danger' : 'processing'}>{demandStatusLabel[item.status]}</StatusBadge>{item.status === 'SUBMITTED' && me.data?.access.can_submit_demand_batches ? <Button className="danger" onClick={() => setPendingWithdraw({ id: item.id, version: item.version })}>撤回需求</Button> : null}</Card>)}</div>}
    <Dialog open={pendingWithdraw !== null} title="撤回需求" description="撤回后当前需求将不再继续审核。" busy={withdraw.isPending} onClose={() => setPendingWithdraw(null)}>
      <BuyerMutationRecovery mutation={withdraw} onRefresh={() => { setPendingWithdraw(null); void demands.refetch(); }} />
      <div className="entry-actions"><Button className="secondary" onClick={() => setPendingWithdraw(null)}>取消</Button><Button className="danger" loading={withdraw.isPending} onClick={() => { if (pendingWithdraw) withdraw.mutate(pendingWithdraw); }}>确认撤回</Button></div>
    </Dialog>
  </section>;
}
export function SellerProductApplicationDetailPage(): React.JSX.Element {
  const { applicationId = '' } = useParams(); const client = useQueryClient();
  const query = useQuery({ queryKey: sellerQueryKeys.application(applicationId), queryFn: ({ signal }) => sellerApi.application(client, applicationId, signal).then((r) => r.data.application), enabled: applicationId.length > 0 });
  if (query.isPending) return <section className="seller-page"><p role="status">正在加载</p></section>;
  if (query.isError || !query.data) return <section className="seller-page"><EmptyState title="无法打开产品申请" description="请返回列表刷新后重试。" /></section>;
  const item = query.data;
  return <section className="seller-page"><PageHeader title="产品申请" /><Card><strong>{item.product_name}</strong><p>{item.store.display_name} · {item.asin}</p><StatusBadge tone={item.status === 'APPROVED' ? 'success' : item.status === 'REJECTED' ? 'danger' : 'processing'}>{({ SUBMITTED: '待审核', APPROVED: '已通过', REJECTED: '未通过', WITHDRAWN: '已撤回' } as const)[item.status]}</StatusBadge>{item.review_reason ? <p>{item.review_reason}</p> : null}</Card></section>;
}
export const SellerReviewsPage = (): React.JSX.Element => <SimpleRecords kind="reviews" />;

export function SellerOrdersPage(): React.JSX.Element {
  const client = useQueryClient(); const { storeId } = useSellerStoreContext();
  const query = useQuery({ queryKey: sellerQueryKeys.orders(storeId), queryFn: ({ signal }) => sellerApi.orders(client, storeId, signal).then((r) => r.data.items) });
  return <section className="seller-page"><PageHeader title="订单与业务完成" />
    {query.data?.map((item) => <Card key={item.formal_order_id} className="seller-order-card"><div className="section-heading"><div><strong>{item.product_name}</strong><p>{item.store.display_name} · {item.platform_order_identifier}</p></div><StatusBadge tone={item.business_completion.status === 'COMPLETE' ? 'success' : 'processing'}>{item.business_completion.status === 'COMPLETE' ? '业务完成' : '进行中'}</StatusBadge></div>
      <dl className="seller-facts"><div><dt>买家支付</dt><dd>{money(item.payment.amount_minor, item.payment.currency_code, item.payment.currency_exponent)}</dd></div><div><dt>卖家本金</dt><dd>{cny(item.seller_expected_principal_cny_fen)}</dd></div><div><dt>服务费</dt><dd>{cny(item.locked_service_fee_snapshot.service_fee_cny_fen)}</dd></div><div><dt>协议汇率版本</dt><dd>v{item.seller_agreement_rate_snapshot.version_no}（只读）</dd></div></dl>
      <ul className="completion-grid"><li>评论：{componentLabel[item.business_completion.review]}</li><li>买家返款：{componentLabel[item.business_completion.buyer_refund]}</li><li>卖家本金：{componentLabel[item.business_completion.seller_principal]}</li><li>卖家服务费：{componentLabel[item.business_completion.seller_service_fee]}</li></ul>
    </Card>)}{query.data?.length === 0 ? <EmptyState title="暂无正式订单" description="正式订单确认后会显示在这里。" /> : null}
  </section>;
}

export function SellerSettlementsPage(): React.JSX.Element {
  const client = useQueryClient(); const summary = useQuery({ queryKey: sellerQueryKeys.settlement, queryFn: ({ signal }) => sellerApi.settlement(client, signal).then((r) => r.data.settlement) });
  const payables = useQuery({ queryKey: sellerQueryKeys.payables, queryFn: ({ signal }) => sellerApi.payables(client, signal).then((r) => r.data.items) });
  return <section className="seller-page"><PageHeader title="本金与服务费" />
    <div className="seller-metrics"><MetricCard label="待结本金" value={summary.data ? cny(summary.data.outstanding_principal_cny_fen) : '—'} /><MetricCard label="待结服务费" value={summary.data ? cny(summary.data.outstanding_service_fee_cny_fen) : '—'} /><MetricCard label="未分配来款" value={summary.data ? cny(summary.data.unallocated_credit_cny_fen) : '—'} /></div>
    <div className="seller-card-list">{payables.data?.map((item) => <Card key={item.payable_id}><strong>{item.payable_type === 'SELLER_PRINCIPAL' ? '卖家本金' : '卖家服务费'}</strong><p>应结 {cny(item.due_amount_cny_fen)} · 已结 {cny(item.paid_amount_cny_fen)} · 未结 {cny(item.outstanding_amount_cny_fen)}</p><StatusBadge tone={item.status === 'PAID' ? 'success' : 'processing'}>{item.status === 'PAID' ? '已完成' : '待确认'}</StatusBadge></Card>)}</div>
  </section>;
}

export function SellerSettingsPage(): React.JSX.Element { return <section className="seller-page"><PageHeader title="账户" /><Card><Link className="button" to="/seller/change-password">修改密码</Link></Card></section>; }
