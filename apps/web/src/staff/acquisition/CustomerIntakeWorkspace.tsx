import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { identityApiRequest } from '../../api/identity-request';
import { operationHeaders } from '../../api/idempotency';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import { StaffCustomerSecurityPanel } from '../../auth/staff/StaffCustomerSecurityPanel';
import {
  Alert, Button, Card, DataTable, EmptyState, FormField, Select,
  StatusBadge, TextInput,
} from '../../ui/primitives';
import { acquisitionApi } from './api';
import type { AcquisitionChannel, AcquisitionHandoff } from './runtime';

const MARKET_LABELS:Record<string,string>={
  AMAZON_JP:'亚马逊日本站',AMAZON_US:'亚马逊美国站',COUPANG_KR:'Coupang 韩国站',
  RAKUTEN_JP:'乐天日本站',TIKTOK_JP:'TikTok 日本站',
};
const lookupSchema=z.object({matches:z.array(z.object({
  customer_type:z.enum(['BUYER','SELLER']),subject_id:z.string(),display_name:z.string(),marketplace_code:z.string(),
  has_portal_account:z.boolean(),historical_order_count:z.number().int().nonnegative(),source_status:z.literal('HISTORICAL_UNKNOWN'),
}).strict())}).strict();
const buyerInvitationSchema=z.object({invitation:z.object({
  invitation_id:z.string(),registration_token:z.string(),registration_path:z.string(),wechat_id:z.string(),marketplace_code:z.string(),
  status:z.literal('ACTIVE'),version:z.number().int(),expires_at:z.number().int(),replayed:z.boolean(),
}).passthrough()}).strict();
const sellerInvitationSchema=z.object({invitation:z.object({
  invitation_id:z.string(),registration_token:z.string(),registration_path:z.string(),wechat_id:z.string(),marketplace_code:z.string(),
  seller_organization_id:z.string(),seller_name:z.string(),onboarding_kind:z.enum(['NEW_CUSTOMER','HISTORICAL_ACCOUNT_ONLY']),
  status:z.literal('ACTIVE'),version:z.number().int(),expires_at:z.number().int(),replayed:z.boolean(),
}).passthrough()}).strict();
type HistoricalMatch=z.output<typeof lookupSchema>['matches'][number];
type SavedLead={leadId:string;wechatId:string;marketplaceCode:string;displayName:string};

export function BuyerCustomersWorkspace():React.JSX.Element{return <CustomerIntakeWorkspace leadType="BUYER"/>;}
export function SellerCustomersWorkspace():React.JSX.Element{return <CustomerIntakeWorkspace leadType="SELLER"/>;}

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
    <header className="staff-customer-heading"><div><p className="eyebrow">{buyer?'买家客户接入':'卖家客户接入'}</p><h2>{buyer?'买家客户':'卖家客户'}</h2>
      <p>先查微信是否属于历史客户；新客户保存成功后立即计入当日新增，并在同一位置生成注册链接。</p></div></header>
    <Alert tone="info">普通员工只看到“渠道1、渠道2”等匿名编号。历史客户不补渠道、不重新计新增，原客户、店铺、产品和订单全部保留。</Alert>
    <HistoricalCustomerOnboarding leadType={leadType}/>
    {handoffs.data&&handoffs.data.length>0?<HandoffStrip leadType={leadType} items={handoffs.data}/>:null}
    <div className="customer-intake-grid">
      <LeadCreateCard leadType={leadType} channels={channels.data??[]} handoffs={handoffs.data??[]}/>
      <Card className="customer-intake-list"><h3>正式{buyer?'买家':'卖家'}线索</h3>
        {leads.isPending?<p role="status">正在加载</p>:leads.isError?<Alert tone="danger">客户线索暂时无法加载。</Alert>:leads.data.items.length===0?<EmptyState title={`暂无${buyer?'买家':'卖家'}线索`} description="加微信后在左侧建立正式线索。"/>:<DataTable caption={`${buyer?'买家':'卖家'}线索与业务进度`}><thead><tr><th>客户</th><th>站点</th><th>渠道</th><th>{buyer?'业务进度':'合作状态'}</th></tr></thead><tbody>{leads.data.items.map((lead)=><tr key={lead.lead_id}><td><strong>{lead.display_name??lead.wechat_masked}</strong><small>{lead.wechat_masked}</small></td><td>{marketLabel(lead.marketplace_code)}</td><td><StatusBadge tone="neutral">{lead.channel_label}</StatusBadge></td><td>{buyer?`${lead.registered?'网站已开通':'网站未开通'} · ${lead.formal_order_count} 单`:lead.seller_cooperation?'卖家组织已建立':'待开通卖家账号'}</td></tr>)}</tbody></DataTable>}
      </Card>
    </div>
    <Card className="buyer-security-tools"><h3>已有账号恢复</h3><p>这里只处理已经开通过{buyer?'买家网站':'卖家网站'}账号后忘记密码；首次开通都在上方完成。</p><StaffCustomerSecurityPanel showInvitationIssuer={false}/></Card>
  </main>;
}

