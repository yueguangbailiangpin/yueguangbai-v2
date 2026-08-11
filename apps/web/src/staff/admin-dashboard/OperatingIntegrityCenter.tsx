import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { identityApiRequest } from '../../api/identity-request';
import { operationHeaders } from '../../api/idempotency';
import { Alert, Button, Card, DataTable, EmptyState, FormField, StatusBadge, TextInput } from '../../ui/primitives';

const caseItem=z.object({
  id:z.string(),identity_masked:z.string(),customer_type:z.enum(['BUYER','SELLER']),marketplace_code:z.string(),reason_code:z.string(),
  staff_note:z.string().nullable(),status:z.enum(['OPEN','RESOLVED','CANCELLED']),reported_by_staff_id:z.string(),resolved_subject_id:z.string().nullable(),
  resolution_note:z.string().nullable(),resolved_by_staff_id:z.string().nullable(),created_at:z.number().int(),resolved_at:z.number().int().nullable(),
}).strict();
const casesSchema=z.object({cases:z.array(caseItem)}).strict();
const candidate=z.object({customer_type:z.enum(['BUYER','SELLER']),subject_id:z.string(),display_name:z.string(),marketplace_code:z.string(),reference_code:z.string().nullable(),order_count:z.number().int().nonnegative()}).strict();
const candidatesSchema=z.object({items:z.array(candidate)}).strict();
const resolutionSchema=z.object({case:caseItem}).strict();
type CaseItem=z.output<typeof caseItem>;type Candidate=z.output<typeof candidate>;

const MARKET:Record<string,string>={AMAZON_JP:'亚马逊日本站',AMAZON_US:'亚马逊美国站',COUPANG_KR:'Coupang 韩国站',RAKUTEN_JP:'乐天日本站',TIKTOK_JP:'TikTok 日本站'};

export function OperatingIntegrityCenter({anomalies}:{anomalies:{identity_conflicts:number;attribution_anomalies:number;finance_conflicts:number}}){
  const client=useQueryClient();const [selected,setSelected]=useState<CaseItem|null>(null);const [candidates,setCandidates]=useState<readonly Candidate[]>([]);
  const cases=useQuery({queryKey:['staff','operating-integrity','identity-cases'],queryFn:({signal})=>identityApiRequest('staff',client,{path:'/api/staff/customer-identity-resolution/cases',method:'GET',schema:casesSchema,signal}).then((r)=>r.data.cases),retry:false});
  const search=useMutation({mutationFn:({type,query}:{type:'BUYER'|'SELLER';query:string})=>identityApiRequest('staff',client,{path:`/api/staff/customer-identity-resolution/candidates?customer_type=${type}&query=${encodeURIComponent(query)}`,method:'GET',schema:candidatesSchema}),onSuccess:(response)=>setCandidates(response.data.items)});
  const resolve=useMutation({mutationFn:({caseId,subjectId,reason}:{caseId:string;subjectId:string;reason:string})=>{const body={subject_id:subjectId,reason};return identityApiRequest('staff',client,{path:`/api/staff/customer-identity-resolution/cases/${encodeURIComponent(caseId)}/resolve`,method:'POST',schema:resolutionSchema,body,headers:operationHeaders({key:crypto.randomUUID(),body})});},onSuccess:async()=>{setSelected(null);setCandidates([]);await client.invalidateQueries({queryKey:['staff','operating-integrity']});}});
  return <section aria-labelledby="operating-integrity-title"><div className="dashboard-section-heading"><div><h2 id="operating-integrity-title">异常待处理</h2><p>这里只放会阻断业务或污染经营数据的异常，不做复杂任务派工。</p></div></div>
    <div className="dashboard-metric-grid"><IssueMetric label="身份冲突" value={anomalies.identity_conflicts} tone={anomalies.identity_conflicts>0?'danger':'success'}/><IssueMetric label="新系统归因异常" value={anomalies.attribution_anomalies} tone={anomalies.attribution_anomalies>0?'danger':'success'}/><IssueMetric label="财务冲突" value={anomalies.finance_conflicts} tone={anomalies.finance_conflicts>0?'danger':'success'}/></div>
    {cases.isError?<Alert tone="danger">身份冲突列表暂时无法加载。</Alert>:cases.isPending?<p role="status">正在加载身份冲突</p>:cases.data.length===0?<EmptyState title="没有待处理身份冲突" description="出现历史身份无法唯一确认时会显示在这里。"/>:<DataTable caption="待处理客户身份冲突"><thead><tr><th>客户</th><th>类型</th><th>站点</th><th>原因</th><th>提交时间</th><th>操作</th></tr></thead><tbody>{cases.data.map((item)=><tr key={item.id}><td>{item.identity_masked}</td><td>{item.customer_type==='BUYER'?'买家':'卖家'}</td><td>{MARKET[item.marketplace_code]??item.marketplace_code}</td><td>{reasonLabel(item.reason_code)}</td><td>{new Date(item.created_at).toLocaleString('zh-CN')}</td><td><Button className="secondary" onClick={()=>{setSelected(item);setCandidates([]);}}>人工核对</Button></td></tr>)}</tbody></DataTable>}
    {selected?<ResolutionCard item={selected} busy={search.isPending||resolve.isPending} candidates={candidates} onSearch={(query)=>search.mutate({type:selected.customer_type,query})} onResolve={(subjectId,reason)=>resolve.mutate({caseId:selected.id,subjectId,reason})} onClose={()=>{setSelected(null);setCandidates([]);}}/>:null}
  </section>;
}

