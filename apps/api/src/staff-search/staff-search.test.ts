import { describe, expect, it } from 'vitest';
import { createMigratedTestDatabase } from '@ygb/testkit';
import {
  loginThroughDefaultApp,
  seedWave13RuntimeAuthority,
  Wave13RuntimeDatabase,
} from '../../test-support/wave13-runtime';
import { MockObjectStorage } from '../files/mock-object-storage';
import app from '../index';

/**
 * P9 顶栏全局搜索：买家（编码/名称/微信）/产品（ASIN/名称）/需求（产品名）
 * 三组走真实迁移库 SQL；订单组（formal_orders 外键链深，staging 人工验证
 * 兜底）只断言无数据时返回空数组——其 LIKE 与站点过滤逻辑与前三组同构。
 */
describe('staff global search', () => {
  it('groups buyer, product and demand matches with owner scope', async () => {
    const base = createMigratedTestDatabase();
    try {
      seedWave13RuntimeAuthority(base);
      base.exec(`
        INSERT INTO customer_identity_subjects (id, subject_type, created_at)
          VALUES ('search-subject-1', 'BUYER_CUSTOMER', 100);
        INSERT INTO buyer_channels (
          id, code, name, status, next_sequence, version, created_at, updated_at
        ) VALUES ('search-channel', 'B', '线下渠道', 'ACTIVE', 3593, 1, 100, 100);
        INSERT INTO buyer_customers (
          id, identity_subject_id, marketplace_code, buyer_channel_id,
          buyer_customer_no, buyer_sequence, first_valid_order_business_date,
          display_name, access_status, identity_review_status,
          version, created_at, updated_at, activated_at
        ) VALUES (
          'search-buyer-1', 'search-subject-1', 'AMAZON_JP', 'search-channel',
          '20260824B03590', 3590, '2026-08-24',
          '张三丰', 'ACTIVE', 'CLEAR', 1, 100, 100, 100
        );
        INSERT INTO wechat_identity_claims (
          id, identity_subject_id, display_wechat, normalized_wechat,
          status, version, acquired_at, created_at, updated_at
        ) VALUES (
          'search-claim-1', 'search-subject-1', 'wx_zhangsanfeng', 'wx_zhangsanfeng',
          'ACTIVE', 1, 100, 100, 100
        );
        INSERT INTO products (
          id, organization_id, store_id, marketplace_code,
          asin_display, asin_normalized, status, current_version_no,
          version, created_at, updated_at
        ) VALUES (
          'search-product-1', 'runtime-org', 'runtime-store', 'AMAZON_JP',
          'B0SRCHAA01', 'B0SRCHAA01', 'ACTIVE', 1, 1, 100, 100
        );
        INSERT INTO product_versions (
          id, product_id, version_no, product_name, search_keywords_json,
          created_by_staff_id, created_at,
          ordering_guide_expected_amount_jpy, color_spec_mode
        ) VALUES (
          'search-product-version-1', 'search-product-1', 1,
          '月光白保温随行杯', '[]', 'zz-phase3h-test-owner', 100,
          2999, 'MAIN_IMAGE_VARIANT'
        );
        INSERT INTO customer_identity_subjects (id, subject_type, created_at)
          VALUES ('search-member-subject', 'SELLER_ORG_MEMBER', 100);
        INSERT INTO seller_organization_members (
          id, identity_subject_id, organization_id, member_number,
          username_fallback, display_name, role, status,
          version, created_at, updated_at, activated_at
        ) VALUES (
          'search-member', 'search-member-subject', 'runtime-org', 1,
          'search-member-fallback', '搜索测试成员', 'OWNER', 'ACTIVE',
          1, 100, 100, 100
        );
        INSERT INTO demand_batches (
          id, organization_id, store_id, marketplace_code,
          product_id, product_version_no, submitted_by_member_id, task_type,
          target_quantity, open_at, reservation_deadline, order_deadline,
          status, version, submitted_at, updated_at
        ) VALUES (
          'search-demand-1', 'runtime-org', 'runtime-store', 'AMAZON_JP',
          'search-product-1', 1, 'search-member', 'TEXT',
          5, 100, 200, 300, 'SUBMITTED', 1, 100, 100
        );
      `);
      const database = new Wave13RuntimeDatabase(base);
      const identity = await loginThroughDefaultApp(
        database,
        'owner',
        new MockObjectStorage(),
      );
      const search = async (query: string): Promise<{
        status: number;
        body: Record<string, unknown>;
      }> => {
        const response = await app.request(
          `https://api.example.test/api/staff/search?q=${encodeURIComponent(query)}`,
          { headers: { Cookie: identity.cookie } },
          identity.env,
        );
        return { status: response.status, body: await response.json() as Record<string, unknown> };
      };

      const byBuyerNo = await search('20260824B03590');
      expect(byBuyerNo.status).toBe(200);
      await expect(Promise.resolve(byBuyerNo.body)).resolves.toMatchObject({
        data: {
          query: '20260824B03590',
          buyers: [
            {
              buyer_customer_id: 'search-buyer-1',
              buyer_customer_no: '20260824B03590',
              display_name: '张三丰',
            },
          ],
          products: [],
          orders: [],
          demands: [],
        },
      });

      const byWechat = await search('zhangsanfeng');
      await expect(Promise.resolve(byWechat.body)).resolves.toMatchObject({
        data: {
          buyers: [{ buyer_customer_id: 'search-buyer-1' }],
        },
      });

      const byAsin = await search('B0SRCHAA01');
      await expect(Promise.resolve(byAsin.body)).resolves.toMatchObject({
        data: {
          products: [
            {
              product_id: 'search-product-1',
              product_name: '月光白保温随行杯',
              asin_display: 'B0SRCHAA01',
            },
          ],
        },
      });

      const byProductName = await search('保温随行杯');
      await expect(Promise.resolve(byProductName.body)).resolves.toMatchObject({
        data: {
          products: [{ product_id: 'search-product-1' }],
          demands: [
            {
              demand_batch_id: 'search-demand-1',
              product_name: '月光白保温随行杯',
              status: 'SUBMITTED',
            },
          ],
        },
      });

      const byOrderNumber = await search('250-9999999-9999999');
      await expect(Promise.resolve(byOrderNumber.body)).resolves.toMatchObject({
        data: { buyers: [], products: [], orders: [], demands: [] },
      });
    } finally {
      base.close();
    }
  });

  it('validates the query and hides results for scoped staff without marketplaces', async () => {
    const base = createMigratedTestDatabase();
    try {
      seedWave13RuntimeAuthority(base);
      const database = new Wave13RuntimeDatabase(base);
      const owner = await loginThroughDefaultApp(
        database,
        'owner',
        new MockObjectStorage(),
      );
      const tooShort = await app.request(
        'https://api.example.test/api/staff/search?q=%E5%BC%A0',
        { headers: { Cookie: owner.cookie } },
        owner.env,
      );
      expect(tooShort.status).toBe(400);
      const extraParam = await app.request(
        'https://api.example.test/api/staff/search?q=abc&extra=1',
        { headers: { Cookie: owner.cookie } },
        owner.env,
      );
      expect(extraParam.status).toBe(400);

      const scoped = await loginThroughDefaultApp(
        database,
        'scoped',
        new MockObjectStorage(),
      );
      const scopedSearch = await app.request(
        'https://api.example.test/api/staff/search?q=zhangsanfeng',
        { headers: { Cookie: scoped.cookie } },
        scoped.env,
      );
      expect(scopedSearch.status).toBe(200);
      await expect(scopedSearch.json()).resolves.toMatchObject({
        data: { buyers: [], products: [], orders: [], demands: [] },
      });
    } finally {
      base.close();
    }
  });
});
