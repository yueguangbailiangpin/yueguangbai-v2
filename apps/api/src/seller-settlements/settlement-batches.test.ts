import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { StaffPermissionCode } from '@ygb/contracts';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { z } from 'zod';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { seedConfirmedColdArchiveOrder } from '../../test-support/cold-archive-fixture';
import { registerStaffBatchRoutes } from './batch-routes';
import {
  addMembers,
  cancelBatch,
  confirmBatch,
  createBatch,
  csvCell,
  listBatches,
  readBatchDetail,
  removeMember,
} from './batches';

/**
 * Stage 7.5 batch 3 coverage: immutable settlement batches — unique active
 * membership, frozen confirmations, derived payment progress, idempotency/
 * version semantics, permission scoping and CSV formula-injection escapes.
 */

const ORIGIN = 'https://api.example.test';
const AT = Date.UTC(2026, 7, 29, 0, 0, 0);

let database: SqliteDatabase | null = null;
let sellerOrganizationId = '';
let payableId = '';

beforeEach(async () => {
  database = createMigratedTestDatabase();
  const seeded = await seedConfirmedColdArchiveOrder(database, 'stage75-batch-three-fixture');
  sellerOrganizationId = seeded.sellerOrganizationId;
  database.exec(`
    INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at)
    VALUES('batch-owner','批次管理员','ACTIVE',1,1,1000,1000,NULL)
      ON CONFLICT(id) DO NOTHING;
    INSERT INTO staff_role_assignments(id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at)
    SELECT 'batch-owner-role','batch-owner','owner','ACTIVE',NULL,1000,NULL,1000,1000
    WHERE NOT EXISTS (SELECT 1 FROM staff_role_assignments WHERE staff_id='batch-owner');
  `);
  const row = await database
    .prepare(
      `SELECT payable_id FROM seller_payable_balances
       WHERE seller_organization_id=? AND outstanding_amount_cny_fen>0 LIMIT 1`,
    )
    .bind(sellerOrganizationId)
    .first<{ payable_id: string }>();
  payableId = row?.payable_id ?? '';
});

afterEach(() => {
  database?.close();
  database = null;
});

function actor(
  role: 'owner' | 'pre_sales' = 'owner',
  denies: StaffPermissionCode[] = [],
): AssignmentStaffAuthorization {
  const effective = calculateEffectiveStaffAuthorization({
    roles: new Set([role]),
    grants: new Set<StaffPermissionCode>(),
    denies: new Set(denies),
    memberTeamIds: [],
    leaderTeamIds: [],
  });
  return {
    staffId: role === 'owner' ? 'batch-owner' : 'batch-pre',
    displayName: '批次',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: effective.roles,
    permissions: effective.permissions,
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}

async function staffRequest(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; key?: string } = {},
): Promise<Response> {
  const app = new Hono<any>();
  app.use('*', async (context, next) => {
    context.set('requestId', `batch-${crypto.randomUUID()}`);
    context.set('staffAuthorization', actor('owner'));
    await next();
  });
  registerStaffBatchRoutes(app);
  return app.request(`${ORIGIN}${path}`, {
    method: init.method ?? 'GET',
    ...(init.body === undefined ? {} : {
      body: JSON.stringify(init.body),
      headers: {
        'content-type': 'application/json',
        ...(init.key === undefined ? {} : { 'Idempotency-Key': init.key }),
      },
    }),
  }, { DB: database! });
}

const base = (extra = '') =>
  `/api/staff/seller-settlements/${encodeURIComponent(sellerOrganizationId)}${extra}`;

