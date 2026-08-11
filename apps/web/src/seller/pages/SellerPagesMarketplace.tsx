import { useQuery,useQueryClient } from '@tanstack/react-query';
import { Link,useParams } from 'react-router';
import { Alert,Card,DataTable,EmptyState,MetricCard,PageHeader,StatusBadge } from '../../ui/primitives';
import { sellerApi } from '../api/client';
import { sellerQueryKeys } from '../queries/keys';
import { useSellerCursorPages } from '../queries/useSellerCursorPages';
import { useSellerStoreContext } from '../routes/SellerLayout';
import { SellerSettingsV2Page } from './SellerSettingsV2Page';

const tokyo=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const formatTokyo=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?`${tokyo.format(new Date(value))}（日本时间）`:'—';
const cny=(value:unknown)=>{try{const n=BigInt(String(value??'0')),a=n<0n?-n:n;return `${n<0n?'-':''}¥${a/100n}.${(a%100n).toString().padStart(2,'0')}`;}catch{return'—';}};
const value=(record:unknown,key:string):unknown=>record&&typeof record==='object'&&!Array.isArray(record)?(record as Record<string,unknown>)[key]:undefined;
const text=(record:unknown,key:string,fallback='—')=>{const v=value(record,key);return typeof v==='string'||typeof v==='number'?String(v):fallback;};
const nestedText=(record:unknown,parent:string,key:string,fallback='—')=>text(value(record,parent),key,fallback);
function tone(status:string){if(['ACTIVE','APPROVED','PUBLISHED','PAID','COMPLETE','CONFIRMED'].includes(status))return'success' as const;if(['REJECTED'].includes(status))return'danger' as const;if(['CHANGES_REQUESTED','PARTIALLY_PAID','IN_PROGRESS'].includes(status))return'warning' as const;return'neutral' as const;}

export function SellerDashboardPage():React.JSX.Element{
  const client=useQueryClient(),{storeId}=useSellerStoreContext();
  const me=useQuery({queryKey:sellerQueryKeys.me,queryFn:({signal})=>sellerApi.me(client,signal).then((r)=>r.data.me)});
  const orders=useSellerCursorPages({resetKey:`seller-orders:${storeId??'all'}:100`,queryKey:(cursor)=>sellerQueryKeys.ordersPage(storeId,cursor),queryFn:(cursor,signal)=>sellerApi.orders(client,storeId,cursor,signal)});
  const settlement=useQuery({queryKey:sellerQueryKeys.settlement,queryFn:({signal})=>sellerApi.settlement(client,signal).then((r)=>r.data.settlement)});
  const complete=orders.items.filter((item)=>nestedText(item,'business_completion','status','')==='COMPLETE').length;
  return <section className="seller-page seller-dashboard-page"><PageHeader title="业务进度" eyebrow="当前授权范围">{Boolean(value(me.data?.access,'can_submit_product_applications'))?<Link className="button secondary" to="/seller/products/new">提交产品申请</Link>:null}{Boolean(value(me.data?.access,'can_submit_demand_batches'))?<Link className="button" to="/seller/demands/new">提交需求</Link>:null}</PageHeader>
    {orders.initialError||settlement.isError?<Alert tone="danger">业务摘要暂时无法完整读取，请刷新后重试。</Alert>:null}
    <div className="seller-metrics"><MetricCard label="正式订单" value={orders.isInitialPending?'—':orders.items.length+(orders.hasMore?'+':'')}/><MetricCard label="业务完成" value={orders.isInitialPending?'—':complete+(orders.hasMore?'+':'')}/><MetricCard label="待结算" value={settlement.data?cny(value(settlement.data,'total_outstanding_cny_fen')):'—'} detail="卖家本金与卖家服务费"/></div>
    <Card><h2>最近正式订单</h2>{orders.items.length===0&&!orders.isInitialPending?<EmptyState title="暂无正式订单" description="当前授权范围还没有正式订单。"/>:<DataTable caption="最近正式订单"><thead><tr><th>产品</th><th>店铺</th><th>订单号</th><th>业务状态</th></tr></thead><tbody>{orders.items.slice(0,8).map((item)=><tr key={text(item,'formal_order_id',crypto.randomUUID())}><td>{text(item,'product_name')}</td><td>{nestedText(item,'store','display_name')}</td><td>{text(item,'platform_order_identifier')}</td><td><StatusBadge tone={tone(nestedText(item,'business_completion','status','IN_PROGRESS'))}>{nestedText(item,'business_completion','status','进行中')}</StatusBadge></td></tr>)}</tbody></DataTable>}</Card>
  </section>;
}

