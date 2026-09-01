import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import type {
  SellerMemberRole,
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
import { createApp } from '../app';
import { resolveAssignmentStaffAuthorization } from '../staff-assignment';
import { registerStaffCatalogWorkflowRoutes } from '../staff/catalog-routes';
import {
  closeDemandBatch,
} from './close-demand-batch';
import {
  listBuyerPublicDemandBatches,
} from './list-public-demand-batches';
import {
  readDemandReviewContext,
  reviewDemandBatch,
} from './review-demand-batch';
import {
  submitDemandBatch,
} from './submit-demand-batch';
import {
  withdrawDemandBatch,
} from './withdraw-demand-batch';
import type {
  BuyerDemandContext,
  DemandStaffActor,
  SellerDemandActor,
} from './demand-shared';
import { deriveSellerDemandSchedule } from './demand-shared';

let database: SqliteDatabase | null = null;

class CloseCommitBarrierDatabase implements SqlDatabase {
  private batchCount = 0;
  private releaseFirstBatch: () => void = () => undefined;
  private readonly secondBatchArrived: Promise<void>;

  constructor(private readonly delegate: SqliteDatabase) {
    this.secondBatchArrived = new Promise<void>((resolve) => {
      this.releaseFirstBatch = resolve;
    });
  }

  prepare(sql: string): SqlStatement {
    return this.delegate.prepare(sql);
  }

  async batch(statements: readonly SqlStatement[]): Promise<SqlRunResult[]> {
    this.batchCount += 1;
    if (this.batchCount === 1) {
      await this.secondBatchArrived;
    } else if (this.batchCount === 2) {
      this.releaseFirstBatch();
    }
    return this.delegate.batch(statements);
  }
}

afterEach(() => {
  database?.close();
  database = null;
});

describe('demand batch workflow', () => {
  it('derives seller windows from the versioned policy and product cadence', () => {
    const schedule = deriveSellerDemandSchedule({
      now: Date.parse('2026-08-22T04:00:00Z'),
      targetQuantity: 10,
      orderIntervalDays: 2,
      ordersPerRun: 2,
    });
    expect(schedule.policyVersion).toBe(1);
    expect(schedule.openAt).toBe(Date.parse('2026-08-22T04:00:00Z'));
    expect(schedule.openAt).toBeLessThan(schedule.reservationDeadline);
    expect(schedule.reservationDeadline).toBeLessThan(schedule.orderDeadline);
    const endOfBeijingDay = deriveSellerDemandSchedule({
      now: Date.parse('2026-08-22T15:59:59Z'),
      targetQuantity: 1,
      orderIntervalDays: 1,
      ordersPerRun: 1,
    });
    expect(endOfBeijingDay.openAt).toBeLessThan(endOfBeijingDay.reservationDeadline);
  });

  it('runs the staff Demand API and persists a reasoned 10000 BPS override', async () => {
    database = createMigratedTestDatabase();
    seedDemandFixture(database);
    const now = Date.now();
    const submitted = await submitDemandBatch(database, {
      ...demandInput('product-1'),
      openAt: now - 1_000,
      reservationDeadline: now + 60_000,
      orderDeadline: now + 120_000,
    }, {
      actor: ownerActor(),
      idempotencyKey: 'staff-demand-api:submit',
      now: now - 2_000,
    });
    const authorization = await resolveAssignmentStaffAuthorization(
      database,
      'staff-demand-reviewer',
    );
    expect(authorization?.permissions.has('DEMAND_PUBLISH')).toBe(true);
    expect(authorization?.permissions.has('PRODUCT_REVIEW')).toBe(true);

    const app = createApp();
    app.use('/api/staff/*', async (context, next) => {
      (context as any).set('staffAuthorization', authorization);
      await next();
    });
    registerStaffCatalogWorkflowRoutes(app);
    const contextResponse = await app.request(
      `https://api.test/api/staff/demand-batches/${submitted.demand_batch_id}/review-context`,
      { method: 'GET' },
      { DB: database } as any,
    );
    expect(contextResponse.status).toBe(200);
    const reviewContext = await contextResponse.json() as any;
    expect(reviewContext.data.review_context).toMatchObject({
      demand_batch_id: submitted.demand_batch_id,
      demand_version: 1,
      status: 'SUBMITTED',
      product_version_no: 1,
      product_name: '产品一旧版',
      cadence: { order_interval_days: 1, orders_per_run: 100 },
      timezone: 'Asia/Tokyo',
    });
    const response = await app.request(
      `https://api.test/api/staff/demand-batches/${submitted.demand_batch_id}/review`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'staff-demand-api:publish',
        },
        body: JSON.stringify({
          expected_version: 1,
          decision: 'PUBLISH',
          first_order_date: new Date(now + 8 * 60 * 60 * 1000)
            .toISOString().slice(0, 10),
          buyer_self_pay_bps: 10000,
          buyer_self_pay_override_reason: '全额自费专项活动',
        }),
      },
      { DB: database } as any,
    );
    expect(response.status).toBe(200);
    const payload = await response.json() as any;
    expect(payload.data.demand_review).toMatchObject({
      demand_batch_id: submitted.demand_batch_id,
      status: 'PUBLISHED',
      version: 2,
    });
    const frozen = await database.prepare(`
      SELECT buyer_self_pay_bps_snapshot, buyer_self_pay_source,
             buyer_self_pay_override_reason
      FROM demand_batches WHERE id=?
    `).bind(submitted.demand_batch_id).first<{
      buyer_self_pay_bps_snapshot: number;
      buyer_self_pay_source: string;
      buyer_self_pay_override_reason: string;
    }>();
    expect(frozen).toEqual({
      buyer_self_pay_bps_snapshot: 10000,
      buyer_self_pay_source: 'STAFF_OVERRIDE',
      buyer_self_pay_override_reason: '全额自费专项活动',
    });
  });

  it('allows OWNER and scoped OPERATIONS to submit approved-product demand batches', async () => {
    database = createMigratedTestDatabase();
    seedDemandFixture(database);

    const submitted = await submitDemandBatch(
      database,
      demandInput('product-1'),
      {
        actor: operationsActor(['store-1']),
        idempotencyKey: 'demand:submit:0001',
        now: 2000,
      },
    );

    expect(submitted).toMatchObject({
      seller_organization_id: 'seller-org-1',
      store_id: 'store-1',
      product_id: 'product-1',
      product_version_no: 1,
      marketplace_code: 'AMAZON_JP',
      task_type: 'IMAGE',
      target_quantity: 8,
      status: 'SUBMITTED',
      version: 1,
      replayed: false,
    });

    const replay = await submitDemandBatch(
      database,
      demandInput('product-1'),
      {
        actor: operationsActor(['store-1']),
        idempotencyKey: 'demand:submit:0001',
        now: 2100,
      },
    );
    expect(replay).toEqual({
      ...submitted,
      replayed: true,
    });

    const ownerSubmission = await submitDemandBatch(
      database,
      {
        ...demandInput('product-2'),
        taskType: 'TEXT',
      },
      {
        actor: ownerActor(),
        idempotencyKey: 'demand:submit:0002',
        now: 2200,
      },
    );
    expect(ownerSubmission.store_id).toBe('store-2');

    await expect(submitDemandBatch(
      database,
      demandInput('product-1'),
      {
        actor: financeActor(['store-1']),
        idempotencyKey: 'demand:submit:forbidden',
        now: 2300,
      },
    )).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });

    await expect(submitDemandBatch(
      database,
      demandInput('product-2'),
      {
        actor: operationsActor(['store-1']),
        idempotencyKey: 'demand:submit:scope-forbidden',
        now: 2400,
      },
    )).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  it('publishes with permission and exposes only the frozen public product snapshot', async () => {
    database = createMigratedTestDatabase();
    seedDemandFixture(database);

    const submitted = await submitDemandBatch(
      database,
      {
        ...demandInput('product-1'),
        buyerVisibleNotes: '公开说明',
        sellerNotes: '卖家内部说明',
      },
      {
        actor: ownerActor(),
        idempotencyKey: 'demand:publish:submit',
        now: 2000,
      },
    );

    database.exec(`
      UPDATE products
      SET
        current_version_no=2,
        version=2,
        updated_at=2500
      WHERE id='product-1';

      INSERT INTO product_versions (
        id, product_id, version_no, product_name,
        search_keywords_json, product_url,
        buyer_visible_notes, internal_notes,
        created_by_staff_id, created_at
      ,
          ordering_guide_expected_amount_jpy,
          color_spec_mode, order_interval_days, orders_per_run) VALUES (
        'product-version-1-v2', 'product-1', 2,
        '产品一新版', '["新版关键词"]',
        'https://www.amazon.co.jp/product-new',
        '新版公开说明', '新版内部说明',
        'staff-demand-reviewer', 2500
      ,
          1980, 'MAIN_IMAGE_VARIANT', 1, 100);
    `);

    const replayAfterProductChanged = await submitDemandBatch(
      database,
      {
        ...demandInput('product-1'),
        buyerVisibleNotes: '公开说明',
        sellerNotes: '卖家内部说明',
      },
      {
        actor: ownerActor(),
        idempotencyKey: 'demand:publish:submit',
        now: 2600,
      },
    );
    expect(replayAfterProductChanged).toEqual({
      ...submitted,
      replayed: true,
    });

    const published = await reviewDemandBatch(
      database,
      {
        demandBatchId: submitted.demand_batch_id,
        expectedVersion: 1,
        decision: 'PUBLISH',
        firstOrderDate: '1970-01-01',
      },
      {
        actor: reviewerActor(),
        idempotencyKey: 'demand:publish:review',
        now: 3000,
      },
    );

    expect(published).toEqual({
      demand_batch_id: submitted.demand_batch_id,
      status: 'PUBLISHED',
      version: 2,
      review_reason: null,
      schedule: {
        schedule_version_id: expect.any(String),
        version_no: 1,
        demand_version: 2,
        first_order_date: '1970-01-01',
        order_interval_days: 1,
        orders_per_run: 100,
        theoretical_last_order_date: '1970-01-01',
        affected_reservation_count: 0,
        preview_hash: expect.stringMatching(/^[0-9a-f]{64}$/u),
        change_reason: '需求发布',
        changed_by_staff_id: 'staff-demand-reviewer',
        created_at: 3000,
      },
      replayed: false,
    });

    const publicRows = await listBuyerPublicDemandBatches(
      database,
      activeBuyer(),
      {
        now: 5000,
      },
    );
    expect(publicRows).toHaveLength(1);
    expect(publicRows[0]).toEqual({
      demand_batch_id: submitted.demand_batch_id,
      demand_version: 2,
      marketplace_code: 'AMAZON_JP',
      product_name: '产品一旧版',
      reference_order_amount_jpy: '1980',
      buyer_self_pay_bps: 0,
      estimated_buyer_self_pay_jpy: '0',
      estimated_refundable_principal_jpy: '1980',
      buyer_visible_notes: '公开说明',
      store_display_name: '需求店铺一',
      task_type: 'IMAGE',
      target_quantity: 8,
      open_at: 4000,
      reservation_deadline: 10_000,
      order_deadline: 20_000,
    });

    const serialized = JSON.stringify(publicRows);
    expect(serialized).not.toContain('seller-org-1');
    expect(serialized).not.toContain('卖家内部说明');
    expect(serialized).not.toContain('新版内部说明');
    expect(serialized).not.toContain('submitted_by_member_id');
    expect(serialized).not.toContain('review_reason');
    expect(serialized).not.toContain('B0DEMAND01');
    expect(serialized).not.toContain('product-old');
    expect(serialized).not.toContain('旧版关键词');
  });

  it('rejects or withdraws without exposing the batch publicly', async () => {
    database = createMigratedTestDatabase();
    seedDemandFixture(database);

    const rejectedSource = await submitDemandBatch(
      database,
      demandInput('product-1'),
      {
        actor: ownerActor(),
        idempotencyKey: 'demand:reject:submit',
        now: 2000,
      },
    );
    const rejected = await reviewDemandBatch(
      database,
      {
        demandBatchId: rejectedSource.demand_batch_id,
        expectedVersion: 1,
        decision: 'REJECT',
        rejectionReason: ' 数量或时间需要调整 ',
      },
      {
        actor: reviewerActor(),
        idempotencyKey: 'demand:reject:review',
        now: 3000,
      },
    );
    expect(rejected).toEqual({
      demand_batch_id: rejectedSource.demand_batch_id,
      status: 'REJECTED',
      version: 2,
      review_reason: '数量或时间需要调整',
      schedule: null,
      replayed: false,
    });

    const withdrawnSource = await submitDemandBatch(
      database,
      {
        ...demandInput('product-2'),
        taskType: 'VIDEO',
      },
      {
        actor: ownerActor(),
        idempotencyKey: 'demand:withdraw:submit',
        now: 2100,
      },
    );
    const withdrawn = await withdrawDemandBatch(
      database,
      {
        demandBatchId: withdrawnSource.demand_batch_id,
        expectedVersion: 1,
      },
      {
        actor: ownerActor(),
        idempotencyKey: 'demand:withdraw:command',
        now: 3100,
      },
    );
    expect(withdrawn).toEqual({
      demand_batch_id: withdrawnSource.demand_batch_id,
      status: 'WITHDRAWN',
      version: 2,
      replayed: false,
    });

    const withdrawnItem = await database.prepare(`
      SELECT status FROM staff_work_items
      WHERE work_type='DEMAND_REVIEW' AND source_entity_id=?
    `).bind(withdrawnSource.demand_batch_id).first<{ status: string }>();
    expect(withdrawnItem?.status).toBe('CANCELLED');

    await expect(listBuyerPublicDemandBatches(
      database,
      activeBuyer(),
      { now: 5000 },
    )).resolves.toEqual([]);
  });

  it('closes a published batch and removes it from the buyer public view', async () => {
    database = createMigratedTestDatabase();
    seedDemandFixture(database);

    const submitted = await submitDemandBatch(
      database,
      demandInput('product-1'),
      {
        actor: ownerActor(),
        idempotencyKey: 'demand:close:submit',
        now: 2000,
      },
    );
    await reviewDemandBatch(
      database,
      {
        demandBatchId: submitted.demand_batch_id,
        expectedVersion: 1,
        decision: 'PUBLISH',
        firstOrderDate: '1970-01-01',
      },
      {
        actor: reviewerActor(),
        idempotencyKey: 'demand:close:publish',
        now: 3000,
      },
    );

    await expect(listBuyerPublicDemandBatches(
      database,
      activeBuyer(),
      { now: 5000 },
    )).resolves.toHaveLength(1);

    const closed = await closeDemandBatch(
      database,
      {
        demandBatchId: submitted.demand_batch_id,
        expectedVersion: 2,
        closeReason: ' 名额计划提前结束 ',
      },
      {
        actor: reviewerActor(),
        idempotencyKey: 'demand:close:command',
        now: 6000,
      },
    );
    expect(closed).toEqual({
      demand_batch_id: submitted.demand_batch_id,
      status: 'CLOSED',
      version: 3,
      close_reason: '名额计划提前结束',
      replayed: false,
    });

    await expect(listBuyerPublicDemandBatches(
      database,
      activeBuyer(),
      { now: 7000 },
    )).resolves.toEqual([]);
  });

  it('exposes the published demand close operation through the formal Staff HTTP route', async () => {
    database = createMigratedTestDatabase();
    seedDemandFixture(database);
    const now = Date.now();
    const submitted = await submitDemandBatch(database, {
      ...demandInput('product-1'),
      openAt: now - 1_000,
      reservationDeadline: now + 60_000,
      orderDeadline: now + 120_000,
    }, {
      actor: ownerActor(), idempotencyKey: 'demand:close-route:submit', now: now - 2_000,
    });
    await reviewDemandBatch(database, {
      demandBatchId: submitted.demand_batch_id,
      expectedVersion: 1,
      decision: 'PUBLISH',
      firstOrderDate: new Date(now + 8 * 3_600_000).toISOString().slice(0, 10),
    }, {
      actor: reviewerActor(), idempotencyKey: 'demand:close-route:publish', now,
    });
    const authorization = await resolveAssignmentStaffAuthorization(
      database, 'staff-demand-reviewer',
    );
    expect(authorization).not.toBeNull();
    const app = createApp();
    app.use('/api/staff/*', async (context, next) => {
      (context as any).set('staffAuthorization', authorization);
      await next();
    });
    registerStaffCatalogWorkflowRoutes(app);
    const response = await app.request(
      `https://api.test/api/staff/demand-batches/${submitted.demand_batch_id}/close`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'demand:close-route:close',
        },
        body: JSON.stringify({
          expected_version: 2,
          close_reason: '正式路由关闭需求',
        }),
      },
      { DB: database } as any,
    );
    expect(response.status).toBe(200);
    expect((await response.json() as any).data.demand_close).toMatchObject({
      demand_batch_id: submitted.demand_batch_id,
      status: 'CLOSED',
      version: 3,
      close_reason: '正式路由关闭需求',
      replayed: false,
    });
    const unexpectedQuery = await app.request(
      `https://api.test/api/staff/demand-batches/${submitted.demand_batch_id}/close?unexpected=1`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'demand:close-route:unexpected-query',
        },
        body: JSON.stringify({
          expected_version: 3,
          close_reason: '不应执行',
        }),
      },
      { DB: database } as any,
    );
    expect(unexpectedQuery.status).toBe(400);
    expect((await unexpectedQuery.json() as any).error.code).toBe('VALIDATION_ERROR');
  });

  it('keeps close replay stable and rejects mismatch, stale version, invalid state, and empty reason', async () => {
    database = createMigratedTestDatabase();
    seedDemandFixture(database);
    const submitted = await publishDemandForClose(database, 'demand:close-contract');
    const first = await closeDemandBatch(database, {
      demandBatchId: submitted.demand_batch_id,
      expectedVersion: 2,
      closeReason: '关闭已发布需求',
    }, {
      actor: reviewerActor(), idempotencyKey: 'demand:close-contract:close', now: 5000,
    });
    const beforeReplay = await demandReviewBusinessCounts(database, submitted.demand_batch_id);
    const replay = await closeDemandBatch(database, {
      demandBatchId: submitted.demand_batch_id,
      expectedVersion: 2,
      closeReason: '关闭已发布需求',
    }, {
      actor: reviewerActor(), idempotencyKey: 'demand:close-contract:close', now: 6000,
    });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(await demandReviewBusinessCounts(database, submitted.demand_batch_id))
      .toEqual(beforeReplay);

    await expect(closeDemandBatch(database, {
      demandBatchId: submitted.demand_batch_id,
      expectedVersion: 2,
      closeReason: '同键不同原因',
    }, {
      actor: reviewerActor(), idempotencyKey: 'demand:close-contract:close', now: 7000,
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });

    const stale = await publishDemandForClose(database, 'demand:close-contract:stale');
    await expect(closeDemandBatch(database, {
      demandBatchId: stale.demand_batch_id,
      expectedVersion: 1,
      closeReason: '过期版本关闭',
    }, {
      actor: reviewerActor(), idempotencyKey: 'demand:close-contract:stale-close', now: 8000,
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });

    const submittedOnly = await submitDemandBatch(
      database,
      demandInput('product-2'),
      { actor: ownerActor(), idempotencyKey: 'demand:close-contract:submitted', now: 9000 },
    );
    await expect(closeDemandBatch(database, {
      demandBatchId: submittedOnly.demand_batch_id,
      expectedVersion: 1,
      closeReason: '未发布关闭',
    }, {
      actor: reviewerActor(), idempotencyKey: 'demand:close-contract:state', now: 10_000,
    })).rejects.toMatchObject({ code: 'DEMAND_BATCH_NOT_PUBLISHED', status: 409 });

    await expect(closeDemandBatch(database, {
      demandBatchId: stale.demand_batch_id,
      expectedVersion: 2,
      closeReason: '   ',
    }, {
      actor: reviewerActor(), idempotencyKey: 'demand:close-contract:empty', now: 11_000,
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('allows only one concurrent close to commit its event and audit', async () => {
    database = createMigratedTestDatabase();
    seedDemandFixture(database);
    const submitted = await publishDemandForClose(database, 'demand:close-concurrent');
    const results = await Promise.allSettled([
      closeDemandBatch(database, {
        demandBatchId: submitted.demand_batch_id,
        expectedVersion: 2,
        closeReason: '并发关闭一',
      }, {
        actor: reviewerActor(), idempotencyKey: 'demand:close-concurrent:a', now: 12_000,
      }),
      closeDemandBatch(database, {
        demandBatchId: submitted.demand_batch_id,
        expectedVersion: 2,
        closeReason: '并发关闭二',
      }, {
        actor: reviewerActor(), idempotencyKey: 'demand:close-concurrent:b', now: 12_001,
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'VERSION_CONFLICT', status: 409 }),
    });
    const counts = await demandReviewBusinessCounts(database, submitted.demand_batch_id);
    expect(counts).toMatchObject({ demand_status: 'CLOSED', events: 3, audits: 3 });
  });

  it('serializes same-reason different-key close races at the guarded update', async () => {
    database = createMigratedTestDatabase();
    seedDemandFixture(database);
    const submitted = await publishDemandForClose(database, 'demand:close-same-reason-race');
    const raceDatabase = new CloseCommitBarrierDatabase(database);
    const results = await Promise.allSettled([
      closeDemandBatch(raceDatabase, {
        demandBatchId: submitted.demand_batch_id,
        expectedVersion: 2,
        closeReason: '同一原因并发关闭',
      }, {
        actor: reviewerActor(),
        idempotencyKey: 'demand:close-same-reason-race:a',
        now: 12_000,
      }),
      closeDemandBatch(raceDatabase, {
        demandBatchId: submitted.demand_batch_id,
        expectedVersion: 2,
        closeReason: '同一原因并发关闭',
      }, {
        actor: reviewerActor(),
        idempotencyKey: 'demand:close-same-reason-race:b',
        now: 12_001,
      }),
    ]);
    const facts = await database.prepare(`
      SELECT
        (SELECT status FROM demand_batches WHERE id=?) AS demand_status,
        (SELECT version FROM demand_batches WHERE id=?) AS demand_version,
        (SELECT COUNT(*) FROM demand_batch_events WHERE demand_batch_id=?) AS events,
        (SELECT COUNT(*) FROM audit_events
          WHERE aggregate_type='DEMAND_BATCH' AND aggregate_id=?) AS audits,
        (SELECT COUNT(*) FROM command_idempotency_records
          WHERE action='CLOSE_DEMAND_BATCH' AND target_id=? AND status='COMMITTED')
          AS committed_idempotencies,
        (SELECT COUNT(*) FROM command_idempotency_records
          WHERE action='CLOSE_DEMAND_BATCH' AND target_id=? AND status='FAILED')
          AS failed_idempotencies,
        (SELECT status FROM staff_work_items
          WHERE source_entity_type='DEMAND_BATCH' AND source_entity_id=?) AS work_status,
        (SELECT COUNT(*) FROM staff_assignment_events
          WHERE subject_type='WORK_ITEM' AND subject_id=(
            SELECT id FROM staff_work_items
            WHERE source_entity_type='DEMAND_BATCH' AND source_entity_id=?
          ) AND event_type='WORK_ITEM_COMPLETED') AS work_item_events
    `).bind(
      submitted.demand_batch_id,
      submitted.demand_batch_id,
      submitted.demand_batch_id,
      submitted.demand_batch_id,
      submitted.demand_batch_id,
      submitted.demand_batch_id,
      submitted.demand_batch_id,
      submitted.demand_batch_id,
    ).first();
    expect({
      fulfilled: results.filter((result) => result.status === 'fulfilled').length,
      rejectedCodes: results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => (result.reason as { code?: string }).code),
      facts,
    }).toEqual({
      fulfilled: 1,
      rejectedCodes: ['VERSION_CONFLICT'],
      facts: {
        demand_status: 'CLOSED',
        demand_version: 3,
        events: 3,
        audits: 3,
        committed_idempotencies: 1,
        failed_idempotencies: 1,
        work_status: 'COMPLETED',
        work_item_events: 1,
      },
    });

    const failedKey = results[0]?.status === 'rejected'
      ? 'demand:close-same-reason-race:a'
      : 'demand:close-same-reason-race:b';
    await expect(closeDemandBatch(database, {
      demandBatchId: submitted.demand_batch_id,
      expectedVersion: 2,
      closeReason: '同一原因并发关闭',
    }, {
      actor: reviewerActor(),
      idempotencyKey: failedKey,
      now: 12_002,
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    expect(await database.prepare(`
      SELECT status, error_code, attempt_count
      FROM command_idempotency_records
      WHERE action='CLOSE_DEMAND_BATCH' AND target_id=? AND idempotency_key=?
    `).bind(submitted.demand_batch_id, failedKey).first()).toEqual({
      status: 'FAILED',
      error_code: 'VERSION_CONFLICT',
      attempt_count: 2,
    });
    expect(await database.prepare(`
      SELECT COUNT(*) AS events FROM demand_batch_events WHERE demand_batch_id=?
    `).bind(submitted.demand_batch_id).first()).toEqual({ events: 3 });
  });

  it('re-resolves close permission and hard role gates instead of trusting the caller actor', async () => {
    database = createMigratedTestDatabase();
    seedDemandFixture(database);
    const submitted = await publishDemandForClose(database, 'demand:close-auth');
    database.exec(`INSERT INTO staff_permission_overrides (
      staff_id, permission_code, effect, status, reason,
      assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
    ) VALUES ('staff-demand-reviewer','DEMAND_PUBLISH','DENY','ACTIVE','close deny',
      'zz-phase3h-test-owner',4000,NULL,4000,4000)`);

    await expect(closeDemandBatch(database, {
      demandBatchId: submitted.demand_batch_id, expectedVersion: 2,
      closeReason: '数据库拒绝关闭',
    }, {
      // Deliberately stale: the D1 Personal DENY must win.
      actor: reviewerActor(), idempotencyKey: 'demand:close-auth:deny', now: 13_000,
    })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    await expect(closeDemandBatch(database, {
      demandBatchId: submitted.demand_batch_id, expectedVersion: 2,
      closeReason: '伪造角色关闭',
    }, {
      actor: {
        staffId: 'staff-demand-reviewer', displayName: '伪造角色',
        roles: ['pre_sales'], permissions: new Set(['DEMAND_PUBLISH']),
      },
      idempotencyKey: 'demand:close-auth:role', now: 13_001,
    })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(await database.prepare(`SELECT status, version FROM demand_batches WHERE id=?`)
      .bind(submitted.demand_batch_id).first()).toEqual({ status: 'PUBLISHED', version: 2 });
  });

  it('requires active and identity-clear buyers and hides future or expired batches', async () => {
    database = createMigratedTestDatabase();
    seedDemandFixture(database);

    const future = await submitDemandBatch(
      database,
      {
        ...demandInput('product-1'),
        openAt: 8000,
        reservationDeadline: 10_000,
        orderDeadline: 20_000,
      },
      {
        actor: ownerActor(),
        idempotencyKey: 'demand:public:future-submit',
        now: 2000,
      },
    );
    await reviewDemandBatch(
      database,
      {
        demandBatchId: future.demand_batch_id,
        expectedVersion: 1,
        decision: 'PUBLISH',
        firstOrderDate: '1970-01-01',
      },
      {
        actor: reviewerActor(),
        idempotencyKey: 'demand:public:future-review',
        now: 3000,
      },
    );

    await expect(listBuyerPublicDemandBatches(
      database,
      activeBuyer(),
      { now: 7000 },
    )).resolves.toEqual([]);

    await expect(listBuyerPublicDemandBatches(
      database,
      activeBuyer(),
      { now: 8000 },
    )).resolves.toHaveLength(1);

    await expect(listBuyerPublicDemandBatches(
      database,
      activeBuyer(),
      { now: 10_000 },
    )).resolves.toEqual([]);

    await expect(listBuyerPublicDemandBatches(
      database,
      {
        ...activeBuyer(),
        accessStatus: 'DISABLED',
      },
      { now: 8000 },
    )).rejects.toMatchObject({
      code: 'CUSTOMER_NOT_ACTIVE',
      status: 409,
    });

    await expect(listBuyerPublicDemandBatches(
      database,
      {
        ...activeBuyer(),
        identityReviewStatus: 'REVIEW_REQUIRED',
      },
      { now: 8000 },
    )).rejects.toMatchObject({
      code: 'IDENTITY_REVIEW_REQUIRED',
      status: 409,
    });
  });

  it('enforces review role, base demand permission, assignment, expected version, expiry, and immutable events', async () => {
    database = createMigratedTestDatabase();
    seedDemandFixture(database);

    const submitted = await submitDemandBatch(
      database,
      {
        ...demandInput('product-1'),
        reservationDeadline: 5000,
        orderDeadline: 6000,
      },
      {
        actor: ownerActor(),
        idempotencyKey: 'demand:guard:submit',
        now: 2000,
      },
    );

    const forbiddenActors: DemandStaffActor[] = [
      { ...reviewerActor(), roles: ['buyer_refund'],
        permissions: new Set<StaffPermissionCode>(['PRODUCT_REVIEW', 'DEMAND_PUBLISH']) },
      { ...reviewerActor(), roles: ['pre_sales'],
        permissions: new Set<StaffPermissionCode>(['PRODUCT_REVIEW', 'DEMAND_PUBLISH']) },
      { ...reviewerActor(), permissions: new Set<StaffPermissionCode>(['PRODUCT_REVIEW']) },
    ];
    for (const [index, deniedActor] of forbiddenActors.entries()) {
      await expect(readDemandReviewContext(
        database, submitted.demand_batch_id, deniedActor,
      )).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      await expect(reviewDemandBatch(
        database,
        {
          demandBatchId: submitted.demand_batch_id,
          expectedVersion: 1,
          decision: 'PUBLISH',
          firstOrderDate: '1970-01-01',
        },
        {
          actor: deniedActor,
          idempotencyKey: `demand:guard:forbidden:${index}`,
          now: 3000,
        },
      )).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    }
    await expect(reviewDemandBatch(database, {
      demandBatchId: submitted.demand_batch_id, expectedVersion: 1,
      decision: 'REJECT', rejectionReason: '缺少需求发布权限',
    }, { actor: { ...reviewerActor(),
      permissions: new Set<StaffPermissionCode>(['PRODUCT_REVIEW']) },
      idempotencyKey: 'demand:guard:reject-without-demand', now: 3000,
    })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    database.exec(`
      INSERT INTO staff_users (
        id, display_name, status, authorization_version,
        version, created_at, updated_at, disabled_at
      ) VALUES ('staff-demand-unassigned', '未指派卖家对接', 'ACTIVE', 1,
        1, 1000, 1000, NULL);
      INSERT INTO staff_role_assignments (
        staff_id, role_code, status, assigned_by_staff_id,
        assigned_at, revoked_at, created_at, updated_at
      ) VALUES ('staff-demand-unassigned', 'seller_ops', 'ACTIVE', NULL,
        1000, NULL, 1000, 1000);
    `);
    await expect(readDemandReviewContext(database, submitted.demand_batch_id, {
      ...reviewerActor(), staffId: 'staff-demand-unassigned',
    })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    await expect(reviewDemandBatch(
      database,
      {
        demandBatchId: submitted.demand_batch_id,
        expectedVersion: 99,
        decision: 'REJECT',
        rejectionReason: '版本测试',
      },
      {
        actor: reviewerActor(),
        idempotencyKey: 'demand:guard:version',
        now: 3000,
      },
    )).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      status: 409,
    });

    await expect(reviewDemandBatch(
      database,
      {
        demandBatchId: submitted.demand_batch_id,
        expectedVersion: 1,
        decision: 'PUBLISH',
        firstOrderDate: '1970-01-01',
      },
      {
        actor: reviewerActor(),
        idempotencyKey: 'demand:guard:expired',
        now: 5000,
      },
    )).rejects.toMatchObject({
      code: 'DEMAND_BATCH_EXPIRED',
      status: 409,
    });

    await expect(database.prepare(`
      UPDATE demand_batch_events
      SET next_status='PUBLISHED'
      WHERE demand_batch_id=?
    `).bind(
      submitted.demand_batch_id,
    ).run()).rejects.toThrow(
      'demand_batch_events_are_immutable',
    );

    await expect(database.prepare(`
      DELETE FROM demand_batch_events
      WHERE demand_batch_id=?
    `).bind(
      submitted.demand_batch_id,
    ).run()).rejects.toThrow(
      'demand_batch_events_are_immutable',
    );
  });

  it('lets effective DEMAND_PUBLISH-only seller_ops inspect, reject, and close but not publish', async () => {
    database = createMigratedTestDatabase();
    seedDemandFixture(database);
    const rejectSource = await submitDemandBatch(database, demandInput('product-1'), {
      actor: ownerActor(), idempotencyKey: 'demand-action:reject-submit', now: 2000,
    });
    const closeSource = await submitDemandBatch(database, demandInput('product-2'), {
      actor: ownerActor(), idempotencyKey: 'demand-action:close-submit', now: 2100,
    });
    database.exec(`INSERT INTO staff_permission_overrides (
      staff_id, permission_code, effect, status, reason,
      assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
    ) VALUES ('staff-demand-reviewer','PRODUCT_REVIEW','DENY','ACTIVE','action gate',
      'zz-phase3h-test-owner',1500,NULL,1500,1500)`);
    const actor = await persistedDemandReviewerActor(database);
    expect(actor.permissions.has('DEMAND_PUBLISH')).toBe(true);
    expect(actor.permissions.has('PRODUCT_REVIEW')).toBe(false);

    await expect(readDemandReviewContext(database, rejectSource.demand_batch_id, actor))
      .resolves.toMatchObject({ can_publish: false, demand_version: 1 });
    await expect(reviewDemandBatch(database, {
      demandBatchId: rejectSource.demand_batch_id, expectedVersion: 1,
      decision: 'PUBLISH', firstOrderDate: '1970-01-01',
    }, { actor, idempotencyKey: 'demand-action:publish-denied', now: 3000 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(reviewDemandBatch(database, {
      demandBatchId: rejectSource.demand_batch_id, expectedVersion: 1,
      decision: 'REJECT', rejectionReason: '基础需求权限允许拒绝',
    }, { actor, idempotencyKey: 'demand-action:reject', now: 3100 }))
      .resolves.toMatchObject({ status: 'REJECTED', schedule: null });

    await reviewDemandBatch(database, {
      demandBatchId: closeSource.demand_batch_id, expectedVersion: 1,
      decision: 'PUBLISH', firstOrderDate: '1970-01-01',
    }, { actor: ownerDemandReviewerActor(), idempotencyKey: 'demand-action:owner-publish', now: 3200 });
    await expect(closeDemandBatch(database, {
      demandBatchId: closeSource.demand_batch_id, expectedVersion: 2,
      closeReason: '关闭不写排期',
    }, { actor, idempotencyKey: 'demand-action:close', now: 3300 }))
      .resolves.toMatchObject({ status: 'CLOSED' });
  });

  it('rejects stale demand work-item organization scope without writes while owner GLOBAL proceeds', async () => {
    database = createMigratedTestDatabase();
    seedDemandFixture(database);
    insertDemandScopeMismatchOrganization(database);
    const submitted = await submitDemandBatch(database, demandInput('product-1'), {
      actor: ownerActor(), idempotencyKey: 'demand-scope:submit', now: 2000,
    });
    // Simulate stale metadata that normal database write guards prevent.
    database.exec(`DROP TRIGGER trg_staff_work_items_update_guard`);
    await database.prepare(`UPDATE staff_work_items SET seller_organization_id='seller-org-2'
      WHERE source_entity_type='DEMAND_BATCH' AND source_entity_id=?`)
      .bind(submitted.demand_batch_id).run();
    const before = await demandReviewBusinessCounts(database, submitted.demand_batch_id);
    await expect(readDemandReviewContext(database, submitted.demand_batch_id, reviewerActor()))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(reviewDemandBatch(database, {
      demandBatchId: submitted.demand_batch_id, expectedVersion: 1,
      decision: 'REJECT', rejectionReason: '恶意工作项组织',
    }, { actor: reviewerActor(), idempotencyKey: 'demand-scope:denied', now: 3000 }))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(closeDemandBatch(database, {
      demandBatchId: submitted.demand_batch_id, expectedVersion: 1,
      closeReason: '恶意工作项组织关闭',
    }, { actor: reviewerActor(), idempotencyKey: 'demand-scope:close-denied', now: 3001 }))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(await demandReviewBusinessCounts(database, submitted.demand_batch_id)).toEqual(before);
    await expect(readDemandReviewContext(
      database, submitted.demand_batch_id, ownerDemandReviewerActor(),
    )).resolves.toMatchObject({ demand_version: 1 });
    await expect(reviewDemandBatch(database, {
      demandBatchId: submitted.demand_batch_id, expectedVersion: 1,
      decision: 'REJECT', rejectionReason: 'Owner 全局处理',
    }, { actor: ownerDemandReviewerActor(), idempotencyKey: 'demand-scope:owner', now: 3100 }))
      .resolves.toMatchObject({ status: 'REJECTED' });
    expect((await database.prepare(`SELECT status FROM staff_work_items
      WHERE source_entity_type='DEMAND_BATCH' AND source_entity_id=?`)
      .bind(submitted.demand_batch_id).first<{status:string}>())?.status).toBe('COMPLETED');
  });

  it('replays an identical publish and rejects idempotency key reuse with a different body', async () => {
    database = createMigratedTestDatabase();
    seedDemandFixture(database);
    const submitted = await submitDemandBatch(database, demandInput('product-1'), {
      actor: ownerActor(), idempotencyKey: 'demand:replay:submit', now: 2000,
    });

    const first = await reviewDemandBatch(database, {
      demandBatchId: submitted.demand_batch_id,
      expectedVersion: 1,
      decision: 'PUBLISH',
      firstOrderDate: '1970-01-01',
    }, {
      actor: reviewerActor(),
      idempotencyKey: 'demand:replay:publish',
      now: 3000,
    });
    expect(first.replayed).toBe(false);
    const afterFirst = await demandReviewBusinessCounts(
      database, submitted.demand_batch_id,
    );

    const replayed = await reviewDemandBatch(database, {
      demandBatchId: submitted.demand_batch_id,
      expectedVersion: 1,
      decision: 'PUBLISH',
      firstOrderDate: '1970-01-01',
    }, {
      actor: reviewerActor(),
      idempotencyKey: 'demand:replay:publish',
      now: 3400,
    });
    expect(replayed).toEqual({ ...first, replayed: true });
    expect(await demandReviewBusinessCounts(
      database, submitted.demand_batch_id,
    )).toEqual(afterFirst);

    await expect(reviewDemandBatch(database, {
      demandBatchId: submitted.demand_batch_id,
      expectedVersion: 1,
      decision: 'PUBLISH',
      firstOrderDate: '1970-01-02',
    }, {
      actor: reviewerActor(),
      idempotencyKey: 'demand:replay:publish',
      now: 3500,
    })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      status: 409,
    });
    expect(await demandReviewBusinessCounts(
      database, submitted.demand_batch_id,
    )).toEqual(afterFirst);
  });

  it('rejects invalid first order dates and schedule window conflicts without changing facts', async () => {
    database = createMigratedTestDatabase();
    seedDemandFixture(database);
    const submitted = await submitDemandBatch(database, demandInput('product-1'), {
      actor: ownerActor(), idempotencyKey: 'demand:dates:submit', now: 2000,
    });

    for (const firstOrderDate of ['2026-02-30', '1970-1-1', 'not-a-date']) {
      await expect(reviewDemandBatch(database, {
        demandBatchId: submitted.demand_batch_id,
        expectedVersion: 1,
        decision: 'PUBLISH',
        firstOrderDate,
      }, {
        actor: reviewerActor(),
        idempotencyKey: `demand:dates:invalid:${firstOrderDate}`,
        now: 3000,
      })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    }

    await expect(reviewDemandBatch(database, {
      demandBatchId: submitted.demand_batch_id,
      expectedVersion: 1,
      decision: 'PUBLISH',
      firstOrderDate: '2999-01-01',
    }, {
      actor: reviewerActor(),
      idempotencyKey: 'demand:dates:window',
      now: 3000,
    })).rejects.toMatchObject({
      code: 'SCHEDULE_WINDOW_CONFLICT',
      status: 409,
    });

    expect((await database.prepare(`SELECT status, version FROM demand_batches
      WHERE id=?`).bind(submitted.demand_batch_id)
      .first<{ status: string; version: number }>()))
      .toEqual({ status: 'SUBMITTED', version: 1 });
    expect((await database.prepare(`SELECT status FROM staff_work_items
      WHERE source_entity_type='DEMAND_BATCH' AND source_entity_id=?`)
      .bind(submitted.demand_batch_id).first<{ status: string }>())?.status)
      .toBe('OPEN');
    expect((await database.prepare(`SELECT COUNT(*) AS total
      FROM demand_order_schedule_versions WHERE demand_batch_id=?`)
      .bind(submitted.demand_batch_id)
      .first<{ total: number }>())?.total).toBe(0);
  });

  it('completes the review work item, projects the published batch to buyers, and conceals completed context', async () => {
    database = createMigratedTestDatabase();
    seedDemandFixture(database);
    const submitted = await submitDemandBatch(database, demandInput('product-1'), {
      actor: ownerActor(), idempotencyKey: 'demand:closure:submit', now: 2000,
    });

    await expect(reviewDemandBatch(database, {
      demandBatchId: submitted.demand_batch_id,
      expectedVersion: 1,
      decision: 'PUBLISH',
      firstOrderDate: '1970-01-01',
    }, {
      actor: reviewerActor(),
      idempotencyKey: 'demand:closure:publish',
      now: 3000,
    })).resolves.toMatchObject({ status: 'PUBLISHED' });

    expect(await demandReviewBusinessCounts(
      database, submitted.demand_batch_id,
    )).toMatchObject({
      demand_status: 'PUBLISHED',
      work_status: 'COMPLETED',
      schedules: 1,
    });
    const projected = await listBuyerPublicDemandBatches(database, activeBuyer(), {
      now: 5000,
    });
    expect(projected.map((row) => row.demand_batch_id))
      .toEqual([submitted.demand_batch_id]);

    // 已完成的审核事实不得再读：工作项关闭后 review-context 一律 404，
    // 前端必须依赖命令响应，而不是重读上下文。
    await expect(readDemandReviewContext(
      database, submitted.demand_batch_id, reviewerActor(),
    )).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('names the missing publish readiness field through safe error details', async () => {
    database = createMigratedTestDatabase();
    seedDemandFixture(database);
    // 产品三：满足金额 / 颜色规格 / 排期 / 关键词，但故意不绑定主图。
    database.exec(`
      INSERT INTO products (
        id, organization_id, store_id, marketplace_code,
        asin_display, asin_normalized, status,
        current_version_no, version,
        created_at, updated_at, disabled_at
      ) VALUES (
        'product-3', 'seller-org-1', 'store-1', 'AMAZON_JP',
        'B0DEMAND03', 'B0DEMAND03', 'ACTIVE',
        1, 1, 1000, 1000, NULL
      );
      INSERT INTO product_versions (
        id, product_id, version_no, product_name,
        search_keywords_json, product_url,
        buyer_visible_notes, internal_notes,
        created_by_staff_id, created_at
      ,
          ordering_guide_expected_amount_jpy,
          color_spec_mode, order_interval_days, orders_per_run) VALUES (
        'product-version-3-v1', 'product-3', 1,
        '产品三无主图', '["产品三关键词"]',
        'https://www.amazon.co.jp/product-three',
        '产品三公开说明', '产品三内部说明',
        'staff-demand-reviewer', 1000
      ,
          1980, 'MAIN_IMAGE_VARIANT', 1, 100);
    `);
    const now = Date.now();
    const submitted = await submitDemandBatch(database, {
      ...demandInput('product-3'),
      openAt: now - 1_000,
      reservationDeadline: now + 60_000,
      orderDeadline: now + 120_000,
    }, {
      actor: ownerActor(), idempotencyKey: 'demand:readiness:submit', now: 2000,
    });

    await expect(reviewDemandBatch(database, {
      demandBatchId: submitted.demand_batch_id,
      expectedVersion: 1,
      decision: 'PUBLISH',
      firstOrderDate: '1970-01-01',
    }, {
      actor: reviewerActor(),
      idempotencyKey: 'demand:readiness:publish',
      now: 3000,
    })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 409,
      details: { field: 'main_image' },
    });

    const authorization = await resolveAssignmentStaffAuthorization(
      database, 'staff-demand-reviewer',
    );
    expect(authorization).not.toBeNull();
    const app = createApp();
    app.use('/api/staff/*', async (context, next) => {
      (context as any).set('staffAuthorization', authorization);
      await next();
    });
    registerStaffCatalogWorkflowRoutes(app);
    const response = await app.request(
      `https://api.test/api/staff/demand-batches/${submitted.demand_batch_id}/review`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'demand:readiness:route',
        },
        body: JSON.stringify({
          expected_version: 1,
          decision: 'PUBLISH',
          first_order_date: '1970-01-01',
        }),
      },
      { DB: database } as any,
    );
    expect(response.status).toBe(409);
    const payload = await response.json() as any;
    expect(payload.error.code).toBe('VALIDATION_ERROR');
    expect(payload.error.details).toEqual({
      field: 'main_image',
      reason: expect.stringContaining('主图'),
    });
    expect(JSON.stringify(payload)).not.toContain('sellerNotes');
    expect(JSON.stringify(payload)).not.toContain('internal_notes');

    // 未绑定主图的版本在产品详情读模型中返回 main_image: null。
    const productDetail = await app.request(
      `https://api.test/api/staff/catalog/products/product-3`,
      { method: 'GET' },
      { DB: database } as any,
    );
    expect(productDetail.status).toBe(200);
    const detailPayload = await productDetail.json() as any;
    expect(detailPayload.data.product.versions[0].main_image).toBeNull();
  });

  it('wires the review route contract: publish, replay, conflicts, invalid date, permission, and concealment', async () => {
    database = createMigratedTestDatabase();
    seedDemandFixture(database);
    const now = Date.now();
    const conflictSource = await submitDemandBatch(database, demandInput('product-1'), {
      actor: ownerActor(), idempotencyKey: 'demand:route:submit-a', now: now - 2000,
    });
    const publishSource = await submitDemandBatch(database, {
      ...demandInput('product-2'),
      openAt: now - 1_000,
      reservationDeadline: now + 60_000,
      orderDeadline: now + 120_000,
    }, {
      actor: ownerActor(), idempotencyKey: 'demand:route:submit-b', now: now - 2000,
    });

    const authorization = await resolveAssignmentStaffAuthorization(
      database, 'staff-demand-reviewer',
    );
    expect(authorization).not.toBeNull();
    const app = createApp();
    app.use('/api/staff/*', async (context, next) => {
      (context as any).set('staffAuthorization', authorization);
      await next();
    });
    registerStaffCatalogWorkflowRoutes(app);
    const base = 'https://api.test';
    const jsonHeaders = (key: string) => ({
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    });
    const env = { DB: database } as any;

    const versionConflict = await app.request(
      `${base}/api/staff/demand-batches/${conflictSource.demand_batch_id}/review`,
      {
        method: 'POST',
        headers: jsonHeaders('demand:route:version-conflict'),
        body: JSON.stringify({
          expected_version: 99,
          decision: 'PUBLISH',
          first_order_date: '2026-08-11',
        }),
      },
      env,
    );
    expect(versionConflict.status).toBe(409);
    const conflictPayload = await versionConflict.json() as any;
    expect(conflictPayload.error.code).toBe('VERSION_CONFLICT');
    expect(conflictPayload.error.message).toBe('数据已发生变化，请刷新后重试');
    expect(conflictPayload.meta.request_id).toEqual(expect.any(String));

    const invalidDate = await app.request(
      `${base}/api/staff/demand-batches/${conflictSource.demand_batch_id}/review`,
      {
        method: 'POST',
        headers: jsonHeaders('demand:route:invalid-date'),
        body: JSON.stringify({
          expected_version: 1,
          decision: 'PUBLISH',
          first_order_date: '2026-02-30',
        }),
      },
      env,
    );
    expect(invalidDate.status).toBe(400);
    expect((await invalidDate.json() as any).error.code).toBe('VALIDATION_ERROR');

    const publishBody = JSON.stringify({
      expected_version: 1,
      decision: 'PUBLISH',
      first_order_date: new Date(now + 8 * 3_600_000).toISOString().slice(0, 10),
    });
    const published = await app.request(
      `${base}/api/staff/demand-batches/${publishSource.demand_batch_id}/review`,
      {
        method: 'POST',
        headers: jsonHeaders('demand:route:publish'),
        body: publishBody,
      },
      env,
    );
    expect(published.status).toBe(200);
    const publishedPayload = await published.json() as any;
    expect(publishedPayload.data.demand_review).toMatchObject({
      demand_batch_id: publishSource.demand_batch_id,
      status: 'PUBLISHED',
      version: 2,
      replayed: false,
    });
    expect(publishedPayload.data.demand_review.schedule).toMatchObject({
      version_no: 1,
      demand_version: 2,
    });

    const scheduleBeforeClose = await app.request(
      `${base}/api/staff/demand-batches/${publishSource.demand_batch_id}/reservation-schedule?limit=50`,
      { method: 'GET' },
      env,
    );
    expect(scheduleBeforeClose.status).toBe(200);
    expect((await scheduleBeforeClose.json() as any).data.page.demand).toMatchObject({
      status: 'PUBLISHED', can_close: true,
    });

    const closeBody = JSON.stringify({
      expected_version: 2,
      close_reason: '正式关闭公开需求',
    });
    const closed = await app.request(
      `${base}/api/staff/demand-batches/${publishSource.demand_batch_id}/close`,
      { method: 'POST', headers: jsonHeaders('demand:route:close'), body: closeBody },
      env,
    );
    expect(closed.status).toBe(200);
    const closedPayload = await closed.json() as any;
    expect(closedPayload.data.demand_close).toEqual({
      demand_batch_id: publishSource.demand_batch_id,
      status: 'CLOSED', version: 3, close_reason: '正式关闭公开需求', replayed: false,
    });
    expect(JSON.stringify(closedPayload)).not.toContain('staff-demand-reviewer');
    expect(JSON.stringify(closedPayload)).not.toContain('sellerNotes');

    const closeReplay = await app.request(
      `${base}/api/staff/demand-batches/${publishSource.demand_batch_id}/close`,
      { method: 'POST', headers: jsonHeaders('demand:route:close'), body: closeBody },
      env,
    );
    expect(closeReplay.status).toBe(200);
    expect((await closeReplay.json() as any).data.demand_close).toMatchObject({
      status: 'CLOSED', version: 3, replayed: true,
    });

    const closeMismatch = await app.request(
      `${base}/api/staff/demand-batches/${publishSource.demand_batch_id}/close`,
      {
        method: 'POST', headers: jsonHeaders('demand:route:close'),
        body: JSON.stringify({ expected_version: 2, close_reason: '同键不同请求' }),
      },
      env,
    );
    expect(closeMismatch.status).toBe(409);
    expect((await closeMismatch.json() as any).error.code).toBe('IDEMPOTENCY_CONFLICT');

    const nonPublishedClose = await app.request(
      `${base}/api/staff/demand-batches/${conflictSource.demand_batch_id}/close`,
      {
        method: 'POST', headers: jsonHeaders('demand:route:not-published'),
        body: JSON.stringify({ expected_version: 1, close_reason: '未发布需求' }),
      },
      env,
    );
    expect(nonPublishedClose.status).toBe(409);
    expect((await nonPublishedClose.json() as any).error.code)
      .toBe('DEMAND_BATCH_NOT_PUBLISHED');

    const invalidClose = await app.request(
      `${base}/api/staff/demand-batches/${publishSource.demand_batch_id}/close`,
      {
        method: 'POST', headers: jsonHeaders('demand:route:invalid-close'),
        body: JSON.stringify({ expected_version: 3, close_reason: ' ' }),
      },
      env,
    );
    expect(invalidClose.status).toBe(400);
    expect((await invalidClose.json() as any).error.code).toBe('VALIDATION_ERROR');

    const replay = await app.request(
      `${base}/api/staff/demand-batches/${publishSource.demand_batch_id}/review`,
      {
        method: 'POST',
        headers: jsonHeaders('demand:route:publish'),
        body: publishBody,
      },
      env,
    );
    expect(replay.status).toBe(200);
    expect((await replay.json() as any).data.demand_review.replayed).toBe(true);

    const duplicateKey = await app.request(
      `${base}/api/staff/demand-batches/${publishSource.demand_batch_id}/review`,
      {
        method: 'POST',
        headers: jsonHeaders('demand:route:duplicate-submit'),
        body: JSON.stringify({
          expected_version: 3,
          decision: 'PUBLISH',
          first_order_date: '2999-01-01',
        }),
      },
      env,
    );
    expect(duplicateKey.status).toBe(409);
    expect((await duplicateKey.json() as any).error.code)
      .toBe('DEMAND_BATCH_ALREADY_REVIEWED');

    const concealedContext = await app.request(
      `${base}/api/staff/demand-batches/${publishSource.demand_batch_id}/review-context`,
      { method: 'GET' },
      env,
    );
    expect(concealedContext.status).toBe(404);
    expect((await concealedContext.json() as any).error.code).toBe('NOT_FOUND');

    // 鉴权通过但角色没有 DEMAND_PUBLISH：403，而非 401 或 5xx。
    database.exec(`
      INSERT INTO staff_users (
        id, display_name, status, authorization_version,
        version, created_at, updated_at, disabled_at
      ) VALUES ('staff-route-pre-sales', '售前路由', 'ACTIVE', 1,
        1, 1000, 1000, NULL);
      INSERT INTO staff_role_assignments (
        staff_id, role_code, status, assigned_by_staff_id,
        assigned_at, revoked_at, created_at, updated_at
      ) VALUES ('staff-route-pre-sales', 'pre_sales', 'ACTIVE', NULL,
        1000, NULL, 1000, 1000);
    `);
    const preSalesAuthorization = await resolveAssignmentStaffAuthorization(
      database, 'staff-route-pre-sales',
    );
    expect(preSalesAuthorization).not.toBeNull();
    const preSalesApp = createApp();
    preSalesApp.use('/api/staff/*', async (context, next) => {
      (context as any).set('staffAuthorization', preSalesAuthorization);
      await next();
    });
    registerStaffCatalogWorkflowRoutes(preSalesApp);
    const forbidden = await preSalesApp.request(
      `${base}/api/staff/demand-batches/${conflictSource.demand_batch_id}/review`,
      {
        method: 'POST',
        headers: jsonHeaders('demand:route:forbidden'),
        body: JSON.stringify({
          expected_version: 1,
          decision: 'REJECT',
          rejection_reason: '无发布权限角色',
        }),
      },
      env,
    );
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json() as any).error.code).toBe('FORBIDDEN');

    const forbiddenClose = await preSalesApp.request(
      `${base}/api/staff/demand-batches/${conflictSource.demand_batch_id}/close`,
      {
        method: 'POST', headers: jsonHeaders('demand:route:pre-sales-close'),
        body: JSON.stringify({ expected_version: 1, close_reason: '售前越权关闭' }),
      },
      env,
    );
    expect(forbiddenClose.status).toBe(403);
    expect((await forbiddenClose.json() as any).error.code).toBe('FORBIDDEN');

    const unauthenticatedApp = createApp();
    registerStaffCatalogWorkflowRoutes(unauthenticatedApp);
    const unauthenticatedClose = await unauthenticatedApp.request(
      `${base}/api/staff/demand-batches/${conflictSource.demand_batch_id}/close`,
      {
        method: 'POST', headers: jsonHeaders('demand:route:unauthenticated'),
        body: JSON.stringify({ expected_version: 1, close_reason: '无会话关闭' }),
      },
      env,
    );
    expect(unauthenticatedClose.status).toBe(401);
    expect((await unauthenticatedClose.json() as any).error.code).toBe('UNAUTHENTICATED');

    // 产品详情读模型按版本暴露主图事实：绑定的版本可见文件信息，
    // 未绑定的版本返回 null，员工端据此提示补齐。
    const productDetail = await app.request(
      `${base}/api/staff/catalog/products/product-2`,
      { method: 'GET' },
      env,
    );
    expect(productDetail.status).toBe(200);
    const detailPayload = await productDetail.json() as any;
    expect(detailPayload.data.product.versions[0]).toMatchObject({
      product_version_id: 'product-version-2-v1',
      main_image: {
        file_object_id: 'file-main-image-2',
        client_file_name: 'main.webp',
      },
    });
  });
});

function seedDemandFixture(
  database: SqliteDatabase,
): void {
  database.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES
      (
        'staff-demand-reviewer', '需求审核', 'ACTIVE', 1,
        1, 1000, 1000, NULL
      );

    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES (
      'staff-demand-reviewer', 'seller_ops', 'ACTIVE', NULL,
      1000, NULL, 1000, 1000
    );
    INSERT INTO staff_marketplace_scopes (
      id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,
      assigned_at,revoked_at,reason,created_at,updated_at,scope_kind
    ) VALUES ('scope-demand-reviewer-jp','staff-demand-reviewer','seller_ops',
      'AMAZON_JP','ACTIVE','zz-phase3h-test-owner',1000,NULL,
      'TEST_PRIMARY',1000,1000,'PRIMARY');

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status,
      version, created_at, updated_at,
      activated_at, disabled_at, next_member_number
    ) VALUES (
      'seller-org-1', 'AMAZON_JP', 'ido-mango-8001',
      'seller-channel-ido-mango',
      'seller-channel-ido-mango',
      8001, '需求卖家', 'ACTIVE',
      1, 1000, 1000, 1000, NULL, 4
    );

    INSERT INTO seller_staff_assignments (
      id, seller_organization_id, duty_code, staff_id, status, source,
      assigned_by_actor_type, assigned_by_actor_id, reason, version,
      created_at, updated_at, revoked_at
    ) VALUES (
      'seller-org-1-manager-binding', 'seller-org-1', 'SELLER_ACCOUNT_MANAGER',
      'staff-demand-reviewer', 'ACTIVE', 'AUTO_INITIAL',
      'STAFF', 'zz-phase3h-test-owner', NULL, 1, 1000, 1000, NULL
    );

    INSERT INTO customer_identity_subjects (
      id, subject_type, created_at
    ) VALUES
      ('subject-owner', 'SELLER_ORG_MEMBER', 1000),
      ('subject-ops', 'SELLER_ORG_MEMBER', 1000),
      ('subject-finance', 'SELLER_ORG_MEMBER', 1000);

    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id,
      member_number, username_fallback, display_name,
      role, primary_owner, status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES
      (
        'member-owner', 'subject-owner',
        'seller-org-1', 1, 'ido-mango-8001-1',
        '负责人', 'OWNER', 1, 'ACTIVE', 1,
        1000, 1000, 1000, NULL
      ),
      (
        'member-ops', 'subject-ops',
        'seller-org-1', 2, 'ido-mango-8001-2',
        '运营', 'OPERATIONS', 0, 'ACTIVE', 1,
        1000, 1000, 1000, NULL
      ),
      (
        'member-finance', 'subject-finance',
        'seller-org-1', 3, 'ido-mango-8001-3',
        '财务', 'FINANCE', 0, 'ACTIVE', 1,
        1000, 1000, 1000, NULL
      );

    INSERT INTO seller_stores (
      id, organization_id, marketplace_code,
      display_name, normalized_name, status,
      version, created_at, updated_at, disabled_at
    ) VALUES
      (
        'store-1', 'seller-org-1', 'AMAZON_JP',
        '需求店铺一', '需求店铺一', 'ACTIVE',
        1, 1000, 1000, NULL
      ),
      (
        'store-2', 'seller-org-1', 'AMAZON_JP',
        '需求店铺二', '需求店铺二', 'ACTIVE',
        1, 1000, 1000, NULL
      );


    INSERT INTO products (
      id, organization_id, store_id, marketplace_code,
      asin_display, asin_normalized, status,
      current_version_no, version,
      created_at, updated_at, disabled_at
    ) VALUES
      (
        'product-1', 'seller-org-1', 'store-1', 'AMAZON_JP',
        'B0DEMAND01', 'B0DEMAND01', 'ACTIVE',
        1, 1, 1000, 1000, NULL
      ),
      (
        'product-2', 'seller-org-1', 'store-2', 'AMAZON_JP',
        'B0DEMAND02', 'B0DEMAND02', 'ACTIVE',
        1, 1, 1000, 1000, NULL
      );

    INSERT INTO product_versions (
      id, product_id, version_no, product_name,
      search_keywords_json, product_url,
      buyer_visible_notes, internal_notes,
      created_by_staff_id, created_at
    ,
          ordering_guide_expected_amount_jpy,
          color_spec_mode, order_interval_days, orders_per_run) VALUES
      (
        'product-version-1-v1', 'product-1', 1,
        '产品一旧版', '["旧版关键词"]',
        'https://www.amazon.co.jp/product-old',
        '产品公开说明', '产品内部说明',
        'staff-demand-reviewer', 1000
      ,
          1980, 'MAIN_IMAGE_VARIANT', 1, 100),
      (
        'product-version-2-v1', 'product-2', 1,
        '产品二', '["产品二关键词"]',
        'https://www.amazon.co.jp/product-two',
        '产品二公开说明', '产品二内部说明',
        'staff-demand-reviewer', 1000
      ,
          1980, 'MAIN_IMAGE_VARIANT', 1, 100);
  `);
  seedProductMainImage(database, 'product-version-1-v1', 'main-image-1');
  seedProductMainImage(database, 'product-version-2-v1', 'main-image-2');
}

function seedProductMainImage(
  database: SqliteDatabase,
  productVersionId: string,
  suffix: string,
): void {
  const intentId = `intent-${suffix}`;
  const fileObjectId = `file-${suffix}`;
  const linkId = `link-${suffix}`;
  database.prepare(`
    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id, purpose, visibility,
      status, requested_file_count, manifest_hash, version,
      expires_at, failure_code, created_at, updated_at, completed_at
    ) VALUES (?, 'STAFF', 'staff-demand-reviewer', 'PRODUCT_IMAGE',
      'SELLER_VISIBLE', 'ISSUED', 1, ?, 1, 30000, NULL,
      1000, 1000, NULL)
  `).bind(intentId, 'a'.repeat(64)).run();
  database.prepare(`
    INSERT INTO file_objects (
      id, upload_intent_id, slot_no, purpose, visibility, object_key,
      client_file_name, extension, declared_mime, expected_byte_size,
      status, upload_token_hash, upload_expires_at, uploaded_byte_size,
      detected_mime, uploaded_sha256, failure_code, delete_attempt_count,
      next_delete_at, version, created_at, updated_at, uploaded_at,
      verified_at, deleted_at
    ) VALUES (?, ?, 1, 'PRODUCT_IMAGE', 'SELLER_VISIBLE', ?,
      'main.webp', 'webp', 'image/webp', 100, 'RESERVED', ?, 30000,
      NULL, NULL, NULL, NULL, 0, NULL, 1, 1000, 1000,
      NULL, NULL, NULL)
  `).bind(
    fileObjectId,
    intentId,
    `files/v1/2026/08/${suffix.padEnd(40, 'x')}`,
    'b'.repeat(64),
  ).run();
  database.prepare(`
    UPDATE file_upload_intents
    SET status='VERIFIED', completed_at=1001, updated_at=1001
    WHERE id=?
  `).bind(intentId).run();
  database.prepare(`
    UPDATE file_objects
    SET status='VERIFIED', uploaded_byte_size=100,
        detected_mime='image/webp', uploaded_sha256=?,
        uploaded_at=1001, verified_at=1001, updated_at=1001
    WHERE id=?
  `).bind('c'.repeat(64), fileObjectId).run();
  database.prepare(`
    INSERT INTO file_entity_links (
      id, file_object_id, entity_type, entity_id, purpose, visibility,
      linked_by_actor_type, linked_by_actor_id, created_at,
      authorization_mode, expires_at, revoked_at
    ) VALUES (?, ?, 'PRODUCT_VERSION', ?, 'PRODUCT_IMAGE',
      'SELLER_VISIBLE', 'STAFF', 'staff-demand-reviewer', 1002,
      'EXPLICIT_AUDIENCES', NULL, NULL)
  `).bind(linkId, fileObjectId, productVersionId).run();
  database.prepare(`
    INSERT INTO file_entity_audience_grants (
      id, file_entity_link_id, subject_type, buyer_customer_id,
      seller_organization_id, staff_permission_code, staff_scope_type,
      staff_team_id, granted_by_actor_type, granted_by_actor_id,
      created_at, expires_at, revoked_at
    ) VALUES
      (?, ?, 'SELLER_ORGANIZATION', NULL, 'seller-org-1', NULL, NULL,
       NULL, 'STAFF', 'staff-demand-reviewer', 1002, NULL, NULL),
      (?, ?, 'STAFF_INTERNAL', NULL, NULL, 'PRODUCT_VIEW', 'GLOBAL',
       NULL, 'STAFF', 'staff-demand-reviewer', 1002, NULL, NULL)
  `).bind(
    `seller-grant-${suffix}`,
    linkId,
    `staff-grant-${suffix}`,
    linkId,
  ).run();
  database.prepare(`
    INSERT INTO product_version_main_images (
      product_version_id, file_entity_link_id,
      created_by_staff_id, created_at
    ) VALUES (?, ?, 'staff-demand-reviewer', 1002)
  `).bind(productVersionId, linkId).run();
}

function demandInput(
  productId: string,
) {
  return {
    productId,
    taskType: 'IMAGE' as const,
    targetQuantity: 8,
    buyerVisibleNotes: '公开说明',
    sellerNotes: '卖家内部说明',
    openAt: 4000,
    reservationDeadline: 10_000,
    orderDeadline: 20_000,
  };
}

async function publishDemandForClose(
  database: SqliteDatabase,
  keyPrefix: string,
): Promise<{ demand_batch_id: string }> {
  const submitted = await submitDemandBatch(database, demandInput('product-1'), {
    actor: ownerActor(), idempotencyKey: `${keyPrefix}:submit`, now: 2000,
  });
  await reviewDemandBatch(database, {
    demandBatchId: submitted.demand_batch_id,
    expectedVersion: 1,
    decision: 'PUBLISH',
    firstOrderDate: '1970-01-01',
  }, {
    actor: reviewerActor(), idempotencyKey: `${keyPrefix}:publish`, now: 3000,
  });
  return submitted;
}

function sellerActor(input: {
  memberId: string;
  role: SellerMemberRole;
  storeIds: readonly string[];
  allActiveStores: boolean;
  canManageProducts: boolean;
}): SellerDemandActor {
  return {
    ...input,
    sellerOrganizationId: 'seller-org-1',
  };
}

function ownerActor(): SellerDemandActor {
  return sellerActor({
    memberId: 'member-owner',
    role: 'OWNER',
    storeIds: ['store-1', 'store-2'],
    allActiveStores: true,
    canManageProducts: true,
  });
}

function operationsActor(
  storeIds: readonly string[],
): SellerDemandActor {
  return sellerActor({
    memberId: 'member-ops',
    role: 'OPERATIONS',
    storeIds,
    allActiveStores: false,
    canManageProducts: true,
  });
}

function financeActor(
  storeIds: readonly string[],
): SellerDemandActor {
  return sellerActor({
    memberId: 'member-finance',
    role: 'FINANCE',
    storeIds,
    allActiveStores: false,
    canManageProducts: false,
  });
}

function reviewerActor(): DemandStaffActor {
  return {
    staffId: 'staff-demand-reviewer',
    displayName: '需求审核',
    roles: ['seller_ops'] as readonly StaffRoleCode[],
    permissions: new Set<StaffPermissionCode>([
      'PRODUCT_REVIEW',
      'DEMAND_PUBLISH',
    ]),
  };
}

async function persistedDemandReviewerActor(
  database: SqliteDatabase,
): Promise<DemandStaffActor> {
  const authorization = await resolveAssignmentStaffAuthorization(database, 'staff-demand-reviewer');
  if (!authorization) throw new Error('missing persisted demand reviewer');
  return {
    staffId: authorization.staffId,
    displayName: authorization.displayName,
    roles: [...authorization.roles],
    permissions: authorization.permissions,
  };
}

function ownerDemandReviewerActor(): DemandStaffActor {
  return {
    staffId: 'zz-phase3h-test-owner', displayName: '总管理员', roles: ['owner'],
    permissions: new Set<StaffPermissionCode>(['PRODUCT_REVIEW', 'DEMAND_PUBLISH']),
  };
}

function insertDemandScopeMismatchOrganization(database: SqliteDatabase): void {
  database.exec(`INSERT INTO seller_organizations (
    id, marketplace_code, seller_code, origin_channel_id, current_channel_id,
    seller_sequence, organization_name, status, version, created_at, updated_at,
    activated_at, disabled_at, next_member_number
  ) VALUES ('seller-org-2','AMAZON_JP','ygbceping-8001','seller-channel-ygbceping',
    'seller-channel-ygbceping',8001,'错误工作项组织','ACTIVE',1,1000,1000,1000,NULL,2)`);
}

async function demandReviewBusinessCounts(
  database: SqliteDatabase,
  demandBatchId: string,
) {
  return database.prepare(`SELECT
    (SELECT status FROM demand_batches WHERE id=?) AS demand_status,
    (SELECT status FROM staff_work_items
      WHERE source_entity_type='DEMAND_BATCH' AND source_entity_id=?) AS work_status,
    (SELECT COUNT(*) FROM demand_batch_events WHERE demand_batch_id=?) AS events,
    (SELECT COUNT(*) FROM demand_order_schedule_versions WHERE demand_batch_id=?) AS schedules,
    (SELECT COUNT(*) FROM audit_events
      WHERE aggregate_type='DEMAND_BATCH' AND aggregate_id=?) AS audits
  `).bind(demandBatchId, demandBatchId, demandBatchId, demandBatchId,
    demandBatchId).first();
}

function activeBuyer(): BuyerDemandContext {
  return {
    buyerCustomerId: 'buyer-public-1',
    marketplaceCode: 'AMAZON_JP',
    accessStatus: 'ACTIVE',
    identityReviewStatus: 'CLEAR',
  };
}
