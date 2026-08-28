import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { StaffPermissionCode } from '@ygb/contracts';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { calculateEffectiveStaffAuthorization } from '../staff/authorization-policy';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { registerStaffOrderDetailRoutes } from './routes';
import { seedConfirmedColdArchiveOrder } from '../../test-support/cold-archive-fixture';
import { attachOrderCommunicationScreenshot } from '../order-communication-screenshots/command';

const ORIGIN = 'https://api.example.test';
let database: SqliteDatabase | null = null;
let orderId = '';

beforeEach(async () => {
  database = createMigratedTestDatabase();
  const order = await seedConfirmedColdArchiveOrder(database, 'detail66e');
  orderId = order.formalOrderId;
  await seedCommunicationScreenshot();
});
afterEach(() => {
  database?.close();
  database = null;
});

describe('stage 6.6E unified order detail projections', () => {
  it('returns the authoritative advance partition to buyer_refund without seller-sensitive finance', async () => {
    const response = await request(authorization('buyer_refund'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Record<string, unknown>;
    };
    const advance = body.data['buyer_advance'] as Record<string, unknown>;
    expect(advance).toMatchObject({
      authoritative_advance_amount_cny_fen: expect.any(String),
      recorded_advance_amount_cny_fen: '0',
      remaining_advance_amount_cny_fen:
        advance!['authoritative_advance_amount_cny_fen'],
      can_record_advance_payment: true,
    });
    // Buyer Refund must not see profit or seller-sensitive finance sections.
    expect(body.data['financial_snapshot']).toBeUndefined();
    expect(body.data['financial_adjustments']).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('seller_expected_principal');
    expect(JSON.stringify(body)).not.toContain('service_fee_cny_fen');
  });

  it('returns the finance snapshot to an owner with FINANCIAL_VIEW', async () => {
    const response = await request(authorization('owner'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(body.data['financial_snapshot']).toMatchObject({
      buyer_expected_principal_cny_fen: expect.any(String),
      seller_expected_principal_cny_fen: expect.any(String),
    });
    expect(body.data['buyer_advance']).toMatchObject({
      can_record_advance_payment: true,
    });
  });

  it('omits the advance partition for pre_sales', async () => {
    const response = await request(authorization('pre_sales'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(body.data['buyer_advance']).toBeUndefined();
    expect(body.data['financial_snapshot']).toBeUndefined();
  });

  it('exposes the communication screenshot uploader and upload time', async () => {
    const response = await request(authorization('owner'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { communication_screenshots: Array<Record<string, unknown>> };
    };
    expect(body.data.communication_screenshots).toHaveLength(1);
    expect(body.data.communication_screenshots[0]).toMatchObject({
      uploaded_at: expect.any(Number),
      uploaded_by_staff_id: 'staff-66e-refund',
      uploaded_by_staff_name: '返款员工',
    });
  });
});

async function request(actor: AssignmentStaffAuthorization): Promise<Response> {
  const app = new Hono<any>();
  app.use('*', async (context, next) => {
    context.set('requestId', `order-detail-${crypto.randomUUID()}`);
    context.set('staffAuthorization', actor);
    await next();
  });
  registerStaffOrderDetailRoutes(app);
  return app.request(`${ORIGIN}/api/staff/formal-orders/${orderId}`, {}, {
    DB: database!,
  });
}

function authorization(
  role: 'owner' | 'pre_sales' | 'buyer_refund',
): AssignmentStaffAuthorization {
  const effective = calculateEffectiveStaffAuthorization({
    roles: new Set([role]),
    grants: new Set<StaffPermissionCode>(),
    denies: new Set<StaffPermissionCode>(),
    memberTeamIds: [],
    leaderTeamIds: [],
  });
  return {
    staffId: role === 'buyer_refund' ? 'staff-66e-refund' : role === 'pre_sales' ? 'staff-66e-pre' : 'cold-archive-owner',
    displayName: '员工',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: effective.roles,
    permissions: effective.permissions,
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}

async function seedCommunicationScreenshot(): Promise<void> {
  const d = database!;
  d.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version, version,
      created_at, updated_at, disabled_at
    ) VALUES ('staff-66e-refund','返款员工','ACTIVE',1,1,1000,1000,NULL)
    ON CONFLICT(id) DO NOTHING;
    INSERT INTO staff_role_assignments (
      id, staff_id, role_code, status, assigned_by_staff_id, assigned_at,
      revoked_at, created_at, updated_at
    ) VALUES ('role-66e-refund-000001','staff-66e-refund','buyer_refund',
      'ACTIVE',NULL,1000,NULL,1000,1000);
    INSERT INTO staff_marketplace_scopes (
      id, staff_id, role_code, marketplace_code, status,
      assigned_by_staff_id, assigned_at, revoked_at, reason,
      created_at, updated_at, scope_kind
    ) VALUES ('scope-66e-refund-jp','staff-66e-refund','buyer_refund','AMAZON_JP',
      'ACTIVE',NULL,1000,NULL,'TEST_PRIMARY',1000,1000,'PRIMARY');
    INSERT INTO staff_users (
      id, display_name, status, authorization_version, version,
      created_at, updated_at, disabled_at
    ) VALUES ('staff-66e-pre','售前员工','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO staff_role_assignments (
      id, staff_id, role_code, status, assigned_by_staff_id, assigned_at,
      revoked_at, created_at, updated_at
    ) VALUES ('role-66e-pre-0000001','staff-66e-pre','pre_sales',
      'ACTIVE',NULL,1000,NULL,1000,1000);
    INSERT INTO staff_marketplace_scopes (
      id, staff_id, role_code, marketplace_code, status,
      assigned_by_staff_id, assigned_at, revoked_at, reason,
      created_at, updated_at, scope_kind
    ) VALUES ('scope-66e-pre-jp','staff-66e-pre','pre_sales','AMAZON_JP',
      'ACTIVE',NULL,1000,NULL,'TEST_PRIMARY',1000,1000,'PRIMARY');
    -- Stage 7.5 batch 1: fixed-assignment order visibility. The confirmation
    -- fixture auto-binds the pre-sales duty to the confirming owner; revoke
    -- that row and rebind both duties to the dedicated actors so they keep
    -- seeing the order under the tightened visibility.
    UPDATE buyer_staff_assignments
    SET status='REVOKED', revoked_at=1785542400001, updated_at=1785542400001, version=2
    WHERE buyer_customer_id='cold-buyer-detail66e'
      AND duty_code='BUYER_PRE_SALES_OWNER' AND status='ACTIVE';
    INSERT INTO buyer_staff_assignments (
      id, buyer_customer_id, duty_code, staff_id, status, source,
      assigned_by_actor_type, assigned_by_actor_id, reason,
      version, created_at, updated_at, revoked_at
    ) VALUES
      ('assign-66e-refund-buyer','cold-buyer-detail66e','BUYER_REFUND_OWNER',
        'staff-66e-refund','ACTIVE','AUTO_INITIAL','SYSTEM',NULL,NULL,1,1000,1000,NULL),
      ('assign-66e-pre-buyer','cold-buyer-detail66e','BUYER_PRE_SALES_OWNER',
        'staff-66e-pre','ACTIVE','MANUAL_REASSIGN','STAFF','cold-archive-owner',
        'stage75 test rebind',1,1000,1000,NULL);
    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id, purpose, visibility, status,
      requested_file_count, manifest_hash, version, expires_at,
      failure_code, created_at, updated_at, completed_at
    ) VALUES ('intent-66e-comm','STAFF','staff-66e-refund',
      'ORDER_COMMUNICATION_SCREENSHOT','SELLER_VISIBLE','ISSUED',1,
      '${'2'.repeat(64)}',1,9999999999999,NULL,7000,7000,NULL);
    INSERT INTO file_objects (
      id, upload_intent_id, slot_no, purpose, visibility, object_key,
      client_file_name, extension, declared_mime, expected_byte_size, status,
      upload_token_hash, upload_expires_at, uploaded_byte_size, detected_mime,
      uploaded_sha256, failure_code, delete_attempt_count, next_delete_at,
      version, created_at, updated_at, uploaded_at, verified_at, deleted_at
    ) VALUES ('file-66e-comm','intent-66e-comm',1,
      'ORDER_COMMUNICATION_SCREENSHOT','SELLER_VISIBLE',
      'files/v1/comm/${'3'.repeat(30)}','comm-66e.png','png','image/png',10,'RESERVED',
      '${'4'.repeat(64)}',9999999999999,NULL,NULL,NULL,NULL,0,NULL,
      1,7000,7000,NULL,NULL,NULL);
    UPDATE file_upload_intents
    SET status='VERIFIED', version=2, updated_at=7001, completed_at=7001
    WHERE id='intent-66e-comm';
    UPDATE file_objects
    SET status='VERIFIED', version=2, uploaded_byte_size=10,
        detected_mime='image/png', uploaded_sha256='${'5'.repeat(64)}',
        updated_at=7001, uploaded_at=7000, verified_at=7001
    WHERE id='file-66e-comm';
  `);
  await attachOrderCommunicationScreenshot(d, {
    formalOrderId: orderId,
    fileObjectId: 'file-66e-comm',
    expectedFileVersion: 2,
  }, {
    actor: {
      staffId: 'staff-66e-refund',
      displayName: '返款员工',
      staffStatus: 'ACTIVE',
      authorizationVersion: 1,
      roles: new Set(['buyer_refund' as const]),
      permissions: new Set(['ORDER_VIEW' as const]),
      memberTeamIds: [],
      leaderTeamIds: [],
    },
    idempotencyKey: 'attach-66e-0001',
    now: 8000,
    requestId: 'request-attach-66e',
  });
}
