import {
  parseFeishuWorkbenchCallbackDto,
  parseFeishuWorkbenchCallbackResultDto,
  type FeishuWorkbenchCallbackDto,
  type FeishuWorkbenchCallbackResultDto,
  type SqlDatabase,
} from '@ygb/contracts';
import { resolveAssignmentStaffAuthorization } from '../staff-assignment/effective-authorization';
import { reassignWorkItem } from '../staff-assignment/reassignment-service';
import { StaffAssignmentError } from '../staff-assignment/errors';
import { prepareStaffAssignmentOutboxStatements } from '../staff-assignment/outbox';

const WINDOW_SECONDS = 5 * 60;
const LEASE_MS = 60_000;

export class FeishuWorkbenchCallbackError extends Error {
  constructor(
    public readonly code: 'VALIDATION_ERROR' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VERSION_CONFLICT' | 'DEPENDENCY_UNAVAILABLE',
    public readonly status: 400 | 401 | 403 | 404 | 409 | 503,
  ) { super(code); this.name = 'FeishuWorkbenchCallbackError'; }
}

export type VerifiedFeishuWorkbenchCallback =
  | { kind: 'CHALLENGE'; challenge: string }
  | { kind: 'EVENT'; callback: FeishuWorkbenchCallbackDto; nonceHash: string; payloadHash: string };

export async function verifyAndDecodeFeishuWorkbenchCallback(input: {
  encryptKey: string | null;
  verificationToken: string | null;
  appId: string | null;
  tenantKey: string | null;
  signature: string | null;
  timestamp: string | null;
  nonce: string | null;
  body: string;
  now: number;
}): Promise<VerifiedFeishuWorkbenchCallback> {
  if (!input.encryptKey || !input.verificationToken || !input.appId || !input.tenantKey) {
    throw new FeishuWorkbenchCallbackError('DEPENDENCY_UNAVAILABLE', 503);
  }
  const encryptKey = input.encryptKey;
  const verificationToken = input.verificationToken;
  const appId = input.appId;
  const tenantKey = input.tenantKey;
  const authenticationHeaders = [input.signature, input.timestamp, input.nonce];
  const hasAnyAuthenticationHeader = authenticationHeaders.some((value) => value !== null);
  const hasAllAuthenticationHeaders = authenticationHeaders.every((value) => value !== null);
  if (!hasAnyAuthenticationHeader) {
    const decoded = await decodeUrlVerificationBody(input.body, encryptKey);
    const challenge = urlVerification(decoded, verificationToken);
    if (!challenge) throw new FeishuWorkbenchCallbackError('UNAUTHENTICATED', 401);
    return challenge;
  }
  if (!hasAllAuthenticationHeaders) {
    throw new FeishuWorkbenchCallbackError('UNAUTHENTICATED', 401);
  }
  if (!/^[0-9a-f]{64}$/u.test(input.signature ?? '') || !/^\d{1,16}$/u.test(input.timestamp ?? '')
    || !safe(input.nonce ?? '', 200)) throw new FeishuWorkbenchCallbackError('UNAUTHENTICATED', 401);
  const timestamp = Number(input.timestamp);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0
    || Math.abs(Math.floor(input.now / 1000) - timestamp) > WINDOW_SECONDS) {
    throw new FeishuWorkbenchCallbackError('UNAUTHENTICATED', 401);
  }
  const expected = await sha256(`${input.timestamp}${input.nonce}${encryptKey}${input.body}`);
  if (!constantTimeEqual(expected, input.signature!)) {
    throw new FeishuWorkbenchCallbackError('UNAUTHENTICATED', 401);
  }
  const wrapper = exact(parseJson(input.body), ['encrypt']);
  if (!safe(wrapper['encrypt'], 128 * 1024)) throw new FeishuWorkbenchCallbackError('VALIDATION_ERROR', 400);
  const plaintext = await decrypt(wrapper['encrypt'], encryptKey);
  const decoded = parseJson(plaintext);
  const record = object(decoded);
  if (!record) throw new FeishuWorkbenchCallbackError('VALIDATION_ERROR', 400);
  const challenge = urlVerification(record, verificationToken);
  if (challenge) return challenge;
  const callback = parseCardAction(record, { verificationToken, appId, tenantKey });
  return {
    kind: 'EVENT',
    callback,
    nonceHash: await sha256(input.nonce!),
    payloadHash: await sha256(plaintext),
  };
}

