import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { runScheduledOperationManually } from './commands';

let database: SqliteDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
});

describe('scheduled operation manual commands', () => {
  it('runs once, replays the same result, and conflicts on a changed request', async () => {
    database = createMigratedTestDatabase();
    seedExpirableReservation(database, 'manual');
    const dependencies = { enabled: true };
    const first = await runScheduledOperationManually(
      database,
      dependencies,
      { jobName: 'reservation_expiry', command: { reason_code: 'OPERATOR_RETRY' } },
      commandContext('manual-command-key'),
    );
    const replay = await runScheduledOperationManually(
      database,
      dependencies,
      { jobName: 'reservation_expiry', command: { reason_code: 'OPERATOR_RETRY' } },
      commandContext('manual-command-key'),
    );
    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      command_type: 'RUN_JOB',
      outcome: 'SUCCEEDED',
      run: { processed_count: 1, succeeded_count: 1 },
    });
    await expect(
      runScheduledOperationManually(
        database,
        dependencies,
        { jobName: 'reservation_expiry', command: { reason_code: 'BACKLOG_RECOVERY' } },
        commandContext('manual-command-key'),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    expect(await count(database, 'scheduled_manual_commands')).toBe(1);
    expect(
      await database
        .prepare(
          'SELECT command_type,job_name,target_id,reason_code,staff_id,request_id,outcome,length(request_hash) AS hash_length FROM scheduled_manual_commands',
        )
        .first(),
    ).toEqual({
      command_type: 'RUN_JOB',
      job_name: 'reservation_expiry',
      target_id: 'reservation_expiry',
      reason_code: 'OPERATOR_RETRY',
      staff_id: 'zz-phase3h-test-owner',
      request_id: 'request-manual-command-key',
      outcome: 'SUCCEEDED',
      hash_length: 64,
    });
    expect(await auditFacts(database, 'SCHEDULED_OPERATION_MANUAL_RUN')).toHaveLength(1);
  });

  it('holds the idempotency lease against a concurrent double click', async () => {
    database = createMigratedTestDatabase();
    seedExpirableReservation(database, 'race');
    const dependencies = { enabled: true };
    const first = runScheduledOperationManually(
      database,
      dependencies,
      { jobName: 'reservation_expiry', command: { reason_code: 'OPERATOR_RETRY' } },
      commandContext('manual-race-key'),
    );
    const second = runScheduledOperationManually(
      database,
      dependencies,
      { jobName: 'reservation_expiry', command: { reason_code: 'OPERATOR_RETRY' } },
      commandContext('manual-race-key'),
    );
    const results = await Promise.allSettled([first, second]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]).toMatchObject({ status: 'fulfilled', value: { outcome: 'SUCCEEDED' } });
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      status: 'rejected',
      reason: { code: 'REQUEST_IN_PROGRESS', status: 409 },
    });
  });



  it('applies global, per-job, and hard kill switches to manual commands', async () => {
    database = createMigratedTestDatabase();
    seedExpirableReservation(database, 'disabled');
    const global = await runScheduledOperationManually(
      database,
      { enabled: false },
      { jobName: 'reservation_expiry', command: { reason_code: 'OPERATOR_RETRY' } },
      commandContext('global-disabled-key'),
    );
    expect(global.outcome).toBe('DISABLED');
    database.exec("UPDATE scheduled_job_states SET enabled=0 WHERE job_name='reservation_expiry'");
    const perJob = await runScheduledOperationManually(
      database,
      { enabled: true },
      { jobName: 'reservation_expiry', command: { reason_code: 'OPERATOR_RETRY' } },
      commandContext('job-disabled-key'),
    );
    const hard = await runScheduledOperationManually(
      database,
      { enabled: true },
      { jobName: 'drive_archive', command: { reason_code: 'OPERATOR_RETRY' } },
      commandContext('hard-disabled-key'),
    );
    expect([perJob.outcome, hard.outcome]).toEqual(['DISABLED', 'DISABLED']);
    expect(await count(database, 'scheduled_job_runs')).toBe(0);
  });

  it('requires an ACTIVE effective actor with the dedicated permission', async () => {
    database = createMigratedTestDatabase();
    await expect(
      runScheduledOperationManually(
        database,
        { enabled: true },
        { jobName: 'reservation_expiry', command: { reason_code: 'OPERATOR_RETRY' } },
        { ...commandContext('missing-permission-key'), actor: actor([]) },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    const inactive = actor(['SCHEDULED_OPERATIONS_RUN']);
    Reflect.set(inactive, 'staffStatus', 'DISABLED');
    await expect(
      runScheduledOperationManually(
        database,
        { enabled: true },
        { jobName: 'reservation_expiry', command: { reason_code: 'OPERATOR_RETRY' } },
        { ...commandContext('inactive-actor-key'), actor: inactive },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(await count(database, 'scheduled_manual_commands')).toBe(0);
  });
});

function actor(
  permissions: readonly 'SCHEDULED_OPERATIONS_RUN'[] = ['SCHEDULED_OPERATIONS_RUN'],
): AssignmentStaffAuthorization {
  return {
    staffId: 'zz-phase3h-test-owner',
    displayName: 'Owner',
    staffStatus: 'ACTIVE',
    authorizationVersion: 1,
    roles: new Set(['owner']),
    permissions: new Set(permissions),
    memberTeamIds: [],
    leaderTeamIds: [],
  };
}
function commandContext(idempotencyKey: string): {
  actor: AssignmentStaffAuthorization;
  idempotencyKey: string;
  requestId: string;
  now: number;
} {
  return { actor: actor(), idempotencyKey, requestId: `request-${idempotencyKey}`, now: 2000 };
}
async function count(db: SqliteDatabase, table: string) {
  return Number(
    (await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>())
      ?.count ?? 0,
  );
}
async function auditFacts(db: SqliteDatabase, eventType: string) {
  return (
    await db
      .prepare(
        'SELECT event_type,actor_id,request_id,idempotency_key,next_state_json,reason,metadata_json FROM audit_events WHERE event_type=? ORDER BY created_at,id',
      )
      .bind(eventType)
      .all()
  ).results;
}

export function seedExpirableReservation(db: SqliteDatabase, suffix = 'so'): void {
  db.exec(`
    INSERT INTO customer_identity_subjects (id, subject_type, created_at)
      VALUES ('${suffix}-subject','BUYER_CUSTOMER',1000);
    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code, buyer_channel_id,
      buyer_customer_no, buyer_sequence, display_name, access_status,
      identity_review_status, version, created_at, updated_at, activated_at, disabled_at
    ) VALUES ('${suffix}-buyer','${suffix}-subject','AMAZON_JP','buyer-channel-wechat-b',
      '20260801B9901',9901,'命令测试买家','ACTIVE','CLEAR',1,1000,1000,1000,NULL);
    INSERT INTO seller_channels (
      id, code, prefix, name, status, version, created_at, updated_at, disabled_at
    ) VALUES ('${suffix}-channel','socmd','socmd-','命令渠道','ACTIVE',1,1000,1000,NULL);
    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code, origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status, version,
      created_at, updated_at, activated_at, next_member_number
    ) VALUES ('${suffix}-org','AMAZON_JP','${suffix}-org-1','${suffix}-channel','${suffix}-channel',
      9801,'命令测试组织','ACTIVE',1,1000,1000,1000,2);
    INSERT INTO customer_identity_subjects (id, subject_type, created_at)
      VALUES ('${suffix}-member-subject','SELLER_ORG_MEMBER',1000);
    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id, member_number, username_fallback,
      display_name, role, primary_owner, status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES ('${suffix}-member','${suffix}-member-subject','${suffix}-org',1,
      '${suffix}-member-1','命令成员','OWNER',1,'ACTIVE',1,1000,1000,1000,NULL);
    INSERT INTO seller_stores (
      id, organization_id, marketplace_code, display_name, normalized_name,
      status, version, created_at, updated_at, disabled_at
    ) VALUES ('${suffix}-store','${suffix}-org','AMAZON_JP','命令店铺','命令店铺',
      'ACTIVE',1,1000,1000,NULL);
    INSERT INTO products (
      id, organization_id, store_id, marketplace_code, asin_display, asin_normalized,
      status, current_version_no, version, created_at, updated_at, disabled_at
    ) VALUES ('${suffix}-product','${suffix}-org','${suffix}-store','AMAZON_JP',
      'B0SOCMD001','B0SOCMD001','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO product_versions (
      id, product_id, version_no, product_name, search_keywords_json, product_url,
      buyer_visible_notes, internal_notes, created_by_staff_id, created_at,
      ordering_guide_expected_amount_jpy, color_spec_mode
    ) VALUES ('${suffix}-product-v1','${suffix}-product',1,'命令产品','[]',NULL,
      NULL,NULL,'zz-phase3h-test-owner',1000,1980,'MAIN_IMAGE_VARIANT');
    INSERT INTO demand_batches (
      id, organization_id, store_id, marketplace_code, product_id, product_version_no,
      submitted_by_member_id, task_type, target_quantity, buyer_visible_notes,
      seller_notes, open_at, reservation_deadline, order_deadline, status,
      reviewed_by_staff_id, version,
      submitted_at, updated_at, reviewed_at, published_at, withdrawn_at, closed_at,
      held_reservation_count, approved_reservation_count
    ) VALUES ('${suffix}-demand','${suffix}-org','${suffix}-store','AMAZON_JP',
      '${suffix}-product',1,'${suffix}-member','TEXT',1,NULL,NULL,500,900,2000,'PUBLISHED',
      'zz-phase3h-test-owner',2,
      1000,3000,3000,3000,NULL,NULL,1,0);
    INSERT INTO product_reservations (
      id, demand_batch_id, buyer_customer_id, organization_id, store_id, product_id,
      product_version_no, marketplace_code, status, precheck_snapshot_json,
      hold_expires_at, order_deadline_snapshot, version, submitted_at, updated_at,
      decided_by_staff_id, decision_reason, decided_at, cancelled_at, expired_at,
      reopened_count, buyer_self_pay_bps_snapshot, reference_order_amount_jpy_snapshot,
      estimated_self_pay_jpy_snapshot, estimated_refundable_principal_jpy_snapshot,
      buyer_self_pay_accepted_at, buyer_self_pay_accepted_demand_version
    ) VALUES ('${suffix}-reservation','${suffix}-demand','${suffix}-buyer',
      '${suffix}-org','${suffix}-store','${suffix}-product',1,'AMAZON_JP',
      'PENDING_REVIEW','{}',1000,2000,1,1000,1000,NULL,NULL,NULL,NULL,NULL,0,
      0,1980,0,1980,1000,2);
  `);
}
