import { z } from 'zod';
import { approvedApiPath } from '../config/runtime-config';
import { isReviewRuntime } from '../review/runtime';
import { failureEnvelope, retryAfterMilliseconds } from './envelopes';
import { FrontendApiError, categoryForStatus, projectSafeDetails } from './errors';

type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type ApiRequest<T extends z.ZodType> = Readonly<{
  path: string;
  method: ApiMethod;
  schema: T;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Readonly<Record<string, string>>;
}>;

export type ApiResult<T> = Readonly<{ data: T; requestId: string }>;

export function parseApiSuccessEnvelope<T extends z.ZodType>(
  payload: unknown,
  status: number,
  schema: T,
): ApiResult<z.output<T>> {
  const envelope = z.object({
    data: z.unknown(),
    meta: z.object({ request_id: z.string().min(1).max(200) }).strict(),
  }).strict().safeParse(payload);
  if (!envelope.success) {
    throw new FrontendApiError('MALFORMED_RESPONSE', status, null, 'CONTRACT');
  }
  const parsed = schema.safeParse(envelope.data.data);
  if (!parsed.success) {
    throw new FrontendApiError(
      'MALFORMED_RESPONSE',
      status,
      envelope.data.meta.request_id,
      'CONTRACT',
    );
  }
  return { data: parsed.data, requestId: envelope.data.meta.request_id };
}

export function parseApiFailureEnvelope(
  payload: unknown,
  status: number,
  retryAfterHeader: string | null,
): never {
  const parsed = failureEnvelope.safeParse(payload);
  if (!parsed.success) {
    throw new FrontendApiError('MALFORMED_ERROR', status, null, 'CONTRACT');
  }
  throw new FrontendApiError(
    parsed.data.error.code,
    status,
    parsed.data.meta.request_id,
    categoryForStatus(status),
    retryAfterMilliseconds(retryAfterHeader),
    projectSafeDetails(parsed.data.error.code, parsed.data.error.details),
  );
}

export function normalizeResponseError(
  error: unknown,
  signal?: AbortSignal,
): FrontendApiError {
  if (error instanceof FrontendApiError) return error;
  if (signal?.aborted
    || (error instanceof DOMException && error.name === 'AbortError')) {
    return new FrontendApiError('CANCELED', 0, null, 'CANCELED');
  }
  return new FrontendApiError('NETWORK_FAILURE', 0, null, 'NETWORK');
}

export async function apiRequest<T extends z.ZodType>(request: ApiRequest<T>): Promise<ApiResult<z.output<T>>> {
  if (!approvedApiPath(request.path)) {
    throw new FrontendApiError('INVALID_PATH', 0, null, 'CONTRACT');
  }
  if (isReviewRuntime()) {
    // 演示运行时才加载 demo 数据（约 75KB 源码），生产首屏不打包进主链路。
    const { demoApiRequest } = await import('../review/demo-api');
    return demoApiRequest(request);
  }
  try {
    const init: RequestInit = {
      method: request.method,
      credentials: 'include',
      headers: { Accept: 'application/json', ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...request.headers },
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    };
    const response = await fetch(request.path, init);
    const payload: unknown = await response.json().catch(() => null);
    if (response.ok) {
      return parseApiSuccessEnvelope(payload, response.status, request.schema);
    }
    return parseApiFailureEnvelope(payload, response.status, response.headers.get('Retry-After'));
  } catch (error: unknown) {
    throw normalizeResponseError(error, request.signal);
  }
}
