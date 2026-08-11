import { isFrontendApiError } from '../../api/errors';

export type StaffMutationRequest<TBody = unknown> = Readonly<{
  action: string;
  path: string;
  body: TBody;
}>;

type Operation<TResult> = (
  request: StaffMutationRequest,
  idempotencyKey: string,
) => Promise<TResult>;

type Retained<TResult> = Readonly<{
  request: StaffMutationRequest;
  signature: string;
  key: string;
  operation: Operation<TResult>;
}>;

export class StaffMutationAuthority<TResult> {
  private retained: Retained<TResult> | null = null;
  private active: Promise<TResult> | null = null;

  constructor(private readonly generateKey: () => string = () => crypto.randomUUID()) {}

  execute(request: StaffMutationRequest, operation: Operation<TResult>): Promise<TResult> {
    if (this.active) return Promise.reject(new Error('STAFF_MUTATION_ALREADY_RUNNING'));
    this.release();
    const retained = Object.freeze({
      request: cloneRequest(request),
      signature: staffMutationSignature(request),
      key: this.generateKey(),
      operation,
    });
    this.retained = retained;
    return this.run(retained);
  }

  retry(): Promise<TResult> {
    if (this.active) return this.active;
    const retained = this.retained;
    if (!retained || staffMutationSignature(retained.request) !== retained.signature) {
      this.release();
      return Promise.reject(new Error('STAFF_MUTATION_RETRY_UNAVAILABLE'));
    }
    return this.run(retained);
  }

  canRetry(): boolean { return this.retained !== null && this.active === null; }

  release(): void { this.retained = null; }

  private run(retained: Retained<TResult>): Promise<TResult> {
    const promise = retained.operation(retained.request, retained.key).then((result) => {
      this.release();
      return result;
    }).catch((error: unknown) => {
      if (!isAmbiguousStaffMutationError(error)) this.release();
      throw error;
    }).finally(() => {
      if (this.active === promise) this.active = null;
    });
    this.active = promise;
    return promise;
  }
}

export function staffMutationSignature(request: StaffMutationRequest): string {
  return stableSerialize({ action: request.action, path: request.path, body: request.body });
}

function cloneRequest(request: StaffMutationRequest): StaffMutationRequest {
  return Object.freeze({
    action: request.action,
    path: request.path,
    body: structuredClone(request.body),
  });
}

export function isAmbiguousStaffMutationError(error: unknown): boolean {
  return isFrontendApiError(error)
    && (error.code === 'NETWORK_FAILURE' || error.code === 'MALFORMED_RESPONSE'
      || error.category === 'NETWORK' || error.category === 'CONTRACT');
}

function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('NON_JSON_NUMBER');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(',')}}`;
  }
  throw new Error('UNSUPPORTED_JSON_VALUE');
}
