import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import {
  API_ERROR_HTTP_STATUS,
  STAFF_ORDER_EVIDENCE_PATHS,
  type StaffOrderEvidenceListItem,
} from '@ygb/contracts';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import {
  loginThroughDefaultApp,
  seedWave13RuntimeAuthority,
  Wave13RuntimeDatabase,
} from '../../test-support/wave13-runtime';
import { MockObjectStorage } from '../files/mock-object-storage';
import app from '../index';
import { exactOneOrderEvidenceScreenshotGuard } from './http-one-screenshot-guard';

const root = path.resolve(process.cwd());
const source = (relative: string) => readFileSync(path.join(root, relative), 'utf8');

async function guarded(fileObjectIds: unknown): Promise<Response> {
  const app = new Hono();
  app.use('*', exactOneOrderEvidenceScreenshotGuard());
  app.post('*', (context) => context.json({ ok: true }));
  return app.request('https://example.test/order-evidence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_object_ids: fileObjectIds }),
  });
}

describe('Wave 13 Staff Order Evidence API', () => {
  it('enforces exactly one screenshot at the HTTP boundary', async () => {
    expect((await guarded([])).status).toBe(400);
    expect((await guarded(['file-a', 'file-b'])).status).toBe(400);
    expect((await guarded(['file-a'])).status).toBe(200);
    expect((await guarded(['file-a', 'file-a'])).status).toBe(400);
    const domain = source('apps/api/src/order-evidence/order-evidence-shared.ts');
    expect(domain).toContain('values.length !== 1');
  });

  it('registers only canonical /api Staff Order Evidence paths', () => {
    for (const route of Object.values(STAFF_ORDER_EVIDENCE_PATHS)) {
      expect(route).toMatch(/^\/api\/staff\/order-evidence/u);
      expect(route).not.toContain('/api/v2/');
    }
  });

  it('returns the complete Staff-safe review queue DTO at runtime', async () => {
    const base = createMigratedTestDatabase();
    try {
      seedWave13RuntimeAuthority(base);
      const database = new Wave13RuntimeDatabase(base);
      const identity = await loginThroughDefaultApp(
        database,
        'owner',
        new MockObjectStorage(),
      );
      const response = await app.request(
        'https://api.example.test/api/staff/order-evidence?limit=1',
        { headers: { Cookie: identity.cookie } },
        identity.env,
      );
      expect(response.status).toBe(200);
      const body = await response.json() as {
        data: { items: StaffOrderEvidenceListItem[] };
      };
      expect(body.data.items).toEqual([{
        submission_id: 'runtime-evidence',
        buyer_customer_id: 'runtime-buyer',
        reservation_id: 'runtime-reservation',
        instruction_id: 'runtime-instruction',
        instruction_version_id: 'runtime-instruction-version',
        marketplace: 'JP',
        amazon_order_number_raw: '123-1234567-1234567',
        amazon_order_number_normalized: '123-1234567-1234567',
        status: 'PENDING_VERIFICATION',
        version: 1,
        current_evidence_version_no: 1,
        reference_order_amount_jpy: '1980',
        final_paid_jpy: '2080',
        price_difference_jpy: '100',
        price_mismatch: true,
        resubmission_deadline_at: 18_000,
        submitted_at: 10_000,
        updated_at: 12_000,
        buyer: {
          buyer_customer_id: 'runtime-buyer',
          buyer_customer_no: 'P202608020001',
        },
        screenshot: {
          file_object_id: 'runtime-screenshot',
          file_version: 3,
          purpose: 'ORDER_EVIDENCE',
          visibility: 'BUYER_VISIBLE',
        },
        workflow: {
          work_item_id: 'runtime-work-item',
          assigned_staff_id: 'zz-phase3h-test-owner',
          assigned_team_id: null,
          fixed_assignment_id: 'runtime-assignment',
        },
      }]);
      expect(JSON.stringify(body)).not.toMatch(
        /object_key|internal_review_note|price_mismatch_reason/iu,
      );

      const complete = await app.request(
        'https://api.example.test/api/staff/order-evidence?limit=100',
        { headers: { Cookie: identity.cookie } },
        identity.env,
      );
      const completeBody = await complete.json() as {
        data: { items: StaffOrderEvidenceListItem[] };
      };
      expect(completeBody.data.items[1]).toMatchObject({
        price_difference_jpy: '0',
        price_mismatch: false,
        resubmission_deadline_at: null,
      });

      const scoped = await loginThroughDefaultApp(
        database,
        'scoped',
        new MockObjectStorage(),
      );
      const concealed = await app.request(
        'https://api.example.test/api/staff/order-evidence',
        { headers: { Cookie: scoped.cookie } },
        scoped.env,
      );
      expect(concealed.status).toBe(200);
      await expect(concealed.json()).resolves.toMatchObject({
        data: { items: [] },
      });
    } finally {
      base.close();
    }
  });

  it.each(['zero', 'multiple', 'mismatch'] as const)(
    'rejects a tampered local D1 %s current screenshot association',
    async (tamper) => {
      const database = createMigratedTestDatabase();
      try {
        seedWave13RuntimeAuthority(database);
        seedDetailInvariantFixture(database);
        tamperDetailAssociation(database, tamper);
        const identity = await loginThroughDefaultApp(
          database,
          'owner',
          new MockObjectStorage(),
        );
        const response = await app.request(
          'https://api.example.test/api/staff/order-evidence/tampered-evidence',
          { headers: { Cookie: identity.cookie } },
          identity.env,
        );
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({
          error: { code: 'STATE_CONFLICT' },
        });
      } finally {
        database.close();
      }
    },
  );

  it('returns one safe screenshot for a valid local D1 association', async () => {
    const database = createMigratedTestDatabase();
    try {
      seedWave13RuntimeAuthority(database);
      seedDetailInvariantFixture(database);
      const identity = await loginThroughDefaultApp(
        database,
        'owner',
        new MockObjectStorage(),
      );
      const response = await app.request(
        'https://api.example.test/api/staff/order-evidence/tampered-evidence',
        { headers: { Cookie: identity.cookie } },
        identity.env,
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        data: {
          order_evidence: {
            screenshot: {
              file_object_id: 'tampered-file',
              purpose: 'ORDER_EVIDENCE',
              visibility: 'BUYER_VISIBLE',
            },
          },
        },
      });
      expect(JSON.stringify(body)).not.toContain('object_key');
    } finally {
      database.close();
    }
  });

  it('keeps approval as one top-level D1 batch without nested public commands', () => {
    const approval = source(
      'apps/api/src/order-evidence/approve-order-evidence.ts',
    );
    expect(approval).toContain('database.batch([...statements, ...sellerCopyStatements])');
    expect(approval).not.toContain('verifyOrderEvidence(');
    expect(approval).not.toContain('confirmFormalOrder(');
    expect(approval).toContain("action: 'APPROVE_ORDER_EVIDENCE'");
    expect(approval).toContain('completeIdempotencyStatement');
    expect(approval).toContain('finalizeOrderNumberClaimStatement');
    expect(approval).toContain('prepareSellerPayableCreation');
    expect(approval).toContain('completeFormalInstructionStatements');
    expect(approval).toContain('prepareWorkItemCompletionStatements');
  });

  it('freezes every PRICE_MISMATCH decision and request-hash input', () => {
    const approval = source(
      'apps/api/src/order-evidence/approve-order-evidence.ts',
    );
    expect(API_ERROR_HTTP_STATUS.PRICE_MISMATCH).toBe(409);
    expect(approval).toContain("'PRICE_MISMATCH', 409");
    expect(approval).toContain('price_mismatch_acknowledged: acknowledged ?? null');
    expect(approval).toContain('price_mismatch_reason: normalizedReason');
    expect(approval).toContain('if (input.acknowledged !== true)');
    expect(approval).toContain('if (!input.reason)');
    expect(approval).toContain('input.acknowledged === true || input.reason !== null');
    expect(approval).toContain('reference_order_amount_jpy');
    expect(approval).toContain('final_paid_jpy');
    expect(approval).toContain('price_difference_jpy');
    expect(approval).toContain('confirmed_by_staff_id');
  });

  it('uses final_paid_jpy for the formal order and snapshot math', () => {
    const approval = source(
      'apps/api/src/order-evidence/approve-order-evidence.ts',
    );
    expect(approval).toContain('const finalPaidJpy = parseJpyInteger');
    expect(approval).toContain('calculateBuyerFormalFinancials({');
    expect(approval).toContain('finalPaidJpy: source.final_paid_jpy');
    expect(approval).toContain('sellerExpectedPrincipal = parseCnyFen');
    expect(approval).toContain('sellerPrincipalRateSnapshot');
    expect(approval).not.toContain(
      'finalPaidJpy: source.reference_order_amount_jpy',
    );
  });

  it('keeps mismatch reason out of Buyer DTOs', () => {
    const buyerRoutes = source(
      'apps/api/src/buyer-order-evidence-portal/routes.ts',
    );
    const buyerContracts = source(
      'packages/contracts/src/buyer-order-evidence-portal.ts',
    );
    expect(`${buyerRoutes}\n${buyerContracts}`).not.toContain(
      'price_mismatch_reason',
    );
    expect(`${buyerRoutes}\n${buyerContracts}`).not.toContain(
      'internal_review_note',
    );
  });
});

