import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { seedConfirmedColdArchiveOrder } from '../../test-support/cold-archive-fixture';
import { registerStaffBatchRoutes } from './batch-routes';

/**
 * Stage 7.5R settlement-export capacity verification: a batch at the exact
 * 5,000-member export ceiling. Proves the keyset enumeration stays correct
 * and index-driven at target volume: the full CSV carries every member with
 * no duplicates, stays under the 2 MiB byte ceiling, and the member page
 * query plan never degrades into a full table scan. Excluded from normal
 * *.test.* suites; run via `npm run verify:settlement-export-capacity`.
 */

const TOTAL_MEMBERS = 5_000;
const ORIGIN = 'https://api.example.test';

let database: SqliteDatabase | null = null;
let seeded = false;
let sellerOrganizationId = '';
let batchId = '';

type Row = Record<string, unknown>;

function readRow(table: string, where: string, param: string): Row {
  const row = database!.raw
    .prepare(`SELECT * FROM ${table} WHERE ${where}`)
    .get(param) as Row | undefined;
  if (!row) throw new Error(`capacity_row_missing:${table}`);
  return row;
}

function insertClone(table: string, template: Row, overrides: Row): void {
  const keys = Object.keys(template);
  // 注意不能用 ?? 合并：显式的 null 覆盖必须生效。
  const values = keys.map((key) =>
    (Object.hasOwn(overrides, key) ? overrides[key] : template[key])) as Parameters<
    ReturnType<SqliteDatabase['raw']['prepare']>['run']
  >;
  database!.raw
    .prepare(
      `INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`,
    )
    .run(...values);
}

