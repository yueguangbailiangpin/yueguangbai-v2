import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import { StaffCustomerSecurityPanel } from '../../auth/staff/StaffCustomerSecurityPanel';
import {
  Alert, Button, Card, DataTable, EmptyState, FormField, Select,
  StatusBadge, TextInput,
} from '../../ui/primitives';
import { acquisitionApi } from './api';
import type { AcquisitionChannel, AcquisitionProspect } from './runtime';

const MARKET_LABELS:Record<string,string>={
  AMAZON_JP:'Amazon 日本',AMAZON_US:'Amazon 美国',COUPANG_KR:'Coupang 韩国',
  RAKUTEN_JP:'Rakuten 日本',TIKTOK_JP:'TikTok 日本',
};

export function BuyerCustomersWorkspace():React.JSX.Element{
  return <CustomerIntakeWorkspace leadType="BUYER"/>;
}
export function SellerCustomersWorkspace():React.JSX.Element{
  return <CustomerIntakeWorkspace leadType="SELLER"/>;
}

function CustomerIntakeWorkspace({leadType}:{leadType:'BUYER'|'SELLER'}):React.JSX.Element{
  const session=useCurrentStaffSession();const client=useQueryClient();const buyer=leadType==='BUYER';
  const allowed=session.role.code==='owner'||(buyer?session.role.code==='pre_sales':session.role.code==='seller_ops');
  const channels=useQuery({queryKey:['staff','customer-intake','channels',leadType,session.authorization_version],queryFn:({signal})=>acquisitionApi.channels(client,signal).then((r)=>r.data.channels),enabled:allowed,retry:false});
  const [leads,handoffs]=useQueries({queries:[
    {queryKey:['staff','customer-intake','leads',leadType,session.authorization_version],queryFn:({signal})=>acquisitionApi.leads(client,leadType,signal).then((r)=>r.data),enabled:allowed,retry:false},
    {queryKey:['staff','customer-intake','handoffs',leadType,session.authorization_version],queryFn:({signal})=>acquisitionApi.handoffs(client,leadType,signal).then((r)=>r.data.items),enabled:allowed,retry:false},
  ]});
  if(!allowed)return <main className="customer-intake-workspace"><Alert tone="danger">当前岗位不能处理{buyer?'买家':'卖家'}客户。</Alert></main>;
  return <main className="customer-intake-workspace">
    <header className="staff-customer-heading"><div><p className="eyebrow">{buyer?'Buyer Intake':'Seller Intake'}</p><h2>{buyer?'买家客户':'卖家客户'}</h2><p>{buyer?'售前':'卖家对接'}不负责开发客户；只负责加微信后建立正式线索并确认来源。</p></div></header>
    {handoffs.data&&handoffs.data.length>0?<HandoffStrip leadType={leadType} items={handoffs.data} channels={channels.data??[]}/>:null}
    <div className="customer-intake-grid"><LeadCreateCard leadType={leadType} channels={channels.data??[]} handoffs={handoffs.data??[]}/>
      <Card className="customer-intake-list"><h3>正式{buyer?'买家':'卖家'}线索</h3>{leads.isPending?<p role="status">正在加载</p>:leads.isError?<Alert tone="danger">客户线索暂时无法加载。</Alert>:leads.data.items.length===0?<EmptyState title={`暂无${buyer?'买家':'卖家'}线索`} description="加微信后在左侧登记。"/>:<DataTable caption={`${buyer?'买家':'卖家'}来源与转化`}><thead><tr><th>客户</th><th>站点</th><th>来源</th><th>发现方式</th><th>{buyer?'业务进度':'合作状态'}</th></tr></thead><tbody>{leads.data.items.map((lead)=><tr key={lead.lead_id}><td><strong>{lead.display_name??lead.wechat_masked}</strong><small>{lead.wechat_masked}</small></td><td>{marketLabel(lead.marketplace_code)}</td><td>{lead.origin_channel_name}</td><td><StatusBadge tone={lead.origin_mode==='CODEX'?'processing':'neutral'}>{lead.origin_mode==='CODEX'?'Codex':'人工/推广'}</StatusBadge></td><td>{buyer?`${lead.registered?'已注册':'未注册'} · ${lead.formal_order_count} 单`:lead.seller_cooperation?'已合作':'未合作'}</td></tr>)}</tbody></DataTable>}</Card></div>
    {buyer?<Card className="buyer-security-tools"><h3>买家账号工具</h3><p>注册链接、账号恢复和邀请撤销放在买家客户页面，不再占用工作队列右栏。</p><StaffCustomerSecurityPanel/></Card>:null}
  </main>;
}

