import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import {
  Alert, Button, Card, DataTable, EmptyState, FormField, MetricCard,
  Select, StatusBadge, TextInput,
} from '../../ui/primitives';
import { acquisitionApi, type AcquisitionChannelStat, type SourceCorrectionCandidate } from './api';
import type { AcquisitionInternalChannel, AcquisitionProspect } from './runtime';

const MARKETPLACES=[
  ['AMAZON_JP','亚马逊日本站'],['AMAZON_US','亚马逊美国站'],['COUPANG_KR','Coupang 韩国站'],
  ['RAKUTEN_JP','乐天日本站'],['TIKTOK_JP','TikTok 日本站'],
] as const;
type Tab='overview'|'prospects'|'daily'|'channels'|'stats'|'corrections'|'codex';

export function AcquisitionCoreWorkbenchV3():React.JSX.Element{
  const session=useCurrentStaffSession();const client=useQueryClient();
  const owner=session.role.code==='owner',operator=owner||session.role.code==='acquisition';
  const [tab,setTab]=useState<Tab>('overview');const range=useMemo(currentMonthRange,[]);
  const channels=useQuery({queryKey:['staff','acquisition-core','channels',session.authorization_version],queryFn:({signal})=>acquisitionApi.channels(client,signal).then((r)=>r.data.channels.filter((channel):channel is AcquisitionInternalChannel=>channel.visibility==='INTERNAL')),enabled:operator,retry:false});
  const [prospects,consultations,funnel,stats,corrections]=useQueries({queries:[
    {queryKey:['staff','acquisition-core','prospects',session.authorization_version],queryFn:({signal})=>acquisitionApi.prospects(client,{leadType:null,status:null,cursor:null},signal).then((r)=>r.data),enabled:operator,retry:false},
    {queryKey:['staff','acquisition-core','consultations',range.from,range.to,session.authorization_version],queryFn:({signal})=>acquisitionApi.consultations(client,range.from,range.to,signal).then((r)=>r.data.consultations),enabled:operator,retry:false},
    {queryKey:['staff','acquisition-core','funnel',range.from,range.to,session.authorization_version],queryFn:({signal})=>acquisitionApi.funnel(client,range.from,range.to,signal).then((r)=>r.data.funnel),enabled:operator,retry:false},
    {queryKey:['staff','acquisition-core','channel-stats',range.from,range.to,session.authorization_version],queryFn:({signal})=>acquisitionApi.channelStats(client,range.from,range.to,signal).then((r)=>r.data.channels),enabled:operator,retry:false},
    {queryKey:['staff','acquisition-core','source-corrections',session.authorization_version],queryFn:({signal})=>acquisitionApi.sourceCorrectionCandidates(client,signal).then((r)=>r.data.items),enabled:operator,retry:false},
  ]});
  if(!operator)return <main className="acquisition-workbench"><Alert tone="danger">当前岗位不使用客户开发中心。</Alert></main>;
  const tabs:readonly (readonly [Tab,string])[]=[['overview','概览'],['prospects','潜在线索'],['daily','每日渠道数据'],['channels','渠道信息'],['stats','渠道统计'],['corrections','来源纠错'],...(owner?[['codex','Codex 自动开发接入'] as const]:[])];
  return <main className="acquisition-workbench acquisition-core">
    <header className="acquisition-core-heading"><div><p className="eyebrow">月光白客户开发中心</p><h2>客户开发中心</h2><p>渠道 → 潜在线索 → 正式客户登记 → 订单 / 利润。真实开发来源仅总管理员和获客岗位可见。</p></div></header>
    <nav className="acquisition-core-tabs" aria-label="客户开发中心导航">{tabs.map(([key,label])=><Button key={key} className={tab===key?'':'secondary'} onClick={()=>setTab(key)}>{label}</Button>)}</nav>
    {[channels,prospects,consultations,funnel,stats,corrections].some((query)=>query.isError)?<Alert tone="warning">部分客户开发数据暂时无法加载；已成功读取的区域仍可使用。</Alert>:null}
    {tab==='overview'?<Overview funnel={funnel.data} prospects={prospects.data?.items??[]} stats={stats.data??[]}/>:null}
    {tab==='prospects'?<Prospects channels={channels.data??[]} items={prospects.data?.items??[]}/>:null}
    {tab==='daily'?<Daily channels={channels.data??[]} items={consultations.data??[]}/>:null}
    {tab==='channels'?<Channels items={channels.data??[]} owner={owner}/>:null}
    {tab==='stats'?<Stats items={stats.data??[]}/>:null}
    {tab==='corrections'?<SourceCorrections channels={channels.data??[]} items={corrections.data??[]}/>:null}
    {tab==='codex'&&owner?<CodexPanel/>:null}
  </main>;
}

