import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import {
  Alert, Button, Card, DataTable, EmptyState, FormField, MetricCard,
  Select, StatusBadge, TextInput,
} from '../../ui/primitives';
import { acquisitionApi } from './api';
import type { AcquisitionInternalChannel, AcquisitionProspect } from './runtime';

const MARKETPLACES=[
  ['AMAZON_JP','亚马逊日本站'],['AMAZON_US','亚马逊美国站'],['COUPANG_KR','Coupang 韩国站'],
  ['RAKUTEN_JP','乐天日本站'],['TIKTOK_JP','TikTok 日本站'],
] as const;
type Tab='overview'|'prospects'|'daily'|'channels'|'stats'|'codex';
type ChannelStat=Awaited<ReturnType<typeof acquisitionApi.channelStats>>['data']['channels'][number];

export function AcquisitionCoreWorkbenchV2():React.JSX.Element{
  const session=useCurrentStaffSession();const client=useQueryClient();
  const owner=session.role.code==='owner';const operator=owner||session.role.code==='acquisition';
  const [tab,setTab]=useState<Tab>('overview');const range=useMemo(currentMonthRange,[]);
  const channels=useQuery({
    queryKey:['staff','acquisition-core','channels',session.authorization_version],
    queryFn:({signal})=>acquisitionApi.channels(client,signal).then((r)=>r.data.channels.filter((channel):channel is AcquisitionInternalChannel=>channel.visibility==='INTERNAL')),
    enabled:operator,retry:false,
  });
  const [prospects,consultations,funnel,stats]=useQueries({queries:[
    {queryKey:['staff','acquisition-core','prospects',session.authorization_version],queryFn:({signal})=>acquisitionApi.prospects(client,{leadType:null,status:null,cursor:null},signal).then((r)=>r.data),enabled:operator,retry:false},
    {queryKey:['staff','acquisition-core','consultations',range.from,range.to,session.authorization_version],queryFn:({signal})=>acquisitionApi.consultations(client,range.from,range.to,signal).then((r)=>r.data.consultations),enabled:operator,retry:false},
    {queryKey:['staff','acquisition-core','funnel',range.from,range.to,session.authorization_version],queryFn:({signal})=>acquisitionApi.funnel(client,range.from,range.to,signal).then((r)=>r.data.funnel),enabled:operator,retry:false},
    {queryKey:['staff','acquisition-core','channel-stats',range.from,range.to,session.authorization_version],queryFn:({signal})=>acquisitionApi.channelStats(client,range.from,range.to,signal).then((r)=>r.data.channels),enabled:operator,retry:false},
  ]});
  if(!operator)return <main className="acquisition-workbench"><Alert tone="danger">当前岗位不使用客户开发中心。</Alert></main>;
  const tabs:readonly [Tab,string][]=[
    ['overview','概览'],['prospects','潜在线索'],['daily','每日渠道数据'],['channels','渠道信息'],['stats','渠道统计'],
    ...(owner?[['codex','Codex 自动开发接入'] as const]:[]),
  ];
  return <main className="acquisition-workbench acquisition-core">
    <header className="acquisition-core-heading"><div><p className="eyebrow">月光白客户开发中心</p><h2>客户开发中心</h2><p>渠道 → 潜在线索 → 正式线索 → 客户 → 订单 / 利润。真实开发来源仅总管理员和获客岗位可见。</p></div></header>
    <nav className="acquisition-core-tabs" aria-label="客户开发中心导航">{tabs.map(([key,label])=><Button key={key} className={tab===key?'':'secondary'} onClick={()=>setTab(key)}>{label}</Button>)}</nav>
    {channels.isError||prospects.isError||consultations.isError||funnel.isError||stats.isError?<Alert tone="warning">部分客户开发数据暂时无法加载；已成功读取的区域仍可使用。</Alert>:null}
    {tab==='overview'?<Overview funnel={funnel.data} prospects={prospects.data?.items??[]}/>:null}
    {tab==='prospects'?<Prospects channels={channels.data??[]} items={prospects.data?.items??[]}/>:null}
    {tab==='daily'?<Daily channels={channels.data??[]} items={consultations.data??[]}/>:null}
    {tab==='channels'?<Channels items={channels.data??[]} owner={owner}/>:null}
    {tab==='stats'?<Stats items={stats.data??[]}/>:null}
    {tab==='codex'&&owner?<CodexPanel/>:null}
  </main>;
}

