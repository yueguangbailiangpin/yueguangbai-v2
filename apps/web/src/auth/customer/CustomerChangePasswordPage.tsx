import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import {
  Alert,
  Button,
  Card,
  FormField,
  RequestIdDisplay,
  TextInput,
} from '../../ui/primitives';
import { customerAuthApi, type CustomerAuthApiAdapter, type CustomerTarget } from './customer-auth-api';
import { BuyerFrame } from '../../buyer/routes/BuyerFrame';
import {
  CustomerPasswordOperationController,
  type CustomerPasswordResult,
  type CustomerPasswordSnapshot,
} from './customer-password-operation';

const initialSnapshot: CustomerPasswordSnapshot = Object.freeze({
  submissionState: 'IDLE',
  bodyFingerprint: null,
  lastSafeError: null,
  requestId: null,
});

export function CustomerChangePasswordPage({
  target,
  adapter = customerAuthApi,
  keyFactory,
}: {
  target: CustomerTarget;
  adapter?: CustomerAuthApiAdapter;
  keyFactory?: () => string;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const controllerRef = useRef<CustomerPasswordOperationController | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [message, setMessage] = useState<string | null>(null);
  const [cleanupFailed, setCleanupFailed] = useState(false);
  controllerRef.current ??= new CustomerPasswordOperationController(client, adapter, keyFactory);
  const busy = snapshot.submissionState === 'SUBMITTING';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      controllerRef.current?.cancel();
    };
  }, []);

  const sync = (): void => {
    if (mountedRef.current) setSnapshot(controllerRef.current!.snapshot());
  };

  function editPassword(
    setter: (value: string) => void,
    event: ChangeEvent<HTMLInputElement>,
  ): void {
    setter(event.currentTarget.value);
    controllerRef.current!.edit();
    setMessage(null);
    setCleanupFailed(false);
    sync();
  }

  function applyResult(result: CustomerPasswordResult): void {
    if (!mountedRef.current) return;
    sync();
    if (result.kind === 'AUTHENTICATED') {
      navigate(`/${target}`, { replace: true });
      return;
    }
    if (result.kind === 'UNAUTHENTICATED') {
      navigate(`/${target}/login`, { replace: true });
      return;
    }
    if (result.kind === 'MISMATCH_CLEANED') {
      setMessage('该账号不适用于此登录入口，请确认账号或联系工作人员。');
      return;
    }
    if (result.kind === 'MISMATCH_CLEANUP_FAILED') {
      setCleanupFailed(true);
      setMessage('会话清理失败，请重试或刷新');
      return;
    }
    if (result.kind === 'PASSWORD_STILL_REQUIRED') {
      setMessage('密码修改状态尚未确认，请留在此页面。');
      return;
    }
    if (result.kind === 'IDEMPOTENCY_CONFLICT') {
      setMessage('该操作发生冲突，请明确发起新操作。');
      return;
    }
    if (result.kind === 'REQUEST_IN_PROGRESS') {
      setMessage('操作可能仍在处理中，请勿并发提交。');
      return;
    }
    if (result.kind === 'DEPENDENCY_ERROR') {
      setMessage('修改密码后的会话确认失败，请刷新页面。');
      return;
    }
    if (result.kind === 'FAILED_RETRYABLE') {
      setMessage('修改密码未完成，请由您决定是否重试。');
      return;
    }
    if (result.kind === 'FAILED_TERMINAL') {
      setMessage('修改密码未完成，请检查信息后重新发起。');
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!currentPassword || !newPassword || newPassword !== confirmation) {
      setMessage('请完整填写并确认新密码。');
      return;
    }
    setMessage(null);
    setCleanupFailed(false);
    const abort = new AbortController();
    abortRef.current = abort;
    const pending = controllerRef.current!.submit(
      target,
      { current_password: currentPassword, new_password: newPassword },
      abort.signal,
    );
    sync();
    try {
      applyResult(await pending);
    } finally {
      if (abortRef.current === abort) abortRef.current = null;
      sync();
    }
  }

  function cancel(): void {
    controllerRef.current!.cancel();
    setCurrentPassword('');
    setNewPassword('');
    setConfirmation('');
    setMessage('本次操作已取消。');
    setCleanupFailed(false);
    sync();
  }

  async function retryCleanup(): Promise<void> {
    setMessage(null);
    const pending = controllerRef.current!.retryMismatchCleanup();
    sync();
    applyResult(await pending);
  }

  const submitLabel = snapshot.submissionState === 'FAILED_RETRYABLE'
    ? '重试修改密码'
    : snapshot.submissionState === 'FAILED_TERMINAL'
      ? '发起新操作'
      : '修改密码';

  const content = (
    <section className={`login-page identity-${target}${target === 'buyer' ? ' buyer-account-form-page' : ' seller-account-form-page'}`}>
      <Card className={`login-card password-card${target === 'buyer' ? ' buyer-login-card buyer-password-card' : ' seller-login-card seller-password-card'}`}>
        {target === 'buyer' ? null : <div className="login-brand"><span className="brand-mark" aria-hidden="true">月</span>
          <strong>月光白</strong></div>}
        <div className="login-heading"><h1>修改密码</h1>
          <p>首次登录或安全状态变化后，需要先设置新密码。</p></div>
        <form onSubmit={(event) => { void submit(event); }}>
          <FormField label="当前密码" htmlFor={`${target}-current-password`} required>
            <TextInput
              name="current_password"
              type="password"
              autoComplete="current-password"
              required
              disabled={busy}
              value={currentPassword}
              onChange={(event) => editPassword(setCurrentPassword, event)}
            />
          </FormField>
          <FormField
            label="新密码"
            htmlFor={`${target}-new-password`}
            description="请使用独立且不易猜测的新密码。"
            required
          >
            <TextInput
              name="new_password"
              type="password"
              autoComplete="new-password"
              required
              disabled={busy}
              value={newPassword}
              onChange={(event) => editPassword(setNewPassword, event)}
            />
          </FormField>
          <FormField
            label="确认新密码"
            htmlFor={`${target}-confirm-password`}
            {...(confirmation && newPassword !== confirmation
              ? { error: '两次输入的新密码不一致。' }
              : {})}
            required
          >
            <TextInput
              name="confirm_password"
              type="password"
              autoComplete="new-password"
              required
              disabled={busy}
              value={confirmation}
              onChange={(event) => setConfirmation(event.currentTarget.value)}
            />
          </FormField>
          {message ? <Alert tone="danger">{message}</Alert> : null}
          <RequestIdDisplay requestId={snapshot.requestId} />
          {cleanupFailed && (
            <Button type="button" className="secondary" disabled={busy} onClick={() => { void retryCleanup(); }}>
              重新清理
            </Button>
          )}
          <div className="entry-actions">
            <Button type="button" className="secondary" disabled={busy} onClick={cancel}>取消本次操作</Button>
            <Button
              type="submit"
              loading={busy}
              loadingLabel="正在提交"
              disabled={cleanupFailed}
            >{submitLabel}</Button>
          </div>
        </form>
      </Card>
    </section>
  );
  return target === 'buyer' ? <BuyerFrame>{content}</BuyerFrame> : <main>{content}</main>;
}
