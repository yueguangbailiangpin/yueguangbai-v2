import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import type { SellerPortalActor } from '../seller-portal/actor';
import {
  getSellerFormalOrder,
  listSellerFormalOrders,
} from './read-model';

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('non-Amazon Seller formal-order projection', () => {
  it('reads a scoped Rakuten formal record without Amazon legacy values', async () => {
    database = createMigratedTestDatabase();
    seedPlatformFormalOrder(database);
    const page = await listSellerFormalOrders(
      database,
      actor('seller-org-platform-read', ['store-platform-read']),
      { cursor: null, limit: 20 },
      {
        store_id: null,
        marketplace_code: 'RAKUTEN_JP',
        asin: null,
        product_name: null,
        review_type: null,
        confirmed_business_date: null,
        formal_order_id: null,
        amazon_order_number: null,
      },
    );
    expect(page.items).toEqual([{
      formal_order_id: 'platform-formal-order-read',
      status: 'CONFIRMED',
      legacy_projection: 'NONE',
      marketplace_code: null,
      canonical_marketplace_code: 'RAKUTEN_JP',
      amazon_order_number: null,
      platform_order_identifier: '123456-20260810-0000000001',
      store: { id: 'store-platform-read', display_name: '乐天正式承载店' },
      asin: null,
      platform_product_identifier: 'rakuten-product-read',
      product_name: '乐天正式承载产品',
      product_version: null,
      review_type: null,
      final_paid_jpy: null,
      payment: null,
      seller_expected_principal_cny_fen: null,
      seller_principal_rate_snapshot: null,
      seller_agreement_rate_snapshot: null,
      locked_service_fee_snapshot: null,
      business_completion: null,
      chat_screenshot: { status: 'NONE', file_version: null },
      confirmed_at: 1_000,
      confirmed_business_date: null,
    }]);
  });

  it('conceals platform formal records across organization and store scope', async () => {
    database = createMigratedTestDatabase();
    seedPlatformFormalOrder(database);
    await expect(getSellerFormalOrder(
      database,
      actor('seller-org-other', ['store-platform-read']),
      'platform-formal-order-read',
    )).rejects.toMatchObject({ code: 'FORMAL_ORDER_NOT_FOUND', status: 404 });
    const page = await listSellerFormalOrders(
      database,
      actor('seller-org-platform-read', []),
      { cursor: null, limit: 20 },
      {
        store_id: null, marketplace_code: null, asin: null,
        product_name: null, review_type: null,
        confirmed_business_date: null, formal_order_id: null,
        amazon_order_number: null,
      },
    );
    expect(page.items).toEqual([]);
  });

  it('guards formal evidence scope/type and keeps carrier facts immutable', () => {
    database = createMigratedTestDatabase();
    seedPlatformFormalOrder(database);
    expect(() => database!.exec(`
      INSERT INTO platform_order_evidence_records (
        id, platform_order_identity_id, platform_product_identity_id,
        marketplace_code, evidence_type, status, created_at, updated_at
      ) VALUES (
        'platform-evidence-unscoped','platform-order-read',
        'platform-product-read','RAKUTEN_JP','ORDER_FACT','VERIFIED',1,1
      )
    `)).toThrow('platform_order_evidence_scope_mismatch');
    expect(() => database!.exec(`
      UPDATE platform_order_evidence_records SET status='REJECTED'
      WHERE id='platform-evidence-read'
    `)).toThrow('platform_order_evidence_records_are_immutable');
    expect(() => database!.exec(`
      DELETE FROM platform_formal_orders WHERE id='platform-formal-order-read'
    `)).toThrow('platform_formal_orders_are_immutable');
    database.exec(`
      INSERT INTO platform_order_identities (
        id, marketplace_code, platform_order_identifier,
        platform_product_identity_id, seller_organization_id,
        seller_store_id, status, created_at, updated_at
      ) VALUES (
        'platform-order-read-two','RAKUTEN_JP',
        '123456-20260810-0000000002','platform-product-read',
        'seller-org-platform-read','store-platform-read','ACTIVE',1,1
      );
      INSERT INTO platform_order_evidence_records (
        id, platform_order_identity_id, platform_product_identity_id,
        marketplace_code, seller_organization_id, seller_store_id,
        evidence_type, status, created_at, updated_at
      ) VALUES (
        'platform-evidence-chat','platform-order-read-two',
        'platform-product-read','RAKUTEN_JP','seller-org-platform-read',
        'store-platform-read','ORDER_EVIDENCE_INTERNAL_COMMUNICATION',
        'VERIFIED',1,1
      );
    `);
    expect(() => database!.exec(`
      INSERT INTO platform_formal_orders (
        id, order_evidence_record_id, platform_order_identity_id,
        platform_product_identity_id, marketplace_code,
        seller_organization_id, seller_store_id, product_name_snapshot,
        status, confirmed_at, created_at
      ) VALUES (
        'platform-formal-order-bad','platform-evidence-chat',
        'platform-order-read-two','platform-product-read','RAKUTEN_JP',
        'seller-org-platform-read','store-platform-read','错误证据类型',
        'CONFIRMED',1001,1001
      )
    `)).toThrow('platform_formal_order_source_mismatch');
  });
});

