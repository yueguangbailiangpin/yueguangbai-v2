import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { seedPhase3GInstructionFixture } from '../../test-support/phase3g-test-fixtures';
import { runScheduledOperations } from './runner';

let database: SqliteDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
});

describe('scheduled operations', () => {
  it('reports a missing file storage adapter as a failed dependency instead of a success', async () => {
    database = createMigratedTestDatabase();
    const run = await runScheduledOperations(database, { now: 2_000, only: 'file_orphan_cleanup' });
    expect(run[0]).toMatchObject({
      outcome: 'FAILED',
      processed_count: 0,
      succeeded_count: 0,
      failed_count: 1,
      backlog_count: 0,
      failure_category: 'adapter_unavailable',
    });
    expect(
      await database
        .prepare(
          "SELECT last_succeeded_at,last_failure_category FROM scheduled_job_states WHERE job_name='file_orphan_cleanup'",
        )
        .first(),
    ).toEqual({ last_succeeded_at: null, last_failure_category: 'adapter_unavailable' });
  });

  it('uses an expiring lease so duplicate scheduler delivery is skipped then recoverable', async () => {
    database = createMigratedTestDatabase();
    database.exec(
      "INSERT INTO scheduled_job_states (job_name,lease_token,lease_expires_at,updated_at) VALUES ('outbox_delivery','other',2000,1)",
    );
    const blocked = await runScheduledOperations(database, { now: 1_999, only: 'outbox_delivery' });
    expect(blocked[0]?.outcome).toBe('SKIPPED');
    const recovered = await runScheduledOperations(database, {
      now: 2_000,
      only: 'outbox_delivery',
    });
    expect(recovered[0]?.outcome).toBe('SUCCEEDED');
  });

  it('allows only one concurrent outbox scheduler to hold the job lease', async () => {
    database = createMigratedTestDatabase();
    database.exec(
      "INSERT INTO integration_outbox (id,dedup_key,event_type,aggregate_type,aggregate_id,payload_json,payload_hash,status,available_at,lease_token,lease_expires_at,attempt_count,last_error,created_at,updated_at,sent_at) VALUES ('outbox-race-1','scheduled:race:1','TEST','TEST','1','{}','cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','PENDING',1,NULL,NULL,0,NULL,1,1,NULL)",
    );
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runScheduledOperations(database, {
      now: 2000,
      only: 'outbox_delivery',
      outboxAdapter: { deliver: async () => blocked },
    });
    await Promise.resolve();
    const second = await runScheduledOperations(database, { now: 2000, only: 'outbox_delivery' });
    expect(second[0]?.outcome).toBe('SKIPPED');
    release();
    expect((await first)[0]?.outcome).toBe('SUCCEEDED');
  });

  it('records a late worker as lease-lost after a real takeover without overwriting current health', async () => {
    database = createMigratedTestDatabase();
    database.exec(
      "INSERT INTO integration_outbox (id,dedup_key,event_type,aggregate_type,aggregate_id,payload_json,payload_hash,status,available_at,lease_token,lease_expires_at,attempt_count,last_error,created_at,updated_at,sent_at) VALUES ('outbox-takeover-1','scheduled:takeover:1','TEST','TEST','1','{}','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','PENDING',1,NULL,NULL,0,NULL,1,1,NULL)",
    );
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const late = runScheduledOperations(database, {
      now: 1_000,
      only: 'outbox_delivery',
      outboxAdapter: { deliver: async () => blocked },
    });
    await Promise.resolve();
    let takeoverSends = 0;
    const takeover = await runScheduledOperations(database, {
      now: 92_000,
      only: 'outbox_delivery',
      outboxAdapter: {
        deliver: async () => {
          takeoverSends += 1;
        },
      },
    });
    expect(takeover[0]).toMatchObject({ outcome: 'SUCCEEDED', succeeded_count: 1 });
    release();
    expect((await late)[0]).toMatchObject({ outcome: 'PARTIAL', failure_category: 'lease_lost' });
    expect(takeoverSends).toBe(1);
    expect(
      await database
        .prepare(
          "SELECT last_succeeded_at,last_failure_category FROM scheduled_job_states WHERE job_name='outbox_delivery'",
        )
        .first(),
    ).toEqual({ last_succeeded_at: 92_000, last_failure_category: null });
  });

  it('skips before lease expiry, takes over after expiry, and rejects stale completion', async () => {
    database = createMigratedTestDatabase();
    database.exec(
      "INSERT INTO scheduled_job_states(job_name,lease_token,lease_expires_at,version,cursor_json,last_started_at,last_succeeded_at,last_failed_at,last_failure_category,last_backlog_count,updated_at) VALUES('outbox_delivery','old-token',2000,4,'{\"due\":1}',10,11,NULL,NULL,0,11)",
    );
    expect(
      (await runScheduledOperations(database, { now: 1999, only: 'outbox_delivery' }))[0]?.outcome,
    ).toBe('SKIPPED');
    expect(
      (await runScheduledOperations(database, { now: 2000, only: 'outbox_delivery' }))[0]?.outcome,
    ).toBe('SUCCEEDED');
    const current = await database
      .prepare(
        "SELECT lease_token,version,last_succeeded_at FROM scheduled_job_states WHERE job_name='outbox_delivery'",
      )
      .first<{ lease_token: string | null; version: number; last_succeeded_at: number }>();
    const stale = await database
      .prepare(
        "UPDATE scheduled_job_states SET cursor_json='stale',last_succeeded_at=999999 WHERE job_name='outbox_delivery' AND lease_token='old-token'",
      )
      .run();
    expect(stale.meta.changes).toBe(0);
    expect(current?.lease_token).toBeNull();
    expect(current?.version).toBeGreaterThan(4);
  });

  it('does not write leases, runs, or business facts when disabled', async () => {
    database = createMigratedTestDatabase();
    const disabled = await runScheduledOperations(database, {
      now: 2000,
      only: 'reservation_expiry',
      enabled: false,
    });
    const perJob = await runScheduledOperations(database, {
      now: 2000,
      only: 'reservation_expiry',
      disabledJobs: ['reservation_expiry'],
    });
    const hard = await runScheduledOperations(database, { now: 2000, only: 'drive_archive' });
    expect([disabled[0]?.outcome, perJob[0]?.outcome, hard[0]?.outcome]).toEqual([
      'DISABLED',
      'DISABLED',
      'DISABLED',
    ]);
    expect(
      (
        await database
          .prepare('SELECT COUNT(*) AS count FROM scheduled_job_runs')
          .first<{ count: number }>()
      )?.count,
    ).toBe(0);
    expect(
      (
        await database
          .prepare('SELECT COUNT(*) AS count FROM scheduled_job_states')
          .first<{ count: number }>()
      )?.count,
    ).toBe(0);
  });

  it('uses bounded exponential outbox retry without exposing payload in run facts', async () => {
    database = createMigratedTestDatabase();
    database.exec(
      "INSERT INTO integration_outbox (id,dedup_key,event_type,aggregate_type,aggregate_id,payload_json,payload_hash,status,available_at,lease_token,lease_expires_at,attempt_count,last_error,created_at,updated_at,sent_at) VALUES ('outbox-scheduled-1','scheduled:outbox:1','TEST','TEST','1','{\"secret\":\"never-log\"}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','PENDING',1,NULL,NULL,0,NULL,1,1,NULL)",
    );
    const run = await runScheduledOperations(database, { now: 2_000, only: 'outbox_delivery' });
    expect(run[0]).toMatchObject({
      outcome: 'FAILED',
      failed_count: 1,
      backlog_count: 1,
      failure_category: 'adapter_unavailable',
    });
    const state = await database
      .prepare(
        "SELECT last_failure_category FROM scheduled_job_states WHERE job_name='outbox_delivery'",
      )
      .first<{ last_failure_category: string }>();
    expect(state?.last_failure_category).toBe('adapter_unavailable');
    const row = await database
      .prepare(
        "SELECT status,last_error,available_at FROM integration_outbox WHERE id='outbox-scheduled-1'",
      )
      .first<{ status: string; last_error: string; available_at: number }>();
    expect(row).toEqual({
      status: 'FAILED',
      last_error: 'adapter_unavailable',
      available_at: 62_000,
    });
  });

  it('leaves due outbox events untouched when governed delivery is disabled', async () => {
    database = createMigratedTestDatabase();
    database.exec(
      "INSERT INTO integration_outbox (id,dedup_key,event_type,aggregate_type,aggregate_id,payload_json,payload_hash,status,available_at,lease_token,lease_expires_at,attempt_count,last_error,created_at,updated_at,sent_at) VALUES ('outbox-disabled-1','scheduled:disabled:1','TEST','TEST','1','{\"secret\":\"never-log\"}','ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff','PENDING',1,NULL,NULL,4,NULL,1,1,NULL)",
    );
    let sends = 0;
    const run = await runScheduledOperations(database, {
      now: 2_000,
      only: 'outbox_delivery',
      outboxDeliveryEnabled: false,
      outboxAdapter: {
        deliver: async () => {
          sends += 1;
          throw new Error('must_not_deliver');
        },
      },
    });
    expect(run[0]).toEqual({
      job_name: 'outbox_delivery',
      outcome: 'DISABLED',
      processed_count: 0,
      succeeded_count: 0,
      failed_count: 0,
      backlog_count: 0,
      failure_category: null,
    });
    expect(sends).toBe(0);
    expect(
      await database
        .prepare(
          "SELECT status,attempt_count,last_error,lease_token,lease_expires_at FROM integration_outbox WHERE id='outbox-disabled-1'",
        )
        .first(),
    ).toEqual({
      status: 'PENDING',
      attempt_count: 4,
      last_error: null,
      lease_token: null,
      lease_expires_at: null,
    });
    expect(
      await database
        .prepare(
          "SELECT COUNT(*) AS count FROM scheduled_dead_letters WHERE source_id='outbox-disabled-1'",
        )
        .first(),
    ).toEqual({ count: 0 });
    expect(
      await database
        .prepare(
          "SELECT COUNT(*) AS count FROM scheduled_job_runs WHERE job_name='outbox_delivery'",
        )
        .first(),
    ).toEqual({ count: 0 });
  });

  it('quarantines a poison outbox event and dry-run never claims it', async () => {
    database = createMigratedTestDatabase();
    database.exec(
      "INSERT INTO integration_outbox (id,dedup_key,event_type,aggregate_type,aggregate_id,payload_json,payload_hash,status,available_at,lease_token,lease_expires_at,attempt_count,last_error,created_at,updated_at,sent_at) VALUES ('outbox-poison-1','scheduled:poison:1','TEST','TEST','1','{}','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','PENDING',1,NULL,NULL,4,NULL,1,1,NULL)",
    );
    const dry = await runScheduledOperations(database, {
      now: 2000,
      only: 'outbox_delivery',
      dryRun: true,
    });
    expect(dry[0]?.processed_count).toBe(0);
    const run = await runScheduledOperations(database, { now: 2000, only: 'outbox_delivery' });
    expect(run[0]?.outcome).toBe('FAILED');
    const dead = await database
      .prepare("SELECT source_id FROM scheduled_dead_letters WHERE source_id='outbox-poison-1'")
      .first();
    expect(dead).toEqual({ source_id: 'outbox-poison-1' });
  });

  it('does not send a committed outbox event twice across duplicate cron runs', async () => {
    database = createMigratedTestDatabase();
    database.exec(
      "INSERT INTO integration_outbox (id,dedup_key,event_type,aggregate_type,aggregate_id,payload_json,payload_hash,status,available_at,lease_token,lease_expires_at,attempt_count,last_error,created_at,updated_at,sent_at) VALUES ('outbox-once-1','scheduled:once:1','TEST','TEST','1','{}','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','PENDING',1,NULL,NULL,0,NULL,1,1,NULL)",
    );
    let sends = 0;
    const adapter = {
      deliver: async () => {
        sends += 1;
      },
    };
    expect(
      (
        await runScheduledOperations(database, {
          now: 2000,
          only: 'outbox_delivery',
          outboxAdapter: adapter,
        })
      )[0]?.outcome,
    ).toBe('SUCCEEDED');
    expect(
      (
        await runScheduledOperations(database, {
          now: 2000,
          only: 'outbox_delivery',
          outboxAdapter: adapter,
        })
      )[0]?.processed_count,
    ).toBe(0);
    expect(sends).toBe(1);
  });

  it('resumes reservation expiry without duplicate release, audit, or message facts', async () => {
    database = createMigratedTestDatabase();
    seedScheduledReservationFixture(database, {
      statuses: ['PENDING_REVIEW', 'PENDING_REVIEW'],
      holdExpiresAt: [1000, 1000],
    });

    const first = await runScheduledOperations(database, {
      now: 2000,
      only: 'reservation_expiry',
      batchSize: 1,
    });
    expect(first[0]).toMatchObject({
      outcome: 'SUCCEEDED',
      processed_count: 1,
      succeeded_count: 1,
      failed_count: 0,
      backlog_count: 1,
    });
    const partialState = await database
      .prepare(
        "SELECT cursor_json,version FROM scheduled_job_states WHERE job_name='reservation_expiry'",
      )
      .first<{ cursor_json: string | null; version: number }>();
    expect(JSON.parse(partialState?.cursor_json ?? 'null')).toEqual({
      due: 1000,
      id: 'reservation-scheduled-1',
    });
    expect(await reservationExpiryFactCounts(database)).toEqual({
      expired: 1,
      events: 1,
      audits: 1,
      outbox: 1,
    });

    const second = await runScheduledOperations(database, {
      now: 2000,
      only: 'reservation_expiry',
      batchSize: 1,
    });
    expect(second[0]).toMatchObject({
      outcome: 'SUCCEEDED',
      processed_count: 1,
      succeeded_count: 1,
      failed_count: 0,
    });
    const completedState = await database
      .prepare(
        "SELECT cursor_json,version,last_succeeded_at FROM scheduled_job_states WHERE job_name='reservation_expiry'",
      )
      .first<{ cursor_json: string | null; version: number; last_succeeded_at: number }>();
    expect(completedState?.cursor_json).toBeNull();
    expect(completedState?.version).toBeGreaterThan(partialState?.version ?? 0);
    expect(await reservationExpiryFactCounts(database)).toEqual({
      expired: 2,
      events: 2,
      audits: 2,
      outbox: 2,
    });

    const duplicate = await runScheduledOperations(database, {
      now: 2000,
      only: 'reservation_expiry',
      batchSize: 1,
    });
    expect(duplicate[0]?.processed_count).toBe(0);
    expect(await reservationExpiryFactCounts(database)).toEqual({
      expired: 2,
      events: 2,
      audits: 2,
      outbox: 2,
    });
    const stale = await database
      .prepare(
        "UPDATE scheduled_job_states SET cursor_json='stale',last_succeeded_at=999999 WHERE job_name='reservation_expiry' AND lease_token='late-reservation-worker' AND version=?",
      )
      .bind(completedState?.version ?? 0)
      .run();
    expect(stale.meta.changes).toBe(0);
    const afterStale = await database
      .prepare(
        "SELECT cursor_json,last_succeeded_at FROM scheduled_job_states WHERE job_name='reservation_expiry'",
      )
      .first<{ cursor_json: string | null; last_succeeded_at: number }>();
    expect(afterStale).toEqual({ cursor_json: null, last_succeeded_at: 2000 });
  });

  it('previews only due legacy JP instructions and leaves business facts unchanged', async () => {
    database = createMigratedTestDatabase();
    seedScheduledReservationFixture(database, {
      statuses: ['APPROVED', 'APPROVED', 'APPROVED'],
      canonicalUsIndexes: [3],
    });
    const due = await seedScheduledInstruction(database, {
      suffix: 'scheduled-due',
      reservationIndex: 1,
      publishedAt: 1000,
    });
    const future = await seedScheduledInstruction(database, {
      suffix: 'scheduled-future',
      reservationIndex: 2,
      publishedAt: 30_000_000,
    });
    const us = await seedScheduledInstruction(database, {
      suffix: 'scheduled-us',
      reservationIndex: 3,
      publishedAt: 1000,
    });
    const before = await instructionBusinessFactCounts(database);

    const preview = await runScheduledOperations(database, {
      now: 25_000_000,
      only: 'instruction_expiry',
      dryRun: true,
      batchSize: 1,
    });
    expect(preview[0]).toMatchObject({
      outcome: 'SUCCEEDED',
      processed_count: 0,
      succeeded_count: 0,
      failed_count: 0,
      backlog_count: 1,
    });
    expect(await instructionBusinessFactCounts(database)).toEqual(before);
    expect(
      await instructionStatuses(database, [
        due.instructionId,
        future.instructionId,
        us.instructionId,
      ]),
    ).toEqual(['ACTIVE', 'ACTIVE', 'ACTIVE']);

    const executed = await runScheduledOperations(database, {
      now: 25_000_000,
      only: 'instruction_expiry',
      batchSize: 1,
    });
    expect(executed[0]).toMatchObject({
      outcome: 'SUCCEEDED',
      processed_count: 1,
      succeeded_count: 1,
      failed_count: 0,
      backlog_count: 0,
    });
    expect(
      await instructionStatuses(database, [
        due.instructionId,
        future.instructionId,
        us.instructionId,
      ]),
    ).toEqual(['EXPIRED', 'ACTIVE', 'ACTIVE']);
  });

  it('persists an instruction continuation marker and clears it after a completed JP round', async () => {
    database = createMigratedTestDatabase();
    seedScheduledReservationFixture(database, { statuses: ['APPROVED', 'APPROVED'] });
    const firstInstruction = await seedScheduledInstruction(database, {
      suffix: 'scheduled-partial-a',
      reservationIndex: 1,
      publishedAt: 1000,
    });
    const secondInstruction = await seedScheduledInstruction(database, {
      suffix: 'scheduled-partial-b',
      reservationIndex: 2,
      publishedAt: 1000,
    });

    let budgetChecks = 0;
    const partial = await runScheduledOperations(database, {
      now: 25_000_000,
      only: 'instruction_expiry',
      batchSize: 2,
      deadlineReached: () => budgetChecks++ >= 2,
    });
    expect(partial[0]).toMatchObject({
      outcome: 'SUCCEEDED',
      processed_count: 1,
      succeeded_count: 1,
      backlog_count: 1,
    });
    const partialState = await database
      .prepare("SELECT cursor_json FROM scheduled_job_states WHERE job_name='instruction_expiry'")
      .first<{ cursor_json: string | null }>();
    expect(JSON.parse(partialState?.cursor_json ?? 'null')).toMatchObject({
      marketplace_code: 'AMAZON_JP',
      next_instruction_id: firstInstruction.instructionId,
    });

    const completed = await runScheduledOperations(database, {
      now: 25_000_000,
      only: 'instruction_expiry',
      batchSize: 2,
    });
    expect(completed[0]).toMatchObject({
      outcome: 'SUCCEEDED',
      processed_count: 1,
      succeeded_count: 1,
      backlog_count: 0,
    });
    const completedState = await database
      .prepare("SELECT cursor_json FROM scheduled_job_states WHERE job_name='instruction_expiry'")
      .first<{ cursor_json: string | null }>();
    expect(completedState?.cursor_json).toBeNull();
    expect(
      await instructionStatuses(database, [
        firstInstruction.instructionId,
        secondInstruction.instructionId,
      ]),
    ).toEqual(['EXPIRED', 'EXPIRED']);
  });

  it('records a failed instruction round without refreshing last success', async () => {
    database = createMigratedTestDatabase();
    seedScheduledReservationFixture(database, { statuses: ['APPROVED'] });
    const fixture = await seedScheduledInstruction(database, {
      suffix: 'scheduled-failure',
      reservationIndex: 1,
      publishedAt: 1000,
    });
    database.exec(
      "INSERT INTO scheduled_job_states(job_name,last_succeeded_at,updated_at) VALUES('instruction_expiry',123,123); CREATE TRIGGER fixture_instruction_expiry_failure BEFORE UPDATE ON order_instructions WHEN OLD.id='phase3g-instruction-scheduled-failure' BEGIN SELECT RAISE(ABORT,'fixture_instruction_failure'); END;",
    );

    const failed = await runScheduledOperations(database, {
      now: 25_000_000,
      only: 'instruction_expiry',
      batchSize: 1,
    });
    expect(failed[0]).toMatchObject({
      outcome: 'FAILED',
      processed_count: 1,
      succeeded_count: 0,
      failed_count: 1,
      backlog_count: 1,
      failure_category: 'job_item_failed',
    });
    const state = await database
      .prepare(
        "SELECT last_succeeded_at,last_failed_at,last_failure_category FROM scheduled_job_states WHERE job_name='instruction_expiry'",
      )
      .first<{
        last_succeeded_at: number;
        last_failed_at: number;
        last_failure_category: string;
      }>();
    expect(state).toEqual({
      last_succeeded_at: 123,
      last_failed_at: 25_000_000,
      last_failure_category: 'job_item_failed',
    });
    expect(await instructionStatuses(database, [fixture.instructionId])).toEqual(['ACTIVE']);
  });
});

