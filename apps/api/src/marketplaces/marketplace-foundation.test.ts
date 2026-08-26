import { afterEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import { createSellerStore } from '../catalog/create-store';
import { createApp } from '../app';
import { correctBuyerMarketplace } from './correct-buyer-marketplace';
import { resolveMarketplace } from './registry';
import { registerMarketplaceFoundationRoutes } from './routes';

let database: SqliteDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
});

describe('marketplace and multi-currency application foundation', () => {
  it('resolves the JP alias and keeps Korea disabled and unavailable', async () => {
    database = createMigratedTestDatabase();
    await expect(resolveMarketplace(database, 'AMAZON_JP', {
      requireActive: true, requireAdapter: true,
    })).resolves.toMatchObject({
      code: 'AMAZON_JP', transaction_currency_code: 'JPY',
    });
    await expect(resolveMarketplace(database, 'AMAZON_US', {
      requireActive: true, requireAdapter: true,
    })).resolves.toMatchObject({
      code: 'AMAZON_US', transaction_currency_code: 'USD',
    });
    await expect(resolveMarketplace(database, 'COUPANG_KR', {
      requireActive: true,
    })).rejects.toMatchObject({ code: 'MARKETPLACE_DISABLED' });
  });

  it('allows one global seller organization to own JP stores; rejects US stores until the business layer supports them', async () => {
    database = createMigratedTestDatabase();
    seedOrganization(database);
    const jp = await createSellerStore(database, {
      sellerOrganizationId: 'seller-org-global',
      marketplaceCode: 'AMAZON_JP',
      storeName: '日本店',
    }, command('seller-store-jp'));
    expect(jp.marketplace_code).toBe('AMAZON_JP');
    // Regression: seller_stores.marketplace_code used to be hardcoded to the
    // JP legacy projection, so an AMAZON_US store was silently stored as
    // 'AMAZON_JP' (and its product applications entered the JP conflict check).
    // The business tables are JP-only (marketplaces(code) admits one 'AMAZON_JP'
    // row), so non-JP store creation is rejected loudly for now.
    await expect(createSellerStore(database, {
      sellerOrganizationId: 'seller-org-global',
      marketplaceCode: 'AMAZON_US',
      storeName: '美国店',
    }, command('seller-store-us'))).rejects.toMatchObject({
      code: 'MARKETPLACE_NOT_SUPPORTED',
      status: 409,
    });
    await expect(database.prepare(`
      SELECT marketplace_code FROM seller_store_marketplaces
      WHERE seller_organization_id=? ORDER BY marketplace_code
    `).bind('seller-org-global').all()).resolves.toEqual({
      results: [
        { marketplace_code: 'AMAZON_JP' },
      ],
    });
  });

  it('corrects a fact-free buyer once with version, audit and replay', async () => {
    database = createMigratedTestDatabase();
    seedBuyer(database);
    const input = {
      buyerCustomerId: 'buyer-fact-free',
      marketplaceCode: 'AMAZON_US' as const,
      expectedVersion: 1,
      reason: '注册时站点选择错误，已人工核验',
    };
    const first = await correctBuyerMarketplace(
      database, input, correctionCommand('buyer-market-correction'),
    );
    const replay = await correctBuyerMarketplace(
      database, input, correctionCommand('buyer-market-correction'),
    );
    expect(first).toMatchObject({
      previous_marketplace_code: 'AMAZON_JP',
      marketplace_code: 'AMAZON_US', version: 2, replayed: false,
    });
    expect(replay).toMatchObject({ version: 2, replayed: true });
    await expect(database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM buyer_marketplace_correction_events) AS events,
        (SELECT COUNT(*) FROM audit_events
          WHERE event_type='BUYER_MARKETPLACE_CORRECTED') AS audits
    `).first()).resolves.toEqual({ events: 1, audits: 1 });
  });

  it('rejects non-owner correction without changing the assignment', async () => {
    database = createMigratedTestDatabase();
    seedBuyer(database);
    await expect(correctBuyerMarketplace(database, {
      buyerCustomerId: 'buyer-fact-free',
      marketplaceCode: 'AMAZON_US',
      expectedVersion: 1,
      reason: '无权测试',
    }, {
      actor: {
        staffId: 'zz-phase3h-test-owner',
        roles: ['pre_sales'],
        permissions: new Set(['BUYER_IDENTITY_HIGH_RISK_MANAGE'] as const),
      },
      idempotencyKey: 'buyer-market-forbidden',
      now: 2000,
    })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(database.prepare(`
      SELECT marketplace_code, version FROM buyer_marketplace_assignments
      WHERE buyer_customer_id='buyer-fact-free'
    `).first()).resolves.toEqual({
      marketplace_code: 'AMAZON_JP', version: 1,
    });
  });

  it('rejects disabled Korea as a correction target without side effects', async () => {
    database = createMigratedTestDatabase();
    seedBuyer(database);
    await expect(correctBuyerMarketplace(database, {
      buyerCustomerId: 'buyer-fact-free', marketplaceCode: 'COUPANG_KR',
      expectedVersion: 1, reason: '韩国站尚未开通',
    }, correctionCommand('buyer-market-disabled-target')))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    await expect(database.prepare(`
      SELECT marketplace_code, version FROM buyer_marketplace_assignments
      WHERE buyer_customer_id='buyer-fact-free'
    `).first()).resolves.toEqual({
      marketplace_code: 'AMAZON_JP', version: 1,
    });
  });

  it('rejects correction after a reservation fact without audit side effects', async () => {
    database = createMigratedTestDatabase();
    seedBuyer(database);
    seedReservationFact(database);
    await expect(correctBuyerMarketplace(database, {
      buyerCustomerId: 'buyer-fact-free',
      marketplaceCode: 'AMAZON_US',
      expectedVersion: 1,
      reason: '已有正式事实后不得修改',
    }, correctionCommand('buyer-market-after-fact')))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT', status: 409 });
    await expect(database.prepare(`
      SELECT
        assignment.marketplace_code, assignment.version,
        (SELECT COUNT(*) FROM buyer_marketplace_correction_events) AS events,
        (SELECT COUNT(*) FROM audit_events
          WHERE event_type='BUYER_MARKETPLACE_CORRECTED') AS audits
      FROM buyer_marketplace_assignments assignment
      WHERE assignment.buyer_customer_id='buyer-fact-free'
    `).first()).resolves.toEqual({
      marketplace_code: 'AMAZON_JP', version: 1, events: 0, audits: 0,
    });
  });

  it('does not expose correction to buyers and rejects ordinary Staff', async () => {
    database = createMigratedTestDatabase();
    seedBuyer(database);
    const app = createApp();
    app.use('/api/staff/*', async (context, next) => {
      context.set('staffAuthorization', {
        staffId: 'zz-phase3h-test-owner',
        displayName: '普通员工',
        staffStatus: 'ACTIVE',
        authorizationVersion: 1,
        roles: new Set(['pre_sales']),
        permissions: new Set(['BUYER_CREATE']),
        memberTeamIds: [],
        leaderTeamIds: [],
      });
      await next();
    });
    registerMarketplaceFoundationRoutes(app);
    const payload = JSON.stringify({
      marketplace_code: 'AMAZON_US',
      expected_version: 1,
      reason: '普通员工不得纠正',
    });
    const staffResponse = await app.request(
      '/api/staff/buyers/buyer-fact-free/marketplace-correction',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'ordinary-staff-correction',
        },
        body: payload,
      },
      { DB: database },
    );
    expect(staffResponse.status).toBe(403);

    const buyerResponse = await app.request(
      '/api/buyer-portal/buyers/buyer-fact-free/marketplace-correction',
      { method: 'POST', body: payload },
      { DB: database },
    );
    expect(buyerResponse.status).toBe(404);
    await expect(database.prepare(`
      SELECT marketplace_code, version FROM buyer_marketplace_assignments
      WHERE buyer_customer_id='buyer-fact-free'
    `).first()).resolves.toEqual({
      marketplace_code: 'AMAZON_JP', version: 1,
    });
  });

});

function seedOrganization(result: SqliteDatabase): void {
  result.exec(`
    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code, origin_channel_id,
      current_channel_id, seller_sequence, organization_name, status,
      version, created_at, updated_at, activated_at, disabled_at,
      next_member_number
    ) VALUES (
      'seller-org-global','AMAZON_JP','ido-mango-900001',
      'seller-channel-ido-mango','seller-channel-ido-mango',900001,
      '全局测试卖家','ACTIVE',1,1000,1000,1000,NULL,2
    );
  `);
}

function seedBuyer(result: SqliteDatabase): void {
  result.exec(`
    INSERT INTO customer_identity_subjects (id, subject_type, created_at)
    VALUES ('buyer-subject-fact-free','BUYER_CUSTOMER',1);
    INSERT INTO buyer_customers (
      id, identity_subject_id, marketplace_code, buyer_channel_id,
      buyer_customer_no, buyer_sequence,
      display_name, access_status, identity_review_status, version,
      created_at, updated_at, activated_at, disabled_at
    ) VALUES (
      'buyer-fact-free','buyer-subject-fact-free','AMAZON_JP','buyer-channel-wechat-b',
      '20260101B0001',1,'测试买家','ACTIVE','CLEAR',1,1,1,1,NULL
    );
  `);
}

function seedReservationFact(result: SqliteDatabase): void {
  result.exec(`
    INSERT INTO seller_organizations (
      id, marketplace_code, seller_code, origin_channel_id,
      current_channel_id, seller_sequence, organization_name, status,
      version, created_at, updated_at, activated_at, disabled_at,
      next_member_number
    ) VALUES (
      'seller-org-reservation','AMAZON_JP','ido-mango-900002',
      'seller-channel-ido-mango','seller-channel-ido-mango',900002,
      '预约事实卖家','ACTIVE',1,1,1,1,NULL,2
    );
    INSERT INTO customer_identity_subjects (id, subject_type, created_at)
    VALUES ('seller-reservation-subject','SELLER_ORG_MEMBER',1);
    INSERT INTO seller_organization_members (
      id, identity_subject_id, organization_id, member_number,
      username_fallback, display_name, role, primary_owner, status,
      version, created_at, updated_at, activated_at, disabled_at
    ) VALUES (
      'seller-reservation-owner','seller-reservation-subject',
      'seller-org-reservation',1,'ido-mango-900002-1','负责人','OWNER',1,
      'ACTIVE',1,1,1,1,NULL
    );
    INSERT INTO seller_stores (
      id, organization_id, marketplace_code, display_name,
      normalized_name, status, version, created_at, updated_at, disabled_at
    ) VALUES (
      'store-reservation','seller-org-reservation','AMAZON_JP','预约店','预约店',
      'ACTIVE',1,1,1,NULL
    );
    INSERT INTO products (
      id, organization_id, store_id, marketplace_code, asin_display,
      asin_normalized, status, current_version_no, version,
      created_at, updated_at, disabled_at
    ) VALUES (
      'product-reservation','seller-org-reservation','store-reservation','AMAZON_JP',
      'B0FACT0001','B0FACT0001','ACTIVE',1,1,1,1,NULL
    );
    INSERT INTO product_versions (
      id, product_id, version_no, product_name, search_keywords_json,
      product_url, buyer_visible_notes, internal_notes,
      created_by_staff_id, created_at,
      ordering_guide_expected_amount_jpy, color_spec_mode,
      default_buyer_self_pay_bps
    ) VALUES (
      'product-reservation-v1','product-reservation',1,'预约事实产品','[]',
      NULL,NULL,NULL,'zz-phase3h-test-owner',1,1000,
      'MAIN_IMAGE_VARIANT',1000
    );
    INSERT INTO demand_batches (
      id, organization_id, store_id, marketplace_code, product_id,
      product_version_no, submitted_by_member_id, task_type,
      target_quantity, buyer_visible_notes, seller_notes, open_at,
      reservation_deadline, order_deadline, status, review_reason,
      close_reason, reviewed_by_staff_id, closed_by_staff_id, version,
      submitted_at, updated_at, reviewed_at, published_at, withdrawn_at,
      closed_at, held_reservation_count, approved_reservation_count,
      buyer_self_pay_bps_snapshot, buyer_self_pay_source,
      buyer_self_pay_override_reason
    ) VALUES (
      'demand-reservation','seller-org-reservation','store-reservation','AMAZON_JP',
      'product-reservation',1,'seller-reservation-owner','TEXT',1,NULL,NULL,
      1,10000,20000,'PUBLISHED',NULL,NULL,'zz-phase3h-test-owner',NULL,2,
      1,1,1,1,NULL,NULL,1,0,1000,'PRODUCT_DEFAULT',NULL
    );
    INSERT INTO product_reservations (
      id, demand_batch_id, buyer_customer_id, organization_id, store_id,
      product_id, product_version_no, marketplace_code, status,
      precheck_snapshot_json, hold_expires_at, order_deadline_snapshot,
      version, submitted_at, updated_at, decided_by_staff_id,
      decision_reason, decided_at, cancelled_at, expired_at, reopened_count,
      buyer_self_pay_bps_snapshot, reference_order_amount_jpy_snapshot,
      estimated_self_pay_jpy_snapshot,
      estimated_refundable_principal_jpy_snapshot,
      buyer_self_pay_accepted_at, buyer_self_pay_accepted_demand_version
    ) VALUES (
      'reservation-fact','demand-reservation','buyer-fact-free',
      'seller-org-reservation','store-reservation','product-reservation',1,
      'AMAZON_JP','PENDING_REVIEW','{}',5000,20000,1,1,1,NULL,NULL,NULL,NULL,NULL,0,
      1000,1000,100,900,1,2
    );
  `);
}

function command(idempotencyKey: string) {
  return {
    actor: {
      staffId: 'zz-phase3h-test-owner',
      displayName: '管理员',
      roles: ['owner'] as const,
      permissions: new Set(['SELLER_MANAGE'] as const),
    },
    idempotencyKey,
    now: 2000,
  };
}

function correctionCommand(idempotencyKey: string) {
  return {
    actor: {
      staffId: 'zz-phase3h-test-owner',
      roles: ['owner'] as const,
      permissions: new Set(['BUYER_IDENTITY_HIGH_RISK_MANAGE'] as const),
    },
    idempotencyKey,
    now: 2000,
  };
}
