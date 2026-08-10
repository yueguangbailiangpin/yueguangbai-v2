import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import {
  Alert, Button, Card, DataTable, EmptyState, FormField, MetricCard,
  Select, StatusBadge, TextInput,
} from '../../ui/primitives';
import { acquisitionApi } from './api';
import type { AcquisitionChannel, AcquisitionProspect } from './runtime';

const MARKETPLACES=[
  ['AMAZON_JP','Amazon 日本'],['AMAZON_US','Amazon 美国'],['COUPANG_KR','Coupang 韩国'],
  ['RAKUTEN_JP','Rakuten 日本'],['TIKTOK_JP','TikTok 日本'],
] as const;
type Tab='overview'|'prospects'|'daily'|'channels'|'stats'|'codex';

type ChannelStat=Awaited<ReturnType<typeof acquisitionApi.channelStats>>['data']['channels'][number];

export function AcquisitionCoreWorkbenchV2():React.JSX.Element{
  const session=useCurrentStaffSession();
  const client=useQueryClient();
  const owner=session.role.code==='owner';
  const operator=owner||session.role.code==='acquisition';
  const [tab,setTab]=useState<Tab>('overview');
  const range=useMemo(currentMonthRange,[]);
  const channels=useQuery({
    queryKey:['staff','acquisition-core','channels',session.authorization_version],
    queryFn:({signal})=>acquisitionApi.channels(client,signal).then((r)=>r.data.channels),
    enabled:operator,retry:false,
  });
  const [prospects,consultations,funnel,stats]=useQueries({queries:[
    {queryKey:['staff','acquisition-core','prospects',session.authorization_version],queryFn:({signal})=>acquisitionApi.prospects(client,{leadType:null,status:null,cursor:null},signal).then((r)=>r.data),enabled:operator,retry:false},
    {queryKey:['staff','acquisition-core','consultations',range.from,range.to,session.authorization_version],queryFn:({signal})=>acquisitionApi.consultations(client,range.from,range.to,signal).then((r)=>r.data.consultations),enabled:operator,retry:false},
    {queryKey:['staff','acquisition-core','funnel',range.from,range.to,session.authorization_version],queryFn:({signal})=>acquisitionApi.funnel(client,range.from,range.to,signal).then((r)=>r.data.funnel),enabled:operator,retry:false},
    {queryKey:['staff','acquisition-core','channel-stats',range.from,range.to,session.authorization_version],queryFn:({signal})=>acquisitionApi.channelStats(client,range.from,range.to,signal).then((r)=>r.data.channels),enabled:operator,retry:false},
  ]});
  if(!operator)return <main className="acquisition-workbench"><Alert tone="danger">当前岗位不使用客户开发中心。</Alert></main>;
  const tabs:readonly [Tab,string][]=owner
    ? [['overview','概览'],['prospects','潜在线索'],['daily','今日渠道数据'],['channels','渠道管理'],['stats','渠道统计'],['codex','Codex 接入']]
    : [['overview','概览'],['prospects','潜在线索'],['daily','今日渠道数据'],['stats','渠道统计']];
  return <main className="acquisition-workbench acquisition-core">
    <header className="acquisition-core-heading"><div><p className="eyebrow">Moonwhite Acquisition Core</p><h2>客户开发中心</h2><p>渠道 → 潜在线索 → 正式线索 → 客户 → 订单 / 利润。买家和卖家共用同一条来源链。</p></div></header>
    <nav className="acquisition-core-tabs" aria-label="客户开发中心导航">{tabs.map(([key,label])=><Button key={key} className={tab===key?'':'secondary'} onClick={()=>setTab(key)}>{label}</Button>)}</nav>
    {channels.isError||prospects.isError||consultations.isError||funnel.isError||stats.isError?<Alert tone="warning">部分获客数据暂时无法加载；已成功读取的区域仍可使用。</Alert>:null}
    {tab==='overview'?<Overview funnel={funnel.data} prospects={prospects.data?.items??[]} />:null}
    {tab==='prospects'?<Prospects channels={channels.data??[]} items={prospects.data?.items??[]} />:null}
    {tab==='daily'?<Daily channels={channels.data??[]} items={consultations.data??[]} />:null}
    {tab==='channels'&&owner?<Channels items={channels.data??[]} />:null}
    {tab==='stats'?<Stats items={stats.data??[]} />:null}
    {tab==='codex'&&owner?<CodexPanel />:null}
  </main>;
}

