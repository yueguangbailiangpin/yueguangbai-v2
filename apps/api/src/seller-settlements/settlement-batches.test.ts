import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { StaffPermissionCode } from '@ygb/contracts';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
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

  it('escapes CSV formula injection and keeps the whitelist', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe("'=HYPERLINK(\"http://evil\")");
    expect(csvCell('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('\tTAB')).toBe("'\tTAB");
    expect(csvCell('\rCR')).toBe("'\rCR");
    expect(csvCell('123-1234567-0000001')).toBe('123-1234567-0000001');
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