export function SellerProductsPage():React.JSX.Element{
  const client=useQueryClient(),{storeId}=useSellerStoreContext();
  const products=useSellerCursorPages({resetKey:`seller-products:${storeId??'all'}:100`,queryKey:(cursor)=>sellerQueryKeys.productsPage(storeId,cursor),queryFn:(cursor,signal)=>sellerApi.products(client,storeId,cursor,signal)});
  const applications=useSellerCursorPages({resetKey:`seller-applications:${storeId??'all'}:100`,queryKey:(cursor)=>sellerQueryKeys.applicationsPage(storeId,cursor),queryFn:(cursor,signal)=>sellerApi.applications(client,storeId,cursor,signal)});
  return <section className="seller-page"><PageHeader title="商品与申请" eyebrow="商品资料"><Link className="button" to="/seller/products/new">提交产品申请</Link></PageHeader>{products.initialError||applications.initialError?<Alert tone="danger">商品或申请暂时无法读取。</Alert>:null}
    <Card><h2>已通过商品</h2>{products.items.length===0?<EmptyState title="暂无商品" description="通过审核的商品会显示在这里。"/>:<DataTable caption="已通过商品"><thead><tr><th>产品</th><th>店铺</th><th>ASIN</th><th>状态</th><th>更新时间</th></tr></thead><tbody>{products.items.map((item)=><tr key={text(item,'id',text(item,'product_id'))}><td>{nestedText(item,'current_version','product_name',text(item,'product_name'))}</td><td>{nestedText(item,'store','display_name')}</td><td>{text(item,'asin')}</td><td>{text(item,'status')}</td><td>{formatTokyo(value(item,'updated_at'))}</td></tr>)}</tbody></DataTable>}</Card>
    <Card><h2>产品申请</h2>{applications.items.length===0?<EmptyState title="暂无申请" description="新产品申请会显示在这里。"/>:<DataTable caption="产品申请"><thead><tr><th>产品</th><th>店铺</th><th>ASIN</th><th>状态</th><th>提交时间</th></tr></thead><tbody>{applications.items.map((item)=><tr key={text(item,'id')}><td><Link to={`/seller/products/${encodeURIComponent(text(item,'id'))}`}>{text(item,'product_name')}</Link></td><td>{nestedText(item,'store','display_name')}</td><td>{text(item,'asin')}</td><td>{text(item,'status')}</td><td>{formatTokyo(value(item,'submitted_at'))}</td></tr>)}</tbody></DataTable>}</Card>
  </section>;
}

export function SellerProductApplicationDetailPage():React.JSX.Element{
  const {applicationId}=useParams();const client=useQueryClient(),{storeId}=useSellerStoreContext();
  const applications=useSellerCursorPages({resetKey:`seller-application-detail:${storeId??'all'}:${applicationId??''}`,queryKey:(cursor)=>sellerQueryKeys.applicationsPage(storeId,cursor),queryFn:(cursor,signal)=>sellerApi.applications(client,storeId,cursor,signal)});
  const item=applications.items.find((candidate)=>text(candidate,'id')===applicationId)??null;
  return <section className="seller-page"><PageHeader title="产品申请详情" eyebrow="商品资料"><Link className="button secondary" to="/seller/products">返回商品</Link></PageHeader>{applications.initialError?<Alert tone="danger">申请暂时无法读取。</Alert>:item?<Card><h2>{text(item,'product_name')}</h2><dl className="seller-record-facts"><div><dt>ASIN</dt><dd>{text(item,'asin')}</dd></div><div><dt>店铺</dt><dd>{nestedText(item,'store','display_name')}</dd></div><div><dt>状态</dt><dd>{text(item,'status')}</dd></div><div><dt>提交时间</dt><dd>{formatTokyo(value(item,'submitted_at'))}</dd></div><div><dt>审核说明</dt><dd>{text(item,'review_reason','暂无')}</dd></div></dl></Card>:<EmptyState title="正在查找申请" description="如果申请不在当前已加载页，请返回商品页查看。"/>}</section>;
}

