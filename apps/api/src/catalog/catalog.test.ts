import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import type {
  StaffPermissionCode,
  StaffRoleCode,
} from '@ygb/contracts';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import {
  addProductVersion,
} from './add-product-version';
import {
  assignSellerMemberStore,
} from './assign-member-store';
import {
  createApprovedProduct,
} from './create-product';
import {
  createSellerStore,
} from './create-store';
import {
  resolveSellerMemberStoreAccess,
} from './seller-member-store-access';
import type {
  CatalogStaffActor,
} from './catalog-shared';

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('seller stores and product catalog', () => {
  it('creates normalized stores idempotently and rejects duplicates in the same organization', async () => {
    database = createMigratedTestDatabase();
    seedCatalogActorsAndOrganizations(database);

    const first = await createSellerStore(database, {
      sellerOrganizationId: 'seller-org-1',
      marketplaceCode: 'JP',
      storeName: '  Ｍｏｏｎ   Store ',
    }, {
      actor: sellerOpsActor(),
      idempotencyKey: 'store:create:0001',
      now: 2000,
    });

    expect(first).toMatchObject({
      display_name: 'Moon Store',
      status: 'ACTIVE',
      version: 1,
      replayed: false,
    });

    const replay = await createSellerStore(database, {
      sellerOrganizationId: 'seller-org-1',
      marketplaceCode: 'JP',
      storeName: 'Moon Store',
    }, {
      actor: sellerOpsActor(),
      idempotencyKey: 'store:create:0001',
      now: 2100,
    });
    expect(replay).toEqual({
      ...first,
      replayed: true,
    });

    await expect(createSellerStore(database, {
      sellerOrganizationId: 'seller-org-1',
      marketplaceCode: 'JP',
      storeName: 'moon   store',
    }, {
      actor: sellerOpsActor(),
      idempotencyKey: 'store:create:0002',
      now: 2200,
    })).rejects.toMatchObject({
      code: 'DUPLICATE_STORE',
      status: 409,
    });

    const otherOrgStore = await createSellerStore(database, {
      sellerOrganizationId: 'seller-org-2',
      marketplaceCode: 'JP',
      storeName: 'Moon Store',
    }, {
      actor: sellerOpsActor(),
      idempotencyKey: 'store:create:0003',
      now: 2300,
    });
    expect(otherOrgStore.seller_organization_id)
      .toBe('seller-org-2');
  });

  it('gives OWNER all active stores and limits OPERATIONS to assigned scopes', async () => {
    database = createMigratedTestDatabase();
    seedCatalogActorsAndOrganizations(database);

    const storeOne = await createSellerStore(database, {
      sellerOrganizationId: 'seller-org-1',
      marketplaceCode: 'JP',
      storeName: '店铺一',
    }, {
      actor: sellerOpsActor(),
      idempotencyKey: 'store:create:scope:0001',
      now: 2000,
    });
    const storeTwo = await createSellerStore(database, {
      sellerOrganizationId: 'seller-org-1',
      marketplaceCode: 'JP',
      storeName: '店铺二',
    }, {
      actor: sellerOpsActor(),
      idempotencyKey: 'store:create:scope:0002',
      now: 2100,
    });

    await assignSellerMemberStore(database, {
      memberId: 'seller-member-ops-1',
      storeId: storeTwo.store_id,
    }, {
      actor: sellerOpsActor(),
      idempotencyKey: 'scope:assign:0001',
      now: 2200,
    });

    const ownerAccess = await resolveSellerMemberStoreAccess(
      database,
      'seller-member-owner-1',
    );
    expect(ownerAccess).toMatchObject({
      role: 'OWNER',
      allActiveStores: true,
      canManageProducts: true,
    });
    expect(ownerAccess?.storeIds).toEqual(
      [storeOne.store_id, storeTwo.store_id].sort(),
    );

    const operationsAccess =
      await resolveSellerMemberStoreAccess(
        database,
        'seller-member-ops-1',
      );
    expect(operationsAccess).toEqual({
      memberId: 'seller-member-ops-1',
      sellerOrganizationId: 'seller-org-1',
      role: 'OPERATIONS',
      allActiveStores: false,
      storeIds: [storeTwo.store_id],
      canManageProducts: true,
    });

    const financeAccess =
      await resolveSellerMemberStoreAccess(
        database,
        'seller-member-finance-1',
      );
    expect(financeAccess).toMatchObject({
      role: 'FINANCE',
      allActiveStores: false,
      storeIds: [],
      canManageProducts: false,
    });
  });

  it('enforces ASIN uniqueness per marketplace and distinguishes same-store duplicate from cross-store conflict', async () => {
    database = createMigratedTestDatabase();
    seedCatalogActorsAndOrganizations(database);

    const storeOne = await createSellerStore(database, {
      sellerOrganizationId: 'seller-org-1',
      marketplaceCode: 'JP',
      storeName: '产品店铺一',
    }, {
      actor: sellerOpsActor(),
      idempotencyKey: 'store:create:product:0001',
      now: 2000,
    });
    const storeTwo = await createSellerStore(database, {
      sellerOrganizationId: 'seller-org-2',
      marketplaceCode: 'JP',
      storeName: '产品店铺二',
    }, {
      actor: sellerOpsActor(),
      idempotencyKey: 'store:create:product:0002',
      now: 2100,
    });

    const created = await createApprovedProduct(database, {
      storeId: storeOne.store_id,
      asin: ' b0test0001 ',
      version: productVersion('初始产品'),
    }, {
      actor: productReviewerActor(),
      idempotencyKey: 'product:create:0001',
      now: 2200,
    });
    expect(created).toMatchObject({
      marketplace_code: 'JP',
      asin: 'B0TEST0001',
      current_version_no: 1,
      status: 'ACTIVE',
    });

    await expect(createApprovedProduct(database, {
      storeId: storeOne.store_id,
      asin: 'B0TEST0001',
      version: productVersion('重复产品'),
    }, {
      actor: productReviewerActor(),
      idempotencyKey: 'product:create:0002',
      now: 2300,
    })).rejects.toMatchObject({
      code: 'DUPLICATE_PRODUCT',
      status: 409,
    });

    await expect(createApprovedProduct(database, {
      storeId: storeTwo.store_id,
      asin: 'B0TEST0001',
      version: productVersion('跨店铺冲突'),
    }, {
      actor: productReviewerActor(),
      idempotencyKey: 'product:create:0003',
      now: 2400,
    })).rejects.toMatchObject({
      code: 'ASIN_STORE_CONFLICT',
      status: 409,
    });
  });

  it('appends immutable product versions and checks expected aggregate version', async () => {
    database = createMigratedTestDatabase();
    seedCatalogActorsAndOrganizations(database);

    const store = await createSellerStore(database, {
      sellerOrganizationId: 'seller-org-1',
      marketplaceCode: 'JP',
      storeName: '版本店铺',
    }, {
      actor: sellerOpsActor(),
      idempotencyKey: 'store:create:version:0001',
      now: 2000,
    });
    const product = await createApprovedProduct(database, {
      storeId: store.store_id,
      asin: 'B0TEST0002',
      version: productVersion('版本一'),
    }, {
      actor: productReviewerActor(),
      idempotencyKey: 'product:create:version:0001',
      now: 2100,
    });

    const versionTwo = await addProductVersion(database, {
      productId: product.product_id,
      expectedVersion: 1,
      version: {
        ...productVersion('版本二'),
        searchKeywords: ['关键词二', '关键词二'],
        productUrl: 'https://www.amazon.co.jp/version-two#fragment',
      },
    }, {
      actor: productReviewerActor(),
      idempotencyKey: 'product:version:0001',
      now: 2200,
    });
    expect(versionTwo).toMatchObject({
      version_no: 2,
      aggregate_version: 2,
      replayed: false,
    });
    expect(versionTwo.product_version).toMatchObject({
      productName: '版本二',
      searchKeywords: ['关键词二'],
      productUrl: 'https://www.amazon.co.jp/version-two',
    });

    await expect(addProductVersion(database, {
      productId: product.product_id,
      expectedVersion: 1,
      version: productVersion('冲突版本'),
    }, {
      actor: productReviewerActor(),
      idempotencyKey: 'product:version:0002',
      now: 2300,
    })).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      status: 409,
    });

    await expect(database.prepare(`
      UPDATE product_versions
      SET product_name='非法覆盖'
      WHERE product_id=?
        AND version_no=1
    `).bind(product.product_id).run()).rejects.toThrow(
      'product_versions_are_immutable',
    );

    await expect(database.prepare(`
      DELETE FROM product_versions
      WHERE product_id=?
        AND version_no=1
    `).bind(product.product_id).run()).rejects.toThrow(
      'product_versions_are_immutable',
    );

    const rows = await database.prepare(`
      SELECT version_no, product_name
      FROM product_versions
      WHERE product_id=?
      ORDER BY version_no
    `).bind(product.product_id).all<{
      version_no: number;
      product_name: string;
    }>();
    expect(rows.results).toEqual([
      {
        version_no: 1,
        product_name: '版本一',
      },
      {
        version_no: 2,
        product_name: '版本二',
      },
    ]);
  });

  it('maps invalid catalog domain input to a stable validation error', async () => {
    database = createMigratedTestDatabase();
    seedCatalogActorsAndOrganizations(database);

    await expect(createSellerStore(database, {
      sellerOrganizationId: 'seller-org-1',
      marketplaceCode: 'JP',
      storeName: '非法\n店铺',
    }, {
      actor: sellerOpsActor(),
      idempotencyKey: 'store:create:invalid:0001',
      now: 2000,
    })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
  });

  it('rejects product creation from an actor without PRODUCT_REVIEW', async () => {
    database = createMigratedTestDatabase();
    seedCatalogActorsAndOrganizations(database);

    const store = await createSellerStore(database, {
      sellerOrganizationId: 'seller-org-1',
      marketplaceCode: 'JP',
      storeName: '权限测试店铺',
    }, {
      actor: sellerOpsActor(),
      idempotencyKey: 'store:create:permission:0001',
      now: 2000,
    });

    await expect(createApprovedProduct(database, {
      storeId: store.store_id,
      asin: 'B0TEST0003',
      version: productVersion('无权限产品'),
    }, {
      actor: {
        ...sellerOpsActor(),
        permissions: new Set(['SELLER_MANAGE']),
      },
      idempotencyKey: 'product:create:permission:0001',
      now: 2100,
    })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });
});

