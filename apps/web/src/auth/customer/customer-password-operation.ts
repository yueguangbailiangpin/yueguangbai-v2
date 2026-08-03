import type { QueryClient } from '@tanstack/react-query';
import { isFrontendApiError } from '../../api/errors';
import { queryKeys } from '../../api/query-client';
import { CUSTOMER_TRANSPORT_INVALIDATION_GROUP } from '../customer-transport-invalidation';
import type {
  CustomerAuthApiAdapter,
  CustomerPasswordBody,
  CustomerTarget,
} from './customer-auth-api';
import { expectedAccountType } from './customer-auth-api';
import { CustomerMismatchCleanupCoordinator } from './customer-mismatch-cleanup';

export type CustomerPasswordSubmissionState =
  | 'IDLE'
  | 'EDITING'
  | 'SUBMITTING'
  | 'FAILED_RETRYABLE'
  | 'FAILED_TERMINAL'
  | 'SUCCESS'
  | 'CANCELED';

export type CustomerPasswordSafeError = Readonly<{
  code: 'RETRYABLE' | 'TERMINAL' | 'IDEMPOTENCY_CONFLICT' | 'REQUEST_IN_PROGRESS' | 'PASSWORD_STILL_REQUIRED' | 'DEPENDENCY_ERROR';
  message: string;
}>;

type PasswordOperation = {
  idempotencyKey: string;
  bodyFingerprint: string;
  submissionState: CustomerPasswordSubmissionState;
  lastSafeError: CustomerPasswordSafeError | null;
  requestId: string | null;
};

export type CustomerPasswordSnapshot = Readonly<{
  submissionState: CustomerPasswordSubmissionState;
  bodyFingerprint: string | null;
  lastSafeError: CustomerPasswordSafeError | null;
  requestId: string | null;
}>;

export type CustomerPasswordResult =
  | Readonly<{ kind: 'AUTHENTICATED' }>
  | Readonly<{ kind: 'UNAUTHENTICATED' }>
  | Readonly<{ kind: 'MISMATCH_CLEANED' }>
  | Readonly<{ kind: 'MISMATCH_CLEANUP_FAILED'; requestId: string | null }>
  | Readonly<{ kind: 'PASSWORD_STILL_REQUIRED'; requestId: string | null }>
  | Readonly<{ kind: 'FAILED_RETRYABLE'; requestId: string | null }>
  | Readonly<{ kind: 'FAILED_TERMINAL'; requestId: string | null }>
  | Readonly<{ kind: 'IDEMPOTENCY_CONFLICT'; requestId: string | null }>
  | Readonly<{ kind: 'REQUEST_IN_PROGRESS'; requestId: string | null }>
  | Readonly<{ kind: 'DEPENDENCY_ERROR'; requestId: string | null }>
  | Readonly<{ kind: 'ALREADY_SUBMITTING' }>;

const safeMessages = Object.freeze({
  retryable: '修改密码未完成，请由您决定是否重试。',
  terminal: '修改密码未完成，请检查信息后重新发起。',
  conflict: '该操作发生冲突，请明确发起新操作。',
  inProgress: '操作可能仍在处理中，请勿并发提交。',
  passwordStillRequired: '密码修改状态尚未确认，请留在此页面。',
  dependency: '修改密码后的会话确认失败，请刷新页面。',
});

export class CustomerPasswordOperationController {
  private operation: PasswordOperation | null = null;
  private editRevision = 0;
  private state: CustomerPasswordSubmissionState = 'IDLE';
  private lastSafeError: CustomerPasswordSafeError | null = null;
  private requestId: string | null = null;
  private readonly mismatchCleanup: CustomerMismatchCleanupCoordinator;

  constructor(
    private readonly client: QueryClient,
    private readonly api: CustomerAuthApiAdapter,
    private readonly keyFactory: () => string = () => crypto.randomUUID(),
  ) {
    this.mismatchCleanup = new CustomerMismatchCleanupCoordinator(client, api);
  }

  snapshot(): CustomerPasswordSnapshot {
    return Object.freeze({
      submissionState: this.state,
      bodyFingerprint: this.operation?.bodyFingerprint ?? null,
      lastSafeError: this.lastSafeError,
      requestId: this.requestId,
    });
  }

  edit(): void {
    if (this.state === 'SUBMITTING') return;
    this.editRevision += 1;
    this.releaseOperation('EDITING');
  }

  cancel(): void {
    this.editRevision += 1;
    this.releaseOperation('CANCELED');
  }