function seedPlatformFormalOrder(db: SqliteDatabase): void {
  db.exec(`
    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code, origin_channel_id,
      current_channel_id, seller_sequence, organization_name, status,
      version, created_at, updated_at, activated_at, disabled_at,
      next_member_number
    ) VALUES (
      'seller-org-platform-read','JP','ido-mango-900121',
      'seller-channel-ido-mango','seller-channel-ido-mango',900121,
      '平台正式承载卖家','ACTIVE',1,1,1,1,NULL,2
    );
    INSERT INTO seller_stores (
      id, organization_id, marketplace_code, display_name,
      normalized_name, status, version, created_at, updated_at, disabled_at
    ) VALUES (
      'store-platform-read','seller-org-platform-read','JP',
      '乐天正式承载店','乐天正式承载店','ACTIVE',1,1,1,NULL
    );
    UPDATE seller_store_marketplaces SET marketplace_code='RAKUTEN_JP'
    WHERE store_id='store-platform-read';
    INSERT INTO platform_product_identities (
      id, marketplace_code, platform_product_identifier,
      seller_organization_id, seller_store_id, display_name,
      status, created_at, updated_at
    ) VALUES (
      'platform-product-read','RAKUTEN_JP','rakuten-product-read',
      'seller-org-platform-read','store-platform-read','乐天正式承载产品',
      'ACTIVE',1,1
    );
    INSERT INTO platform_order_identities (
      id, marketplace_code, platform_order_identifier,
      platform_product_identity_id, seller_organization_id,
      seller_store_id, platform_order_date, status, created_at, updated_at
    ) VALUES (
      'platform-order-read','RAKUTEN_JP','123456-20260810-0000000001',
      'platform-product-read','seller-org-platform-read','store-platform-read',
      '2026-08-10','ACTIVE',1,1
    );
    INSERT INTO platform_order_evidence_records (
      id, platform_order_identity_id, platform_product_identity_id,
      marketplace_code, seller_organization_id, seller_store_id,
      evidence_type, status, created_at, updated_at
    ) VALUES (
      'platform-evidence-read','platform-order-read','platform-product-read',
      'RAKUTEN_JP','seller-org-platform-read','store-platform-read',
      'ORDER_FACT','VERIFIED',1,1
    );
    INSERT INTO platform_formal_orders (
      id, order_evidence_record_id, platform_order_identity_id,
      platform_product_identity_id, marketplace_code,
      seller_organization_id, seller_store_id, product_name_snapshot,
      review_type, status, confirmed_at, confirmed_business_date, created_at
    ) VALUES (
      'platform-formal-order-read','platform-evidence-read',
      'platform-order-read','platform-product-read','RAKUTEN_JP',
      'seller-org-platform-read','store-platform-read','乐天正式承载产品',
      NULL,'CONFIRMED',1000,NULL,1000
    );
  `);
}

function actor(
  sellerOrganizationId: string,
  storeIds: readonly string[],
): SellerPortalActor {
  return {
    accountId: 'account-platform-read',
    identitySubjectId: 'subject-platform-read',
    memberId: 'member-platform-read',
    sellerOrganizationId,
    role: 'VIEWER',
    storeIds,
    allActiveStores: false,
    canManageProducts: false,
    me: {
      account_id: 'account-platform-read',
      member: {
        id: 'member-platform-read', display_name: '读取成员',
        role: 'VIEWER', primary_owner: false,
      },
      organization: {
        id: sellerOrganizationId, seller_code: 'fixture',
        name: 'fixture', marketplace_code: 'JP', status: 'ACTIVE',
      },
      access: {
        read_scope: 'ASSIGNED_STORES', store_ids: storeIds,
        can_submit_product_applications: false,
        can_submit_demand_batches: false,
      },
    },
  };
}