export function SellerDemandsPage():React.JSX.Element{
  const client=useQueryClient(),{storeId}=useSellerStoreContext();const demands=useSellerCursorPages({resetKey:`seller-demands:${storeId??'all'}:100`,queryKey:(cursor)=>sellerQueryKeys.demandsPage(storeId,cursor),queryFn:(cursor,signal)=>sellerApi.demands(client,storeId,cursor,signal)});
  return <section className="seller-page"><PageHeader title="需求批次" eyebrow="数量计划"><Link className="button" to="/seller/demands/new">提交需求</Link></PageHeader>{demands.initialError?<Alert tone="danger">需求批次暂时无法读取。</Alert>:demands.items.length===0?<EmptyState title="暂无需求" description="提交需求后会显示在这里。"/>:<DataTable caption="需求批次"><thead><tr><th>产品</th><th>店铺</th><th>目标数量</th><th>状态</th><th>提交时间</th></tr></thead><tbody>{demands.items.map((item)=><tr key={text(item,'id',text(item,'demand_batch_id'))}><td>{text(item,'product_name')}</td><td>{nestedText(item,'store','display_name')}</td><td>{text(item,'target_quantity')}</td><td><StatusBadge tone={tone(text(item,'status'))}>{text(item,'status')}</StatusBadge></td><td>{formatTokyo(value(item,'submitted_at')??value(item,'created_at'))}</td></tr>)}</tbody></DataTable>}</section>;
}

export function SellerOrdersPage():React.JSX.Element{
  const client=useQueryClient(),{storeId}=useSellerStoreContext();const orders=useSellerCursorPages({resetKey:`seller-orders-page:${storeId??'all'}:100`,queryKey:(cursor)=>sellerQueryKeys.ordersPage(storeId,cursor),queryFn:(cursor,signal)=>sellerApi.orders(client,storeId,cursor,signal)});
  return <section className="seller-page"><PageHeader title="正式订单" eyebrow="订单进度"/>{orders.initialError?<Alert tone="danger">正式订单暂时无法读取。</Alert>:orders.items.length===0?<EmptyState title="暂无正式订单" description="当前授权范围没有订单。"/>:<DataTable caption="正式订单"><thead><tr><th>产品</th><th>订单号</th><th>店铺</th><th>下单 / 确认时间</th><th>业务完成</th></tr></thead><tbody>{orders.items.map((item)=><tr key={text(item,'formal_order_id')}><td>{text(item,'product_name')}</td><td>{text(item,'platform_order_identifier')}</td><td>{nestedText(item,'store','display_name')}</td><td>{formatTokyo(value(item,'confirmed_at')??value(item,'created_at'))}</td><td>{nestedText(item,'business_completion','status','进行中')}</td></tr>)}</tbody></DataTable>}</section>;
}

export function SellerReviewsPage():React.JSX.Element{
  const client=useQueryClient(),{storeId}=useSellerStoreContext();const orders=useSellerCursorPages({resetKey:`seller-review-orders:${storeId??'all'}:100`,queryKey:(cursor)=>sellerQueryKeys.ordersPage(storeId,cursor),queryFn:(cursor,signal)=>sellerApi.orders(client,storeId,cursor,signal)});
  return <section className="seller-page"><PageHeader title="评论" eyebrow="订单评论状态"/><Alert tone="info">评论审核结果与 Amazon 当前展示状态是两类事实；掉评/未显示不会改写当时已经通过的审核。</Alert>{orders.items.length===0?<EmptyState title="暂无评论相关订单" description="正式订单产生评论后会在订单业务进度中体现。"/>:<DataTable caption="订单评论状态"><thead><tr><th>产品</th><th>订单号</th><th>评论完成</th><th>业务状态</th></tr></thead><tbody>{orders.items.map((item)=><tr key={text(item,'formal_order_id')}><td>{text(item,'product_name')}</td><td>{text(item,'platform_order_identifier')}</td><td>{nestedText(value(item,'business_completion'),'review','status',nestedText(item,'business_completion','status','—'))}</td><td>{nestedText(item,'business_completion','status','—')}</td></tr>)}</tbody></DataTable>}</section>;
}

export function SellerSettlementsPage():React.JSX.Element{
  const client=useQueryClient();const settlement=useQuery({queryKey:sellerQueryKeys.settlement,queryFn:({signal})=>sellerApi.settlement(client,signal).then((r)=>r.data.settlement)});
  return <section className="seller-page"><PageHeader title="结算" eyebrow="卖家本金与服务费"/>{settlement.isError?<Alert tone="danger">结算数据暂时无法读取。</Alert>:settlement.data?<><div className="seller-metrics"><MetricCard label="待结算本金" value={cny(value(settlement.data,'outstanding_principal_cny_fen'))}/><MetricCard label="待结算服务费" value={cny(value(settlement.data,'outstanding_service_fee_cny_fen'))}/><MetricCard label="总待结算" value={cny(value(settlement.data,'total_outstanding_cny_fen'))}/></div><Card><h2>结算说明</h2><p>订单后续异常不会改写原始财务快照；实际付款、冲正和分配仍通过正式结算流水处理。</p></Card></>:<p role="status">正在读取结算</p>}</section>;
}

export function SellerSettingsPage():React.JSX.Element{return <SellerSettingsV2Page/>;}