function Overview({funnel,prospects}:{funnel:Awaited<ReturnType<typeof acquisitionApi.funnel>>['data']['funnel']|undefined;prospects:readonly AcquisitionProspect[]}){
  const buyer=prospects.filter((p)=>p.lead_type==='BUYER'&&!['CONVERTED','LOST'].includes(p.status)).length;
  const seller=prospects.filter((p)=>p.lead_type==='SELLER'&&!['CONVERTED','LOST'].includes(p.status)).length;
  return <>
    <section className="acquisition-summary">
      <MetricCard label="买家潜在线索" value={buyer} detail="人工开发 + Codex 自动开发"/>
      <MetricCard label="卖家潜在线索" value={seller} detail="人工开发 + Codex 自动开发"/>
      <MetricCard label="本月买家加微信" value={funnel?.buyer?.wechat_added_count??'—'} detail="已经建立正式买家线索"/>
      <MetricCard label="本月卖家加微信" value={funnel?.seller?.wechat_added_count??'—'} detail="已经建立正式卖家线索"/>
    </section>
    <Card className="acquisition-flow-card"><h3>统一客户来源链</h3><ol className="acquisition-flow">
      <li><strong>1. 渠道</strong><span>真实平台、真实渠道和对应接待微信</span></li>
      <li><strong>2. 潜在线索</strong><span>还没有加微信的潜在客户；广告直接加微信时可以跳过</span></li>
      <li><strong>3. 正式线索</strong><span>加微信后交给售前或卖家对接</span></li>
      <li><strong>4. 正式客户</strong><span>进入买家或卖家的正式业务体系</span></li>
      <li><strong>5. 订单与利润</strong><span>系统自动归因回最初渠道</span></li>
    </ol></Card>
  </>;
}

