import { afterEach, describe, expect, it } from 'vitest';
import type {
  ProductDescriptiveFields,
  SellerMemberRole,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { resolveAssignmentStaffAuthorization } from '../staff-assignment';
import { reviewProductApplication } from './review-product-application';
import { submitProductApplication as submitProductApplicationImpl } from './submit-product-application';
import { productApplicationFileAuthorization } from './file-authorization';
import { withdrawProductApplication } from './withdraw-product-application';
import type {
  ProductApplicationStaffActor,
  SellerProductApplicationActor,
} from './product-application-shared';

let database: SqliteDatabase | null = null;

function submitProductApplication(
  database: SqliteDatabase,
  input: Omit<Parameters<typeof submitProductApplicationImpl>[2], 'imageFiles'> &
    Partial<Pick<Parameters<typeof submitProductApplicationImpl>[2], 'imageFiles'>>,
  command: Parameters<typeof submitProductApplicationImpl>[3],
) {
  return submitProductApplicationImpl(
    database,
    productApplicationFileAuthorization,
    {
      ...input,
      imageFiles: input.imageFiles ?? [
        {
          fileObjectId:
            command.actor.memberId === 'member-ops-1'
              ? 'application-image-ops'
              : command.actor.memberId === 'member-owner-2'
                ? 'application-image-owner-2'
                : 'application-image-owner-1',
          expectedFileVersion: 1,
        },
      ],
    },
    command,
  );
}

afterEach(() => {
  database?.close();
  database = null;
});

describe('seller product applications and staff review', () => {
  it('allows OWNER or scoped OPERATIONS to submit and blocks unscoped roles', async () => {
    database = createMigratedTestDatabase();
    seedProductApplicationFixture(database);

    const submitted = await submitProductApplication(
      database,
      {
        storeId: 'store-2',
        asin: ' b0apply001 ',
        product: productVersion('申请产品一'),
        sellerNotes: ' 卖家补充说明 ',
      },
      {
        actor: operationsActor(['store-2']),
        idempotencyKey: 'product-application:submit:0001',
        now: 2000,
      },
    );

    expect(submitted).toMatchObject({
      seller_organization_id: 'seller-org-1',
      store_id: 'store-2',
      asin: 'B0APPLY001',
      status: 'SUBMITTED',
      version: 1,
      replayed: false,
    });

    const replay = await submitProductApplication(
      database,
      {
        storeId: 'store-2',
        asin: 'B0APPLY001',
        product: productVersion('申请产品一'),
        sellerNotes: '卖家补充说明',
      },
      {
        actor: operationsActor(['store-2']),
        idempotencyKey: 'product-application:submit:0001',
        now: 2100,
      },
    );
    expect(replay).toEqual({
      ...submitted,
      replayed: true,
    });

    const committed = await database
      .prepare(
        `
      SELECT
        (SELECT COUNT(*) FROM file_entity_links link
          WHERE link.entity_type='PRODUCT_APPLICATION' AND link.entity_id=?) AS links,
        (SELECT COUNT(*) FROM file_entity_audience_grants grant_row
          JOIN file_entity_links link ON link.id=grant_row.file_entity_link_id
          WHERE link.entity_type='PRODUCT_APPLICATION' AND link.entity_id=?) AS grants,
        (SELECT COUNT(*) FROM file_audience_events event_row
          WHERE event_row.entity_type='PRODUCT_APPLICATION' AND event_row.entity_id=?) AS audience_events,
        (SELECT COUNT(*) FROM audit_events audit
          WHERE audit.aggregate_id=? OR audit.aggregate_id IN (
            SELECT id FROM file_entity_links WHERE entity_type='PRODUCT_APPLICATION' AND entity_id=?
          )) AS audits,
        (SELECT COUNT(*) FROM integration_outbox outbox
          WHERE outbox.aggregate_id=? OR outbox.aggregate_id IN (
            SELECT id FROM file_entity_links WHERE entity_type='PRODUCT_APPLICATION' AND entity_id=?
          )) AS outbox_events
    `,
      )
      .bind(
        submitted.application_id,
        submitted.application_id,
        submitted.application_id,
        submitted.application_id,
        submitted.application_id,
        submitted.application_id,
        submitted.application_id,
      )
      .first<{
        links: number;
        grants: number;
        audience_events: number;
        audits: number;
        outbox_events: number;
      }>();
    expect(committed).toEqual({
      links: 1,
      grants: 2,
      audience_events: 3,
      audits: 2,
      outbox_events: 2,
    });

    await expect(
      submitProductApplication(
        database,
        {
          storeId: 'store-1',
          asin: 'B0APPLY002',
          product: productVersion('越权产品'),
          sellerNotes: null,
        },
        {
          actor: operationsActor(['store-2']),
          idempotencyKey: 'product-application:submit:0002',
          now: 2200,
        },
      ),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });

    await expect(
      submitProductApplication(
        database,
        {
          storeId: 'store-1',
          asin: 'B0APPLY003',
          product: productVersion('财务产品'),
          sellerNotes: null,
        },
        {
          actor: financeActor(['store-1']),
          idempotencyKey: 'product-application:submit:0003',
          now: 2300,
        },
      ),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });

    const ownerSubmission = await submitProductApplication(
      database,
      {
        storeId: 'store-1',
        asin: 'B0APPLY004',
        product: productVersion('负责人产品'),
        sellerNotes: null,
      },
      {
        actor: ownerActor(),
        idempotencyKey: 'product-application:submit:0004',
        now: 2400,
      },
    );
    expect(ownerSubmission.store_id).toBe('store-1');
  });

  it('rejects another active submission for the same marketplace ASIN', async () => {
    database = createMigratedTestDatabase();
    seedProductApplicationFixture(database);

    await submitProductApplication(
      database,
      {
        storeId: 'store-1',
        asin: 'B0APPLY005',
        product: productVersion('首次申请'),
        sellerNotes: null,
      },
      {
        actor: ownerActor(),
        idempotencyKey: 'product-application:duplicate:0001',
        now: 2000,
      },
    );

    await expect(
      submitProductApplication(
        database,
        {
          storeId: 'store-other-org',
          asin: 'B0APPLY005',
          product: productVersion('其他卖家申请'),
          sellerNotes: null,
        },
        {
          actor: otherOwnerActor(),
          idempotencyKey: 'product-application:duplicate:0002',
          now: 2100,
        },
      ),
    ).rejects.toMatchObject({
      code: 'PRODUCT_APPLICATION_CONFLICT',
      status: 409,
    });
  });

  it('approves an application and creates the formal product and version atomically', async () => {
    database = createMigratedTestDatabase();
    seedProductApplicationFixture(database);

    const submitted = await submitProductApplication(
      database,
      {
        storeId: 'store-1',
        asin: 'B0APPLY006',
        product: {
          ...productVersion('批准产品'),
          searchKeywords: ['关键词A', '关键词A', '关键词B'],
        },
        sellerNotes: '内部卖家说明',
      },
      {
        actor: ownerActor(),
        idempotencyKey: 'product-application:approve:submit',
        now: 2000,
      },
    );

    const approved = await reviewProductApplication(
      database,
      {
        applicationId: submitted.application_id,
        expectedVersion: 1,
        decision: 'APPROVE',
        orderingGuideExpectedAmountJpy: 1980,
        colorSpecMode: 'MAIN_IMAGE_VARIANT',
        orderIntervalDays: 1,
        ordersPerRun: 1,
      },
      {
        actor: reviewerActor(),
        idempotencyKey: 'product-application:approve:review',
        now: 3000,
      },
    );

    expect(approved).toMatchObject({
      application_id: submitted.application_id,
      status: 'APPROVED',
      application_version: 2,
      review_reason: null,
      replayed: false,
    });
    expect(approved.product_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(approved.product_version_id).toMatch(/^[0-9a-f-]{36}$/u);

    const state = await database
      .prepare(
        `
      SELECT
        application.status AS application_status,
        application.product_id,
        product.status AS product_status,
        product.current_version_no,
        version.product_name,
        version.search_keywords_json,
        version.internal_notes
      FROM product_applications application
      JOIN products product
        ON product.id=application.product_id
      JOIN product_versions version
        ON version.product_id=product.id
        AND version.version_no=1
      WHERE application.id=?
    `,
      )
      .bind(submitted.application_id)
      .first<{
        application_status: string;
        product_id: string;
        product_status: string;
        current_version_no: number;
        product_name: string;
        search_keywords_json: string;
        internal_notes: string | null;
      }>();

    expect(state).toEqual({
      application_status: 'APPROVED',
      product_id: approved.product_id,
      product_status: 'ACTIVE',
      current_version_no: 1,
      product_name: '批准产品',
      search_keywords_json: '["关键词A","关键词A","关键词B"]',
      internal_notes: '内部卖家说明',
    });

    const replay = await reviewProductApplication(
      database,
      {
        applicationId: submitted.application_id,
        expectedVersion: 1,
        decision: 'APPROVE',
        orderingGuideExpectedAmountJpy: 1980,
        colorSpecMode: 'MAIN_IMAGE_VARIANT',
        orderIntervalDays: 1,
        ordersPerRun: 1,
      },
      {
        actor: reviewerActor(),
        idempotencyKey: 'product-application:approve:review',
        now: 3100,
      },
    );
    expect(replay).toEqual({
      ...approved,
      replayed: true,
    });
  });

  it('rejects with a reason and prevents a second review', async () => {
    database = createMigratedTestDatabase();
    seedProductApplicationFixture(database);

    const submitted = await submitProductApplication(
      database,
      {
        storeId: 'store-1',
        asin: 'B0APPLY007',
        product: productVersion('拒绝产品'),
        sellerNotes: null,
      },
      {
        actor: ownerActor(),
        idempotencyKey: 'product-application:reject:submit',
        now: 2000,
      },
    );

    const rejected = await reviewProductApplication(
      database,
      {
        applicationId: submitted.application_id,
        expectedVersion: 1,
        decision: 'REJECT',
        rejectionReason: ' ASIN 与店铺资料不一致 ',
      },
      {
        actor: reviewerActor(),
        idempotencyKey: 'product-application:reject:review',
        now: 3000,
      },
    );

    expect(rejected).toEqual({
      application_id: submitted.application_id,
      status: 'REJECTED',
      application_version: 2,
      product_id: null,
      product_version_id: null,
      review_reason: 'ASIN 与店铺资料不一致',
      replayed: false,
    });

    await expect(
      reviewProductApplication(
        database,
        {
          applicationId: submitted.application_id,
          expectedVersion: 2,
          decision: 'APPROVE',
          orderingGuideExpectedAmountJpy: 1980,
          colorSpecMode: 'MAIN_IMAGE_VARIANT',
          orderIntervalDays: 1,
          ordersPerRun: 1,
        },
        {
          actor: reviewerActor(),
          idempotencyKey: 'product-application:reject:second-review',
          now: 3100,
        },
      ),
    ).rejects.toMatchObject({
      code: 'PRODUCT_APPLICATION_ALREADY_REVIEWED',
      status: 409,
    });
  });

  it('withdraws a submitted application and keeps application events immutable', async () => {
    database = createMigratedTestDatabase();
    seedProductApplicationFixture(database);

    const submitted = await submitProductApplication(
      database,
      {
        storeId: 'store-2',
        asin: 'B0APPLY008',
        product: productVersion('撤回产品'),
        sellerNotes: null,
      },
      {
        actor: operationsActor(['store-2']),
        idempotencyKey: 'product-application:withdraw:submit',
        now: 2000,
      },
    );

    const withdrawn = await withdrawProductApplication(
      database,
      {
        applicationId: submitted.application_id,
        expectedVersion: 1,
      },
      {
        actor: operationsActor(['store-2']),
        idempotencyKey: 'product-application:withdraw:command',
        now: 3000,
      },
    );
    expect(withdrawn).toEqual({
      application_id: submitted.application_id,
      status: 'WITHDRAWN',
      application_version: 2,
      replayed: false,
    });

    await expect(
      database
        .prepare(
          `
      UPDATE product_application_events
      SET next_status='APPROVED'
      WHERE application_id=?
    `,
        )
        .bind(submitted.application_id)
        .run(),
    ).rejects.toThrow('product_application_events_are_immutable');

    await expect(
      database
        .prepare(
          `
      DELETE FROM product_application_events
      WHERE application_id=?
    `,
        )
        .bind(submitted.application_id)
        .run(),
    ).rejects.toThrow('product_application_events_are_immutable');
  });

  it('applies product review permission to reject and the extra cadence permission only to approve', async () => {
    database = createMigratedTestDatabase();
    seedProductApplicationFixture(database);

    const submitted = await submitProductApplication(
      database,
      {
        storeId: 'store-1',
        asin: 'B0APPLY009',
        product: productVersion('权限产品'),
        sellerNotes: null,
      },
      {
        actor: ownerActor(),
        idempotencyKey: 'product-application:permission:submit',
        now: 2000,
      },
    );

    const forbiddenRoles: ProductApplicationStaffActor[] = [
      {
        ...reviewerActor(),
        roles: ['buyer_refund'],
        permissions: new Set<StaffPermissionCode>(['PRODUCT_REVIEW', 'DEMAND_PUBLISH']),
      },
      {
        ...reviewerActor(),
        roles: ['pre_sales'],
        permissions: new Set<StaffPermissionCode>(['PRODUCT_REVIEW', 'DEMAND_PUBLISH']),
      },
    ];
    for (const [index, deniedActor] of forbiddenRoles.entries()) {
      await expect(
        reviewProductApplication(
          database,
          {
            applicationId: submitted.application_id,
            expectedVersion: 1,
            decision: 'APPROVE',
            orderingGuideExpectedAmountJpy: 1980,
            colorSpecMode: 'MAIN_IMAGE_VARIANT',
            orderIntervalDays: 1,
            ordersPerRun: 1,
          },
          {
            actor: deniedActor,
            idempotencyKey: `product-application:permission:review:${index}`,
            now: 3000 + index,
          },
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      await expect(
        reviewProductApplication(
          database,
          {
            applicationId: submitted.application_id,
            expectedVersion: 1,
            decision: 'REJECT',
            rejectionReason: '角色硬门禁',
          },
          {
            actor: deniedActor,
            idempotencyKey: `product-application:permission:reject:${index}`,
            now: 3000 + index,
          },
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    }

    await expect(
      reviewProductApplication(
        database,
        {
          applicationId: submitted.application_id,
          expectedVersion: 1,
          decision: 'APPROVE',
          orderingGuideExpectedAmountJpy: 1980,
          colorSpecMode: 'MAIN_IMAGE_VARIANT',
          orderIntervalDays: 1,
          ordersPerRun: 1,
        },
        {
          actor: {
            ...reviewerActor(),
            permissions: new Set<StaffPermissionCode>(['PRODUCT_REVIEW']),
          },
          idempotencyKey: 'product-application:permission:approve-without-demand',
          now: 3000,
        },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    await expect(
      reviewProductApplication(
        database,
        {
          applicationId: submitted.application_id,
          expectedVersion: 1,
          decision: 'REJECT',
          rejectionReason: '缺少产品审核权限',
        },
        {
          actor: {
            ...reviewerActor(),
            permissions: new Set<StaffPermissionCode>(['DEMAND_PUBLISH']),
          },
          idempotencyKey: 'product-application:permission:reject-without-product',
          now: 3000,
        },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    await expect(
      reviewProductApplication(
        database,
        {
          applicationId: submitted.application_id,
          expectedVersion: 99,
          decision: 'REJECT',
          rejectionReason: '版本冲突测试',
        },
        {
          actor: reviewerActor(),
          idempotencyKey: 'product-application:version:review',
          now: 3100,
        },
      ),
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      status: 409,
    });

    const rejected = await reviewProductApplication(
      database,
      {
        applicationId: submitted.application_id,
        expectedVersion: 1,
        decision: 'REJECT',
        rejectionReason: '基础产品审核权限允许拒绝',
      },
      {
        actor: {
          ...reviewerActor(),
          permissions: new Set<StaffPermissionCode>(['PRODUCT_REVIEW']),
        },
        idempotencyKey: 'product-application:permission:product-only-reject',
        now: 3200,
      },
    );
    expect(rejected.status).toBe('REJECTED');
  });

  it('uses current effective PRODUCT_REVIEW for reject while approval still needs DEMAND_PUBLISH', async () => {
    database = createMigratedTestDatabase();
    seedProductApplicationFixture(database);
    const submitted = await submitProductApplication(
      database,
      {
        storeId: 'store-1',
        asin: 'B0APPLY012',
        product: productVersion('动作权限'),
        sellerNotes: null,
      },
      { actor: ownerActor(), idempotencyKey: 'product-action:submit', now: 2000 },
    );
    database.exec(`INSERT INTO staff_permission_overrides (
      staff_id, permission_code, effect, status, reason,
      assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
    ) VALUES ('staff-reviewer','DEMAND_PUBLISH','DENY','ACTIVE','action gate',
      'zz-phase3h-test-owner',1500,NULL,1500,1500)`);
    const actor = await persistedReviewerActor(database);
    expect(actor.permissions.has('PRODUCT_REVIEW')).toBe(true);
    expect(actor.permissions.has('DEMAND_PUBLISH')).toBe(false);
    await expect(
      reviewProductApplication(
        database,
        {
          applicationId: submitted.application_id,
          expectedVersion: 1,
          decision: 'APPROVE',
          orderingGuideExpectedAmountJpy: 1980,
          colorSpecMode: 'MAIN_IMAGE_VARIANT',
          orderIntervalDays: 1,
          ordersPerRun: 1,
        },
        { actor, idempotencyKey: 'product-action:approve', now: 3000 },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(
      reviewProductApplication(
        database,
        {
          applicationId: submitted.application_id,
          expectedVersion: 1,
          decision: 'REJECT',
          rejectionReason: '只拒绝，不创建产品版本',
        },
        { actor, idempotencyKey: 'product-action:reject', now: 3100 },
      ),
    ).resolves.toMatchObject({ status: 'REJECTED' });
  });

  it('rejects stale work-item organization scope without writes while owner GLOBAL proceeds', async () => {
    database = createMigratedTestDatabase();
    seedProductApplicationFixture(database);
    const submitted = await submitProductApplication(
      database,
      {
        storeId: 'store-1',
        asin: 'B0APPLY013',
        product: productVersion('范围复核'),
        sellerNotes: null,
      },
      { actor: ownerActor(), idempotencyKey: 'product-scope:submit', now: 2000 },
    );
    // Simulate stale metadata that normal database write guards prevent.
    database.exec(`DROP TRIGGER trg_staff_work_items_update_guard`);
    await database
      .prepare(
        `UPDATE staff_work_items SET seller_organization_id='seller-org-2'
      WHERE source_entity_type='PRODUCT_APPLICATION' AND source_entity_id=?`,
      )
      .bind(submitted.application_id)
      .run();
    const before = await productReviewBusinessCounts(database, submitted.application_id);
    await expect(
      reviewProductApplication(
        database,
        {
          applicationId: submitted.application_id,
          expectedVersion: 1,
          decision: 'REJECT',
          rejectionReason: '恶意工作项组织',
        },
        { actor: reviewerActor(), idempotencyKey: 'product-scope:denied', now: 3000 },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(await productReviewBusinessCounts(database, submitted.application_id)).toEqual(before);
    const approved = await reviewProductApplication(
      database,
      {
        applicationId: submitted.application_id,
        expectedVersion: 1,
        decision: 'APPROVE',
        orderingGuideExpectedAmountJpy: 1980,
        colorSpecMode: 'MAIN_IMAGE_VARIANT',
        orderIntervalDays: 1,
        ordersPerRun: 1,
      },
      { actor: ownerReviewerActor(), idempotencyKey: 'product-scope:owner', now: 3100 },
    );
    expect(approved.status).toBe('APPROVED');
    expect(
      (
        await database
          .prepare(
            `SELECT status FROM staff_work_items
      WHERE source_entity_type='PRODUCT_APPLICATION' AND source_entity_id=?`,
          )
          .bind(submitted.application_id)
          .first<{ status: string }>()
      )?.status,
    ).toBe('COMPLETED');
  });

  it('requires owned verified images and leaves no partial application or links', async () => {
    database = createMigratedTestDatabase();
    seedProductApplicationFixture(database);
    const input = {
      storeId: 'store-1',
      asin: 'B0APPLY010',
      product: productVersion('图片申请'),
      sellerNotes: null,
    };
    for (const [suffix, imageFiles, code] of [
      ['none', [], 'VALIDATION_ERROR'],
      [
        'too-many',
        Array.from({ length: 9 }, () => ({
          fileObjectId: 'application-image-owner-1',
          expectedFileVersion: 1,
        })),
        'VALIDATION_ERROR',
      ],
      [
        'duplicate',
        [
          { fileObjectId: 'application-image-owner-1', expectedFileVersion: 1 },
          { fileObjectId: 'application-image-owner-1', expectedFileVersion: 1 },
        ],
        'VALIDATION_ERROR',
      ],
      [
        'stale',
        [{ fileObjectId: 'application-image-owner-1', expectedFileVersion: 2 }],
        'VERSION_CONFLICT',
      ],
      [
        'wrong-purpose',
        [{ fileObjectId: 'application-image-wrong-purpose', expectedFileVersion: 1 }],
        'FILE_STORAGE_CONFLICT',
      ],
      [
        'cross-owner',
        [{ fileObjectId: 'application-image-ops', expectedFileVersion: 1 }],
        'FORBIDDEN',
      ],
      [
        'mixed',
        [
          { fileObjectId: 'application-image-owner-1', expectedFileVersion: 1 },
          { fileObjectId: 'application-image-ops', expectedFileVersion: 1 },
        ],
        'FORBIDDEN',
      ],
    ] as const) {
      await expect(
        submitProductApplicationImpl(
          database,
          productApplicationFileAuthorization,
          {
            ...input,
            imageFiles,
          },
          { actor: ownerActor(), idempotencyKey: `product-application:image:${suffix}`, now: 3000 },
        ),
      ).rejects.toMatchObject({ code });
    }
    await database
      .prepare(
        `UPDATE file_objects SET status='RESERVED', uploaded_byte_size=NULL, detected_mime=NULL, uploaded_sha256=NULL, uploaded_at=NULL, verified_at=NULL WHERE id='application-image-owner-1'`,
      )
      .run();
    await expect(
      submitProductApplicationImpl(
        database,
        productApplicationFileAuthorization,
        {
          ...input,
          imageFiles: [{ fileObjectId: 'application-image-owner-1', expectedFileVersion: 1 }],
        },
        { actor: ownerActor(), idempotencyKey: 'product-application:image:unverified', now: 3100 },
      ),
    ).rejects.toMatchObject({ code: 'FILE_NOT_VERIFIED' });
    const counts = await database
      .prepare(
        `SELECT (SELECT COUNT(*) FROM product_applications) AS applications, (SELECT COUNT(*) FROM file_entity_links) AS links`,
      )
      .first<{ applications: number; links: number }>();
    expect(counts).toEqual({ applications: 0, links: 0 });
  });

  it('rolls back application, image audiences, audit and outbox together', async () => {
    database = createMigratedTestDatabase();
    seedProductApplicationFixture(database);
    database.exec(`
      CREATE TRIGGER test_reject_product_application_outbox
      BEFORE INSERT ON integration_outbox
      WHEN NEW.event_type='PRODUCT_APPLICATION_SUBMITTED'
      BEGIN
        SELECT RAISE(ABORT, 'forced_product_application_outbox_failure');
      END;
    `);
    await expect(
      submitProductApplication(
        database,
        {
          storeId: 'store-1',
          asin: 'B0APPLY011',
          product: productVersion('原子回滚'),
          sellerNotes: null,
        },
        { actor: ownerActor(), idempotencyKey: 'product-application:atomic-rollback', now: 3200 },
      ),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE' });
    const counts = await database
      .prepare(
        `
      SELECT
        (SELECT COUNT(*) FROM product_applications) AS applications,
        (SELECT COUNT(*) FROM file_entity_links) AS links,
        (SELECT COUNT(*) FROM file_entity_audience_grants) AS grants,
        (SELECT COUNT(*) FROM audit_events) AS audits,
        (SELECT COUNT(*) FROM integration_outbox) AS outbox_events
    `,
      )
      .first<{
        applications: number;
        links: number;
        grants: number;
        audits: number;
        outbox_events: number;
      }>();
    expect(counts).toEqual({ applications: 0, links: 0, grants: 0, audits: 0, outbox_events: 0 });
  });
});

function seedProductApplicationFixture(database: SqliteDatabase): void {
  database.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES (
      'staff-reviewer', '产品审核', 'ACTIVE', 1,
      1, 1000, 1000, NULL
    );

    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES (
      'staff-reviewer', 'seller_ops', 'ACTIVE', NULL,
      1000, NULL, 1000, 1000
    );
    INSERT INTO staff_marketplace_scopes (
      id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,
      assigned_at,revoked_at,reason,created_at,updated_at,scope_kind
    ) VALUES ('scope-product-reviewer-jp','staff-reviewer','seller_ops',
      'AMAZON_JP','ACTIVE','zz-phase3h-test-owner',1000,NULL,
      'TEST_PRIMARY',1000,1000,'PRIMARY');
    INSERT INTO staff_departments (
      id, code, name, status, version, created_at, updated_at, disabled_at
    ) VALUES ('department-product-review','product-review','Product Review',
      'ACTIVE',1,1000,1000,NULL);
    INSERT INTO staff_teams (
      id, department_id, code, name, status, version,
      created_at, updated_at, disabled_at
    ) VALUES ('team-product-review','department-product-review','product-review',
      'Product Review','ACTIVE',1,1000,1000,NULL);
    INSERT INTO staff_team_memberships (
      staff_id, team_id, status, joined_at, ended_at, created_at, updated_at
    ) VALUES ('staff-reviewer','team-product-review','ACTIVE',1000,NULL,1000,1000);
    INSERT INTO staff_team_memberships (
      staff_id, team_id, status, joined_at, ended_at, created_at, updated_at
    ) VALUES ('zz-phase3h-test-owner','team-product-review','ACTIVE',1000,NULL,1000,1000);
    INSERT INTO staff_team_leaders (
      staff_id, team_id, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES ('staff-reviewer','team-product-review','ACTIVE',
      'zz-phase3h-test-owner',1000,NULL,1000,1000);

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id,
      seller_sequence, organization_name, status,
      version, created_at, updated_at,
      activated_at, disabled_at, next_member_number
    ) VALUES
      (
        'seller-org-1', 'JP', 'ido-mango-7001',
        'seller-channel-ido-mango',
        'seller-channel-ido-mango',
        7001, '申请卖家一', 'ACTIVE',
        1, 1000, 1000, 1000, NULL, 4
      ),
      (
        'seller-org-2', 'JP', 'ygbceping-7001',
        'seller-channel-ygbceping',
        'seller-channel-ygbceping',
        7001, '申请卖家二', 'ACTIVE',
        1, 1000, 1000, 1000, NULL, 2
      );

    INSERT INTO customer_identity_subjects (
      id, subject_type, created_at
    ) VALUES
      ('subject-owner-1', 'SELLER_ORG_MEMBER', 1000),
      ('subject-ops-1', 'SELLER_ORG_MEMBER', 1000),
      ('subject-finance-1', 'SELLER_ORG_MEMBER', 1000),
      ('subject-owner-2', 'SELLER_ORG_MEMBER', 1000);

    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id,
      member_number, username_fallback, display_name,
      role, primary_owner, status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES
      (
        'member-owner-1', 'subject-owner-1',
        'seller-org-1', 1, 'ido-mango-7001-1',
        '负责人一', 'OWNER', 1, 'ACTIVE', 1,
        1000, 1000, 1000, NULL
      ),
      (
        'member-ops-1', 'subject-ops-1',
        'seller-org-1', 2, 'ido-mango-7001-2',
        '运营一', 'OPERATIONS', 0, 'ACTIVE', 1,
        1000, 1000, 1000, NULL
      ),
      (
        'member-finance-1', 'subject-finance-1',
        'seller-org-1', 3, 'ido-mango-7001-3',
        '财务一', 'FINANCE', 0, 'ACTIVE', 1,
        1000, 1000, 1000, NULL
      ),
      (
        'member-owner-2', 'subject-owner-2',
        'seller-org-2', 1, 'ygbceping-7001-1',
        '负责人二', 'OWNER', 1, 'ACTIVE', 1,
        1000, 1000, 1000, NULL
      );

    INSERT INTO seller_stores (
      id, organization_id, marketplace_code,
      display_name, normalized_name, status,
      version, created_at, updated_at, disabled_at
    ) VALUES
      (
        'store-1', 'seller-org-1', 'JP',
        '申请店铺一', '申请店铺一', 'ACTIVE',
        1, 1000, 1000, NULL
      ),
      (
        'store-2', 'seller-org-1', 'JP',
        '申请店铺二', '申请店铺二', 'ACTIVE',
        1, 1000, 1000, NULL
      ),
      (
        'store-other-org', 'seller-org-2', 'JP',
        '申请店铺三', '申请店铺三', 'ACTIVE',
        1, 1000, 1000, NULL
      );

    INSERT INTO seller_member_store_scopes (
      member_id, store_id, organization_id, status,
      assigned_by_staff_id, assigned_at, revoked_at,
      created_at, updated_at
    ) VALUES
      (
        'member-ops-1', 'store-2', 'seller-org-1',
        'ACTIVE', 'staff-reviewer', 1000, NULL,
        1000, 1000
      ),
      (
        'member-finance-1', 'store-1', 'seller-org-1',
        'ACTIVE', 'staff-reviewer', 1000, NULL,
        1000, 1000
      );

    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id, purpose, visibility, status,
      requested_file_count, manifest_hash, version, expires_at, failure_code,
      created_at, updated_at, completed_at
    ) VALUES
      ('application-intent-owner-1','SELLER_MEMBER','member-owner-1','PRODUCT_APPLICATION_IMAGE','SELLER_VISIBLE','ISSUED',
        1,'0000000000000000000000000000000000000000000000000000000000000001',1,9000000,NULL,1000,1000,NULL),
      ('application-intent-ops','SELLER_MEMBER','member-ops-1','PRODUCT_APPLICATION_IMAGE','SELLER_VISIBLE','ISSUED',
        1,'0000000000000000000000000000000000000000000000000000000000000002',1,9000000,NULL,1000,1000,NULL),
      ('application-intent-owner-2','SELLER_MEMBER','member-owner-2','PRODUCT_APPLICATION_IMAGE','SELLER_VISIBLE','ISSUED',
        1,'0000000000000000000000000000000000000000000000000000000000000003',1,9000000,NULL,1000,1000,NULL),
      ('application-intent-wrong-purpose','SELLER_MEMBER','member-owner-1','PRODUCT_IMAGE','SELLER_VISIBLE','ISSUED',
        1,'0000000000000000000000000000000000000000000000000000000000000004',1,9000000,NULL,1000,1000,NULL);

    INSERT INTO file_objects (
      id, upload_intent_id, slot_no, purpose, visibility, object_key,
      client_file_name, extension, declared_mime, expected_byte_size, status,
      upload_token_hash, upload_expires_at, uploaded_byte_size, detected_mime,
      uploaded_sha256, failure_code, version, created_at, updated_at, uploaded_at, verified_at, deleted_at
    ) VALUES
      ('application-image-owner-1','application-intent-owner-1',1,'PRODUCT_APPLICATION_IMAGE','SELLER_VISIBLE','files/v1/application/image-owner-1-000000000000',
       'owner.png','png','image/png',10,'RESERVED','0000000000000000000000000000000000000000000000000000000000000001',9000000,NULL,NULL,
       NULL,NULL,1,1000,1000,NULL,NULL,NULL),
      ('application-image-ops','application-intent-ops',1,'PRODUCT_APPLICATION_IMAGE','SELLER_VISIBLE','files/v1/application/image-ops-0000000000000000',
       'ops.png','png','image/png',10,'RESERVED','0000000000000000000000000000000000000000000000000000000000000002',9000000,NULL,NULL,
       NULL,NULL,1,1000,1000,NULL,NULL,NULL),
      ('application-image-owner-2','application-intent-owner-2',1,'PRODUCT_APPLICATION_IMAGE','SELLER_VISIBLE','files/v1/application/image-owner-2-000000000000',
       'other.png','png','image/png',10,'RESERVED','0000000000000000000000000000000000000000000000000000000000000003',9000000,NULL,NULL,
       NULL,NULL,1,1000,1000,NULL,NULL,NULL),
      ('application-image-wrong-purpose','application-intent-wrong-purpose',1,'PRODUCT_IMAGE','SELLER_VISIBLE','files/v1/application/image-wrong-purpose-000000000',
       'wrong.png','png','image/png',10,'RESERVED','0000000000000000000000000000000000000000000000000000000000000004',9000000,NULL,NULL,
       NULL,NULL,1,1000,1000,NULL,NULL,NULL);

    UPDATE file_upload_intents SET status='VERIFIED', completed_at=1001, updated_at=1001;
    UPDATE file_objects SET status='VERIFIED', uploaded_byte_size=10, detected_mime='image/png',
      uploaded_sha256=upload_token_hash, uploaded_at=1001, verified_at=1001, updated_at=1001;
  `);
}

function sellerActor(input: {
  memberId: string;
  sellerOrganizationId: string;
  role: SellerMemberRole;
  storeIds: readonly string[];
  allActiveStores: boolean;
  canManageProducts: boolean;
}): SellerProductApplicationActor {
  return input;
}

function ownerActor(): SellerProductApplicationActor {
  return sellerActor({
    memberId: 'member-owner-1',
    sellerOrganizationId: 'seller-org-1',
    role: 'OWNER',
    storeIds: ['store-1', 'store-2'],
    allActiveStores: true,
    canManageProducts: true,
  });
}

function otherOwnerActor(): SellerProductApplicationActor {
  return sellerActor({
    memberId: 'member-owner-2',
    sellerOrganizationId: 'seller-org-2',
    role: 'OWNER',
    storeIds: ['store-other-org'],
    allActiveStores: true,
    canManageProducts: true,
  });
}

function operationsActor(storeIds: readonly string[]): SellerProductApplicationActor {
  return sellerActor({
    memberId: 'member-ops-1',
    sellerOrganizationId: 'seller-org-1',
    role: 'OPERATIONS',
    storeIds,
    allActiveStores: false,
    canManageProducts: true,
  });
}

function financeActor(storeIds: readonly string[]): SellerProductApplicationActor {
  return sellerActor({
    memberId: 'member-finance-1',
    sellerOrganizationId: 'seller-org-1',
    role: 'FINANCE',
    storeIds,
    allActiveStores: false,
    canManageProducts: false,
  });
}

function reviewerActor(): ProductApplicationStaffActor {
  return {
    staffId: 'staff-reviewer',
    displayName: '产品审核',
    roles: ['seller_ops'] as readonly StaffRoleCode[],
    permissions: new Set<StaffPermissionCode>(['PRODUCT_REVIEW', 'DEMAND_PUBLISH']),
  };
}

async function persistedReviewerActor(
  database: SqliteDatabase,
): Promise<ProductApplicationStaffActor> {
  const authorization = await resolveAssignmentStaffAuthorization(database, 'staff-reviewer');
  if (!authorization) throw new Error('missing persisted reviewer');
  return {
    staffId: authorization.staffId,
    displayName: authorization.displayName,
    roles: [...authorization.roles],
    permissions: authorization.permissions,
  };
}

function ownerReviewerActor(): ProductApplicationStaffActor {
  return {
    staffId: 'zz-phase3h-test-owner',
    displayName: '总管理员',
    roles: ['owner'],
    permissions: new Set<StaffPermissionCode>(['PRODUCT_REVIEW', 'DEMAND_PUBLISH']),
  };
}

async function productReviewBusinessCounts(database: SqliteDatabase, applicationId: string) {
  return database
    .prepare(
      `SELECT
    (SELECT status FROM product_applications WHERE id=?) AS application_status,
    (SELECT status FROM staff_work_items
      WHERE source_entity_type='PRODUCT_APPLICATION' AND source_entity_id=?) AS work_status,
    (SELECT COUNT(*) FROM products) AS products,
    (SELECT COUNT(*) FROM product_application_events WHERE application_id=?) AS events,
    (SELECT COUNT(*) FROM audit_events
      WHERE aggregate_type='PRODUCT_APPLICATION' AND aggregate_id=?) AS audits,
    (SELECT COUNT(*) FROM integration_outbox
      WHERE aggregate_type='PRODUCT_APPLICATION' AND aggregate_id=?) AS outbox_events
  `,
    )
    .bind(applicationId, applicationId, applicationId, applicationId, applicationId)
    .first();
}

function productVersion(productName: string): ProductDescriptiveFields {
  return {
    productName,
    searchKeywords: ['关键词A'],
    productUrl: 'https://www.amazon.co.jp/product-application',
    buyerVisibleNotes: '买家可见说明',
    internalNotes: null,
  };
}
