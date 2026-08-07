import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { apiRequest } from '../../api/transport';
import { isFrontendApiError } from '../../api/errors';
import {
  Alert, Button, Card, FormField, RequestIdDisplay, TextInput,
} from '../../ui/primitives';

const formSchema = z.object({
  new_password: z.string().min(12).max(128),
  password_confirmation: z.string().min(12).max(128),
}).refine((value) => value.new_password === value.password_confirmation);

const responseSchema = z.object({
  password_reset: z.literal(true),
  all_previous_sessions_revoked: z.literal(true),
  next_path: z.literal('/customer/login'),
}).strict();

export function CustomerPasswordResetPage(): React.JSX.Element {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState<string | null>(
    token ? null : '恢复链接无效，请联系工作人员重新获取。',
  );
  const [requestId, setRequestId] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const parsed = formSchema.safeParse({
      new_password: values.get('new_password'),
      password_confirmation: values.get('password_confirmation'),
    });
    if (!parsed.success || !token) {
      setMessage('请确认两次输入一致，且密码至少为 12 位。');
      return;
    }
    setBusy(true);
    setMessage(null);
    setRequestId(null);
    try {
      await apiRequest({
        path: '/api/customer-auth/password-reset/complete',
        method: 'POST',
        schema: responseSchema,
        headers: { 'Idempotency-Key': `customer-reset:${crypto.randomUUID()}` },
        body: { token, ...parsed.data },
      });
      setDone(true);
      setMessage('密码已更新，所有旧登录会话均已失效。');
    } catch (error: unknown) {
      setRequestId(isFrontendApiError(error) ? error.requestId : null);
      setMessage(isFrontendApiError(error) && error.httpStatus === 429
        ? '操作过于频繁，请稍后重试。'
        : '恢复链接无效或已失效，请联系工作人员重新获取。');
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-page identity-buyer">
    <Card className="login-card">
      <div className="login-brand"><span className="brand-mark" aria-hidden="true">月</span>
        <strong>月光白</strong></div>
      <div className="login-heading"><p className="eyebrow">账号安全</p>
        <h1>设置新密码</h1>
        <p>此链接仅可使用一次。成功后旧密码和所有旧会话立即失效。</p></div>
      <form onSubmit={(event) => { void submit(event); }}>
        <FormField label="新密码" htmlFor="customer-reset-password" description="至少 12 位" required>
          <TextInput id="customer-reset-password" name="new_password" type="password"
            autoComplete="new-password" minLength={12} required />
        </FormField>
        <FormField label="确认新密码" htmlFor="customer-reset-confirm" required>
          <TextInput id="customer-reset-confirm" name="password_confirmation" type="password"
            autoComplete="new-password" minLength={12} required />
        </FormField>
        {message ? <Alert tone={done ? 'success' : 'danger'}>{message}</Alert> : null}
        <RequestIdDisplay requestId={requestId} />
        {!done ? <Button type="submit" disabled={!token} loading={busy} loadingLabel="正在更新密码">
          更新密码
        </Button> : null}
      </form>
      <Button className="secondary" onClick={() => navigate('/buyer/login')}>
        返回登录
      </Button>
    </Card>
  </main>;
}