function Prospects({channels,items}:{channels:readonly AcquisitionInternalChannel[];items:readonly AcquisitionProspect[]}){
  const client=useQueryClient();const [showForm,setShowForm]=useState(false);
  const create=useMutation({mutationFn:(body:unknown)=>acquisitionApi.createProspect(client,body,crypto.randomUUID()),onSuccess:()=>client.invalidateQueries({queryKey:['staff','acquisition-core']})});
  const handoff=useMutation({mutationFn:({id,body}:{id:string;body:unknown})=>acquisitionApi.updateProspect(client,id,body,crypto.randomUUID()),onSuccess:()=>client.invalidateQueries({queryKey:['staff','acquisition-core']})});
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget,data=new FormData(form);create.mutate({lead_type:String(data.get('lead_type')),marketplace_code:String(data.get('marketplace_code')),channel_id:String(data.get('channel_id')),display_name:String(data.get('display_name')),contact_value:nullable(data.get('contact_value')),source_url:nullable(data.get('source_url')),origin_mode:'HUMAN',note:nullable(data.get('note')),ai_score:null},{onSuccess:()=>{form.reset();setShowForm(false);}});}
  return <section className="acquisition-prospects">
    <div className="staff-section-toolbar"><div><h3>潜在线索</h3><p>还没有加微信、尚未进入正式客户流程的人或公司先放这里。</p></div><Button onClick={()=>setShowForm((value)=>!value)}>{showForm?'取消':'新增潜在线索'}</Button></div>
    {showForm?<Card className="acquisition-inline-form"><form onSubmit={submit}>
      <FormField label="客户类型" htmlFor="prospect-type"><Select id="prospect-type" name="lead_type"><option value="SELLER">卖家</option><option value="BUYER">买家</option></Select></FormField>
      <FormField label="站点" htmlFor="prospect-market"><Select id="prospect-market" name="marketplace_code">{MARKETPLACES.map(([code,label])=><option key={code} value={code}>{label}</option>)}</Select></FormField>
      <FormField label="真实来源渠道" htmlFor="prospect-channel"><Select id="prospect-channel" name="channel_id" required><option value="">请选择</option>{channels.filter((channel)=>channel.status==='ACTIVE').map((channel)=><option key={channel.channel_id} value={channel.channel_id}>{channel.display_name}（员工看到：{channel.staff_label}）</option>)}</Select></FormField>
      <FormField label="客户 / 公司名称" htmlFor="prospect-name"><TextInput id="prospect-name" name="display_name" required/></FormField>
      <FormField label="联系方式（可空）" htmlFor="prospect-contact"><TextInput id="prospect-contact" name="contact_value"/></FormField>
      <FormField label="来源链接（可空）" htmlFor="prospect-url"><TextInput id="prospect-url" name="source_url"/></FormField>
      <FormField label="发现信号 / 备注" htmlFor="prospect-note"><TextInput id="prospect-note" name="note"/></FormField>
      <Button loading={create.isPending}>保存潜在线索</Button>
    </form></Card>:null}
    {items.length===0?<EmptyState title="暂无潜在线索" description="人工开发或未来 Codex 自动开发找到的客户会出现在这里。"/>:<DataTable caption="潜在线索列表"><thead><tr><th>潜在线索</th><th>客户类型</th><th>站点</th><th>真实来源</th><th>开发方式</th><th>评分</th><th>状态</th><th>交接</th></tr></thead><tbody>{items.map((prospect)=><tr key={prospect.prospect_id}>
      <td><strong>{prospect.display_name}</strong><small>{prospect.note??'—'}</small></td>
      <td>{prospect.lead_type==='BUYER'?'买家':'卖家'}</td><td>{marketLabel(prospect.marketplace_code)}</td><td>{prospect.origin_channel_name}</td>
      <td><StatusBadge tone={prospect.origin_mode==='CODEX'?'processing':'neutral'}>{prospect.origin_mode==='CODEX'?'Codex 自动开发':'人工开发'}</StatusBadge></td>
      <td>{prospect.ai_score??'—'}</td><td>{prospectStatus(prospect.status)}</td>
      <td>{!['HUMAN_HANDOFF','CONVERTED','LOST'].includes(prospect.status)?<Button className="secondary" loading={handoff.isPending} onClick={()=>handoff.mutate({id:prospect.prospect_id,body:{expected_version:prospect.version,status:'HUMAN_HANDOFF',ai_score:prospect.ai_score,note:prospect.note}})}>交给业务员工</Button>:prospect.status==='HUMAN_HANDOFF'?<StatusBadge tone="processing">等待接入</StatusBadge>:'—'}</td>
    </tr>)}</tbody></DataTable>}
  </section>;
}

function Daily({channels,items}:{channels:readonly AcquisitionInternalChannel[];items:readonly {consultation_id:string;channel_id:string;business_date:string;person_count:number;version:number}[]}){
  const client=useQueryClient();const today=shanghaiDate(Date.now());
  const mutation=useMutation({mutationFn:(body:unknown)=>acquisitionApi.recordConsultation(client,body,crypto.randomUUID()),onSuccess:()=>client.invalidateQueries({queryKey:['staff','acquisition-core']})});
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);const channelId=String(data.get('channel_id'));const existing=items.find((item)=>item.channel_id===channelId&&item.business_date===today);mutation.mutate({channel_id:channelId,business_date:today,person_count:Number(data.get('person_count')),expected_version:existing?.version??0,reason:existing?'更新当日咨询人数':'记录当日咨询人数'});}
  return <div className="acquisition-daily-grid">
    <Card><h3>今天的渠道数据</h3><div className="compact-list">{channels.filter((channel)=>channel.status==='ACTIVE').map((channel)=>{const current=items.find((item)=>item.channel_id===channel.channel_id&&item.business_date===today);return <div className="compact-row" key={channel.channel_id}><span><strong>{channel.display_name}</strong><small>{channel.staff_label} · {audienceLabel(channel.lead_type)} · {marketLabel(channel.marketplace_code)}</small></span><b>{current?.person_count??0}</b></div>;})}</div></Card>
    <Card><h3>填写 / 更正今天数据</h3><form onSubmit={submit}><FormField label="真实渠道" htmlFor="daily-channel"><Select id="daily-channel" name="channel_id" required><option value="">请选择</option>{channels.filter((channel)=>channel.status==='ACTIVE'&&channel.lead_type!=='BOTH').map((channel)=><option key={channel.channel_id} value={channel.channel_id}>{channel.display_name}（{channel.staff_label}）</option>)}</Select></FormField><FormField label="咨询人数" htmlFor="daily-count"><TextInput id="daily-count" name="person_count" type="number" min="0" required/></FormField><Button loading={mutation.isPending}>保存</Button></form></Card>
  </div>;
}

