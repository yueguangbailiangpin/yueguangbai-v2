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
import { getStaffAvailability } from './availability-service';
import { resolveAssignmentStaffAuthorization } from './effective-authorization';
import { resolveStaffDataScope } from './data-scope';
import { reassignWorkItem } from './reassignment-service';

let database: SqliteDatabase | null = null;
afterEach(() => { database?.close(); database = null; });

function db(): SqliteDatabase {
  database = createMigratedTestDatabase();
  seedFoundation(database);
  return database;
}

function seedFoundation(d: SqliteDatabase): void {
  d.exec(`
    INSERT INTO staff_departments (
      id, code, name, status, version, created_at, updated_at, disabled_at
    ) VALUES ('department-ops','ops','Ops','ACTIVE',1,1,1,NULL);
    INSERT INTO staff_teams (
      id, department_id, code, name, status, version, created_at, updated_at, disabled_at
    ) VALUES ('team-ops','department-ops','ops','Ops','ACTIVE',1,1,1,NULL);
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
      ('after-1','after_sales','ACTIVE','owner-1',1,NULL,1,1);
    INSERT INTO staff_team_memberships (
      staff_id, team_id, status, joined_at, ended_at, created_at, updated_at
    ) VALUES
      ('pre-1','team-ops','ACTIVE',1,NULL,1,1),
      ('pre-2','team-ops','ACTIVE',1,NULL,1,1),
      ('after-1','team-ops','ACTIVE',1,NULL,1,1);
    INSERT INTO buyer_channels (
      id, code, name, status, next_sequence, version,
      created_at, updated_at, disabled_at
    ) VALUES ('buyer-channel-test','T','Test','ACTIVE',1,1,1,1,NULL);
    INSERT INTO customer_identity_subjects (id, subject_type, created_at)
    VALUES ('buyer-subject-1','BUYER_CUSTOMER',1),
           ('buyer-subject-2','BUYER_CUSTOMER',1);
    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code, buyer_channel_id,
      buyer_customer_no, buyer_sequence, first_valid_order_business_date,
      display_name, access_status, identity_review_status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES
      ('buyer-1','buyer-subject-1','JP','buyer-channel-test',NULL,NULL,NULL,
        'Buyer 1','DISABLED','CLEAR',1,1,1,NULL,1),
      ('buyer-2','buyer-subject-2','JP','buyer-channel-test',NULL,NULL,NULL,
        'Buyer 2','DISABLED','CLEAR',1,1,1,NULL,1);
    UPDATE staff_users
    SET status='DISABLED', disabled_at=2, version=version+1, updated_at=2
    WHERE id='zz-phase3h-test-owner';
  `);
}