type ReservationFixtureStatus = 'PENDING_REVIEW' | 'APPROVED';

function seedScheduledReservationFixture(
  database: SqliteDatabase,
  input: {
    statuses: readonly ReservationFixtureStatus[];
    holdExpiresAt?: readonly number[];
    canonicalUsIndexes?: readonly number[];
  },
): void {
  const buyers = input.statuses.map((_, offset) => offset + 1);
  const held = input.statuses.filter((status) => status === 'PENDING_REVIEW').length;
  const approved = input.statuses.filter((status) => status === 'APPROVED').length;
  database.exec(`
    INSERT INTO seller_organizations (id,marketplace_code,seller_code,origin_channel_id,current_channel_id,seller_sequence,organization_name,status,version,created_at,updated_at,activated_at,disabled_at,next_member_number)
    VALUES ('seller-org-scheduled','AMAZON_JP','ido-mango-910001','seller-channel-ido-mango','seller-channel-ido-mango',910001,'定时任务测试卖家','ACTIVE',1,1,1,1,NULL,2);
    INSERT INTO customer_identity_subjects(id,subject_type,created_at) VALUES ('seller-scheduled-subject','SELLER_ORG_MEMBER',1);
    INSERT INTO seller_organization_members(id,identity_subject_id,organization_id,member_number,username_fallback,display_name,role,primary_owner,status,version,created_at,updated_at,activated_at,disabled_at)
    VALUES ('seller-scheduled-owner','seller-scheduled-subject','seller-org-scheduled',1,'ido-mango-910001-1','负责人','OWNER',1,'ACTIVE',1,1,1,1,NULL);
    ${buyers
      .map(
        (index) => `INSERT INTO customer_identity_subjects(id,subject_type,created_at) VALUES ('buyer-scheduled-subject-${index}','BUYER_CUSTOMER',1);
    INSERT INTO buyer_customers(id,identity_subject_id,marketplace_code,buyer_channel_id,buyer_customer_no,buyer_sequence,display_name,access_status,identity_review_status,version,created_at,updated_at,activated_at,disabled_at)
    VALUES ('buyer-scheduled-${index}','buyer-scheduled-subject-${index}','AMAZON_JP','buyer-channel-wechat-b','20260101B${String(index).padStart(4, '0')}',${index},'测试买家${index}','ACTIVE','CLEAR',1,1,1,1,NULL);`,
      )
      .join('\n')}
    INSERT INTO seller_stores(id,organization_id,marketplace_code,display_name,normalized_name,status,version,created_at,updated_at,disabled_at)
    VALUES ('store-scheduled','seller-org-scheduled','AMAZON_JP','定时任务店铺','定时任务店铺','ACTIVE',1,1,1,NULL);
    INSERT INTO products(id,organization_id,store_id,marketplace_code,asin_display,asin_normalized,status,current_version_no,version,created_at,updated_at,disabled_at)
    VALUES ('product-scheduled','seller-org-scheduled','store-scheduled','AMAZON_JP','B0SCHED001','B0SCHED001','ACTIVE',1,1,1,1,NULL);
    INSERT INTO product_versions(id,product_id,version_no,product_name,search_keywords_json,product_url,buyer_visible_notes,internal_notes,created_by_staff_id,created_at,ordering_guide_expected_amount_jpy,color_spec_mode,default_buyer_self_pay_bps)
    VALUES ('product-scheduled-v1','product-scheduled',1,'定时任务产品','["关键词"]',NULL,NULL,NULL,'zz-phase3h-test-owner',1,1000,'MAIN_IMAGE_VARIANT',1000);
    INSERT INTO demand_batches(id,organization_id,store_id,marketplace_code,product_id,product_version_no,submitted_by_member_id,task_type,target_quantity,buyer_visible_notes,seller_notes,open_at,reservation_deadline,order_deadline,status,review_reason,close_reason,reviewed_by_staff_id,closed_by_staff_id,version,submitted_at,updated_at,reviewed_at,published_at,withdrawn_at,closed_at,held_reservation_count,approved_reservation_count,buyer_self_pay_bps_snapshot,buyer_self_pay_source,buyer_self_pay_override_reason)
    VALUES ('demand-scheduled','seller-org-scheduled','store-scheduled','AMAZON_JP','product-scheduled',1,'seller-scheduled-owner','TEXT',100,NULL,NULL,1,10000,100000000,'PUBLISHED',NULL,NULL,'zz-phase3h-test-owner',NULL,2,1,1,1,1,NULL,NULL,${held},${approved},1000,'PRODUCT_DEFAULT',NULL);
  `);
  for (const index of input.canonicalUsIndexes ?? [])
    database.exec(
      `UPDATE buyer_marketplace_assignments SET marketplace_code='AMAZON_US',version=version+1,updated_at=2 WHERE buyer_customer_id='buyer-scheduled-${index}'`,
    );
  database.exec(
    input.statuses
      .map((status, offset) => {
        const index = offset + 1;
        const approvedStatus = status === 'APPROVED';
        const hold = input.holdExpiresAt?.[offset] ?? 1000;
        return `INSERT INTO product_reservations(id,demand_batch_id,buyer_customer_id,organization_id,store_id,product_id,product_version_no,marketplace_code,status,precheck_snapshot_json,hold_expires_at,order_deadline_snapshot,version,submitted_at,updated_at,decided_by_staff_id,decision_reason,decided_at,cancelled_at,expired_at,reopened_count,buyer_self_pay_bps_snapshot,reference_order_amount_jpy_snapshot,estimated_self_pay_jpy_snapshot,estimated_refundable_principal_jpy_snapshot,buyer_self_pay_accepted_at,buyer_self_pay_accepted_demand_version)
      VALUES ('reservation-scheduled-${index}','demand-scheduled','buyer-scheduled-${index}','seller-org-scheduled','store-scheduled','product-scheduled',1,'AMAZON_JP','${status}','{}',${hold},100000000,${approvedStatus ? 2 : 1},1,2,${approvedStatus ? "'zz-phase3h-test-owner'" : 'NULL'},NULL,${approvedStatus ? 2 : 'NULL'},NULL,NULL,0,1000,1000,0,1000,1,2);`;
      })
      .join('\n'),
  );
}

