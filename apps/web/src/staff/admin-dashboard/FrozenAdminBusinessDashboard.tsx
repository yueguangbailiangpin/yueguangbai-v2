import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { identityApiRequest } from '../../api/identity-request';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import { Alert, Button, Card, DataTable, EmptyState, StatusBadge } from '../../ui/primitives';
import { staffApi } from '../api/client';
import { formatCny } from '../shared/format';

const dailySchema=z.object({
  from_date:z.string(),to_date:z.string(),timezone:z.literal('Asia/Shanghai'),data_as_of:z.number().int().nonnegative(),
  totals:z.object({
    new_buyer_customers:z.number().int().nonnegative(),new_seller_customers:z.number().int().nonnegative(),
    buyer_portal_registrations:z.number().int().nonnegative(),formal_orders:z.number().int().nonnegative(),
    buyer_unattributed_orders:z.number().int().nonnegative(),seller_unattributed_orders:z.number().int().nonnegative(),
  }).strict(),
  daily:z.array(z.object({
    business_date:z.string(),new_buyer_customers:z.number().int().nonnegative(),new_seller_customers:z.number().int().nonnegative(),
    buyer_portal_registrations:z.number().int().nonnegative(),formal_orders:z.number().int().nonnegative(),
    buyer_unattributed_orders:z.number().int().nonnegative(),seller_unattributed_orders:z.number().int().nonnegative(),
  }).strict()),
  channel_daily:z.array(z.object({
    business_date:z.string(),channel_id:z.string(),channel_name:z.string(),channel_label:z.string(),platform_name:z.string(),
    lead_type:z.enum(['BUYER','SELLER']),marketplace_code:z.string(),new_customer_count:z.number().int().nonnegative(),formal_order_count:z.number().int().nonnegative(),
  }).strict()),
}).strict();
type WindowKey='TODAY'|'WEEK'|'MONTH';
const WINDOWS:readonly [WindowKey,string][]=[['TODAY','今日'],['WEEK','本周'],['MONTH','本月']];
const MARKETS:Record<string,string>={AMAZON_JP:'Amazon 日本站',AMAZON_US:'Amazon 美国站',COUPANG_KR:'Coupang 韩国站',RAKUTEN_JP:'Rakuten 日本',TIKTOK_JP:'TikTok 日本'};