function seedDetailInvariantFixture(database: SqliteDatabase): void {
  database.exec('PRAGMA foreign_keys = OFF;');
  database.exec(`
    INSERT INTO customer_identity_subjects (id, subject_type, created_at)
    VALUES ('tampered-subject','BUYER_CUSTOMER',1000);
    INSERT INTO buyer_channels (
      id, code, name, status, next_sequence, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'tampered-channel','T','Tampered Channel','ACTIVE',2,1,
      1000,1000,NULL
    );
    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code, buyer_channel_id,
      buyer_customer_no, buyer_sequence, first_valid_order_business_date,
      display_name, access_status, identity_review_status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES (
      'tampered-buyer','tampered-subject','JP','tampered-channel',
      'P202608030001',1,'2026-08-03','Tampered Buyer','ACTIVE','CLEAR',1,
      1000,1000,1000,NULL
    );
    INSERT INTO product_reservations (
      id, demand_batch_id, buyer_customer_id, organization_id, store_id,
      product_id, product_version_no, marketplace_code, status,
      precheck_snapshot_json, hold_expires_at, order_deadline_snapshot,
      version, submitted_at, updated_at, decided_by_staff_id,
      decision_reason, decided_at, cancelled_at, expired_at, reopened_count,
      buyer_self_pay_bps_snapshot, reference_order_amount_jpy_snapshot,
      estimated_self_pay_jpy_snapshot,
      estimated_refundable_principal_jpy_snapshot,
      buyer_self_pay_accepted_at, buyer_self_pay_accepted_demand_version
    ) VALUES (
      'tampered-reservation','tampered-demand','tampered-buyer','runtime-org',
      'runtime-store','tampered-product',1,'JP','APPROVED','{}',2000,20000,
      2,1000,1500,'zz-phase3h-test-owner',NULL,1500,NULL,NULL,0,
      0,1980,0,1980,1500,1
    );
    INSERT INTO order_instructions (
      id, reservation_id, buyer_customer_id, marketplace_code, status,
      current_version_no, version, published_at, initial_deadline_at,
      resubmission_deadline_at, expired_at, cancelled_at, completed_at,
      created_at, updated_at
    ) VALUES (
      'tampered-instruction','tampered-reservation','tampered-buyer','JP',
      'ACTIVE',1,2,2000,20000,18000,NULL,NULL,NULL,2000,2000
    );
    DROP TRIGGER trg_file_objects_intent_guard;
    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id, purpose, visibility, status,
      requested_file_count, manifest_hash, version, expires_at,
      failure_code, created_at, updated_at, completed_at
    ) VALUES (
      'tampered-intent','BUYER_CUSTOMER','tampered-buyer','ORDER_EVIDENCE',
      'BUYER_VISIBLE','VERIFIED',1,'${'a'.repeat(64)}',2,30000,
      NULL,3000,4000,4000
    );
    INSERT INTO file_objects (
      id, upload_intent_id, slot_no, purpose, visibility, object_key,
      client_file_name, extension, declared_mime, expected_byte_size,
      status, upload_token_hash, upload_expires_at, uploaded_byte_size,
      detected_mime, uploaded_sha256, failure_code, delete_attempt_count,
      next_delete_at, version, created_at, updated_at, uploaded_at,
      verified_at, deleted_at
    ) VALUES (
      'tampered-file','tampered-intent',1,'ORDER_EVIDENCE','BUYER_VISIBLE',
      'files/v1/${'b'.repeat(40)}','evidence.png','png','image/png',10,
      'VERIFIED','${'c'.repeat(64)}',30000,10,'image/png',
      '${'d'.repeat(64)}',NULL,0,NULL,3,3000,4000,3500,4000,NULL
    );
    INSERT INTO order_evidence_submissions (
      id, reservation_id, buyer_customer_id, marketplace_code, status,
      current_version_no, version, public_change_reason,
      internal_review_note, submitted_at, updated_at,
      verified_by_staff_id, verified_at, withdrawn_at, consumed_at,
      created_at, resubmission_deadline_at
    ) VALUES (
      'tampered-evidence','tampered-reservation','tampered-buyer','JP',
      'PENDING_VERIFICATION',1,1,NULL,NULL,5000,5000,
      NULL,NULL,NULL,NULL,5000,NULL
    );
    DROP TRIGGER trg_order_evidence_instruction_snapshot_guard;
    INSERT INTO order_evidence_versions (
      id, submission_id, reservation_id, buyer_customer_id, marketplace_code,
      version_no, amazon_order_number_raw,
      amazon_order_number_normalized, amazon_order_date, final_paid_jpy,
      submitted_by_buyer_id, buyer_note, created_at,
      order_instruction_id, order_instruction_version_id,
      instruction_deadline_snapshot, reference_order_amount_jpy_snapshot,
      buyer_self_pay_bps_snapshot, buyer_self_pay_jpy,
      buyer_refundable_principal_jpy, price_mismatch,
      price_difference_jpy, submitted_before_deadline,
      evidence_file_object_id
    ) VALUES (
      'tampered-version','tampered-evidence','tampered-reservation',
      'tampered-buyer','JP',1,'123-1234567-1234567',
      '123-1234567-1234567','2026-08-01',2080,'tampered-buyer',NULL,5000,
      'tampered-instruction','tampered-instruction-version',20000,1980,
      0,0,2080,1,100,1,'tampered-file'
    );
    INSERT INTO file_entity_links (
      id, file_object_id, entity_type, entity_id, purpose, visibility,
      linked_by_actor_type, linked_by_actor_id, created_at,
      authorization_mode, expires_at, revoked_at
    ) VALUES (
      'tampered-link','tampered-file','ORDER','tampered-version',
      'ORDER_EVIDENCE','BUYER_VISIBLE','BUYER_CUSTOMER','tampered-buyer',
      5000,'EXPLICIT_AUDIENCES',NULL,NULL
    );
    INSERT INTO order_evidence_version_files (
      id, version_id, submission_id, reservation_id, buyer_customer_id,
      file_object_id, file_entity_link_id, visibility, created_at
    ) VALUES (
      'tampered-binding','tampered-version','tampered-evidence',
      'tampered-reservation','tampered-buyer','tampered-file',
      'tampered-link','BUYER_VISIBLE',5000
    );
  `);
  database.exec('PRAGMA foreign_keys = ON;');
}