function Overview({funnel,prospects,stats}:{funnel:Awaited<ReturnType<typeof acquisitionApi.funnel>>['data']['funnel']|undefined;prospects:readonly AcquisitionProspect[];stats:readonly AcquisitionChannelStat[]}){
  const buyer=prospects.filter((p)=>p.lead_type==='BUYER'&&!['CONVERTED','LOST'].includes(p.status)).length;
  const seller=prospects.filter((p)=>p.lead_type==='SELLER'&&!['CONVERTED','LOST'].includes(p.status)).length;
  const incomplete=stats.filter((item)=>!item.consultation_data_complete).length;
  return <><section className="acquisition-summary">
    <MetricCard label="买家潜在线索" value={buyer} detail="人工开发 + Codex 自动开发"/><MetricCard label="卖家潜在线索" value={seller} detail="人工开发 + Codex 自动开发"/>
    <MetricCard label="本月买家登记" value={funnel?.buyer?.wechat_added_count??'—'} detail="正式买家客户登记"/><MetricCard label="本月卖家登记" value={funnel?.seller?.wechat_added_count??'—'} detail="正式卖家客户登记"/>
  </section>{incomplete>0?<Alert tone="warning">本月有 {incomplete} 个渠道的咨询人数没有完整填写。渠道转化判断必须等咨询数据完整后再看。</Alert>:null}
  <Card className="acquisition-flow-card"><h3>统一客户来源链</h3><ol className="acquisition-flow"><li><strong>1. 渠道</strong><span>真实平台、真实渠道、接待微信</span></li><li><strong>2. 潜在线索</strong><span>未加微信的潜客；直接加微信可跳过</span></li><li><strong>3. 客户登记</strong><span>成功保存即形成不可变新增客户事实</span></li><li><strong>4. 业务主体</strong><span>买家/卖家进入正式业务体系，网站账号独立开通</span></li><li><strong>5. 订单与利润</strong><span>按确认后的来源归因；原始来源和纠错历史都保留</span></li></ol></Card></>;
}