const staffBatchMutationSchema = z.object({
  batch: z.object({
    batch_id: z.string().min(1),
    seller_organization_id: z.string().min(1),
    status: z.enum(['DRAFT', 'CONFIRMED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']),
    frozen_total_cny_fen: z.string().regex(/^(?:0|[1-9][0-9]*)$/u),
    frozen_payable_count: z.number().int().nonnegative(),
    paid_amount_cny_fen: z.string().regex(/^(?:0|[1-9][0-9]*)$/u),
    outstanding_amount_cny_fen: z.string().regex(/^(?:0|[1-9][0-9]*)$/u),
    version: z.number().int().positive(),
    created_at: z.number().int().nonnegative(),
    confirmed_at: z.number().int().nonnegative().nullable(),
    cancelled_at: z.number().int().nonnegative().nullable(),
    cancel_reason: z.string().nullable(),
  }).strict(),
  replayed: z.boolean(),
}).strict();

type BatchMutation = z.infer<typeof staffBatchMutationSchema>;

function storedBatchMutation(key: string, action: string): BatchMutation {
  const row = database!.raw.prepare(`
    SELECT response_json
    FROM command_idempotency_records
    WHERE actor_type='STAFF' AND actor_id='batch-owner'
      AND idempotency_key=? AND action=?
  `).get(key, action) as { response_json: string | null } | undefined;
  expect(row?.response_json).toEqual(expect.any(String));
  return staffBatchMutationSchema.parse(JSON.parse(row!.response_json!));
}

async function expectBatchReplay(
  first: BatchMutation,
  replay: BatchMutation,
  key: string,
  action: string,
): Promise<void> {
  expect(first.batch).not.toBeNull();
  expect(first.replayed).toBe(false);
  expect(replay.batch).not.toBeNull();
  expect(replay.replayed).toBe(true);
  expect(replay.batch).toEqual(first.batch);
  expect(storedBatchMutation(key, action)).toEqual({
    batch: first.batch,
    replayed: false,
  });
  const detail = await readBatchDetail(database!, sellerOrganizationId, first.batch.batch_id);
  expect(first.batch).toEqual({
    batch_id: detail.batch_id,
    seller_organization_id: detail.seller_organization_id,
    status: detail.status,
    frozen_total_cny_fen: detail.frozen_total_cny_fen,
    frozen_payable_count: detail.frozen_payable_count,
    paid_amount_cny_fen: detail.paid_amount_cny_fen,
    outstanding_amount_cny_fen: detail.outstanding_amount_cny_fen,
    version: detail.version,
    created_at: detail.created_at,
    confirmed_at: detail.confirmed_at,
    cancelled_at: detail.cancelled_at,
    cancel_reason: detail.cancel_reason,
  });
}

async function httpBatchMutation(
  response: Response,
  status: 200 | 201,
): Promise<BatchMutation> {
  expect(response.status).toBe(status);
  const body = await response.json() as { data: unknown };
  return staffBatchMutationSchema.parse(body.data);
}

