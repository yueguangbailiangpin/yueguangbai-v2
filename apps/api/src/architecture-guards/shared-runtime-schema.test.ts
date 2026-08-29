import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import {
  buyerServiceChannelsResponseSchema,
  safeFileReferenceSchema,
  sellerPortalSettlementBatchDetailResponseSchema,
  sellerPortalSettlementBatchPageSchema,
} from '@ygb/contracts';
import { z } from 'zod';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { seedConfirmedColdArchiveOrder } from '../../test-support/cold-archive-fixture';
import { issueCustomerSession } from '../customer-auth/authenticate-customer';
import { customerSessionMiddleware } from '../middleware/customer-auth';
import { registerSellerBatchRoutes, registerStaffBatchRoutes } from '../seller-settlements/batch-routes';
import {
  registerBuyerServiceChannelRoutes,
  registerStaffServiceChannelRoutes,
} from '../company-service-channels/routes';

/**
 * Stage 7.5R-2 shared runtime contract test. Real migrated D1, real Hono
 * routes, real customer sessions, real HTTP responses — parsed with the
 * exact strict schemas the production frontend pages parse with (from
 * `@ygb/contracts`). A backend response the frontend would reject is a
 * contract failure here, and vice versa. Field-name comparison is not
 * enough: the assertions below also pin extra/missing field rejection.
 */

const ORIGIN = 'https://api.example.test';
const SESSION_SECRET = 'stage75r2-contract-test-session-secret-32b';

/** Mirrors apps/web/src/api/envelopes.ts successEnvelope. */
function frontendEnvelope<T extends z.ZodType>(data: T) {
  return z.object({
    data,
    meta: z.object({ request_id: z.string().min(1).max(200) }).strict(),
  }).strict();
}

let database: SqliteDatabase | null = null;
let sellerOrganizationId = '';

function seedSellerMember(
  role: 'OWNER' | 'OPERATIONS' | 'FINANCE' | 'VIEWER',
  suffix: string,
  memberNumber: number,
): { accountId: string; subjectId: string } {
  const subjectId = `ct-subject-${suffix}`;
  const accountId = `ct-account-${suffix}`;
  database!.exec(`
    INSERT INTO customer_identity_subjects(id,subject_type,created_at)
    VALUES('${subjectId}','SELLER_ORG_MEMBER',1000);
    INSERT INTO customer_login_accounts(id,identity_subject_id,account_type,login_identifier_display,login_identifier_normalized,status,session_version,password_change_required,version,created_at,updated_at,activated_at,disabled_at,registration_source)
    VALUES('${accountId}','${subjectId}','SELLER_MEMBER','${accountId}','${accountId}','ACTIVE',1,0,1,1000,1000,1000,NULL,NULL);
    INSERT INTO seller_organization_members(id,identity_subject_id,organization_id,member_number,username_fallback,
      display_name,role,primary_owner,status,version,created_at,updated_at,activated_at,disabled_at)
    VALUES('ct-member-${suffix}','${subjectId}','${sellerOrganizationId}',${memberNumber},'ct-member-${suffix}',
      '${role} 成员','${role}',0,'ACTIVE',1,1000,1000,1000,NULL);
  `);
  return { accountId, subjectId };
}

beforeEach(async () => {
  database = createMigratedTestDatabase();
  const seeded = await seedConfirmedColdArchiveOrder(database, 'ct-settlement');
  sellerOrganizationId = seeded.sellerOrganizationId;
});

afterEach(() => {
  database?.close();
  database = null;
});