function Prospects({channels,items}:{channels:readonly AcquisitionInternalChannel[];items:readonly AcquisitionProspect[]}){
  const client=useQueryClient();const [show,setShow]=useState(false);
  const create=useMutation({mutationFn:(body:unknown)=>acquisitionApi.createProspect(client,body,crypto.randomUUID()),onSuccess:()=>client.invalidateQueries({queryKey:['staff','acquisition-core']})});
  const handoff=useMutation({mutationFn:({id,body}:{id:string;body:unknown})=>acquisitionApi.updateProspect(client,id,body,crypto.randomUUID()),onSuccess:()=>client.invalidateQueries({queryKey:['staff','acquisition-core']})});
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget,data=new FormData(form);create.mutate({lead_type:String(data.get('lead_type')),marketplace_code:String(data.get('marketplace_code')),channel_id:String(data.get('channel_id')),display_name:String(data.get('display_name')),contact_value:nullable(data.get('contact_value')),source_url:nullable(data.get('source_url')),origin_mode:'HUMAN',note:nullable(data.get('note')),ai_score:null},{onSuccess:()=>{form.reset();setShow(false);}});}
  return <section className="acquisition-prospects"><div className="staff-section-toolbar"><div><h3>潜在线索</h3><p>尚未进入正式客户登记的人或公司。</p></div><Button onClick={()=>setShow((value)=>!value)}>{show?'取消':'新增潜在线索'}</Button></div>
    {show?<Card className="acquisition-inline-form"><form onSubmit={submit}><FormField label="客户类型" htmlFor="prospect-type"><Select id="prospect-type" name="lead_type"><option value="SELLER">卖家</option><option value="BUYER">买家</option></Select></FormField><FormField label="站点" htmlFor="prospect-market"><Select id="prospect-market" name="marketplace_code">{MARKETPLACES.map(([code,label])=><option key={code} value={code}>{label}</option>)}</Select></FormField><FormField label="真实来源渠道" htmlFor="prospect-channel"><Select id="prospect-channel" name="channel_id" required><option value="">请选择</option>{channels.filter((c)=>c.status==='ACTIVE').map((c)=><option key={c.channel_id} value={c.channel_id}>{c.display_name}（员工：{c.staff_label}）</option>)}</Select></FormField><FormField label="客户 / 公司名称" htmlFor="prospect-name"><TextInput id="prospect-name" name="display_name" required/></FormField><FormField label="联系方式（可空）" htmlFor="prospect-contact"><TextInput id="prospect-contact" name="contact_value"/></FormField><FormField label="来源链接（可空）" htmlFor="prospect-url"><TextInput id="prospect-url" name="source_url"/></FormField><FormField label="发现信号 / 备注" htmlFor="prospect-note"><TextInput id="prospect-note" name="note"/></FormField><Button loading={create.isPending}>保存潜在线索</Button></form></Card>:null}
    {items.length===0?<EmptyState title="暂无潜在线索" description="人工或 Codex 找到的潜客会出现在这里。"/>:<DataTable caption="潜在线索列表"><thead><tr><th>潜在线索</th><th>类型</th><th>站点</th><th>真实来源</th><th>开发方式</th><th>评分</th><th>状态</th><th>交接</th></tr></thead><tbody>{items.map((p)=><tr key={p.prospect_id}><td><strong>{p.display_name}</strong><small>{p.note??'—'}</small></td><td>{p.lead_type==='BUYER'?'买家':'卖家'}</td><td>{marketLabel(p.marketplace_code)}</td><td>{p.origin_channel_name}</td><td>{p.origin_mode==='CODEX'?'Codex 自动开发':'人工开发'}</td><td>{p.ai_score??'—'}</td><td>{prospectStatus(p.status)}</td><td>{!['HUMAN_HANDOFF','CONVERTED','LOST'].includes(p.status)?<Button className="secondary" loading={handoff.isPending} onClick={()=>handoff.mutate({id:p.prospect_id,body:{expected_version:p.version,status:'HUMAN_HANDOFF',ai_score:p.ai_score,note:p.note}})}>交给业务员工</Button>:p.status==='HUMAN_HANDOFF'?<StatusBadge tone="processing">等待接入</StatusBadge>:'—'}</td></tr>)}</tbody></DataTable>}
  </section>;
}

