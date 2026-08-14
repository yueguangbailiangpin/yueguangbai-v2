import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import type {
  FileAuthorizationService,
} from '../files/authorization';
import { authorizeExplicitAudienceRead } from '../files/file-audience-authorization';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import { addProductVersion } from './add-product-version';
import { createApprovedProduct } from './create-product';
import { createSellerStore } from './create-store';
import {
  linkProductVersionMainImage,
} from './link-product-version-main-image';
import type { CatalogStaffActor } from './catalog-shared';

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

class AllowFileAuthorization implements FileAuthorizationService {
  assertCanCreateUpload(): void {}
  assertCanUpload(): void {}
  assertCanCompleteUpload(): void {}
  assertCanLink(): void {}
  assertCanRead(): void {}
}

describe('Phase 3E2 product ordering profiles', () => {
  it('creates immutable profile versions and preserves keyword sequence', async () => {
    database = createMigratedTestDatabase();
    seed(database);
    const store = await createSellerStore(database, {
      sellerOrganizationId: 'seller-org-profile',
      marketplaceCode: 'JP',
      storeName: '资料店铺',
    }, {
      actor: productActor(),
      idempotencyKey: 'profile-store-create-0001',
      now: 2000,
    });

    const product = await createApprovedProduct(database, {
      storeId: store.store_id,
      asin: 'B0PROF0001',
      version: versionFields('资料版本一', 1980, 'MAIN_IMAGE_VARIANT'),
    }, {
      actor: productActor(),
      idempotencyKey: 'profile-product-create-0001',
      now: 2100,
    });
    expect(product.product_version).toMatchObject({
      orderingGuideExpectedAmountJpy: 1980,
      colorSpecMode: 'MAIN_IMAGE_VARIANT',
      searchKeywords: ['关键词一', '关键词一', '关键词二'],
    });

    const second = await addProductVersion(database, {
      productId: product.product_id,
      expectedVersion: 1,
      version: versionFields('资料版本二', 2080, 'ANY_VARIANT'),
    }, {
      actor: productActor(),
      idempotencyKey: 'profile-product-version-0001',
      now: 2200,
    });
    expect(second).toMatchObject({
      version_no: 2,
      aggregate_version: 2,
      product_version: {
        orderingGuideExpectedAmountJpy: 2080,
        colorSpecMode: 'ANY_VARIANT',
      },
    });

    const rows = await database.prepare(`
      SELECT
        version_no,
        search_keywords_json,
        ordering_guide_expected_amount_jpy,
        color_spec_mode
      FROM product_versions
      WHERE product_id=?
      ORDER BY version_no
    `).bind(product.product_id).all<{
      version_no: number;
      search_keywords_json: string;
      ordering_guide_expected_amount_jpy: number;
      color_spec_mode: string;
    }>();
    expect(rows.results).toEqual([
      {
        version_no: 1,
        search_keywords_json: '["关键词一","关键词一","关键词二"]',
        ordering_guide_expected_amount_jpy: 1980,
        color_spec_mode: 'MAIN_IMAGE_VARIANT',
      },
      {
        version_no: 2,
        search_keywords_json: '["关键词一","关键词一","关键词二"]',
        ordering_guide_expected_amount_jpy: 2080,
        color_spec_mode: 'ANY_VARIANT',
      },
    ]);

    await expect(database.prepare(`
      UPDATE product_versions
      SET ordering_guide_expected_amount_jpy=9999
      WHERE id=?
    `).bind(second.product_version_id).run()).rejects.toThrow(
      'product_versions_are_immutable',
    );
    await expect(database.prepare(`
      DELETE FROM product_versions WHERE id=?
    `).bind(second.product_version_id).run()).rejects.toThrow(
      'product_versions_are_immutable',
    );
  });

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '1980',
  ])('rejects invalid create amount %p', async (amount) => {
    database = createMigratedTestDatabase();
    seed(database);
    const store = await createSellerStore(database, {
      sellerOrganizationId: 'seller-org-profile',
      marketplaceCode: 'JP',
      storeName: `非法金额店铺-${String(amount)}`,
    }, {
      actor: productActor(),
      idempotencyKey: `profile-invalid-store-${String(amount)}`,
      now: 2000,
    });
    await expect(createApprovedProduct(database, {
      storeId: store.store_id,
      asin: 'B0AMT00001',
      version: {
        ...versionFields('非法金额', 1980, 'ANY_VARIANT'),
        orderingGuideExpectedAmountJpy: amount,
      } as never,
    }, {
      actor: productActor(),
      idempotencyKey: `profile-invalid-amount-${String(amount)}`,
      now: 2100,
    })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
  });

  it('links exactly one verified PRODUCT_IMAGE to one product version', async () => {
    database = createMigratedTestDatabase();
    seed(database);
    const store = await createSellerStore(database, {
      sellerOrganizationId: 'seller-org-profile',
      marketplaceCode: 'JP',
      storeName: '主图店铺',
    }, {
      actor: productActor(),
      idempotencyKey: 'profile-image-store-0001',
      now: 2000,
    });
    const product = await createApprovedProduct(database, {
      storeId: store.store_id,
      asin: 'B0IMAGE001',
      version: versionFields('主图产品', 2980, 'MAIN_IMAGE_VARIANT'),
    }, {
      actor: productActor(),
      idempotencyKey: 'profile-image-product-0001',
      now: 2100,
    });
    seedVerifiedFile(database, 'file-product-image-1', 'PRODUCT_IMAGE', 2200);

    const linked = await linkProductVersionMainImage(
      database,
      new AllowFileAuthorization(),
      {
        productVersionId: product.product_version_id,
        fileObjectId: 'file-product-image-1',
        expectedFileVersion: 1,
      },
      {
        actor: productActor(),
        idempotencyKey: 'profile-image-link-0001',
        now: 2300,
      },
    );
    expect(linked).toMatchObject({
      product_version_id: product.product_version_id,
      file_object_id: 'file-product-image-1',
      authorization_mode: 'EXPLICIT_AUDIENCES',
      replayed: false,
    });
    expect(JSON.stringify(linked)).not.toMatch(
      /object_key|public_url|signed_url|https?:\/\//u,
    );

    const replay = await linkProductVersionMainImage(
      database,
      new AllowFileAuthorization(),
      {
        productVersionId: product.product_version_id,
        fileObjectId: 'file-product-image-1',
        expectedFileVersion: 1,
      },
      {
        actor: productActor(),
        idempotencyKey: 'profile-image-link-0001',
        now: 2350,
      },
    );
    expect(replay).toEqual({ ...linked, replayed: true });

    const relation = await database.prepare(`
      SELECT image.*, link.purpose, link.entity_type, link.entity_id,
             link.authorization_mode
      FROM product_version_main_images image
      JOIN file_entity_links link ON link.id=image.file_entity_link_id
      WHERE image.product_version_id=?
    `).bind(product.product_version_id).first<Record<string, unknown>>();
    expect(relation).toMatchObject({
      purpose: 'PRODUCT_IMAGE',
      entity_type: 'PRODUCT_VERSION',
      entity_id: product.product_version_id,
      authorization_mode: 'EXPLICIT_AUDIENCES',
    });

    const grants = await database.prepare(`
      SELECT
        subject_type,
        seller_organization_id,
        staff_permission_code,
        staff_scope_type,
        staff_team_id,
        buyer_customer_id,
        revoked_at,
        expires_at
      FROM file_entity_audience_grants
      WHERE file_entity_link_id=?
      ORDER BY subject_type
    `).bind(linked.file_entity_link_id).all<Record<string, unknown>>();
    expect(grants.results).toEqual([
      {
        subject_type: 'SELLER_ORGANIZATION',
        seller_organization_id: 'seller-org-profile',
        staff_permission_code: null,
        staff_scope_type: null,
        staff_team_id: null,
        buyer_customer_id: null,
        revoked_at: null,
        expires_at: null,
      },
      {
        subject_type: 'STAFF_INTERNAL',
        seller_organization_id: null,
        staff_permission_code: 'PRODUCT_VIEW',
        staff_scope_type: 'GLOBAL',
        staff_team_id: null,
        buyer_customer_id: null,
        revoked_at: null,
        expires_at: null,
      },
    ]);

    const imageResource = {
      uploadIntentId: `intent-file-product-image-1`,
      fileObjectId: 'file-product-image-1',
      ownerActorType: 'STAFF',
      ownerActorId: 'staff-product-profile',
      purpose: 'PRODUCT_IMAGE',
      visibility: 'SELLER_VISIBLE',
      entityType: 'PRODUCT_VERSION',
      entityId: product.product_version_id,
      fileEntityLinkId: linked.file_entity_link_id,
      linkAuthorizationMode: 'EXPLICIT_AUDIENCES',
      linkExpiresAt: null,
      linkRevokedAt: null,
    } as const;
    await expect(authorizeExplicitAudienceRead(
      database,
      { type: 'STAFF_SESSION', staffId: 'staff-product-profile' },
      {
        type: 'STAFF',
        id: 'staff-product-profile',
        roles: ['seller_ops'],
      },
      imageResource,
      2350,
    )).resolves.toBeUndefined();

    database.prepare(`
      INSERT INTO staff_permission_overrides (
        staff_id, permission_code, effect, reason,
        status, assigned_by_staff_id, assigned_at, revoked_at,
        created_at, updated_at
      ) VALUES (
        'staff-product-profile-denied', 'PRODUCT_VIEW', 'DENY',
        'product image read denial', 'ACTIVE', NULL, 2350, NULL, 2350, 2350
      )
    `).run();
    await expect(authorizeExplicitAudienceRead(
      database,
      { type: 'STAFF_SESSION', staffId: 'staff-product-profile-denied' },
      {
        type: 'STAFF',
        id: 'staff-product-profile-denied',
        roles: ['seller_ops'],
      },
      imageResource,
      2350,
    )).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    const staffGrant = await database.prepare(`
      SELECT id
      FROM file_entity_audience_grants
      WHERE file_entity_link_id=? AND subject_type='STAFF_INTERNAL'
    `).bind(linked.file_entity_link_id).first<{ id: string }>();
    if (!staffGrant) throw new Error('missing_staff_product_image_grant');
    database.prepare(`
      UPDATE file_entity_audience_grants
      SET revoked_at=2400
      WHERE id=?
    `).bind(staffGrant.id).run();
    await expect(authorizeExplicitAudienceRead(
      database,
      { type: 'STAFF_SESSION', staffId: 'staff-product-profile' },
      {
        type: 'STAFF',
        id: 'staff-product-profile',
        roles: ['seller_ops'],
      },
      imageResource,
      2401,
    )).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    seedVerifiedFile(database, 'file-product-image-2', 'PRODUCT_IMAGE', 2400);
    await expect(linkProductVersionMainImage(
      database,
      new AllowFileAuthorization(),
      {
        productVersionId: product.product_version_id,
        fileObjectId: 'file-product-image-2',
        expectedFileVersion: 1,
      },
      {
        actor: productActor(),
        idempotencyKey: 'profile-image-link-0002',
        now: 2500,
      },
    )).rejects.toMatchObject({ status: 409 });

    await expect(database.prepare(`
      UPDATE product_version_main_images
      SET created_at=created_at+1
      WHERE product_version_id=?
    `).bind(product.product_version_id).run()).rejects.toThrow(
      'product_version_main_images_are_immutable',
    );
    await expect(database.prepare(`
      DELETE FROM product_version_main_images
      WHERE product_version_id=?
    `).bind(product.product_version_id).run()).rejects.toThrow(
      'product_version_main_images_are_immutable',
    );
  });

  it('rejects wrong purpose, unverified files, and resolved permission denial', async () => {
    database = createMigratedTestDatabase();
    seed(database);
    const store = await createSellerStore(database, {
      sellerOrganizationId: 'seller-org-profile',
      marketplaceCode: 'JP',
      storeName: '主图拒绝店铺',
    }, {
      actor: productActor(),
      idempotencyKey: 'profile-image-reject-store-0001',
      now: 3000,
    });
    const product = await createApprovedProduct(database, {
      storeId: store.store_id,
      asin: 'B0IMAGE002',
      version: versionFields('主图拒绝产品', 1880, 'ANY_VARIANT'),
    }, {
      actor: productActor(),
      idempotencyKey: 'profile-image-reject-product-0001',
      now: 3100,
    });

    seedFile(database, 'file-wrong-purpose', 'ORDER_EVIDENCE', 3200, true);
    await expect(linkProductVersionMainImage(
      database, new AllowFileAuthorization(), {
        productVersionId: product.product_version_id,
        fileObjectId: 'file-wrong-purpose',
        expectedFileVersion: 1,
      }, {
        actor: productActor(),
        idempotencyKey: 'profile-image-wrong-purpose-0001',
        now: 3300,
      },
    )).rejects.toMatchObject({ status: 409 });

    seedFile(database, 'file-unverified-image', 'PRODUCT_IMAGE', 3400, false);
    await expect(linkProductVersionMainImage(
      database, new AllowFileAuthorization(), {
        productVersionId: product.product_version_id,
        fileObjectId: 'file-unverified-image',
        expectedFileVersion: 1,
      }, {
        actor: productActor(),
        idempotencyKey: 'profile-image-unverified-0001',
        now: 3500,
      },
    )).rejects.toMatchObject({ status: 409 });

    await expect(linkProductVersionMainImage(
      database, new AllowFileAuthorization(), {
        productVersionId: product.product_version_id,
        fileObjectId: 'file-unverified-image',
        expectedFileVersion: 1,
      }, {
        actor: {
          ...productActor(),
          permissions: new Set(['PRODUCT_VIEW']),
        } as CatalogStaffActor,
        idempotencyKey: 'profile-image-denied-0001',
        now: 3600,
      },
    )).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('keeps formal-order code independent from current ordering profile fields', () => {
    const root = path.resolve(import.meta.dirname, '../../../..');
    for (const relative of [
      'apps/api/src/order-evidence/approve-order-evidence.ts',
      'apps/api/src/buyer-formal-orders/read-model.ts',
      'apps/api/src/seller-formal-orders/read-model.ts',
    ]) {
      const source = readFileSync(path.join(root, relative), 'utf8');
      expect(source).not.toContain('ordering_guide_expected_amount_jpy');
      expect(source).not.toContain('color_spec_mode');
    }
  });
});

function versionFields(
  productName: string,
  amount: number,
  colorSpecMode: 'MAIN_IMAGE_VARIANT' | 'ANY_VARIANT',
) {
  return {
    productName,
    searchKeywords: ['关键词一', '关键词一', '关键词二'],
    orderingGuideExpectedAmountJpy: amount,
    orderIntervalDays: 1,
    ordersPerRun: 1,
    colorSpecMode,
    productUrl: 'https://www.amazon.co.jp/product#fragment',
    buyerVisibleNotes: '买家可见',
    internalNotes: '内部说明',
  };
}

function productActor(): CatalogStaffActor {
  return {
    staffId: 'staff-product-profile',
    displayName: '产品资料员工',
    roles: ['seller_ops'],
    permissions: new Set([
      'SELLER_MANAGE',
      'PRODUCT_VIEW',
      'PRODUCT_REVIEW',
      'DEMAND_PUBLISH',
    ]),
    dataScope: {
      type: 'ASSIGNED_SELLER_ORGANIZATIONS',
      buyerCustomerIds: [],
      sellerOrganizationIds: ['seller-org-profile'],
      teamIds: [],
      marketplaceCodes: ['AMAZON_JP'],
    },
  };
}

function seed(database: SqliteDatabase): void {
  database.exec(`
    INSERT INTO staff_users (
      id, display_name, status, authorization_version,
      version, created_at, updated_at, disabled_at
    ) VALUES
      ('staff-product-profile', '产品资料员工', 'ACTIVE', 1,
       1, 1000, 1000, NULL),
      ('staff-product-profile-denied', '被拒绝的产品资料员工', 'ACTIVE', 1,
       1, 1000, 1000, NULL);
    INSERT INTO staff_role_assignments (
      staff_id, role_code, status, assigned_by_staff_id,
      assigned_at, revoked_at, created_at, updated_at
    ) VALUES
      ('staff-product-profile', 'seller_ops', 'ACTIVE', NULL,
       1000, NULL, 1000, 1000),
      ('staff-product-profile-denied', 'seller_ops', 'ACTIVE', NULL,
       1000, NULL, 1000, 1000);
    INSERT INTO staff_marketplace_scopes (
      id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,
      assigned_at,revoked_at,reason,created_at,updated_at,scope_kind
    ) VALUES
      ('scope-product-profile-jp','staff-product-profile','seller_ops',
       'AMAZON_JP','ACTIVE','zz-phase3h-test-owner',1000,NULL,
       'TEST_PRIMARY',1000,1000,'PRIMARY'),
      ('scope-product-denied-jp','staff-product-profile-denied','seller_ops',
       'AMAZON_JP','ACTIVE','zz-phase3h-test-owner',1000,NULL,
       'TEST_SUPPORT',1000,1000,'SUPPORT');
    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code,
      origin_channel_id, current_channel_id, seller_sequence,
      organization_name, status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES (
      'seller-org-profile', 'JP', 'ido-profile-1001',
      'seller-channel-ido-mango', 'seller-channel-ido-mango', 1001,
      '资料测试卖家', 'ACTIVE', 1,
      1000, 1000, 1000, NULL
    );
  `);
}

function seedVerifiedFile(
  database: SqliteDatabase,
  fileObjectId: string,
  purpose: 'PRODUCT_IMAGE' | 'ORDER_EVIDENCE',
  now: number,
): void {
  seedFile(database, fileObjectId, purpose, now, true);
}

function seedFile(
  database: SqliteDatabase,
  fileObjectId: string,
  purpose: 'PRODUCT_IMAGE' | 'ORDER_EVIDENCE',
  now: number,
  verified: boolean,
): void {
  const intentId = `intent-${fileObjectId}`;
  const objectKey = `files/v1/2026/08/${fileObjectId.padEnd(40, 'x')}`;
  database.prepare(`
    INSERT INTO file_upload_intents (
      id, owner_actor_type, owner_actor_id, purpose, visibility,
      status, requested_file_count, manifest_hash, version,
      expires_at, failure_code, created_at, updated_at, completed_at
    ) VALUES (
      ?, 'STAFF', 'staff-product-profile', ?, 'SELLER_VISIBLE',
      'ISSUED', 1, ?, 1, ?, NULL, ?, ?, NULL
    )
  `).bind(
    intentId,
    purpose,
    'a'.repeat(64),
    now + 10000,
    now,
    now,
  ).run();
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
      ?, ?, 1, ?, 'SELLER_VISIBLE', ?, 'product.webp',
      'webp', 'image/webp', 100, 'RESERVED', ?, ?, NULL,
      NULL, NULL, NULL, 0, NULL, 1, ?, ?, NULL, NULL, NULL
    )
  `).bind(
    fileObjectId,
    intentId,
    purpose,
    objectKey,
    'b'.repeat(64),
    now + 10000,
    now,
    now,
  ).run();
  if (verified) {
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
      'c'.repeat(64),
      now + 1,
      now + 1,
      now + 1,
      fileObjectId,
    ).run();
  }
}