async function decodeUrlVerificationBody(body: string, encryptKey: string): Promise<unknown> {
  const decoded = parseJson(body);
  const record = object(decoded);
  if (!record) throw new FeishuWorkbenchCallbackError('VALIDATION_ERROR', 400);
  if (!Object.hasOwn(record, 'encrypt')) return record;
  const wrapper = exact(record, ['encrypt']);
  if (!safe(wrapper['encrypt'], 128 * 1024)) {
    throw new FeishuWorkbenchCallbackError('VALIDATION_ERROR', 400);
  }
  return parseJson(await decrypt(wrapper['encrypt'], encryptKey));
}

function urlVerification(
  decoded: unknown,
  verificationToken: string,
): Extract<VerifiedFeishuWorkbenchCallback, { kind: 'CHALLENGE' }> | null {
  const record = object(decoded);
  if (!record || record['type'] !== 'url_verification') return null;
  const challenge = exact(record, ['challenge', 'token', 'type']);
  if (!safe(challenge['challenge'], 1000)
    || !constantTimeEqual(String(challenge['token'] ?? ''), verificationToken)) {
    throw new FeishuWorkbenchCallbackError('UNAUTHENTICATED', 401);
  }
  return { kind: 'CHALLENGE', challenge: challenge['challenge'] };
}

export async function handleFeishuWorkbenchCallback(database: SqlDatabase, input: {
  callback: FeishuWorkbenchCallbackDto;
  nonceHash: string;
  payloadHash: string;
  now: number;
  requestId?: string | null;
}): Promise<FeishuWorkbenchCallbackResultDto> {
  let callback: FeishuWorkbenchCallbackDto;
  try { callback = parseFeishuWorkbenchCallbackDto(input.callback); }
  catch { throw new FeishuWorkbenchCallbackError('VALIDATION_ERROR', 400); }
  if (callback.event_id.length < 8) throw new FeishuWorkbenchCallbackError('VALIDATION_ERROR', 400);
  const claim = await claimReceipt(database, {
    eventId: callback.event_id,
    nonceHash: input.nonceHash,
    payloadHash: input.payloadHash,
    now: input.now,
  });
  if (claim.kind === 'MISMATCH') throw new FeishuWorkbenchCallbackError('UNAUTHENTICATED', 401);
  if (claim.kind === 'DUPLICATE') return claim.result;
  if (claim.kind === 'IN_PROGRESS') return { outcome: 'IN_PROGRESS', work_item_id: null, version: null };
  try {
    const source = await uniqueIdentity(database, callback.tenant_key, callback.open_id);
    const target = await uniqueIdentity(database, callback.tenant_key, callback.target_open_id);
    if (!source || !target) throw new FeishuWorkbenchCallbackError('FORBIDDEN', 403);
    const actor = await resolveAssignmentStaffAuthorization(database, source);
    if (!actor) throw new FeishuWorkbenchCallbackError('FORBIDDEN', 403);
    const mirror = await database.prepare(`SELECT mirror.work_item_id FROM feishu_workbench_mirrors mirror JOIN staff_work_items item ON item.id=mirror.work_item_id JOIN feishu_staff_identities identity ON identity.staff_id=item.assigned_staff_id AND identity.tenant_key=? AND identity.status='ACTIVE' WHERE mirror.mirror_key=? LIMIT 2`)
      .bind(callback.tenant_key, callback.task_guid).all<{ work_item_id: string }>();
    if (mirror.results.length !== 1) throw new FeishuWorkbenchCallbackError('NOT_FOUND', 404);
    const result = await reassignWorkItem(database, {
      workItemId: mirror.results[0]!.work_item_id,
      targetStaffId: target,
      expectedVersion: callback.expected_version,
      reason: callback.reason,
    }, {
      actor,
      idempotencyKey: `feishu:${callback.event_id}`,
      requestId: input.requestId ?? null,
      now: input.now,
    });
    const response = parseFeishuWorkbenchCallbackResultDto({
      outcome: 'SUCCEEDED', work_item_id: result.work_item_id, version: result.version,
    });
    await finishReceipt(database, claim, { status: 'SUCCEEDED', response, now: input.now });
    return response;
  } catch (error) {
    const normalized = normalize(error);
    if (normalized.code === 'VERSION_CONFLICT') {
      const mirror = await database.prepare(`SELECT mirror.work_item_id FROM feishu_workbench_mirrors mirror JOIN staff_work_items item ON item.id=mirror.work_item_id JOIN feishu_staff_identities identity ON identity.staff_id=item.assigned_staff_id AND identity.tenant_key=? AND identity.status='ACTIVE' WHERE mirror.mirror_key=?`)
        .bind(callback.tenant_key, callback.task_guid).first<{ work_item_id: string }>();
      if (mirror) await enqueueReconciliation(database, mirror.work_item_id, input.now);
    }
    const failureCode = normalized.code === 'FORBIDDEN' || normalized.code === 'NOT_FOUND' || normalized.code === 'VERSION_CONFLICT'
      ? normalized.code : 'DEPENDENCY_UNAVAILABLE';
    await finishReceipt(database, claim, { status: 'REJECTED', failureCode, now: input.now }).catch(() => undefined);
    if (normalized.code === 'FORBIDDEN' || normalized.code === 'NOT_FOUND' || normalized.code === 'VERSION_CONFLICT') {
      return { outcome: 'REJECTED', work_item_id: null, version: null };
    }
    throw normalized;
  }
}

