import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { isFrontendApiError } from '../../api/errors';
import { safeReturnPath } from '../../routes/return-path';
import {
  Alert,
  Button,
  Card,
  FormField,
  RequestIdDisplay,
  Select,
  TextInput,
} from '../../ui/primitives';
import { CustomerAuthController, type CustomerLoginResult } from './customer-auth-controller';
import { customerAuthApi, type CustomerAuthApiAdapter, type CustomerTarget } from './customer-auth-api';

const loginSchema = z.object({
  login_identifier: z.string().min(1),
  password: z.string().min(1),
  persona: z.enum(['buyer', 'seller']),
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

  function applyResult(result: CustomerLoginResult, selectedTarget = target): void {
    if (!mountedRef.current) return;
    if (result.kind === 'AUTHENTICATED') {
      navigate(selectedTarget === target ? returnTo : `/${selectedTarget}`, { replace: true });
      return;
    }
    if (result.kind === 'PASSWORD_CHANGE_REQUIRED') {
      navigate(`/${selectedTarget}/change-password`, { replace: true });
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
      persona: data.get('persona'),
    });
    if (!payload.success) {
      setMessage('请输入登录标识和密码。');
      return;
    }

    setBusy(true);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const selectedTarget = payload.data.persona;
      applyResult(await controllerRef.current!.login(selectedTarget, {
        login_identifier: payload.data.login_identifier,
        password: payload.data.password,
      }, abort.signal), selectedTarget);
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
    <main className={`login-page identity-${target}`}>
      <Card className="login-card">
        <div className="login-brand"><span className="brand-mark" aria-hidden="true">月</span>
          <strong>月光白</strong></div>
        <div className="login-heading"><p className="eyebrow">
          {target === 'buyer' ? '买家服务' : '卖家工作区'}
        </p><h1>{label}</h1>
          <p>{target === 'buyer' ? '安全访问您的买家服务。' : '安全访问您的组织与店铺工作区。'}</p></div>
        <form onSubmit={(event) => { void submit(event); }}>
          <FormField label="账号" htmlFor={`${target}-account`} required>
            <TextInput name="login_identifier" autoComplete="username" required />
          </FormField>
          <FormField label="密码" htmlFor={`${target}-password`} required>
            <TextInput name="password" type="password" autoComplete="current-password" required />
          </FormField>
          <FormField label="进入身份" htmlFor={`${target}-persona`} required>
            <Select name="persona" defaultValue={target}>
              <option value="buyer">买家工作区</option>
              <option value="seller">卖家工作区</option>
            </Select>
          </FormField>
          {message ? <Alert tone="danger">{message}</Alert> : null}
          <RequestIdDisplay requestId={requestId} />
          {cleanupFailed && (
            <Button type="button" className="secondary" disabled={busy} onClick={() => { void retryCleanup(); }}>
              {busy ? '正在重新清理' : '重新清理'}
            </Button>
          )}
          <Button
            type="submit"
            loading={busy}
            loadingLabel="正在登录"
            disabled={cleanupFailed}
          >登录</Button>
        </form>
        <p className="security-note">请仅使用工作人员提供的专属访问方式。</p>
      </Card>
    </main>
  );
}
