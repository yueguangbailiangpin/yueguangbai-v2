import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import type { AppEnv } from '../app';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { registerOrderCommunicationScreenshotRoutes } from './routes';
import { seedConfirmedColdArchiveOrder } from '../../test-support/cold-archive-fixture';
import { attachOrderCommunicationScreenshot } from './command';
import {
  listOrderCommunicationScreenshots,
  requireOrderCommunicationScreenshotForSeller,
} from './read-model';
import type { SellerPortalActor } from '../seller-portal/actor';

let database: SqliteDatabase | null = null;
let orderId = '';

beforeEach(async () => {
  database = createMigratedTestDatabase();
  seedFixture(database);
  const order = await seedConfirmedColdArchiveOrder(database, 'comm-test');
  orderId = order.formalOrderId;
});
afterEach(() => {
  database?.close();
  database = null;
});

describe('D-056 §4.1 unified order communication screenshots', () => {
  it('attaches multiple screenshots to one order with audience grants and audit', async () => {
    const d = database!;
    await attachOrderCommunicationScreenshot(d, {
      formalOrderId: orderId,
      fileObjectId: 'comm-file-1',
      expectedFileVersion: 2,
    }, command('comm-attach-0001', 8000));
    const second = await attachOrderCommunicationScreenshot(d, {
      formalOrderId: orderId,
      fileObjectId: 'comm-file-2',
      expectedFileVersion: 2,
    }, command('comm-attach-0002', 8100));
    expect(second.replayed).toBe(false);

    const listed = await listOrderCommunicationScreenshots(d, [orderId]);
    expect(listed.get(orderId)).toHaveLength(2);

    expect(d.raw.prepare(`SELECT COUNT(*) AS c FROM file_entity_links
      WHERE entity_type='ORDER' AND entity_id=? AND revoked_at IS NULL`)
      .get(orderId)).toEqual({ c: 2 });
    expect(d.raw.prepare(`SELECT COUNT(*) AS c FROM file_entity_audience_grants
      WHERE subject_type='SELLER_ORGANIZATION' AND seller_organization_id=?`)
      .get('cold-seller-comm-test')).toEqual({ c: 2 });
    expect(d.raw.prepare(`SELECT COUNT(*) AS c FROM audit_events
      WHERE event_type='ORDER_COMMUNICATION_SCREENSHOT_ATTACHED'`)
      .get()).toEqual({ c: 2 });
  });

  it('replays the same attach idempotently', async () => {
    const d = database!;
    await attachOrderCommunicationScreenshot(d, {
      formalOrderId: orderId,
      fileObjectId: 'comm-file-1',
      expectedFileVersion: 2,
    }, command('comm-replay-0001', 8000));
    const replay = await attachOrderCommunicationScreenshot(d, {
      formalOrderId: orderId,
      fileObjectId: 'comm-file-1',
      expectedFileVersion: 2,
    }, command('comm-replay-0001', 9000));
    expect(replay.replayed).toBe(true);
    expect(d.raw.prepare(`SELECT COUNT(*) AS c FROM file_entity_links
      WHERE entity_type='ORDER' AND entity_id=? AND revoked_at IS NULL`)
      .get(orderId)).toEqual({ c: 1 });
  });

  it('lets any organization member read while other organizations get concealed 404', async () => {
    const d = database!;
    await attachOrderCommunicationScreenshot(d, {
      formalOrderId: orderId,
      fileObjectId: 'comm-file-1',
      expectedFileVersion: 2,
    }, command('comm-seller-0001', 8000));
    const member = await requireOrderCommunicationScreenshotForSeller(
      d, sellerActor('OPERATIONS'), orderId, 'comm-file-1');
    expect(member.fileVersion).toBe(2);
    const finance = await requireOrderCommunicationScreenshotForSeller(
      d, sellerActor('FINANCE'), orderId, 'comm-file-1');
    expect(finance.fileObjectId).toBe('comm-file-1');
    await expect(requireOrderCommunicationScreenshotForSeller(
      d, sellerActorOfOtherOrg(), orderId, 'comm-file-1',
    )).rejects.toMatchObject({ code: 'FORMAL_ORDER_NOT_FOUND' });
  });

  it('exposes no buyer-facing route for the unified purpose', async () => {
    const app = new Hono<AppEnv>();
    registerOrderCommunicationScreenshotRoutes(app);
    const buyerPaths = app.routes
      .map((route) => route.path)
      .filter((path) => path.startsWith('/api/buyer'));
    expect(buyerPaths).toEqual([]);
  });
});