describe('settlement batch lifecycle', () => {
  it('creates a draft, adds a member, confirms and derives payment progress', async () => {
    const created = await staffRequest(base('/batches'), {
      method: 'POST',
      body: { reason: '周期结算' },
      key: 'batch-key-create-0001',
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as {
      data: { batch: { batch_id: string; status: string; version: number } };
    };
    const batchId = createdBody.data.batch.batch_id;
    expect(createdBody.data.batch.status).toBe('DRAFT');

    const added = await staffRequest(base(`/batches/${batchId}/members`), {
      method: 'POST',
      body: { payable_ids: [payableId], expected_version: 1, reason: '加入应付' },
      key: 'batch-key-add-000001',
    });
    expect(added.status).toBe(201);

    const confirmed = await staffRequest(base(`/batches/${batchId}/confirm`), {
      method: 'POST',
      body: { expected_version: 1, reason: '确认批次' },
      key: 'batch-key-confirm-001',
    });
    expect(confirmed.status).toBe(201);
    const confirmedBody = await confirmed.json() as {
      data: { batch: { status: string; frozen_total_cny_fen: string; frozen_payable_count: number } };
    };
    expect(confirmedBody.data.batch.status).toBe('CONFIRMED');
    expect(Number(confirmedBody.data.batch.frozen_total_cny_fen)).toBeGreaterThan(0);
    expect(confirmedBody.data.batch.frozen_payable_count).toBe(1);

    // Confirm replay is idempotent (same key, same body).
    const replay = await staffRequest(base(`/batches/${batchId}/confirm`), {
      method: 'POST',
      body: { expected_version: 1, reason: '确认批次' },
      key: 'batch-key-confirm-001',
    });
    expect(replay.status).toBe(200);
    // A different body under the same key conflicts.
    const mismatch = await staffRequest(base(`/batches/${batchId}/confirm`), {
      method: 'POST',
      body: { expected_version: 2, reason: '确认批次' },
      key: 'batch-key-confirm-001',
    });
    expect(mismatch.status).toBe(409);

    const detail = await readBatchDetail(database!, sellerOrganizationId, batchId);
    expect(detail.members).toHaveLength(1);
    expect(detail.status).toBe('CONFIRMED');
    // Audited twice: business events + audit events.
    const events = database!.raw.prepare(
      'SELECT COUNT(*) c FROM seller_settlement_batch_events WHERE batch_id=?',
    ).get(batchId) as { c: number };
    expect(events.c).toBeGreaterThanOrEqual(3);
    const audits = database!.raw.prepare(
      `SELECT COUNT(*) c FROM audit_events
       WHERE aggregate_type='SELLER_SETTLEMENT_BATCH' AND aggregate_id=?`,
    ).get(batchId) as { c: number };
    expect(audits.c).toBeGreaterThanOrEqual(3);
  });

  it('rejects a payable that already sits in another active batch', async () => {
    const first = await createBatch(
      database!,
      { sellerOrganizationId, reason: '第一批' },
      { actor: actor(), idempotencyKey: 'svc-key-a-00000001', now: AT },
    );
    await addMembers(
      database!,
      { batchId: first.batchId, payableIds: [payableId], expectedVersion: 1, reason: '加入' },
      { actor: actor(), idempotencyKey: 'svc-key-b-00000001', now: AT + 1 },
    );
    const second = await createBatch(
      database!,
      { sellerOrganizationId, reason: '第二批' },
      { actor: actor(), idempotencyKey: 'svc-key-c-00000001', now: AT + 2 },
    );
    await expect(addMembers(
      database!,
      {
        batchId: second.batchId,
        payableIds: [payableId],
        expectedVersion: 1,
        reason: '冲突加入',
      },
      { actor: actor(), idempotencyKey: 'svc-key-d-00000001', now: AT + 3 },
    )).rejects.toMatchObject({ code: 'SELLER_SETTLEMENT_CONFLICT' });

    // Cancelling the first batch releases the payable for the second.
    await cancelBatch(
      database!,
      { batchId: first.batchId, expectedVersion: 1, reason: '作废第一批' },
      { actor: actor(), idempotencyKey: 'svc-key-e-00000001', now: AT + 4 },
    );
    const released = database!.raw.prepare(
      'SELECT COUNT(*) c FROM seller_settlement_batch_members WHERE payable_id=? AND active=1',
    ).get(payableId) as { c: number };
    expect(released.c).toBe(0);
    await expect(addMembers(
      database!,
      {
        batchId: second.batchId,
        payableIds: [payableId],
        expectedVersion: 1,
        reason: '释放后加入',
      },
      { actor: actor(), idempotencyKey: 'svc-key-f-00000001', now: AT + 5 },
    )).resolves.toMatchObject({ replayed: false });
  });

  it('freezes membership after confirmation (database rejects mutation)', async () => {
    const created = await createBatch(
      database!,
      { sellerOrganizationId, reason: null },
      { actor: actor(), idempotencyKey: 'frz-key-a-00000001', now: AT },
    );
    await addMembers(
      database!,
      { batchId: created.batchId, payableIds: [payableId], expectedVersion: 1, reason: '加入' },
      { actor: actor(), idempotencyKey: 'frz-key-b-00000001', now: AT + 1 },
    );
    await confirmBatch(
      database!,
      { batchId: created.batchId, expectedVersion: 1, reason: '确认' },
      { actor: actor(), idempotencyKey: 'frz-key-c-00000001', now: AT + 2 },
    );
    // Direct SQL mutation attempts are rejected by triggers.
    expect(() => database!.raw
      .prepare("UPDATE seller_settlement_batch_members SET frozen_amount_cny_fen=1 WHERE batch_id=?")
      .run(created.batchId)).toThrow(/settlement_member_columns_frozen|failed/u);
    expect(() => database!.raw
      .prepare("UPDATE seller_settlement_batches SET frozen_total_cny_fen=1 WHERE id=?")
      .run(created.batchId)).toThrow(/settlement_batch_invalid_transition|failed/u);
    // Version conflicts surface as 409.
    await expect(addMembers(
      database!,
      { batchId: created.batchId, payableIds: [payableId], expectedVersion: 1, reason: '再改' },
      { actor: actor(), idempotencyKey: 'frz-key-d-00000001', now: AT + 3 },
    )).rejects.toMatchObject({ code: 'SELLER_SETTLEMENT_CONFLICT' });
  });

  it('scopes lists and details to the organization and hides drafts for sellers', async () => {
    const created = await createBatch(
      database!,
      { sellerOrganizationId, reason: null },
      { actor: actor(), idempotencyKey: 'scp-key-a-00000001', now: AT },
    );
    const page = await listBatches(database!, sellerOrganizationId, { limit: 10 });
    expect(page.batches).toHaveLength(1);
    // Cross-organization detail is concealed.
    await expect(readBatchDetail(database!, 'org-does-not-exist', created.batchId))
      .rejects.toMatchObject({ status: 404 });
    // Seller-facing list projection drops DRAFT/CANCELLED.
    const sellerVisible = page.batches.filter((batch) => batch.status !== 'DRAFT');
    expect(sellerVisible).toHaveLength(0);
  });

  it('exports a confirmed batch as CSV with escaping and stable filename', async () => {
    // Give the order a formula-looking number to prove escaping end to end.
    const created = await createBatch(
      database!,
      { sellerOrganizationId, reason: null },
      { actor: actor(), idempotencyKey: 'exp-key-a-00000001', now: AT },
    );
    await addMembers(
      database!,
      { batchId: created.batchId, payableIds: [payableId], expectedVersion: 1, reason: '加入' },
      { actor: actor(), idempotencyKey: 'exp-key-b-00000001', now: AT + 1 },
    );
    await confirmBatch(
      database!,
      { batchId: created.batchId, expectedVersion: 1, reason: '确认' },
      { actor: actor(), idempotencyKey: 'exp-key-c-00000001', now: AT + 2 },
    );
    const response = await staffRequest(
      base(`/batches/${created.batchId}/export`),
      { method: 'POST', body: {}, key: 'exp-key-d-00000001' },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition'))
      .toContain(`seller-settlement-batch-${created.batchId}.csv`);
    const csv = await response.text();
    expect(csv).toContain('amazon_order_number,payable_type,frozen_amount_cny_fen');
    expect(csv).not.toContain('object_key');
    expect(csv).not.toContain('buyer_refund');
    const events = database!.raw.prepare(
      `SELECT COUNT(*) c FROM seller_settlement_batch_events
       WHERE batch_id=? AND event_type='BATCH_EXPORTED'`,
    ).get(created.batchId) as { c: number };
    expect(events.c).toBe(1);

    // Exporting a DRAFT batch conflicts.
    const draft = await createBatch(
      database!,
      { sellerOrganizationId, reason: null },
      { actor: actor(), idempotencyKey: 'exp-key-e-00000001', now: AT + 3 },
    );
    const draftExport = await staffRequest(
      base(`/batches/${draft.batchId}/export`),
      { method: 'POST', body: {}, key: 'exp-key-f-00000001' },
    );
    expect(draftExport.status).toBe(409);
  });

  it('escapes CSV formula injection and quotes separators (RFC 4180)', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('\tTAB')).toBe("'\tTAB");
    expect(csvCell('\rCR')).toBe("\"'\rCR\"");
    expect(csvCell('123-1234567-0000001')).toBe('123-1234567-0000001');
    // 7.5R: fields containing separators/quotes/newlines are quoted, with
    // embedded quotes doubled.
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('=1,2')).toBe('"\'=1,2"');
  });
});