function Channels({items,owner}:{items:readonly AcquisitionInternalChannel[];owner:boolean}){
  const client=useQueryClient();const [show,setShow]=useState(false);const [editing,setEditing]=useState<AcquisitionInternalChannel|null>(null);
  const create=useMutation({mutationFn:(body:unknown)=>acquisitionApi.createChannel(client,body,crypto.randomUUID()),onSuccess:()=>client.invalidateQueries({queryKey:['staff','acquisition-core']})});
  const privacy=useMutation({mutationFn:({id,body}:{id:string;body:unknown})=>acquisitionApi.updateChannelPrivacy(client,id,body,crypto.randomUUID()),onSuccess:async()=>{setEditing(null);await client.invalidateQueries({queryKey:['staff','acquisition-core']});}});
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget,data=new FormData(form);create.mutate({code:`CHANNEL_${Date.now()}`,platform_name:String(data.get('platform_name')),lead_type:String(data.get('lead_type')),marketplace_code:String(data.get('marketplace_code')),display_name:String(data.get('display_name'))},{onSuccess:()=>{form.reset();setShow(false);}});}
  return <section>
    <div className="staff-section-toolbar"><div><h3>渠道信息</h3><p>真实平台和开发方式仅总管理员与获客岗位可见；售前和卖家对接只看到“渠道1、渠道2…”等匿名编号。</p></div>{owner?<Button onClick={()=>setShow((value)=>!value)}>{show?'取消':'新增真实渠道'}</Button>:null}</div>
    {show&&owner?<Card className="acquisition-inline-form"><form onSubmit={submit}>
      <FormField label="真实平台" htmlFor="channel-platform"><TextInput id="channel-platform" name="platform_name" placeholder="例如：小红书 / 知无不言 / TikTok" required/></FormField>
      <FormField label="真实渠道名称" htmlFor="channel-name"><TextInput id="channel-name" name="display_name" placeholder="例如：小红书买家推广一组" required/></FormField>
      <FormField label="客户类型" htmlFor="channel-audience"><Select id="channel-audience" name="lead_type"><option value="BUYER">买家</option><option value="SELLER">卖家</option></Select></FormField>
      <FormField label="站点" htmlFor="channel-market"><Select id="channel-market" name="marketplace_code">{MARKETPLACES.map(([code,label])=><option key={code} value={code}>{label}</option>)}</Select></FormField>
      <Alert tone="info">创建后系统会自动分配一个“渠道N”编号。再配置对应接待微信后，业务员工才会看到并可使用该渠道。</Alert>
      <Button loading={create.isPending}>创建真实渠道</Button>
    </form></Card>:null}
    {editing&&owner?<Card className="acquisition-inline-form"><h4>配置员工可见渠道</h4><form onSubmit={(event)=>{event.preventDefault();const data=new FormData(event.currentTarget);privacy.mutate({id:editing.channel_id,body:{expected_version:editing.profile_version,staff_label:String(data.get('staff_label')),intake_wechat_label:String(data.get('intake_wechat_label'))}});}}>
      <Alert tone="warning">售前 / 卖家对接只会收到下面的渠道编号，不会收到真实平台和真实渠道名称。</Alert>
      <FormField label="员工看到的渠道编号" htmlFor="privacy-label"><TextInput id="privacy-label" name="staff_label" defaultValue={editing.staff_label} placeholder="例如：渠道1" required/></FormField>
      <FormField label="对应接待微信" htmlFor="privacy-wechat"><TextInput id="privacy-wechat" name="intake_wechat_label" defaultValue={editing.intake_wechat_label??''} placeholder="例如：买家微信1 / wxid_xxx" required/></FormField>
      <div className="entry-actions"><Button type="button" className="secondary" onClick={()=>setEditing(null)}>取消</Button><Button loading={privacy.isPending}>保存配置</Button></div>
    </form></Card>:null}
    <DataTable caption="获客渠道内部配置"><thead><tr><th>员工看到</th><th>真实平台</th><th>真实渠道</th><th>对应接待微信</th><th>客户类型</th><th>站点</th><th>状态</th>{owner?<th>操作</th>:null}</tr></thead><tbody>{items.map((channel)=><tr key={channel.channel_id}>
      <td><strong>{channel.staff_label}</strong></td><td>{channel.platform_name}</td><td>{channel.display_name}</td>
      <td>{channel.intake_wechat_label??<StatusBadge tone="warning">尚未配置</StatusBadge>}</td>
      <td>{audienceLabel(channel.lead_type)}</td><td>{marketLabel(channel.marketplace_code)}</td>
      <td><StatusBadge tone={channel.status==='ACTIVE'?'success':'neutral'}>{channel.status==='ACTIVE'?'启用':'已停用'}</StatusBadge></td>
      {owner?<td><Button className="secondary" onClick={()=>setEditing(channel)}>配置</Button></td>:null}
    </tr>)}</tbody></DataTable>
  </section>;
}