function command(idempotencyKey: string, now: number) {
  return {
    actor: staffActor(),
    idempotencyKey,
    now,
    requestId: `request-${idempotencyKey}`,
  };
}

function staffActor(): AssignmentStaffAuthorization {
  return {
    staffId: 'cold-archive-owner',
    displayName: '沟通截图上传',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: new Set(['owner' as const]),
    permissions: new Set(['ORDER_VIEW' as const]),
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}

function sellerActor(role: 'OPERATIONS' | 'FINANCE'): SellerPortalActor {
  return {
    accountId: 'account-member',
    identitySubjectId: 'subject-member',
    memberId: 'member-comm-1',
    sellerOrganizationId: 'cold-seller-comm-test',
    role,
    storeIds: ['store-comm-1'],
    allActiveStores: true,
    canManageProducts: true,
    me: null as never,
  };
}

function sellerActorOfOtherOrg(): SellerPortalActor {
  return {
    ...sellerActor('OPERATIONS'),
    sellerOrganizationId: 'some-other-organization',
    memberId: 'member-other-org',
  };
}

function seedFixture(d: SqliteDatabase): void {
  d.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version, version,
      created_at, updated_at, disabled_at
    ) VALUES ('staff-comm-uploader','沟通截图上传','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id, assigned_at,
      revoked_at, created_at, updated_at
    ) VALUES ('staff-comm-uploader','owner','ACTIVE',NULL,1000,NULL,1000,1000);

    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id, purpose, visibility, status,
      requested_file_count, manifest_hash, version, expires_at,
      failure_code, created_at, updated_at, completed_at
    ) VALUES
      ('comm-intent-1','STAFF','cold-archive-owner','ORDER_COMMUNICATION_SCREENSHOT',
       'SELLER_VISIBLE','ISSUED',1,'${'a'.repeat(64)}',1,9999999999999,NULL,7000,7000,NULL),
      ('comm-intent-2','STAFF','cold-archive-owner','ORDER_COMMUNICATION_SCREENSHOT',
       'SELLER_VISIBLE','ISSUED',1,'${'e'.repeat(64)}',1,9999999999999,NULL,7000,7000,NULL);
    INSERT INTO file_objects (
      id, upload_intent_id, slot_no, purpose, visibility, object_key,
      client_file_name, extension, declared_mime, expected_byte_size, status,
      upload_token_hash, upload_expires_at, uploaded_byte_size, detected_mime,
      uploaded_sha256, failure_code, delete_attempt_count, next_delete_at,
      version, created_at, updated_at, uploaded_at, verified_at, deleted_at
    ) VALUES
      ('comm-file-1','comm-intent-1',1,'ORDER_COMMUNICATION_SCREENSHOT','SELLER_VISIBLE',
       'files/v1/comm/${'c'.repeat(30)}1','chat-1.png','png','image/png',11,'RESERVED',
       '${'b'.repeat(64)}',9999999999999,NULL,NULL,NULL,
       NULL,0,NULL,1,7000,7000,NULL,NULL,NULL),
      ('comm-file-2','comm-intent-2',1,'ORDER_COMMUNICATION_SCREENSHOT','SELLER_VISIBLE',
       'files/v1/comm/${'d'.repeat(30)}2','chat-2.png','png','image/png',12,'RESERVED',
       '${'f'.repeat(64)}',9999999999999,NULL,NULL,NULL,
       NULL,0,NULL,1,7000,7000,NULL,NULL,NULL);
    UPDATE file_upload_intents
      SET status='VERIFIED', version=2, updated_at=7001, completed_at=7001
      WHERE id IN ('comm-intent-1','comm-intent-2');
    UPDATE file_objects
      SET status='VERIFIED', version=2, uploaded_byte_size=11,
          detected_mime='image/png', uploaded_sha256='${'1'.repeat(64)}',
          updated_at=7001, uploaded_at=7000, verified_at=7001
      WHERE id='comm-file-1';
    UPDATE file_objects
      SET status='VERIFIED', version=2, uploaded_byte_size=12,
          detected_mime='image/png', uploaded_sha256='${'2'.repeat(64)}',
          updated_at=7001, uploaded_at=7000, verified_at=7001
      WHERE id='comm-file-2';
  `);
}