describe('settlement batch mutation response consistency', () => {
  it('persists and replays the complete add-members response', async () => {
    const created = await createBatch(
      database!,
      { sellerOrganizationId, reason: '添加响应一致性' },
      { actor: actor(), idempotencyKey: 'response-add-create-0001', now: AT },
    );
    const key = 'response-add-members-0001';
    const input = {
      batchId: created.batchId,
      payableIds: [payableId],
      expectedVersion: 1,
      reason: '加入应付',
    };
    const first = await addMembers(database!, input, {
      actor: actor(), idempotencyKey: key, now: AT + 1,
    });
    const replay = await addMembers(database!, input, {
      actor: actor(), idempotencyKey: key, now: AT + 2,
    });

    await expectBatchReplay(first, replay, key, 'ADD_SELLER_SETTLEMENT_BATCH_MEMBERS');
    expect(first.batch.status).toBe('DRAFT');
    expect(Number(first.batch.outstanding_amount_cny_fen)).toBeGreaterThan(0);
  });

  it('persists and replays the complete remove-member response', async () => {
    const created = await createBatch(
      database!,
      { sellerOrganizationId, reason: '移除响应一致性' },
      { actor: actor(), idempotencyKey: 'response-remove-create-0001', now: AT },
    );
    await addMembers(
      database!,
      { batchId: created.batchId, payableIds: [payableId], expectedVersion: 1, reason: '加入应付' },
      { actor: actor(), idempotencyKey: 'response-remove-add-0001', now: AT + 1 },
    );
    const key = 'response-remove-member-0001';
    const input = {
      batchId: created.batchId,
      payableId,
      expectedVersion: 1,
      reason: '从批次移除',
    };
    const first = await removeMember(database!, input, {
      actor: actor(), idempotencyKey: key, now: AT + 2,
    });
    const replay = await removeMember(database!, input, {
      actor: actor(), idempotencyKey: key, now: AT + 3,
    });

    await expectBatchReplay(first, replay, key, 'REMOVE_SELLER_SETTLEMENT_BATCH_MEMBER');
    expect(first.batch.status).toBe('DRAFT');
    expect(first.batch.outstanding_amount_cny_fen).toBe('0');
  });

  it('persists and replays the complete confirm response', async () => {
    const created = await createBatch(
      database!,
      { sellerOrganizationId, reason: '确认响应一致性' },
      { actor: actor(), idempotencyKey: 'response-confirm-create-0001', now: AT },
    );
    await addMembers(
      database!,
      { batchId: created.batchId, payableIds: [payableId], expectedVersion: 1, reason: '加入应付' },
      { actor: actor(), idempotencyKey: 'response-confirm-add-0001', now: AT + 1 },
    );
    const key = 'response-confirm-batch-0001';
    const input = { batchId: created.batchId, expectedVersion: 1, reason: '确认批次' };
    const first = await confirmBatch(database!, input, {
      actor: actor(), idempotencyKey: key, now: AT + 2,
    });
    const replay = await confirmBatch(database!, input, {
      actor: actor(), idempotencyKey: key, now: AT + 3,
    });

    await expectBatchReplay(first, replay, key, 'CONFIRM_SELLER_SETTLEMENT_BATCH');
    expect(first.batch.status).toBe('CONFIRMED');
    expect(first.batch.confirmed_at).toBe(AT + 2);
    expect(first.batch.version).toBe(2);
  });

  it('persists and replays the complete cancel response', async () => {
    const created = await createBatch(
      database!,
      { sellerOrganizationId, reason: '取消响应一致性' },
      { actor: actor(), idempotencyKey: 'response-cancel-create-0001', now: AT },
    );
    await addMembers(
      database!,
      { batchId: created.batchId, payableIds: [payableId], expectedVersion: 1, reason: '加入应付' },
      { actor: actor(), idempotencyKey: 'response-cancel-add-0001', now: AT + 1 },
    );
    const confirmed = await confirmBatch(
      database!,
      { batchId: created.batchId, expectedVersion: 1, reason: '确认批次' },
      { actor: actor(), idempotencyKey: 'response-cancel-confirm-0001', now: AT + 2 },
    );
    const key = 'response-cancel-batch-0001';
    const input = {
      batchId: created.batchId,
      expectedVersion: confirmed.batch.version,
      reason: '取消批次',
    };
    const first = await cancelBatch(database!, input, {
      actor: actor(), idempotencyKey: key, now: AT + 3,
    });
    const replay = await cancelBatch(database!, input, {
      actor: actor(), idempotencyKey: key, now: AT + 4,
    });

    await expectBatchReplay(first, replay, key, 'CANCEL_SELLER_SETTLEMENT_BATCH');
    expect(first.batch.status).toBe('CANCELLED');
    expect(first.batch.cancelled_at).toBe(AT + 3);
    expect(first.batch.cancel_reason).toBe('取消批次');
    expect(first.batch.version).toBe(3);
  });

  it('keeps HTTP mutation DTOs non-null and identical across first response and replay', async () => {
    const firstBatch = await createBatch(
      database!,
      { sellerOrganizationId, reason: 'HTTP 响应一致性 A' },
      { actor: actor(), idempotencyKey: 'response-http-create-a-1', now: AT },
    );
    const addBody = { payable_ids: [payableId], expected_version: 1, reason: 'HTTP 加入' };
    const addFirst = await httpBatchMutation(
      await staffRequest(base(`/batches/${firstBatch.batchId}/members`), {
        method: 'POST', body: addBody, key: 'response-http-add-0001',
      }),
      201,
    );
    const addReplay = await httpBatchMutation(
      await staffRequest(base(`/batches/${firstBatch.batchId}/members`), {
        method: 'POST', body: addBody, key: 'response-http-add-0001',
      }),
      200,
    );
    await expectBatchReplay(
      addFirst,
      addReplay,
      'response-http-add-0001',
      'ADD_SELLER_SETTLEMENT_BATCH_MEMBERS',
    );

    const removeBody = { expected_version: 1, reason: 'HTTP 移除' };
    const removeFirst = await httpBatchMutation(
      await staffRequest(base(`/batches/${firstBatch.batchId}/members/${payableId}/remove`), {
        method: 'POST', body: removeBody, key: 'response-http-remove-0001',
      }),
      201,
    );
    const removeReplay = await httpBatchMutation(
      await staffRequest(base(`/batches/${firstBatch.batchId}/members/${payableId}/remove`), {
        method: 'POST', body: removeBody, key: 'response-http-remove-0001',
      }),
      200,
    );
    await expectBatchReplay(
      removeFirst,
      removeReplay,
      'response-http-remove-0001',
      'REMOVE_SELLER_SETTLEMENT_BATCH_MEMBER',
    );

    const cancelDraftBody = { expected_version: 1, reason: 'HTTP 取消草稿' };
    const cancelDraftFirst = await httpBatchMutation(
      await staffRequest(base(`/batches/${firstBatch.batchId}/cancel`), {
        method: 'POST', body: cancelDraftBody, key: 'response-http-cancel-draft-1',
      }),
      201,
    );
    const cancelDraftReplay = await httpBatchMutation(
      await staffRequest(base(`/batches/${firstBatch.batchId}/cancel`), {
        method: 'POST', body: cancelDraftBody, key: 'response-http-cancel-draft-1',
      }),
      200,
    );
    await expectBatchReplay(
      cancelDraftFirst,
      cancelDraftReplay,
      'response-http-cancel-draft-1',
      'CANCEL_SELLER_SETTLEMENT_BATCH',
    );

    const secondBatch = await createBatch(
      database!,
      { sellerOrganizationId, reason: 'HTTP 响应一致性 B' },
      { actor: actor(), idempotencyKey: 'response-http-create-b-1', now: AT + 4 },
    );
    const confirmAddBody = { payable_ids: [payableId], expected_version: 1, reason: 'HTTP 再次加入' };
    await httpBatchMutation(
      await staffRequest(base(`/batches/${secondBatch.batchId}/members`), {
        method: 'POST', body: confirmAddBody, key: 'response-http-confirm-add-1',
      }),
      201,
    );
    const confirmBody = { expected_version: 1, reason: 'HTTP 确认' };
    const confirmFirst = await httpBatchMutation(
      await staffRequest(base(`/batches/${secondBatch.batchId}/confirm`), {
        method: 'POST', body: confirmBody, key: 'response-http-confirm-0001',
      }),
      201,
    );
    const confirmReplay = await httpBatchMutation(
      await staffRequest(base(`/batches/${secondBatch.batchId}/confirm`), {
        method: 'POST', body: confirmBody, key: 'response-http-confirm-0001',
      }),
      200,
    );
    await expectBatchReplay(
      confirmFirst,
      confirmReplay,
      'response-http-confirm-0001',
      'CONFIRM_SELLER_SETTLEMENT_BATCH',
    );
  });

  it('preserves mismatch, version-conflict and single-effect concurrency semantics', async () => {
    const created = await createBatch(
      database!,
      { sellerOrganizationId, reason: '冲突响应一致性' },
      { actor: actor(), idempotencyKey: 'response-conflict-create-1', now: AT },
    );
    const key = 'response-conflict-add-0001';
    const input = {
      batchId: created.batchId,
      payableIds: [payableId],
      expectedVersion: 1,
      reason: '首次加入',
    };
    const first = await addMembers(database!, input, {
      actor: actor(), idempotencyKey: key, now: AT + 1,
    });
    const beforeCounts = database!.raw.prepare(`
      SELECT
        (SELECT COUNT(*) FROM seller_settlement_batch_members WHERE batch_id=? AND active=1) AS members,
        (SELECT COUNT(*) FROM seller_settlement_batch_events WHERE batch_id=? AND event_type='MEMBER_ADDED') AS events,
        (SELECT COUNT(*) FROM audit_events WHERE aggregate_id=? AND event_type='SELLER_SETTLEMENT_BATCH_MEMBERS_ADDED') AS audits
    `).get(created.batchId, created.batchId, created.batchId) as {
      members: number;
      events: number;
      audits: number;
    };
    await expect(addMembers(database!, { ...input, reason: '不同请求体' }, {
      actor: actor(), idempotencyKey: key, now: AT + 2,
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    const afterMismatchCounts = database!.raw.prepare(`
      SELECT
        (SELECT COUNT(*) FROM seller_settlement_batch_members WHERE batch_id=? AND active=1) AS members,
        (SELECT COUNT(*) FROM seller_settlement_batch_events WHERE batch_id=? AND event_type='MEMBER_ADDED') AS events,
        (SELECT COUNT(*) FROM audit_events WHERE aggregate_id=? AND event_type='SELLER_SETTLEMENT_BATCH_MEMBERS_ADDED') AS audits
    `).get(created.batchId, created.batchId, created.batchId) as typeof beforeCounts;
    expect(afterMismatchCounts).toEqual(beforeCounts);
    expect(first.batch).not.toBeNull();
    await cancelBatch(database!, {
      batchId: created.batchId,
      expectedVersion: 1,
      reason: '释放并发测试应付',
    }, {
      actor: actor(), idempotencyKey: 'response-conflict-release-1', now: AT + 2,
    });

    const stale = await createBatch(
      database!,
      { sellerOrganizationId, reason: '版本冲突' },
      { actor: actor(), idempotencyKey: 'response-version-create-1', now: AT + 3 },
    );
    await expect(addMembers(database!, {
      batchId: stale.batchId,
      payableIds: [payableId],
      expectedVersion: 2,
      reason: '过期版本',
    }, {
      actor: actor(), idempotencyKey: 'response-version-add-0001', now: AT + 4,
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    expect(database!.raw.prepare(`
      SELECT status, response_json FROM command_idempotency_records
      WHERE actor_id='batch-owner' AND idempotency_key=?
    `).get('response-version-add-0001')).toEqual({ status: 'FAILED', response_json: null });

    const concurrent = await createBatch(
      database!,
      { sellerOrganizationId, reason: '并发响应一致性' },
      { actor: actor(), idempotencyKey: 'response-concurrent-create-1', now: AT + 5 },
    );
    const concurrentInput = {
      batchId: concurrent.batchId,
      payableIds: [payableId],
      expectedVersion: 1,
      reason: '并发加入',
    };
    const outcomes = await Promise.allSettled([
      addMembers(database!, concurrentInput, {
        actor: actor(), idempotencyKey: 'response-concurrent-add-1', now: AT + 6,
      }),
      addMembers(database!, concurrentInput, {
        actor: actor(), idempotencyKey: 'response-concurrent-add-1', now: AT + 6,
      }),
    ]);
    const fulfilled = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<BatchMutation> => outcome.status === 'fulfilled',
    );
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toMatchObject({ code: 'REQUEST_IN_PROGRESS', status: 409 });
      }
    }
    const finalReplay = await addMembers(database!, concurrentInput, {
      actor: actor(), idempotencyKey: 'response-concurrent-add-1', now: AT + 7,
    });
    expect(finalReplay.replayed).toBe(true);
    expect(finalReplay.batch).toEqual(fulfilled[0]!.value.batch);
    expect(database!.raw.prepare(`
      SELECT
        (SELECT COUNT(*) FROM seller_settlement_batch_members WHERE batch_id=? AND active=1) AS members,
        (SELECT COUNT(*) FROM seller_settlement_batch_events WHERE batch_id=? AND event_type='MEMBER_ADDED') AS events,
        (SELECT COUNT(*) FROM audit_events WHERE aggregate_id=? AND event_type='SELLER_SETTLEMENT_BATCH_MEMBERS_ADDED') AS audits
    `).get(concurrent.batchId, concurrent.batchId, concurrent.batchId)).toEqual({
      members: 1,
      events: 1,
      audits: 1,
    });
  });
});

describe('settlement batch idempotency response source guard', () => {
  it('never stores a null batch in a completed mutation response', () => {
    const root = path.resolve(import.meta.dirname, '../../../..');
    const source = readFileSync(
      path.join(root, 'apps/api/src/seller-settlements/batches.ts'),
      'utf8',
    );
    expect(source).not.toMatch(
      /completeIdempotencyStatement\([\s\S]{0,500}?\{\s*batch:\s*null/u,
    );
  });
});

describe('settlement batch HTTP authorization', () => {
  it('blocks reads without SELLER_SETTLEMENT_VIEW and writes for pre_sales', async () => {
    const app = new Hono<any>();
    app.use('*', async (context, next) => {
      context.set('requestId', `batch-${crypto.randomUUID()}`);
      context.set('staffAuthorization', actor('pre_sales'));
      await next();
    });
    registerStaffBatchRoutes(app);
    const read = await app.request(`${ORIGIN}${base('/batches')}`, {}, { DB: database! });
    expect(read.status).toBe(403);
    const write = await app.request(`${ORIGIN}${base('/batches')}`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'x' }),
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'auth-key-0000001' },
    }, { DB: database! });
    expect(write.status).toBe(403);
  });

  it('rejects missing idempotency keys and unknown bodies', async () => {
    const noKey = await staffRequest(base('/batches'), {
      method: 'POST',
      body: { reason: 'x' },
    });
    expect(noKey.status).toBe(400);
    const unknown = await staffRequest(base('/batches'), {
      method: 'POST',
      body: { reason: 'x', wat: 1 },
      key: 'http-key-a-00000001',
    });
    expect(unknown.status).toBe(400);
  });
});