function Overview({funnel,prospects}:{funnel:Awaited<ReturnType<typeof acquisitionApi.funnel>>['data']['funnel']|undefined;prospects:readonly AcquisitionProspect[]}){
  const buyer=prospects.filter((p)=>p.lead_type==='BUYER'&&!['CONVERTED','LOST'].includes(p.status)).length;
  const seller=prospects.filter((p)=>p.lead_type==='SELLER'&&!['CONVERTED','LOST'].includes(p.status)).length;
  return <>
    <section className="acquisition-summary">
      <MetricCard label="买家潜在线索" value={buyer} detail="人工 + Codex"/>
      <MetricCard label="卖家潜在线索" value={seller} detail="人工 + Codex"/>
      <MetricCard label="本月买家加微信" value={funnel?.buyer?.wechat_added_count??'—'} detail="正式 Buyer Lead"/>
      <MetricCard label="本月卖家加微信" value={funnel?.seller?.wechat_added_count??'—'} detail="正式 Seller Lead"/>
    </section>
    <Card className="acquisition-flow-card"><h3>统一来源链</h3><ol className="acquisition-flow">
      <li><strong>1. 渠道</strong><span>小红书 / 知无不言 / TikTok / BOSS…</span></li>
      <li><strong>2. Prospect</strong><span>还没加微信的潜在客户，可跳过</span></li>
      <li><strong>3. Lead</strong><span>加微信后由售前 / 卖家对接接住</span></li>
      <li><strong>4. Customer</strong><span>进入正式业务客户体系</span></li>
      <li><strong>5. Order / Profit</strong><span>自动归因回最初渠道</span></li>
    </ol></Card>
  </>;
}

function Prospects({channels,items}:{channels:readonly AcquisitionChannel[];items:readonly AcquisitionProspect[]}){
  const client=useQueryClient();
  const [showForm,setShowForm]=useState(false);
  const create=useMutation({
    mutationFn:(body:unknown)=>acquisitionApi.createProspect(client,body,crypto.randomUUID()),
    onSuccess:()=>client.invalidateQueries({queryKey:['staff','acquisition-core']}),
  });
  const handoff=useMutation({
    mutationFn:({id,body}:{id:string;body:unknown})=>acquisitionApi.updateProspect(client,id,body,crypto.randomUUID()),
    onSuccess:()=>client.invalidateQueries({queryKey:['staff','acquisition-core']}),
  });
  function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=event.currentTarget,data=new FormData(form);
    create.mutate({lead_type:String(data.get('lead_type')),marketplace_code:String(data.get('marketplace_code')),channel_id:String(data.get('channel_id')),display_name:String(data.get('display_name')),contact_value:nullable(data.get('contact_value')),source_url:nullable(data.get('source_url')),origin_mode:'HUMAN',note:nullable(data.get('note')),ai_score:null},{onSuccess:()=>{form.reset();setShowForm(false);}});
  }
  return <section className="acquisition-prospects">
    <div className="staff-section-toolbar"><div><h3>潜在线索</h3><p>还没加微信、尚未进入正式客户流程的人或公司先放这里。</p></div><Button onClick={()=>setShowForm((v)=>!v)}>{showForm?'取消':'新增潜在线索'}</Button></div>
    {showForm?<Card className="acquisition-inline-form"><form onSubmit={submit}>
      <FormField label="类型" htmlFor="prospect-type"><Select id="prospect-type" name="lead_type"><option value="SELLER">卖家</option><option value="BUYER">买家</option></Select></FormField>
      <FormField label="站点" htmlFor="prospect-market"><Select id="prospect-market" name="marketplace_code">{MARKETPLACES.map(([code,label])=><option key={code} value={code}>{label}</option>)}</Select></FormField>
      <FormField label="来源渠道" htmlFor="prospect-channel"><Select id="prospect-channel" name="channel_id" required><option value="">请选择</option>{channels.filter((c)=>c.status==='ACTIVE').map((c)=><option key={c.channel_id} value={c.channel_id}>{c.display_name}</option>)}</Select></FormField>
      <FormField label="名称" htmlFor="prospect-name"><TextInput id="prospect-name" name="display_name" required/></FormField>
      <FormField label="联系方式（可空）" htmlFor="prospect-contact"><TextInput id="prospect-contact" name="contact_value"/></FormField>
      <FormField label="来源链接（可空）" htmlFor="prospect-url"><TextInput id="prospect-url" name="source_url"/></FormField>
      <FormField label="发现信号 / 备注" htmlFor="prospect-note"><TextInput id="prospect-note" name="note"/></FormField>
      <Button loading={create.isPending}>保存潜在线索</Button>
    </form></Card>:null}
    {items.length===0?<EmptyState title="暂无潜在线索" description="人工或未来 Codex 找到的客户会出现在这里。"/>:<DataTable caption="潜在线索列表"><thead><tr><th>潜在线索</th><th>类型</th><th>站点</th><th>来源</th><th>发现方式</th><th>评分</th><th>状态</th><th>交接</th></tr></thead><tbody>{items.map((p)=><tr key={p.prospect_id}>
      <td><strong>{p.display_name}</strong><small>{p.note??'—'}</small></td>
      <td>{p.lead_type==='BUYER'?'买家':'卖家'}</td><td>{marketLabel(p.marketplace_code)}</td><td>{p.origin_channel_name}</td>
      <td><StatusBadge tone={p.origin_mode==='CODEX'?'processing':'neutral'}>{p.origin_mode==='CODEX'?'Codex':'人工'}</StatusBadge></td>
      <td>{p.ai_score??'—'}</td><td>{prospectStatus(p.status)}</td>
      <td>{!['HUMAN_HANDOFF','CONVERTED','LOST'].includes(p.status)?<Button className="secondary" loading={handoff.isPending} onClick={()=>handoff.mutate({id:p.prospect_id,body:{expected_version:p.version,status:'HUMAN_HANDOFF',ai_score:p.ai_score,note:p.note}})}>交给人工</Button>:p.status==='HUMAN_HANDOFF'?<StatusBadge tone="processing">待接入</StatusBadge>:'—'}</td>
    </tr>)}</tbody></DataTable>}
  </section>;
}

