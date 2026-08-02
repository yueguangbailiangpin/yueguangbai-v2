import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import type {
  SellerMemberRole,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import { createApp } from '../app';
import { resolveAssignmentStaffAuthorization } from '../staff-assignment';
import { registerStaffCatalogWorkflowRoutes } from '../staff-catalog-routes';
import {
  closeDemandBatch,
} from './close-demand-batch';
import {
  listBuyerPublicDemandBatches,
} from './list-public-demand-batches';
import {
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

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('demand batch workflow', () => {
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
          'Idempotency-Key': 'staff-demand-api:publish',
        },
        body: JSON.stringify({
          expected_version: 1,
          decision: 'PUBLISH',
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
      marketplace_code: 'JP',
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
          color_spec_mode) VALUES (
        'product-version-1-v2', 'product-1', 2,
        '产品一新版', '["新版关键词"]',
        'https://www.amazon.co.jp/product-new',
        '新版公开说明', '新版内部说明',
        'staff-demand-reviewer', 2500
      ,
          1980, 'MAIN_IMAGE_VARIANT');
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
      marketplace_code: 'JP',
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

  it('enforces review permission, expected version, expiry, and immutable events', async () => {
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

    await expect(reviewDemandBatch(
      database,
      {
        demandBatchId: submitted.demand_batch_id,
        expectedVersion: 1,
        decision: 'PUBLISH',
      },
      {
        actor: {
          ...reviewerActor(),
          permissions: new Set(),
        },
        idempotencyKey: 'demand:guard:forbidden',
        now: 3000,
      },
    )).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });

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
    INSERT INTO staff_departments (
      id, code, name, status, version, created_at, updated_at, disabled_at
    ) VALUES ('department-demand-review','demand-review','Demand Review',
      'ACTIVE',1,1000,1000,NULL);
    INSERT INTO staff_teams (
      id, department_id, code, name, status, version,
      created_at, updated_at, disabled_at
    ) VALUES ('team-demand-review','department-demand-review','demand-review',
      'Demand Review','ACTIVE',1,1000,1000,NULL);
    INSERT INTO staff_team_memberships (
      staff_id, team_id, status, joined_at, ended_at, created_at, updated_at
    ) VALUES ('staff-demand-reviewer','team-demand-review','ACTIVE',1000,NULL,1000,1000);
    INSERT INTO staff_team_memberships (
      staff_id, team_id, status, joined_at, ended_at, created_at, updated_at
    ) VALUES ('zz-phase3h-test-owner','team-demand-review','ACTIVE',1000,NULL,1000,1000);
    INSERT INTO staff_team_leaders (
      staff_id, team_id, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES ('staff-demand-reviewer','team-demand-review','ACTIVE',
      'zz-phase3h-test-owner',1000,NULL,1000,1000);

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status,
      version, created_at, updated_at,
      activated_at, disabled_at, next_member_number
    ) VALUES (
      'seller-org-1', 'JP', 'ido-mango-8001',
      'seller-channel-ido-mango',
      'seller-channel-ido-mango',
      8001, '需求卖家', 'ACTIVE',
      1, 1000, 1000, 1000, NULL, 4
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
        'store-1', 'seller-org-1', 'JP',
        '需求店铺一', '需求店铺一', 'ACTIVE',
        1, 1000, 1000, NULL
      ),
      (
        'store-2', 'seller-org-1', 'JP',
        '需求店铺二', '需求店铺二', 'ACTIVE',
        1, 1000, 1000, NULL
      );

    INSERT INTO seller_member_store_scopes (
      member_id, store_id, organization_id, status,
      assigned_by_staff_id, assigned_at, revoked_at,
      created_at, updated_at
    ) VALUES
      (
        'member-ops', 'store-1', 'seller-org-1',
        'ACTIVE', 'staff-demand-reviewer', 1000, NULL,
        1000, 1000
      ),
      (
        'member-finance', 'store-1', 'seller-org-1',
        'ACTIVE', 'staff-demand-reviewer', 1000, NULL,
        1000, 1000
      );

    INSERT INTO products (
      id, organization_id, store_id, marketplace_code,
      asin_display, asin_normalized, status,
      current_version_no, version,
      created_at, updated_at, disabled_at
    ) VALUES
      (
        'product-1', 'seller-org-1', 'store-1', 'JP',
        'B0DEMAND01', 'B0DEMAND01', 'ACTIVE',
        1, 1, 1000, 1000, NULL
      ),
      (
        'product-2', 'seller-org-1', 'store-2', 'JP',
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
          color_spec_mode) VALUES
      (
        'product-version-1-v1', 'product-1', 1,
        '产品一旧版', '["旧版关键词"]',
        'https://www.amazon.co.jp/product-old',
        '产品公开说明', '产品内部说明',
        'staff-demand-reviewer', 1000
      ,
          1980, 'MAIN_IMAGE_VARIANT'),
      (
        'product-version-2-v1', 'product-2', 1,
        '产品二', '["产品二关键词"]',
        'https://www.amazon.co.jp/product-two',
        '产品二公开说明', '产品二内部说明',
        'staff-demand-reviewer', 1000
      ,
          1980, 'MAIN_IMAGE_VARIANT');
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
      'DEMAND_PUBLISH',
    ]),
  };
}

function activeBuyer(): BuyerDemandContext {
  return {
    buyerCustomerId: 'buyer-public-1',
    marketplaceCode: 'JP',
    accessStatus: 'ACTIVE',
    identityReviewStatus: 'CLEAR',
  };
}
