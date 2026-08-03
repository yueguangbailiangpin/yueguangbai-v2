import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { isFrontendApiError } from '../../api/errors';
import { safeReturnPath } from '../../routes/return-path';
import { Button, Card, RequestIdDisplay, TextInput } from '../../ui/primitives';
import { CustomerAuthController, type CustomerLoginResult } from './customer-auth-controller';
import { customerAuthApi, type CustomerAuthApiAdapter, type CustomerTarget } from './customer-auth-api';

const loginSchema = z.object({
  login_identifier: z.string().min(1),
  password: z.string().min(1),
});

export function CustomerLoginPage({
  target,
  adapter = customerAuthApi,
}: {
  target: CustomerTarget;
  adapter?: CustomerAuthApiAdapter;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const client = useQueryClient();
  const controllerRef = useRef<CustomerAuthController | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const [message, setMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cleanupFailed, setCleanupFailed] = useState(false);
  controllerRef.current ??= new CustomerAuthController(client, adapter);
  const returnTo = safeReturnPath(
    new URLSearchParams(location.search).get('return_to'),
    target,
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  function applyResult(result: CustomerLoginResult): void {
    if (!mountedRef.current) return;
    if (result.kind === 'AUTHENTICATED') {
      navigate(returnTo, { replace: true });
      return;
    }
    if (result.kind === 'PASSWORD_CHANGE_REQUIRED') {
      navigate(`/${target}/change-password`, { replace: true });
      return;
    }
    if (result.kind === 'MISMATCH_CLEANED') {
      setCleanupFailed(false);
      setRequestId(null);
      setMessage('该账号不适用于此登录入口，请确认账号或联系工作人员。');
      return;
    }
    setCleanupFailed(true);
    setRequestId(result.requestId);
    setMessage('会话清理失败，请重试或刷新');
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage(null);
    setRequestId(null);
    setCleanupFailed(false);
    const data = new FormData(event.currentTarget);
    const payload = loginSchema.safeParse({
      login_identifier: data.get('login_identifier'),
      password: data.get('password'),
    });
    if (!payload.success) {
      setMessage('请输入登录标识和密码。');
      return;
    }

    setBusy(true);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      applyResult(await controllerRef.current!.login(target, payload.data, abort.signal));
    } catch (error: unknown) {
      if (mountedRef.current && !(isFrontendApiError(error) && error.code === 'CANCELED')) {
        setRequestId(isFrontendApiError(error) ? error.requestId : null);
        setMessage(
          isFrontendApiError(error) && error.code === 'PASSWORD_CHANGE_REQUIRED'
            ? '需要先修改密码。'
            : '登录未完成，请检查信息后重试。',
        );
      }
    } finally {
      if (mountedRef.current) setBusy(false);
      if (abortRef.current === abort) abortRef.current = null;
    }
  }

  async function retryCleanup(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      applyResult(await controllerRef.current!.retryMismatchCleanup());
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  const label = target === 'buyer' ? '买家登录' : '卖家登录';
  return (
    <main className="login-page">
      <Card>
        <h1>{label}</h1>
        <p>使用您的账户凭据继续。</p>
        <form onSubmit={(event) => { void submit(event); }}>
          <label>登录标识<TextInput name="login_identifier" autoComplete="username" required /></label>
          <label>密码<TextInput name="password" type="password" autoComplete="current-password" required /></label>
          {message && <p className="inline-error" role="alert">{message}</p>}
          <RequestIdDisplay requestId={requestId} />
          {cleanupFailed && (
            <Button type="button" className="secondary" disabled={busy} onClick={() => { void retryCleanup(); }}>
              {busy ? '正在重新清理' : '重新清理'}
            </Button>
          )}
          <Button type="submit" disabled={busy || cleanupFailed}>{busy ? '正在登录' : '登录'}</Button>
        </form>
      </Card>
    </main>
  );
}