async function ensureSeeded(): Promise<void> {
  if (seeded) return;
  database = createMigratedTestDatabase();
  const db = database;
  const seededFixture = await seedConfirmedColdArchiveOrder(db, 'settlement-export-capacity');
  sellerOrganizationId = seededFixture.sellerOrganizationId;
  db.exec(`
    INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at)
    VALUES('sec-owner','导出容量管理员','ACTIVE',1,1,1000,1000,NULL)
      ON CONFLICT(id) DO NOTHING;
    INSERT INTO staff_role_assignments(id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at)
    SELECT 'sec-owner-role','sec-owner','owner','ACTIVE',NULL,1000,NULL,1000,1000
    WHERE NOT EXISTS (SELECT 1 FROM staff_role_assignments WHERE staff_id='sec-owner');
  `);

  // Clone the seeded payable through the full FK chain (same lifecycle walk
  // as settlement-batches-75r.test.ts) until the batch holds exactly
  // TOTAL_MEMBERS payables.
  const payable = readRow('seller_payables', 'id=?', (await database
    .prepare(
      `SELECT payable_id FROM seller_payable_balances
       WHERE seller_organization_id=? AND outstanding_amount_cny_fen>0 LIMIT 1`,
    )
    .bind(sellerOrganizationId)
    .first<{ payable_id: string }>() ?? { payable_id: '' }).payable_id);
  const order = readRow('formal_orders', 'id=?', String(payable['formal_order_id']));
  const snapshot = readRow(
    'formal_order_financial_snapshots', 'id=?', String(payable['financial_snapshot_id']),
  );
  const submission = readRow(
    'order_evidence_submissions', 'id=?', String(order['order_evidence_submission_id']),
  );
  const version = readRow(
    'order_evidence_versions', 'id=?', String(order['order_evidence_version_id']),
  );
  const reservation = readRow(
    'product_reservations', 'id=?', String(order['reservation_id']),
  );
  const buyer = readRow('buyer_customers', 'id=?', String(reservation['buyer_customer_id']));
  if (Number(version['version_no']) !== 1) throw new Error('capacity_version_not_first');

  const effective = calculateEffectiveStaffAuthorization({
    roles: new Set(['owner']),
    grants: new Set(),
    denies: new Set(),
    memberTeamIds: [],
    leaderTeamIds: [],
  });
  const ownerActor: AssignmentStaffAuthorization = {
    staffId: 'sec-owner',
    displayName: 'sec',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: effective.roles,
    permissions: effective.permissions,
    memberTeamIds: [],
    leaderTeamIds: [],
  };

  const app = new Hono<any>();
  app.use('*', async (context, next) => {
    context.set('requestId', `sec-${crypto.randomUUID()}`);
    context.set('staffAuthorization', ownerActor);
    await next();
  });
  registerStaffBatchRoutes(app);
  const base = `/api/staff/seller-settlements/${encodeURIComponent(sellerOrganizationId)}/batches`;

  async function request(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; key?: string } = {}):
  Promise<Response> {
    return app.request(`${ORIGIN}${path}`, {
      method: init.method ?? 'GET',
      ...(init.body === undefined ? {} : {
        body: JSON.stringify(init.body),
        headers: {
          'content-type': 'application/json',
          ...(init.key === undefined ? {} : { 'Idempotency-Key': init.key }),
        },
      }),
    }, { DB: db });
  }

  const created = await request(base, {
    method: 'POST', body: { reason: '容量验证' }, key: 'sec-capacity-create-0001',
  });
  if (created.status !== 201) throw new Error('capacity_create_failed');
  batchId = ((await created.json()) as { data: { batch: { batch_id: string } } })
    .data.batch.batch_id;

  const prefix = 'sec-cap';
  const payableIds: string[] = [];
  db.raw.exec('BEGIN');
  try {
    for (let index = 1; index <= TOTAL_MEMBERS; index += 1) {
      const pad = String(index).padStart(7, '0');
      const subjectId = `${prefix}-subject-${pad}`;
      const buyerId = `${prefix}-buyer-${pad}`;
      const reservationId = `${prefix}-res-${pad}`;
      const submissionId = `${prefix}-sub-${pad}`;
      const versionId = `${prefix}-ver-${pad}`;
      const orderId = `${prefix}-order-${pad}`;
      const snapshotId = `${prefix}-snap-${pad}`;
      const payableId = `${prefix}-pay-${pad}`;
      db.raw
        .prepare(
          `INSERT INTO customer_identity_subjects(id,subject_type,created_at)
           VALUES(?,'BUYER_CUSTOMER',1000)`,
        )
        .run(subjectId);
      insertClone('buyer_customers', buyer, {
        id: buyerId,
        identity_subject_id: subjectId,
        buyer_customer_no: `20260829B${String(8_000_000 + index)}`,
        buyer_sequence: 9_500_000 + index,
      });
      insertClone('product_reservations', reservation, {
        id: reservationId, buyer_customer_id: buyerId, status: 'APPROVED',
      });
      insertClone('order_evidence_submissions', submission, {
        id: submissionId,
        ...(Object.hasOwn(submission, 'reservation_id') ? { reservation_id: reservationId } : {}),
        ...(Object.hasOwn(submission, 'buyer_customer_id') ? { buyer_customer_id: buyerId } : {}),
        status: 'PENDING_VERIFICATION',
        current_version_no: 1,
        public_change_reason: null,
        verified_by_staff_id: null,
        verified_at: null,
        withdrawn_at: null,
        consumed_at: null,
      });
      db.raw
        .prepare(
          `INSERT INTO order_instruction_reconciliation_markers(
            id,reservation_id,disposition,metadata_json,created_at)
          VALUES(?,?,'HISTORICAL_EVIDENCE_CONTEXT','{}',1000)`,
        )
        .run(`${prefix}-marker-${pad}`, reservationId);
      insertClone('order_evidence_versions', version, {
        id: versionId,
        submission_id: submissionId,
        ...(Object.hasOwn(version, 'reservation_id') ? { reservation_id: reservationId } : {}),
        ...(Object.hasOwn(version, 'buyer_customer_id') ? { buyer_customer_id: buyerId } : {}),
        ...(Object.hasOwn(version, 'submitted_by_buyer_id') ? { submitted_by_buyer_id: buyerId } : {}),
        version_no: 1,
        ...(Object.hasOwn(version, 'amazon_order_number_raw')
          ? { amazon_order_number_raw: `900-${pad}-${pad}` } : {}),
        ...(Object.hasOwn(version, 'amazon_order_number_normalized')
          ? { amazon_order_number_normalized: `900-${pad}-${pad}` } : {}),
        order_instruction_id: null,
        order_instruction_version_id: null,
        instruction_deadline_snapshot: null,
        reference_order_amount_jpy_snapshot: null,
        buyer_self_pay_bps_snapshot: null,
        buyer_self_pay_jpy: null,
        buyer_refundable_principal_jpy: null,
        price_mismatch: null,
        price_difference_jpy: null,
        submitted_before_deadline: null,
        ...(Object.hasOwn(version, 'evidence_file_object_id')
          ? { evidence_file_object_id: null } : {}),
      });
      db.raw
        .prepare(
          `UPDATE order_evidence_submissions
           SET status='VERIFIED', current_version_no=1,
             verified_by_staff_id='sec-owner', verified_at=?
           WHERE id=?`,
        )
        .run(Number(submission['submitted_at'] ?? 1000), submissionId);
      insertClone('formal_orders', order, {
        id: orderId,
        order_evidence_submission_id: submissionId,
        order_evidence_version_id: versionId,
        reservation_id: reservationId,
        buyer_customer_id: buyerId,
        ...(Object.hasOwn(order, 'buyer_customer_no')
          ? { buyer_customer_no: `20260829B${String(8_000_000 + index)}` } : {}),
        ...(Object.hasOwn(order, 'order_instruction_id')
          ? { order_instruction_id: null } : {}),
        ...(Object.hasOwn(order, 'order_instruction_version_id')
          ? { order_instruction_version_id: null } : {}),
        amazon_order_number_normalized: `900-${pad}-${pad}`,
        ...(Object.hasOwn(order, 'amazon_order_number_raw')
          ? { amazon_order_number_raw: `900-${pad}-${pad}` } : {}),
      });
      insertClone('formal_order_financial_snapshots', snapshot, {
        id: snapshotId,
        formal_order_id: orderId,
        ...(Object.hasOwn(snapshot, 'platform_order_identifier')
          ? { platform_order_identifier: `900-${pad}-${pad}` } : {}),
        ...(Object.hasOwn(snapshot, 'buyer_customer_id') ? { buyer_customer_id: buyerId } : {}),
        ...(Object.hasOwn(snapshot, 'buyer_self_pay_bps') ? { buyer_self_pay_bps: null } : {}),
        ...(Object.hasOwn(snapshot, 'buyer_self_pay_jpy') ? { buyer_self_pay_jpy: null } : {}),
        ...(Object.hasOwn(snapshot, 'buyer_refundable_principal_jpy')
          ? { buyer_refundable_principal_jpy: null } : {}),
        ...(Object.hasOwn(snapshot, 'buyer_gross_principal_cny_fen')
          ? { buyer_gross_principal_cny_fen: null } : {}),
        ...(Object.hasOwn(snapshot, 'buyer_self_pay_contribution_cny_fen')
          ? { buyer_self_pay_contribution_cny_fen: null } : {}),
      });
      insertClone('seller_payables', payable, {
        id: payableId,
        formal_order_id: orderId,
        financial_snapshot_id: snapshotId,
        source_id: orderId,
      });
      payableIds.push(payableId);
    }
    db.raw.exec('COMMIT');
  } catch (error) {
    db.raw.exec('ROLLBACK');
    throw error;
  }

  for (let offset = 0; offset < payableIds.length; offset += 100) {
    const slice = payableIds.slice(offset, offset + 100);
    const detail = await request(`${base}/${batchId}`);
    const detailBody = (await detail.json()) as { data: { batch: { version: number } } };
    const added = await request(`${base}/${batchId}/members`, {
      method: 'POST',
      body: { payable_ids: slice, expected_version: detailBody.data.batch.version, reason: '容量加入' },
      key: `sec-capacity-add-${String(offset).padStart(6, '0')}`,
    });
    if (added.status !== 201) throw new Error(`capacity_add_failed:${added.status}`);
  }
  const beforeConfirm = await request(`${base}/${batchId}`);
  const beforeConfirmBody = (await beforeConfirm.json()) as { data: { batch: { version: number } } };
  const confirmed = await request(`${base}/${batchId}/confirm`, {
    method: 'POST',
    body: { expected_version: beforeConfirmBody.data.batch.version, reason: '容量确认' },
    key: 'sec-capacity-confirm-1',
  });
  if (confirmed.status !== 201) throw new Error('capacity_confirm_failed');
  seeded = true;
}

