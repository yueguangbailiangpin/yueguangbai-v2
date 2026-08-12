import { useEffect,useState,type FormEvent } from 'react';
import { useNavigate,useSearchParams } from 'react-router';
import { z } from 'zod';
import { Alert,Button,Card,FormField,TextInput } from '../../ui/primitives';

const invitationEnvelope=z.object({data:z.object({invitation:z.object({
  invitation_valid:z.literal(true),organization_name:z.string(),wechat_hint:z.string(),display_name:z.string(),
  role:z.enum(['OPERATIONS','FINANCE','VIEWER']),expires_at:z.number().int(),existing_moonwhite_account:z.boolean(),
}).strict()}).strict()}).passthrough();
const registerEnvelope=z.object({data:z.object({session_established:z.literal(true),next_path:z.string(),seller_organization_id:z.string(),seller_member_id:z.string()}).strict()}).passthrough();
const formSchema=z.object({wechat_id:z.string().trim().min(1).max(128),password:z.string().min(12).max(128),password_confirmation:z.string().min(12).max(128)}).refine((value)=>value.password===value.password_confirmation,{path:['password_confirmation']});
type Invitation=z.output<typeof invitationEnvelope>['data']['invitation'];
const roleLabel={OPERATIONS:'运营成员',FINANCE:'财务成员',VIEWER:'查看成员'} as const;

export function SellerMemberRegistrationPage():React.JSX.Element{
  const navigate=useNavigate();const [parameters]=useSearchParams();const token=parameters.get('token')??'';
  const [invitation,setInvitation]=useState<Invitation|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null);
  useEffect(()=>{const controller=new AbortController();if(!token){setMessage('成员邀请链接无效，请联系卖家主账号重新邀请。');return()=>controller.abort();}
    void fetch(`/api/seller-auth/member-invitations/${encodeURIComponent(token)}`,{credentials:'same-origin',signal:controller.signal,headers:{Accept:'application/json'}})
      .then(async(response)=>{if(!response.ok)throw new Error('invalid');return invitationEnvelope.parse(await response.json()).data.invitation;})
      .then(setInvitation).catch((error)=>{if(!(error instanceof DOMException&&error.name==='AbortError'))setMessage('成员邀请链接无效或已失效，请联系卖家主账号重新邀请。');});
    return()=>controller.abort();},[token]);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);const parsed=formSchema.safeParse({wechat_id:data.get('wechat_id'),password:data.get('password'),password_confirmation:data.get('password_confirmation')});
    if(!parsed.success){setMessage(invitation?.existing_moonwhite_account?'请输入现有月光白账号密码并再次确认。':'请检查微信号和密码；密码至少 12 位且两次一致。');return;}
    setBusy(true);setMessage(null);try{const response=await fetch('/api/seller-auth/member-register',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Idempotency-Key':`seller-member:${crypto.randomUUID()}`,'X-Requested-With':'XMLHttpRequest'},body:JSON.stringify({invitation_token:token,...parsed.data})});if(!response.ok)throw new Error('failed');const result=registerEnvelope.parse(await response.json()).data;navigate(result.next_path,{replace:true});}
    catch{setMessage(invitation?.existing_moonwhite_account?'成员开通失败。请确认输入的是该微信现有月光白密码。':'成员开通失败。请确认微信与邀请一致，或让主账号重新邀请。');}finally{setBusy(false);}}
  const existing=invitation?.existing_moonwhite_account===true;
  return <main className="login-page identity-seller"><Card className="login-card seller-login-card">
    <div className="login-brand"><strong>月光白</strong></div><div className="login-heading"><h1>加入卖家团队</h1><p>仅限卖家主账号发送的专属邀请，一次性有效。</p></div>
    {invitation?<Alert tone="info"><strong>{invitation.organization_name}</strong><br/>成员：{invitation.display_name} · {roleLabel[invitation.role]}<br/>邀请微信：{invitation.wechat_hint}<br/>{existing?'该微信已有月光白账号：使用原密码确认后增加卖家成员身份。':'该微信尚无月光白账号：请设置新密码。'}</Alert>:null}
    <form onSubmit={(event)=>{void submit(event);}}><FormField label="微信号" htmlFor="seller-member-wechat" required><TextInput id="seller-member-wechat" name="wechat_id" autoComplete="username" required/></FormField>
      <FormField label={existing?'现有月光白密码':'设置密码'} htmlFor="seller-member-password" description={existing?'用于确认现有账号归属':'至少 12 位'} required><TextInput id="seller-member-password" name="password" type="password" autoComplete={existing?'current-password':'new-password'} minLength={12} required/></FormField>
      <FormField label={existing?'再次输入现有密码':'确认密码'} htmlFor="seller-member-confirm" required><TextInput id="seller-member-confirm" name="password_confirmation" type="password" autoComplete={existing?'current-password':'new-password'} minLength={12} required/></FormField>
      {message?<Alert tone="danger">{message}</Alert>:null}<Button type="submit" disabled={!invitation} loading={busy}>完成加入</Button></form>
    <Button className="secondary" onClick={()=>navigate('/seller/login')}>返回登录</Button>
  </Card></main>;
}