function Daily({channels,items}:{channels:readonly AcquisitionChannel[];items:readonly {consultation_id:string;channel_id:string;business_date:string;person_count:number;version:number}[]}){
  const client=useQueryClient();const today=shanghaiDate(Date.now());
  const mutation=useMutation({mutationFn:(body:unknown)=>acquisitionApi.recordConsultation(client,body,crypto.randomUUID()),onSuccess:()=>client.invalidateQueries({queryKey:['staff','acquisition-core']})});
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);const channelId=String(data.get('channel_id'));const existing=items.find((item)=>item.channel_id===channelId&&item.business_date===today);mutation.mutate({channel_id:channelId,business_date:today,person_count:Number(data.get('person_count')),expected_version:existing?.version??0,reason:existing?'更新当日咨询人数':'记录当日咨询人数'});}
  return <div className="acquisition-daily-grid">
    <Card><h3>今天的渠道数据</h3><div className="compact-list">{channels.filter((c)=>c.status==='ACTIVE').map((channel)=>{const current=items.find((item)=>item.channel_id===channel.channel_id&&item.business_date===today);return <div className="compact-row" key={channel.channel_id}><span><strong>{channel.display_name}</strong><small>{audienceLabel(channel.lead_type)} · {marketLabel(channel.marketplace_code)}</small></span><b>{current?.person_count??0}</b></div>;})}</div></Card>
    <Card><h3>填写 / 更正今天数据</h3><form onSubmit={submit}><FormField label="渠道" htmlFor="daily-channel"><Select id="daily-channel" name="channel_id" required><option value="">请选择</option>{channels.filter((c)=>c.status==='ACTIVE'&&c.lead_type!=='BOTH').map((c)=><option key={c.channel_id} value={c.channel_id}>{c.display_name}</option>)}</Select></FormField><FormField label="咨询人数" htmlFor="daily-count"><TextInput id="daily-count" name="person_count" type="number" min="0" required/></FormField><Button loading={mutation.isPending}>保存</Button></form></Card>
  </div>;
}

function Channels({items}:{items:readonly AcquisitionChannel[]}){
  const client=useQueryClient();const [show,setShow]=useState(false);
  const mutation=useMutation({mutationFn:(body:unknown)=>acquisitionApi.createChannel(client,body,crypto.randomUUID()),onSuccess:()=>client.invalidateQueries({queryKey:['staff','acquisition-core']})});
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget,data=new FormData(form);mutation.mutate({code:`CHANNEL_${Date.now()}`,platform_name:String(data.get('platform_name')),lead_type:String(data.get('lead_type')),marketplace_code:String(data.get('marketplace_code')),display_name:String(data.get('display_name'))},{onSuccess:()=>{form.reset();setShow(false);}});}
  return <section>
    <div className="staff-section-toolbar"><div><h3>渠道管理</h3><p>平台名称是数据，不需要为了 TikTok / X / 知无不言再改代码。</p></div><Button onClick={()=>setShow((v)=>!v)}>{show?'取消':'新增渠道'}</Button></div>
    {show?<Card className="acquisition-inline-form"><form onSubmit={submit}>
      <FormField label="平台" htmlFor="channel-platform"><TextInput id="channel-platform" name="platform_name" placeholder="例如：TikTok" required/></FormField>
      <FormField label="渠道名称" htmlFor="channel-name"><TextInput id="channel-name" name="display_name" placeholder="例如：TikTok 日本买家推广" required/></FormField>
      <FormField label="客户类型" htmlFor="channel-audience"><Select id="channel-audience" name="lead_type"><option value="BUYER">买家</option><option value="SELLER">卖家</option><option value="BOTH">两者</option></Select></FormField>
      <FormField label="站点" htmlFor="channel-market"><Select id="channel-market" name="marketplace_code">{MARKETPLACES.map(([code,label])=><option key={code} value={code}>{label}</option>)}</Select></FormField>
      <Button loading={mutation.isPending}>创建渠道</Button>
    </form></Card>:null}
    <DataTable caption="获客渠道"><thead><tr><th>渠道</th><th>平台</th><th>客户类型</th><th>站点</th><th>状态</th></tr></thead><tbody>{items.map((channel)=><tr key={channel.channel_id}><td><strong>{channel.display_name}</strong></td><td>{channel.platform_name}</td><td>{audienceLabel(channel.lead_type)}</td><td>{marketLabel(channel.marketplace_code)}</td><td><StatusBadge tone={channel.status==='ACTIVE'?'success':'neutral'}>{channel.status==='ACTIVE'?'启用':'停用'}</StatusBadge></td></tr>)}</tbody></DataTable>
  </section>;
}