function seedScheduledInstruction(
  database: SqliteDatabase,
  input: { suffix: string; reservationIndex: number; publishedAt: number },
) {
  return seedPhase3GInstructionFixture(database, {
    suffix: input.suffix,
    reservationId: `reservation-scheduled-${input.reservationIndex}`,
    buyerCustomerId: `buyer-scheduled-${input.reservationIndex}`,
    productId: 'product-scheduled',
    productVersionId: 'product-scheduled-v1',
    staffId: 'zz-phase3h-test-owner',
    referenceOrderAmountJpy: 1000,
    buyerSelfPayBps: 1000,
    publishedAt: input.publishedAt,
    seedEvidenceFile: false,
  });
}

async function reservationExpiryFactCounts(
  database: SqliteDatabase,
): Promise<{ expired: number; events: number; audits: number; outbox: number }> {
  const row = await database
    .prepare(
      `SELECT
    (SELECT COUNT(*) FROM product_reservations WHERE status='EXPIRED') AS expired,
    (SELECT COUNT(*) FROM reservation_events WHERE event_type='RESERVATION_EXPIRED') AS events,
    (SELECT COUNT(*) FROM audit_events WHERE event_type='RESERVATION_EXPIRED') AS audits,
    (SELECT COUNT(*) FROM integration_outbox WHERE event_type='RESERVATION_EXPIRED') AS outbox`,
    )
    .first<{ expired: number; events: number; audits: number; outbox: number }>();
  return {
    expired: Number(row?.expired ?? 0),
    events: Number(row?.events ?? 0),
    audits: Number(row?.audits ?? 0),
    outbox: Number(row?.outbox ?? 0),
  };
}