function Stats({items}:{items:readonly ChannelStat[]}){
  if(items.length===0)return <EmptyState title="暂无渠道统计" description="产生渠道数据后会自动汇总。"/>;
  return <DataTable caption="渠道转化与经营统计"><thead><tr><th>真实渠道</th><th>客户类型</th><th>咨询</th><th>潜在线索</th><th>Codex 自动开发</th><th>正式线索</th><th>注册 / 合作</th><th>正式订单</th><th>预计毛利</th></tr></thead><tbody>{items.map((item)=><tr key={item.channel_id}>
    <td><strong>{item.channel_name}</strong><small>{item.platform_name} · {marketLabel(item.marketplace_code)}</small></td>
    <td>{audienceLabel(item.lead_type)}</td><td>{item.consultation_count}</td><td>{item.prospect_count}</td><td>{item.codex_prospect_count}</td><td>{item.lead_count}</td><td>{item.lead_type==='BUYER'?item.registered_count:item.cooperation_count}</td><td>{item.formal_order_count}</td><td>{money(item.projected_gross_profit_cny_fen)}</td>
  </tr>)}</tbody></DataTable>;
}

function CodexPanel(){return <div className="acquisition-codex-grid">
  <Card><h3>Codex 自动开发专用入口</h3><p>Codex 不模拟员工点击网页，而是通过独立机器接口写入潜在线索、开发信号和评分。</p><code>/api/acquisition-machine/prospects</code></Card>
  <Card><h3>允许的动作</h3><ul><li>创建潜在线索</li><li>补充公开信息和开发信号</li><li>更新评分与研究状态</li><li>生成待人工接入建议</li></ul></Card>
  <Card><h3>禁止的动作</h3><ul><li>修改订单</li><li>记录返款</li><li>修改财务</li><li>修改员工权限</li><li>直接把潜在线索变成成交客户</li></ul></Card>
</div>;}

function currentMonthRange(){const now=new Date();const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);const year=Number(parts.find((part)=>part.type==='year')?.value);const month=Number(parts.find((part)=>part.type==='month')?.value);return{from:`${year}-${String(month).padStart(2,'0')}-01`,to:new Date(Date.UTC(year,month,0)).toISOString().slice(0,10)};}
function shanghaiDate(value:number){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
function marketLabel(code:string){return MARKETPLACES.find(([value])=>value===code)?.[1]??'未命名站点';}
function audienceLabel(value:string){return value==='BUYER'?'买家':value==='SELLER'?'卖家':'买家与卖家';}
function prospectStatus(value:string){return({NEW:'新发现',RESEARCHING:'研究中',QUALIFIED:'符合条件',READY_CONTACT:'可联系',CONTACTED:'已联系',HUMAN_HANDOFF:'等待业务员工接入',CONVERTED:'已转正式线索',LOST:'不再跟进'} as Record<string,string>)[value]??'未知状态';}
function nullable(value:FormDataEntryValue|null){const text=String(value??'').trim();return text?text:null;}
function money(value:string|null){return value===null?'—':new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(Number(value)/100);}