function parseCardAction(record: Record<string, unknown>, input: {
  verificationToken: string;
  appId: string;
  tenantKey: string;
}): FeishuWorkbenchCallbackDto {
  try {
    const envelope = exact(record, ['schema', 'header', 'event']);
    if (envelope['schema'] !== '2.0') throw new Error('schema');
    const header = exact(envelope['header'], ['event_id', 'token', 'create_time', 'event_type', 'tenant_key', 'app_id']);
    if (header['event_type'] !== 'card.action.trigger' || !safe(header['event_id'], 200)
      || !safe(header['create_time'], 32) || header['app_id'] !== input.appId || header['tenant_key'] !== input.tenantKey
      || !constantTimeEqual(String(header['token'] ?? ''), input.verificationToken)) throw new Error('header');
    const event = exact(envelope['event'], ['operator', 'token', 'action', 'host', 'context']);
    const operator = allowed(event['operator'], ['tenant_key', 'user_id', 'open_id', 'union_id'], ['tenant_key', 'open_id']);
    if (operator['tenant_key'] !== input.tenantKey || !safe(operator['open_id'], 200)
      || !constantTimeEqual(String(event['token'] ?? ''), input.verificationToken)
      || !safe(event['host'], 100)) throw new Error('event');
    const action = exact(event['action'], ['value', 'tag']);
    if (action['tag'] !== 'button') throw new Error('action');
    const value = exact(action['value'], ['action', 'task_guid', 'expected_version', 'target_open_id', 'reason']);
    allowed(event['context'], ['open_message_id', 'open_chat_id'], ['open_message_id', 'open_chat_id']);
    return parseFeishuWorkbenchCallbackDto({
      event_id: header['event_id'],
      tenant_key: header['tenant_key'],
      open_id: operator['open_id'],
      action: value['action'],
      task_guid: value['task_guid'],
      expected_version: value['expected_version'],
      target_open_id: value['target_open_id'],
      reason: value['reason'],
    });
  } catch (error) {
    if (error instanceof FeishuWorkbenchCallbackError) throw error;
    throw new FeishuWorkbenchCallbackError('VALIDATION_ERROR', 400);
  }
}

