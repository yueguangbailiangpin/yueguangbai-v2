import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import type {
  SqlDatabase,
  SqlRunResult,
  SqlStatement,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import {
  cancelReservation,
} from './cancel-reservation';
import {
  decideReservation,
} from './decide-reservation';
import {
  expireReservation,
} from './expire-reservation';
import {
  reopenReservation,
} from './reopen-reservation';
import {
  submitReservation as submitReservationService,
} from './submit-reservation';
import {
  readStaffReservationSchedule,
} from '../product-reservation-scheduling/read-model';
import {
  confirmDemandSchedule,
  previewDemandSchedule,
} from '../product-reservation-scheduling/schedule-command';
import type {
  SchedulingStaffActor,
} from '../product-reservation-scheduling/shared';
import type {
  BuyerReservationActor,
  ReservationStaffActor,
} from './reservation-shared';

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('buyer reservations and atomic demand capacity', () => {
  it('previews and confirms an immutable schedule without changing order or finance facts', async () => {
    database = createMigratedTestDatabase();
    seedReservationFixture(database);
    await submitReservation(database, {
      demandBatchId: 'demand-1', expectedDemandVersion: 2,
    }, {
      actor: buyerActor('buyer-1'),
      idempotencyKey: 'schedule:buyer-1',
      now: 5000,
    });

    const owner = ownerScheduleActor();
    const stalePreview = await previewDemandSchedule(database, owner, {
      demandBatchId: 'demand-1',
      expectedVersion: 3,
      firstOrderDate: '1970-01-01',
      orderIntervalDays: 1,
      ordersPerRun: 3,
      reason: '首次补齐历史排期',
    });
    await submitReservation(database, {
      demandBatchId: 'demand-1', expectedDemandVersion: 3,
    }, {
      actor: buyerActor('buyer-2'),
      idempotencyKey: 'schedule:buyer-2',
      now: 5001,
    });
    await expect(confirmDemandSchedule(database, owner, {
      demandBatchId: 'demand-1',
      expectedVersion: 3,
      firstOrderDate: '1970-01-01',
      orderIntervalDays: 1,
      ordersPerRun: 3,
      reason: '首次补齐历史排期',
      previewHash: stalePreview.preview_hash,
    }, {
      idempotencyKey: 'schedule:stale-confirm',
      now: 6000,
    })).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      status: 409,
    });

    const preview = await previewDemandSchedule(database, owner, {
      demandBatchId: 'demand-1',
      expectedVersion: 4,
      firstOrderDate: '1970-01-01',
      orderIntervalDays: 1,
      ordersPerRun: 3,
      reason: '首次补齐历史排期',
    });
    const sellerOpsPreview = await previewDemandSchedule(
      database,
      sellerOpsScheduleActor(['seller-org-1']),
      {
        demandBatchId: 'demand-1',
        expectedVersion: 4,
        firstOrderDate: '1970-01-01',
        orderIntervalDays: 1,
        ordersPerRun: 3,
        reason: '首次补齐历史排期',
      },
    );
    expect(sellerOpsPreview.preview_hash).toBe(preview.preview_hash);
    await expect(previewDemandSchedule(
      database,
      sellerOpsScheduleActor(['another-seller-org']),
      {
        demandBatchId: 'demand-1', expectedVersion: 4,
        firstOrderDate: '1970-01-01', orderIntervalDays: 1,
        ordersPerRun: 3, reason: '越权组织',
      },
    )).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(previewDemandSchedule(
      database,
      sellerOpsScheduleActor(['seller-org-1'], ['PRODUCT_VIEW']),
      {
        demandBatchId: 'demand-1', expectedVersion: 4,
        firstOrderDate: '1970-01-01', orderIntervalDays: 1,
        ordersPerRun: 3, reason: '个人禁用后无有效编辑权限',
      },
    )).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(preview).toMatchObject({
      effective_reservation_count: 2,
      affected_reservation_count: 2,
      theoretical_last_order_date: '1970-01-01',
    });
    await expect(confirmDemandSchedule(database, owner, {
      demandBatchId: 'demand-1',
      expectedVersion: 4,
      firstOrderDate: '1970-01-01',
      orderIntervalDays: 1,
      ordersPerRun: 3,
      reason: '首次补齐历史排期',
      previewHash: '0'.repeat(64),
    }, {
      idempotencyKey: 'schedule:tampered-preview',
      now: 6050,
    })).rejects.toMatchObject({
      code: 'SCHEDULE_PREVIEW_STALE', status: 409,
    });
    const before = await orderFinanceCounts(database);
    const confirmed = await confirmDemandSchedule(database, owner, {
      demandBatchId: 'demand-1',
      expectedVersion: 4,
      firstOrderDate: '1970-01-01',
      orderIntervalDays: 1,
      ordersPerRun: 3,
      reason: '首次补齐历史排期',
      previewHash: preview.preview_hash,
    }, {
      idempotencyKey: 'schedule:confirm',
      now: 6100,
    });
    expect(confirmed).toMatchObject({
      demand_version: 5,
      schedule: {
        version_no: 1,
        affected_reservation_count: 2,
        change_reason: '首次补齐历史排期',
      },
      replayed: false,
    });
    expect(await confirmDemandSchedule(database, owner, {
      demandBatchId: 'demand-1',
      expectedVersion: 4,
      firstOrderDate: '1970-01-01',
      orderIntervalDays: 1,
      ordersPerRun: 3,
      reason: '首次补齐历史排期',
      previewHash: preview.preview_hash,
    }, {
      idempotencyKey: 'schedule:confirm',
      now: 6200,
    })).toEqual({ ...confirmed, replayed: true });
    expect(await orderFinanceCounts(database)).toEqual(before);

    const preSalesPage = await readStaffReservationSchedule(
      database,
      preSalesScheduleActor(),
      'demand-1',
      { limit: 20 },
    );
    expect(preSalesPage.items.map((item) => ({
      rank: item.rank,
      planned: item.planned_order_date,
      buyerId: item.buyer_customer_id,
      name: item.buyer_display_name,
    }))).toEqual([
      { rank: 1, planned: '1970-01-01', buyerId: 'buyer-1', name: '买家一' },
      { rank: 2, planned: '1970-01-01', buyerId: null, name: null },
    ]);
    await expect(previewDemandSchedule(database, buyerRefundActor(), {
      demandBatchId: 'demand-1',
      expectedVersion: 5,
      firstOrderDate: '1970-01-01',
      orderIntervalDays: 1,
      ordersPerRun: 3,
      reason: '不允许修改',
    })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(previewDemandSchedule(database, owner, {
      demandBatchId: 'demand-1',
      expectedVersion: 5,
      firstOrderDate: '1970-01-01',
      orderIntervalDays: 1,
      ordersPerRun: 1,
      reason: '超过截止日',
    })).rejects.toMatchObject({
      code: 'SCHEDULE_WINDOW_CONFLICT', status: 409,
    });
    await expect(database.prepare(`
      UPDATE demand_order_schedule_versions SET change_reason='覆盖历史'
      WHERE demand_batch_id='demand-1'
    `).run()).rejects.toThrow('demand_order_schedule_versions_are_immutable');
  });

  it('submits a pending reservation, consumes a temporary hold, and replays', async () => {
    database = createMigratedTestDatabase();
    seedReservationFixture(database);

    const first = await submitReservation(
      database,
      { demandBatchId: 'demand-1' },
      {
        actor: buyerActor('buyer-1'),
        idempotencyKey: 'reservation:submit:0001',
        now: 5000,
      },
    );

    expect(first).toMatchObject({
      demand_batch_id: 'demand-1',
      buyer_customer_id: 'buyer-1',
      product_id: 'product-1',
      status: 'PENDING_REVIEW',
      hold_expires_at: 10_000,
      order_deadline_snapshot: 20_000,
      version: 1,
      replayed: false,
    });

    const replay = await submitReservation(
      database,
      { demandBatchId: 'demand-1' },
      {
        actor: buyerActor('buyer-1'),
        idempotencyKey: 'reservation:submit:0001',
        now: 5100,
      },
    );
    expect(replay).toEqual({
      ...first,
      replayed: true,
    });
    expect(await demandCounts(database, 'demand-1'))
      .toEqual({ held: 1, approved: 0 });

    await expect(submitReservation(
      database,
      { demandBatchId: 'demand-1' },
      {
        actor: buyerActor('buyer-1'),
        idempotencyKey: 'reservation:submit:duplicate',
        now: 5200,
      },
    )).rejects.toMatchObject({
      code: 'RESERVATION_ALREADY_EXISTS',
      status: 409,
    });
  });

  it('rejects a schedule confirm when a reservation wins after its re-read', async () => {
    database = createMigratedTestDatabase();
    seedReservationFixture(database);

    const owner = ownerScheduleActor();
    const preview = await previewDemandSchedule(database, owner, {
      demandBatchId: 'demand-1',
      expectedVersion: 2,
      firstOrderDate: '1970-01-01',
      orderIntervalDays: 1,
      ordersPerRun: 3,
      reason: '确认 re-read 与 batch commit 竞态',
    });
    const racingDatabase = new CommitWindowRaceDatabase(database);

    await expect(confirmDemandSchedule(racingDatabase, owner, {
      demandBatchId: 'demand-1',
      expectedVersion: 2,
      firstOrderDate: '1970-01-01',
      orderIntervalDays: 1,
      ordersPerRun: 3,
      reason: '确认 re-read 与 batch commit 竞态',
      previewHash: preview.preview_hash,
    }, {
      idempotencyKey: 'schedule:race-window',
      now: 6100,
    })).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      status: 409,
    });

    const state = await database.prepare(`
      SELECT
        version,
        held_reservation_count AS held,
        (SELECT COUNT(*) FROM product_reservations
          WHERE demand_batch_id='demand-1') AS reservations,
        (SELECT COUNT(*) FROM demand_order_schedule_versions
          WHERE demand_batch_id='demand-1') AS schedules
      FROM demand_batches
      WHERE id='demand-1'
    `).first<{
      version: number;
      held: number;
      reservations: number;
      schedules: number;
    }>();
    expect(state).toEqual({
      version: 3,
      held: 1,
      reservations: 1,
      schedules: 0,
    });

    const idempotency = await database.prepare(`
      SELECT status, error_code, response_json, result_references_json
      FROM command_idempotency_records
      WHERE actor_type='STAFF'
        AND actor_id=?
        AND idempotency_key='schedule:race-window'
    `).bind(owner.staffId).first<{
      status: string;
      error_code: string | null;
      response_json: string | null;
      result_references_json: string | null;
    }>();
    expect(idempotency).toEqual({
      status: 'FAILED',
      error_code: 'VERSION_CONFLICT',
      response_json: null,
      result_references_json: null,
    });
  });

  it('allows at most one buyer to take the final slot', async () => {
    database = createMigratedTestDatabase();
    seedReservationFixture(database, {
      targetQuantity: 1,
    });

    await submitReservation(database, {
      demandBatchId: 'demand-1',
    }, {
      actor: buyerActor('buyer-1'),
      idempotencyKey: 'reservation:last-slot:buyer-1',
      now: 5000,
    });

    await expect(submitReservation(database, {
      demandBatchId: 'demand-1',
    }, {
      actor: buyerActor('buyer-2'),
      idempotencyKey: 'reservation:last-slot:buyer-2',
      now: 5001,
    })).rejects.toMatchObject({
      code: 'CAPACITY_FULL',
      status: 409,
    });

    expect(await demandCounts(database, 'demand-1'))
      .toEqual({ held: 1, approved: 0 });
  });

  it('blocks an active reservation for the same product across batches', async () => {
    database = createMigratedTestDatabase();
    seedReservationFixture(database);

    await submitReservation(database, {
      demandBatchId: 'demand-1',
    }, {
      actor: buyerActor('buyer-1'),
      idempotencyKey: 'reservation:product-conflict:one',
      now: 5000,
    });

    await expect(submitReservation(database, {
      demandBatchId: 'demand-2-same-product',
    }, {
      actor: buyerActor('buyer-1'),
      idempotencyKey: 'reservation:product-conflict:two',
      now: 5100,
    })).rejects.toMatchObject({
      code: 'BUYER_PRODUCT_RESERVATION_CONFLICT',
      status: 409,
    });
  });

  it('approves or rejects and moves held capacity atomically', async () => {
    database = createMigratedTestDatabase();
    seedReservationFixture(database);

    const approvedSource = await submitReservation(
      database,
      { demandBatchId: 'demand-1' },
      {
        actor: buyerActor('buyer-1'),
        idempotencyKey: 'reservation:approve:submit',
        now: 5000,
      },
    );
    const approved = await decideReservation(
      database,
      {
        reservationId: approvedSource.reservation_id,
        expectedVersion: 1,
        decision: 'APPROVE',
      },
      {
        actor: preSalesActor(),
        idempotencyKey: 'reservation:approve:decision',
        now: 6000,
      },
    );

    expect(approved.status).toBe('APPROVED');
    expect(await demandCounts(database, 'demand-1'))
      .toEqual({ held: 0, approved: 1 });

    const rejectedSource = await submitReservation(
      database,
      { demandBatchId: 'demand-1', expectedDemandVersion: 4 },
      {
        actor: buyerActor('buyer-2'),
        idempotencyKey: 'reservation:reject:submit',
        now: 6100,
      },
    );
    const rejected = await decideReservation(
      database,
      {
        reservationId: rejectedSource.reservation_id,
        expectedVersion: 1,
        decision: 'REJECT',
        rejectionReason: ' 买家资料需要重新核对 ',
      },
      {
        actor: preSalesActor(),
        idempotencyKey: 'reservation:reject:decision',
        now: 6200,
      },
    );

    expect(rejected).toMatchObject({
      status: 'REJECTED',
      version: 2,
      decision_reason: '买家资料需要重新核对',
    });
    expect(await demandCounts(database, 'demand-1'))
      .toEqual({ held: 0, approved: 1 });
  });

  it('releases held or approved capacity on buyer cancellation', async () => {
    database = createMigratedTestDatabase();
    seedReservationFixture(database);

    const pending = await submitReservation(
      database,
      { demandBatchId: 'demand-1' },
      {
        actor: buyerActor('buyer-1'),
        idempotencyKey: 'reservation:cancel:pending-submit',
        now: 5000,
      },
    );
    await cancelReservation(database, {
      reservationId: pending.reservation_id,
      expectedVersion: 1,
    }, {
      actor: buyerActor('buyer-1'),
      idempotencyKey: 'reservation:cancel:pending',
      now: 5500,
    });
    expect(await demandCounts(database, 'demand-1'))
      .toEqual({ held: 0, approved: 0 });

    const approved = await submitReservation(
      database,
      { demandBatchId: 'demand-1', expectedDemandVersion: 4 },
      {
        actor: buyerActor('buyer-2'),
        idempotencyKey: 'reservation:cancel:approved-submit',
        now: 5600,
      },
    );
    await decideReservation(database, {
      reservationId: approved.reservation_id,
      expectedVersion: 1,
      decision: 'APPROVE',
    }, {
      actor: preSalesActor(),
      idempotencyKey: 'reservation:cancel:approve',
      now: 5700,
    });
    await cancelReservation(database, {
      reservationId: approved.reservation_id,
      expectedVersion: 2,
    }, {
      actor: buyerActor('buyer-2'),
      idempotencyKey: 'reservation:cancel:approved',
      now: 5800,
    });
    expect(await demandCounts(database, 'demand-1'))
      .toEqual({ held: 0, approved: 0 });
  });

  it('expires pending holds and approved slots at their deadlines', async () => {
    database = createMigratedTestDatabase();
    seedReservationFixture(database);

    const pending = await submitReservation(
      database,
      { demandBatchId: 'demand-1' },
      {
        actor: buyerActor('buyer-1'),
        idempotencyKey: 'reservation:expire:pending-submit',
        now: 5000,
      },
    );
    await expect(expireReservation(database, {
      reservationId: pending.reservation_id,
      expectedVersion: 1,
    }, {
      idempotencyKey: 'reservation:expire:early',
      now: 9999,
    })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 409,
    });

    await expireReservation(database, {
      reservationId: pending.reservation_id,
      expectedVersion: 1,
    }, {
      idempotencyKey: 'reservation:expire:pending',
      now: 10_000,
    });
    expect(await demandCounts(database, 'demand-1'))
      .toEqual({ held: 0, approved: 0 });

    const approved = await submitReservation(
      database,
      { demandBatchId: 'demand-2' },
      {
        actor: buyerActor('buyer-2'),
        idempotencyKey: 'reservation:expire:approved-submit',
        now: 5000,
      },
    );
    await decideReservation(database, {
      reservationId: approved.reservation_id,
      expectedVersion: 1,
      decision: 'APPROVE',
    }, {
      actor: preSalesActor(),
      idempotencyKey: 'reservation:expire:approved-decision',
      now: 6000,
    });
    await expireReservation(database, {
      reservationId: approved.reservation_id,
      expectedVersion: 2,
    }, {
      idempotencyKey: 'reservation:expire:approved',
      now: 20_000,
    });
    expect(await demandCounts(database, 'demand-2'))
      .toEqual({ held: 0, approved: 0 });
  });

  it('reopens a terminal reservation and preserves event history', async () => {
    database = createMigratedTestDatabase();
    seedReservationFixture(database);

    const submitted = await submitReservation(
      database,
      { demandBatchId: 'demand-1' },
      {
        actor: buyerActor('buyer-1'),
        idempotencyKey: 'reservation:reopen:submit',
        now: 5000,
      },
    );
    await decideReservation(database, {
      reservationId: submitted.reservation_id,
      expectedVersion: 1,
      decision: 'REJECT',
      rejectionReason: '首次资料不完整',
    }, {
      actor: preSalesActor(),
      idempotencyKey: 'reservation:reopen:reject',
      now: 5500,
    });

    const reopened = await reopenReservation(database, {
      reservationId: submitted.reservation_id,
      expectedVersion: 2,
      reason: ' 买家已补充资料 ',
    }, {
      actor: preSalesActor(),
      idempotencyKey: 'reservation:reopen:command',
      now: 6000,
    });

    expect(reopened).toMatchObject({
      status: 'PENDING_REVIEW',
      version: 3,
      reopened_count: 1,
      reason: '买家已补充资料',
    });
    expect(await demandCounts(database, 'demand-1'))
      .toEqual({ held: 1, approved: 0 });

    const events = await database.prepare(`
      SELECT event_type
      FROM reservation_events
      WHERE reservation_id=?
      ORDER BY created_at, id
    `).bind(
      submitted.reservation_id,
    ).all<{ event_type: string }>();

    expect(events.results.map((event) =>
      event.event_type)).toEqual([
        'RESERVATION_SUBMITTED',
        'RESERVATION_REJECTED',
        'RESERVATION_REOPENED',
      ]);
  });

  it('enforces eligibility, staff permission, timing, and event immutability', async () => {
    database = createMigratedTestDatabase();
    seedReservationFixture(database);

    await expect(submitReservation(database, {
      demandBatchId: 'demand-1',
    }, {
      actor: {
        ...buyerActor('buyer-1'),
        accessStatus: 'DISABLED',
      },
      idempotencyKey: 'reservation:guard:disabled',
      now: 5000,
    })).rejects.toMatchObject({
      code: 'CUSTOMER_NOT_ACTIVE',
      status: 409,
    });

    await expect(submitReservation(database, {
      demandBatchId: 'demand-future',
    }, {
      actor: buyerActor('buyer-1'),
      idempotencyKey: 'reservation:guard:future',
      now: 5000,
    })).rejects.toMatchObject({
      code: 'DEMAND_BATCH_EXPIRED',
      status: 409,
    });

    const pending = await submitReservation(
      database,
      { demandBatchId: 'demand-1' },
      {
        actor: buyerActor('buyer-1'),
        idempotencyKey: 'reservation:guard:submit',
        now: 5000,
      },
    );
    await expect(decideReservation(database, {
      reservationId: pending.reservation_id,
      expectedVersion: 1,
      decision: 'APPROVE',
    }, {
      actor: {
        ...preSalesActor(),
        permissions: new Set(),
      },
      idempotencyKey: 'reservation:guard:staff',
      now: 6000,
    })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });

    await expect(database.prepare(`
      UPDATE reservation_events
      SET next_status='APPROVED'
      WHERE reservation_id=?
    `).bind(
      pending.reservation_id,
    ).run()).rejects.toThrow(
      'reservation_events_are_immutable',
    );
    await expect(database.prepare(`
      DELETE FROM reservation_events
      WHERE reservation_id=?
    `).bind(
      pending.reservation_id,
    ).run()).rejects.toThrow(
      'reservation_events_are_immutable',
    );
  });
});