function HistoricalCustomerOnboarding({leadType}:{leadType:'BUYER'|'SELLER'}){
  const client=useQueryClient();const buyer=leadType==='BUYER';const [wechat,setWechat]=useState('');const [link,setLink]=useState<string|null>(null);
  const lookup=useMutation({mutationFn:(value:string)=>identityApiRequest('staff',client,{path:`/api/staff/customer-onboarding/lookup?customer_type=${leadType}&wechat_id=${encodeURIComponent(value)}`,method:'GET',schema:lookupSchema})});
  const invite=useMutation({mutationFn:(match:HistoricalMatch)=>buyer
    ?issueHistoricalBuyerInvite(client,wechat,match.marketplace_code)
    :issueSellerInvite(client,{leadId:null,sellerOrganizationId:match.subject_id,wechatId:wechat,marketplaceCode:match.marketplace_code}),
    onSuccess:(response)=>setLink(`${window.location.origin}${response.data.invitation.registration_path}`),
  });
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setLink(null);const value=String(new FormData(event.currentTarget).get('wechat_id')??'').trim();setWechat(value);if(value)lookup.mutate(value);}
  const matches=lookup.data?.data.matches??[];
  return <Card className="historical-customer-onboarding"><div className="staff-section-toolbar"><div><h3>历史客户 / 已有客户查询</h3><p>先查微信，避免把历史客户重复新增。</p></div><StatusBadge tone="neutral">不计新增客户</StatusBadge></div>
    <form onSubmit={submit} className="historical-customer-search"><FormField label="微信号" htmlFor={`${leadType}-historical-wechat`}><TextInput id={`${leadType}-historical-wechat`} name="wechat_id" autoComplete="off" required/></FormField><Button className="secondary" loading={lookup.isPending}>查询已有客户</Button></form>
    {lookup.isSuccess&&matches.length===0?<Alert tone="info">没有找到已有{buyer?'买家':'卖家'}客户，可以按下方“新客户”流程建立正式线索。</Alert>:null}
    {matches.map((match)=><div className="historical-customer-result" key={`${match.customer_type}:${match.subject_id}`}><div><strong>{match.display_name}</strong><p>{marketLabel(match.marketplace_code)} · 历史订单 {match.historical_order_count} 单 · 历史客户 / 来源未知</p></div>{match.has_portal_account?<StatusBadge tone="success">账号已开通</StatusBadge>:<Button loading={invite.isPending} onClick={()=>invite.mutate(match)}>{buyer?'开通网站账号':'开通卖家账号'}</Button>}</div>)}
    {invite.isError?<Alert tone="danger">账号开通链接生成失败。请确认客户身份、站点和现有账号状态。</Alert>:null}
    {link?<FormField label={buyer?'历史买家账号开通链接':'历史卖家账号开通链接'} htmlFor={`${leadType}-historical-link`} description="复制后通过私人微信发送给客户"><TextInput id={`${leadType}-historical-link`} value={link} readOnly/></FormField>:null}
  </Card>;
}