describe('Phase 3H staff assignment foundation', () => {
  it('migrates through 0021 and treats missing availability as AVAILABLE', async () => {
    const d = db();
    expect(d.raw.prepare(`SELECT schema_version FROM app_schema_state WHERE singleton_id=1`).get())
      .toEqual({ schema_version: 21 });
    expect(await getStaffAvailability(d, 'pre-1')).toMatchObject({
      staff_id: 'pre-1',
      availability_status: 'AVAILABLE',
      effective_default: true,
      version: 0,
    });
    expect(d.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(d.raw.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  });

  it('round-robins deterministically and personal DENY removes a candidate', async () => {
    const d = db();
    const first = await resolveRoundRobinCandidate(d, {
      dutyCode: 'BUYER_PRE_SALES_OWNER',
      workType: 'RESERVATION_DECISION',
      marketplaceCode: 'JP',
    });
    expect(first?.staff.staffId).toBe('pre-1');
    await d.batch(createCursorAdvanceStatements(d, first!, first!.staff.staffId, 10));
    const second = await resolveRoundRobinCandidate(d, {
      dutyCode: 'BUYER_PRE_SALES_OWNER',
      workType: 'RESERVATION_DECISION',
      marketplaceCode: 'JP',
    });
    expect(second?.staff.staffId).toBe('pre-2');

    d.exec(`INSERT INTO staff_permission_overrides (
      staff_id, permission_code, effect, status, reason,
      assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
    ) VALUES ('pre-2','ASSIGNMENT_ELIGIBLE_BUYER_PRE_SALES','DENY','ACTIVE',
      'test deny','owner-1',20,NULL,20,20)`);
    const afterDeny = await resolveRoundRobinCandidate(d, {
      dutyCode: 'BUYER_PRE_SALES_OWNER',
      workType: 'RESERVATION_DECISION',
      marketplaceCode: 'JP',
    });
    expect(afterDeny?.staff.staffId).toBe('pre-1');
  });

  it('creates a directly assigned work item and preserves fixed owner on replay', async () => {
    const d = db();
    const input = {
      workType: 'RESERVATION_DECISION' as const,
      sourceEntityType: 'RESERVATION' as const,
      sourceEntityId: 'reservation-1',
      marketplaceCode: 'JP',
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

  it('replaces an unavailable fixed owner only when the next work arrives', async () => {
    const d = db();
    const first = await prepareDirectWorkItem(d, {
      workType: 'RESERVATION_DECISION', sourceEntityType: 'RESERVATION',
      sourceEntityId: 'reservation-1', marketplaceCode: 'JP',
      buyerCustomerId: 'buyer-1', actorType: 'SYSTEM', now: 100,
    });
    await d.batch(first.statements);
    d.exec(`INSERT INTO staff_availability (
      staff_id, availability_status, reason, changed_by_staff_id,
      version, created_at, updated_at
    ) VALUES ('pre-1','UNAVAILABLE','leave','pre-1',1,110,110)`);
    const second = await prepareDirectWorkItem(d, {
      workType: 'ORDER_EVIDENCE_REVIEW', sourceEntityType: 'ORDER_EVIDENCE',
      sourceEntityId: 'evidence-1', marketplaceCode: 'JP',
      buyerCustomerId: 'buyer-1', actorType: 'SYSTEM', now: 120,
    });
    await d.batch(second.statements);
    expect(second.assignedStaffId).toBe('pre-2');
    expect(d.raw.prepare(`SELECT COUNT(*) AS count FROM buyer_staff_assignments
      WHERE buyer_customer_id='buyer-1' AND duty_code='BUYER_PRE_SALES_OWNER'`).get())
      .toEqual({ count: 2 });
    expect(d.raw.prepare(`SELECT staff_id FROM buyer_staff_assignments
      WHERE buyer_customer_id='buyer-1' AND duty_code='BUYER_PRE_SALES_OWNER'
        AND status='ACTIVE'`).get()).toEqual({ staff_id: 'pre-2' });
  });

  it('does not select an arbitrary owner when fallback is absent or invalid', async () => {
    const d = db();
    await expect(resolveOwnerFallback(d, {
      marketplaceCode: 'JP', dutyCode: 'BUYER_PRE_SALES_OWNER',
      workType: 'RESERVATION_DECISION',
    })).rejects.toMatchObject({ code: 'OWNER_FALLBACK_NOT_CONFIGURED' });
    d.exec(`INSERT INTO staff_assignment_fallbacks (
      marketplace_code, staff_id, version, configured_by_staff_id,
      created_at, updated_at
    ) VALUES ('JP','owner-1',1,'owner-1',1,1)`);
    expect((await resolveOwnerFallback(d, {
      marketplaceCode: 'JP', dutyCode: 'BUYER_PRE_SALES_OWNER',
      workType: 'RESERVATION_DECISION',
    })).staffId).toBe('owner-1');
  });

  it('resolves own data scope from assignments and open work items', async () => {
    const d = db();
    const prepared = await prepareDirectWorkItem(d, {
      workType: 'RESERVATION_DECISION', sourceEntityType: 'RESERVATION',
      sourceEntityId: 'reservation-1', marketplaceCode: 'JP',
      buyerCustomerId: 'buyer-1', actorType: 'SYSTEM', now: 100,
    });
    await d.batch(prepared.statements);
    const actor = await resolveAssignmentStaffAuthorization(d, prepared.assignedStaffId);
    expect(actor).not.toBeNull();
    const scope = await resolveStaffDataScope(d, actor!, { requiredPermission: 'BUYER_VIEW' });
    expect(scope.buyerCustomerIds).toContain('buyer-1');
    expect(scope.buyerCustomerIds).not.toContain('buyer-2');
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
      marketplaceCode: 'JP',
    });
    expect(candidate?.staff.staffId).toBe('pre-2');
  });

  it('requires every fixed-duty business permission and keeps seller_support non-default', async () => {
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
      ) VALUES ('support-1','seller_support','ACTIVE','owner-1',1,NULL,1,1);
      INSERT INTO staff_team_memberships (
        staff_id, team_id, status, joined_at, ended_at, created_at, updated_at
      ) VALUES ('support-1','team-ops','ACTIVE',1,NULL,1,1);
      INSERT INTO staff_permission_overrides (
        staff_id, permission_code, effect, status, reason,
        assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
      ) VALUES
        ('support-1','ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT','GRANT','ACTIVE','test',
          'owner-1',2,NULL,2,2),
        ('support-1','PRODUCT_REVIEW','GRANT','ACTIVE','test',
          'owner-1',2,NULL,2,2);
    `);
    const supportAuthorization = await resolveAssignmentStaffAuthorization(d, 'support-1');
    expect(supportAuthorization?.permissions.has('ASSIGNMENT_ELIGIBLE_SELLER_ACCOUNT')).toBe(true);
    expect(await resolveRoundRobinFixedDutyCandidate(d, {
      dutyCode: 'SELLER_ACCOUNT_MANAGER', marketplaceCode: 'JP',
    })).toBeNull();

    d.exec(`
      INSERT INTO staff_permission_overrides (
        staff_id, permission_code, effect, status, reason,
        assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
      ) VALUES
        ('support-1','DEMAND_PUBLISH','GRANT','ACTIVE','test',
          'owner-1',3,NULL,3,3);
    `);
    const candidate = await resolveRoundRobinFixedDutyCandidate(d, {
      dutyCode: 'SELLER_ACCOUNT_MANAGER', marketplaceCode: 'JP',
    });
    expect(candidate?.staff.staffId).toBe('support-1');
  });

  it('rejects a fixed-duty candidate when any required permission is personally denied', async () => {
    const d = db();
    d.exec(`INSERT INTO staff_permission_overrides (
      staff_id, permission_code, effect, status, reason,
      assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
    ) VALUES ('pre-1','BUYER_VIEW','DENY','ACTIVE',
      'required permission deny','owner-1',20,NULL,20,20)`);
    const candidate = await resolveRoundRobinFixedDutyCandidate(d, {
      dutyCode: 'BUYER_PRE_SALES_OWNER', marketplaceCode: 'JP',
    });
    expect(candidate?.staff.staffId).toBe('pre-2');
  });

  it('skips unavailable and disabled staff without rewriting assignments', async () => {
    const d = db();
    d.exec(`
      INSERT INTO staff_availability (
        staff_id, availability_status, reason, changed_by_staff_id,
        version, created_at, updated_at
      ) VALUES ('pre-1','UNAVAILABLE','leave','pre-1',1,20,20);
      UPDATE staff_users
      SET status='DISABLED', disabled_at=20, version=version+1, updated_at=20
      WHERE id='pre-2';
    `);
    expect(await resolveRoundRobinCandidate(d, {
      dutyCode: 'BUYER_PRE_SALES_OWNER',
      workType: 'RESERVATION_DECISION',
      marketplaceCode: 'JP',
    })).toBeNull();
  });

  it('uses explicit fallback without advancing the round-robin cursor', async () => {
    const d = db();
    d.exec(`
      INSERT INTO staff_availability (
        staff_id, availability_status, reason, changed_by_staff_id,
        version, created_at, updated_at
      ) VALUES
        ('pre-1','UNAVAILABLE','leave','pre-1',1,20,20),
        ('pre-2','UNAVAILABLE','leave','pre-2',1,20,20);
      INSERT INTO staff_assignment_fallbacks (
        marketplace_code, staff_id, version, configured_by_staff_id,
        created_at, updated_at
      ) VALUES ('JP','owner-1',1,'owner-1',20,20);
    `);
    const candidate = await resolveRoundRobinCandidate(d, {
      dutyCode: 'BUYER_PRE_SALES_OWNER',
      workType: 'RESERVATION_DECISION',
      marketplaceCode: 'JP',
    });
    expect(candidate).toBeNull();
    expect((await resolveOwnerFallback(d, {
      marketplaceCode: 'JP',
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
      buyerCustomerIds: [],
      sellerOrganizationIds: [],
      teamIds: [],
    });
  });

  it('writes assignment/work-item Outbox events and rejects destructive history edits', async () => {
    const d = db();
    const prepared = await prepareDirectWorkItem(d, {
      workType: 'RESERVATION_DECISION', sourceEntityType: 'RESERVATION',
      sourceEntityId: 'reservation-outbox', marketplaceCode: 'JP',
      buyerCustomerId: 'buyer-1', actorType: 'SYSTEM',
      idempotencyKey: 'reservation-outbox', now: 100,
    });
    await d.batch(prepared.statements);
    expect(d.raw.prepare(`SELECT COUNT(*) AS count FROM integration_outbox
      WHERE aggregate_type IN ('STAFF_ASSIGNMENT','STAFF_WORK_ITEM')`).get())
      .toEqual({ count: 2 });
    expect(() => d.exec(`DELETE FROM staff_work_items
      WHERE id='${prepared.workItemId}'`)).toThrow('staff_work_items_are_immutable');
    expect(() => d.exec(`DELETE FROM buyer_staff_assignments
      WHERE id='${prepared.assignmentId}'`)).toThrow('buyer_staff_assignments_are_immutable');
  });

  it('reassigns one Work Item without changing its fixed owner', async () => {
    const d = db();
    const prepared = await prepareDirectWorkItem(d, {
      workType: 'RESERVATION_DECISION', sourceEntityType: 'RESERVATION',
      sourceEntityId: 'reservation-reassign', marketplaceCode: 'JP',
      buyerCustomerId: 'buyer-1', actorType: 'SYSTEM', now: 100,
    });
    await d.batch(prepared.statements);
    const owner = await resolveAssignmentStaffAuthorization(d, 'owner-1');
    const result = await reassignWorkItem(d, {
      workItemId: prepared.workItemId,
      targetStaffId: 'pre-2',
      expectedVersion: 1,
      reason: 'manual workload balance',
    }, {
      actor: owner!,
      idempotencyKey: 'reassign-work-item-1',
      now: 120,
    });
    expect(result.assigned_staff_id).toBe('pre-2');
    expect(d.raw.prepare(`SELECT assigned_staff_id, fixed_assignment_id
      FROM staff_work_items WHERE id=?`).get(prepared.workItemId)).toEqual({
      assigned_staff_id: 'pre-2',
      fixed_assignment_id: prepared.assignmentId,
    });
    expect(d.raw.prepare(`SELECT staff_id FROM buyer_staff_assignments
      WHERE id=?`).get(prepared.assignmentId)).toEqual({ staff_id: 'pre-1' });
  });

});
