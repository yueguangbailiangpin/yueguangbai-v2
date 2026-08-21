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
import { createApp } from '../app';
import { resolveAssignmentStaffAuthorization } from '../staff-assignment';
import { registerStaffCatalogWorkflowRoutes } from '../staff/catalog-routes';
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
  it('runs the staff product API with persisted authorization and freezes 10000 BPS', async () => {
    database = createMigratedTestDatabase();
    seedCatalogActorsAndOrganizations(database);
    const store = await createSellerStore(database, {
      sellerOrganizationId: 'seller-org-1',
      marketplaceCode: 'JP',
      storeName: '员工 API 店铺',
    }, {
      actor: sellerOpsActor(),
      idempotencyKey: 'staff-product-api:store',
      now: 2000,
    });

    const unauthorizedApp = createApp();
    registerStaffCatalogWorkflowRoutes(unauthorizedApp);
    const requestBody = JSON.stringify({
      store_id: store.store_id,
      asin: 'B0API10000',
      version: {
        product_name: '员工 API 产品',
        search_keywords: ['关键词一'],
        product_url: null,
        buyer_visible_notes: '买家说明',
        internal_notes: '内部说明',
        ordering_guide_expected_amount_jpy: 1980,
        color_spec_mode: 'MAIN_IMAGE_VARIANT',
        default_buyer_self_pay_bps: 10000,
        order_interval_days: 1,
        orders_per_run: 1,
      },
    });
    const requestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'staff-product-api:create',
      },
      body: requestBody,
    };
    const unauthorized = await unauthorizedApp.request(
      'https://api.test/api/staff/catalog/products',
      requestInit,
      { DB: database } as any,
    );
    expect(unauthorized.status).toBe(401);

    const authorization = await resolveAssignmentStaffAuthorization(
      database,
      'zz-phase3h-test-owner',
    );
    expect(authorization).not.toBeNull();
    const app = createApp();
    app.use('/api/staff/*', async (context, next) => {
      (context as any).set('staffAuthorization', authorization);
      await next();
    });
    registerStaffCatalogWorkflowRoutes(app);
    const response = await app.request(
      'https://api.test/api/staff/catalog/products',
      requestInit,
      { DB: database } as any,
    );
    expect(response.status).toBe(201);
    const payload = await response.json() as any;
    expect(payload.data.product.product_version)
      .toMatchObject({ defaultBuyerSelfPayBps: 10000 });

    const detail = await app.request(
      `https://api.test/api/staff/catalog/products/${encodeURIComponent(
        payload.data.product.product_id,
      )}`,
      { method: 'GET' },
      { DB: database } as any,
    );
    expect(detail.status).toBe(200);
    expect((await detail.json()).data.product).toMatchObject({
      product_id: payload.data.product.product_id,
    });

    const stored = await database.prepare(`
      SELECT default_buyer_self_pay_bps
      FROM product_versions
      WHERE id=?
    `).bind(payload.data.product.product_version_id).first<{
      default_buyer_self_pay_bps: number;
    }>();
    expect(stored?.default_buyer_self_pay_bps).toBe(10000);
  });

  it('rejects non-JP store creation until the business layer supports other markets', async () => {
    database = createMigratedTestDatabase();
    seedCatalogActorsAndOrganizations(database);

    // AMAZON_US is ACTIVE/AVAILABLE in the registry, but the business tables
    // (seller_stores/products/demand_batches reference marketplaces(code)
    // which admits a single 'JP' row) are JP-only. The old code hardcoded the
    // JP legacy projection for every store, so a US store was silently stored
    // as 'JP' and its product applications entered the JP conflict check.
    // Creation must fail loudly instead.
    await expect(createSellerStore(database, {
      sellerOrganizationId: 'seller-org-1',
      marketplaceCode: 'AMAZON_US',
      storeName: '美国店铺',
    }, {
      actor: actor({
        staffId: 'zz-phase3h-test-owner',
        displayName: '总管理员',
        roles: ['owner'],
        permissions: ['SELLER_MANAGE'],
        dataScope: {
          type: 'GLOBAL',
          buyerCustomerIds: [],
          sellerOrganizationIds: [],
          teamIds: [],
          marketplaceCodes: [],
        },
      }),
      idempotencyKey: 'store:create:market:us',
      now: 2000,
    })).rejects.toMatchObject({
      code: 'MARKETPLACE_NOT_SUPPORTED',
      status: 409,
    });

    // JP store creation remains unaffected.
    const jp = await createSellerStore(database, {
      sellerOrganizationId: 'seller-org-1',
      marketplaceCode: 'JP',
      storeName: '日本店铺',
    }, {
      actor: sellerOpsActor(),
      idempotencyKey: 'store:create:market:jp',
      now: 2100,
    });
    expect(jp).toMatchObject({
      marketplace_code: 'JP',
      status: 'ACTIVE',
    });
  });

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
      searchKeywords: ['关键词二', '关键词二'],
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

  it('hard-gates product cadence writes by role, both permissions, and seller scope', async () => {
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

    const scope = {
      type: 'ASSIGNED_SELLER_ORGANIZATIONS' as const,
      buyerCustomerIds: [],
      sellerOrganizationIds: ['seller-org-1'],
      teamIds: [],
      marketplaceCodes: ['AMAZON_JP'],
    };
    const forbidden = [
      actor({ staffId: 'staff-refund', displayName: '返款', roles: ['buyer_refund'],
        permissions: ['PRODUCT_REVIEW', 'DEMAND_PUBLISH'], dataScope: scope }),
      actor({ staffId: 'staff-presales', displayName: '售前', roles: ['pre_sales'],
        permissions: ['PRODUCT_REVIEW', 'DEMAND_PUBLISH'], dataScope: scope }),
      actor({ staffId: 'staff-product-only', displayName: '缺需求权限', roles: ['seller_ops'],
        permissions: ['PRODUCT_REVIEW'], dataScope: scope }),
      actor({ staffId: 'staff-demand-only', displayName: '缺产品权限', roles: ['seller_ops'],
        permissions: ['DEMAND_PUBLISH'], dataScope: scope }),
    ];
    for (const [index, deniedActor] of forbidden.entries()) {
      await expect(createApprovedProduct(database, {
        storeId: store.store_id,
        asin: `B0GATE${String(index).padStart(4, '0')}`,
        version: productVersion('无权限产品'),
      }, {
        actor: deniedActor,
        idempotencyKey: `product:create:permission:${index}`,
        now: 2100 + index,
      })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    }

    const created = await createApprovedProduct(database, {
      storeId: store.store_id,
      asin: 'B0TEST0003',
      version: productVersion('双权限产品'),
    }, {
      actor: productReviewerActor(),
      idempotencyKey: 'product:create:permission:allowed',
      now: 2200,
    });
    for (const [index, deniedActor] of forbidden.entries()) {
      await expect(addProductVersion(database, {
        productId: created.product_id,
        expectedVersion: 1,
        version: productVersion('无权限版本'),
      }, {
        actor: deniedActor,
        idempotencyKey: `product:version:permission:${index}`,
        now: 2300 + index,
      })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    }

    const ownerVersion = await addProductVersion(database, {
      productId: created.product_id,
      expectedVersion: 1,
      version: productVersion('Owner 双权限版本'),
    }, {
      actor: actor({
        staffId: 'zz-phase3h-test-owner', displayName: '总管理员', roles: ['owner'],
        permissions: ['PRODUCT_REVIEW', 'DEMAND_PUBLISH'],
        dataScope: { type: 'GLOBAL', buyerCustomerIds: [], sellerOrganizationIds: [],
          teamIds: [], marketplaceCodes: [] },
      }),
      idempotencyKey: 'product:version:permission:owner-allowed',
      now: 2400,
    });
    expect(ownerVersion.version_no).toBe(2);
  });

  it('wires the staff store creation route with auth, scope and replay safety', async () => {
    database = createMigratedTestDatabase();
    seedCatalogActorsAndOrganizations(database);

    // 401 without staff authorization
    const anonymousApp = createApp();
    registerStaffCatalogWorkflowRoutes(anonymousApp);
    const anonymous = await anonymousApp.request(
      'https://api.test/api/staff/catalog/stores',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seller_organization_id: 'seller-org-1',
          marketplace_code: 'AMAZON_JP',
          store_name: '路由建店店铺',
        }),
      },
      { DB: database } as any,
    );
    expect(anonymous.status).toBe(401);

    // Authorized seller_ops (SELLER_MANAGE + AMAZON_JP scope) creates the store
    const authorization = await resolveAssignmentStaffAuthorization(
      database,
      'staff-seller-ops',
    );
    expect(authorization).not.toBeNull();
    const app = createApp();
    app.use('/api/staff/*', async (context, next) => {
      (context as any).set('staffAuthorization', authorization);
      await next();
    });
    registerStaffCatalogWorkflowRoutes(app);

    const requestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'route-store:create',
      },
      body: JSON.stringify({
        seller_organization_id: 'seller-org-1',
        marketplace_code: 'AMAZON_JP',
        store_name: '路由建店店铺',
      }),
    };
    const created = await app.request(
      'https://api.test/api/staff/catalog/stores',
      requestInit,
      { DB: database } as any,
    );
    expect(created.status).toBe(201);
    const payload = await created.json() as any;
    expect(payload.data.store).toMatchObject({
      seller_organization_id: 'seller-org-1',
      marketplace_code: 'AMAZON_JP',
      display_name: '路由建店店铺',
      status: 'ACTIVE',
    });

    // Replay with the same key returns the same store (no duplicate)
    const replay = await app.request(
      'https://api.test/api/staff/catalog/stores',
      requestInit,
      { DB: database } as any,
    );
    expect(replay.status).toBe(201);
    const replayPayload = await replay.json() as any;
    expect(replayPayload.data.store.store_id).toBe(payload.data.store.store_id);
    expect(replayPayload.data.store.replayed).toBe(true);

    // Validation: invalid marketplace code -> 400
    const badMarket = await app.request(
      'https://api.test/api/staff/catalog/stores',
      {
        ...requestInit,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'route-store:bad-market',
        },
        body: JSON.stringify({
          seller_organization_id: 'seller-org-1',
          marketplace_code: 'NOT_A_MARKET',
          store_name: '坏市场店铺',
        }),
      },
      { DB: database } as any,
    );
    expect(badMarket.status).toBe(400);

    // A pre_sales actor (no SELLER_MANAGE) is forbidden
    const preSales = await resolveAssignmentStaffAuthorization(
      database,
      'staff-pre-sales',
    );
    expect(preSales).not.toBeNull();
    const app2 = createApp();
    app2.use('/api/staff/*', async (context, next) => {
      (context as any).set('staffAuthorization', preSales);
      await next();
    });
    registerStaffCatalogWorkflowRoutes(app2);
    const forbidden = await app2.request(
      'https://api.test/api/staff/catalog/stores',
      requestInit,
      { DB: database } as any,
    );
    expect(forbidden.status).toBe(403);

    // A seller_ops actor WITHOUT an AMAZON_JP marketplace scope is out of
    // scope: 404 (concealment, not 403) per the resource-ownership rule.
    const reviewer = await resolveAssignmentStaffAuthorization(
      database,
      'staff-product-reviewer',
    );
    expect(reviewer).not.toBeNull();
    const app3 = createApp();
    app3.use('/api/staff/*', async (context, next) => {
      (context as any).set('staffAuthorization', reviewer);
      await next();
    });
    registerStaffCatalogWorkflowRoutes(app3);
    const outOfScope = await app3.request(
      'https://api.test/api/staff/catalog/stores',
      requestInit,
      { DB: database } as any,
    );
    expect(outOfScope.status).toBe(404);
  });

  it('wires the staff main-image route with auth, file contract and replay safety', async () => {
    database = createMigratedTestDatabase();
    seedCatalogActorsAndOrganizations(database);

    // Seed an approved product + version (via the domain commands) and a
    // verified PRODUCT_IMAGE file upload intent owned by staff.
    const store = await createSellerStore(database, {
      sellerOrganizationId: 'seller-org-1',
      marketplaceCode: 'JP',
      storeName: '主图测试店铺',
    }, {
      actor: sellerOpsActor(),
      idempotencyKey: 'main-image:store',
      now: 3000,
    });
    const product = await createApprovedProduct(database, {
      storeId: store.store_id,
      asin: 'B0MAINIMG0',
      version: productVersion('主图测试产品'),
    }, {
      actor: productReviewerActor(),
      idempotencyKey: 'main-image:product',
      now: 3100,
    });
    seedStaffProductImage(database, 'file-main-image-1', 3200);

    // 401 without staff authorization
    const anonymousApp = createApp();
    registerStaffCatalogWorkflowRoutes(anonymousApp);
    const anonymous = await anonymousApp.request(
      'https://api.test/api/staff/catalog/product-versions/'
        + `${product.product_version_id}/main-image`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_object_id: 'file-main-image-1',
          expected_file_version: 1,
        }),
      },
      { DB: database } as any,
    );
    expect(anonymous.status).toBe(401);

    // Authorized seller_ops staff (AMAZON_JP scope + PRODUCT_REVIEW) links
    const authorization = await resolveAssignmentStaffAuthorization(
      database,
      'staff-seller-ops',
    );
    expect(authorization).not.toBeNull();
    const app = createApp();
    app.use('/api/staff/*', async (context, next) => {
      (context as any).set('staffAuthorization', authorization);
      await next();
    });
    registerStaffCatalogWorkflowRoutes(app);

    const requestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'main-image:link',
      },
      body: JSON.stringify({
        file_object_id: 'file-main-image-1',
        expected_file_version: 1,
      }),
    };
    const linked = await app.request(
      'https://api.test/api/staff/catalog/product-versions/'
        + `${product.product_version_id}/main-image`,
      requestInit,
      { DB: database } as any,
    );
    expect(linked.status).toBe(201);
    const payload = await linked.json() as any;
    expect(payload.data.main_image).toMatchObject({
      product_version_id: product.product_version_id,
      file_object_id: 'file-main-image-1',
      seller_organization_id: 'seller-org-1',
      authorization_mode: 'EXPLICIT_AUDIENCES',
    });

    // Replay returns the same fact
    const replay = await app.request(
      'https://api.test/api/staff/catalog/product-versions/'
        + `${product.product_version_id}/main-image`,
      requestInit,
      { DB: database } as any,
    );
    expect(replay.status).toBe(201);
    const replayPayload = await replay.json() as any;
    expect(replayPayload.data.main_image.file_object_id).toBe('file-main-image-1');
    expect(replayPayload.data.main_image.replayed).toBe(true);

    // A pre_sales actor (no PRODUCT_REVIEW) is forbidden
    const preSales = await resolveAssignmentStaffAuthorization(
      database,
      'staff-pre-sales',
    );
    const app2 = createApp();
    app2.use('/api/staff/*', async (context, next) => {
      (context as any).set('staffAuthorization', preSales);
      await next();
    });
    registerStaffCatalogWorkflowRoutes(app2);
    const forbidden = await app2.request(
      'https://api.test/api/staff/catalog/product-versions/'
        + `${product.product_version_id}/main-image`,
      requestInit,
      { DB: database } as any,
    );
    expect(forbidden.status).toBe(403);
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
      ),
      (
        'staff-pre-sales', '售前', 'ACTIVE', 1,
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
      ),
      (
        'staff-pre-sales', 'pre_sales', 'ACTIVE', NULL,
        1000, NULL, 1000, 1000
      );

    INSERT INTO staff_marketplace_scopes (
      id, staff_id, role_code, marketplace_code, status,
      assigned_by_staff_id, assigned_at, revoked_at, created_at, updated_at
    ) VALUES
      (
        'scope-seller-ops-amazon-jp', 'staff-seller-ops', 'seller_ops',
        'AMAZON_JP', 'ACTIVE', NULL, 1000, NULL, 1000, 1000
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
  dataScope?: CatalogStaffActor['dataScope'];
}): CatalogStaffActor {
  return {
    staffId: input.staffId,
    displayName: input.displayName,
    roles: input.roles,
    permissions: new Set(input.permissions),
    ...(input.dataScope ? { dataScope: input.dataScope } : {}),
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
    dataScope: {
      type: 'ASSIGNED_SELLER_ORGANIZATIONS',
      buyerCustomerIds: [],
      sellerOrganizationIds: ['seller-org-1', 'seller-org-2'],
      teamIds: [],
      marketplaceCodes: ['AMAZON_JP'],
    },
  });
}

