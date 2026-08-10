import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { parseFeishuWorkbenchTaskSummaryDto, type FeishuWorkbenchCallbackDto } from '@ygb/contracts';
import { prepareDirectWorkItem } from '../staff-assignment/assignment-service';
import { handleFeishuWorkbenchCallback, verifyAndDecodeFeishuWorkbenchCallback } from './callback';
import { FeishuWorkbenchAdapterError, MockFeishuWorkbenchAdapter } from './mock-adapter';
import { feishuWorkbenchRuntime } from './runtime';
import { runFeishuWorkbenchSyncBatch } from './sync';
import { createApp, type AppBindings } from '../app';
import { registerFeishuWorkbenchRoutes } from './routes';
import { runScheduledOperations } from '../scheduled-operations/runner';
import { MemoryOperationalAlertSink } from '../scheduled-operations/signals';

const TENANT_KEY = 'tenant-local';
const APP_ID = 'cli_anonymous_local_app';
const APP_SECRET = 'anonymous-app-secret-at-least-thirty-two-characters';
const ENCRYPT_KEY = 'anonymous-encrypt-key-at-least-thirty-two-characters';
const VERIFICATION_TOKEN = 'anonymous-verification-token';
const WEB_ORIGIN = 'https://staff.example.test';
let database: SqliteDatabase | null = null;
afterEach(() => { database?.close(); database = null; });