async function sellerGet(
  path: string,
  identity: { accountId: string; subjectId: string },
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

/** One confirmed batch with a single member, through the staff routes. */
async function seedConfirmedBatch(): Promise<string> {
  const row = await database!
    .prepare(
      `SELECT payable_id FROM seller_payable_balances
      WHERE seller_organization_id=? AND outstanding_amount_cny_fen>0 LIMIT 1`,
    )
    .bind(sellerOrganizationId)
    .first<{ payable_id: string }>();
  const payableId = row!.payable_id;
  const app = new Hono<any>();
  app.use('*', async (context, next) => {
    context.set('requestId', `ct-${crypto.randomUUID()}`);
    context.set('staffAuthorization', {
      staffId: 'ct-staff',
      displayName: 'ct',
      staffStatus: 'ACTIVE',
      authorizationVersion: 1,
      roles: new Set(['owner']),
      permissions: new Set(['SELLER_SETTLEMENT_VIEW', 'SELLER_SETTLEMENT_RECORD']),
      memberTeamIds: [],
      leaderTeamIds: [],
    });
    await next();
  });
  registerStaffBatchRoutes(app);
  database!.exec(`
    INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at)
    VALUES('ct-staff','合同测试员工','ACTIVE',1,1,1000,1000,NULL)
      ON CONFLICT(id) DO NOTHING;
    INSERT INTO staff_role_assignments(id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at)
    SELECT 'ct-staff-role','ct-staff','owner','ACTIVE',NULL,1000,NULL,1000,1000
    WHERE NOT EXISTS (SELECT 1 FROM staff_role_assignments WHERE staff_id='ct-staff');
  `);
  const base = `/api/staff/seller-settlements/${encodeURIComponent(sellerOrganizationId)}/batches`;
  const created = await app.request(`${ORIGIN}${base}`, {
    method: 'POST',
    body: JSON.stringify({ reason: '合同测试' }),
    headers: { 'content-type': 'application/json', 'Idempotency-Key': 'ct-create-1' },
  }, { DB: database! });
  if (created.status !== 201) {
    throw new Error(`ct create failed: ${created.status} ${JSON.stringify(await created.json())}`);
  }
  const createdBody = await created.json() as { data: { batch: { batch_id: string; version: number } } };
  const batchId = createdBody.data.batch.batch_id;
  const added = await app.request(`${ORIGIN}${base}/${batchId}/members`, {
    method: 'POST',
    body: JSON.stringify({ payable_ids: [payableId], expected_version: 1, reason: '合同测试' }),
    headers: { 'content-type': 'application/json', 'Idempotency-Key': 'ct-add-1' },
  }, { DB: database! });
  const addedBody = await added.json() as { data: { batch: { version: number } } };
  const confirmed = await app.request(`${ORIGIN}${base}/${batchId}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ expected_version: addedBody.data.batch.version, reason: '合同测试' }),
    headers: { 'content-type': 'application/json', 'Idempotency-Key': 'ct-confirm-1' },
  }, { DB: database! });
  expect(confirmed.status).toBe(201);
  return batchId;
}

describe('real HTTP responses parse with the shared frontend schemas', () => {
  it('seller batch list and detail (all four roles) satisfy the strict contracts', async () => {
    const batchId = await seedConfirmedBatch();
    for (const role of ['OWNER', 'OPERATIONS', 'FINANCE', 'VIEWER'] as const) {
      const identity = seedSellerMember(
        role,
        `role-${role.toLowerCase()}`,
        11 + ['OWNER', 'OPERATIONS', 'FINANCE', 'VIEWER'].indexOf(role),
      );
      const list = await sellerGet('/api/seller-portal/settlement/batches', identity);
      expect(list.status, `list ${role}`).toBe(200);
      const listJson = await list.json() as unknown;
      const listParsed = frontendEnvelope(sellerPortalSettlementBatchPageSchema)
        .safeParse(listJson);
      expect(listParsed.success, `list envelope ${role}: ${JSON.stringify(listParsed.success ? [] : listParsed.error.issues)}`).toBe(true);

      const detail = await sellerGet(
        `/api/seller-portal/settlement/batches/${encodeURIComponent(batchId)}`,
        identity,
      );
      expect(detail.status, `detail ${role}`).toBe(200);
      const detailJson = await detail.json() as unknown;
      const detailParsed = frontendEnvelope(sellerPortalSettlementBatchDetailResponseSchema)
        .safeParse(detailJson);
      expect(detailParsed.success, `detail envelope ${role}: ${JSON.stringify(detailParsed.success ? [] : detailParsed.error.issues)}`).toBe(true);
    }
  }, 60_000);

  it('the buyer channel payload (controlled QR chain) satisfies the strict contract', async () => {
    // Staff owner + a verified SERVICE_CHANNEL_QR / BUYER_VISIBLE file.
    database!.exec(`
      INSERT INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at)
      VALUES('ct-channel-owner','渠道管理员','ACTIVE',1,1,1000,1000,NULL)
        ON CONFLICT(id) DO NOTHING;
      INSERT INTO staff_role_assignments(id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at)
      SELECT 'ct-channel-owner-role','ct-channel-owner','owner','ACTIVE',NULL,1000,NULL,1000,1000
      WHERE NOT EXISTS (SELECT 1 FROM staff_role_assignments WHERE staff_id='ct-channel-owner');
      INSERT INTO customer_identity_subjects(id,subject_type,created_at)
      VALUES('ct-buyer-subject','BUYER_CUSTOMER',1000);
      INSERT INTO customer_login_accounts(id,identity_subject_id,account_type,login_identifier_display,login_identifier_normalized,status,session_version,password_change_required,version,created_at,updated_at,activated_at,disabled_at,registration_source)
      VALUES('ct-buyer-account','ct-buyer-subject','BUYER','ct-buyer','ct-buyer','ACTIVE',1,0,1,1000,1000,1000,NULL,NULL);
      INSERT OR IGNORE INTO buyer_channels(id,code,name,status,next_sequence,version,created_at,updated_at,disabled_at)
      VALUES('buyer-channel-wechat-b','B','买家微信对接渠道 B','ACTIVE',1,1,1000,1000,NULL);
      INSERT INTO buyer_customers(id,identity_subject_id,marketplace_code,buyer_channel_id,buyer_customer_no,buyer_sequence,
        display_name,access_status,identity_review_status,version,created_at,updated_at,activated_at,disabled_at)
      VALUES('ct-buyer','ct-buyer-subject','AMAZON_JP','buyer-channel-wechat-b','20260829B80001',1,
        '合同测试买家','ACTIVE','CLEAR',1,1000,1000,1000,NULL);
      INSERT INTO file_upload_intents(id,owner_actor_type,owner_actor_id,purpose,visibility,status,
        requested_file_count,manifest_hash,version,expires_at,failure_code,created_at,updated_at,completed_at)
      VALUES('ct-qr-intent','STAFF','ct-channel-owner','SERVICE_CHANNEL_QR','BUYER_VISIBLE','ISSUED',1,
        '${'a'.repeat(64)}',1,10000,NULL,1000,1000,NULL);
      INSERT INTO file_objects(id,upload_intent_id,slot_no,purpose,visibility,object_key,client_file_name,
        extension,declared_mime,expected_byte_size,status,upload_token_hash,upload_expires_at,uploaded_byte_size,
        detected_mime,uploaded_sha256,failure_code,delete_attempt_count,next_delete_at,version,created_at,updated_at,
        uploaded_at,verified_at,deleted_at)
      VALUES('ct-qr-file','ct-qr-intent',1,'SERVICE_CHANNEL_QR','BUYER_VISIBLE',
        'files/v1/2026/08/ct-qr-file${'q'.repeat(30)}','qr.png','png','image/png',10,'RESERVED',
        '${'b'.repeat(64)}',10000,NULL,NULL,NULL,NULL,0,NULL,1,1000,1000,NULL,NULL,NULL);
      UPDATE file_upload_intents SET status='VERIFIED', updated_at=1001, completed_at=1001 WHERE id='ct-qr-intent';
      UPDATE file_objects SET status='VERIFIED', uploaded_byte_size=10, detected_mime='image/png',
        uploaded_sha256='${'c'.repeat(64)}', updated_at=1001, uploaded_at=1001, verified_at=1001
        WHERE id='ct-qr-file';
    `);

    const staffApp = new Hono<any>();
    staffApp.use('*', async (context, next) => {
      context.set('requestId', `ct-${crypto.randomUUID()}`);
      context.set('staffAuthorization', {
        staffId: 'ct-channel-owner',
        displayName: 'ct',
        staffStatus: 'ACTIVE',
        authorizationVersion: 1,
        roles: new Set(['owner']),
        permissions: new Set(['STAFF_MANAGE']),
        memberTeamIds: [],
        leaderTeamIds: [],
      });
      await next();
    });
    registerStaffServiceChannelRoutes(staffApp);
    const attach = await staffApp.request(
      `${ORIGIN}/api/staff/service-channels/BUYER_PRE_SALES/qr`, {
        method: 'POST',
        body: JSON.stringify({
          file_object_id: 'ct-qr-file',
          expected_file_version: 1,
          expected_version: 1,
          reason: '7.5R-2 合同测试',
        }),
        headers: { 'content-type': 'application/json', 'Idempotency-Key': 'ct-qr-attach-1' },
      }, { DB: database! });
    expect(attach.status).toBe(201);

    const token = await issueCustomerSession({
      accountId: 'ct-buyer-account',
      identitySubjectId: 'ct-buyer-subject',
      accountType: 'BUYER',
      sessionVersion: 1,
      passwordChangeRequired: false,
    }, SESSION_SECRET, { now: Date.now(), ttlMs: 60 * 60 * 1000 });
    const buyerApp = new Hono<any>();
    buyerApp.use('*', customerSessionMiddleware());
    registerBuyerServiceChannelRoutes(buyerApp);
    const response = await buyerApp.request(`${ORIGIN}/api/buyer-portal/service-channels`, {
      headers: {
        Cookie: `__Host-ygb_customer_session=${token}`,
        Origin: ORIGIN,
        'Sec-Fetch-Site': 'same-origin',
      },
    }, { DB: database!, CUSTOMER_SESSION_SECRET: SESSION_SECRET } as never);
    expect(response.status).toBe(200);
    const json = await response.json() as unknown;
    const parsed = frontendEnvelope(buyerServiceChannelsResponseSchema).safeParse(json);
    expect(parsed.success, JSON.stringify(parsed.success ? [] : parsed.error.issues)).toBe(true);
    const qr = parsed.success
      ? parsed.data.data.channels.find((channel) => channel.code === 'BUYER_PRE_SALES')?.qr_file
      : undefined;
    expect(qr).toEqual({
      file_object_id: 'ct-qr-file',
      file_version: 1,
      purpose: 'SERVICE_CHANNEL_QR',
      visibility: 'BUYER_VISIBLE',
    });
  }, 60_000);
});

describe('shared schema strictness (extra/missing fields fail)', () => {
  const validBatch = {
    batch_id: 'batch-1',
    status: 'CONFIRMED',
    frozen_total_cny_fen: '11880',
    frozen_payable_count: 1,
    paid_amount_cny_fen: '0',
    outstanding_amount_cny_fen: '11880',
    confirmed_at: 1_787_900_100_000,
  };

  it('rejects an unknown field on the batch schema', () => {
    expect(sellerPortalSettlementBatchPageSchema.safeParse({
      batches: [{ ...validBatch, seller_organization_id: 'org' }],
      next_cursor: null,
    }).success).toBe(false);
  });

  it('rejects a missing field on the member schema', () => {
    const { frozen_amount_cny_fen: _dropped, ...incomplete } = {
      amazon_order_number: '123-7654321-000001',
      payable_type: 'SELLER_PRINCIPAL',
      frozen_amount_cny_fen: '11880',
      paid_amount_cny_fen: '0',
      outstanding_amount_cny_fen: '11880',
    };
    void _dropped;
    expect(sellerPortalSettlementBatchDetailResponseSchema.safeParse({
      batch: { ...validBatch, members: [incomplete], members_next_cursor: null },
    }).success).toBe(false);
  });

  it('rejects a bare or wrong-purpose SafeFileReference', () => {
    expect(safeFileReferenceSchema.safeParse({ file_object_id: 'x' }).success).toBe(false);
    expect(safeFileReferenceSchema.safeParse({
      file_object_id: 'x',
      file_version: 1,
      purpose: 'ORDER_EVIDENCE',
      visibility: 'BUYER_VISIBLE',
    }).success).toBe(true);
    expect(safeFileReferenceSchema.safeParse({
      file_object_id: 'x',
      file_version: 1,
      purpose: 'NOT_A_PURPOSE',
      visibility: 'BUYER_VISIBLE',
    }).success).toBe(false);
  });
});

describe('streaming export source guard (7.5R-2)', () => {
  const root = path.resolve(import.meta.dirname, '../../../..');
  const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

  it('keeps the export free of full-file buffering in memory', () => {
    const batches = read('apps/api/src/seller-settlements/batches.ts');
    // No batch-wide due map, no chunk accumulation, no merged full buffer.
    expect(batches).not.toContain('dueMap');
    expect(batches).not.toContain('chunks.push');
    expect(batches).not.toContain('merged.set');
    expect(batches).not.toContain('new Uint8Array(byteLength)');
    // The incremental hasher and the lazy stream exist.
    expect(batches).toContain('IncrementalSha256');
    expect(batches).toContain('createStream: () => exportCsvStream');
    expect(batches).toContain('created_at<=?');
    expect(batches).toContain('export_as_of');
    const routes = read('apps/api/src/seller-settlements/batch-routes.ts');
    // The route hands out the lazy stream; it never enqueues a chunk array.
    expect(routes).toContain('outcome.createStream()');
    expect(routes).not.toContain('start(controller)');
  });

  it('keeps the frontend on the shared schemas (no local duplicates)', () => {
    const list = read('apps/web/src/seller/pages/SellerBatchListSection.tsx');
    expect(list).toContain('sellerPortalSettlementBatchPageSchema');
    expect(list).not.toContain('z.object({');
    const detailFile = 'apps/web/src/seller/pages/SellerBatchDetailSection.tsx';
    expect(existsSync(path.join(root, detailFile))).toBe(true);
    const detail = read(detailFile);
    expect(detail).toContain('sellerPortalSettlementBatchDetailResponseSchema');
    expect(detail).not.toContain('z.object({');
    const buyerRuntime = read('apps/web/src/buyer/contracts/runtime.ts');
    expect(buyerRuntime).toContain('buyerServiceChannelsResponseSchema as buyerServiceChannelsSchema');
    const fileContracts = read('apps/web/src/files/file-read-contracts.ts');
    expect(fileContracts).toContain("export { safeFileReferenceSchema }");
    const shared = read('packages/contracts/src/runtime-schemas.ts');
    expect(shared).not.toContain('.passthrough()');
  });
});
