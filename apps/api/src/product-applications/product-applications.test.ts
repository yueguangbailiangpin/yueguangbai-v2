import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import type {
  ProductDescriptiveFields,
  SellerMemberRole,
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import {
  reviewProductApplication,
} from './review-product-application';
import {
  submitProductApplication,
} from './submit-product-application';
import {
  withdrawProductApplication,
} from './withdraw-product-application';
import type {
  ProductApplicationStaffActor,
  SellerProductApplicationActor,
} from './product-application-shared';

let database: SqliteDatabase | null = null;

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

    await expect(submitProductApplication(
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
    )).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });

    await expect(submitProductApplication(
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
    )).rejects.toMatchObject({
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

    await submitProductApplication(database, {
      storeId: 'store-1',
      asin: 'B0APPLY005',
      product: productVersion('首次申请'),
      sellerNotes: null,
    }, {
      actor: ownerActor(),
      idempotencyKey: 'product-application:duplicate:0001',
      now: 2000,
    });

    await expect(submitProductApplication(database, {
      storeId: 'store-other-org',
      asin: 'B0APPLY005',
      product: productVersion('其他卖家申请'),
      sellerNotes: null,
    }, {
      actor: otherOwnerActor(),
      idempotencyKey: 'product-application:duplicate:0002',
      now: 2100,
    })).rejects.toMatchObject({
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
    expect(approved.product_id).toMatch(
      /^[0-9a-f-]{36}$/u,
    );
    expect(approved.product_version_id).toMatch(
      /^[0-9a-f-]{36}$/u,
    );

    const state = await database.prepare(`
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
    `).bind(
      submitted.application_id,
    ).first<{
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

    await expect(reviewProductApplication(
      database,
      {
        applicationId: submitted.application_id,
        expectedVersion: 2,
        decision: 'APPROVE',
        orderingGuideExpectedAmountJpy: 1980,
        colorSpecMode: 'MAIN_IMAGE_VARIANT',
      },
      {
        actor: reviewerActor(),
        idempotencyKey:
          'product-application:reject:second-review',
        now: 3100,
      },
    )).rejects.toMatchObject({
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

    await expect(database.prepare(`
      UPDATE product_application_events
      SET next_status='APPROVED'
      WHERE application_id=?
    `).bind(
      submitted.application_id,
    ).run()).rejects.toThrow(
      'product_application_events_are_immutable',
    );

    await expect(database.prepare(`
      DELETE FROM product_application_events
      WHERE application_id=?
    `).bind(
      submitted.application_id,
    ).run()).rejects.toThrow(
      'product_application_events_are_immutable',
    );
  });

  it('requires PRODUCT_REVIEW and expected version for review', async () => {
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

    await expect(reviewProductApplication(
      database,
      {
        applicationId: submitted.application_id,
        expectedVersion: 1,
        decision: 'APPROVE',
        orderingGuideExpectedAmountJpy: 1980,
        colorSpecMode: 'MAIN_IMAGE_VARIANT',
      },
      {
        actor: {
          ...reviewerActor(),
          permissions: new Set(),
        },
        idempotencyKey:
          'product-application:permission:review',
        now: 3000,
      },
    )).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });

    await expect(reviewProductApplication(
      database,
      {
        applicationId: submitted.application_id,
        expectedVersion: 99,
        decision: 'REJECT',
        rejectionReason: '版本冲突测试',
      },
      {
        actor: reviewerActor(),
        idempotencyKey:
          'product-application:version:review',
        now: 3100,
      },
    )).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      status: 409,
    });
  });
});

function seedProductApplicationFixture(
  database: SqliteDatabase,
): void {
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

function operationsActor(
  storeIds: readonly string[],
): SellerProductApplicationActor {
  return sellerActor({
    memberId: 'member-ops-1',
    sellerOrganizationId: 'seller-org-1',
    role: 'OPERATIONS',
    storeIds,
    allActiveStores: false,
    canManageProducts: true,
  });
}

function financeActor(
  storeIds: readonly string[],
): SellerProductApplicationActor {
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
    permissions: new Set<StaffPermissionCode>([
      'PRODUCT_REVIEW',
    ]),
  };
}

function productVersion(
  productName: string,
): ProductDescriptiveFields {
  return {
    productName,
    searchKeywords: ['关键词A'],
    productUrl:
      'https://www.amazon.co.jp/product-application',
    buyerVisibleNotes: '买家可见说明',
    internalNotes: null,
  };
}