  async submit(
    target: CustomerTarget,
    body: CustomerPasswordBody,
    signal?: AbortSignal,
  ): Promise<CustomerPasswordResult> {
    if (this.state === 'SUBMITTING') return { kind: 'ALREADY_SUBMITTING' };

    const fingerprint = `body-revision:${this.editRevision}`;
    if (!this.operation || this.operation.bodyFingerprint !== fingerprint) {
      this.operation = {
        idempotencyKey: this.keyFactory(),
        bodyFingerprint: fingerprint,
        submissionState: 'IDLE',
        lastSafeError: null,
        requestId: null,
      };
      this.mismatchCleanup.beginCycle();
    }
    const operation = this.operation;
    operation.submissionState = 'SUBMITTING';
    operation.lastSafeError = null;
    operation.requestId = null;
    this.state = 'SUBMITTING';
    this.lastSafeError = null;
    this.requestId = null;

    let changed;
    try {
      changed = await this.api.changePassword(body, operation.idempotencyKey, signal);
    } catch (error: unknown) {
      return this.handleSubmissionError(error);
    }

    await CUSTOMER_TRANSPORT_INVALIDATION_GROUP.clear(this.client);
    if (changed.data.session.account_type !== expectedAccountType(target)) {
      return this.handleMismatch(await this.mismatchCleanup.clean());
    }

    let currentSession;
    try {
      currentSession = await this.api.readSession(signal);
    } catch (error: unknown) {
      this.releaseOperation('FAILED_TERMINAL');
      if (isFrontendApiError(error) && error.httpStatus === 401) {
        return { kind: 'UNAUTHENTICATED' };
      }
      const requestId = isFrontendApiError(error) ? error.requestId : null;
      this.setSafeError('DEPENDENCY_ERROR', safeMessages.dependency, requestId);
      return { kind: 'DEPENDENCY_ERROR', requestId };
    }

    if (currentSession.data.session.account_type !== expectedAccountType(target)) {
      return this.handleMismatch(await this.mismatchCleanup.clean());
    }
    if (currentSession.data.session.password_change_required) {
      const requestId = currentSession.requestId;
      this.releaseOperation('FAILED_TERMINAL');
      this.setSafeError('PASSWORD_STILL_REQUIRED', safeMessages.passwordStillRequired, requestId);
      return { kind: 'PASSWORD_STILL_REQUIRED', requestId };
    }

    this.client.setQueryData(queryKeys[target].session, currentSession.data.session);
    this.releaseOperation('SUCCESS');
    return { kind: 'AUTHENTICATED' };
  }

  async retryMismatchCleanup(): Promise<CustomerPasswordResult> {
    const result = await this.mismatchCleanup.retry();
    return this.handleMismatch(result);
  }

  private async handleSubmissionError(error: unknown): Promise<CustomerPasswordResult> {
    const requestId = isFrontendApiError(error) ? error.requestId : null;
    if (isFrontendApiError(error) && error.httpStatus === 401) {
      await CUSTOMER_TRANSPORT_INVALIDATION_GROUP.clear(this.client);
      this.releaseOperation('FAILED_TERMINAL');
      return { kind: 'UNAUTHENTICATED' };
    }
    if (isFrontendApiError(error) && error.code === 'IDEMPOTENCY_CONFLICT') {
      this.releaseOperation('FAILED_TERMINAL');
      this.setSafeError('IDEMPOTENCY_CONFLICT', safeMessages.conflict, requestId);
      return { kind: 'IDEMPOTENCY_CONFLICT', requestId };
    }
    if (isFrontendApiError(error) && error.code === 'REQUEST_IN_PROGRESS') {
      this.setOperationError('REQUEST_IN_PROGRESS', safeMessages.inProgress, requestId);
      return { kind: 'REQUEST_IN_PROGRESS', requestId };
    }
    if (isRetryable(error)) {
      this.setOperationError('RETRYABLE', safeMessages.retryable, requestId);
      return { kind: 'FAILED_RETRYABLE', requestId };
    }
    this.releaseOperation('FAILED_TERMINAL');
    this.setSafeError('TERMINAL', safeMessages.terminal, requestId);
    return { kind: 'FAILED_TERMINAL', requestId };
  }

  private handleMismatch(result: Readonly<{ state: 'CLEANED' | 'FAILED'; requestId: string | null }>): CustomerPasswordResult {
    this.releaseOperation('FAILED_TERMINAL');
    if (result.state === 'CLEANED') return { kind: 'MISMATCH_CLEANED' };
    this.setSafeError('DEPENDENCY_ERROR', '会话清理失败，请重试或刷新', result.requestId);
    return { kind: 'MISMATCH_CLEANUP_FAILED', requestId: result.requestId };
  }

  private setOperationError(code: CustomerPasswordSafeError['code'], message: string, requestId: string | null): void {
    if (!this.operation) return;
    const error = Object.freeze({ code, message });
    this.operation.submissionState = 'FAILED_RETRYABLE';
    this.operation.lastSafeError = error;
    this.operation.requestId = requestId;
    this.state = 'FAILED_RETRYABLE';
    this.lastSafeError = error;
    this.requestId = requestId;
  }

  private setSafeError(code: CustomerPasswordSafeError['code'], message: string, requestId: string | null): void {
    this.lastSafeError = Object.freeze({ code, message });
    this.requestId = requestId;
  }

  private releaseOperation(nextState: CustomerPasswordSubmissionState): void {
    this.operation = null;
    this.state = nextState;
    this.lastSafeError = null;
    this.requestId = null;
  }
}

function isRetryable(error: unknown): boolean {
  return isFrontendApiError(error)
    && (error.category === 'NETWORK'
      || error.category === 'RATE_LIMIT'
      || error.category === 'DEPENDENCY');
}
