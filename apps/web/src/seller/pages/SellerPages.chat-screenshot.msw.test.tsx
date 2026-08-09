// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS } from '@ygb/contracts';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import '../../test/msw/lifecycle';
import { apiUrl } from '../../test/msw/handlers';
import { renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { SellerOrdersPage } from './SellerPages';

describe('Seller formal-order chat screenshot UI', () => {
  it('renders list status without issuing a screenshot read until the user asks', async () => {
    let readIntentRequests = 0;
    let contentRequests = 0;
    const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:seller-chat' });
    server.use(
      http.get(apiUrl('/api/seller-portal/formal-orders'), () => HttpResponse.json({
        data: { items: [formalOrder(), { ...formalOrder(), formal_order_id: 'order-2', chat_screenshot: { status: 'NONE', file_version: null } }], page: { limit: 100, next_cursor: null } },
        meta: { request_id: 'seller-orders-list' },
      })),
      http.post(apiUrl(
        SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS.sellerReadIntent
          .replace(':id', 'order-1') as `/api/${string}`,
      ), () => {
        readIntentRequests += 1;
        return HttpResponse.json({ data: { read_intent: {
          read_intent_id: 'seller-chat-intent', access_token: 'seller-chat-token'.padEnd(40, 'x'),
          access_token_available: true, expires_at: 99, replayed: false,
        } }, meta: { request_id: 'unexpected-read' } });
      }),
      http.get(apiUrl('/api/seller-portal/file-read-intents/:id/content'), ({ request }) => {
        contentRequests += 1;
        expect(request.headers.get('X-File-Read-Token')).toContain('seller-chat-token');
        return new Response(Uint8Array.of(1, 2), { headers: {
          'Content-Type': 'image/png', 'Content-Length': '2',
          'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        } });
      }),
    );

    try {
      const { client } = renderWithMsw(<SellerOrdersPage />, { route: '/seller/orders' });

      expect(await screen.findByText('展开聊天截图')).toBeTruthy();
      expect(screen.getAllByText('聊天截图')).toHaveLength(2);
      expect(screen.getByText('已上传')).toBeTruthy();
      expect(screen.getByText('暂无聊天截图')).toBeTruthy();
      expect(screen.queryByText('查看聊天截图')).toBeNull();
      expect(readIntentRequests).toBe(0);
      expect(contentRequests).toBe(0);
      expect(client.getQueryData(['seller', 'orders', 'all'])).toBeDefined();
      expect(client.getQueryData(['buyer', 'orders', 'all'])).toBeUndefined();

      await userEvent.click(screen.getByRole('button', { name: '展开聊天截图' }));
      expect(await screen.findByText('查看聊天截图')).toBeTruthy();
      expect(readIntentRequests).toBe(0);
      expect(contentRequests).toBe(0);

      await userEvent.click(screen.getByRole('button', { name: '查看聊天截图' }));
      expect((await screen.findByRole('link', { name: '打开文件' }))
        .getAttribute('href')).toBe('blob:seller-chat');
      expect(readIntentRequests).toBe(1);
      expect(contentRequests).toBe(1);
      expect(JSON.stringify(
        client.getQueryCache().getAll().map((query) => query.state.data),
      )).not.toContain('seller-chat-token');
    } finally {
      if (originalCreateObjectUrl) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl);
      else delete (URL as { createObjectURL?: unknown }).createObjectURL;
    }
  });
});

function formalOrder() {
  return {
    formal_order_id: 'order-1', status: 'CONFIRMED', legacy_projection: 'AMAZON', marketplace_code: 'JP', canonical_marketplace_code: 'AMAZON_JP',
    amazon_order_number: '111-1111111-1111111', platform_order_identifier: '111-1111111-1111111',
    store: { id: 'store-1', display_name: '店铺一' }, asin: 'B012345678', platform_product_identifier: 'B012345678', product_name: '聊天截图商品',
    product_version: { id: 'product-version-1', version_no: 1 }, review_type: 'IMAGE', final_paid_jpy: '1980',
    payment: { amount_minor: '1980', currency_code: 'JPY', currency_exponent: 0 }, seller_expected_principal_cny_fen: '100',
    seller_principal_rate_snapshot: null,
    seller_agreement_rate_snapshot: {
      rate_version_id: 'rate-1', version_no: 1, cny_per_jpy_e8: '100000000', effective_from: 1, confirmed_at: 1,
      source_currency_code: 'JPY', quote_currency_code: 'CNY', source_currency_exponent: 0, quote_currency_exponent: 2,
      rate_value: '1', rate_scale: '1', rounding_rule: 'HALF_UP',
    },
    locked_service_fee_snapshot: {
      fee_version_id: 'fee-1', version_no: 1, review_type: 'IMAGE', service_fee_cny_fen: '1', effective_from: 1,
      confirmed_at: 1, marketplace_code: 'AMAZON_JP', currency_code: 'CNY', currency_exponent: 2,
    },
    business_completion: { status: 'IN_PROGRESS', review: 'PENDING', buyer_refund: 'PENDING', seller_principal: 'PENDING', seller_service_fee: 'PENDING' },
    chat_screenshot: { status: 'AVAILABLE', file_version: 2 }, confirmed_at: 1, confirmed_business_date: '2026-08-01',
  };
}