async function uniqueIdentity(database: SqlDatabase, tenantKey: string, openId: string): Promise<string | null> {
  const rows = await database.prepare(`SELECT identity.staff_id FROM feishu_staff_identities identity JOIN staff_users staff ON staff.id=identity.staff_id WHERE identity.tenant_key=? AND identity.open_id=? AND identity.status='ACTIVE' AND staff.status='ACTIVE' LIMIT 2`)
    .bind(tenantKey, openId).all<{ staff_id: string }>();
  return rows.results.length === 1 ? rows.results[0]!.staff_id : null;
}

type Claim = { kind: 'OWNED'; leaseToken: string } | { kind: 'DUPLICATE'; result: FeishuWorkbenchCallbackResultDto } | { kind: 'IN_PROGRESS' } | { kind: 'MISMATCH' };
async function claimReceipt(database: SqlDatabase, input: { eventId: string; nonceHash: string; payloadHash: string; now: number }): Promise<Claim> {
  const leaseToken = `feishu-callback:${crypto.randomUUID()}`;
  try {
    const inserted = await database.prepare(`INSERT INTO feishu_workbench_callback_receipts(event_id,nonce_hash,payload_hash,status,response_json,failure_code,lease_token,lease_expires_at,version,created_at,updated_at,completed_at) VALUES(?,?,?,'PROCESSING',NULL,NULL,?,?,1,?,?,NULL) ON CONFLICT(event_id) DO UPDATE SET lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at,version=feishu_workbench_callback_receipts.version+1,updated_at=MAX(excluded.updated_at,feishu_workbench_callback_receipts.updated_at+1) WHERE feishu_workbench_callback_receipts.status='PROCESSING' AND feishu_workbench_callback_receipts.payload_hash=excluded.payload_hash AND feishu_workbench_callback_receipts.nonce_hash=excluded.nonce_hash AND feishu_workbench_callback_receipts.lease_expires_at<=? RETURNING lease_token`)
      .bind(input.eventId, input.nonceHash, input.payloadHash, leaseToken, input.now + LEASE_MS, input.now, input.now, input.now)
      .first<{ lease_token: string }>();
    if (inserted?.lease_token === leaseToken) return { kind: 'OWNED', leaseToken };
  } catch (error) {
    if (!String(error).includes('UNIQUE constraint failed: feishu_workbench_callback_receipts.nonce_hash')) throw error;
    const nonceOwner = await database.prepare('SELECT event_id FROM feishu_workbench_callback_receipts WHERE nonce_hash=?')
      .bind(input.nonceHash).first<{ event_id: string }>();
    if (nonceOwner?.event_id !== input.eventId) return { kind: 'MISMATCH' };
  }
  const row = await database.prepare('SELECT nonce_hash,payload_hash,status,response_json,lease_expires_at FROM feishu_workbench_callback_receipts WHERE event_id=?')
    .bind(input.eventId).first<{ nonce_hash: string; payload_hash: string; status: 'PROCESSING' | 'SUCCEEDED' | 'REJECTED'; response_json: string | null; lease_expires_at: number | null }>();
  if (!row || row.nonce_hash !== input.nonceHash || row.payload_hash !== input.payloadHash) return { kind: 'MISMATCH' };
  if (row.status === 'PROCESSING' && Number(row.lease_expires_at) > input.now) return { kind: 'IN_PROGRESS' };
  if (row.status === 'SUCCEEDED' && row.response_json) {
    try { return { kind: 'DUPLICATE', result: parseFeishuWorkbenchCallbackResultDto(JSON.parse(row.response_json)) }; }
    catch { throw new FeishuWorkbenchCallbackError('DEPENDENCY_UNAVAILABLE', 503); }
  }
  return { kind: 'DUPLICATE', result: { outcome: 'REJECTED', work_item_id: null, version: null } };
}

async function enqueueReconciliation(database: SqlDatabase, workItemId: string, now: number): Promise<void> {
  const item = await database.prepare('SELECT id,version FROM staff_work_items WHERE id=?').bind(workItemId).first<{ id: string; version: number }>();
  if (!item) return;
  const statements = await prepareStaffAssignmentOutboxStatements(database, {
    dedupKey: `staff-work-item:${item.id}:feishu-reconcile:v${item.version}`,
    eventType: 'FEISHU_WORKBENCH_RECONCILE', aggregateType: 'STAFF_WORK_ITEM', aggregateId: item.id,
    payload: { work_item_id: item.id, reconciliation: 'VERSION_CONFLICT' }, now,
  });
  await database.batch(statements);
}

