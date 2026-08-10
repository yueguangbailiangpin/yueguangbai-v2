import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { identityApiRequest } from '../../api/identity-request';
import { operationHeaders } from '../../api/idempotency';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import {
  Alert, Button, Card, DataTable, Dialog, EmptyState, FormField,
  Select, StatusBadge, TextInput,
} from '../../ui/primitives';

const roleSchema=z.discriminatedUnion('code',[
  z.object({code:z.literal('owner'),display_name:z.literal('总管理员')}).strict(),
  z.object({code:z.literal('acquisition'),display_name:z.literal('获客')}).strict(),
  z.object({code:z.literal('pre_sales'),display_name:z.literal('售前')}).strict(),
  z.object({code:z.literal('seller_ops'),display_name:z.literal('卖家对接')}).strict(),
  z.object({code:z.literal('buyer_refund'),display_name:z.literal('买家返款')}).strict(),
]);
const employeeSchema=z.object({
  staff_id:z.string(),display_name:z.string(),email:z.string().nullable(),status:z.enum(['ACTIVE','DISABLED']),version:z.number().int().positive(),
  role:roleSchema,marketplace_codes:z.array(z.string()),last_login_at:z.number().int().nonnegative().nullable(),updated_at:z.number().int().nonnegative(),
}).strict();
const overviewSchema=z.object({employees:z.array(employeeSchema),available_marketplaces:z.array(z.object({code:z.string(),display_name:z.string(),status:z.enum(['ACTIVE','DISABLED'])}).strict())}).strict();
const mutationSchema=z.object({employee:employeeSchema,replayed:z.boolean()}).strict();
type Employee=z.output<typeof employeeSchema>;
type Role=Employee['role']['code'];
const ROLES:readonly [Role,string][]=[['owner','总管理员'],['acquisition','获客'],['pre_sales','售前'],['seller_ops','卖家对接'],['buyer_refund','买家返款']];

export function StaffAccountsWorkspace():React.JSX.Element{
  const session=useCurrentStaffSession();const client=useQueryClient();const authorized=session.role.code==='owner'&&session.permissions.includes('STAFF_MANAGE');
  const [creating,setCreating]=useState(false);const [editing,setEditing]=useState<Employee|null>(null);const [disabling,setDisabling]=useState<Employee|null>(null);
  const query=useQuery({queryKey:['staff','staff-accounts',session.authorization_version],queryFn:({signal})=>identityApiRequest('staff',client,{path:'/api/staff/access-management',method:'GET',schema:overviewSchema,signal}).then((r)=>r.data),enabled:authorized,retry:false});
  const refresh=()=>client.invalidateQueries({queryKey:['staff','staff-accounts']});
  const createMutation=useMutation({mutationFn:(body:unknown)=>write(client,'/api/staff/access-management/employees',body),onSuccess:async()=>{setCreating(false);await refresh();}});
  const updateMutation=useMutation({mutationFn:({id,body}:{id:string;body:unknown})=>write(client,`/api/staff/access-management/employees/${encodeURIComponent(id)}/update`,body),onSuccess:async()=>{setEditing(null);await refresh();}});
  const statusMutation=useMutation({mutationFn:({id,body}:{id:string;body:unknown})=>write(client,`/api/staff/access-management/employees/${encodeURIComponent(id)}/status`,body),onSuccess:async()=>{setDisabling(null);await refresh();}});
  if(!authorized)return <main className="staff-access-management"><Alert tone="danger">仅总管理员可以管理员工账号。</Alert></main>;
  if(query.isPending)return <main className="staff-access-management"><p role="status">正在加载员工</p></main>;
  if(query.isError)return <main className="staff-access-management"><Alert tone="danger">员工列表暂时无法加载。</Alert></main>;
  return <main className="staff-access-management staff-accounts-simple">
    <section className="staff-access-heading"><div><p className="eyebrow">仅总管理员</p><h2>员工管理</h2><p>只管理姓名、邮箱、岗位和负责站点。岗位决定能做什么，站点决定能看什么。</p></div><Button onClick={()=>setCreating(true)}>新增员工</Button></section>
    <Alert tone="info">创建月光白员工后，再到 Cloudflare Access 手动把该邮箱加入允许名单即可。员工数量很少，不做自动同步。</Alert>
    {query.data.employees.length===0?<EmptyState title="暂无员工" description="请先创建总管理员或业务员工。"/>:<DataTable caption="员工账号、岗位与负责站点"><thead><tr><th>员工</th><th>登录邮箱</th><th>岗位</th><th>负责站点</th><th>状态</th><th>最后登录</th><th>操作</th></tr></thead><tbody>{query.data.employees.map((employee)=><tr key={employee.staff_id}><td><strong>{employee.display_name}</strong><small>{employee.staff_id}</small></td><td>{employee.email??'尚未绑定邮箱'}</td><td>{employee.role.display_name}</td><td>{employee.role.code==='owner'?'全部站点':employee.marketplace_codes.map((code)=>marketLabel(query.data.available_marketplaces,code)).join(' · ')||'未配置'}</td><td><StatusBadge tone={employee.status==='ACTIVE'?'success':'neutral'}>{employee.status==='ACTIVE'?'正常':'已停用'}</StatusBadge></td><td>{employee.last_login_at===null?'从未登录':formatTime(employee.last_login_at)}</td><td><div className="entry-actions"><Button className="secondary" disabled={employee.staff_id===session.staff_id} onClick={()=>setEditing(employee)}>管理</Button>{employee.staff_id!==session.staff_id?<Button className={employee.status==='ACTIVE'?'danger':'secondary'} onClick={()=>employee.status==='ACTIVE'?setDisabling(employee):statusMutation.mutate({id:employee.staff_id,body:{status:'ACTIVE',expected_version:employee.version}})}>{employee.status==='ACTIVE'?'停用':'启用'}</Button>:null}</div></td></tr>)}</tbody></DataTable>}
    <AccountDialog title="新增员工" open={creating} marketplaces={query.data.available_marketplaces} busy={createMutation.isPending} onClose={()=>setCreating(false)} onSubmit={(body)=>createMutation.mutate(body)}/>
    <AccountDialog title="管理员工" open={editing!==null} employee={editing??undefined} marketplaces={query.data.available_marketplaces} busy={updateMutation.isPending} onClose={()=>setEditing(null)} onSubmit={(body)=>editing&&updateMutation.mutate({id:editing.staff_id,body:{...body,expected_version:editing.version}})}/>
    <Dialog open={disabling!==null} title="确认停用员工" description={disabling?`停用后，${disabling.display_name} 的现有会话会立即失效，也不能继续进入员工后台。`:''} busy={statusMutation.isPending} onClose={()=>setDisabling(null)}><div className="staff-disable-summary">{disabling?<><p><strong>{disabling.display_name}</strong></p><p>{disabling.email}</p><p>{disabling.role.display_name}</p></>:null}</div><div className="entry-actions"><Button className="secondary" onClick={()=>setDisabling(null)}>取消</Button><Button className="danger" loading={statusMutation.isPending} onClick={()=>disabling&&statusMutation.mutate({id:disabling.staff_id,body:{status:'DISABLED',expected_version:disabling.version}})}>确认停用</Button></div></Dialog>
  </main>;
}

