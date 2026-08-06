import { isFrontendApiError } from '../../api/errors';

export type BuyerMutationRecovery = 'NONE' | 'RETRY_SAME_OPERATION' | 'REFRESH_FACTS_REQUIRED';

export type BuyerMutationSnapshot = Readonly<{
  state: 'IDLE' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  recovery: BuyerMutationRecovery;
  error: unknown;
  requestId: string | null;
  isPending: boolean;
}>;

const initialSnapshot: BuyerMutationSnapshot = Object.freeze({
  state: 'IDLE', recovery: 'NONE', error: null, requestId: null, isPending: false,
});

type Operation<TBody, TResult> = (
  body: TBody,
  idempotencyKey: string,
  signal: AbortSignal,
) => Promise<TResult>;

export class BuyerMutationController<TBody, TResult> {
  private snapshot = initialSnapshot;
  private readonly listeners = new Set<() => void>();
  private active: Promise<TResult> | null = null;
  private abort: AbortController | null = null;
  private retainedBody: TBody | null = null;
  private retainedSignature: string | null = null;
  private retainedKey: string | null = null;
  private retainedOperation: Operation<TBody, TResult> | null = null;

  constructor(private readonly generateKey: () => string = () => crypto.randomUUID()) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): BuyerMutationSnapshot => this.snapshot;

  execute(body: TBody, operation: Operation<TBody, TResult>): Promise<TResult> {
    if (this.active) return this.active;
    const signature = stableSerialize(body);
    if (this.snapshot.recovery === 'RETRY_SAME_OPERATION'
      && signature === this.retainedSignature) {
      return Promise.reject(this.snapshot.error);
    }
    if (signature !== this.retainedSignature || this.retainedKey === null) {
      this.releaseAuthority();
      this.retainedBody = structuredClone(body);
      this.retainedSignature = signature;
      this.retainedKey = this.generateKey();
    }
    this.retainedOperation = operation;
    return this.run();
  }

  retry(): Promise<TResult> | null {
    if (this.active) return this.active;
    if (this.snapshot.recovery !== 'RETRY_SAME_OPERATION'
      || this.retainedBody === null || this.retainedKey === null
      || this.retainedOperation === null) return null;
    return this.run();
  }

  cancel(): void {
    this.abort?.abort();
    this.releaseAuthority();
    this.publish(initialSnapshot);
  }

  dispose(): void {
    this.cancel();
    this.listeners.clear();
  }

  private run(): Promise<TResult> {
    const body = this.retainedBody!;
    const key = this.retainedKey!;
    const operation = this.retainedOperation!;
    this.abort = new AbortController();
    this.publish(Object.freeze({
      state: 'RUNNING', recovery: 'NONE', error: null, requestId: null, isPending: true,
    }));
    const promise = operation(body, key, this.abort.signal).then((result) => {
      this.releaseAuthority();
      this.publish(Object.freeze({
        state: 'SUCCEEDED', recovery: 'NONE', error: null, requestId: null, isPending: false,
      }));
      return result;
    }).catch((error: unknown) => {
      const ambiguous = isAmbiguous(error);
      if (!ambiguous) this.releaseAuthority();
      this.publish(Object.freeze({
        state: 'FAILED',
        recovery: ambiguous ? 'RETRY_SAME_OPERATION' : 'REFRESH_FACTS_REQUIRED',
        error,
        requestId: isFrontendApiError(error) ? error.requestId : null,
        isPending: false,
      }));
      throw error;
    }).finally(() => {
      if (this.active === promise) this.active = null;
      this.abort = null;
    });
    this.active = promise;
    return promise;
  }

  private releaseAuthority(): void {
    this.retainedBody = null;
    this.retainedSignature = null;
    this.retainedKey = null;
    this.retainedOperation = null;
  }

  private publish(snapshot: BuyerMutationSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

function isAmbiguous(error: unknown): boolean {
  return isFrontendApiError(error)
    && (error.code === 'NETWORK_FAILURE' || error.code === 'MALFORMED_RESPONSE'
      || error.category === 'NETWORK' || error.category === 'CONTRACT');
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(',')}}`;
}
