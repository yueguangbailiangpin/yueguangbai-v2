import { describe, expect, it } from 'vitest';
import type {
  FeishuWorkbenchTaskSummaryDto,
  ScheduledOperationalAlertNotificationDto,
} from '@ygb/contracts';
import { FeishuTaskV2Adapter } from './production-adapter';

const OPTIONS = {
  appId: 'cli_anonymous_local_app',
  appSecret: 'anonymous-app-secret-at-least-thirty-two-characters',
  tenantKey: 'tenant-local',
};

describe('Feishu Task v2 production adapter with anonymous transport', () => {
  it('uses the official origin, caches tenant tokens, and sends only the summary whitelist', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      json({ code: 0, tenant_access_token: 'anonymous-token-1', expire: 3600 }),
      json({ code: 0, data: { task: { guid: 'task_anonymous_001' } } }),
      json({ code: 0, data: { task: { guid: 'task_anonymous_002' } } }),
    ];
    const adapter = new FeishuTaskV2Adapter({
      ...OPTIONS,
      fetch: async (url, init) => { requests.push({ url: String(url), ...(init ? { init } : {}) }); return responses.shift()!; },
      now: () => 1_000,
    });
    expect(await adapter.upsertTask(summary(), null, 'a'.repeat(40)))
      .toEqual({ mirror_key: 'task_anonymous_001', adapter_version: 3 });
    expect(await adapter.upsertTask(summary(), null, 'b'.repeat(40)))
      .toEqual({ mirror_key: 'task_anonymous_002', adapter_version: 3 });
    expect(requests.map((request) => request.url)).toEqual([
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      'https://open.feishu.cn/open-apis/task/v2/tasks?user_id_type=open_id',
      'https://open.feishu.cn/open-apis/task/v2/tasks?user_id_type=open_id',
    ]);
    const providerBody = JSON.parse(String(requests[1]?.init?.body)) as Record<string, unknown>;
    expect(providerBody).toMatchObject({
      summary: '【待处理】待处理预约决策', client_token: 'a'.repeat(40),
      members: [{ id: 'ou_anonymous_assignee', type: 'user', role: 'assignee' }],
    });
    expect(JSON.stringify(providerBody)).not.toMatch(/assigned_staff_id|buyer|seller|amount|secret|object_key/u);
  });

  it('refreshes an expired cache and coalesces concurrent token refresh', async () => {
    let now = 1_000;
    let tokenCalls = 0;
    let taskCalls = 0;
    const adapter = new FeishuTaskV2Adapter({
      ...OPTIONS, now: () => now,
      fetch: async (url) => {
        if (String(url).includes('/auth/')) {
          tokenCalls += 1;
          await Promise.resolve();
          return json({ code: 0, tenant_access_token: `anonymous-token-${tokenCalls}`, expire: 300 });
        }
        taskCalls += 1;
        return json({ code: 0, data: { task: { guid: `task_anonymous_${taskCalls}` } } });
      },
    });
    await Promise.all([
      adapter.upsertTask(summary(), null, '1'.repeat(40)),
      adapter.upsertTask(summary(), null, '2'.repeat(40)),
    ]);
    expect(tokenCalls).toBe(1);
    now += 120_001;
    await adapter.upsertTask(summary(), null, '3'.repeat(40));
    expect(tokenCalls).toBe(2);
  });

  it('invalidates a rejected tenant token and retries once with a refreshed token', async () => {
    const authorization: string[] = [];
    const responses = [
      json({ code: 0, tenant_access_token: 'anonymous-token-old', expire: 3600 }),
      json({ code: 99991663, msg: 'token rejected' }),
      json({ code: 0, tenant_access_token: 'anonymous-token-new', expire: 3600 }),
      json({ code: 0, data: { task: { guid: 'task_anonymous_refreshed' } } }),
    ];
    const adapter = new FeishuTaskV2Adapter({
      ...OPTIONS,
      fetch: async (_url, init) => {
        const value = new Headers(init?.headers).get('authorization');
        if (value) authorization.push(value);
        return responses.shift()!;
      },
    });
    expect(await adapter.upsertTask(summary(), null, '4'.repeat(40)))
      .toMatchObject({ mirror_key: 'task_anonymous_refreshed' });
    expect(authorization).toEqual(['Bearer anonymous-token-old', 'Bearer anonymous-token-new']);
  });

  it('honors bounded Retry-After and classifies exhausted anonymous responses', async () => {
    const sleeps: number[] = [];
    const responses = [
      json({ code: 0, tenant_access_token: 'anonymous-token', expire: 3600 }),
      json({ code: 90013 }, 429, { 'Retry-After': '9' }),
      json({ code: 0, data: { task: { guid: 'task_anonymous_retry' } } }),
    ];
    const adapter = new FeishuTaskV2Adapter({
      ...OPTIONS, maxAttempts: 2,
      fetch: async () => responses.shift()!, sleep: async (delay) => { sleeps.push(delay); },
    });
    expect(await adapter.upsertTask(summary(), null, '5'.repeat(40)))
      .toMatchObject({ mirror_key: 'task_anonymous_retry' });
    expect(sleeps).toEqual([1_000]);

    const unavailable = new FeishuTaskV2Adapter({
      ...OPTIONS, maxAttempts: 1,
      fetch: async (url) => String(url).includes('/auth/')
        ? json({ code: 0, tenant_access_token: 'anonymous-token', expire: 3600 })
        : json({ code: 99999 }, 503),
    });
    await expect(unavailable.upsertTask(summary(), null, '6'.repeat(40)))
      .rejects.toMatchObject({ code: 'UNAVAILABLE', message: 'UNAVAILABLE' });
  });

  it('times out without exposing provider bodies and rejects malformed success contracts', async () => {
    const timeout = new FeishuTaskV2Adapter({
      ...OPTIONS, requestTimeoutMs: 100, maxAttempts: 1,
      fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('anonymous provider body must not escape')));
      }),
    });
    await expect(timeout.upsertTask(summary(), null, '7'.repeat(40)))
      .rejects.toMatchObject({ code: 'UNAVAILABLE', message: 'UNAVAILABLE' });

    const malformed = new FeishuTaskV2Adapter({
      ...OPTIONS, maxAttempts: 1,
      fetch: async (url) => String(url).includes('/auth/')
        ? json({ code: 0, tenant_access_token: 'anonymous-token', expire: 3600 })
        : json({ code: 0, data: { task: { guid: '../../forbidden' } } }),
    });
    await expect(malformed.upsertTask(summary(), null, '8'.repeat(40)))
      .rejects.toMatchObject({ code: 'CONTRACT', message: 'CONTRACT' });

    const oversized = new FeishuTaskV2Adapter({
      ...OPTIONS, maxAttempts: 1,
      fetch: async (url) => String(url).includes('/auth/')
        ? json({ code: 0, tenant_access_token: 'anonymous-token', expire: 3600 })
        : new Response(JSON.stringify({ code: 0, padding: 'x'.repeat(65 * 1024) }), {
            headers: { 'Content-Type': 'application/json' },
          }),
    });
    await expect(oversized.upsertTask(summary(), null, 'a'.repeat(40)))
      .rejects.toMatchObject({ code: 'CONTRACT', message: 'CONTRACT' });
  });

  it('retries transient 5xx and enforces the local rate ceiling before transport', async () => {
    const transientResponses = [
      json({ code: 0, tenant_access_token: 'anonymous-token', expire: 3600 }),
      json({ code: 99999 }, 503),
      json({ code: 0, data: { task: { guid: 'task_after_5xx' } } }),
    ];
    const transientSleeps: number[] = [];
    const transient = new FeishuTaskV2Adapter({
      ...OPTIONS, maxAttempts: 2,
      fetch: async () => transientResponses.shift()!,
      sleep: async (delay) => { transientSleeps.push(delay); },
    });
    expect(await transient.upsertTask(summary(), null, 'b'.repeat(40)))
      .toMatchObject({ mirror_key: 'task_after_5xx' });
    expect(transientSleeps).toEqual([100]);

    let calls = 0;
    const limited = new FeishuTaskV2Adapter({
      ...OPTIONS, rateLimitPerSecond: 2, maxAttempts: 1, now: () => 1_000,
      fetch: async (url) => {
        calls += 1;
        return String(url).includes('/auth/')
          ? json({ code: 0, tenant_access_token: 'anonymous-token', expire: 3600 })
          : json({ code: 0, data: { task: { guid: 'task_rate_1' } } });
      },
    });
    await limited.upsertTask(summary(), null, 'c'.repeat(40));
    await expect(limited.upsertTask(summary(), null, 'd'.repeat(40)))
      .rejects.toMatchObject({ code: 'RATE_LIMITED', message: 'RATE_LIMITED' });
    expect(calls).toBe(2);
  });

  it('updates members before the task snapshot and preserves the provider GUID', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const responses = [
      json({ code: 0, tenant_access_token: 'anonymous-token', expire: 3600 }),
      json({ code: 0, data: { task: { guid: 'task_existing', members: [{ id: 'ou_old', type: 'user', role: 'assignee' }] } } }),
      json({ code: 0, data: {} }),
      json({ code: 0, data: {} }),
      json({ code: 0, data: { task: { guid: 'task_existing' } } }),
    ];
    const adapter = new FeishuTaskV2Adapter({
      ...OPTIONS,
      fetch: async (url, init) => {
        calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
        return responses.shift()!;
      },
    });
    expect(await adapter.upsertTask(summary({status:'COMPLETED'}), 'task_existing', '9'.repeat(40)))
      .toEqual({ mirror_key: 'task_existing', adapter_version: 3 });
    expect(calls.slice(1).map((call) => call.url)).toEqual([
      'https://open.feishu.cn/open-apis/task/v2/tasks/task_existing?user_id_type=open_id',
      'https://open.feishu.cn/open-apis/task/v2/tasks/task_existing/remove_members?user_id_type=open_id',
      'https://open.feishu.cn/open-apis/task/v2/tasks/task_existing/add_members?user_id_type=open_id',
      'https://open.feishu.cn/open-apis/task/v2/tasks/task_existing?user_id_type=open_id',
    ]);
    expect(calls[3]?.body).toMatchObject({ members: [{ id: 'ou_anonymous_assignee' }] });
    expect(calls[4]?.body).toMatchObject({
      task:{summary:'【已完成】待处理预约决策',completed_at:'1800000000000'},
      update_fields:['summary','description','completed_at'],
    });
  });

  it('sends only a fixed Chinese operational alert with stable Provider idempotency', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const responses = [
      json({ code: 0, tenant_access_token: 'anonymous-token', expire: 3600 }),
      json({ code: 0, data: { message_id: 'om_anonymous_alert_1' } }),
      json({ code: 0, data: { message_id: 'om_anonymous_alert_1' } }),
    ];
    const adapter = new FeishuTaskV2Adapter({
      ...OPTIONS,
      operationalAlertChatId: 'oc_anonymous_internal_alerts',
      operationalAlertWebOrigin: 'https://staff.example.test',
      operationalAlertRateLimitPerSecond: 5,
      fetch: async (url, init) => {
        requests.push({
          url: String(url),
          body: init?.body ? JSON.parse(String(init.body)) : {},
        });
        return responses.shift()!;
      },
      now: () => 1_000,
    });
    await adapter.notify(alert());
    await adapter.notify(alert());
    expect(adapter.failureSummaryCode).toBe('FEISHU_ADAPTER_FAILURE');
    expect(requests.map((request) => request.url)).toEqual([
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
    ]);
    expect(requests[1]?.body).toMatchObject({
      receive_id: 'oc_anonymous_internal_alerts',
      msg_type: 'text',
    });
    expect(requests[1]?.body['uuid']).toBe(requests[2]?.body['uuid']);
    expect(String(requests[1]?.body['uuid'])).toMatch(/^ygb-alert-[0-9a-f]{40}$/u);
    const content = JSON.parse(String(requests[1]?.body['content'])) as { text: string };
    expect(content.text).toContain('【月光白 V2 运营告警】需处理');
    expect(content.text).toContain('北京时间：2027-01-15 16:00:00 (UTC+8)');
    expect(content.text).toContain('处理入口：https://staff.example.test/staff');
    expect(content.text).not.toMatch(/open_id|chat_id|app_id|tenant|token|secret|buyer|seller|amount|object_key/iu);
  });

  it('refreshes a rejected alert token, enforces alert rate limit, and rejects unsafe success', async () => {
    const responses = [
      json({ code: 0, tenant_access_token: 'anonymous-old', expire: 3600 }),
      json({ code: 99991663 }),
      json({ code: 0, tenant_access_token: 'anonymous-new', expire: 3600 }),
      json({ code: 0, data: { message_id: 'om_anonymous_refreshed' } }),
    ];
    const adapter = new FeishuTaskV2Adapter({
      ...OPTIONS,
      operationalAlertChatId: 'oc_anonymous_internal_alerts',
      operationalAlertWebOrigin: 'https://staff.example.test',
      fetch: async () => responses.shift()!,
      now: () => 1_000,
    });
    await adapter.notify(alert());
    await expect(adapter.notify(alert({ incident_version: 2 })))
      .rejects.toMatchObject({ code: 'RATE_LIMITED', message: 'RATE_LIMITED' });

    const malformed = new FeishuTaskV2Adapter({
      ...OPTIONS,
      operationalAlertChatId: 'oc_anonymous_internal_alerts',
      operationalAlertWebOrigin: 'https://staff.example.test',
      fetch: async (url) => String(url).includes('/auth/')
        ? json({ code: 0, tenant_access_token: 'anonymous-token', expire: 3600 })
        : json({ code: 0, data: { message_id: '../../unsafe' } }),
    });
    await expect(malformed.notify(alert()))
      .rejects.toMatchObject({ code: 'CONTRACT', message: 'CONTRACT' });
  });
});

function summary(overrides: Partial<FeishuWorkbenchTaskSummaryDto> = {}): FeishuWorkbenchTaskSummaryDto {
  return {
    work_type: 'RESERVATION_DECISION', status: 'OPEN', work_item_version: 3,
    assignee_open_id: 'ou_anonymous_assignee', updated_at: 1_800_000_000_000,
    safe_title: '待处理预约决策', deep_link: 'https://staff.example.test/staff/work-items/opaque-local-reference',
    time_basis: 'UTC_MS', display_timezone: 'Asia/Shanghai', ...overrides,
  };
}

function alert(
  overrides: Partial<ScheduledOperationalAlertNotificationDto> = {},
): ScheduledOperationalAlertNotificationDto {
  return {
    signal_type: 'login_anomaly',
    category: 'auth',
    severity: 'CRITICAL',
    summary_code: 'LOGIN_ANOMALY_DETECTED',
    job_name: null,
    notification_kind: 'OPENED',
    status: 'OPEN',
    observed_at: 1_800_000_000_000,
    incident_version: 1,
    count_value: 5,
    ...overrides,
  };
}

function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });
}