async function finishReceipt(database: SqlDatabase, claim: Extract<Claim, { kind: 'OWNED' }>, input:
  | { status: 'SUCCEEDED'; response: FeishuWorkbenchCallbackResultDto; now: number }
  | { status: 'REJECTED'; failureCode: 'FORBIDDEN' | 'NOT_FOUND' | 'VERSION_CONFLICT' | 'DEPENDENCY_UNAVAILABLE'; now: number }) {
  const result = await database.prepare(`UPDATE feishu_workbench_callback_receipts SET status=?,response_json=?,failure_code=?,lease_token=NULL,lease_expires_at=NULL,version=version+1,updated_at=MAX(?,updated_at+1),completed_at=MAX(?,updated_at+1) WHERE event_id=(SELECT event_id FROM feishu_workbench_callback_receipts WHERE lease_token=? LIMIT 1) AND status='PROCESSING' AND lease_token=?`)
    .bind(input.status, input.status === 'SUCCEEDED' ? JSON.stringify(input.response) : null,
      input.status === 'REJECTED' ? input.failureCode : null, input.now, input.now, claim.leaseToken, claim.leaseToken).run();
  if ((result as { meta?: { changes?: number } }).meta?.changes !== 1) {
    throw new FeishuWorkbenchCallbackError('DEPENDENCY_UNAVAILABLE', 503);
  }
}

function normalize(error: unknown): FeishuWorkbenchCallbackError {
  if (error instanceof FeishuWorkbenchCallbackError) return error;
  if (error instanceof StaffAssignmentError) {
    if (error.code === 'FORBIDDEN') return new FeishuWorkbenchCallbackError('FORBIDDEN', 403);
    if (error.code === 'NOT_FOUND') return new FeishuWorkbenchCallbackError('NOT_FOUND', 404);
    if (error.code === 'VERSION_CONFLICT' || error.code === 'IDEMPOTENCY_CONFLICT' || error.code === 'REQUEST_IN_PROGRESS') {
      return new FeishuWorkbenchCallbackError('VERSION_CONFLICT', 409);
    }
  }
  return new FeishuWorkbenchCallbackError('DEPENDENCY_UNAVAILABLE', 503);
}

async function decrypt(ciphertext: string, encryptKey: string): Promise<string> {
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(ciphertext), (character) => character.charCodeAt(0)); }
  catch { throw new FeishuWorkbenchCallbackError('VALIDATION_ERROR', 400); }
  if (bytes.byteLength < 32 || bytes.byteLength % 16 !== 0) {
    throw new FeishuWorkbenchCallbackError('VALIDATION_ERROR', 400);
  }
  try {
    const keyHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encryptKey));
    const key = await crypto.subtle.importKey('raw', keyHash, { name: 'AES-CBC' }, false, ['decrypt']);
    const clear = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: bytes.slice(0, 16) }, key, bytes.slice(16));
    return new TextDecoder('utf-8', { fatal: true }).decode(clear);
  } catch { throw new FeishuWorkbenchCallbackError('UNAUTHENTICATED', 401); }
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); }
  catch { throw new FeishuWorkbenchCallbackError('VALIDATION_ERROR', 400); }
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const record = object(value);
  if (!record || Object.keys(record).length !== keys.length || Object.keys(record).some((key) => !keys.includes(key))) {
    throw new FeishuWorkbenchCallbackError('VALIDATION_ERROR', 400);
  }
  return record;
}
function allowed(value: unknown, keys: readonly string[], required: readonly string[]): Record<string, unknown> {
  const record = object(value);
  if (!record || Object.keys(record).some((key) => !keys.includes(key)) || required.some((key) => !(key in record))) {
    throw new FeishuWorkbenchCallbackError('VALIDATION_ERROR', 400);
  }
  return record;
}
async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
function safe(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value);
}