function tamperDetailAssociation(
  database: SqliteDatabase,
  tamper: 'zero' | 'multiple' | 'mismatch',
): void {
  database.exec(`
    DROP TRIGGER trg_order_evidence_version_files_no_delete;
  `);
  if (tamper === 'zero') {
    database.exec(`
      DELETE FROM order_evidence_version_files
      WHERE version_id='tampered-version';
    `);
    return;
  }
  database.exec(`
    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id, purpose, visibility, status,
      requested_file_count, manifest_hash, version, expires_at,
      failure_code, created_at, updated_at, completed_at
    ) VALUES (
      'tampered-intent-2','BUYER_CUSTOMER','tampered-buyer','ORDER_EVIDENCE',
      'BUYER_VISIBLE','VERIFIED',1,'${'e'.repeat(64)}',2,30000,
      NULL,3000,4000,4000
    );
    INSERT INTO file_objects (
      id, upload_intent_id, slot_no, purpose, visibility, object_key,
      client_file_name, extension, declared_mime, expected_byte_size,
      status, upload_token_hash, upload_expires_at, uploaded_byte_size,
      detected_mime, uploaded_sha256, failure_code, delete_attempt_count,
      next_delete_at, version, created_at, updated_at, uploaded_at,
      verified_at, deleted_at
    ) VALUES (
      'tampered-file-2','tampered-intent-2',1,'ORDER_EVIDENCE','BUYER_VISIBLE',
      'files/v1/${'f'.repeat(40)}','evidence-2.png','png','image/png',10,
      'VERIFIED','${'1'.repeat(64)}',30000,10,'image/png',
      '${'2'.repeat(64)}',NULL,0,NULL,3,3000,4000,3500,4000,NULL
    );
    INSERT INTO file_entity_links (
      id, file_object_id, entity_type, entity_id, purpose, visibility,
      linked_by_actor_type, linked_by_actor_id, created_at,
      authorization_mode, expires_at, revoked_at
    ) VALUES (
      'tampered-link-2','tampered-file-2','ORDER','tampered-version',
      'ORDER_EVIDENCE','BUYER_VISIBLE','BUYER_CUSTOMER','tampered-buyer',
      5000,'EXPLICIT_AUDIENCES',NULL,NULL
    );
    DROP TRIGGER trg_order_evidence_single_image_guard;
  `);
  if (tamper === 'mismatch') {
    database.exec(`
      DELETE FROM order_evidence_version_files
      WHERE version_id='tampered-version';
    `);
  }
  database.exec(`
    INSERT INTO order_evidence_version_files (
      id, version_id, submission_id, reservation_id, buyer_customer_id,
      file_object_id, file_entity_link_id, visibility, created_at
    ) VALUES (
      'tampered-binding-2','tampered-version','tampered-evidence',
      'tampered-reservation','tampered-buyer','tampered-file-2',
      'tampered-link-2','BUYER_VISIBLE',5000
    );
  `);
}