function AccountDialog({title,open,employee,marketplaces,busy,onClose,onSubmit}:{title:string;open:boolean;employee?:Employee;marketplaces:readonly {code:string;display_name:string;status:'ACTIVE'|'DISABLED'}[];busy:boolean;onClose:()=>void;onSubmit:(body:{display_name:string;email:string;role_code:Role;marketplace_codes:string[]})=>void}){
  const [role,setRole]=useState<Role>(employee?.role.code??'pre_sales');
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);onSubmit({display_name:String(data.get('display_name')),email:String(data.get('email')),role_code:role,marketplace_codes:role==='owner'?[]:data.getAll('marketplace_codes').map(String)});}
  return <Dialog open={open} title={title} description="一个员工只选一个岗位；非总管理员至少选择一个负责站点。" busy={busy} onClose={onClose}><form onSubmit={submit} className="staff-account-form"><FormField label="员工姓名" htmlFor={`${title}-name`}><TextInput id={`${title}-name`} name="display_name" defaultValue={employee?.display_name??''} required/></FormField><FormField label="登录邮箱" htmlFor={`${title}-email`} description="可以使用员工自己的个人邮箱"><TextInput id={`${title}-email`} name="email" type="email" defaultValue={employee?.email??''} required/></FormField><FormField label="岗位" htmlFor={`${title}-role`}><Select id={`${title}-role`} name="role_code" value={role} onChange={(event)=>setRole(event.target.value as Role)}>{ROLES.map(([code,label])=><option key={code} value={code}>{label}</option>)}</Select></FormField>{role!=='owner'?<fieldset className="staff-marketplace-options"><legend>负责站点</legend>{marketplaces.filter((market)=>market.status==='ACTIVE').map((market)=><label key={market.code}><input type="checkbox" name="marketplace_codes" value={market.code} defaultChecked={employee?.marketplace_codes.includes(market.code)??market.code==='AMAZON_JP'}/><span>{market.display_name}</span></label>)}</fieldset>:<Alert tone="info">总管理员自动拥有全部 Marketplace，不需要逐个勾选。</Alert>}<div className="entry-actions"><Button type="button" className="secondary" onClick={onClose}>取消</Button><Button type="submit" loading={busy}>保存</Button></div></form></Dialog>;
}

function write(client:ReturnType<typeof useQueryClient>,path:string,body:unknown){return identityApiRequest('staff',client,{path,method:'POST',schema:mutationSchema,body,headers:operationHeaders({key:crypto.randomUUID(),body})});}
function marketLabel(markets:readonly {code:string;display_name:string}[],code:string){return markets.find((market)=>market.code===code)?.display_name??code;}
function formatTime(value:number){return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));}
