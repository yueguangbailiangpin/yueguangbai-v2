import {
  parseFeishuWorkbenchTaskSummaryDto,
  type FeishuWorkbenchAdapter,
  type FeishuWorkbenchTaskSummaryDto,
} from '@ygb/contracts';
import { FeishuWorkbenchAdapterError } from './mock-adapter';

const OFFICIAL_API_ORIGIN = 'https://open.feishu.cn';
const MAX_RESPONSE_BYTES = 64 * 1024;
const TOKEN_EARLY_EXPIRY_MS = 3 * 60 * 1000;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface FeishuTaskV2AdapterOptions {
  apiOrigin?: string;
  appId: string;
  appSecret: string;
  tenantKey: string;
  requestTimeoutMs?: number;
  maxAttempts?: number;
  rateLimitPerSecond?: number;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface TokenCache { value: string; refreshAt: number }
interface ProviderMember { id: string; type: string; role: string }

class TokenExpiredError extends Error {}
class RetryableProviderError extends Error {
  constructor(
    readonly code: 'RATE_LIMITED' | 'UNAVAILABLE',
    readonly retryAfterMs: number | null,
  ) { super(code); }
}

export class FeishuTaskV2Adapter implements FeishuWorkbenchAdapter {
  private readonly apiOrigin: string;
  private readonly fetcher: FetchLike;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly requestTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly rateLimitPerSecond: number;
  private token: TokenCache | null = null;
  private tokenRefresh: Promise<string> | null = null;
  private requestTimes: number[] = [];

  constructor(private readonly options: FeishuTaskV2AdapterOptions) {
    this.apiOrigin = options.apiOrigin ?? OFFICIAL_API_ORIGIN;
    if (this.apiOrigin !== OFFICIAL_API_ORIGIN
      || !safe(options.appId, 128) || !safe(options.appSecret, 1000, 32)
      || !safe(options.tenantKey, 200)) throw new FeishuWorkbenchAdapterError('CONTRACT');
    this.requestTimeoutMs = boundedInteger(options.requestTimeoutMs ?? 3_000, 100, 10_000);
    this.maxAttempts = boundedInteger(options.maxAttempts ?? 3, 1, 3);
    this.rateLimitPerSecond = boundedInteger(options.rateLimitPerSecond ?? 10, 1, 10);
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async upsertTask(
    rawInput: FeishuWorkbenchTaskSummaryDto,
    previousMirrorKey: string | null,
    externalIdempotencyKey: string,
  ): Promise<{ mirror_key: string; adapter_version: number }> {
    const input = parseFeishuWorkbenchTaskSummaryDto(rawInput);
    if (!/^[0-9a-f]{40}$/u.test(externalIdempotencyKey)
      || (previousMirrorKey !== null && !providerGuid(previousMirrorKey))) {
      throw new FeishuWorkbenchAdapterError('CONTRACT');
    }
    if (previousMirrorKey === null) {
      const response = await this.authorizedRequest('POST', '/open-apis/task/v2/tasks?user_id_type=open_id', {
        summary: title(input),
        description: description(input),
        members: [member(input.assignee_open_id)],
        client_token: externalIdempotencyKey,
      });
      const guid = taskGuid(response);
      return { mirror_key: guid, adapter_version: input.work_item_version };
    }

    const current = await this.authorizedRequest('GET', `/open-apis/task/v2/tasks/${encodeURIComponent(previousMirrorKey)}?user_id_type=open_id`, undefined);
    const members = taskMembers(current);
    const obsolete = members.filter((value) => value.type === 'user'
      && value.role === 'assignee' && value.id !== input.assignee_open_id);
    if (obsolete.length > 0) {
      await this.authorizedRequest('POST', `/open-apis/task/v2/tasks/${encodeURIComponent(previousMirrorKey)}/remove_members?user_id_type=open_id`, {
        members: obsolete.map((value) => member(value.id)),
      });
    }
    if (!members.some((value) => value.type === 'user'
      && value.role === 'assignee' && value.id === input.assignee_open_id)) {
      await this.authorizedRequest('POST', `/open-apis/task/v2/tasks/${encodeURIComponent(previousMirrorKey)}/add_members?user_id_type=open_id`, {
        members: [member(input.assignee_open_id)],
        client_token: `${externalIdempotencyKey.slice(0, 32)}-assignee`,
      });
    }
    const updated = await this.authorizedRequest('PATCH', `/open-apis/task/v2/tasks/${encodeURIComponent(previousMirrorKey)}?user_id_type=open_id`, {
      task: {
        summary: title(input),
        description: description(input),
        completed_at: input.status === 'OPEN' ? '0' : String(input.updated_at),
      },
      update_fields: ['summary', 'description', 'completed_at'],
    });
    if (taskGuid(updated) !== previousMirrorKey) throw new FeishuWorkbenchAdapterError('CONTRACT');
    return { mirror_key: previousMirrorKey, adapter_version: input.work_item_version };
  }

  private async tenantToken(): Promise<string> {
    if (this.token && this.token.refreshAt > this.now()) return this.token.value;
    if (this.tokenRefresh) return this.tokenRefresh;
    this.tokenRefresh = this.refreshTenantToken();
    try { return await this.tokenRefresh; } finally { this.tokenRefresh = null; }
  }

  private async refreshTenantToken(): Promise<string> {
    const response = await this.request('POST', '/open-apis/auth/v3/tenant_access_token/internal', {
      app_id: this.options.appId,
      app_secret: this.options.appSecret,
    }, null);
    const record = object(response);
    const value = record?.['tenant_access_token'];
    const expire = record?.['expire'];
    if (record?.['code'] !== 0 || !safe(value, 4096) || !Number.isSafeInteger(expire)
      || Number(expire) < 300 || Number(expire) > 24 * 60 * 60) {
      throw new FeishuWorkbenchAdapterError('CONTRACT');
    }
    this.token = {
      value,
      refreshAt: this.now() + Number(expire) * 1000 - TOKEN_EARLY_EXPIRY_MS,
    };
    return value;
  }

  private async authorizedRequest(method: string, path: string, body: unknown): Promise<unknown> {
    try { return await this.request(method, path, body, await this.tenantToken()); } catch (error) {
      if (!(error instanceof TokenExpiredError)) throw error;
      this.token = null;
      return this.request(method, path, body, await this.tenantToken());
    }
  }

  private async request(method: string, path: string, body: unknown, token: string | null): Promise<unknown> {
    let last: FeishuWorkbenchAdapterError | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        this.consumeRateLimit();
        const response = await this.fetchWithTimeout(`${this.apiOrigin}${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (response.status === 401 && token) throw new TokenExpiredError();
        if (response.status === 429) {
          throw new RetryableProviderError('RATE_LIMITED', retryAfterMilliseconds(response));
        }
        if ([408, 425].includes(response.status) || response.status >= 500) {
          throw new RetryableProviderError('UNAVAILABLE', retryAfterMilliseconds(response));
        }
        if (!response.ok) throw new FeishuWorkbenchAdapterError('CONTRACT');
        const parsed = await readJson(response);
        const record = object(parsed);
        if (!record || !Number.isInteger(record['code'])) throw new FeishuWorkbenchAdapterError('CONTRACT');
        if (record['code'] === 99991663 && token) throw new TokenExpiredError();
        if (record['code'] !== 0) throw new FeishuWorkbenchAdapterError('CONTRACT');
        return parsed;
      } catch (error) {
        if (error instanceof TokenExpiredError) throw error;
        last = error instanceof RetryableProviderError
          ? new FeishuWorkbenchAdapterError(error.code)
          : normalize(error);
        if (attempt >= this.maxAttempts || last.code === 'CONTRACT') throw last;
        const providerDelay = error instanceof RetryableProviderError ? error.retryAfterMs : null;
        await this.sleep(providerDelay ?? Math.min(1_000, 100 * 2 ** (attempt - 1)));
      }
    }
    throw last ?? new FeishuWorkbenchAdapterError('UNAVAILABLE');
  }

  private consumeRateLimit(): void {
    const now = this.now();
    this.requestTimes = this.requestTimes.filter((value) => now - value < 1_000);
    if (this.requestTimes.length >= this.rateLimitPerSecond) {
      throw new FeishuWorkbenchAdapterError('RATE_LIMITED');
    }
    this.requestTimes.push(now);
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try { return await this.fetcher(url, { ...init, signal: controller.signal }); }
    catch { throw new FeishuWorkbenchAdapterError('UNAVAILABLE'); }
    finally { clearTimeout(timeout); }
  }
}

function title(input: FeishuWorkbenchTaskSummaryDto): string {
  const status = input.status === 'OPEN' ? '待处理' : input.status === 'COMPLETED' ? '已完成' : '已取消';
  return `【${status}】${input.safe_title}`;
}
function description(input: FeishuWorkbenchTaskSummaryDto): string {
  return `请在月光白受控网页查看最新事实并确认正式动作：\n${input.deep_link}\n时间显示：北京时间`;
}
function member(openId: string) { return { id: openId, type: 'user', role: 'assignee' }; }
function taskGuid(value: unknown): string {
  const guid = object(object(object(value)?.['data'])?.['task'])?.['guid'];
  if (!providerGuid(guid)) throw new FeishuWorkbenchAdapterError('CONTRACT');
  return guid;
}
function taskMembers(value: unknown): ProviderMember[] {
  const raw = object(object(object(value)?.['data'])?.['task'])?.['members'];
  if (!Array.isArray(raw) || raw.length > 100) throw new FeishuWorkbenchAdapterError('CONTRACT');
  return raw.map((value) => {
    const record = object(value);
    if (!record || !safe(record['id'], 200) || !safe(record['type'], 20) || !safe(record['role'], 20)) {
      throw new FeishuWorkbenchAdapterError('CONTRACT');
    }
    return { id: record['id'], type: record['type'], role: record['role'] };
  });
}
async function readJson(response: Response): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
    throw new FeishuWorkbenchAdapterError('CONTRACT');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new FeishuWorkbenchAdapterError('CONTRACT');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new FeishuWorkbenchAdapterError('CONTRACT');
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new FeishuWorkbenchAdapterError('CONTRACT'); }
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function safe(value: unknown, maximum: number, minimum = 1): value is string {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value);
}
function providerGuid(value: unknown): value is string {
  return safe(value, 200) && /^[A-Za-z0-9_-]+$/u.test(value);
}
function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new FeishuWorkbenchAdapterError('CONTRACT');
  }
  return value;
}
function normalize(error: unknown): FeishuWorkbenchAdapterError {
  return error instanceof FeishuWorkbenchAdapterError
    ? error : new FeishuWorkbenchAdapterError('UNAVAILABLE');
}
function retryAfterMilliseconds(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (raw === null || !/^\d{1,3}$/u.test(raw)) return null;
  return Math.min(1_000, Number(raw) * 1_000);
}