function productReviewerActor(): CatalogStaffActor {
  return actor({
    staffId: 'staff-product-reviewer',
    displayName: '产品审核',
    roles: ['seller_ops'],
    permissions: [
      'PRODUCT_REVIEW',
      'DEMAND_PUBLISH',
    ],
    dataScope: {
      type: 'ASSIGNED_SELLER_ORGANIZATIONS',
      buyerCustomerIds: [],
      sellerOrganizationIds: ['seller-org-1', 'seller-org-2'],
      teamIds: [],
      marketplaceCodes: ['AMAZON_JP'],
    },
  });
}

function productVersion(
  productName: string,
) {
  return {
    productName,
    searchKeywords: ['关键词一'],
    orderingGuideExpectedAmountJpy: 1980,
    orderIntervalDays: 1,
    ordersPerRun: 1,
    colorSpecMode: 'MAIN_IMAGE_VARIANT' as const,
    productUrl: 'https://www.amazon.co.jp/product',
    buyerVisibleNotes: '买家可见',
    internalNotes: '内部说明',
  };
}

function seedStaffProductImage(
  database: SqliteDatabase,
  fileObjectId: string,
  now: number,
): void {
  const intentId = `intent-${fileObjectId}`;
  const objectKey = `files/v1/2026/08/${fileObjectId.padEnd(40, 'x')}`;
  database.prepare(`
    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id, purpose, visibility,
      status, requested_file_count, manifest_hash, version,
      expires_at, failure_code, created_at, updated_at, completed_at
    ) VALUES (
      ?, 'STAFF', 'staff-product-reviewer', 'PRODUCT_IMAGE', 'SELLER_VISIBLE',
      'ISSUED', 1, ?, 1, ?, NULL, ?, ?, NULL
    )
  `).bind(intentId, 'a'.repeat(64), now + 10000, now, now).run();
  database.prepare(`
    INSERT INTO file_objects (
      id, upload_intent_id, slot_no, purpose, visibility,
      object_key, client_file_name, extension, declared_mime,
      expected_byte_size, status, upload_token_hash,
      upload_expires_at, uploaded_byte_size, detected_mime,
      uploaded_sha256, failure_code, delete_attempt_count,
      next_delete_at, version, created_at, updated_at,
      uploaded_at, verified_at, deleted_at
    ) VALUES (
      ?, ?, 1, 'PRODUCT_IMAGE', 'SELLER_VISIBLE', ?, 'product.webp',
      'webp', 'image/webp', 100, 'RESERVED', ?, ?, NULL,
      NULL, NULL, NULL, 0, NULL, 1, ?, ?, NULL, NULL, NULL
    )
  `).bind(
    fileObjectId, intentId, objectKey, 'b'.repeat(64),
    now + 10000, now, now,
  ).run();
  database.prepare(`
    UPDATE file_upload_intents
    SET status='VERIFIED', completed_at=?, updated_at=?
    WHERE id=? AND status='ISSUED'
  `).bind(now + 1, now + 1, intentId).run();
  database.prepare(`
    UPDATE file_objects
    SET status='VERIFIED', uploaded_byte_size=100,
        detected_mime='image/webp', uploaded_sha256=?,
        uploaded_at=?, verified_at=?, updated_at=?
    WHERE id=? AND status='RESERVED'
  `).bind(
    'c'.repeat(64), now + 1, now + 1, now + 1, fileObjectId,
  ).run();
}
