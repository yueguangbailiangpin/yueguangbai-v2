import { describe, expect, it } from 'vitest';
import {
  sellerFormalOrdersSchema,
  sellerOrderChatScreenshotReadIntentResponseSchema,
  sellerPayablesSchema,
  sellerProductsSchema,
} from './runtime';

const page = { limit: 100, next_cursor: null };

describe('Seller runtime DTO allowlists', () => {
  it('accepts the public product shape and rejects an added internal field', () => {
    const product = {
      id: 'product-1',
      store: { id: 'store-1', display_name: '日本店' },
      marketplace_code: 'JP',
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
      read_intent: {
        read_intent_id: 'intent-1',
        access_token: 'x'.repeat(40),
        access_token_available: true,
        expires_at: 1000,
        replayed: false,
      },
    };
    expect(
      sellerOrderChatScreenshotReadIntentResponseSchema.safeParse(response)
        .success,
    ).toBe(true);
    expect(
      sellerOrderChatScreenshotReadIntentResponseSchema.safeParse({
        readIntent: response.read_intent,
      }).success,
    ).toBe(false);
    expect(
      sellerOrderChatScreenshotReadIntentResponseSchema.safeParse({
        read_intent: {
          ...response.read_intent,
          object_key: 'files/v1/private',
        },
      }).success,
    ).toBe(false);
  });

  it('accepts a non-Amazon formal order only with null legacy projection', () => {
    const platformOrder = {
      formal_order_id: 'platform-formal-order-1', status: 'CONFIRMED',
      legacy_projection: 'NONE', marketplace_code: null,
      canonical_marketplace_code: 'TIKTOK_JP', amazon_order_number: null,
      platform_order_identifier: '585123456789012345',
      store: { id: 'store-1', display_name: 'Philips' }, asin: null,
      platform_product_identifier: 'tiktokDLP2555Q', product_name: 'DLP',
      product_version: null, review_type: null, final_paid_jpy: null,
      payment: null, seller_expected_principal_cny_fen: null,
      seller_principal_rate_snapshot: null,
      seller_agreement_rate_snapshot: null,
      locked_service_fee_snapshot: null, business_completion: null,
      chat_screenshot: { status: 'NONE', file_version: null },
      confirmed_at: 1, confirmed_business_date: null,
    };
    expect(sellerFormalOrdersSchema.safeParse({
      items: [platformOrder], page,
    }).success).toBe(true);
    expect(sellerFormalOrdersSchema.safeParse({
      items: [{
        ...platformOrder,
        amazon_order_number: '585123456789012345',
      }],
      page,
    }).success).toBe(false);
  });
});