function Daily({channels,items}:{channels:readonly AcquisitionInternalChannel[];items:readonly {consultation_id:string;channel_id:string;business_date:string;person_count:number;version:number}[]}){
  const client=useQueryClient();const today=shanghaiDate(Date.now());const active=channels.filter((channel)=>channel.status==='ACTIVE'&&channel.lead_type!=='BOTH');
  const missing=active.filter((channel)=>!items.some((item)=>item.channel_id===channel.channel_id&&item.business_date===today));
  const mutation=useMutation({mutationFn:(body:unknown)=>acquisitionApi.recordConsultation(client,body,crypto.randomUUID()),onSuccess:()=>client.invalidateQueries({queryKey:['staff','acquisition-core']})});
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);const channelId=String(data.get('channel_id'));const existing=items.find((item)=>item.channel_id===channelId&&item.business_date===today);mutation.mutate({channel_id:channelId,business_date:today,person_count:Number(data.get('person_count')),expected_version:existing?.version??0,reason:existing?'更正当日咨询人数':'记录当日咨询人数'});}
  return <div className="acquisition-daily-grid"><Card><h3>今天的渠道数据</h3>{missing.length>0?<Alert tone="warning">还有 {missing.length} 个渠道今天没有填写。未填写不会当成 0。</Alert>:<Alert tone="success">今天所有可填写渠道都已记录。</Alert>}<div className="compact-list">{active.map((channel)=>{const current=items.find((item)=>item.channel_id===channel.channel_id&&item.business_date===today);return <div className="compact-row" key={channel.channel_id}><span><strong>{channel.display_name}</strong><small>{channel.staff_label} · {audienceLabel(channel.lead_type)} · {marketLabel(channel.marketplace_code)}</small></span>{current?<b>{current.person_count}</b>:<StatusBadge tone="conflict">未填</StatusBadge>}</div>;})}</div></Card>
    <Card><h3>填写 / 更正今天数据</h3><p>填写 0 表示今天确认没有咨询；完全没填则显示“未填”。</p><form onSubmit={submit}><FormField label="真实渠道" htmlFor="daily-channel"><Select id="daily-channel" name="channel_id" required><option value="">请选择</option>{active.map((channel)=><option key={channel.channel_id} value={channel.channel_id}>{channel.display_name}（{channel.staff_label}）</option>)}</Select></FormField><FormField label="咨询人数" htmlFor="daily-count"><TextInput id="daily-count" name="person_count" type="number" min="0" required/></FormField><Button loading={mutation.isPending}>保存</Button></form></Card></div>;
}

function Channels({items,owner}:{items:readonly AcquisitionInternalChannel[];owner:boolean}){
  const client=useQueryClient();const [show,setShow]=useState(false);const [editing,setEditing]=useState<AcquisitionInternalChannel|null>(null);
  const create=useMutation({mutationFn:(body:unknown)=>acquisitionApi.createChannel(client,body,crypto.randomUUID()),onSuccess:()=>client.invalidateQueries({queryKey:['staff','acquisition-core']})});
  const privacy=useMutation({mutationFn:({id,body}:{id:string;body:unknown})=>acquisitionApi.updateChannelPrivacy(client,id,body,crypto.randomUUID()),onSuccess:async()=>{setEditing(null);await client.invalidateQueries({queryKey:['staff','acquisition-core']});}});
  const disable=useMutation({mutationFn:(channel:AcquisitionInternalChannel)=>acquisitionApi.disableChannel(client,channel.channel_id,{expected_version:channel.version,reason:'总管理员停用该渠道；历史经营事实继续保留'},crypto.randomUUID()),onSuccess:()=>client.invalidateQueries({queryKey:['staff','acquisition-core']})});
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget,data=new FormData(form);create.mutate({code:`CHANNEL_${Date.now()}`,platform_name:String(data.get('platform_name')),lead_type:String(data.get('lead_type')),marketplace_code:String(data.get('marketplace_code')),display_name:String(data.get('display_name'))},{onSuccess:()=>{form.reset();setShow(false);}});}
  function savePrivacy(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!editing)return;const data=new FormData(event.currentTarget);privacy.mutate({id:editing.channel_id,body:{expected_version:editing.profile_version,staff_label:String(data.get('staff_label')),intake_wechat_label:String(data.get('intake_wechat_label'))}});}
  return <section><div className="staff-section-toolbar"><div><h3>渠道信息</h3><p>停用渠道只停止未来接入，不会删除历史新增客户、订单或利润。</p></div>{owner?<Button onClick={()=>setShow((v)=>!v)}>{show?'取消':'新增真实渠道'}</Button>:null}</div>
    {show&&owner?<Card className="acquisition-inline-form"><form onSubmit={submit}><FormField label="真实平台" htmlFor="channel-platform"><TextInput id="channel-platform" name="platform_name" required/></FormField><FormField label="真实渠道名称" htmlFor="channel-name"><TextInput id="channel-name" name="display_name" required/></FormField><FormField label="客户类型" htmlFor="channel-type"><Select id="channel-type" name="lead_type"><option value="BUYER">买家</option><option value="SELLER">卖家</option></Select></FormField><FormField label="站点" htmlFor="channel-market"><Select id="channel-market" name="marketplace_code">{MARKETPLACES.map(([code,label])=><option key={code} value={code}>{label}</option>)}</Select></FormField><Button loading={create.isPending}>创建渠道</Button></form></Card>:null}
    {editing?<Card className="acquisition-inline-form"><h4>配置员工匿名渠道</h4><form onSubmit={savePrivacy}><FormField label="员工看到的渠道编号" htmlFor="privacy-label"><TextInput id="privacy-label" name="staff_label" defaultValue={editing.staff_label} placeholder="渠道1" required/></FormField><FormField label="对应接待微信" htmlFor="privacy-wechat"><TextInput id="privacy-wechat" name="intake_wechat_label" defaultValue={editing.intake_wechat_label??''} required/></FormField><Button loading={privacy.isPending}>保存配置</Button><Button type="button" className="secondary" onClick={()=>setEditing(null)}>取消</Button></form></Card>:null}
    {items.length===0?<EmptyState title="暂无渠道" description="总管理员创建渠道后会出现在这里。"/>:<DataTable caption="真实获客渠道"><thead><tr><th>真实渠道</th><th>员工编号</th><th>接待微信</th><th>类型</th><th>站点</th><th>状态</th>{owner?<th>操作</th>:null}</tr></thead><tbody>{items.map((channel)=><tr key={channel.channel_id}><td><strong>{channel.display_name}</strong><small>{channel.platform_name}</small></td><td>{channel.staff_label}</td><td>{channel.intake_wechat_label??'未配置'}</td><td>{audienceLabel(channel.lead_type)}</td><td>{marketLabel(channel.marketplace_code)}</td><td><StatusBadge tone={channel.status==='ACTIVE'?'success':'neutral'}>{channel.status==='ACTIVE'?'启用':'已停用'}</StatusBadge></td>{owner?<td><Button className="secondary" onClick={()=>setEditing(channel)}>配置</Button>{channel.status==='ACTIVE'?<Button className="danger" loading={disable.isPending} onClick={()=>disable.mutate(channel)}>停用</Button>:null}</td>:null}</tr>)}</tbody></DataTable>}
  </section>;
}