function LeadCreateCard({leadType,channels,handoffs}:{leadType:'BUYER'|'SELLER';channels:readonly AcquisitionChannel[];handoffs:readonly AcquisitionHandoff[]}){
  const client=useQueryClient();const session=useCurrentStaffSession();const buyer=leadType==='BUYER';const [handoffId,setHandoffId]=useState('');const [saved,setSaved]=useState<SavedLead|null>(null);const [link,setLink]=useState<string|null>(null);
  const handoff=handoffs.find((item)=>item.prospect_id===handoffId)??null;
  const eligibleChannels=channels.filter((channel)=>channel.status==='ACTIVE'&&(channel.lead_type===leadType||channel.lead_type==='BOTH')&&(channel.visibility==='STAFF'||channel.intake_wechat_label!==null));
  const markets=useMemo(()=>{if(session.data_scope.type!=='GLOBAL'&&session.data_scope.marketplaceCodes.length>0)return session.data_scope.marketplaceCodes;return [...new Set(eligibleChannels.map((channel)=>channel.marketplace_code))];},[eligibleChannels,session.data_scope.marketplaceCodes,session.data_scope.type]);
  const create=useMutation({mutationFn:(input:{body:unknown;draft:Omit<SavedLead,'leadId'>})=>acquisitionApi.createLead(client,input.body,crypto.randomUUID()).then((response)=>({response,draft:input.draft})),onSuccess:({response,draft})=>{setSaved({leadId:response.data.lead.lead_id,...draft});setLink(null);void client.invalidateQueries({queryKey:['staff','customer-intake']});}});
  const invite=useMutation({mutationFn:(value:SavedLead)=>buyer
    ?issueNewBuyerInvite(client,value)
    :issueSellerInvite(client,{leadId:value.leadId,sellerOrganizationId:null,wechatId:value.wechatId,marketplaceCode:value.marketplaceCode}),
    onSuccess:(response)=>setLink(`${window.location.origin}${response.data.invitation.registration_path}`)});
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setSaved(null);setLink(null);const form=event.currentTarget,data=new FormData(form);const selected=handoffs.find((item)=>item.prospect_id===String(data.get('handoff_id')))??null;const marketplaceCode=selected?.marketplace_code??String(data.get('marketplace_code'));const wechatId=String(data.get('wechat_id'));const displayName=String(data.get('display_name')??'').trim()||wechatId;
    create.mutate({body:{lead_type:leadType,marketplace_code:marketplaceCode,channel_id:selected?.origin_channel_id??String(data.get('channel_id')),prospect_id:selected?.prospect_id??null,wechat_id:wechatId,display_name:nullable(data.get('display_name')),note:nullable(data.get('note'))},draft:{wechatId,marketplaceCode,displayName}},{onSuccess:()=>{form.reset();setHandoffId('');}});}
  return <Card className="customer-intake-create"><h3>新{buyer?'买家':'卖家'}客户</h3><p>保存成功即计入当天新增客户；账号开通是后续独立步骤。</p><form onSubmit={submit}>
    {handoffs.length>0?<FormField label="待接入客户（可选）" htmlFor={`${leadType}-handoff`} description="获客岗位交接的客户会自动继承渠道编号"><Select id={`${leadType}-handoff`} name="handoff_id" value={handoffId} onChange={(event)=>setHandoffId(event.target.value)}><option value="">不是交接客户</option>{handoffs.map((item)=><option key={item.prospect_id} value={item.prospect_id}>{item.display_name} · {item.channel_label}</option>)}</Select></FormField>:<input type="hidden" name="handoff_id" value=""/>}
    <FormField label="站点" htmlFor={`${leadType}-market`}>{handoff?<><input type="hidden" name="marketplace_code" value={handoff.marketplace_code}/><TextInput id={`${leadType}-market`} value={marketLabel(handoff.marketplace_code)} readOnly/></>:<Select id={`${leadType}-market`} name="marketplace_code" required>{markets.map((market)=><option key={market} value={market}>{marketLabel(market)}</option>)}</Select>}</FormField>
    <FormField label="渠道" htmlFor={`${leadType}-channel`} description="员工只看到匿名渠道编号">{handoff?<><input type="hidden" name="channel_id" value={handoff.origin_channel_id}/><TextInput id={`${leadType}-channel`} value={handoff.channel_label} readOnly/></>:<Select id={`${leadType}-channel`} name="channel_id" required><option value="">请选择渠道</option>{eligibleChannels.map((channel)=><option key={channel.channel_id} value={channel.channel_id}>{channel.staff_label}</option>)}</Select>}</FormField>
    <FormField label="微信号" htmlFor={`${leadType}-wechat`} description="正式客户登记从已经加上微信开始"><TextInput id={`${leadType}-wechat`} name="wechat_id" required autoComplete="off"/></FormField>
    <FormField label={buyer?'称呼（可选）':'公司 / 客户名称'} htmlFor={`${leadType}-name`}><TextInput id={`${leadType}-name`} name="display_name" required={!buyer}/></FormField>
    <FormField label="备注（可选）" htmlFor={`${leadType}-note`}><TextInput id={`${leadType}-note`} name="note"/></FormField>
    <Button loading={create.isPending} loadingLabel="正在保存">保存新{buyer?'买家':'卖家'}客户</Button>{create.isError?<Alert tone="danger">保存未完成。如果这个微信属于历史客户，请使用上方“历史客户 / 已有客户查询”。</Alert>:null}
  </form>
  {saved?<div className="customer-registration-success"><Alert tone="success"><strong>{saved.displayName}</strong> 已成功登记为新增{buyer?'买家':'卖家'}客户。现在可以生成网站注册链接。</Alert><Button loading={invite.isPending} onClick={()=>invite.mutate(saved)}>生成{buyer?'买家':'卖家'}注册链接</Button></div>:null}
  {invite.isError?<Alert tone="danger">注册链接生成失败，请检查客户是否已经开通过账号。</Alert>:null}
  {link?<FormField label={`${buyer?'买家':'卖家'}注册链接`} htmlFor={`${leadType}-new-registration-link`} description="复制后通过私人微信发送给客户"><TextInput id={`${leadType}-new-registration-link`} value={link} readOnly/></FormField>:null}
  </Card>;
}