function LeadCreateCard({leadType,channels,handoffs}:{leadType:'BUYER'|'SELLER';channels:readonly AcquisitionChannel[];handoffs:readonly AcquisitionProspect[]}){
  const client=useQueryClient();const session=useCurrentStaffSession();const buyer=leadType==='BUYER';const [prospectId,setProspectId]=useState('');
  const prospect=handoffs.find((item)=>item.prospect_id===prospectId)??null;
  const eligibleChannels=channels.filter((channel)=>channel.status==='ACTIVE'&&(channel.lead_type===leadType||channel.lead_type==='BOTH'));
  const markets=useMemo(()=>{
    if(session.data_scope.type!=='GLOBAL'&&session.data_scope.marketplaceCodes.length>0)return session.data_scope.marketplaceCodes;
    return [...new Set(eligibleChannels.map((channel)=>channel.marketplace_code))];
  },[eligibleChannels,session.data_scope.marketplaceCodes,session.data_scope.type]);
  const mutation=useMutation({mutationFn:(body:unknown)=>acquisitionApi.createLead(client,body,crypto.randomUUID()),onSuccess:()=>client.invalidateQueries({queryKey:['staff','customer-intake']})});
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget,data=new FormData(form);const selected=handoffs.find((item)=>item.prospect_id===String(data.get('prospect_id')))??null;
    mutation.mutate({lead_type:leadType,marketplace_code:selected?.marketplace_code??String(data.get('marketplace_code')),channel_id:selected?.origin_channel_id??String(data.get('channel_id')),prospect_id:selected?.prospect_id??null,wechat_id:String(data.get('wechat_id')),display_name:nullable(data.get('display_name')),note:nullable(data.get('note'))},{onSuccess:()=>{form.reset();setProspectId('');}});}
  return <Card className="customer-intake-create"><h3>添加{buyer?'买家':'卖家'}</h3><p>来源第一次确定后跟随客户进入后续订单和利润归因。</p><form onSubmit={submit}>
    {handoffs.length>0?<FormField label="来自潜在线索（可选）" htmlFor={`${leadType}-handoff`} description="如果是获客/Codex 交接的客户，选择后自动继承原来源"><Select id={`${leadType}-handoff`} name="prospect_id" value={prospectId} onChange={(event)=>setProspectId(event.target.value)}><option value="">不是交接客户</option>{handoffs.map((item)=><option key={item.prospect_id} value={item.prospect_id}>{item.display_name} · {item.origin_channel_name}</option>)}</Select></FormField>:<input type="hidden" name="prospect_id" value=""/>}
    <FormField label="站点" htmlFor={`${leadType}-market`}><Select id={`${leadType}-market`} name="marketplace_code" value={prospect?.marketplace_code} disabled={prospect!==null} onChange={()=>undefined}>{markets.map((market)=><option key={market} value={market}>{marketLabel(market)}</option>)}</Select></FormField>
    <FormField label="来源渠道" htmlFor={`${leadType}-channel`}><Select id={`${leadType}-channel`} name="channel_id" value={prospect?.origin_channel_id} disabled={prospect!==null} onChange={()=>undefined}><option value="">请选择</option>{eligibleChannels.map((channel)=><option key={channel.channel_id} value={channel.channel_id}>{channel.display_name}</option>)}</Select></FormField>
    <FormField label="微信号" htmlFor={`${leadType}-wechat`} description="正式 Lead 从已加微信开始"><TextInput id={`${leadType}-wechat`} name="wechat_id" required autoComplete="off"/></FormField>
    <FormField label={buyer?'称呼（可选）':'公司 / 客户名称'} htmlFor={`${leadType}-name`}><TextInput id={`${leadType}-name`} name="display_name" required={!buyer}/></FormField>
    <FormField label="备注（可选）" htmlFor={`${leadType}-note`}><TextInput id={`${leadType}-note`} name="note"/></FormField>
    <Button loading={mutation.isPending} loadingLabel="正在保存">保存{buyer?'买家':'卖家'}</Button>{mutation.isError?<Alert tone="danger">保存未完成，请确认站点、来源和微信号。</Alert>:null}
  </form></Card>;
}

function HandoffStrip({leadType,items,channels}:{leadType:'BUYER'|'SELLER';items:readonly AcquisitionProspect[];channels:readonly AcquisitionChannel[]}){
  return <section className="customer-handoff-strip"><div><strong>待人工接入 {items.length}</strong><span>获客 / Codex 已筛选并交给{leadType==='BUYER'?'售前':'卖家对接'}的客户</span></div><div>{items.slice(0,4).map((item)=><span className="handoff-chip" key={item.prospect_id}>{item.display_name} · {channels.find((c)=>c.channel_id===item.origin_channel_id)?.display_name??item.origin_channel_name}</span>)}</div></section>;
}
function nullable(value:FormDataEntryValue|null){const text=String(value??'').trim();return text?text:null;}
function marketLabel(code:string){return MARKET_LABELS[code]??code;}
