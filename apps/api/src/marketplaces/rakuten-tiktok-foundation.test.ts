import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { resolveMarketplace } from './registry';

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('Rakuten and TikTok Japan marketplace foundation', () => {
  it('registers JP/JPY marketplaces with honest unavailable adapters', async () => {
    database = createMigratedTestDatabase();
    await expect(resolveMarketplace(database, 'RAKUTEN_JP', {
      requireActive: true,
    })).resolves.toMatchObject({
      code: 'RAKUTEN_JP',
      platform_code: 'RAKUTEN',
      region_code: 'JP',
      transaction_currency_code: 'JPY',
      adapter_status: 'UNAVAILABLE',
      display_name_zh: '乐天日本站',
    });
    await expect(resolveMarketplace(database, 'TIKTOK_JP', {
      requireActive: true,
    })).resolves.toMatchObject({
      code: 'TIKTOK_JP',
      platform_code: 'TIKTOK',
      transaction_currency_code: 'JPY',
      adapter_status: 'UNAVAILABLE',
      display_name_zh: 'TikTok 日本站',
    });
    await expect(resolveMarketplace(database, 'TIKTOK_JP', {
      requireActive: true, requireAdapter: true,
    })).rejects.toMatchObject({
      code: 'MARKETPLACE_ADAPTER_UNAVAILABLE',
    });
    await expect(database.prepare(`
      SELECT COUNT(*) AS count FROM marketplace_registry
    `).first()).resolves.toEqual({ count: 5 });
  });

  it('scopes equal order and product identifiers by marketplace', async () => {
    database = createMigratedTestDatabase();
    database.exec(`
      INSERT INTO platform_product_identities (
        id, marketplace_code, platform_product_identifier, status,
        created_at, updated_at
      ) VALUES
        ('product-rakuten-identity-1', 'RAKUTEN_JP', 'shared-product', 'ACTIVE', 1, 1),
        ('product-tiktok-identity-1', 'TIKTOK_JP', 'shared-product', 'ACTIVE', 1, 1);
      INSERT INTO platform_order_identities (
        id, marketplace_code, platform_order_identifier,
        platform_product_identity_id, status, created_at, updated_at
      ) VALUES
        ('order-rakuten-identity-1', 'RAKUTEN_JP', 'shared-order', 'product-rakuten-identity-1', 'ACTIVE', 1, 1),
        ('order-tiktok-identity-1', 'TIKTOK_JP', 'shared-order', 'product-tiktok-identity-1', 'ACTIVE', 1, 1);
    `);
    await expect(database.prepare(`
      SELECT COUNT(*) AS count FROM platform_product_identities
      WHERE platform_product_identifier='shared-product'
    `).first()).resolves.toEqual({ count: 2 });
    await expect(database.prepare(`
      SELECT COUNT(*) AS count FROM platform_order_identities
      WHERE platform_order_identifier='shared-order'
    `).first()).resolves.toEqual({ count: 2 });
    expect(() => database!.exec(`
      INSERT INTO platform_product_identities (
        id, marketplace_code, platform_product_identifier, status,
        created_at, updated_at
      ) VALUES ('product-rakuten-2', 'RAKUTEN_JP', 'shared-product', 'ACTIVE', 1, 1)
    `)).toThrow(/UNIQUE/u);
  });

  it('guards organization/store scope and keeps identity facts immutable', async () => {
    database = createMigratedTestDatabase();
    database.exec(`
      INSERT INTO seller_organizations (
        id, marketplace_code, seller_code, origin_channel_id,
        current_channel_id, seller_sequence, organization_name, status,
        version, created_at, updated_at, activated_at, disabled_at,
        next_member_number
      ) VALUES (
        'seller-org-platform-test','JP','ido-mango-900101',
        'seller-channel-ido-mango','seller-channel-ido-mango',900101,
        '平台身份测试卖家','ACTIVE',1,1,1,1,NULL,2
      );
      INSERT INTO seller_stores (
        id, organization_id, marketplace_code, display_name,
        normalized_name, status, version, created_at, updated_at, disabled_at
      ) VALUES (
        'store-platform-test','seller-org-platform-test','JP','乐天测试店','乐天测试店',
        'ACTIVE',1,1,1,NULL
      );
      UPDATE seller_store_marketplaces
      SET marketplace_code='RAKUTEN_JP'
      WHERE store_id='store-platform-test';
    `);
    database.exec(`
      INSERT INTO platform_product_identities (
        id, marketplace_code, platform_product_identifier,
        seller_organization_id, seller_store_id, status, created_at, updated_at
      ) VALUES (
        'product-platform-test','RAKUTEN_JP','tiktokDLP2555Q',
        'seller-org-platform-test','store-platform-test','ACTIVE',1,1
      );
      INSERT INTO platform_identity_events (
        id, entity_type, entity_id, event_type, actor_type, actor_id, created_at
      ) VALUES (
        'platform-event-test','PRODUCT','product-platform-test',
        'CREATED','IMPORT','local-fixture',1
      );
    `);
    expect(() => database!.exec(`
      UPDATE platform_product_identities
      SET platform_product_identifier='changed'
      WHERE id='product-platform-test'
    `)).toThrow('platform_product_identity_key_is_immutable');
    expect(() => database!.exec(`
      DELETE FROM platform_product_identities WHERE id='product-platform-test'
    `)).toThrow('platform_product_identities_are_immutable');
    expect(() => database!.exec(`
      INSERT INTO platform_product_identities (
        id, marketplace_code, platform_product_identifier,
        seller_organization_id, seller_store_id, status, created_at, updated_at
      ) VALUES (
        'product-platform-bad','TIKTOK_JP','bad-scope',
        'seller-org-platform-test','store-platform-test','ACTIVE',1,1
      )
    `)).toThrow('platform_product_identity_scope_mismatch');
  });

  it('requires null-safe exact order and product scope', () => {
    database = createMigratedTestDatabase();
    seedScopedStores(database);
    database.exec(`
      INSERT INTO platform_product_identities (
        id, marketplace_code, platform_product_identifier,
        seller_organization_id, seller_store_id, status, created_at, updated_at
      ) VALUES
        ('product-scope-a-one','RAKUTEN_JP','product-a-one',
          'seller-org-scope-a','store-scope-a-one','ACTIVE',1,1),
        ('product-scope-a-two','RAKUTEN_JP','product-a-two',
          'seller-org-scope-a','store-scope-a-two','ACTIVE',1,1),
        ('product-scope-b-one','RAKUTEN_JP','product-b-one',
          'seller-org-scope-b','store-scope-b-one','ACTIVE',1,1),
        ('product-scope-global','RAKUTEN_JP','product-global',
          NULL,NULL,'ACTIVE',1,1);
      INSERT INTO platform_order_identities (
        id, marketplace_code, platform_order_identifier,
        platform_product_identity_id, seller_organization_id,
        seller_store_id, status, created_at, updated_at
      ) VALUES (
        'order-scope-valid-a','RAKUTEN_JP','order-valid-a',
        'product-scope-a-one','seller-org-scope-a','store-scope-a-one',
        'ACTIVE',1,1
      );
    `);
    for (const statement of [
      `INSERT INTO platform_order_identities (
        id, marketplace_code, platform_order_identifier,
        platform_product_identity_id, seller_organization_id,
        seller_store_id, status, created_at, updated_at
      ) VALUES ('order-cross-store','RAKUTEN_JP','order-cross-store',
        'product-scope-a-two','seller-org-scope-a','store-scope-a-one',
        'ACTIVE',1,1)`,
      `INSERT INTO platform_order_identities (
        id, marketplace_code, platform_order_identifier,
        platform_product_identity_id, seller_organization_id,
        seller_store_id, status, created_at, updated_at
      ) VALUES ('order-cross-org','RAKUTEN_JP','order-cross-org',
        'product-scope-b-one','seller-org-scope-a','store-scope-a-one',
        'ACTIVE',1,1)`,
      `INSERT INTO platform_order_identities (
        id, marketplace_code, platform_order_identifier,
        platform_product_identity_id, seller_organization_id,
        seller_store_id, status, created_at, updated_at
      ) VALUES ('order-scoped-global','RAKUTEN_JP','order-scoped-global',
        'product-scope-global','seller-org-scope-a','store-scope-a-one',
        'ACTIVE',1,1)`,
      `INSERT INTO platform_order_identities (
        id, marketplace_code, platform_order_identifier,
        platform_product_identity_id, status, created_at, updated_at
      ) VALUES ('order-unscoped-scoped','RAKUTEN_JP','order-unscoped-scoped',
        'product-scope-a-one','ACTIVE',1,1)`,
    ]) {
      expect(() => database!.exec(statement))
        .toThrow('platform_order_identity_product_scope_mismatch');
    }
  });

  it('freezes the legacy registry compatibility parent', async () => {
    database = createMigratedTestDatabase();
    expect(() => database!.exec(`
      UPDATE marketplace_registry_legacy_0029
      SET display_name_zh='漂移' WHERE code='AMAZON_JP'
    `)).toThrow('marketplace_registry_legacy_0029_is_frozen');
    expect(() => database!.exec(`
      DELETE FROM marketplace_registry_legacy_0029 WHERE code='AMAZON_US'
    `)).toThrow('marketplace_registry_legacy_0029_is_frozen');
    expect(() => database!.exec(`
      INSERT INTO marketplace_registry_legacy_0029
      SELECT * FROM marketplace_registry_legacy_0029 WHERE code='AMAZON_JP'
    `)).toThrow('marketplace_registry_legacy_0029_is_frozen');
    await expect(database.prepare(`
      SELECT COUNT(*) AS count FROM marketplace_registry_legacy_0029
    `).first()).resolves.toEqual({ count: 3 });
    await expect(resolveMarketplace(database, 'RAKUTEN_JP'))
      .resolves.toMatchObject({ code: 'RAKUTEN_JP' });
  });
});

