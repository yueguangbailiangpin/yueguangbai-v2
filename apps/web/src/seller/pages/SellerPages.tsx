import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Card, EmptyState, MetricCard, PageHeader, StatusBadge } from '../../ui/primitives';
import { sellerApi } from '../api/client';
import { sellerQueryKeys } from '../queries/keys';
import { useSellerStoreContext } from '../routes/SellerLayout';

const cny = (fen: string): string => `¥${(BigInt(fen) / 100n).toString()}.${(BigInt(fen) % 100n).toString().padStart(2, '0')}`;
const money = (amount: string, currency: string, exponent: number): string => exponent === 0 ? `${amount} ${currency}` : `${amount.slice(0, -2) || '0'}.${amount.slice(-2).padStart(2, '0')} ${currency}`;
const componentLabel = { PENDING: '待完成', COMPLETE: '已完成', NOT_APPLICABLE: '不适用' } as const;

export function SellerDashboardPage(): React.JSX.Element {
  const client = useQueryClient(); const { storeId } = useSellerStoreContext();
  const orders = useQuery({ queryKey: sellerQueryKeys.orders(storeId), queryFn: ({ signal }) => sellerApi.orders(client, storeId, signal).then((r) => r.data.items) });
  const settlement = useQuery({ queryKey: sellerQueryKeys.settlement, queryFn: ({ signal }) => sellerApi.settlement(client, signal).then((r) => r.data.settlement) });
  const complete = orders.data?.filter((item) => item.business_completion.status === 'COMPLETE').length ?? 0;
  return <section className="seller-page"><PageHeader eyebrow="卖家首页" title="业务进度" description="状态来自服务器业务事实；结算确认由员工控制。" />
    <div className="seller-metrics"><MetricCard label="正式订单" value={String(orders.data?.length ?? '—')} detail="当前返回范围" /><MetricCard label="业务完成" value={String(complete)} detail="四项均完成或不适用" /><MetricCard label="待结算" value={settlement.data ? cny(settlement.data.total_outstanding_cny_fen) : '—'} detail="本金与服务费独立核算" /></div>
    <Card><h2>接下来关注</h2>{orders.data?.some((item) => item.business_completion.status === 'IN_PROGRESS') ? <p>仍有订单存在未完成评论、买家返款、本金或服务费。请进入订单查看真实进度。</p> : <EmptyState title="暂无待完成订单" description="当前返回范围内没有待完成事项。" />}<Link className="button" to="/seller/orders">查看订单</Link></Card>
  </section>;
}

function SimpleRecords({ kind }: { kind: 'products' | 'demands' | 'reviews' }): React.JSX.Element {
  const client = useQueryClient(); const { storeId } = useSellerStoreContext();
  const query = useQuery({ queryKey: sellerQueryKeys[kind](storeId), queryFn: ({ signal }) => sellerApi[kind](client, storeId, signal).then((r) => r.data.items) });
  const title = kind === 'products' ? '商品与申请' : kind === 'demands' ? '需求批次' : '评论';
  return <section className="seller-page"><PageHeader eyebrow="卖家业务" title={title} description="仅显示当前组织及授权店铺范围。" />
    {query.isPending ? <p role="status">正在加载</p> : query.isError ? <p role="alert">暂时无法读取，请稍后重试。</p> : query.data.length === 0 ? <EmptyState title={`暂无${title}`} description="没有符合当前店铺范围的记录。" /> : <div className="seller-card-list">{query.data.map((item) => {
      const key = 'review_case_id' in item ? item.review_case_id : item.id;
      const label = 'review_case_id' in item ? item.product_name
        : 'current_version' in item ? item.current_version.product_name : item.product.product_name;
      return <Card key={key}><strong>{label}</strong><p>{item.status}</p></Card>;
    })}</div>}
  </section>;
}
export const SellerProductsPage = (): React.JSX.Element => <SimpleRecords kind="products" />;
export const SellerDemandsPage = (): React.JSX.Element => <SimpleRecords kind="demands" />;
export const SellerReviewsPage = (): React.JSX.Element => <SimpleRecords kind="reviews" />;

