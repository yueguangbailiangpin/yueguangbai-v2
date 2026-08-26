import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import {
  prepareDirectWorkItem,
  createCursorAdvanceStatements,
} from './assignment-service';
import {
  resolveRoundRobinCandidate,
  resolveRoundRobinFixedDutyCandidate,
  resolveOwnerFallback,
} from './candidate-resolver';
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

describe('Phase 3H staff assignment foundation', () => {
  it('runs the assignment foundation on the stage 3 clean baseline', async () => {
    const d = db();
    expect(d.raw.prepare(`SELECT schema_version FROM app_schema_state WHERE singleton_id=1`).get())
      .toEqual({ schema_version: 27 });
    expect(d.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(d.raw.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  });

  it('assigns only the Marketplace PRIMARY and personal DENY removes it', async () => {
    const d = db();
    const first = await resolveRoundRobinCandidate(d, {
      dutyCode: 'BUYER_PRE_SALES_OWNER',
      workType: 'RESERVATION_DECISION',
      marketplaceCode: 'AMAZON_JP',
    });
    expect(first?.staff.staffId).toBe('pre-1');
    await d.batch(createCursorAdvanceStatements(d, first!, first!.staff.staffId, 10));
    const second = await resolveRoundRobinCandidate(d, {
      dutyCode: 'BUYER_PRE_SALES_OWNER',
      workType: 'RESERVATION_DECISION',
      marketplaceCode: 'AMAZON_JP',
    });
    expect(second?.staff.staffId).toBe('pre-1');

    d.exec(`INSERT INTO staff_permission_overrides (
      staff_id, permission_code, effect, status, reason,
      assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
    ) VALUES ('pre-1','ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES','DENY','ACTIVE',
      'test deny','owner-1',20,NULL,20,20)`);
    const afterDeny = await resolveRoundRobinCandidate(d, {
      dutyCode: 'BUYER_PRE_SALES_OWNER',
      workType: 'RESERVATION_DECISION',
      marketplaceCode: 'AMAZON_JP',
    });
    expect(afterDeny).toBeNull();
  });

  it('creates a directly assigned work item and preserves fixed owner on replay', async () => {
    const d = db();
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
    const row = d.raw.prepare(`SELECT assigned_staff_id, fixed_assignment_id, status
      FROM staff_work_items WHERE id=?`).get(prepared.workItemId);
    expect(row).toEqual({
      assigned_staff_id: 'pre-1',
      fixed_assignment_id: prepared.assignmentId,
      status: 'OPEN',
    });
    const replay = await prepareDirectWorkItem(d, input);
    expect(replay.replayedExisting).toBe(true);
    expect(replay.workItemId).toBe(prepared.workItemId);
    expect(replay.statements).toHaveLength(0);
  });

  it('ignores retired Availability state and keeps the PRIMARY owner', async () => {
    const d = db();
    const first = await prepareDirectWorkItem(d, {
      workType: 'RESERVATION_DECISION', sourceEntityType: 'RESERVATION',
      sourceEntityId: 'reservation-1', marketplaceCode: 'AMAZON_JP',
      buyerCustomerId: 'buyer-1', actorType: 'SYSTEM', now: 100,
    });
    await d.batch(first.statements);
    d.exec(`INSERT INTO staff_availability (
      staff_id, availability_status, reason, changed_by_staff_id,
      version, created_at, updated_at
    ) VALUES ('pre-1','UNAVAILABLE','leave','pre-1',1,110,110)`);
    const second = await prepareDirectWorkItem(d, {
      workType: 'ORDER_EVIDENCE_REVIEW', sourceEntityType: 'ORDER_EVIDENCE',
      sourceEntityId: 'evidence-1', marketplaceCode: 'AMAZON_JP',
      buyerCustomerId: 'buyer-1', actorType: 'SYSTEM', now: 120,
    });
    await d.batch(second.statements);
    expect(second.assignedStaffId).toBe('pre-1');
    expect(d.raw.prepare(`SELECT COUNT(*) AS count FROM buyer_staff_assignments
      WHERE buyer_customer_id='buyer-1' AND duty_code='BUYER_PRE_SALES_OWNER'`).get())
      .toEqual({ count: 1 });
    expect(d.raw.prepare(`SELECT staff_id FROM buyer_staff_assignments
      WHERE buyer_customer_id='buyer-1' AND duty_code='BUYER_PRE_SALES_OWNER'
        AND status='ACTIVE'`).get()).toEqual({ staff_id: 'pre-1' });
  });

  it('does not select an arbitrary owner when fallback is absent or invalid', async () => {
    const d = db();
    await expect(resolveOwnerFallback(d, {
      marketplaceCode: 'AMAZON_JP', dutyCode: 'BUYER_PRE_SALES_OWNER',
      workType: 'RESERVATION_DECISION',
    })).rejects.toMatchObject({ code: 'OWNER_FALLBACK_NOT_CONFIGURED' });
    d.exec(`INSERT INTO staff_assignment_fallbacks (
      marketplace_code, staff_id, version, configured_by_staff_id,
      created_at, updated_at
    ) VALUES ('AMAZON_JP','owner-1',1,'owner-1',1,1)`);
    expect((await resolveOwnerFallback(d, {
      marketplaceCode: 'AMAZON_JP', dutyCode: 'BUYER_PRE_SALES_OWNER',
      workType: 'RESERVATION_DECISION',
    })).staffId).toBe('owner-1');
  });

  it('resolves business visibility from Role × Marketplace instead of assignment ownership', async () => {
    const d = db();
    const prepared = await prepareDirectWorkItem(d, {
      workType: 'RESERVATION_DECISION', sourceEntityType: 'RESERVATION',
      sourceEntityId: 'reservation-1', marketplaceCode: 'AMAZON_JP',
      buyerCustomerId: 'buyer-1', actorType: 'SYSTEM', now: 100,
    });
    await d.batch(prepared.statements);
    const actor = await resolveAssignmentStaffAuthorization(d, prepared.assignedStaffId);
    expect(actor).not.toBeNull();
    const scope = await resolveStaffDataScope(d, actor!, { requiredPermission: 'BUYER_VIEW' });
    expect(scope.buyerCustomerIds).toContain('buyer-1');
    expect(scope.buyerCustomerIds).toContain('buyer-2');
  });

  it('shows the OPEN queue to PRIMARY while SUPPORT remains business-visible only', async () => {
    const d = db();
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

  it('applies business-permission DENY inside SQL candidate selection', async () => {
    const d = db();
    d.exec(`INSERT INTO staff_permission_overrides (
      staff_id, permission_code, effect, status, reason,
      assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
    ) VALUES ('pre-1','RESERVATION_DECIDE','DENY','ACTIVE',
      'business deny','owner-1',20,NULL,20,20)`);
    const candidate = await resolveRoundRobinCandidate(d, {
      dutyCode: 'BUYER_PRE_SALES_OWNER',
      workType: 'RESERVATION_DECISION',
      marketplaceCode: 'AMAZON_JP',
    });
    expect(candidate).toBeNull();
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
    expect(await resolveRoundRobinFixedDutyCandidate(d, {
      dutyCode: 'SELLER_ACCOUNT_MANAGER', marketplaceCode: 'AMAZON_JP',
    })).toBeNull();

    expect(() => d.exec(`
      INSERT INTO staff_permission_overrides (
        staff_id, permission_code, effect, status, reason,
        assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
      ) VALUES
        ('support-1','DEMAND_PUBLISH','GRANT','ACTIVE','test',
          'owner-1',3,NULL,3,3);
    `)).toThrow('staff_permission_active_grant_forbidden');
    const candidate = await resolveRoundRobinFixedDutyCandidate(d, {
      dutyCode: 'SELLER_ACCOUNT_MANAGER', marketplaceCode: 'AMAZON_JP',
    });
    expect(candidate).toBeNull();
  });

  it('rejects a fixed-duty candidate when any required permission is personally denied', async () => {
    const d = db();
    d.exec(`INSERT INTO staff_permission_overrides (
      staff_id, permission_code, effect, status, reason,
      assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
    ) VALUES ('pre-1','BUYER_VIEW','DENY','ACTIVE',
      'required permission deny','owner-1',20,NULL,20,20)`);
    const candidate = await resolveRoundRobinFixedDutyCandidate(d, {
      dutyCode: 'BUYER_PRE_SALES_OWNER', marketplaceCode: 'AMAZON_JP',
    });
    expect(candidate).toBeNull();
  });

  it('ignores retired Availability but excludes disabled PRIMARY staff', async () => {
    const d = db();
    d.exec(`
      INSERT INTO staff_availability (
        staff_id, availability_status, reason, changed_by_staff_id,
        version, created_at, updated_at
      ) VALUES ('pre-1','UNAVAILABLE','leave','pre-1',1,20,20);
    `);
    expect((await resolveRoundRobinCandidate(d, {
      dutyCode: 'BUYER_PRE_SALES_OWNER',
      workType: 'RESERVATION_DECISION',
      marketplaceCode: 'AMAZON_JP',
    }))?.staff.staffId).toBe('pre-1');
    d.exec(`UPDATE staff_users
      SET status='DISABLED', disabled_at=20, version=version+1, updated_at=20
      WHERE id='pre-1'`);
    expect(await resolveRoundRobinCandidate(d, {
      dutyCode: 'BUYER_PRE_SALES_OWNER',
      workType: 'RESERVATION_DECISION',
      marketplaceCode: 'AMAZON_JP',
    })).toBeNull();
  });

  it('uses explicit fallback without advancing the round-robin cursor', async () => {
    const d = db();
    d.exec(`
      UPDATE staff_users
      SET status='DISABLED', disabled_at=20, version=version+1, updated_at=20
      WHERE id='pre-1';
      INSERT INTO staff_assignment_fallbacks (
        marketplace_code, staff_id, version, configured_by_staff_id,
        created_at, updated_at
      ) VALUES ('AMAZON_JP','owner-1',1,'owner-1',20,20);
    `);
    const candidate = await resolveRoundRobinCandidate(d, {
      dutyCode: 'BUYER_PRE_SALES_OWNER',
      workType: 'RESERVATION_DECISION',
      marketplaceCode: 'AMAZON_JP',
    });
    expect(candidate).toBeNull();
    expect((await resolveOwnerFallback(d, {
      marketplaceCode: 'AMAZON_JP',
      dutyCode: 'BUYER_PRE_SALES_OWNER',
      workType: 'RESERVATION_DECISION',
    })).staffId).toBe('owner-1');
    expect(d.raw.prepare(`SELECT COUNT(*) AS count
      FROM staff_assignment_cursors`).get()).toEqual({ count: 0 });
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

  it('writes only the assignment Outbox event and rejects destructive history edits', async () => {
    const d = db();
    const prepared = await prepareDirectWorkItem(d, {
      workType: 'RESERVATION_DECISION', sourceEntityType: 'RESERVATION',
      sourceEntityId: 'reservation-outbox', marketplaceCode: 'AMAZON_JP',
      buyerCustomerId: 'buyer-1', actorType: 'SYSTEM',
      idempotencyKey: 'reservation-outbox', now: 100,
    });
    await d.batch(prepared.statements);
    expect(d.raw.prepare(`SELECT COUNT(*) AS count FROM integration_outbox
      WHERE aggregate_type='STAFF_ASSIGNMENT'`).get())
      .toEqual({ count: 1 });
    expect(d.raw.prepare(`SELECT COUNT(*) AS count FROM integration_outbox
      WHERE aggregate_type='STAFF_WORK_ITEM'`).get())
      .toEqual({ count: 0 });
    expect(() => d.exec(`DELETE FROM staff_work_items
      WHERE id='${prepared.workItemId}'`)).toThrow('staff_work_items_are_immutable');
    expect(() => d.exec(`DELETE FROM buyer_staff_assignments
      WHERE id='${prepared.assignmentId}'`)).toThrow('buyer_staff_assignments_are_immutable');
  });

});