function submitReservation(
  database: SqliteDatabase,
  input: { demandBatchId: string; expectedDemandVersion?: number },
  command: Parameters<typeof submitReservationService>[2],
): ReturnType<typeof submitReservationService> {
  return submitReservationService(database, {
    ...input,
    expectedDemandVersion: input.expectedDemandVersion ?? 2,
    acceptedBuyerSelfPayBps: 1000,
  }, command);
}

function seedReservationFixture(
  database: SqliteDatabase,
  options: {
    targetQuantity?: number;
  } = {},
): void {
  const targetQuantity = options.targetQuantity ?? 3;

  database.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'staff-pre-sales', '售前', 'ACTIVE', 1,
      1, 1000, 1000, NULL
    );

    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES (
      'staff-pre-sales', 'pre_sales', 'ACTIVE', NULL,
      1000, NULL, 1000, 1000
    );
    INSERT INTO staff_marketplace_scopes (
      id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,
      assigned_at,revoked_at,reason,created_at,updated_at,scope_kind
    ) VALUES ('scope-reservation-pre-jp','staff-pre-sales','pre_sales',
      'AMAZON_JP','ACTIVE','zz-phase3h-test-owner',1000,NULL,
      'TEST_PRIMARY',1000,1000,'PRIMARY');
    INSERT INTO staff_departments (
      id, code, name, status, version, created_at, updated_at, disabled_at
    ) VALUES ('department-pre-sales','pre-sales','Pre Sales',
      'ACTIVE',1,1000,1000,NULL);
    INSERT INTO staff_teams (
      id, department_id, code, name, status, version,
      created_at, updated_at, disabled_at
    ) VALUES ('team-pre-sales','department-pre-sales','pre-sales',
      'Pre Sales','ACTIVE',1,1000,1000,NULL);
    INSERT INTO staff_team_memberships (
      staff_id, team_id, status, joined_at, ended_at, created_at, updated_at
    ) VALUES ('staff-pre-sales','team-pre-sales','ACTIVE',1000,NULL,1000,1000);
    INSERT INTO staff_team_memberships (
      staff_id, team_id, status, joined_at, ended_at, created_at, updated_at
    ) VALUES ('zz-phase3h-test-owner','team-pre-sales','ACTIVE',1000,NULL,1000,1000);
    INSERT INTO staff_team_leaders (
      staff_id, team_id, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES ('staff-pre-sales','team-pre-sales','ACTIVE',
      'zz-phase3h-test-owner',1000,NULL,1000,1000);

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status,
      version, created_at, updated_at,
      activated_at, disabled_at, next_member_number
    ) VALUES (
      'seller-org-1', 'JP', 'ido-mango-9001',
      'seller-channel-ido-mango',
      'seller-channel-ido-mango',
      9001, '预约卖家', 'ACTIVE',
      1, 1000, 1000, 1000, NULL, 2
    );

    INSERT INTO customer_identity_subjects (
      id, subject_type, created_at
    ) VALUES
      ('seller-owner-subject', 'SELLER_ORG_MEMBER', 1000),
      ('buyer-subject-1', 'BUYER_CUSTOMER', 1000),
      ('buyer-subject-2', 'BUYER_CUSTOMER', 1000),
      ('buyer-subject-3', 'BUYER_CUSTOMER', 1000);

    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id,
      member_number, username_fallback, display_name,
      role, primary_owner, status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES (
      'seller-owner', 'seller-owner-subject',
      'seller-org-1', 1, 'ido-mango-9001-1',
      '负责人', 'OWNER', 1, 'ACTIVE', 1,
      1000, 1000, 1000, NULL
    );

    INSERT INTO buyer_channels (
      id, code, name, status, next_sequence, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'buyer-channel-b', 'B', '预约买家渠道',
      'ACTIVE', 1, 1, 1000, 1000, NULL
    );

    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code,
      buyer_channel_id, buyer_customer_no,
      buyer_sequence, first_valid_order_business_date,
      display_name, access_status,
      identity_review_status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES
      (
        'buyer-1', 'buyer-subject-1', 'JP',
        'buyer-channel-b', NULL, NULL, NULL,
        '买家一', 'ACTIVE', 'CLEAR', 1,
        1000, 1000, 1000, NULL
      ),
      (
        'buyer-2', 'buyer-subject-2', 'JP',
        'buyer-channel-b', NULL, NULL, NULL,
        '买家二', 'ACTIVE', 'CLEAR', 1,
        1000, 1000, 1000, NULL
      ),
      (
        'buyer-3', 'buyer-subject-3', 'JP',
        'buyer-channel-b', NULL, NULL, NULL,
        '买家三', 'ACTIVE', 'CLEAR', 1,
        1000, 1000, 1000, NULL
      );

    INSERT INTO seller_stores (
      id, organization_id, marketplace_code,
      display_name, normalized_name, status,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'store-1', 'seller-org-1', 'JP',
      '预约店铺', '预约店铺', 'ACTIVE',
      1, 1000, 1000, NULL
    );

    INSERT INTO products (
      id, organization_id, store_id, marketplace_code,
      asin_display, asin_normalized, status,
      current_version_no, version,
      created_at, updated_at, disabled_at
    ) VALUES
      (
        'product-1', 'seller-org-1', 'store-1', 'JP',
        'B0RESERVE1', 'B0RESERVE1', 'ACTIVE',
        1, 1, 1000, 1000, NULL
      ),
      (
        'product-2', 'seller-org-1', 'store-1', 'JP',
        'B0RESERVE2', 'B0RESERVE2', 'ACTIVE',
        1, 1, 1000, 1000, NULL
      );

    INSERT INTO product_versions (
      id, product_id, version_no, product_name,
      search_keywords_json, product_url,
      buyer_visible_notes, internal_notes,
      created_by_staff_id, created_at
    ,
          ordering_guide_expected_amount_jpy,
          color_spec_mode,
          default_buyer_self_pay_bps,
          order_interval_days, orders_per_run) VALUES
      (
        'product-1-v1', 'product-1', 1,
        '预约产品一', '["关键词一"]',
        'https://www.amazon.co.jp/reservation-one',
        '公开说明一', '内部说明一',
        'staff-pre-sales', 1000
      ,
          1980, 'MAIN_IMAGE_VARIANT', 1000, 1, 3),
      (
        'product-2-v1', 'product-2', 1,
        '预约产品二', '["关键词二"]',
        'https://www.amazon.co.jp/reservation-two',
        '公开说明二', '内部说明二',
        'staff-pre-sales', 1000
      ,
          1980, 'MAIN_IMAGE_VARIANT', 1000, 1, 3);

    INSERT INTO demand_batches (
      id, organization_id, store_id, marketplace_code,
      product_id, product_version_no,
      submitted_by_member_id, task_type,
      target_quantity, buyer_visible_notes,
      seller_notes, open_at,
      reservation_deadline, order_deadline,
      status, review_reason, close_reason,
      reviewed_by_staff_id, closed_by_staff_id,
      version, submitted_at, updated_at,
      reviewed_at, published_at,
      withdrawn_at, closed_at,
      held_reservation_count,
      approved_reservation_count,
      buyer_self_pay_bps_snapshot,
      buyer_self_pay_source,
      buyer_self_pay_override_reason
    ) VALUES
      (
        'demand-1', 'seller-org-1', 'store-1', 'JP',
        'product-1', 1, 'seller-owner', 'IMAGE',
        ${targetQuantity}, '公开说明', '内部说明',
        4000, 10000, 20000,
        'PUBLISHED', NULL, NULL,
        'staff-pre-sales', NULL,
        2, 1000, 3000, 3000, 3000, NULL, NULL,
        0, 0, 1000, 'PRODUCT_DEFAULT', NULL
      ),
      (
        'demand-2-same-product',
        'seller-org-1', 'store-1', 'JP',
        'product-1', 1, 'seller-owner', 'TEXT',
        3, '公开说明', '内部说明',
        4000, 10000, 20000,
        'PUBLISHED', NULL, NULL,
        'staff-pre-sales', NULL,
        2, 1000, 3000, 3000, 3000, NULL, NULL,
        0, 0, 1000, 'PRODUCT_DEFAULT', NULL
      ),
      (
        'demand-2', 'seller-org-1', 'store-1', 'JP',
        'product-2', 1, 'seller-owner', 'VIDEO',
        3, '公开说明', '内部说明',
        4000, 10000, 20000,
        'PUBLISHED', NULL, NULL,
        'staff-pre-sales', NULL,
        2, 1000, 3000, 3000, 3000, NULL, NULL,
        0, 0, 1000, 'PRODUCT_DEFAULT', NULL
      ),
      (
        'demand-future', 'seller-org-1', 'store-1', 'JP',
        'product-2', 1, 'seller-owner', 'RATING',
        3, '公开说明', '内部说明',
        8000, 10000, 20000,
        'PUBLISHED', NULL, NULL,
        'staff-pre-sales', NULL,
        2, 1000, 3000, 3000, 3000, NULL, NULL,
        0, 0, 1000, 'PRODUCT_DEFAULT', NULL
      );
  `);
}

class CommitWindowRaceDatabase implements SqlDatabase {
  private injected = false;

  constructor(private readonly database: SqliteDatabase) {}

  prepare(sql: string): SqlStatement {
    return this.database.prepare(sql);
  }

  async batch(
    statements: readonly SqlStatement[],
  ): Promise<SqlRunResult[]> {
    if (!this.injected) {
      this.injected = true;
      await submitReservation(this.database, {
        demandBatchId: 'demand-1',
        expectedDemandVersion: 2,
      }, {
        actor: buyerActor('buyer-3'),
        idempotencyKey: 'reservation:race-window',
        now: 6050,
      });
    }
    return this.database.batch(statements);
  }
}

function buyerActor(
  buyerCustomerId: string,
): BuyerReservationActor {
  return {
    buyerCustomerId,
    marketplaceCode: 'JP',
    accessStatus: 'ACTIVE',
    identityReviewStatus: 'CLEAR',
  };
}

function preSalesActor(): ReservationStaffActor {
  return {
    staffId: 'staff-pre-sales',
    displayName: '售前',
    roles: ['pre_sales'] as readonly StaffRoleCode[],
    permissions: new Set<StaffPermissionCode>([
      'RESERVATION_DECIDE',
    ]),
  };
}

function ownerScheduleActor(): SchedulingStaffActor {
  return {
    staffId: 'zz-phase3h-test-owner',
    displayName: '总管理员',
    roles: ['owner'],
    permissions: new Set([
      'PRODUCT_VIEW', 'PRODUCT_REVIEW', 'DEMAND_PUBLISH',
    ]),
    dataScope: {
      type: 'GLOBAL',
      buyerCustomerIds: [],
      sellerOrganizationIds: [],
      teamIds: [],
      marketplaceCodes: [],
    },
  };
}

function preSalesScheduleActor(): SchedulingStaffActor {
  return {
    staffId: 'staff-pre-sales',
    displayName: '售前',
    roles: ['pre_sales'],
    permissions: new Set(['PRODUCT_VIEW']),
    dataScope: {
      type: 'ASSIGNED_BUYERS',
      buyerCustomerIds: ['buyer-1'],
      sellerOrganizationIds: [],
      teamIds: [],
      marketplaceCodes: ['AMAZON_JP'],
    },
  };
}

function sellerOpsScheduleActor(
  sellerOrganizationIds: string[],
  permissions: StaffPermissionCode[] = [
    'PRODUCT_VIEW', 'PRODUCT_REVIEW', 'DEMAND_PUBLISH',
  ],
): SchedulingStaffActor {
  return {
    staffId: 'staff-seller-ops',
    displayName: '卖家对接',
    roles: ['seller_ops'],
    permissions: new Set(permissions),
    dataScope: {
      type: 'ASSIGNED_SELLER_ORGANIZATIONS',
      buyerCustomerIds: [],
      sellerOrganizationIds,
      teamIds: [],
      marketplaceCodes: ['AMAZON_JP'],
    },
  };
}

function buyerRefundActor(): SchedulingStaffActor {
  return {
    staffId: 'staff-pre-sales',
    displayName: '退款专员',
    roles: ['buyer_refund'],
    permissions: new Set([
      'PRODUCT_VIEW', 'PRODUCT_REVIEW', 'DEMAND_PUBLISH',
    ]),
    dataScope: {
      type: 'GLOBAL',
      buyerCustomerIds: [],
      sellerOrganizationIds: [],
      teamIds: [],
      marketplaceCodes: [],
    },
  };
}

async function orderFinanceCounts(database: SqliteDatabase): Promise<{
  evidence: number;
  formalOrders: number;
  snapshots: number;
  moneySnapshots: number;
}> {
  const row = await database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM order_evidence_submissions) AS evidence,
      (SELECT COUNT(*) FROM formal_orders) AS formalOrders,
      (SELECT COUNT(*) FROM formal_order_financial_snapshots) AS snapshots,
      (SELECT COUNT(*) FROM formal_order_marketplace_money_snapshots)
        AS moneySnapshots
  `).first<{
    evidence: number;
    formalOrders: number;
    snapshots: number;
    moneySnapshots: number;
  }>();
  return {
    evidence: Number(row?.evidence ?? 0),
    formalOrders: Number(row?.formalOrders ?? 0),
    snapshots: Number(row?.snapshots ?? 0),
    moneySnapshots: Number(row?.moneySnapshots ?? 0),
  };
}

async function demandCounts(
  database: SqliteDatabase,
  demandBatchId: string,
): Promise<{
  held: number;
  approved: number;
}> {
  const row = await database.prepare(`
    SELECT
      held_reservation_count AS held,
      approved_reservation_count AS approved
    FROM demand_batches
    WHERE id=?
  `).bind(
    demandBatchId,
  ).first<{
    held: number;
    approved: number;
  }>();

  if (!row) throw new Error('missing_demand');
  return {
    held: Number(row.held),
    approved: Number(row.approved),
  };
}
