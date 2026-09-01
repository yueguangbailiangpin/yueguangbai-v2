import { describe, expect, it } from 'vitest';
import {
  sellerFormalOrdersSchema,
  sellerMeSchema,
  sellerOrderChatScreenshotReadIntentResponseSchema,
  sellerPayablesSchema,
  sellerProductsSchema,
} from './runtime';

const page = { limit: 100, next_cursor: null };

describe('Seller runtime DTO allowlists', () => {
  it('accepts every governed Seller member role', () => {
    for (const role of ['OWNER', 'OPERATIONS', 'FINANCE', 'VIEWER']) {
      expect(sellerMeSchema.safeParse({
        me: {
          account_id: 'account-1',
          member: {
            id: 'member-1', display_name: '卖家', role,
            primary_owner: role === 'OWNER',
          },
          organization: {
            id: 'organization-1', seller_code: 'seller-1',
            name: '卖家组织', marketplace_code: 'AMAZON_JP', status: 'ACTIVE',
            settlement_account_name: null,
            settlement_account_identifier: null,
          },
          access: {
            read_scope: role === 'OWNER'
              ? 'ORGANIZATION'
              : 'ASSIGNED_STORES',
            store_ids: ['store-1'],
            can_submit_product_applications:
              role === 'OWNER' || role === 'OPERATIONS',
            can_submit_demand_batches:
              role === 'OWNER' || role === 'OPERATIONS',
          },
        },
      }).success).toBe(true);
    }
    expect(sellerMeSchema.safeParse({
      me: {
        account_id: 'account-1',
        member: {
          id: 'member-1', display_name: '卖家', role: 'OPERATOR',
          primary_owner: false,
        },
        organization: {
          id: 'organization-1', seller_code: 'seller-1',
          name: '卖家组织', marketplace_code: 'AMAZON_JP', status: 'ACTIVE',
        },
        access: {
          read_scope: 'ASSIGNED_STORES', store_ids: ['store-1'],
          can_submit_product_applications: false,
          can_submit_demand_batches: false,
        },
      },
    }).success).toBe(false);
  });

  it('accepts the public product shape and rejects an added internal field', () => {
    const product = {
      id: 'product-1',
      store: { id: 'store-1', display_name: '日本店' },
      marketplace_code: 'AMAZON_JP',
      seller_code: 'seller-1',
      asin: 'B000000001',
      status: 'ACTIVE',
      current_version_no: 1,
      version: 1,
      created_at: 1,
      updated_at: 1,
      current_version: {
        id: 'product-version-1', version_no: 1, product_name: '商品',
        search_keywords: ['关键词'], ordering_guide_expected_amount_jpy: 1000,
        color_spec_mode: 'ANY_VARIANT', main_image: null, product_url: null,
        buyer_visible_notes: null, created_at: 1,
      },
    };
    expect(sellerProductsSchema.safeParse({ items: [product], page }).success).toBe(true);
    expect(sellerProductsSchema.safeParse({ items: [{ ...product, internal_notes: 'secret' }], page }).success).toBe(false);
  });

  it('rejects storage metadata added to a payable', () => {
    const payable = {
      payable_id: 'payable-1', formal_order_id: 'order-1', amazon_order_number: '111-1111111-1111111',
      store: { id: 'store-1', display_name: '日本店' },
      product: { id: 'product-1', asin: 'B000000001', name: '商品' },
      payable_type: 'SELLER_PRINCIPAL', due_amount_cny_fen: '100', paid_amount_cny_fen: '0',
      outstanding_amount_cny_fen: '100', status: 'UNPAID', due_at: 1, created_at: 1,
    };
    expect(sellerPayablesSchema.safeParse({ items: [payable], page }).success).toBe(true);
    expect(sellerPayablesSchema.safeParse({ items: [{ ...payable, object_key: 'private/key' }], page }).success).toBe(false);
  });

  it('accepts only the public snake_case Seller chat read-intent DTO', () => {
    const response = {
      read_intent_id: 'intent-1',
      access_token: 'x'.repeat(40),
      access_token_available: true,
      expires_at: 1000,
      replayed: false,
    };
    expect(
      sellerOrderChatScreenshotReadIntentResponseSchema.safeParse(response)
        .success,
    ).toBe(true);
    expect(
      sellerOrderChatScreenshotReadIntentResponseSchema.safeParse({
        readIntent: response,
      }).success,
    ).toBe(false);
    expect(
      sellerOrderChatScreenshotReadIntentResponseSchema.safeParse({
        ...response,
        object_key: 'files/v1/private',
      }).success,
    ).toBe(false);
  });

  it('accepts only the three shared CanonicalMarketplaceCode values in the fee snapshot', () => {
    const order = realBackendFormalOrder();
    // 与共享合同 MARKETPLACE_CODES 语义一致的三个合法 Canonical 代码。
    for (const code of ['AMAZON_JP', 'AMAZON_US', 'COUPANG_KR']) {
      expect(sellerFormalOrdersSchema.safeParse({
        items: [{
          ...order,
          locked_service_fee_snapshot: {
            ...order.locked_service_fee_snapshot,
            marketplace_code: code,
          },
        }],
        page,
      }).success).toBe(true);
    }
    // 未在现行注册表发布的代码必须被 strict schema 拒绝。
    for (const code of ['RAKUTEN_JP', 'TIKTOK_JP']) {
      expect(sellerFormalOrdersSchema.safeParse({
        items: [{
          ...order,
          locked_service_fee_snapshot: {
            ...order.locked_service_fee_snapshot,
            marketplace_code: code,
          },
        }],
        page,
      }).success).toBe(false);
    }
    // 真实卖家订单响应（AMAZON_JP 快照）仍可解析。
    expect(sellerFormalOrdersSchema.safeParse({ items: [order], page }).success).toBe(true);
  });

  it('parses the real backend formal-order shape with screenshot uploader fields', () => {
    const order = realBackendFormalOrder();
    expect(sellerFormalOrdersSchema.safeParse({
      items: [order], page,
    }).success).toBe(true);

    // uploaded_by_staff_name 可选可空：缺省（上传账号不可解析）仍可解析。
    const { uploaded_by_staff_name: _omitted, ...withoutName } =
      order.communication_screenshots[0]!;
    expect(sellerFormalOrdersSchema.safeParse({
      items: [{ ...order, communication_screenshots: [{ ...withoutName, uploaded_by_staff_id: null }] }],
      page,
    }).success).toBe(true);
    // uploaded_by_staff_name: null 同样合法。
    expect(sellerFormalOrdersSchema.safeParse({
      items: [{
        ...order,
        communication_screenshots: [{ ...order.communication_screenshots[0]!, uploaded_by_staff_name: null }],
      }],
      page,
    }).success).toBe(true);
  });

  it('rejects screenshot entries with internal or drifted fields', () => {
    const order = realBackendFormalOrder();
    // 内部存储元数据必须被 strict schema 拒绝。
    expect(sellerFormalOrdersSchema.safeParse({
      items: [{
        ...order,
        communication_screenshots: [
          { ...order.communication_screenshots[0]!, object_key: 'files/v1/private' },
        ],
      }],
      page,
    }).success).toBe(false);
    expect(sellerFormalOrdersSchema.safeParse({
      items: [{
        ...order,
        communication_screenshots: [
          { ...order.communication_screenshots[0]!, drive_file_id: 'drive-1' },
        ],
      }],
      page,
    }).success).toBe(false);
    // uploaded_at / uploaded_by_staff_id 是必填：缺失必须失败。
    const { uploaded_at: _at, ...withoutUploadedAt } = order.communication_screenshots[0]!;
    expect(sellerFormalOrdersSchema.safeParse({
      items: [{ ...order, communication_screenshots: [withoutUploadedAt] }],
      page,
    }).success).toBe(false);
    const { uploaded_by_staff_id: _by, ...withoutUploadedBy } = order.communication_screenshots[0]!;
    expect(sellerFormalOrdersSchema.safeParse({
      items: [{ ...order, communication_screenshots: [withoutUploadedBy] }],
      page,
    }).success).toBe(false);
    // 已归档的 legacy_projection 判别字段不在现行共享合同中，必须拒绝。
    expect(sellerFormalOrdersSchema.safeParse({
      items: [{ ...order, legacy_projection: 'AMAZON' }],
      page,
    }).success).toBe(false);
    // 快照时间戳字段名漂移（confirmed_at）必须拒绝，权威字段是 *_created_at。
    const driftedSnapshot = {
      ...order.seller_principal_rate_snapshot,
    } as Record<string, unknown>;
    delete driftedSnapshot['base_rate_created_at'];
    driftedSnapshot['base_rate_confirmed_at'] = 1;
    expect(sellerFormalOrdersSchema.safeParse({
      items: [{ ...order, seller_principal_rate_snapshot: driftedSnapshot }],
      page,
    }).success).toBe(false);
  });
});