async function instructionBusinessFactCounts(
  database: SqliteDatabase,
): Promise<{
  expired: number;
  events: number;
  audits: number;
  outbox: number;
  idempotency: number;
}> {
  const row = await database
    .prepare(
      `SELECT
    (SELECT COUNT(*) FROM order_instructions WHERE status='EXPIRED') AS expired,
    (SELECT COUNT(*) FROM order_instruction_events WHERE event_type='INSTRUCTION_EXPIRED') AS events,
    (SELECT COUNT(*) FROM audit_events) AS audits,
    (SELECT COUNT(*) FROM integration_outbox) AS outbox,
    (SELECT COUNT(*) FROM command_idempotency_records) AS idempotency`,
    )
    .first<{
      expired: number;
      events: number;
      audits: number;
      outbox: number;
      idempotency: number;
    }>();
  return {
    expired: Number(row?.expired ?? 0),
    events: Number(row?.events ?? 0),
    audits: Number(row?.audits ?? 0),
    outbox: Number(row?.outbox ?? 0),
    idempotency: Number(row?.idempotency ?? 0),
  };
}

async function instructionStatuses(
  database: SqliteDatabase,
  ids: readonly string[],
): Promise<string[]> {
  const statuses: string[] = [];
  for (const id of ids)
    statuses.push(
      (
        await database
          .prepare('SELECT status FROM order_instructions WHERE id=?')
          .bind(id)
          .first<{ status: string }>()
      )?.status ?? 'MISSING',
    );
  return statuses;
}