function seedCatalogActorsAndOrganizations(
  database: SqliteDatabase,
): void {
  database.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES
      (
        'staff-seller-ops', '卖家对接', 'ACTIVE', 1,
        1, 1000, 1000, NULL
      ),
      (
        'staff-product-reviewer', '产品审核', 'ACTIVE', 1,
        1, 1000, 1000, NULL
      );

    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES
      (
        'staff-seller-ops', 'seller_ops', 'ACTIVE', NULL,
        1000, NULL, 1000, 1000
      ),
      (
        'staff-product-reviewer', 'seller_ops', 'ACTIVE', NULL,
        1000, NULL, 1000, 1000
      );

    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id, seller_sequence,
      organization_name, status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES
      (
        'seller-org-1', 'JP', 'ido-mango-1001',
        'seller-channel-ido-mango',
        'seller-channel-ido-mango',
        1001, '测试卖家一', 'ACTIVE', 1,
        1000, 1000, 1000, NULL
      ),
      (
        'seller-org-2', 'JP', 'ygbceping-1001',
        'seller-channel-ygbceping',
        'seller-channel-ygbceping',
        1001, '测试卖家二', 'ACTIVE', 1,
        1000, 1000, 1000, NULL
      );

    INSERT INTO customer_identity_subjects (
      id, subject_type, created_at
    ) VALUES
      (
        'subject-owner-1', 'SELLER_ORG_MEMBER', 1000
      ),
      (
        'subject-ops-1', 'SELLER_ORG_MEMBER', 1000
      ),
      (
        'subject-finance-1', 'SELLER_ORG_MEMBER', 1000
      );

    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id, member_number,
      username_fallback, display_name, role, primary_owner,
      status, version, created_at, updated_at,
      activated_at, disabled_at
    ) VALUES
      (
        'seller-member-owner-1', 'subject-owner-1',
        'seller-org-1', 1, 'ido-mango-1001-1',
        '负责人', 'OWNER', 1, 'ACTIVE', 1,
        1000, 1000, 1000, NULL
      ),
      (
        'seller-member-ops-1', 'subject-ops-1',
        'seller-org-1', 2, 'ido-mango-1001-2',
        '运营', 'OPERATIONS', 0, 'ACTIVE', 1,
        1000, 1000, 1000, NULL
      ),
      (
        'seller-member-finance-1', 'subject-finance-1',
        'seller-org-1', 3, 'ido-mango-1001-3',
        '财务', 'FINANCE', 0, 'ACTIVE', 1,
        1000, 1000, 1000, NULL
      );
  `);
}

function actor(input: {
  staffId: string;
  displayName: string;
  roles: readonly StaffRoleCode[];
  permissions: readonly StaffPermissionCode[];
}): CatalogStaffActor {
  return {
    staffId: input.staffId,
    displayName: input.displayName,
    roles: input.roles,
    permissions: new Set(input.permissions),
  };
}

function sellerOpsActor(): CatalogStaffActor {
  return actor({
    staffId: 'staff-seller-ops',
    displayName: '卖家对接',
    roles: ['seller_ops'],
    permissions: [
      'SELLER_MANAGE',
    ],
  });
}

function productReviewerActor(): CatalogStaffActor {
  return actor({
    staffId: 'staff-product-reviewer',
    displayName: '产品审核',
    roles: ['seller_ops'],
    permissions: [
      'PRODUCT_REVIEW',
    ],
  });
}

function productVersion(
  productName: string,
) {
  return {
    productName,
    searchKeywords: ['关键词一'],
    productUrl: 'https://www.amazon.co.jp/product',
    buyerVisibleNotes: '买家可见',
    internalNotes: '内部说明',
  };
}