function Stats({items}:{items:readonly AcquisitionChannelStat[]}){
  if(items.length===0)return <EmptyState title="暂无渠道统计" description="产生渠道数据后会自动汇总。"/>;
  return <section><Alert tone="info">买家来源利润和卖家来源利润是同一批订单的两个获客贡献视角，不能相加当作公司总利润。公司总利润只看经营看板财务事实。</Alert><DataTable caption="渠道转化与双视角经营统计"><thead><tr><th>真实渠道</th><th>类型</th><th>咨询数据</th><th>潜在线索</th><th>正式客户</th><th>买家订单</th><th>卖家订单</th><th>买家来源预计利润</th><th>卖家来源预计利润</th></tr></thead><tbody>{items.map((item)=><tr key={item.channel_id}><td><strong>{item.channel_name}</strong><small>{item.platform_name} · {marketLabel(item.marketplace_code)} · {item.channel_status==='ACTIVE'?'启用':'已停用（历史）'}</small></td><td>{audienceLabel(item.lead_type)}</td><td>{item.consultation_data_complete?item.consultation_count:<span>未完整填写 {item.consultation_days_recorded}/{item.consultation_days_expected} 天</span>}</td><td>{item.prospect_count}</td><td>{item.lead_count}</td><td>{item.buyer_formal_order_count}</td><td>{item.seller_formal_order_count}</td><td>{money(item.buyer_projected_gross_profit_cny_fen)}</td><td>{money(item.seller_projected_gross_profit_cny_fen)}</td></tr>)}</tbody></DataTable></section>;
}

