import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { StaffPermissionCode } from '@ygb/contracts';
import { sha256Hex } from '@ygb/domain';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { seedConfirmedColdArchiveOrder } from '../../test-support/cold-archive-fixture';
import { issueCustomerSession } from '../customer-auth/authenticate-customer';
import { customerSessionMiddleware } from '../middleware/customer-auth';
import {
  registerSellerBatchRoutes,
  registerStaffBatchRoutes,
} from './batch-routes';
import { exportBatchCsv, exportHeader } from './batches';

/**
 * Stage 7.5R request-level truthfulness coverage for settlement batches:
 * - keyset member pagination end to end (no silent MEMBER_PAGE truncation);
 * - seller-portal projection: SQL-side DRAFT/CANCELLED filtering, real
 *   cursor pagination, seller-safe DTO with concealed cross-org 404s;
 * - CSV export: full enumeration, prechecked limits (409 EXPORT_TOO_LARGE
 *   before any byte), idempotent receipt replay with a single audit side
 *   effect, payload mismatch 409, cancel-after-export fail-closed.
 */

const ORIGIN = 'https://api.example.test';
const AT = Date.UTC(2026, 7, 29, 0, 0, 0);
const SESSION_SECRET = 'stage75r-settlement-test-session-secret-32b';

let database: SqliteDatabase | null = null;
let sellerOrganizationId = '';
let templatePayableId = '';

