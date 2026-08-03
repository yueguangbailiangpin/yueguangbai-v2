import { z } from 'zod';
import { approvedApiPath } from '../config/runtime-config';
import { failureEnvelope, retryAfterMilliseconds } from './envelopes';
import { FrontendApiError, categoryForStatus } from './errors';

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
export async function apiRequest<T extends z.ZodType>(request: ApiRequest<T>): Promise<ApiResult<z.output<T>>> {
  if (!approvedApiPath(request.path)) {
    throw new FrontendApiError('INVALID_PATH', 0, null, 'CONTRACT');
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
    const retryAfter = retryAfterMilliseconds(response.headers.get('Retry-After'));
    if (response.ok) {
      const envelope = z.object({ data: z.unknown(), meta: z.object({ request_id: z.string().min(1).max(200) }).strict() }).strict().safeParse(payload);
      if (!envelope.success) throw new FrontendApiError('MALFORMED_RESPONSE', response.status, null, 'CONTRACT');
      const parsed = request.schema.safeParse(envelope.data.data);
      if (!parsed.success) throw new FrontendApiError('MALFORMED_RESPONSE', response.status, null, 'CONTRACT');
      return { data: parsed.data, requestId: envelope.data.meta.request_id };
    }
    const parsed = failureEnvelope.safeParse(payload);
    if (!parsed.success) throw new FrontendApiError('MALFORMED_ERROR', response.status, null, 'CONTRACT');
    throw new FrontendApiError(parsed.data.error.code, response.status, parsed.data.meta.request_id, categoryForStatus(response.status), retryAfter);
  } catch (error: unknown) {
    if (error instanceof FrontendApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new FrontendApiError('CANCELED', 0, null, 'CANCELED');
    }
    throw new FrontendApiError('NETWORK_FAILURE', 0, null, 'NETWORK');
  }
}