describe('Feishu staff workbench production boundary', () => {
  it('fails closed unless each capability has its own complete configuration', () => {
    expect(feishuWorkbenchRuntime({ FEISHU_WORKBENCH_SYNC_ENABLED: 'true' }))
      .toMatchObject({ syncEnabled: false, callbackEnabled: false, adapter: null });
    expect(feishuWorkbenchRuntime({
      FEISHU_WORKBENCH_CALLBACK_ENABLED: 'true', FEISHU_WORKBENCH_APP_ID: APP_ID,
      FEISHU_WORKBENCH_TENANT_KEY: TENANT_KEY, FEISHU_WORKBENCH_ENCRYPT_KEY: 'short',
      FEISHU_WORKBENCH_VERIFICATION_TOKEN: VERIFICATION_TOKEN,
    })).toMatchObject({ callbackEnabled: false });
    const adapter = new MockFeishuWorkbenchAdapter();
    expect(feishuWorkbenchRuntime({
      FEISHU_WORKBENCH_SYNC_ENABLED: 'true', FEISHU_WORKBENCH_WEB_ORIGIN: WEB_ORIGIN,
      FEISHU_WORKBENCH_TENANT_KEY: TENANT_KEY, FEISHU_WORKBENCH_ADAPTER: adapter,
    })).toMatchObject({ syncEnabled: true, callbackEnabled: false, adapter });
    expect(feishuWorkbenchRuntime({
      FEISHU_WORKBENCH_SYNC_ENABLED:'true',FEISHU_WORKBENCH_WEB_ORIGIN:WEB_ORIGIN,
      FEISHU_WORKBENCH_API_ORIGIN:'https://open.feishu.cn',FEISHU_WORKBENCH_APP_ID:APP_ID,
      FEISHU_WORKBENCH_APP_SECRET:APP_SECRET,FEISHU_WORKBENCH_TENANT_KEY:TENANT_KEY,
      FEISHU_WORKBENCH_REQUEST_TIMEOUT_MS:'3000',FEISHU_WORKBENCH_MAX_ATTEMPTS:'3',
      FEISHU_WORKBENCH_RATE_LIMIT_PER_SECOND:'10',
    })).toMatchObject({syncEnabled:true,callbackEnabled:false});
    expect(feishuWorkbenchRuntime({
      FEISHU_OPERATIONAL_ALERT_ENABLED:'true',FEISHU_WORKBENCH_WEB_ORIGIN:WEB_ORIGIN,
      FEISHU_WORKBENCH_API_ORIGIN:'https://open.feishu.cn',FEISHU_WORKBENCH_APP_ID:APP_ID,
      FEISHU_WORKBENCH_APP_SECRET:APP_SECRET,FEISHU_WORKBENCH_TENANT_KEY:TENANT_KEY,
      FEISHU_WORKBENCH_REQUEST_TIMEOUT_MS:'3000',FEISHU_WORKBENCH_MAX_ATTEMPTS:'3',
      FEISHU_WORKBENCH_RATE_LIMIT_PER_SECOND:'10',
      FEISHU_OPERATIONAL_ALERT_RATE_LIMIT_PER_SECOND:'1',
    })).toMatchObject({alertEnabled:false,alertSink:null});
    expect(feishuWorkbenchRuntime({
      FEISHU_OPERATIONAL_ALERT_ENABLED:'true',FEISHU_WORKBENCH_WEB_ORIGIN:WEB_ORIGIN,
      FEISHU_WORKBENCH_API_ORIGIN:'https://open.feishu.cn',FEISHU_WORKBENCH_APP_ID:APP_ID,
      FEISHU_WORKBENCH_APP_SECRET:APP_SECRET,FEISHU_WORKBENCH_TENANT_KEY:TENANT_KEY,
      FEISHU_WORKBENCH_REQUEST_TIMEOUT_MS:'3000',FEISHU_WORKBENCH_MAX_ATTEMPTS:'3',
      FEISHU_WORKBENCH_RATE_LIMIT_PER_SECOND:'10',
      FEISHU_OPERATIONAL_ALERT_CHAT_ID:'oc_anonymous_internal_alerts',
      FEISHU_OPERATIONAL_ALERT_RATE_LIMIT_PER_SECOND:'1',
    })).toMatchObject({alertEnabled:true,syncEnabled:false});
  });

  it('enforces an anonymous summary whitelist and a controlled HTTPS deep link', () => {
    const valid = {
      work_type: 'REVIEW_DECISION', status: 'OPEN', work_item_version: 1,
      assignee_open_id: 'ou_anonymous_assignee', updated_at: 1, safe_title: '待处理评价审核',
      deep_link: `${WEB_ORIGIN}/staff/work-items/opaque-local-reference`,
      time_basis: 'UTC_MS', display_timezone: 'Asia/Shanghai',
    } as const;
    expect(parseFeishuWorkbenchTaskSummaryDto(valid)).toEqual(valid);
    expect(() => parseFeishuWorkbenchTaskSummaryDto({ ...valid, buyer_name: 'forbidden' }))
      .toThrow('invalid_feishu_workbench_contract');
    expect(() => parseFeishuWorkbenchTaskSummaryDto({ ...valid, deep_link: `${WEB_ORIGIN}/other` }))
      .toThrow('invalid_feishu_workbench_summary');
  });

  it('syncs only safe current snapshots through the tenant identity and a one-way provider key', async () => {
    const d = await setup();
    const item = await createWorkItem(d);
    const adapter = new MockFeishuWorkbenchAdapter();
    const result = await sync(d, adapter, 200);
    expect(result).toMatchObject({ processed: 1, succeeded: 1, failed: 0 });
    const task = [...adapter.tasks.values()][0];
    expect(task).toMatchObject({
      work_type: 'RESERVATION_DECISION', work_item_version: 1,
      assignee_open_id: 'ou_anonymous_pre_1', safe_title: '待处理预约决策',
      display_timezone: 'Asia/Shanghai',
    });
    const providerKey = [...adapter.keys.keys()][0]!;
    expect(providerKey).toMatch(/^[0-9a-f]{40}$/u);
    expect(providerKey).not.toContain(item.workItemId);
    expect(JSON.stringify(task)).not.toMatch(/buyer|seller|wechat|amount|proof|source_entity|token|object_key|assigned_staff_id/u);
    expect(await d.prepare('SELECT mirror_key,mirrored_work_item_version FROM feishu_workbench_mirrors WHERE work_item_id=?')
      .bind(item.workItemId).first()).toEqual({ mirror_key: `local_feishu_${providerKey}`, mirrored_work_item_version: 1 });
  });

  it('fails closed before the adapter when the tenant identity is missing or ambiguous', async () => {
    const d = await setup();
    await createWorkItem(d);
    d.exec("UPDATE feishu_staff_identities SET status='REVOKED',revoked_at=2,updated_at=2 WHERE open_id='ou_anonymous_pre_1'");
    const adapter = new MockFeishuWorkbenchAdapter();
    expect(await sync(d, adapter, 200)).toMatchObject({ failed: 1, failureCategory: 'contract_rejected' });
    expect(adapter.tasks.size).toBe(0);
  });

  it('classifies and quarantines the fifth adapter failure without changing business facts', async () => {
    const d = await setup();
    const item = await createWorkItem(d);
    d.exec(`UPDATE integration_outbox SET attempt_count=4,available_at=200 WHERE aggregate_type='STAFF_WORK_ITEM' AND aggregate_id='${item.workItemId}'`);
    const adapter = new MockFeishuWorkbenchAdapter();
    adapter.nextError = new FeishuWorkbenchAdapterError('RATE_LIMITED');
    expect(await sync(d, adapter, 200)).toMatchObject({ processed: 1, failed: 1, failureCategory: 'provider_rate_limited' });
    expect(await d.prepare('SELECT status,last_error,attempt_count FROM integration_outbox WHERE aggregate_id=?')
      .bind(item.workItemId).first()).toEqual({ status: 'FAILED', last_error: 'quarantined', attempt_count: 5 });
    expect(await d.prepare('SELECT failure_category,replay_status FROM scheduled_dead_letters WHERE source_kind=?')
      .bind('OUTBOX').first()).toEqual({ failure_category: 'provider_rate_limited', replay_status: 'QUARANTINED' });
    expect(await d.prepare('SELECT assigned_staff_id,version FROM staff_work_items WHERE id=?').bind(item.workItemId).first())
      .toEqual({ assigned_staff_id: 'pre-1', version: 1 });
  });

  it('reuses one hashed provider key when mirror persistence is retried', async () => {
    const d=await setup();
    await createWorkItem(d);
    const adapter=new MockFeishuWorkbenchAdapter();
    d.exec("CREATE TRIGGER fail_first_mirror BEFORE INSERT ON feishu_workbench_mirrors BEGIN SELECT RAISE(ABORT,'anonymous mirror failure'); END;");
    expect(await sync(d,adapter,200)).toMatchObject({processed:1,failed:1});
    expect(adapter.tasks.size).toBe(1);
    d.exec('DROP TRIGGER fail_first_mirror');
    expect(await sync(d,adapter,60_200)).toMatchObject({processed:1,succeeded:1});
    expect(adapter.tasks.size).toBe(1);
    expect(adapter.keys.size).toBe(1);
  });

  it('verifies and decrypts an official-style challenge and card action contract', async () => {
    const now = 1_800_000_000_000;
    const challenge = await signedEncrypted({ type: 'url_verification', token: VERIFICATION_TOKEN, challenge: 'anonymous-challenge' }, now, 'nonce-challenge');
    expect(await verify(challenge, now)).toEqual({ kind: 'CHALLENGE', challenge: 'anonymous-challenge' });
    const event = await signedEncrypted(cardEvent({ taskGuid: 'task_anonymous_001' }), now, 'nonce-event');
    expect(await verify(event, now)).toMatchObject({
      kind: 'EVENT',
      callback: {
        event_id: 'event_anonymous_001', tenant_key: TENANT_KEY, open_id: 'ou_anonymous_owner',
        action: 'REASSIGN_WORK_ITEM', task_guid: 'task_anonymous_001', expected_version: 1,
        target_open_id: 'ou_anonymous_pre_2', reason: '本地匿名改派测试',
      },
      nonceHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    await expect(verify({ ...event, signature: '0'.repeat(64) }, now)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(verify(event, now + 301_000)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const wrongApp = await signedEncrypted({
      ...cardEvent({ taskGuid: 'task_anonymous_001' }),
      header: { ...cardEvent({ taskGuid: 'task_anonymous_001' }).header, app_id: 'cli_wrong_app' },
    }, now, 'nonce-wrong-app');
    await expect(verify(wrongApp, now)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const wrongTenantBase = cardEvent({ taskGuid: 'task_anonymous_001' });
    const wrongTenant = await signedEncrypted({
      ...wrongTenantBase,
      header: { ...wrongTenantBase.header, tenant_key: 'tenant-wrong' },
    }, now, 'nonce-wrong-tenant');
    await expect(verify(wrongTenant, now)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const wrongTokenBase = cardEvent({ taskGuid: 'task_anonymous_001' });
    const wrongToken = await signedEncrypted({
      ...wrongTokenBase,
      header: { ...wrongTokenBase.header, token: 'wrong-verification-token' },
    }, now, 'nonce-wrong-token');
    await expect(verify(wrongToken, now)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('accepts only token-bound URL verification without signature headers', async () => {
    const now = 1_800_000_000_000;
    const encrypted = await encryptedBody({
      type: 'url_verification', token: VERIFICATION_TOKEN, challenge: 'registration-challenge',
    });
    expect(await verifyWithoutHeaders(encrypted)).toEqual({
      kind: 'CHALLENGE', challenge: 'registration-challenge',
    });
    const plaintext = JSON.stringify({
      challenge: 'plain-registration-challenge', token: VERIFICATION_TOKEN, type: 'url_verification',
    });
    expect(await verifyWithoutHeaders(plaintext)).toEqual({
      kind: 'CHALLENGE', challenge: 'plain-registration-challenge',
    });
    await expect(verifyWithoutHeaders(JSON.stringify({
      challenge: 'wrong-token', token: 'wrong-token', type: 'url_verification',
    }))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(verifyWithoutHeaders(await encryptedBody(cardEvent({
      taskGuid: 'task_unsigned_event',
    })))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const signed = await signedEncrypted({
      type: 'url_verification', token: VERIFICATION_TOKEN, challenge: 'partial-headers',
    }, now, 'nonce-partial');
    await expect(verifyAndDecodeFeishuWorkbenchCallback({
      encryptKey: ENCRYPT_KEY, verificationToken: VERIFICATION_TOKEN, appId: APP_ID, tenantKey: TENANT_KEY,
      signature: signed.signature, timestamp: null, nonce: null, body: signed.body, now,
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('recomputes D1 authorization, resolves open_id targets, and makes exact replay idempotent', async () => {
    const d = await setup();
    const item = await createWorkItem(d);
    const adapter = new MockFeishuWorkbenchAdapter();
    await sync(d, adapter, 200);
    await insertOwnerIdentity(d);
    const taskGuid = String((await d.prepare('SELECT mirror_key FROM feishu_workbench_mirrors WHERE work_item_id=?')
      .bind(item.workItemId).first<{ mirror_key: string }>())?.mirror_key);
    const callback = callbackDto(taskGuid);
    const input = { callback, nonceHash: 'a'.repeat(64), payloadHash: 'b'.repeat(64), now: 10_000 };
    const first = await handleFeishuWorkbenchCallback(d, input);
    expect(first).toMatchObject({ outcome: 'SUCCEEDED', work_item_id: item.workItemId, version: 2 });
    expect(await handleFeishuWorkbenchCallback(d, { ...input, now: 10_001 })).toEqual(first);
    await expect(handleFeishuWorkbenchCallback(d, { ...input, nonceHash: 'c'.repeat(64), now: 10_001 }))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    await expect(handleFeishuWorkbenchCallback(d, {
      ...input, callback: { ...callback, event_id: 'event_nonce_collision' }, now: 10_001,
    })).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    expect(await d.prepare('SELECT assigned_staff_id,version FROM staff_work_items WHERE id=?').bind(item.workItemId).first())
      .toEqual({ assigned_staff_id: 'pre-2', version: 2 });
  });

  it('rejects unknown actors, targets and task GUIDs without changing the work item', async () => {
    const d = await setup();
    const item = await createWorkItem(d);
    const cases = [
      { ...callbackDto('task_missing'), event_id: 'event_unknown_actor', open_id: 'ou_missing' },
      { ...callbackDto('task_missing'), event_id: 'event_unknown_target', target_open_id: 'ou_missing' },
      { ...callbackDto('task_missing'), event_id: 'event_unknown_task' },
    ];
    await insertOwnerIdentity(d);
    for (const [index, callback] of cases.entries()) {
      expect(await handleFeishuWorkbenchCallback(d, {
        callback, nonceHash: String(index + 1).repeat(64), payloadHash: String(index + 4).repeat(64), now: 20_000 + index,
      })).toEqual({ outcome: 'REJECTED', work_item_id: null, version: null });
    }
    expect(await d.prepare('SELECT assigned_staff_id,version FROM staff_work_items WHERE id=?').bind(item.workItemId).first())
      .toEqual({ assigned_staff_id: 'pre-1', version: 1 });
  });

  it('honors current Personal DENY and reconciles a version race from D1', async () => {
    const d = await setup();
    const deniedItem = await createWorkItem(d);
    const adapter = new MockFeishuWorkbenchAdapter();
    await sync(d, adapter, 200);
    await insertOwnerIdentity(d);
    const deniedGuid = String((await d.prepare('SELECT mirror_key FROM feishu_workbench_mirrors WHERE work_item_id=?')
      .bind(deniedItem.workItemId).first<{ mirror_key: string }>())?.mirror_key);
    d.exec(`INSERT INTO staff_permission_overrides(staff_id,permission_code,effect,status,reason,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at) VALUES ('zz-phase3h-test-owner','TASK_REASSIGN_TEAM','DENY','ACTIVE','本地拒绝','zz-phase3h-test-owner',2,NULL,2,2)`);
    expect(await handleFeishuWorkbenchCallback(d, {
      callback: { ...callbackDto(deniedGuid), event_id: 'event_personal_deny' },
      nonceHash: 'e'.repeat(64), payloadHash: 'f'.repeat(64), now: 30_000,
    })).toEqual({ outcome: 'REJECTED', work_item_id: null, version: null });
    expect(await d.prepare('SELECT version,assigned_staff_id FROM staff_work_items WHERE id=?')
      .bind(deniedItem.workItemId).first()).toEqual({ version: 1, assigned_staff_id: 'pre-1' });

    d.exec("UPDATE staff_permission_overrides SET status='REVOKED',revoked_at=3,updated_at=3 WHERE staff_id='zz-phase3h-test-owner' AND permission_code='TASK_REASSIGN_TEAM'");
    d.exec(`UPDATE staff_work_items SET version=2,updated_at=30001 WHERE id='${deniedItem.workItemId}'`);
    expect(await handleFeishuWorkbenchCallback(d, {
      callback: { ...callbackDto(deniedGuid), event_id: 'event_version_race' },
      nonceHash: '1'.repeat(64), payloadHash: '2'.repeat(64), now: 30_002,
    })).toEqual({ outcome: 'REJECTED', work_item_id: null, version: null });
    expect(await d.prepare('SELECT event_type,aggregate_id FROM integration_outbox WHERE dedup_key=?')
      .bind(`staff-work-item:${deniedItem.workItemId}:feishu-reconcile:v2`).first())
      .toEqual({ event_type: 'FEISHU_WORKBENCH_RECONCILE', aggregate_id: deniedItem.workItemId });
  });

  it('serves only encrypted, signed, bounded callbacks and returns a safe Chinese toast', async () => {
    const d = await setup();
    const item = await createWorkItem(d);
    const adapter = new MockFeishuWorkbenchAdapter();
    await sync(d, adapter, 200);
    await insertOwnerIdentity(d);
    const taskGuid = String((await d.prepare('SELECT mirror_key FROM feishu_workbench_mirrors WHERE work_item_id=?')
      .bind(item.workItemId).first<{ mirror_key: string }>())?.mirror_key);
    const now = Date.now();
    const signed = await signedEncrypted(cardEvent({ taskGuid, eventId: 'event_http_001' }), now, 'nonce-http');
    const app = createApp();
    registerFeishuWorkbenchRoutes(app);
    const disabled = await app.request('/api/feishu-workbench/callback', { method: 'POST', body: signed.body }, { DB: d });
    expect([disabled.status, disabled.headers.get('cache-control')]).toEqual([503, 'no-store']);
    const response = await app.request('/api/feishu-workbench/callback', {
      method: 'POST', body: signed.body, headers: callbackHeaders(signed),
    }, callbackBindings(d));
    expect([response.status, response.headers.get('cache-control')]).toEqual([200, 'no-store']);
    expect(await response.json()).toEqual({ toast: { type: 'success', content: '任务已更新，请在月光白网页确认正式业务动作' } });
    const invalid = await app.request('/api/feishu-workbench/callback', {
      method: 'POST', body: signed.body, headers: { ...callbackHeaders(signed), 'X-Lark-Signature': '0'.repeat(64) },
    }, callbackBindings(d));
    expect(invalid.status).toBe(401);
    expect(await invalid.text()).not.toMatch(/app-secret|encrypt-key|verification-token|payload|object_key|reason/u);
  });

  it('uses a configured scheduled adapter while leaving Staff Auth independent', async () => {
    const d = await setup();
    await createWorkItem(d);
    const adapter = new MockFeishuWorkbenchAdapter();
    const sink = new MemoryOperationalAlertSink();
    adapter.nextError = new FeishuWorkbenchAdapterError('UNAVAILABLE');
    const runs = await runScheduledOperations(d, {
      enabled: true, only: 'feishu_sync', feishuAdapter: adapter, feishuWebOrigin: WEB_ORIGIN,
      feishuTenantKey: TENANT_KEY, alertSink: sink, now: 200, batchSize: 1,
    });
    expect(runs[0]).toMatchObject({ job_name: 'feishu_sync', outcome: 'FAILED', failure_category: 'provider_unavailable' });
    expect(feishuWorkbenchRuntime({
      FEISHU_WORKBENCH_SYNC_ENABLED: 'true', FEISHU_WORKBENCH_WEB_ORIGIN: WEB_ORIGIN,
      FEISHU_WORKBENCH_TENANT_KEY: TENANT_KEY, FEISHU_WORKBENCH_ADAPTER: adapter,
    }).syncEnabled).toBe(true);
  });
});

async function sync(d: SqliteDatabase, adapter: MockFeishuWorkbenchAdapter, now: number) {
  return runFeishuWorkbenchSyncBatch(d, adapter, { webOrigin: WEB_ORIGIN, tenantKey: TENANT_KEY, now, limit: 50 });
}

function callbackDto(taskGuid: string): FeishuWorkbenchCallbackDto {
  return {
    event_id: 'event_anonymous_001', tenant_key: TENANT_KEY, open_id: 'ou_anonymous_owner',
    action: 'REASSIGN_WORK_ITEM', task_guid: taskGuid, expected_version: 1,
    target_open_id: 'ou_anonymous_pre_2', reason: '本地匿名改派测试',
  };
}

function cardEvent(input: { taskGuid: string; eventId?: string }) {
  return {
    schema: '2.0',
    header: {
      event_id: input.eventId ?? 'event_anonymous_001', token: VERIFICATION_TOKEN,
      create_time: '1800000000000', event_type: 'card.action.trigger', tenant_key: TENANT_KEY, app_id: APP_ID,
    },
    event: {
      operator: { tenant_key: TENANT_KEY, open_id: 'ou_anonymous_owner', user_id: 'anonymous-user', union_id: 'on_anonymous_owner' },
      token: VERIFICATION_TOKEN,
      action: { value: { action: 'REASSIGN_WORK_ITEM', task_guid: input.taskGuid, expected_version: 1, target_open_id: 'ou_anonymous_pre_2', reason: '本地匿名改派测试' }, tag: 'button' },
      host: 'im_message', context: { open_message_id: 'om_anonymous', open_chat_id: 'oc_anonymous' },
    },
  };
}

async function signedEncrypted(payload: unknown, now: number, nonce: string) {
  const body = await encryptedBody(payload);
  const timestamp = String(Math.floor(now / 1000));
  const signature = await sha256(`${timestamp}${nonce}${ENCRYPT_KEY}${body}`);
  return { body, timestamp, nonce, signature };
}

async function encryptedBody(payload: unknown): Promise<string> {
  const plaintext = JSON.stringify(payload);
  const keyHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ENCRYPT_KEY));
  const key = await crypto.subtle.importKey('raw', keyHash, { name: 'AES-CBC' }, false, ['encrypt']);
  const iv = new Uint8Array(16); iv.fill(7);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, new TextEncoder().encode(plaintext)));
  const combined = new Uint8Array(iv.byteLength + encrypted.byteLength); combined.set(iv); combined.set(encrypted, iv.byteLength);
  return JSON.stringify({ encrypt: btoa(String.fromCharCode(...combined)) });
}

async function verifyWithoutHeaders(body: string) {
  return verifyAndDecodeFeishuWorkbenchCallback({
    encryptKey: ENCRYPT_KEY, verificationToken: VERIFICATION_TOKEN, appId: APP_ID, tenantKey: TENANT_KEY,
    signature: null, timestamp: null, nonce: null, body, now: 1_800_000_000_000,
  });
}

async function verify(input: Awaited<ReturnType<typeof signedEncrypted>>, now: number) {
  return verifyAndDecodeFeishuWorkbenchCallback({
    encryptKey: ENCRYPT_KEY, verificationToken: VERIFICATION_TOKEN, appId: APP_ID, tenantKey: TENANT_KEY,
    signature: input.signature, timestamp: input.timestamp, nonce: input.nonce, body: input.body, now,
  });
}

function callbackHeaders(input: Awaited<ReturnType<typeof signedEncrypted>>): Record<string, string> {
  return {
    'Content-Type': 'application/json', 'X-Lark-Signature': input.signature,
    'X-Lark-Request-Timestamp': input.timestamp, 'X-Lark-Request-Nonce': input.nonce,
  };
}

function callbackBindings(d: SqliteDatabase): AppBindings {
  return {
    DB: d, FEISHU_WORKBENCH_CALLBACK_ENABLED: 'true', FEISHU_WORKBENCH_APP_ID: APP_ID,
    FEISHU_WORKBENCH_TENANT_KEY: TENANT_KEY, FEISHU_WORKBENCH_ENCRYPT_KEY: ENCRYPT_KEY,
    FEISHU_WORKBENCH_VERIFICATION_TOKEN: VERIFICATION_TOKEN,
  };
}

async function insertOwnerIdentity(d: SqliteDatabase): Promise<void> {
  d.exec(`INSERT OR IGNORE INTO feishu_staff_identities(id,staff_id,tenant_key,open_id,user_id,status,verified_at,created_at,updated_at,revoked_at) VALUES ('identity-owner','zz-phase3h-test-owner','${TENANT_KEY}','ou_anonymous_owner',NULL,'ACTIVE',1,1,1,NULL)`);
}

async function setup(): Promise<SqliteDatabase> {
  database = createMigratedTestDatabase();
  database.exec(`
    INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at) VALUES ('pre-1','售前一号','ACTIVE',1,1,1,1,NULL);
    INSERT INTO staff_role_assignments(staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at) VALUES ('pre-1','pre_sales','ACTIVE','zz-phase3h-test-owner',1,NULL,1,1);
    INSERT INTO staff_team_memberships(staff_id,team_id,status,joined_at,ended_at,created_at,updated_at) VALUES ('pre-1','phase3h-test-team','ACTIVE',1,NULL,1,1);
    INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at) VALUES ('pre-2','售前二号','ACTIVE',1,1,1,1,NULL);
    INSERT INTO staff_role_assignments(staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at) VALUES ('pre-2','pre_sales','ACTIVE','zz-phase3h-test-owner',1,NULL,1,1);
    INSERT INTO staff_team_memberships(staff_id,team_id,status,joined_at,ended_at,created_at,updated_at) VALUES ('pre-2','phase3h-test-team','ACTIVE',1,NULL,1,1);
    INSERT INTO feishu_staff_identities(id,staff_id,tenant_key,open_id,user_id,status,verified_at,created_at,updated_at,revoked_at) VALUES ('identity-pre-1','pre-1','${TENANT_KEY}','ou_anonymous_pre_1',NULL,'ACTIVE',1,1,1,NULL);
    INSERT INTO feishu_staff_identities(id,staff_id,tenant_key,open_id,user_id,status,verified_at,created_at,updated_at,revoked_at) VALUES ('identity-pre-2','pre-2','${TENANT_KEY}','ou_anonymous_pre_2',NULL,'ACTIVE',1,1,1,NULL);
    INSERT INTO buyer_channels(id,code,name,status,next_sequence,version,created_at,updated_at,disabled_at) VALUES ('channel-local','L','本地测试','ACTIVE',1,1,1,1,NULL);
    INSERT INTO customer_identity_subjects(id,subject_type,created_at) VALUES ('subject-local','BUYER_CUSTOMER',1);
    INSERT INTO buyer_customers(id,identity_subject_id,marketplace_code,buyer_channel_id,buyer_customer_no,buyer_sequence,first_valid_order_business_date,display_name,access_status,identity_review_status,version,created_at,updated_at,activated_at,disabled_at) VALUES ('buyer-local','subject-local','JP','channel-local',NULL,NULL,NULL,'匿名买家','DISABLED','CLEAR',1,1,1,NULL,1);
  `);
  return database;
}

async function createWorkItem(d: SqliteDatabase) {
  const prepared = await prepareDirectWorkItem(d, {
    workType: 'RESERVATION_DECISION', sourceEntityType: 'RESERVATION',
    sourceEntityId: `reservation-local-${crypto.randomUUID()}`, marketplaceCode: 'JP',
    buyerCustomerId: 'buyer-local', actorType: 'SYSTEM', now: 100,
  });
  await d.batch(prepared.statements);
  return prepared;
}

async function sha256(value: string): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