function ResolutionCard({item,busy,candidates,onSearch,onResolve,onClose}:{item:CaseItem;busy:boolean;candidates:readonly Candidate[];onSearch:(query:string)=>void;onResolve:(subjectId:string,reason:string)=>void;onClose:()=>void}){
  const [reason,setReason]=useState('已人工核对历史业务资料，确认该微信对应此客户主体。');
  function searchSubmit(event:FormEvent<HTMLFormElement>){event.preventDefault();const query=String(new FormData(event.currentTarget).get('query')??'').trim();if(query.length>=2)onSearch(query);}
  return <Card className="dashboard-drill-down"><h3>人工核对身份 · {item.identity_masked}</h3><Alert tone="warning">这里只建立历史身份映射，不修改历史订单、不补获客渠道。确认前请用买家编号、卖家代码、公司名称或店铺名称核对。</Alert><form onSubmit={searchSubmit}><FormField label="搜索历史客户" htmlFor={`identity-query-${item.id}`}><TextInput id={`identity-query-${item.id}`} name="query" minLength={2} required/></FormField><Button className="secondary" loading={busy}>搜索</Button></form>
    {candidates.length>0?<DataTable caption="候选历史客户"><thead><tr><th>客户</th><th>编号</th><th>站点</th><th>历史订单</th><th>确认</th></tr></thead><tbody>{candidates.filter((candidate)=>candidate.marketplace_code===item.marketplace_code).map((candidate)=><tr key={candidate.subject_id}><td>{candidate.display_name}</td><td>{candidate.reference_code??'—'}</td><td>{MARKET[candidate.marketplace_code]??candidate.marketplace_code}</td><td>{candidate.order_count}</td><td><Button disabled={reason.trim().length<3} loading={busy} onClick={()=>onResolve(candidate.subject_id,reason)}>确认绑定</Button></td></tr>)}</tbody></DataTable>:null}
    <FormField label="确认依据" htmlFor={`identity-reason-${item.id}`}><TextInput id={`identity-reason-${item.id}`} value={reason} onChange={(event)=>setReason(event.target.value)}/></FormField><Button className="secondary" onClick={onClose}>关闭</Button></Card>;
}
function IssueMetric({label,value,tone}:{label:string;value:number;tone:'danger'|'success'}){return <Card className="dashboard-metric"><p>{label}</p><strong>{value}</strong><StatusBadge tone={tone}>{value>0?'需要处理':'正常'}</StatusBadge></Card>}
function reasonLabel(value:string){return({AMBIGUOUS_HISTORY:'历史数据匹配多个客户',IDENTITY_CONFLICT:'身份关系冲突',LEGACY_MISSING_IDENTITY:'历史身份资料缺失',STAFF_REPORTED:'员工提交核对'} as Record<string,string>)[value]??value;}
