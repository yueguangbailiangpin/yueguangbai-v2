import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { isFrontendApiError } from '../../api/errors';
import {
  Alert,
  Button,
  Card,
  FormField,
  RequestIdDisplay,
  TextInput,
} from '../../ui/primitives';
import {
  BuyerRegistrationController,
  disconnectedHumanVerificationProvider,
  type HumanVerificationProvider,
  type BuyerInvitationContext,
} from './registration';

const formSchema = z.object({
  wechat_id: z.string().trim().min(1).max(80),
  password: z.string().min(12).max(128),
  password_confirmation: z.string().min(12).max(128),
}).refine((value) => value.password === value.password_confirmation, {
  path: ['password_confirmation'],
});

export function BuyerRegistrationPage({
  humanVerificationProvider = disconnectedHumanVerificationProvider,
}: {
  humanVerificationProvider?: HumanVerificationProvider;
}): React.JSX.Element {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const invitationToken = searchParams.get('token') ?? '';
  const controller = useRef<BuyerRegistrationController | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<BuyerInvitationContext | null>(null);
  controller.current ??= new BuyerRegistrationController(
    client,
    humanVerificationProvider,
  );

  useEffect(() => {
    const current = new AbortController();
    abort.current = current;
    if (!invitationToken) {
      setMessage('注册链接无效，请联系工作人员重新获取。');
      return () => current.abort();
    }
    void controller.current!.readInvitation(invitationToken, current.signal)
      .then(setInvitation)
      .catch((error: unknown) => {
        if (!(isFrontendApiError(error) && error.code === 'CANCELED')) {
          setMessage('注册链接无效或已失效，请联系工作人员重新获取。');
        }
      });
    return () => current.abort();
  }, [invitationToken]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const parsed = formSchema.safeParse({
      wechat_id: values.get('wechat_id'),
      password: values.get('password'),
      password_confirmation: values.get('password_confirmation'),
    });
    if (!parsed.success) {
      setMessage('请检查微信号、密码和确认密码。密码至少为 12 位。');
      return;
    }
    setBusy(true);
    setMessage(null);
    setRequestId(null);
    const current = new AbortController();
    abort.current = current;
    try {
      if (!invitation) throw new Error('invitation_unavailable');
      const result = await controller.current!.register({
        ...parsed.data,
        invitation_token: invitationToken,
        marketplace_code: invitation.marketplace_code,
      }, current.signal);
      if (result.kind === 'AUTHENTICATED') {
        navigate('/buyer', { replace: true });
      } else if (result.kind === 'MISMATCH_CLEANED') {
        setMessage('注册后的会话身份不匹配，已安全退出。');
      } else {
        setMessage('会话身份不匹配且清理未完成，请刷新后重试。');
        setRequestId(result.requestId);
      }
    } catch (error: unknown) {
      if (isFrontendApiError(error) && error.code === 'CANCELED') return;
      setRequestId(isFrontendApiError(error) ? error.requestId : null);
      setMessage(registrationErrorMessage(error));
    } finally {
      setBusy(false);
      if (abort.current === current) abort.current = null;
    }
  }

  return <main className="login-page identity-buyer buyer-registration-page">
    <Card className="login-card">
      <div className="login-brand"><span className="brand-mark" aria-hidden="true">月</span>
        <strong>月光白</strong></div>
      <div className="login-heading"><p className="eyebrow">买家服务</p>
        <h1>买家邀请注册</h1><p>仅限工作人员发送的专属一次性邀请。</p></div>
      {invitation ? <Alert tone="info">
        站点：{invitation.marketplace_name}；邀请微信：{invitation.wechat_hint}
      </Alert> : null}
      <form onSubmit={(event) => { void submit(event); }}>
        <FormField label="微信号" htmlFor="buyer-register-wechat" required>
          <TextInput name="wechat_id" autoComplete="username" required />
        </FormField>
        <FormField label="密码" htmlFor="buyer-register-password" description="至少 12 位" required>
          <TextInput name="password" type="password" autoComplete="new-password" minLength={12} required />
        </FormField>
        <FormField label="确认密码" htmlFor="buyer-register-confirm" required>
          <TextInput name="password_confirmation" type="password" autoComplete="new-password" minLength={12} required />
        </FormField>
        {message ? <Alert tone="danger">{message}</Alert> : null}
        <RequestIdDisplay requestId={requestId} />
        <Button type="submit" disabled={!invitation} loading={busy} loadingLabel="正在创建账号">注册并进入买家工作区</Button>
      </form>
      <Button className="secondary" onClick={() => navigate('/buyer/login')}>返回登录</Button>
    </Card>
  </main>;
}

function registrationErrorMessage(error: unknown): string {
  if (!isFrontendApiError(error)) return '注册未完成，请稍后重试。';
  if (error.httpStatus === 429) return '操作过于频繁，请按提示稍后再试。';
  if (error.code === 'FEATURE_DISABLED') return '当前暂未开放注册。';
  if (error.code === 'HUMAN_VERIFICATION_FAILED') return '安全验证未通过，请稍后重试。';
  if (error.httpStatus === 503) return '注册服务暂时不可用。';
  return '注册未完成，请检查信息后重试。';
}