/**
 * 与 apps/api/src/seller-formal-orders/read-model.ts mapFormalOrder 输出一致的
 * 真实后端响应形状（AMAZON_JP 单形状；截图含上传人/上传时间）。
 */
function realBackendFormalOrder() {
  return {
    formal_order_id: 'order-1',
    status: 'CONFIRMED',
    platform_order_identifier: '111-1111111-1111111',
    store: { id: 'store-1', display_name: '日本店' },
    platform_product_identifier: 'B012345678',
    product_name: '商品',
    main_image: null,
    order_screenshot: null,
    communication_screenshots: [
      {
        file_object_id: 'comm-file-1',
        file_version: 2,
        purpose: 'ORDER_COMMUNICATION_SCREENSHOT',
        visibility: 'SELLER_VISIBLE',
        uploaded_at: 1_746_800_000_000,
        uploaded_by_staff_id: 'staff-1',
        uploaded_by_staff_name: '张三',
      },
    ],
    confirmed_at: 1_746_800_000_000,
    marketplace_code: 'AMAZON_JP',
    amazon_order_number: '111-1111111-1111111',
    asin: 'B012345678',
    product_version: { id: 'product-version-1', version_no: 1 },
    review_type: 'IMAGE',
    final_paid_jpy: '1980',
    payment: { amount_minor: '1980', currency_code: 'JPY', currency_exponent: 0 },
    seller_expected_principal_cny_fen: '100',
    seller_principal_rate_snapshot: {
      platform_order_date: '2026-08-01',
      payment_amount_minor: '1980',
      payment_currency_code: 'JPY',
      base_rate_version_id: 'base-rate-1',
      base_rate_business_date: '2026-08-01',
      base_rate_created_at: 1,
      base_rate_value: '5000000',
      base_rate_scale: '100000000',
      policy_version_id: 'policy-1',
      policy_scope_type: 'SELLER_ORGANIZATION',
      policy_seller_organization_id: 'org-1',
      policy_version_no: 1,
      policy_effective_from: 1,
      policy_created_at: 1,
      markup_rate_value: '0',
      markup_rate_scale: '100000000',
      final_rate_value: '5000000',
      final_rate_scale: '100000000',
      rounding_rule: 'HALF_UP',
      seller_expected_principal_amount_minor: '100',
    },
    locked_service_fee_snapshot: {
      fee_version_id: 'fee-1',
      version_no: 1,
      review_type: 'IMAGE',
      service_fee_cny_fen: '1',
      effective_from: 1,
      created_at: 1,
      marketplace_code: 'AMAZON_JP',
      currency_code: 'CNY',
      currency_exponent: 2,
    },
    business_completion: {
      status: 'IN_PROGRESS',
      review: 'PENDING',
      seller_principal: 'PENDING',
      seller_service_fee: 'PENDING',
    },
    confirmed_business_date: '2026-08-01',
  };
}