describe('settlement export capacity (stage 7.5R)', () => {
  it('exports the exact 5,000-member ceiling completely within byte limits', async () => {
    await ensureSeeded();
    expect(seeded).toBe(true);

    const app = new Hono<any>();
    const effective = calculateEffectiveStaffAuthorization({
      roles: new Set(['owner']),
      grants: new Set(),
      denies: new Set(),
      memberTeamIds: [],
      leaderTeamIds: [],
    });
    app.use('*', async (context, next) => {
      context.set('requestId', `sec-${crypto.randomUUID()}`);
      context.set('staffAuthorization', {
        staffId: 'sec-owner',
        displayName: 'sec',
        staffStatus: 'ACTIVE',
        authorizationVersion: 1,
        roles: effective.roles,
        permissions: effective.permissions,
        memberTeamIds: [],
        leaderTeamIds: [],
      } satisfies AssignmentStaffAuthorization);
      await next();
    });
    registerStaffBatchRoutes(app);
    const base = `/api/staff/seller-settlements/${encodeURIComponent(sellerOrganizationId)}/batches`;
    const response = await app.request(`${ORIGIN}${base}/${batchId}/export`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': 'sec-capacity-export-01',
      },
    }, { DB: database! });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-export-row-count')).toBe(String(TOTAL_MEMBERS));

    const csv = await response.text();
    const lines = csv.trimEnd().split('\n');
    expect(lines).toHaveLength(TOTAL_MEMBERS + 1);
    const numbers = lines.slice(1).map((line) => line.split(',')[0]);
    // Full enumeration: no duplicates, no gaps, stable keyset order.
    expect(new Set(numbers).size).toBe(TOTAL_MEMBERS);
    expect([...numbers].sort()).toEqual(numbers);
    // Within the documented byte ceiling.
    expect(new TextEncoder().encode(csv).byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);

    // A second export under a fresh key still succeeds at the exact ceiling
    // — asserting the boundary is inclusive, not off by one.
    const replay = await app.request(`${ORIGIN}${base}/${batchId}/export`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': 'sec-capacity-export-02',
      },
    }, { DB: database! });
    // The batch is unchanged, so this second export still succeeds at the
    // exact ceiling — asserting the boundary is inclusive, not off by one.
    expect(replay.status).toBe(200);
  }, 600_000);

  it('keeps the member page query index-driven at volume', async () => {
    await ensureSeeded();
    const plan = database!.raw
      .prepare(
        `EXPLAIN QUERY PLAN
        SELECT member.id FROM seller_settlement_batch_members member
        JOIN seller_payable_balances balance ON balance.payable_id=member.payable_id
        WHERE member.batch_id=? AND member.active=1
          AND (member.payable_type>? OR (member.payable_type=?
            AND (member.amazon_order_number_normalized>?
              OR (member.amazon_order_number_normalized=? AND member.id>?))))
        ORDER BY member.payable_type, member.amazon_order_number_normalized, member.id
        LIMIT 501`,
      )
      .all() as Array<{ detail: string }>;
    const text = plan.map((row) => row.detail).join('\n');
    expect(text).toContain('idx_seller_settlement_batch_members_batch');
    expect(text).not.toMatch(/SCAN seller_settlement_batch_members/u);
  }, 600_000);
});