beforeEach(async () => {
  database = createMigratedTestDatabase();
  const seeded = await seedConfirmedColdArchiveOrder(database, 'stage75r-settlements');
  sellerOrganizationId = seeded.sellerOrganizationId;
  database.exec(`
    INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at)
    VALUES('r75-owner','结算管理员','ACTIVE',1,1,1000,1000,NULL)
      ON CONFLICT(id) DO NOTHING;
    INSERT INTO staff_role_assignments(id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at)
    SELECT 'r75-owner-role','r75-owner','owner','ACTIVE',NULL,1000,NULL,1000,1000
    WHERE NOT EXISTS (SELECT 1 FROM staff_role_assignments WHERE staff_id='r75-owner');
    -- 卖家登录账号：卖家端路由走真实 customer session。
    INSERT INTO customer_login_accounts(id,identity_subject_id,account_type,login_identifier_display,login_identifier_normalized,status,session_version,password_change_required,version,created_at,updated_at,activated_at,disabled_at,registration_source)
    VALUES('r75-seller-account','cold-seller-subject-stage75r-settlements','SELLER_MEMBER','r75-seller','r75-seller','ACTIVE',1,0,1,1000,1000,1000,NULL,NULL)
      ON CONFLICT(id) DO NOTHING;
  `);
  const row = await database!
    .prepare(
      `SELECT payable_id FROM seller_payable_balances
       WHERE seller_organization_id=? AND outstanding_amount_cny_fen>0 LIMIT 1`,
    )
    .bind(sellerOrganizationId)
    .first<{ payable_id: string }>();
  templatePayableId = row?.payable_id ?? '';
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
    staffId: role === 'owner' ? 'r75-owner' : 'r75-pre',
    displayName: '7.5R结算',
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
    context.set('requestId', `r75-${crypto.randomUUID()}`);
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

async function sellerRequest(
  path: string,
  identity: { accountId: string; subjectId: string } = {
    accountId: 'r75-seller-account',
    subjectId: 'cold-seller-subject-stage75r-settlements',
  },
): Promise<Response> {
  const token = await issueCustomerSession({
    accountId: identity.accountId,
    identitySubjectId: identity.subjectId,
    accountType: 'SELLER_MEMBER',
    sessionVersion: 1,
    passwordChangeRequired: false,
  }, SESSION_SECRET, { now: Date.now(), ttlMs: 60 * 60 * 1000 });
  const app = new Hono<any>();
  app.use('*', customerSessionMiddleware());
  registerSellerBatchRoutes(app);
  return app.request(`${ORIGIN}${path}`, {
    headers: {
      Cookie: `__Host-ygb_customer_session=${token}`,
      Origin: ORIGIN,
      'Sec-Fetch-Site': 'same-origin',
    },
  }, { DB: database!, CUSTOMER_SESSION_SECRET: SESSION_SECRET } as never);
}

/**
 * Seed an additional seller organization member with an explicit role and
 * status (7.5R-2 role matrix). Returns the identity used to open sessions.
 */
function seedSellerMember(
  role: 'OWNER' | 'OPERATIONS' | 'FINANCE' | 'VIEWER',
  suffix: string,
  overrides: {
    status?: 'ACTIVE' | 'DISABLED';
    organizationId?: string;
    memberNumber?: number;
  } = {},
): { accountId: string; subjectId: string } {
  const subjectId = `r75-subject-${suffix}`;
  const accountId = `r75-account-${suffix}`;
  const organizationId = overrides.organizationId ?? sellerOrganizationId;
  const status = overrides.status ?? 'ACTIVE';
  const memberNumber = overrides.memberNumber ?? 9;
  database!.exec(`
    INSERT INTO customer_identity_subjects(id,subject_type,created_at)
    VALUES('${subjectId}','SELLER_ORG_MEMBER',1000);
    INSERT INTO customer_login_accounts(id,identity_subject_id,account_type,login_identifier_display,login_identifier_normalized,status,session_version,password_change_required,version,created_at,updated_at,activated_at,disabled_at,registration_source)
    VALUES('${accountId}','${subjectId}','SELLER_MEMBER','${accountId}','${accountId}','ACTIVE',1,0,1,1000,1000,1000,NULL,NULL);
    INSERT INTO seller_organization_members(id,identity_subject_id,organization_id,member_number,username_fallback,
      display_name,role,primary_owner,status,version,created_at,updated_at,activated_at,disabled_at)
    VALUES('r75-member-${suffix}','${subjectId}','${organizationId}',${memberNumber},'r75-member-${suffix}',
      '${role} 成员','${role}',0,'${status}',1,1000,1000,1000,NULL);
  `);
  return { accountId, subjectId };
}

/** A second ACTIVE seller organization for cross-organization concealment. */
function seedSecondSellerOrganization(): string {
  const organizationId = 'r75-second-org';
  database!.exec(`
    INSERT INTO seller_organizations(id,marketplace_code,seller_code,origin_channel_id,current_channel_id,seller_sequence,
      organization_name,status,version,created_at,updated_at,activated_at,disabled_at,next_member_number)
    VALUES('${organizationId}','AMAZON_JP','r75-org-0002','seller-channel-ido-mango','seller-channel-ido-mango',99002,
      '第二卖家组织','ACTIVE',1,1000,1000,1000,NULL,2)
    ON CONFLICT(id) DO NOTHING;
  `);
  return organizationId;
}

const base = (extra = '') =>
  `/api/staff/seller-settlements/${encodeURIComponent(sellerOrganizationId)}${extra}`;

// ---------------------------------------------------------------------------
// Bulk member fixture: clone the seeded payable N times through the full FK
// chain (reservation → evidence submission/version → formal order → snapshot
// → payable) so pagination/export run against realistic volumes.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/** Fresh, globally unique buyer numbers: YYYYMMDD + B + digits. */
function buyerCustomerNoFor(index: number): string {
  return `20260829B${String(7_000_000 + index)}`;
}

function readRow(table: string, where: string, param: string): Row {
  const row = database!.raw
    .prepare(`SELECT * FROM ${table} WHERE ${where}`)
    .get(param) as Row | undefined;
  if (!row) throw new Error(`fixture_row_missing:${table}`);
  return row;
}

function insertClone(table: string, template: Row, overrides: Row): void {
  const keys = Object.keys(template);
  // 注意不能用 ?? 合并：显式的 null 覆盖必须生效。
  const values = keys.map((key) => (Object.hasOwn(overrides, key) ? overrides[key] : template[key])) as Parameters<
    ReturnType<SqliteDatabase['raw']['prepare']>['run']
  >;
  database!.raw
    .prepare(
      `INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`,
    )
    .run(...values);
}

/** Clone a payable (with its order chain) count times; returns payable ids. */
function bulkSeedPayables(count: number, prefix: string): string[] {
  const payable = readRow('seller_payables', 'id=?', templatePayableId);
  const order = readRow('formal_orders', 'id=?', String(payable['formal_order_id']));
  const snapshot = readRow(
    'formal_order_financial_snapshots',
    'id=?',
    String(payable['financial_snapshot_id']),
  );
  const submission = readRow(
    'order_evidence_submissions',
    'id=?',
    String(order['order_evidence_submission_id']),
  );
  const version = readRow(
    'order_evidence_versions',
    'id=?',
    String(order['order_evidence_version_id']),
  );
  if (Number(version['version_no']) !== 1) {
    throw new Error('fixture_version_not_first');
  }
  const reservation = readRow(
    'product_reservations',
    'id=?',
    String(order['reservation_id']),
  );
  // product_reservations is UNIQUE (buyer_customer_id, product_id) and each
  // formal order needs its own reservation, so every clone carries a fresh
  // buyer identity + buyer row.
  const buyer = readRow(
    'buyer_customers',
    'id=?',
    String(reservation['buyer_customer_id']),
  );
  const ids: string[] = [];
  database!.raw.exec('BEGIN');
  try {
    for (let index = 1; index <= count; index += 1) {
      const pad = String(index).padStart(7, '0');
      const subjectId = `${prefix}-subject-${pad}`;
      const buyerId = `${prefix}-buyer-${pad}`;
      const reservationId = `${prefix}-res-${pad}`;
      const submissionId = `${prefix}-sub-${pad}`;
      const versionId = `${prefix}-ver-${pad}`;
      const orderId = `${prefix}-order-${pad}`;
      const snapshotId = `${prefix}-snap-${pad}`;
      const payableId = `${prefix}-pay-${pad}`;
      database!.raw
        .prepare(
          `INSERT INTO customer_identity_subjects(id,subject_type,created_at)
           VALUES(?,'BUYER_CUSTOMER',1000)`,
        )
        .run(subjectId);
      insertClone('buyer_customers', buyer, {
        id: buyerId,
        identity_subject_id: subjectId,
        buyer_customer_no: buyerCustomerNoFor(index),
        buyer_sequence: 9_000_000 + index,
      });
      // 按真实生命周期走触发器链：预约 APPROVED → 资料 PENDING(第1版) →
      // 版本插入 → 资料 UPDATE 为 VERIFIED → 正式订单/快照/应付。
      insertClone('product_reservations', reservation, {
        id: reservationId,
        buyer_customer_id: buyerId,
        status: 'APPROVED',
      });
      insertClone('order_evidence_submissions', submission, {
        id: submissionId,
        ...(submission['reservation_id'] === undefined ? {} : { reservation_id: reservationId }),
        ...(submission['buyer_customer_id'] === undefined ? {} : { buyer_customer_id: buyerId }),
        status: 'PENDING_VERIFICATION',
        current_version_no: 1,
        public_change_reason: null,
        verified_by_staff_id: null,
        verified_at: null,
        withdrawn_at: null,
        consumed_at: null,
      });
      // 走 HISTORICAL_EVIDENCE_CONTEXT 分支：克隆预约没有新指引，
      // 版本的指引快照列全部置空并登记对账标记。
      database!.raw
        .prepare(
          `INSERT INTO order_instruction_reconciliation_markers(
            id,reservation_id,disposition,metadata_json,created_at)
          VALUES(?,?,'HISTORICAL_EVIDENCE_CONTEXT','{}',1000)`,
        )
        .run(`${prefix}-marker-${pad}`, reservationId);
      insertClone('order_evidence_versions', version, {
        id: versionId,
        submission_id: submissionId,
        ...(version['reservation_id'] === null || version['reservation_id'] === undefined
          ? {}
          : { reservation_id: reservationId }),
        ...(version['buyer_customer_id'] === undefined ? {} : { buyer_customer_id: buyerId }),
        ...(version['submitted_by_buyer_id'] === undefined ? {} : { submitted_by_buyer_id: buyerId }),
        version_no: 1,
        ...(version['amazon_order_number_raw'] === undefined ? {} : {
          amazon_order_number_raw: `900-${pad}-${pad}`,
        }),
        ...(version['amazon_order_number_normalized'] === undefined ? {} : {
          amazon_order_number_normalized: `900-${pad}-${pad}`,
        }),
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
        ...(version['evidence_file_object_id'] === undefined
          && !('evidence_file_object_id' in version)
          ? {} : { evidence_file_object_id: null }),
      });
      database!.raw
        .prepare(
          `UPDATE order_evidence_submissions
           SET status='VERIFIED', current_version_no=1,
             verified_by_staff_id=?, verified_at=?
           WHERE id=?`,
        )
        .run(
          String(submission['verified_by_staff_id'] ?? 'r75-owner'),
          Number(submission['verified_at'] ?? 1000),
          submissionId,
        );
      insertClone('formal_orders', order, {
        id: orderId,
        order_evidence_submission_id: submissionId,
        order_evidence_version_id: versionId,
        reservation_id: reservationId,
        buyer_customer_id: buyerId,
        ...(order['buyer_customer_no'] === undefined ? {} : {
          buyer_customer_no: `${buyerCustomerNoFor(index)}`,
        }),
        ...(order['order_instruction_id'] === undefined
          && !('order_instruction_id' in order)
          ? {} : { order_instruction_id: null }),
        ...(order['order_instruction_version_id'] === undefined
          && !('order_instruction_version_id' in order)
          ? {} : { order_instruction_version_id: null }),
        amazon_order_number_normalized: `900-${pad}-${pad}`,
        ...(order['amazon_order_number_raw'] === undefined ? {} : {
          amazon_order_number_raw: `900-${pad}-${pad}`,
        }),
      });
      // 快照同样走 HISTORICAL_EVIDENCE_CONTEXT 分支：买家自付列置空；
      // 平台单号列与新订单克隆保持一致。
      insertClone('formal_order_financial_snapshots', snapshot, {
        id: snapshotId,
        formal_order_id: orderId,
        ...(Object.hasOwn(snapshot, 'platform_order_identifier')
          ? { platform_order_identifier: `900-${pad}-${pad}` } : {}),
        ...(Object.hasOwn(snapshot, 'buyer_customer_id')
          ? { buyer_customer_id: buyerId } : {}),
        ...(Object.hasOwn(snapshot, 'buyer_self_pay_bps')
          ? { buyer_self_pay_bps: null } : {}),
        ...(Object.hasOwn(snapshot, 'buyer_self_pay_jpy')
          ? { buyer_self_pay_jpy: null } : {}),
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
      ids.push(payableId);
    }
    database!.raw.exec('COMMIT');
  } catch (error) {
    database!.raw.exec('ROLLBACK');
    throw error;
  }
  return ids;
}

async function createConfirmedBatch(
  payableIds: string[],
  keyPrefix: string,
): Promise<{ batchId: string; version: number }> {
  const created = await staffRequest(base('/batches'), {
    method: 'POST',
    body: { reason: '7.5R 批量测试' },
    key: `${keyPrefix}-create`,
  });
  expect(created.status).toBe(201);
  const createdBody = await created.json() as {
    data: { batch: { batch_id: string } };
  };
  const batchId = createdBody.data.batch.batch_id;
  for (let offset = 0; offset < payableIds.length; offset += 100) {
    const slice = payableIds.slice(offset, offset + 100);
    const detail = await staffRequest(base(`/batches/${batchId}`));
    const detailBody = await detail.json() as {
      data: { batch: { version: number } };
    };
    const added = await staffRequest(base(`/batches/${batchId}/members`), {
      method: 'POST',
      body: {
        payable_ids: slice,
        expected_version: detailBody.data.batch.version,
        reason: '7.5R 批量加入',
      },
      key: `${keyPrefix}-add-${offset}`,
    });
    expect(added.status).toBe(201);
  }
  const beforeConfirm = await staffRequest(base(`/batches/${batchId}`));
  const beforeConfirmBody = await beforeConfirm.json() as {
    data: { batch: { version: number } };
  };
  const confirmed = await staffRequest(base(`/batches/${batchId}/confirm`), {
    method: 'POST',
    body: { expected_version: beforeConfirmBody.data.batch.version, reason: '7.5R 确认' },
    key: `${keyPrefix}-confirm`,
  });
  expect(confirmed.status).toBe(201);
  const confirmedBody = await confirmed.json() as {
    data: { batch: { version: number } };
  };
  return { batchId, version: confirmedBody.data.batch.version };
}

// ---------------------------------------------------------------------------

describe('settlement batch member keyset pagination (7.5R)', () => {
  it('pages all members through members_next_cursor without truncation', async () => {
    const payableIds = bulkSeedPayables(250, 'p75r-page');
    const { batchId } = await createConfirmedBatch(payableIds, 'page-key');

    const first = await staffRequest(base(`/batches/${batchId}`));
    expect(first.status).toBe(200);
    const firstBody = await first.json() as {
      data: { batch: { members: Array<{ member_id: string }>; members_next_cursor: string | null } };
    };
    expect(firstBody.data.batch.members).toHaveLength(200);
    expect(firstBody.data.batch.members_next_cursor).not.toBeNull();

    const second = await staffRequest(
      base(`/batches/${batchId}?members_cursor=${encodeURIComponent(firstBody.data.batch.members_next_cursor!)}`),
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json() as {
      data: { batch: { members: Array<{ member_id: string }>; members_next_cursor: string | null } };
    };
    expect(secondBody.data.batch.members).toHaveLength(50);
    expect(secondBody.data.batch.members_next_cursor).toBeNull();

    const all = [...firstBody.data.batch.members, ...secondBody.data.batch.members];
    expect(new Set(all.map((member) => member.member_id)).size).toBe(250);

    // A malformed cursor is a stable 400, never a wrong page.
    const badCursor = await staffRequest(base(`/batches/${batchId}?members_cursor=%%%`));
    expect(badCursor.status).toBe(400);
  });

  it('rejects out-of-range member limits', async () => {
    const payableIds = bulkSeedPayables(1, 'p75r-limit');
    const { batchId } = await createConfirmedBatch(payableIds, 'limit-key');
    const tooBig = await staffRequest(base(`/batches/${batchId}?members_limit=501`));
    expect(tooBig.status).toBe(400);
  });
});

describe('seller portal settlement batches (7.5R)', () => {
  it('filters DRAFT/CANCELLED in SQL, paginates with a real cursor and projects seller-safe DTOs', async () => {
    const payableIds = bulkSeedPayables(3, 'p75r-seller');
    // Three batches: confirmed, draft, cancelled.
    const confirmed = await createConfirmedBatch(payableIds.slice(0, 1), 'seller-key-a');
    const draftResponse = await staffRequest(base('/batches'), {
      method: 'POST',
      body: { reason: '草稿' },
      key: 'seller-key-b-create',
    });
    const draftId = ((await draftResponse.json()) as {
      data: { batch: { batch_id: string } };
    }).data.batch.batch_id;
    const cancelledTarget = await createConfirmedBatch(payableIds.slice(1, 2), 'seller-key-c');
    const cancelResponse = await staffRequest(
      base(`/batches/${cancelledTarget.batchId}/cancel`),
      {
        method: 'POST',
        body: { reason: '作废', expected_version: cancelledTarget.version },
        key: 'seller-key-c-cancel',
      },
    );
    expect(cancelResponse.status).toBe(201);

    const page = await sellerRequest('/api/seller-portal/settlement/batches?limit=2');
    expect(page.status).toBe(200);
    const pageBody = await page.json() as {
      data: {
        batches: Array<Record<string, unknown>>;
        next_cursor: string | null;
      };
    };
    // SQL-side filter: only the confirmed batch is visible at all.
    expect(pageBody.data.batches).toHaveLength(1);
    const batch = pageBody.data.batches[0]!;
    // Seller-safe DTO: exactly the seven public fields — no organization id,
    // version, created/cancelled metadata or cancel reason.
    expect(Object.keys(batch).sort()).toEqual([
      'batch_id',
      'confirmed_at',
      'frozen_payable_count',
      'frozen_total_cny_fen',
      'outstanding_amount_cny_fen',
      'paid_amount_cny_fen',
      'status',
    ]);
    expect(batch['batch_id']).toBe(confirmed.batchId);

    // Detail: members expose only seller-safe fields.
    const detail = await sellerRequest(
      `/api/seller-portal/settlement/batches/${encodeURIComponent(confirmed.batchId)}`,
    );
    expect(detail.status).toBe(200);
    const detailBody = await detail.json() as {
      data: { batch: { members: Array<Record<string, unknown>> } };
    };
    const member = detailBody.data.batch.members[0]!;
    expect(Object.keys(member).sort()).toEqual([
      'amazon_order_number',
      'frozen_amount_cny_fen',
      'outstanding_amount_cny_fen',
      'paid_amount_cny_fen',
      'payable_type',
    ]);
    expect(JSON.stringify(detailBody)).not.toContain('member_id');
    expect(JSON.stringify(detailBody)).not.toContain('payable_id');
    expect(JSON.stringify(detailBody)).not.toContain('formal_order_id');
    expect(JSON.stringify(detailBody)).not.toContain('seller_organization_id');

    // DRAFT and CANCELLED details stay concealed behind 404.
    const draftDetail = await sellerRequest(
      `/api/seller-portal/settlement/batches/${encodeURIComponent(draftId)}`,
    );
    expect(draftDetail.status).toBe(404);
    const cancelledDetail = await sellerRequest(
      `/api/seller-portal/settlement/batches/${encodeURIComponent(cancelledTarget.batchId)}`,
    );
    expect(cancelledDetail.status).toBe(404);
    // A foreign organization's batch id is concealed the same way.
    const foreignDetail = await sellerRequest(
      '/api/seller-portal/settlement/batches/batch-of-another-org',
    );
    expect(foreignDetail.status).toBe(404);
  });
});

describe('seller portal batch role matrix (7.5R-2)', () => {
  it('lets all four ACTIVE member roles read list and detail (200), with no write endpoints', async () => {
    const payableIds = bulkSeedPayables(2, 'p75r-roles');
    const { batchId } = await createConfirmedBatch(payableIds, 'roles-key');
    for (const role of ['OWNER', 'OPERATIONS', 'FINANCE', 'VIEWER'] as const) {
      const identity = seedSellerMember(role, `role-${role.toLowerCase()}`, {
        memberNumber: 11 + ['OWNER', 'OPERATIONS', 'FINANCE', 'VIEWER'].indexOf(role),
      });
      const list = await sellerRequest(
        '/api/seller-portal/settlement/batches',
        identity,
      );
      expect(list.status, `list ${role}`).toBe(200);
      const listBody = await list.json() as {
        data: { batches: Array<{ batch_id: string }>; next_cursor: string | null };
      };
      expect(listBody.data.batches.map((batch) => batch.batch_id))
        .toEqual([batchId]);

      const detail = await sellerRequest(
        `/api/seller-portal/settlement/batches/${encodeURIComponent(batchId)}`,
        identity,
      );
      expect(detail.status, `detail ${role}`).toBe(200);
      const detailBody = await detail.json() as {
        data: { batch: { batch_id: string; members: unknown[] } };
      };
      expect(detailBody.data.batch.batch_id).toBe(batchId);
      expect(detailBody.data.batch.members).toHaveLength(2);
    }
  }, 60_000);

  it('keeps non-members and DISABLED members out and conceals cross-organization batches', async () => {
    const payableIds = bulkSeedPayables(1, 'p75r-roles-x');
    const { batchId } = await createConfirmedBatch(payableIds, 'roles-x-key');
    const secondOrganizationId = seedSecondSellerOrganization();
    const foreign = seedSellerMember('OPERATIONS', 'role-foreign', {
      organizationId: secondOrganizationId,
      memberNumber: 1,
    });
    // A foreign member's own list is scoped to (the empty) second org…
    const foreignList = await sellerRequest(
      '/api/seller-portal/settlement/batches',
      foreign,
    );
    expect(foreignList.status).toBe(200);
    const foreignListBody = await foreignList.json() as {
      data: { batches: unknown[] };
    };
    expect(foreignListBody.data.batches).toEqual([]);
    // …and the first organization's batch detail stays concealed 404.
    const foreignDetail = await sellerRequest(
      `/api/seller-portal/settlement/batches/${encodeURIComponent(batchId)}`,
      foreign,
    );
    expect(foreignDetail.status).toBe(404);

    // A DISABLED membership fails closed on both routes.
    const disabled = seedSellerMember('VIEWER', 'role-disabled', {
      status: 'DISABLED',
    });
    const disabledList = await sellerRequest(
      '/api/seller-portal/settlement/batches',
      disabled,
    );
    expect(disabledList.status).toBe(401);
    const disabledDetail = await sellerRequest(
      `/api/seller-portal/settlement/batches/${encodeURIComponent(batchId)}`,
      disabled,
    );
    expect(disabledDetail.status).toBe(401);
  }, 60_000);
});

describe('settlement batch CSV export (7.5R)', () => {
  it('exports the complete membership (201 rows) with receipt headers and a single audit side effect', async () => {
    const payableIds = bulkSeedPayables(201, 'p75r-exp');
    const { batchId } = await createConfirmedBatch(payableIds, 'exp-key');

    const first = await staffRequest(base(`/batches/${batchId}/export`), {
      method: 'POST',
      body: {},
      key: 'exp-75r-key-000001',
    });
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toContain('text/csv');
    expect(first.headers.get('x-export-row-count')).toBe('201');
    const sha = first.headers.get('x-export-sha256');
    expect(sha).toMatch(/^[0-9a-f]{64}$/u);
    const csv = await first.text();
    const lines = csv.trimEnd().split('\n');
    expect(lines).toHaveLength(202);
    expect(lines[0]).toBe(
      'amazon_order_number,payable_type,frozen_amount_cny_fen,paid_amount_cny_fen,'
        + 'outstanding_amount_cny_fen,confirmed_at,due_at',
    );
    // Stable keyset order: sorted by payable_type then order number.
    const numbers = lines.slice(1).map((line) => line.split(',')[0]);
    const sorted = [...numbers].sort();
    expect(numbers).toEqual(sorted);
    expect(new Set(numbers).size).toBe(201);

    // Replay: same key returns the receipt JSON, not a second file.
    const replay = await staffRequest(base(`/batches/${batchId}/export`), {
      method: 'POST',
      body: {},
      key: 'exp-75r-key-000001',
    });
    expect(replay.status).toBe(200);
    expect(replay.headers.get('content-type')).toContain('application/json');
    const replayBody = await replay.json() as {
      data: { receipt: { row_count: number; sha256: string; replayed: boolean } };
    };
    expect(replayBody.data.receipt).toMatchObject({
      row_count: 201,
      sha256: sha,
      replayed: true,
    });

    // Exactly one export side effect across both requests.
    const events = database!.raw.prepare(
      `SELECT COUNT(*) c FROM seller_settlement_batch_events
       WHERE batch_id=? AND event_type='BATCH_EXPORTED'`,
    ).get(batchId) as { c: number };
    expect(events.c).toBe(1);
    const audits = database!.raw.prepare(
      `SELECT COUNT(*) c FROM audit_events
       WHERE aggregate_type='SELLER_SETTLEMENT_BATCH' AND aggregate_id=?
         AND event_type='SELLER_SETTLEMENT_BATCH_EXPORTED'`,
    ).get(batchId) as { c: number };
    expect(audits.c).toBe(1);

    // Same key with a different payload is a stable 409.
    const mismatch = await staffRequest(base(`/batches/${batchId}/export`), {
      method: 'POST',
      body: { expected_version: 999 },
      key: 'exp-75r-key-000001',
    });
    expect(mismatch.status).toBe(409);

    // expected_version happy path still exports (fresh key).
    const detail = await staffRequest(base(`/batches/${batchId}`));
    const detailBody = await detail.json() as { data: { batch: { version: number } } };
    const pinned = await staffRequest(base(`/batches/${batchId}/export`), {
      method: 'POST',
      body: { expected_version: detailBody.data.batch.version },
      key: 'exp-75r-key-000002',
    });
    expect(pinned.status).toBe(200);
    // A stale expected_version under a fresh key is a version conflict.
    const stale = await staffRequest(base(`/batches/${batchId}/export`), {
      method: 'POST',
      body: { expected_version: 1 },
      key: 'exp-75r-key-000003',
    });
    expect(stale.status).toBe(409);
  });

  it('answers 409 EXPORT_TOO_LARGE before sending any byte when rows exceed the ceiling', async () => {
    const payableIds = bulkSeedPayables(6, 'p75r-cap');
    const { batchId } = await createConfirmedBatch(payableIds, 'cap-key');
    await expect(exportBatchCsv(
      database!,
      { batchId, expectedVersion: null, limits: { rows: 5, bytes: 1024 * 1024 } },
      { actor: actor(), idempotencyKey: 'cap-75r-key-0001', now: AT },
    )).rejects.toMatchObject({ code: 'EXPORT_TOO_LARGE', status: 409 });
    // The failure consumed the idempotency key; a retry under a fresh key
    // with the real ceiling succeeds.
    const retry = await exportBatchCsv(
      database!,
      { batchId, expectedVersion: null },
      { actor: actor(), idempotencyKey: 'cap-75r-key-0002', now: AT + 1 },
    );
    expect(retry.kind).toBe('FILE');
    if (retry.kind === 'FILE') expect(retry.receipt.row_count).toBe(6);
  }, 30_000);

  it('rejects a real 5001-member batch with EXPORT_TOO_LARGE', async () => {
    const payableIds = bulkSeedPayables(5_001, 'p75r-full');
    const { batchId } = await createConfirmedBatch(payableIds, 'full-key');
    const response = await staffRequest(base(`/batches/${batchId}/export`), {
      method: 'POST',
      body: {},
      key: 'full-75r-key-00001',
    });
    expect(response.status).toBe(409);
    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe('EXPORT_TOO_LARGE');
    // No file bytes and no export side effect.
    const events = database!.raw.prepare(
      `SELECT COUNT(*) c FROM seller_settlement_batch_events
       WHERE batch_id=? AND event_type='BATCH_EXPORTED'`,
    ).get(batchId) as { c: number };
    expect(events.c).toBe(0);
  }, 120_000);

  it('enforces the byte ceiling during enumeration', async () => {
    const payableIds = bulkSeedPayables(3, 'p75r-byte');
    const { batchId } = await createConfirmedBatch(payableIds, 'byte-key');
    await expect(exportBatchCsv(
      database!,
      { batchId, expectedVersion: null, limits: { rows: 100, bytes: 10 } },
      { actor: actor(), idempotencyKey: 'byte-75r-key-001', now: AT },
    )).rejects.toMatchObject({ code: 'EXPORT_TOO_LARGE', status: 409 });
  });

  it('fails closed when the batch is cancelled after the first export', async () => {
    const payableIds = bulkSeedPayables(2, 'p75r-cancel');
    const { batchId, version } = await createConfirmedBatch(payableIds, 'cancel-key');
    const first = await staffRequest(base(`/batches/${batchId}/export`), {
      method: 'POST',
      body: {},
      key: 'cancel-75r-key-001',
    });
    expect(first.status).toBe(200);
    // The first export body is genuinely consumed and verified: the client
    // receives the full membership and the bytes hash to the header SHA.
    const firstText = await first.text();
    const firstLines = firstText.trimEnd().split('\n');
    expect(firstLines).toHaveLength(3);
    expect(new Set(firstLines.slice(1).map((line) => line.split(',')[0])).size).toBe(2);
    expect(await sha256Hex(new TextEncoder().encode(firstText)))
      .toBe(first.headers.get('x-export-sha256'));
    const cancelled = await staffRequest(base(`/batches/${batchId}/cancel`), {
      method: 'POST',
      body: { reason: '导出后作废', expected_version: version },
      key: 'cancel-75r-key-002',
    });
    expect(cancelled.status).toBe(201);
    const replay = await staffRequest(base(`/batches/${batchId}/export`), {
      method: 'POST',
      body: {},
      key: 'cancel-75r-key-001',
    });
    expect(replay.status).toBe(409);
  });
});

describe('settlement batch CSV true streaming (7.5R-2)', () => {
  /**
   * Count export member-page queries (the as-of SELECT is the only SQL
   * touching `payable.due_at`) so the tests can prove WHEN pages are read:
   * once per page in the preflight, then again lazily per pull.
   */
  function countingDb(
    db: SqliteDatabase,
    counter: { pageQueries: number },
  ): SqliteDatabase {
    return new Proxy(db, {
      get(target, property) {
        if (property === 'prepare') {
          return (sql: string) => {
            if (sql.includes('payable.due_at')) counter.pageQueries += 1;
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, property, target);
        // Bind to the real instance: batch() rejects statements whose
        // database identity differs from the instance it runs on.
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
  }

  async function staffExportRequest(
    batchId: string,
    key: string,
    db: SqliteDatabase,
  ): Promise<Response> {
    const app = new Hono<any>();
    app.use('*', async (context, next) => {
      context.set('requestId', `r75-${crypto.randomUUID()}`);
      context.set('staffAuthorization', actor('owner'));
      await next();
    });
    registerStaffBatchRoutes(app);
    return app.request(`${ORIGIN}${base(`/batches/${batchId}/export`)}`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': key,
      },
    }, { DB: db });
  }

  /** Consume the body chunk by chunk; return chunks + the query counter. */
  async function readChunkByChunk(
    response: Response,
    counter: { pageQueries: number },
    expectedReads: number,
  ): Promise<Uint8Array[]> {
    const chunks: Uint8Array[] = [];
    const reader = response.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      // Assert the laziness invariant after every read: pages are fetched
      // during consumption, never buffered ahead of the consumer.
      expect(counter.pageQueries).toBeLessThanOrEqual(expectedReads);
    }
    return chunks;
  }

  function csvText(chunks: Uint8Array[]): string {
    let text = '';
    for (const chunk of chunks) text += new TextDecoder().decode(chunk);
    return text;
  }

  async function drainStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return chunks;
  }

  it('streams 201 rows lazily (header first, one page per pull) and the client bytes hash to the header SHA', async () => {
    const payableIds = bulkSeedPayables(201, 'p75r-true-stream');
    const { batchId } = await createConfirmedBatch(payableIds, 'true-stream-key');
    const counter = { pageQueries: 0 };
    const response = await staffExportRequest(
      batchId, 'true-stream-key-001', countingDb(database!, counter),
    );
    expect(response.status).toBe(200);
    // Preflight walked the single page; pass 2 has not queried anything yet —
    // proving the CSV is not generated before the Response is handed out.
    expect(counter.pageQueries).toBe(1);

    const reader = response.body!.getReader();
    const header = await reader.read();
    expect(header.done).toBe(false);
    expect(new TextDecoder().decode(header.value)).toBe(exportHeader());

    const page = await reader.read();
    expect(page.done).toBe(false);
    // The stream pass needed exactly one page query for the 201 rows.
    expect(counter.pageQueries).toBe(2);

    const end = await reader.read();
    expect(end.done).toBe(true);
    // No speculative reads beyond the boundary page check happened.
    expect(counter.pageQueries).toBe(2);

    const text = new TextDecoder().decode(header.value)
      + new TextDecoder().decode(page.value);
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(202);
    const numbers = lines.slice(1).map((line) => line.split(',')[0]);
    expect(new Set(numbers).size).toBe(201);
    const digest = await sha256Hex(new TextEncoder().encode(text));
    expect(digest).toBe(response.headers.get('x-export-sha256'));
  }, 120_000);

  it('walks the exact 500-row full page boundary in both passes without duplicates', async () => {
    const payableIds = bulkSeedPayables(500, 'p75r-stream-500');
    const { batchId } = await createConfirmedBatch(payableIds, 'stream-500-key');
    const counter = { pageQueries: 0 };
    const response = await staffExportRequest(
      batchId, 'stream-500-key-001', countingDb(database!, counter),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-export-row-count')).toBe('500');
    // Preflight: one full page + one empty boundary page.
    expect(counter.pageQueries).toBe(2);

    const chunks = await readChunkByChunk(response, counter, 4);
    // Stream pass: full page + boundary check page.
    expect(counter.pageQueries).toBe(4);

    const text = csvText(chunks);
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(501);
    const numbers = lines.slice(1).map((line) => line.split(',')[0]);
    expect(new Set(numbers).size).toBe(500);
    expect([...numbers].sort()).toEqual(numbers);
    const digest = await sha256Hex(new TextEncoder().encode(text));
    expect(digest).toBe(response.headers.get('x-export-sha256'));
  }, 180_000);

  it('streams 1000 rows completely with a client-verified SHA and a stable replay receipt', async () => {
    const payableIds = bulkSeedPayables(1_000, 'p75r-stream-1000');
    const { batchId } = await createConfirmedBatch(payableIds, 'stream-1000-key');
    const response = await staffExportRequest(
      batchId, 'stream-1000-key-001', database!,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-export-row-count')).toBe('1000');
    const text = await response.text();
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(1_001);
    const numbers = lines.slice(1).map((line) => line.split(',')[0]);
    expect(new Set(numbers).size).toBe(1_000);
    const digest = await sha256Hex(new TextEncoder().encode(text));
    expect(digest).toBe(response.headers.get('x-export-sha256'));

    const replay = await staffRequest(base(`/batches/${batchId}/export`), {
      method: 'POST',
      body: {},
      key: 'stream-1000-key-001',
    });
    expect(replay.status).toBe(200);
    const replayBody = await replay.json() as {
      data: { receipt: { row_count: number; sha256: string; exported_at: number; export_as_of: number; replayed: boolean } };
    };
    expect(replayBody.data.receipt).toMatchObject({
      row_count: 1_000,
      sha256: digest,
      replayed: true,
    });
    expect(replayBody.data.receipt.export_as_of)
      .toBeLessThanOrEqual(replayBody.data.receipt.exported_at);
  }, 240_000);

  it('freezes the payment-fact watermark: allocations and reversals with created_at == export_as_of change neither bytes nor SHA', async () => {
    const payableIds = bulkSeedPayables(3, 'p75r-asof');
    const { batchId } = await createConfirmedBatch(payableIds, 'asof-key');
    const targetPayable = payableIds[0]!;
    const balance = await database!
      .prepare(
        `SELECT frozen_amount_cny_fen FROM seller_settlement_batch_members
        WHERE batch_id=? AND payable_id=? AND active=1`,
      )
      .bind(batchId, targetPayable)
      .first<{ frozen_amount_cny_fen: number }>();

    // A REAL payment exists before the export: allocated at AT-1000.
    const preExisting = AT - 1000;
    database!.exec(`
      INSERT INTO seller_payments(id,seller_organization_id,amount_cny_fen,paid_at,recorded_at,
        recorded_by_staff_id,version,created_at,updated_at)
      VALUES('p75r-pre-payment','${sellerOrganizationId}',${balance!.frozen_amount_cny_fen},${preExisting},${preExisting},
        'r75-owner',1,${preExisting},${preExisting});
      INSERT INTO seller_payment_allocations(id,payment_id,payable_id,seller_organization_id,
        amount_cny_fen,allocated_by_staff_id,allocated_at,created_at)
      VALUES('p75r-pre-alloc','p75r-pre-payment','${targetPayable}','${sellerOrganizationId}',
        ${balance!.frozen_amount_cny_fen},'r75-owner',${preExisting},${preExisting});
    `);

    // Pass 1 + side effects: export_as_of is the exclusive watermark
    // max(created_at)+1 over the batch's frozen members (here AT-999), NOT
    // the command instant. The stream is not consumed yet.
    const outcome = await exportBatchCsv(
      database!,
      { batchId, expectedVersion: null },
      { actor: actor(), idempotencyKey: 'asof-key-001', now: AT },
    );
    expect(outcome.kind).toBe('FILE');
    if (outcome.kind !== 'FILE') return;
    expect(outcome.receipt.export_as_of).toBe(preExisting + 1);

    // Same-millisecond facts committed after the preflight: one new
    // allocation and one reversal, both with created_at == export_as_of.
    const sameMilli = preExisting + 1;
    database!.exec(`
      INSERT INTO seller_payments(id,seller_organization_id,amount_cny_fen,paid_at,recorded_at,
        recorded_by_staff_id,version,created_at,updated_at)
      VALUES('p75r-samemilli-payment','${sellerOrganizationId}',${balance!.frozen_amount_cny_fen},${sameMilli},${sameMilli},
        'r75-owner',1,${sameMilli},${sameMilli});
      INSERT INTO seller_payment_allocations(id,payment_id,payable_id,seller_organization_id,
        amount_cny_fen,allocated_by_staff_id,allocated_at,created_at)
      VALUES('p75r-samemilli-alloc','p75r-samemilli-payment','${payableIds[1]!}','${sellerOrganizationId}',
        ${balance!.frozen_amount_cny_fen},'r75-owner',${sameMilli},${sameMilli});
      INSERT INTO seller_payment_allocation_reversals(id,allocation_id,payment_id,payable_id,
        seller_organization_id,amount_cny_fen,reason,reversed_by_staff_id,reversed_at,idempotency_key,created_at)
      VALUES('p75r-samemilli-rev','p75r-pre-alloc','p75r-pre-payment','${targetPayable}',
        '${sellerOrganizationId}',${balance!.frozen_amount_cny_fen},'同毫秒冲销','r75-owner',${sameMilli},'asof-rev-0001',${sameMilli});
    `);

    // Pass 2 consumes the stream: the same-millisecond allocation must not
    // raise member 2's paid amount and the same-millisecond reversal must
    // not zero member 1 — both stay at the preflight values.
    const chunks: Uint8Array[] = [];
    const reader = outcome.createStream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const text = csvText(chunks);
    const digest = await sha256Hex(new TextEncoder().encode(text));
    expect(digest).toBe(outcome.receipt.sha256);
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(4);
    const rows = new Map(lines.slice(1).map((line) => [line.split(',')[0]!, line.split(',')]));
    expect(rows.get('900-0000001-0000001')?.[3]).toBe(String(balance!.frozen_amount_cny_fen));
    expect(rows.get('900-0000001-0000001')?.[4]).toBe('0');
    expect(rows.get('900-0000002-0000002')?.[3]).toBe('0');
    // A strictly later payment is excluded as well.
    const late = AT + 60_000;
    database!.exec(`
      INSERT INTO seller_payments(id,seller_organization_id,amount_cny_fen,paid_at,recorded_at,
        recorded_by_staff_id,version,created_at,updated_at)
      VALUES('p75r-late-payment','${sellerOrganizationId}',${balance!.frozen_amount_cny_fen},${late},${late},
        'r75-owner',1,${late},${late});
      INSERT INTO seller_payment_allocations(id,payment_id,payable_id,seller_organization_id,
        amount_cny_fen,allocated_by_staff_id,allocated_at,created_at)
      VALUES('p75r-late-alloc','p75r-late-payment','${payableIds[2]!}','${sellerOrganizationId}',
        ${balance!.frozen_amount_cny_fen},'r75-owner',${late},${late});
    `);
    const lateText = csvText(await drainStream(outcome.createStream()));
    expect(await sha256Hex(new TextEncoder().encode(lateText))).toBe(digest);

    // A same-key replay keeps returning the ORIGINAL frozen receipt.
    const replay = await exportBatchCsv(
      database!,
      { batchId, expectedVersion: null },
      { actor: actor(), idempotencyKey: 'asof-key-001', now: AT + 120_000 },
    );
    expect(replay.kind).toBe('REPLAY');
    if (replay.kind === 'REPLAY') {
      expect(replay.receipt.sha256).toBe(digest);
      expect(replay.receipt.export_as_of).toBe(preExisting + 1);
    }
  }, 120_000);

  it('keeps export_as_of at the empty watermark when the batch has no payment facts', async () => {
    const payableIds = bulkSeedPayables(1, 'p75r-asof-empty');
    const { batchId } = await createConfirmedBatch(payableIds, 'asof-empty-key');
    const outcome = await exportBatchCsv(
      database!,
      { batchId, expectedVersion: null },
      { actor: actor(), idempotencyKey: 'asof-empty-key-001', now: AT },
    );
    expect(outcome.kind).toBe('FILE');
    if (outcome.kind !== 'FILE') return;
    // No facts at all: watermark −1, exclusive bound 0 — an empty fact set
    // that cannot grow inside either pass (created_at CHECK >= 0).
    expect(outcome.receipt.export_as_of).toBe(0);
    const text = csvText(await drainStream(outcome.createStream()));
    for (const line of text.trimEnd().split('\n').slice(1)) {
      expect(line.split(',')[3]).toBe('0');
    }
  }, 60_000);

  it('keeps the late-payment invariance at the route level (stream consumed after a later insert)', async () => {
    const payableIds = bulkSeedPayables(2, 'p75r-asof-route');
    const { batchId } = await createConfirmedBatch(payableIds, 'asof-route-key');
    const response = await staffExportRequest(
      batchId, 'asof-route-key-001', database!,
    );
    expect(response.status).toBe(200);
    const headerSha = response.headers.get('x-export-sha256');

    // A payment recorded after the route's export_as_of, before consumption.
    const late = Date.now() + 60_000;
    const payableId = payableIds[0]!;
    const frozen = await database!
      .prepare(
        `SELECT frozen_amount_cny_fen FROM seller_settlement_batch_members
        WHERE batch_id=? AND payable_id=? AND active=1`,
      )
      .bind(batchId, payableId)
      .first<{ frozen_amount_cny_fen: number }>();
    database!.exec(`
      INSERT INTO seller_payments(id,seller_organization_id,amount_cny_fen,paid_at,recorded_at,
        recorded_by_staff_id,version,created_at,updated_at)
      VALUES('p75r-route-late-payment','${sellerOrganizationId}',${frozen!.frozen_amount_cny_fen},${late},${late},
        'r75-owner',1,${late},${late});
      INSERT INTO seller_payment_allocations(id,payment_id,payable_id,seller_organization_id,
        amount_cny_fen,allocated_by_staff_id,allocated_at,created_at)
      VALUES('p75r-route-late-alloc','p75r-route-late-payment','${payableId}','${sellerOrganizationId}',
        ${frozen!.frozen_amount_cny_fen},'r75-owner',${late},${late});
    `);

    const text = await response.text();
    const digest = await sha256Hex(new TextEncoder().encode(text));
    expect(digest).toBe(headerSha);
    for (const line of text.trimEnd().split('\n').slice(1)) {
      expect(line.split(',')[3]).toBe('0');
    }
  }, 120_000);

  it('completes the untouched export body after the batch is cancelled between the passes', async () => {
    const payableIds = bulkSeedPayables(201, 'p75r-cancel-mid');
    const { batchId, version } = await createConfirmedBatch(payableIds, 'cancel-mid-key');
    const response = await staffExportRequest(
      batchId, 'cancel-mid-key-001', database!,
    );
    expect(response.status).toBe(200);
    const headerSha = response.headers.get('x-export-sha256');
    const headerRows = response.headers.get('x-export-row-count');
    expect(headerRows).toBe('201');
    // The body is deliberately NOT read yet. Cancel the batch now: the
    // cancellation releases every member (active=0) between the passes.
    const cancelled = await staffRequest(base(`/batches/${batchId}/cancel`), {
      method: 'POST',
      body: { reason: '发送前作废', expected_version: version },
      key: 'cancel-mid-key-002',
    });
    expect(cancelled.status).toBe(201);
    // Only now consume the original export body: the confirmation-time
    // frozen member snapshot keeps every row, byte-identical to the
    // preflight.
    const chunks = await drainStream(response.body!);
    const text = csvText(chunks);
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(202);
    const numbers = lines.slice(1).map((line) => line.split(',')[0]);
    expect(new Set(numbers).size).toBe(201);
    expect(await sha256Hex(new TextEncoder().encode(text))).toBe(headerSha);
    // Replay of the same key still fails closed on the cancelled batch.
    const replay = await staffRequest(base(`/batches/${batchId}/export`), {
      method: 'POST',
      body: {},
      key: 'cancel-mid-key-001',
    });
    expect(replay.status).toBe(409);
    // A fresh export on the cancelled batch is also refused.
    const fresh = await staffRequest(base(`/batches/${batchId}/export`), {
      method: 'POST',
      body: {},
      key: 'cancel-mid-key-003',
    });
    expect(fresh.status).toBe(409);
  }, 120_000);

  it('keeps the remaining pages complete when a 1000-row export is cancelled after the first page', async () => {
    const payableIds = bulkSeedPayables(1_000, 'p75r-cancel-1000');
    const { batchId } = await createConfirmedBatch(payableIds, 'cancel-1000-key');
    const response = await staffExportRequest(
      batchId, 'cancel-1000-key-001', database!,
    );
    expect(response.status).toBe(200);
    const headerSha = response.headers.get('x-export-sha256');
    const reader = response.body!.getReader();
    // Read the header chunk and the first full page (500 rows).
    const header = await reader.read();
    expect(header.done).toBe(false);
    const page1 = await reader.read();
    expect(page1.done).toBe(false);
    expect(new TextDecoder().decode(page1.value).trimEnd().split('\n')).toHaveLength(500);
    // Cancel while the consumer is mid-stream.
    const detail = await staffRequest(base(`/batches/${batchId}`));
    const detailBody = await detail.json() as { data: { batch: { version: number } } };
    const cancelled = await staffRequest(base(`/batches/${batchId}/cancel`), {
      method: 'POST',
      body: { reason: '发送中作废', expected_version: detailBody.data.batch.version },
      key: 'cancel-1000-key-002',
    });
    expect(cancelled.status).toBe(201);
    // Drain the rest: the second page still arrives complete.
    const rest: Uint8Array[] = [header.value!, page1.value!];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest.push(value);
    }
    const text = csvText(rest);
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(1_001);
    const numbers = lines.slice(1).map((line) => line.split(',')[0]);
    expect(new Set(numbers).size).toBe(1_000);
    expect(await sha256Hex(new TextEncoder().encode(text))).toBe(headerSha);
  }, 240_000);
});