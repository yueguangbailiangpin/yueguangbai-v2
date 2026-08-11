import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { Alert, Button, Card, FormField, TextInput } from '../../ui/primitives';

const invitationEnvelope=z.object({data:z.object({invitation:z.object({
  invitation_valid:z.literal(true),seller_name:z.string(),marketplace_code:z.string(),wechat_hint:z.string(),
  onboarding_kind:z.enum(['NEW_CUSTOMER','HISTORICAL_ACCOUNT_ONLY']),existing_moonwhite_account:z.boolean(),expires_at:z.number().int(),
}).strict()}).strict()}).passthrough();
const registerEnvelope=z.object({data:z.object({session_established:z.literal(true),next_path:z.string(),seller_organization_id:z.string(),onboarding_kind:z.enum(['NEW_CUSTOMER','HISTORICAL_ACCOUNT_ONLY'])}).strict()}).passthrough();
const formSchema=z.object({wechat_id:z.string().trim().min(1).max(128),password:z.string().min(12).max(128),password_confirmation:z.string().min(12).max(128)}).refine((value)=>value.password===value.password_confirmation,{path:['password_confirmation']});
type Invitation=z.output<typeof invitationEnvelope>['data']['invitation'];

export function SellerRegistrationPage():React.JSX.Element{
  const navigate=useNavigate();const [parameters]=useSearchParams();const token=parameters.get('token')??'';
  const [invitation,setInvitation]=useState<Invitation|null>(null);const [busy,setBusy]=useState(false);const [message,setMessage]=useState<string|null>(null);
  useEffect(()=>{const controller=new AbortController();if(!token){setMessage('注册链接无效，请联系工作人员重新获取。');return()=>controller.abort();}
    void fetch(`/api/seller-auth/invitations/${encodeURIComponent(token)}`,{credentials:'same-origin',signal:controller.signal,headers:{Accept:'application/json'}})
      .then(async(response)=>{if(!response.ok)throw new Error('invalid');return invitationEnvelope.parse(await response.json()).data.invitation;})
      .then(setInvitation).catch((error)=>{if(!(error instanceof DOMException&&error.name==='AbortError'))setMessage('注册链接无效或已失效，请联系工作人员重新获取。');});
    return()=>controller.abort();},[token]);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);const parsed=formSchema.safeParse({wechat_id:data.get('wechat_id'),password:data.get('password'),password_confirmation:data.get('password_confirmation')});
    if(!parsed.success){setMessage(invitation?.existing_moonwhite_account?'请输入当前月光白账号密码，并再次确认。':'请检查微信号和密码。密码至少为 12 位，两次输入必须一致。');return;}
    setBusy(true);setMessage(null);try{const response=await fetch('/api/seller-auth/register',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Idempotency-Key':`seller-register:${crypto.randomUUID()}`,'X-Requested-With':'XMLHttpRequest'},body:JSON.stringify({invitation_token:token,...parsed.data})});
      if(!response.ok)throw new Error('register_failed');const result=registerEnvelope.parse(await response.json()).data;if(result.session_established)navigate(result.next_path,{replace:true});
    }catch{setMessage(invitation?.existing_moonwhite_account?'卖家身份开通未完成。请确认输入的是现有月光白账号密码。':'账号开通未完成。请确认微信号与工作人员登记的一致，或联系工作人员重新生成链接。');}finally{setBusy(false);}}
  const existing=invitation?.existing_moonwhite_account===true;
  return <main className="login-page identity-seller seller-registration-page"><Card className="login-card seller-login-card seller-registration-card">
    <div className="login-brand"><strong>月光白</strong></div><div className="login-heading"><h1>卖家账号开通</h1><p>仅限工作人员发送的专属一次性链接。</p></div>
    {invitation?<Alert tone="info"><strong>{invitation.seller_name}</strong><br/>邀请微信：{invitation.wechat_hint}<br/>{invitation.onboarding_kind==='HISTORICAL_ACCOUNT_ONLY'?'历史卖家：原店铺、产品和订单保持不变。':'新卖家：完成后进入卖家专业控制台。'}<br/>{existing?'检测到该微信已有月光白账号：请输入现有账号密码确认，系统只增加卖家身份，不创建第二个账号。':'该微信尚无月光白账号：请设置登录密码。'}</Alert>:null}
    <form onSubmit={(event)=>{void submit(event);}}><FormField label="微信号" htmlFor="seller-register-wechat" required><TextInput id="seller-register-wechat" name="wechat_id" autoComplete="username" required/></FormField>
      <FormField label={existing?'现有月光白密码':'设置密码'} htmlFor="seller-register-password" description={existing?'用于确认这是同一个月光白账号':'至少 12 位'} required><TextInput id="seller-register-password" name="password" type="password" autoComplete={existing?'current-password':'new-password'} minLength={12} required/></FormField>
      <FormField label={existing?'再次输入现有密码':'确认密码'} htmlFor="seller-register-confirm" required><TextInput id="seller-register-confirm" name="password_confirmation" type="password" autoComplete={existing?'current-password':'new-password'} minLength={12} required/></FormField>
      {message?<Alert tone="danger">{message}</Alert>:null}<Button type="submit" disabled={!invitation} loading={busy} loadingLabel="正在开通">{existing?'确认并开通卖家身份':'完成开通'}</Button></form>
    <Button className="secondary" onClick={()=>navigate('/seller/login')}>返回登录</Button>
  </Card></main>;
}