export function SellerOrdersPage(): React.JSX.Element {
  const client = useQueryClient(); const { storeId } = useSellerStoreContext();
  const query = useQuery({ queryKey: sellerQueryKeys.orders(storeId), queryFn: ({ signal }) => sellerApi.orders(client, storeId, signal).then((r) => r.data.items) });
  return <section className="seller-page"><PageHeader eyebrow="正式订单" title="订单与业务完成" description="买家返款仅显示完成状态，不展示金额、凭证或买家信息。" />
    {query.data?.map((item) => <Card key={item.formal_order_id} className="seller-order-card"><div className="section-heading"><div><strong>{item.product_name}</strong><p>{item.store.display_name} · {item.platform_order_identifier}</p></div><StatusBadge tone={item.business_completion.status === 'COMPLETE' ? 'success' : 'processing'}>{item.business_completion.status === 'COMPLETE' ? '业务完成' : '进行中'}</StatusBadge></div>
      <dl className="seller-facts"><div><dt>买家支付</dt><dd>{money(item.payment.amount_minor, item.payment.currency_code, item.payment.currency_exponent)}</dd></div><div><dt>卖家本金</dt><dd>{cny(item.seller_expected_principal_cny_fen)}</dd></div><div><dt>服务费</dt><dd>{cny(item.locked_service_fee_snapshot.service_fee_cny_fen)}</dd></div><div><dt>协议汇率版本</dt><dd>v{item.seller_agreement_rate_snapshot.version_no}（只读）</dd></div></dl>
      <ul className="completion-grid"><li>评论：{componentLabel[item.business_completion.review]}</li><li>买家返款：{componentLabel[item.business_completion.buyer_refund]}</li><li>卖家本金：{componentLabel[item.business_completion.seller_principal]}</li><li>卖家服务费：{componentLabel[item.business_completion.seller_service_fee]}</li></ul>
    </Card>)}{query.data?.length === 0 ? <EmptyState title="暂无正式订单" description="正式订单确认后会显示在这里。" /> : null}
  </section>;
}

export function SellerSettlementsPage(): React.JSX.Element {
  const client = useQueryClient(); const summary = useQuery({ queryKey: sellerQueryKeys.settlement, queryFn: ({ signal }) => sellerApi.settlement(client, signal).then((r) => r.data.settlement) });
  const payables = useQuery({ queryKey: sellerQueryKeys.payables, queryFn: ({ signal }) => sellerApi.payables(client, signal).then((r) => r.data.items) });
  return <section className="seller-page"><PageHeader eyebrow="结算" title="本金与服务费" description="全部为人民币分的只读事实；卖家不能确认付款或修改审计字段。" />
    <div className="seller-metrics"><MetricCard label="待结本金" value={summary.data ? cny(summary.data.outstanding_principal_cny_fen) : '—'} /><MetricCard label="待结服务费" value={summary.data ? cny(summary.data.outstanding_service_fee_cny_fen) : '—'} /><MetricCard label="未分配来款" value={summary.data ? cny(summary.data.unallocated_credit_cny_fen) : '—'} /></div>
    <div className="seller-card-list">{payables.data?.map((item) => <Card key={item.payable_id}><strong>{item.payable_type === 'SELLER_PRINCIPAL' ? '卖家本金' : '卖家服务费'}</strong><p>应结 {cny(item.due_amount_cny_fen)} · 已结 {cny(item.paid_amount_cny_fen)} · 未结 {cny(item.outstanding_amount_cny_fen)}</p><StatusBadge tone={item.status === 'PAID' ? 'success' : 'processing'}>{item.status === 'PAID' ? '已完成' : '待员工确认'}</StatusBadge></Card>)}</div>
  </section>;
}

export function SellerSettingsPage(): React.JSX.Element { return <section className="seller-page"><PageHeader eyebrow="账户" title="我的卖家账户" description="组织、成员与权限由服务端核验。" /><Card><p>所有时间按北京时间显示。韩国站能力已预留，目前不可用。</p><Link className="button" to="/seller/change-password">修改密码</Link></Card></section>; }