function SourceCorrections({channels,items}:{channels:readonly AcquisitionInternalChannel[];items:readonly SourceCorrectionCandidate[]}){
  const client=useQueryClient();const [selected,setSelected]=useState<SourceCorrectionCandidate|null>(null);
  const mutation=useMutation({mutationFn:(body:unknown)=>acquisitionApi.correctSource(client,body,crypto.randomUUID()),onSuccess:async()=>{setSelected(null);await client.invalidateQueries({queryKey:['staff','acquisition-core']});}});
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!selected)return;const data=new FormData(event.currentTarget);mutation.mutate({lead_id:selected.lead_id,new_channel_id:String(data.get('new_channel_id')),reason:String(data.get('reason'))});}
  const eligible=selected?channels.filter((channel)=>channel.marketplace_code===selected.marketplace_code&&(channel.lead_type===selected.lead_type||channel.lead_type==='BOTH')):[];
  return <section><div className="staff-section-toolbar"><div><h3>来源纠错</h3><p>原始来源永久保留；纠错只新增一条审计记录，经营统计使用最后一次确认来源。</p></div></div>
    {selected?<Card className="acquisition-inline-form"><h4>{selected.display_name??selected.wechat_masked}</h4><p>原始：{selected.original_channel_name} · 当前：{selected.effective_channel_name}</p><form onSubmit={submit}><FormField label="更正为" htmlFor="correction-channel"><Select id="correction-channel" name="new_channel_id" required><option value="">请选择</option>{eligible.map((channel)=><option key={channel.channel_id} value={channel.channel_id}>{channel.display_name}</option>)}</Select></FormField><FormField label="更正原因" htmlFor="correction-reason"><TextInput id="correction-reason" name="reason" minLength={3} required/></FormField><Button loading={mutation.isPending}>确认更正</Button><Button type="button" className="secondary" onClick={()=>setSelected(null)}>取消</Button></form></Card>:null}
    {items.length===0?<EmptyState title="暂无客户登记" description="正式客户登记后可在这里处理误选渠道。"/>:<DataTable caption="客户来源纠错候选"><thead><tr><th>客户</th><th>类型</th><th>日期</th><th>站点</th><th>原始来源</th><th>当前来源</th><th>更正次数</th><th>操作</th></tr></thead><tbody>{items.map((item)=><tr key={item.lead_id}><td>{item.display_name??item.wechat_masked}</td><td>{item.lead_type==='BUYER'?'买家':'卖家'}</td><td>{item.business_date}</td><td>{marketLabel(item.marketplace_code)}</td><td>{item.original_channel_name}</td><td><strong>{item.effective_channel_name}</strong></td><td>{item.correction_count}</td><td><Button className="secondary" onClick={()=>setSelected(item)}>纠错</Button></td></tr>)}</tbody></DataTable>}
  </section>;
}

function CodexPanel(){return <div className="acquisition-codex-grid"><Card><h3>Codex 自动开发专用入口</h3><p>Codex 通过独立机器接口写入潜在线索、公开信号和评分，不模拟员工点网页。</p><code>/api/acquisition-machine/prospects</code></Card><Card><h3>允许</h3><ul><li>创建潜在线索</li><li>补充公开信息和信号</li><li>更新评分与研究状态</li></ul></Card><Card><h3>禁止</h3><ul><li>订单与财务</li><li>返款</li><li>员工权限</li><li>直接成交客户</li></ul></Card></div>;}
function currentMonthRange(){const now=new Date(Date.now()+8*60*60*1000),year=now.getUTCFullYear(),month=now.getUTCMonth();return{from:`${year}-${String(month+1).padStart(2,'0')}-01`,to:new Date(Date.UTC(year,month+1,0)).toISOString().slice(0,10)};}
function shanghaiDate(epoch:number){return new Date(epoch+8*60*60*1000).toISOString().slice(0,10);}
function nullable(value:FormDataEntryValue|null){const text=String(value??'').trim();return text||null;}
function marketLabel(code:string){return MARKETPLACES.find(([value])=>value===code)?.[1]??code;}
function audienceLabel(value:'BUYER'|'SELLER'|'BOTH'){return value==='BUYER'?'买家':value==='SELLER'?'卖家':'买家 + 卖家';}
function prospectStatus(value:string){return({NEW:'新发现',RESEARCHING:'研究中',QUALIFIED:'已筛选',READY_CONTACT:'可联系',CONTACTED:'已联系',HUMAN_HANDOFF:'等待人工接入',CONVERTED:'已转正式客户',LOST:'已放弃'} as Record<string,string>)[value]??value;}
function money(value:string|null){if(value===null)return'—';return`¥${(Number(value)/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;}