function Stats({items}:{items:readonly ChannelStat[]}){
  if(items.length===0)return <EmptyState title="暂无渠道统计" description="有渠道数据后会按真实来源归因显示。"/>;
  return <section>
    <Alert tone="info">这些数字按每个来源渠道真实计算，不会把全局漏斗重复到每个渠道。订单和利润通过 Lead 的来源链归因。</Alert>
    <DataTable caption="渠道来源、客户转化、订单和利润"><thead><tr><th>渠道</th><th>咨询</th><th>潜客</th><th>Codex</th><th>加微信</th><th>注册/合作</th><th>订单</th><th>预计利润</th><th>完成利润</th></tr></thead><tbody>{items.map((item)=><tr key={item.channel_id}>
      <td><strong>{item.channel_name}</strong><small>{item.platform_name} · {marketLabel(item.marketplace_code)}</small></td>
      <td>{item.consultation_count}</td><td>{item.prospect_count}</td><td>{item.codex_prospect_count}</td><td>{item.lead_count}</td>
      <td>{item.lead_type==='BUYER'?item.registered_count:item.lead_type==='SELLER'?item.cooperation_count:`${item.registered_count}/${item.cooperation_count}`}</td>
      <td>{item.formal_order_count}</td><td>{formatFen(item.projected_gross_profit_cny_fen)}</td><td>{formatFen(item.completed_gross_profit_cny_fen)}</td>
    </tr>)}</tbody></DataTable>
  </section>;
}

function CodexPanel(){return <section className="codex-acquisition-panel">
  <Card><p className="eyebrow">预留机器入口</p><h3>Codex / 自动化获客</h3><p>未来 Codex 直接调用专用 Acquisition API，不模拟点击员工页面。</p><div className="codex-boundary-grid"><div><strong>允许</strong><span>创建 Prospect</span><span>补充公开 Signal</span><span>更新 AI Score / 研究状态</span></div><div><strong>禁止</strong><span>订单与财务</span><span>返款</span><span>员工与权限</span><span>直接成交客户</span></div></div></Card>
  <Card><h3>机器接口边界</h3><code>/api/acquisition-machine/prospects</code><code>/api/acquisition-machine/prospects/:id/signals</code><code>/api/acquisition-machine/prospects/:id/analysis</code><p>使用独立 Machine Secret，与 Staff Email OTP 完全分离。</p></Card>
</section>}

function currentMonthRange(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const values=Object.fromEntries(parts.map((p)=>[p.type,p.value]));return{from:`${values['year']}-${values['month']}-01`,to:`${values['year']}-${values['month']}-${values['day']}`};}
function shanghaiDate(value:number){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
function nullable(value:FormDataEntryValue|null){const text=String(value??'').trim();return text?text:null;}
function marketLabel(code:string){return MARKETPLACES.find(([value])=>value===code)?.[1]??code;}
function audienceLabel(value:string){return value==='BUYER'?'买家':value==='SELLER'?'卖家':'买家 / 卖家';}
function prospectStatus(value:string){return({NEW:'新发现',RESEARCHING:'研究中',QUALIFIED:'已筛选',READY_CONTACT:'待联系',CONTACTED:'已联系',HUMAN_HANDOFF:'待人工接入',CONVERTED:'已转正式线索',LOST:'放弃'} as Record<string,string>)[value]??value;}
function formatFen(value:string|null){if(value===null)return'—';const raw=BigInt(value),sign=raw<0n?'-':'',abs=raw<0n?-raw:raw;return`${sign}¥${abs/100n}.${(abs%100n).toString().padStart(2,'0')}`;}