async function issueHistoricalBuyerInvite(client:ReturnType<typeof useQueryClient>,wechatId:string,marketplaceCode:string){
  const body={wechat_id:wechatId,marketplace_code:marketplaceCode};
  return identityApiRequest('staff',client,{path:'/api/staff/customer-security/buyer-invitations',method:'POST',schema:buyerInvitationSchema,body,headers:operationHeaders({key:crypto.randomUUID(),body})});
}
async function issueNewBuyerInvite(client:ReturnType<typeof useQueryClient>,value:SavedLead){
  const body={lead_id:value.leadId,wechat_id:value.wechatId,marketplace_code:value.marketplaceCode};
  return identityApiRequest('staff',client,{path:'/api/staff/customer-onboarding/buyer-registration-invitations',method:'POST',schema:buyerInvitationSchema,body,headers:operationHeaders({key:crypto.randomUUID(),body})});
}
async function issueSellerInvite(client:ReturnType<typeof useQueryClient>,input:{leadId:string|null;sellerOrganizationId:string|null;wechatId:string;marketplaceCode:string}){
  const body={lead_id:input.leadId,seller_organization_id:input.sellerOrganizationId,wechat_id:input.wechatId,marketplace_code:input.marketplaceCode};
  return identityApiRequest('staff',client,{path:'/api/staff/customer-security/seller-invitations',method:'POST',schema:sellerInvitationSchema,body,headers:operationHeaders({key:crypto.randomUUID(),body})});
}
function HandoffStrip({leadType,items}:{leadType:'BUYER'|'SELLER';items:readonly AcquisitionHandoff[]}){return <section className="customer-handoff-strip"><div><strong>待人工接入 {items.length}</strong><span>获客岗位已筛选并交给{leadType==='BUYER'?'售前':'卖家对接'}；这里只显示渠道编号。</span></div><div>{items.slice(0,4).map((item)=><span className="handoff-chip" key={item.prospect_id}>{item.display_name} · {item.channel_label}</span>)}</div></section>;}
function nullable(value:FormDataEntryValue|null){const text=String(value??'').trim();return text?text:null;}
function marketLabel(code:string){return MARKET_LABELS[code]??'未命名站点';}
