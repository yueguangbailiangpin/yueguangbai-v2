import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import {
  prepareDirectWorkItem,
  prepareInitialBuyerAssignment,
  prepareInitialSellerAssignment,
  prepareWorkItemCompletionStatements,
} from './assignment-service';
import { isStaffEligibleForFixedDuty } from './candidate-resolver';
import { resolveAssignmentStaffAuthorization } from './effective-authorization';
import { resolveStaffDataScope } from './data-scope';
import { listVisibleWorkItems } from './read-model';

let database: SqliteDatabase | null = null;
afterEach(() => { database?.close(); database = null; });

function db(): SqliteDatabase {
  database = createMigratedTestDatabase();
  seedFoundation(database);
  return database;
}

function seedFoundation(d: SqliteDatabase): void {
  d.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version, version,
      created_at, updated_at, disabled_at
    ) VALUES
      ('owner-1','Owner','ACTIVE',1,1,1,1,NULL),
      ('pre-1','Pre 1','ACTIVE',1,1,1,1,NULL),
      ('pre-2','Pre 2','ACTIVE',1,1,1,1,NULL),
      ('after-1','After 1','ACTIVE',1,1,1,1,NULL);
    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id, assigned_at,
      revoked_at, created_at, updated_at
    ) VALUES
      ('owner-1','owner','ACTIVE',NULL,1,NULL,1,1),
      ('pre-1','pre_sales','ACTIVE','owner-1',1,NULL,1,1),
      ('pre-2','pre_sales','ACTIVE','owner-1',1,NULL,1,1),
      ('after-1','buyer_refund','ACTIVE','owner-1',1,NULL,1,1);
    INSERT INTO staff_marketplace_scopes (
      id, staff_id, role_code, marketplace_code, status,
      assigned_by_staff_id, assigned_at, revoked_at, reason,
      created_at, updated_at, scope_kind
    ) VALUES
      ('scope-pre-1-amazon-jp','pre-1','pre_sales','AMAZON_JP','ACTIVE',
        'owner-1',1,NULL,'TEST_PRIMARY',1,1,'PRIMARY'),
      ('scope-pre-2-amazon-jp','pre-2','pre_sales','AMAZON_JP','ACTIVE',
        'owner-1',1,NULL,'TEST_SUPPORT',1,1,'SUPPORT'),
      ('scope-after-1-amazon-jp','after-1','buyer_refund','AMAZON_JP','ACTIVE',
        'owner-1',1,NULL,'TEST_PRIMARY',1,1,'PRIMARY');
    INSERT INTO customer_identity_subjects (id, subject_type, created_at)
    VALUES ('buyer-subject-1','BUYER_CUSTOMER',1),
           ('buyer-subject-2','BUYER_CUSTOMER',1);
    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code, buyer_channel_id,
      buyer_customer_no, buyer_sequence,
      display_name, access_status, identity_review_status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES
      ('buyer-1','buyer-subject-1','AMAZON_JP','buyer-channel-wechat-b',
        '19700101B0001', 1,
        'Buyer 1','DISABLED','CLEAR',1,1,1,NULL,1),
      ('buyer-2','buyer-subject-2','AMAZON_JP','buyer-channel-wechat-b',
        '19700101B0002', 2,
        'Buyer 2','DISABLED','CLEAR',1,1,1,NULL,1);
    UPDATE staff_users
    SET status='DISABLED', disabled_at=2, version=version+1, updated_at=2
    WHERE id='zz-phase3h-test-owner';
  `);
}

async function bindBuyerPreSalesOwner(
  d: SqliteDatabase,
  buyerCustomerId: string,
  staffId: string,
): Promise<string> {
  const prepared = await prepareInitialBuyerAssignment(d, {
    buyerCustomerId,
    marketplaceCode: 'AMAZON_JP',
    actorType: 'STAFF',
    actorId: staffId,
    now: 10,
  });
  await d.batch(prepared.statements);
  return prepared.assignmentId;
}

describe('D-056 fixed-duty staff assignment foundation', () => {
  it('runs the assignment foundation on the stage 6.6B baseline', async () => {
    const d = db();
    expect(d.raw.prepare(`SELECT schema_version FROM app_schema_state WHERE singleton_id=1`).get())
      .toEqual({ schema_version: 36 });
    expect(d.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(d.raw.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  });

  it('binds the creating staff member as the initial buyer pre-sales owner', async () => {
    const d = db();
    const assignmentId = await bindBuyerPreSalesOwner(d, 'buyer-1', 'pre-1');
    expect(d.raw.prepare(`SELECT staff_id, duty_code, status FROM buyer_staff_assignments
      WHERE id=?`).get(assignmentId))
      .toEqual({ staff_id: 'pre-1', duty_code: 'BUYER_PRE_SALES_OWNER', status: 'ACTIVE' });
    const replay = await prepareInitialBuyerAssignment(d, {
      buyerCustomerId: 'buyer-1',
      marketplaceCode: 'AMAZON_JP',
      actorType: 'STAFF',
      actorId: 'pre-2',
      now: 20,
    });
    expect(replay.replayedExisting).toBe(true);
    expect(replay.assignedStaffId).toBe('pre-1');
    expect(replay.statements).toHaveLength(0);
  });

  it('fails closed when the creator cannot hold the buyer duty', async () => {
    const d = db();
    await expect(prepareInitialBuyerAssignment(d, {
      buyerCustomerId: 'buyer-1',
      marketplaceCode: 'AMAZON_JP',
      actorType: 'STAFF',
      actorId: 'after-1',
      now: 10,
    })).rejects.toMatchObject({ code: 'BUYER_PRE_SALES_OWNER_NOT_ASSIGNED' });
    await expect(prepareInitialBuyerAssignment(d, {
      buyerCustomerId: 'buyer-2',
      marketplaceCode: 'AMAZON_JP',
      actorType: 'SYSTEM',
      now: 10,
    })).rejects.toMatchObject({ code: 'BUYER_PRE_SALES_OWNER_NOT_ASSIGNED' });
  });

  it('assigns work items to the fixed owner and preserves it on replay', async () => {
    const d = db();
    await bindBuyerPreSalesOwner(d, 'buyer-1', 'pre-1');
    const input = {
      workType: 'RESERVATION_DECISION' as const,
      sourceEntityType: 'RESERVATION' as const,
      sourceEntityId: 'reservation-1',
      marketplaceCode: 'AMAZON_JP',
      buyerCustomerId: 'buyer-1',
      actorType: 'SYSTEM' as const,
      actorId: 'system:test',
      idempotencyKey: 'reservation-1-created',
      now: 100,
    };
    const prepared = await prepareDirectWorkItem(d, input);
    await d.batch(prepared.statements);
    expect(d.raw.prepare(`SELECT assigned_staff_id, fixed_assignment_id, status
      FROM staff_work_items WHERE id=?`).get(prepared.workItemId))
      .toMatchObject({ assigned_staff_id: 'pre-1', status: 'OPEN' });
    const replay = await prepareDirectWorkItem(d, input);
    expect(replay.replayedExisting).toBe(true);
    expect(replay.workItemId).toBe(prepared.workItemId);
    expect(replay.statements).toHaveLength(0);
    expect(d.raw.prepare(`SELECT COUNT(*) AS count FROM buyer_staff_assignments
      WHERE buyer_customer_id='buyer-1' AND duty_code='BUYER_PRE_SALES_OWNER'`).get())
      .toEqual({ count: 1 });
  });

  it('fails closed with a stable code when the buyer duty owner is missing or ineligible', async () => {
    const d = db();
    await expect(prepareDirectWorkItem(d, {
      workType: 'RESERVATION_DECISION', sourceEntityType: 'RESERVATION',
      sourceEntityId: 'reservation-unbound', marketplaceCode: 'AMAZON_JP',
      buyerCustomerId: 'buyer-1', actorType: 'SYSTEM', now: 100,
    })).rejects.toMatchObject({ code: 'BUYER_PRE_SALES_OWNER_NOT_ASSIGNED' });

    await bindBuyerPreSalesOwner(d, 'buyer-2', 'pre-1');
    d.exec(`UPDATE staff_users
      SET status='DISABLED', disabled_at=20, version=version+1, updated_at=20
      WHERE id='pre-1'`);
    await expect(prepareDirectWorkItem(d, {
      workType: 'ORDER_EVIDENCE_REVIEW', sourceEntityType: 'ORDER_EVIDENCE',
      sourceEntityId: 'evidence-disabled-owner', marketplaceCode: 'AMAZON_JP',
      buyerCustomerId: 'buyer-2', actorType: 'SYSTEM', now: 120,
    })).rejects.toMatchObject({ code: 'BUYER_PRE_SALES_OWNER_NOT_ASSIGNED' });
  });

  it('routes review and refund duties to the buyer refund owner', async () => {
    const d = db();
    await bindBuyerPreSalesOwner(d, 'buyer-1', 'pre-1');
    d.exec(`INSERT INTO buyer_staff_assignments (
      id, buyer_customer_id, duty_code, staff_id, status, source,
      assigned_by_actor_type, assigned_by_actor_id, reason, version,
      created_at, updated_at, revoked_at
    ) VALUES ('refund-binding-1','buyer-1','BUYER_REFUND_OWNER','after-1','ACTIVE',
      'AUTO_INITIAL','STAFF','owner-1',NULL,1,10,10,NULL)`);
    const review = await prepareDirectWorkItem(d, {
      workType: 'REVIEW_DECISION', sourceEntityType: 'REVIEW_CASE',
      sourceEntityId: 'review-1', marketplaceCode: 'AMAZON_JP',
      buyerCustomerId: 'buyer-1', actorType: 'SYSTEM', now: 100,
    });
    expect(review.assignedStaffId).toBe('after-1');
    await d.batch(review.statements);
    expect(d.raw.prepare(`SELECT duty_code FROM staff_work_items
      WHERE id=?`).get(review.workItemId)).toEqual({ duty_code: 'BUYER_REFUND_OWNER' });
  });

  it('requires the seller duty to be an eligible seller_ops staff member', async () => {
    const d = db();
    d.exec(`
      INSERT INTO seller_channels (
        id, code, prefix, name, status, version, created_at, updated_at, disabled_at
      ) VALUES ('seller-channel-test-1','testch1','testch1-','Test Channel','ACTIVE',1,1,1,NULL);
      INSERT INTO seller_organizations (
        id, marketplace_code, seller_code, origin_channel_id, current_channel_id,
        seller_sequence, organization_name, status, version,
        created_at, updated_at, activated_at
      ) VALUES ('seller-org-1','AMAZON_JP','test-seller-1','seller-channel-test-1',
        'seller-channel-test-1',1,'Seller Org 1','ACTIVE',1,1,1,1);
    `);
    await expect(prepareInitialSellerAssignment(d, {
      sellerOrganizationId: 'seller-org-1',
      marketplaceCode: 'AMAZON_JP',
      actorType: 'STAFF',
      actorId: 'pre-1',
      now: 10,
    })).rejects.toMatchObject({ code: 'SELLER_ACCOUNT_MANAGER_NOT_ASSIGNED' });
  });

  it('removes fixed-duty eligibility through a personal DENY', async () => {
    const d = db();
    expect(await isStaffEligibleForFixedDuty(d, {
      staffId: 'pre-1', dutyCode: 'BUYER_PRE_SALES_OWNER', marketplaceCode: 'AMAZON_JP',
    })).toBe(true);
    d.exec(`INSERT INTO staff_permission_overrides (
      staff_id, permission_code, effect, status, reason,
      assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
    ) VALUES ('pre-1','ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES','DENY','ACTIVE',
      'test deny','owner-1',20,NULL,20,20)`);
    expect(await isStaffEligibleForFixedDuty(d, {
      staffId: 'pre-1', dutyCode: 'BUYER_PRE_SALES_OWNER', marketplaceCode: 'AMAZON_JP',
    })).toBe(false);
  });

  it('never expands fixed-duty eligibility through legacy personal grants', async () => {
    const d = db();
    const support = await resolveAssignmentStaffAuthorization(d, 'owner-1');
    expect(support?.permissions.has('ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT')).toBe(true);
    d.exec(`
      INSERT INTO staff_users (
        id, display_name, status, authorization_version, version,
        created_at, updated_at, disabled_at
      ) VALUES ('support-1','Seller Support','ACTIVE',1,1,1,1,NULL);
      INSERT INTO staff_role_assignments (
        staff_id, role_code, status, assigned_by_staff_id, assigned_at,
        revoked_at, created_at, updated_at
      ) VALUES ('support-1','pre_sales','ACTIVE','owner-1',1,NULL,1,1);
    `);
    const supportAuthorization = await resolveAssignmentStaffAuthorization(d, 'support-1');
    expect(supportAuthorization?.permissions.has('ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT')).toBe(false);
    expect(await isStaffEligibleForFixedDuty(d, {
      staffId: 'support-1', dutyCode: 'SELLER_ACCOUNT_MANAGER', marketplaceCode: 'AMAZON_JP',
    })).toBe(false);
    expect(() => d.exec(`
      INSERT INTO staff_permission_overrides (
        staff_id, permission_code, effect, status, reason,
        assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
      ) VALUES
        ('support-1','DEMAND_PUBLISH','GRANT','ACTIVE','test',
          'owner-1',3,NULL,3,3);
    `)).toThrow('staff_permission_active_grant_forbidden');
    expect(await isStaffEligibleForFixedDuty(d, {
      staffId: 'support-1', dutyCode: 'SELLER_ACCOUNT_MANAGER', marketplaceCode: 'AMAZON_JP',
    })).toBe(false);
  });

  it('requires a business permission personally denied to break fixed duty eligibility', async () => {
    const d = db();
    d.exec(`INSERT INTO staff_permission_overrides (
      staff_id, permission_code, effect, status, reason,
      assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
    ) VALUES ('pre-1','BUYER_VIEW','DENY','ACTIVE',
      'required permission deny','owner-1',20,NULL,20,20)`);
    expect(await isStaffEligibleForFixedDuty(d, {
      staffId: 'pre-1', dutyCode: 'BUYER_PRE_SALES_OWNER', marketplaceCode: 'AMAZON_JP',
    })).toBe(false);
  });

  it('excludes disabled PRIMARY staff from fixed-duty eligibility', async () => {
    const d = db();
    expect(await isStaffEligibleForFixedDuty(d, {
      staffId: 'pre-1', dutyCode: 'BUYER_PRE_SALES_OWNER', marketplaceCode: 'AMAZON_JP',
    })).toBe(true);
    d.exec(`UPDATE staff_users
      SET status='DISABLED', disabled_at=20, version=version+1, updated_at=20
      WHERE id='pre-1'`);
    expect(await isStaffEligibleForFixedDuty(d, {
      staffId: 'pre-1', dutyCode: 'BUYER_PRE_SALES_OWNER', marketplaceCode: 'AMAZON_JP',
    })).toBe(false);
  });

  it('resolves business visibility from Role × Marketplace instead of assignment ownership', async () => {
    const d = db();
    await bindBuyerPreSalesOwner(d, 'buyer-1', 'pre-1');
    const actor = await resolveAssignmentStaffAuthorization(d, 'pre-1');
    expect(actor).not.toBeNull();
    const scope = await resolveStaffDataScope(d, actor!, { requiredPermission: 'BUYER_VIEW' });
    expect(scope.buyerCustomerIds).toContain('buyer-1');
    expect(scope.buyerCustomerIds).toContain('buyer-2');
  });

  it('shows the OPEN queue to the fixed owner while SUPPORT stays business-visible only', async () => {
    const d = db();
    await bindBuyerPreSalesOwner(d, 'buyer-1', 'pre-1');
    const prepared = await prepareDirectWorkItem(d, {
      workType: 'RESERVATION_DECISION', sourceEntityType: 'RESERVATION',
      sourceEntityId: 'reservation-primary-queue', marketplaceCode: 'AMAZON_JP',
      buyerCustomerId: 'buyer-1', actorType: 'SYSTEM', now: 100,
    });
    await d.batch(prepared.statements);
    const primary = await resolveAssignmentStaffAuthorization(d, 'pre-1');
    const support = await resolveAssignmentStaffAuthorization(d, 'pre-2');
    expect((await listVisibleWorkItems(d, primary!)).work_items).toHaveLength(1);
    expect((await listVisibleWorkItems(d, support!)).work_items).toEqual([]);
    expect((await resolveStaffDataScope(d, support!, {
      requiredPermission: 'BUYER_VIEW',
    })).buyerCustomerIds).toContain('buyer-1');
  });

  it('gives the explicit Owner global scope without team membership', async () => {
    const d = db();
    const owner = await resolveAssignmentStaffAuthorization(d, 'owner-1');
    expect(owner).not.toBeNull();
    expect(await resolveStaffDataScope(d, owner!, {
      requiredPermission: 'BUYER_VIEW',
    })).toEqual({
      type: 'GLOBAL',
      marketplaceCodes: [],
      buyerCustomerIds: [],
      sellerOrganizationIds: [],
      teamIds: [],
    });
  });

  it('rejects destructive history edits', async () => {
    const d = db();
    await bindBuyerPreSalesOwner(d, 'buyer-1', 'pre-1');
    const prepared = await prepareDirectWorkItem(d, {
      workType: 'RESERVATION_DECISION', sourceEntityType: 'RESERVATION',
      sourceEntityId: 'reservation-outbox', marketplaceCode: 'AMAZON_JP',
      buyerCustomerId: 'buyer-1', actorType: 'SYSTEM',
      idempotencyKey: 'reservation-outbox', now: 100,
    });
    await d.batch(prepared.statements);
    expect(() => d.exec(`DELETE FROM staff_work_items
      WHERE id='${prepared.workItemId}'`)).toThrow('staff_work_items_are_immutable');
    expect(() => d.exec(`DELETE FROM buyer_staff_assignments
      WHERE id='${prepared.assignmentId}'`)).toThrow('buyer_staff_assignments_are_immutable');
  });

  it('completes open work items idempotently and keeps the completion event', async () => {
    const d = db();
    await bindBuyerPreSalesOwner(d, 'buyer-1', 'pre-1');
    const prepared = await prepareDirectWorkItem(d, {
      workType: 'RESERVATION_DECISION', sourceEntityType: 'RESERVATION',
      sourceEntityId: 'reservation-complete', marketplaceCode: 'AMAZON_JP',
      buyerCustomerId: 'buyer-1', actorType: 'SYSTEM', now: 100,
    });
    await d.batch(prepared.statements);
    const completion = await prepareWorkItemCompletionStatements(d, {
      workType: 'RESERVATION_DECISION', sourceEntityType: 'RESERVATION',
      sourceEntityId: 'reservation-complete', outcome: 'COMPLETED',
      actorType: 'SYSTEM', now: 200,
    });
    await d.batch(completion);
    expect(d.raw.prepare(`SELECT status FROM staff_work_items
      WHERE id=?`).get(prepared.workItemId)).toEqual({ status: 'COMPLETED' });
    expect(d.raw.prepare(`SELECT COUNT(*) AS count FROM staff_assignment_events
      WHERE work_item_id=? AND event_type='WORK_ITEM_COMPLETED'`).get(prepared.workItemId))
      .toEqual({ count: 1 });
    const again = await prepareWorkItemCompletionStatements(d, {
      workType: 'RESERVATION_DECISION', sourceEntityType: 'RESERVATION',
      sourceEntityId: 'reservation-complete', outcome: 'COMPLETED',
      actorType: 'SYSTEM', now: 300,
    });
    expect(again).toHaveLength(0);
  });
});