export function FrozenAdminBusinessDashboard():React.JSX.Element{
  const client=useQueryClient();const session=useCurrentStaffSession();const [window,setWindow]=useState<WindowKey>('TODAY');
  const authorized=session.role.code==='owner'&&session.permissions.includes('FINANCIAL_VIEW');
  const summary=useQuery({
    queryKey:['staff','frozen-dashboard','summary',session.authorization_version,window],
    queryFn:({signal})=>staffApi.adminDashboardSummary(client,window,signal).then((r)=>r.data.summary),enabled:authorized,retry:false,
  });
  const from=summary.data?.window.from_date??'';const to=summary.data?.window.to_date??'';
  const acquisition=useQuery({
    queryKey:['staff','frozen-dashboard','acquisition-daily',session.authorization_version,from,to],
    queryFn:({signal})=>identityApiRequest('staff',client,{path:`/api/staff/admin-business-dashboard/acquisition-daily?from_date=${encodeURIComponent(from)}&to_date=${encodeURIComponent(to)}`,method:'GET',schema:dailySchema,signal}).then((r)=>r.data),
    enabled:authorized&&from!==''&&to!=='',retry:false,
  });
  if(!authorized)return <main className="admin-dashboard"><Alert tone="danger">只有总管理员可以查看经营看板。</Alert></main>;
  if(summary.isPending||acquisition.isPending)return <main className="admin-dashboard"><p role="status">正在加载经营数据</p></main>;
  if(summary.isError||acquisition.isError)return <main className="admin-dashboard"><Alert tone="danger">经营数据暂时无法加载，请稍后重试。</Alert></main>;
  const business=summary.data;const value=acquisition.data;
  const hasUnattributed=value.totals.buyer_unattributed_orders>0||value.totals.seller_unattributed_orders>0;
  return <main className="admin-dashboard frozen-admin-dashboard">
    <section className="dashboard-toolbar"><div className="dashboard-window-switch">{WINDOWS.map(([key,label])=><Button key={key} className={window===key?'':'secondary'} onClick={()=>setWindow(key)}>{label}</Button>)}</div><p>{value.from_date} 至 {value.to_date} · 北京时间</p></section>

    <section><h2>客户与订单概览</h2><div className="dashboard-metric-grid">
      <Metric label="新增买家客户" value={value.totals.new_buyer_customers} detail="售前成功录入系统即计入"/>
      <Metric label="新增卖家客户" value={value.totals.new_seller_customers} detail="卖家对接成功录入系统即计入"/>
      <Metric label="买家网站注册" value={value.totals.buyer_portal_registrations} detail="买家设置密码并建立网站账号"/>
      <Metric label="新增正式订单" value={value.totals.formal_orders} detail="按正式订单确认日期统计"/>
      <Metric label="新增预约" value={business.cards.reservations}/>
      <Metric label="业务完成" value={business.cards.business_completions}/>
      <Metric label="预计利润" value={formatCny(business.projected_profit.amount_cny_fen)} detail={`${business.projected_profit.valid_order_count} 单有效`}/>
      <Metric label="已完成利润" value={formatCny(business.completed_profit.amount_cny_fen)} detail={`${business.completed_profit.valid_order_count} 单有效`}/>
    </div>
    {hasUnattributed?<Alert tone="warning">所选范围存在未归因订单：买家来源缺失 {value.totals.buyer_unattributed_orders} 单，卖家来源缺失 {value.totals.seller_unattributed_orders} 单。系统不会把这些订单猜测到任何渠道。</Alert>:null}</section>

    <section><div className="dashboard-section-heading"><div><h2>每日新增</h2><p>“新增客户”和“买家网站注册”是两个独立事实。</p></div></div>
      {value.daily.length===0?<EmptyState title="暂无每日数据" description="所选时间范围没有新增客户或订单。"/>:<DataTable caption="每日新增客户与订单"><thead><tr><th>日期</th><th>新增买家客户</th><th>新增卖家客户</th><th>买家网站注册</th><th>新增正式订单</th><th>买家来源未归因</th><th>卖家来源未归因</th></tr></thead><tbody>{[...value.daily].reverse().map((row)=><tr key={row.business_date}><td>{row.business_date}</td><td>{row.new_buyer_customers}</td><td>{row.new_seller_customers}</td><td>{row.buyer_portal_registrations}</td><td><strong>{row.formal_orders}</strong></td><td>{row.buyer_unattributed_orders}</td><td>{row.seller_unattributed_orders}</td></tr>)}</tbody></DataTable>}
    </section>

    <section><div className="dashboard-section-heading"><div><h2>每天各渠道新增</h2><p>同一张正式订单分别归到买家来源渠道和卖家来源渠道；全站订单总数仍只算一单。</p></div></div>
      {value.channel_daily.length===0?<EmptyState title="暂无渠道归因数据" description="成功录入客户并形成订单后，这里会按真实来源自动汇总。"/>:<DataTable caption="每日渠道新增客户与新增订单"><thead><tr><th>日期</th><th>类型</th><th>员工渠道</th><th>真实渠道</th><th>平台</th><th>站点</th><th>新增客户</th><th>新增订单</th></tr></thead><tbody>{[...value.channel_daily].reverse().map((row)=><tr key={`${row.business_date}:${row.channel_id}:${row.lead_type}`}><td>{row.business_date}</td><td><StatusBadge tone={row.lead_type==='BUYER'?'processing':'success'}>{row.lead_type==='BUYER'?'买家':'卖家'}</StatusBadge></td><td>{row.channel_label}</td><td><strong>{row.channel_name}</strong></td><td>{row.platform_name}</td><td>{MARKETS[row.marketplace_code]??row.marketplace_code}</td><td>{row.new_customer_count}</td><td><strong>{row.formal_order_count}</strong></td></tr>)}</tbody></DataTable>}
    </section>

    <section className="dashboard-two-column" aria-label="转化漏斗">
      <Funnel title="买家转化" stages={business.buyer_funnel.stages}/>
      <Funnel title="卖家转化" stages={business.seller_funnel.stages}/>
    </section>
  </main>;
}

function Metric({label,value,detail}:{label:string;value:string|number;detail?:string}){return <Card className="dashboard-metric"><p>{label}</p><strong>{value}</strong>{detail?<small>{detail}</small>:null}</Card>}
function Funnel({title,stages}:{title:string;stages:readonly {code:string;label:string;count:number;conversion_rate_bps:number|null}[]}){return <Card><h2>{title}</h2><ol className="dashboard-funnel">{stages.map((stage)=><li key={stage.code}><span>{stage.label}</span><strong>{stage.count}</strong><small>{stage.conversion_rate_bps===null?'—':`${(stage.conversion_rate_bps/100).toFixed(1)}%`}</small></li>)}</ol></Card>}