function seedScopedStores(db: SqliteDatabase): void {
  db.exec(`
    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code, origin_channel_id,
      current_channel_id, seller_sequence, organization_name, status,
      version, created_at, updated_at, activated_at, disabled_at,
      next_member_number
    ) VALUES
      ('seller-org-scope-a','JP','ido-mango-900111',
        'seller-channel-ido-mango','seller-channel-ido-mango',900111,
        'Scope A','ACTIVE',1,1,1,1,NULL,2),
      ('seller-org-scope-b','JP','ido-mango-900112',
        'seller-channel-ido-mango','seller-channel-ido-mango',900112,
        'Scope B','ACTIVE',1,1,1,1,NULL,2);
    INSERT INTO seller_stores (
      id, organization_id, marketplace_code, display_name,
      normalized_name, status, version, created_at, updated_at, disabled_at
    ) VALUES
      ('store-scope-a-one','seller-org-scope-a','JP','A1','a1','ACTIVE',1,1,1,NULL),
      ('store-scope-a-two','seller-org-scope-a','JP','A2','a2','ACTIVE',1,1,1,NULL),
      ('store-scope-b-one','seller-org-scope-b','JP','B1','b1','ACTIVE',1,1,1,NULL);
    UPDATE seller_store_marketplaces SET marketplace_code='RAKUTEN_JP'
    WHERE store_id IN ('store-scope-a-one','store-scope-a-two','store-scope-b-one');
  `);
}
