import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { sha256Hex } from '@ygb/domain';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { attachBuyerChatScreenshot } from './command';
import { listBuyerChatScreenshots } from './read-model';

const NOW = 10_000;

let database: SqliteDatabase;

beforeEach(async () => {
  database = createMigratedTestDatabase();
  await seedFixture(database);
});

afterEach(() => database.close());

function ownerActor(
  overrides: Partial<Pick<AssignmentStaffAuthorization, 'permissions'>> = {},
): AssignmentStaffAuthorization {
  return {
    staffId: 'staff-chat-uploader',
    displayName: '买家聊天截图测试员工',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: new Set(['owner']),
    permissions: overrides.permissions ?? new Set(['ORDER_CONFIRM', 'ORDER_VIEW']),
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}

function scopedActor(): AssignmentStaffAuthorization {
  return {
    staffId: 'staff-chat-scoped',
    displayName: '范围外员工',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: new Set(['pre_sales']),
    permissions: new Set(['ORDER_CONFIRM', 'ORDER_VIEW']),
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}

describe('buyer order chat screenshot attach', () => {
  it('links a verified staff-owned INTERNAL_ONLY screenshot to the confirmed order with staff audience', async () => {
    const result = await attachBuyerChatScreenshot(
      database,
      { formalOrderId: 'formal-order-chat-1', fileObjectId: 'chat-file-1', expectedFileVersion: 2 },
      { actor: ownerActor(), idempotencyKey: 'attach-1', now: NOW },
    );
    expect(result).toMatchObject({
      formal_order_id: 'formal-order-chat-1',
      file_object_id: 'chat-file-1',
      file_version: 2,
      replayed: false,
    });
    const link = await database.prepare(`
      SELECT entity_type, entity_id, purpose, visibility, authorization_mode, revoked_at
      FROM file_entity_links WHERE file_object_id='chat-file-1'
    `).first();
    expect(link).toMatchObject({
      entity_type: 'ORDER',
      entity_id: 'formal-order-chat-1',
      purpose: 'ORDER_EVIDENCE',
      visibility: 'INTERNAL_ONLY',
      authorization_mode: 'EXPLICIT_AUDIENCES',
      revoked_at: null,
    });
    await expect(database.prepare(`
      SELECT subject_type, staff_permission_code, staff_scope_type
      FROM file_entity_audience_grants
      WHERE file_entity_link_id=(SELECT id FROM file_entity_links WHERE file_object_id='chat-file-1')
    `).first()).resolves.toMatchObject({
      subject_type: 'STAFF_INTERNAL',
      staff_permission_code: 'ORDER_VIEW',
      staff_scope_type: 'GLOBAL',
    });
    await expect(database.prepare(`
      SELECT event_type FROM audit_events
      WHERE aggregate_type='FORMAL_ORDER' AND aggregate_id='formal-order-chat-1'
        AND event_type='BUYER_ORDER_CHAT_SCREENSHOT_ATTACHED'
    `).first()).resolves.toBeTruthy();
    const listed = await listBuyerChatScreenshots(database, ['formal-order-chat-1']);
    expect(listed.get('formal-order-chat-1')).toEqual([{
      file_object_id: 'chat-file-1',
      file_version: 2,
      purpose: 'ORDER_EVIDENCE',
      visibility: 'INTERNAL_ONLY',
    }]);
  });

  it('replays the same idempotency key without duplicating links', async () => {
    const first = await attachBuyerChatScreenshot(
      database,
      { formalOrderId: 'formal-order-chat-1', fileObjectId: 'chat-file-1', expectedFileVersion: 2 },
      { actor: ownerActor(), idempotencyKey: 'attach-replay', now: NOW },
    );
    const replay = await attachBuyerChatScreenshot(
      database,
      { formalOrderId: 'formal-order-chat-1', fileObjectId: 'chat-file-1', expectedFileVersion: 2 },
      { actor: ownerActor(), idempotencyKey: 'attach-replay', now: NOW + 1 },
    );
    expect(replay.replayed).toBe(true);
    expect(replay.screenshot_id).toBe(first.screenshot_id);
    await expect(database.prepare(
      'SELECT COUNT(*) AS count FROM file_entity_links WHERE file_object_id=?',
    ).bind('chat-file-1').first()).resolves.toMatchObject({ count: 1 });
  });

  it('rejects staff without ORDER_CONFIRM', async () => {
    await expect(attachBuyerChatScreenshot(
      database,
      { formalOrderId: 'formal-order-chat-1', fileObjectId: 'chat-file-1', expectedFileVersion: 2 },
      { actor: ownerActor({ permissions: new Set(['ORDER_VIEW']) }), idempotencyKey: 'attach-denied', now: NOW },
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('conceals orders outside the staff marketplace scope', async () => {
    await expect(attachBuyerChatScreenshot(
      database,
      { formalOrderId: 'formal-order-chat-1', fileObjectId: 'chat-file-1', expectedFileVersion: 2 },
      { actor: scopedActor(), idempotencyKey: 'attach-scoped', now: NOW },
    )).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects unknown orders', async () => {
    await expect(attachBuyerChatScreenshot(
      database,
      { formalOrderId: 'formal-order-missing-1', fileObjectId: 'chat-file-1', expectedFileVersion: 2 },
      { actor: ownerActor(), idempotencyKey: 'attach-missing', now: NOW },
    )).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects buyer-visible evidence files and already-linked uploads', async () => {
    await expect(attachBuyerChatScreenshot(
      database,
      { formalOrderId: 'formal-order-chat-1', fileObjectId: 'buyer-evidence-1', expectedFileVersion: 2 },
      { actor: ownerActor(), idempotencyKey: 'attach-buyer-file', now: NOW },
    )).rejects.toMatchObject({ code: 'FILE_NOT_VERIFIED' });
    await attachBuyerChatScreenshot(
      database,
      { formalOrderId: 'formal-order-chat-1', fileObjectId: 'chat-file-1', expectedFileVersion: 2 },
      { actor: ownerActor(), idempotencyKey: 'attach-first', now: NOW },
    );
    await expect(attachBuyerChatScreenshot(
      database,
      { formalOrderId: 'formal-order-chat-2', fileObjectId: 'chat-file-1', expectedFileVersion: 2 },
      { actor: ownerActor(), idempotencyKey: 'attach-second', now: NOW + 1 },
    )).rejects.toMatchObject({ code: 'FILE_STORAGE_CONFLICT' });
  });

  it('never lists buyer evidence or seller-visible clones as chat screenshots', async () => {
    database.exec(`
      INSERT INTO file_entity_links (
        id, file_object_id, entity_type, entity_id, purpose, visibility,
        linked_by_actor_type, linked_by_actor_id, created_at,
        authorization_mode, expires_at, revoked_at
      ) VALUES
        ('link-buyer-evidence', 'buyer-evidence-1', 'ORDER', 'formal-order-chat-1',
         'ORDER_EVIDENCE', 'BUYER_VISIBLE', 'BUYER_CUSTOMER', 'buyer-customer-0001', 1,
         'LEGACY_VISIBILITY', NULL, NULL),
        ('link-legacy-internal', 'chat-file-1', 'ORDER', 'formal-order-chat-1',
         'ORDER_EVIDENCE', 'INTERNAL_ONLY', 'STAFF', 'staff-chat-uploader', 1,
         'LEGACY_VISIBILITY', NULL, NULL);
    `);
    const listed = await listBuyerChatScreenshots(database, ['formal-order-chat-1']);
    expect(listed.get('formal-order-chat-1') ?? []).toEqual([]);
  });
});

async function seedFixture(db: SqliteDatabase): Promise<void> {
  db.exec(`
    PRAGMA foreign_keys=OFF;
    DROP TRIGGER trg_formal_order_source_guard;
    DROP TRIGGER trg_formal_order_instruction_guard;
    DROP TRIGGER trg_order_evidence_submission_reservation_guard;
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES
      ('staff-chat-uploader', '买家聊天截图测试员工', 'ACTIVE', 1, 1, 1, 1, NULL),
      ('staff-chat-scoped', '范围外员工', 'ACTIVE', 1, 1, 1, 1, NULL);
    INSERT INTO staff_role_assignments (
      id, staff_id, role_code, status, assigned_by_staff_id, assigned_at,
      revoked_at, revoked_by_staff_id, revoked_reason, created_at, updated_at
    ) VALUES
      ('role-uploader', 'staff-chat-uploader', 'owner', 'ACTIVE',
       'staff-chat-uploader', 1, NULL, NULL, NULL, 1, 1),
      ('role-scoped', 'staff-chat-scoped', 'pre_sales', 'ACTIVE',
       'staff-chat-uploader', 1, NULL, NULL, NULL, 1, 1);
    INSERT INTO staff_marketplace_scopes (
      id, staff_id, role_code, marketplace_code, status,
      assigned_by_staff_id, assigned_at, revoked_at, reason,
      created_at, updated_at, scope_kind
    ) VALUES (
      'scope-chat-scoped-us', 'staff-chat-scoped', 'pre_sales',
      'AMAZON_US', 'ACTIVE', 'staff-chat-uploader', 1, NULL,
      'TEST_PRIMARY', 1, 1, 'PRIMARY'
    );
    INSERT INTO customer_identity_subjects (id, subject_type, created_at) VALUES
      ('buyer-subject-0001', 'BUYER_CUSTOMER', 1);
    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code, buyer_channel_id,
      buyer_customer_no, buyer_sequence, display_name, access_status,
      identity_review_status, version, created_at, updated_at, activated_at
    ) VALUES
      ('buyer-customer-0001', 'buyer-subject-0001', 'AMAZON_JP',
       'buyer-channel-wechat-b', '19700101B0001', 1,
       '买家一', 'ACTIVE', 'CLEAR', 1, 1, 1, 1);
    INSERT INTO order_evidence_submissions (id, reservation_id, buyer_customer_id, marketplace_code, status, current_version_no, version, public_change_reason, internal_review_note, submitted_at, updated_at, verified_by_staff_id, verified_at, withdrawn_at, consumed_at, created_at) VALUES
      ('chat-submission-1', 'chat-reservation-1', 'buyer-customer-0001', 'AMAZON_JP', 'VERIFIED', 1, 1, NULL, NULL, 1, 1, 'staff-chat-uploader', 1, NULL, NULL, 1),
      ('chat-submission-2', 'chat-reservation-2', 'buyer-customer-0001', 'AMAZON_JP', 'VERIFIED', 1, 1, NULL, NULL, 1, 1, 'staff-chat-uploader', 1, NULL, NULL, 1);
    INSERT INTO formal_orders (id, order_evidence_submission_id, order_evidence_version_id, reservation_id, demand_batch_id, buyer_customer_id, buyer_customer_no, seller_organization_id, store_id, marketplace_code, product_id, product_version_id, product_version_no, asin_display, asin_normalized, product_name_snapshot, review_type, amazon_order_number_raw, amazon_order_number_normalized, final_paid_jpy, status, version, confirmed_by_staff_id, confirmed_at, confirmed_business_date, created_at) VALUES
      ('formal-order-chat-1', 'chat-submission-1', 'chat-evidence-version-1', 'chat-reservation-1', 'chat-demand-1', 'buyer-customer-0001', 'buyer-001', 'org-1', 'store-1', 'AMAZON_JP', 'product-1', 'product-version-1', 1, 'B012345678', 'B012345678', '商品一', 'IMAGE', '111-1111111-1111111', '111-1111111-1111111', 1980, 'CONFIRMED', 1, 'staff-chat-uploader', 1, '2026-08-01', 1),
      ('formal-order-chat-2', 'chat-submission-2', 'chat-evidence-version-2', 'chat-reservation-2', 'chat-demand-2', 'buyer-customer-0001', 'buyer-001', 'org-1', 'store-1', 'AMAZON_JP', 'product-1', 'product-version-1', 1, 'B012345679', 'B012345679', '商品二', 'IMAGE', '222-2222222-2222222', '222-2222222-2222222', 1980, 'CONFIRMED', 1, 'staff-chat-uploader', 1, '2026-08-01', 1);
    INSERT INTO file_upload_intents (id, owner_actor_type, owner_actor_id, purpose, visibility, status, requested_file_count, manifest_hash, version, expires_at, failure_code, created_at, updated_at, completed_at)
      VALUES
        ('chat-intent-1', 'STAFF', 'staff-chat-uploader', 'ORDER_EVIDENCE', 'INTERNAL_ONLY', 'ISSUED', 1, '${'a'.repeat(64)}', 1, 9999999999999, NULL, 1, 1, NULL),
        ('buyer-intent-1', 'BUYER_CUSTOMER', 'buyer-customer-0001', 'ORDER_EVIDENCE', 'BUYER_VISIBLE', 'ISSUED', 1, '${'c'.repeat(64)}', 1, 9999999999999, NULL, 1, 1, NULL);
    INSERT INTO file_objects (id, upload_intent_id, slot_no, purpose, visibility, object_key, client_file_name, extension, declared_mime, expected_byte_size, status, upload_token_hash, upload_expires_at, uploaded_byte_size, detected_mime, uploaded_sha256, failure_code, delete_attempt_count, next_delete_at, version, created_at, updated_at, uploaded_at, verified_at, deleted_at)
      VALUES
        ('chat-file-1', 'chat-intent-1', 1, 'ORDER_EVIDENCE', 'INTERNAL_ONLY', 'files/v1/chat/buyer-chat-fixture-00000000000000000000000000', 'chat.png', 'png', 'image/png', 11, 'RESERVED', '${'b'.repeat(64)}', 9999999999999, NULL, NULL, NULL, NULL, 0, NULL, 1, 1, 1, NULL, NULL, NULL),
        ('buyer-evidence-1', 'buyer-intent-1', 1, 'ORDER_EVIDENCE', 'BUYER_VISIBLE', 'files/v1/chat/buyer-evidence-fixture-0000000000000000000000', 'evidence.png', 'png', 'image/png', 11, 'RESERVED', '${'e'.repeat(64)}', 9999999999999, NULL, NULL, NULL, NULL, 0, NULL, 1, 1, 1, NULL, NULL, NULL);
    PRAGMA foreign_keys=ON;
  `);
  db.exec(`
    UPDATE file_upload_intents
    SET status='VERIFIED', version=2, updated_at=2, completed_at=2
    WHERE id IN ('chat-intent-1', 'buyer-intent-1');
  `);
  await db.prepare(`
    UPDATE file_objects SET status='VERIFIED', version=2, updated_at=2,
      uploaded_byte_size=11, detected_mime='image/png',
      uploaded_sha256=?, uploaded_at=2, verified_at=2
    WHERE id='chat-file-1'
  `).bind(await sha256Hex(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]))).run();
  await db.prepare(`
    UPDATE file_objects SET status='VERIFIED', version=2, updated_at=2,
      uploaded_byte_size=11, detected_mime='image/png',
      uploaded_sha256=?, uploaded_at=2, verified_at=2
    WHERE id='buyer-evidence-1'
  `).bind(await sha256Hex(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]))).run();
}
