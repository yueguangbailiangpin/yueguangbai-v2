// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS } from '@ygb/contracts';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import '../../test/msw/lifecycle';
import { apiUrl } from '../../test/msw/handlers';
import { renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { sellerQueryKeys } from '../queries/keys';
import {
  SellerDashboardPage,
  SellerOrdersPage,
  SellerSettlementsPage,
} from './SellerPages';

afterEach(cleanup);

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
      expect(client.getQueryData(sellerQueryKeys.ordersPage(null, null))).toBeDefined();
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

  it('preserves loaded orders and follows the opaque Seller cursor', async () => {
    const requests: string[] = [];
    server.use(http.get(apiUrl('/api/seller-portal/formal-orders'), ({ request }) => {
      const url = new URL(request.url);
      requests.push(url.search);
      const cursor = url.searchParams.get('cursor');
      return HttpResponse.json({
        data: cursor === null
          ? {
              items: [{ ...formalOrder(), product_name: '第一页订单' }],
              page: { limit: 100, next_cursor: 'opaque-seller-page-2' },
            }
          : {
              items: [{
                ...formalOrder(), formal_order_id: 'order-2',
                product_name: '第二页订单',
              }],
              page: { limit: 100, next_cursor: null },
            },
        meta: { request_id: cursor === null ? 'seller-page-1' : 'seller-page-2' },
      });
    }));

    renderWithMsw(<SellerOrdersPage />, { route: '/seller/orders' });
    expect(await screen.findByText('第一页订单')).toBeVisible();
    await userEvent.click(screen.getByRole('button', {
      name: '加载更多正式订单',
    }));

    expect(await screen.findByText('第二页订单')).toBeVisible();
    expect(screen.getByText('第一页订单')).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(new URLSearchParams(requests[0]).get('cursor')).toBeNull();
    expect(new URLSearchParams(requests[1]).get('cursor'))
      .toBe('opaque-seller-page-2');
  });

  it('does not render failed initial order reads as authoritative zero facts', async () => {
    server.use(
      http.get(apiUrl('/api/seller-portal/me'), () => HttpResponse.json({
        data: { me: sellerMe() }, meta: { request_id: 'seller-me' },
      })),
      http.get(apiUrl('/api/seller-portal/formal-orders'), () =>
        unavailable('seller-orders-unavailable')),
      http.get(apiUrl('/api/seller-portal/settlement/summary'), () =>
        HttpResponse.json({
          data: { settlement: {
            outstanding_principal_cny_fen: '0',
            outstanding_service_fee_cny_fen: '0',
            total_outstanding_cny_fen: '0',
            unallocated_credit_cny_fen: '0',
          } },
          meta: { request_id: 'seller-settlement' },
        })),
    );

    renderWithMsw(<SellerDashboardPage />, { route: '/seller' });
    expect(await screen.findByText(
      '订单进度暂时不可用，刷新后重试。',
    )).toBeVisible();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('暂无待完成订单')).not.toBeInTheDocument();
  });

  it('does not render a failed payable read as an empty financial ledger', async () => {
    server.use(
      http.get(apiUrl('/api/seller-portal/settlement/summary'), () =>
        HttpResponse.json({
          data: { settlement: {
            outstanding_principal_cny_fen: '100',
            outstanding_service_fee_cny_fen: '200',
            total_outstanding_cny_fen: '300',
            unallocated_credit_cny_fen: '0',
          } },
          meta: { request_id: 'seller-settlement' },
        })),
      http.get(apiUrl('/api/seller-portal/settlement/payables'), () =>
        unavailable('seller-payables-unavailable')),
    );

    renderWithMsw(<SellerSettlementsPage />, {
      route: '/seller/settlements',
    });
    expect(await screen.findByText(
      '结算项目暂时用不了，刷新后重试。',
    )).toBeVisible();
    expect(screen.queryByText('暂无结算项目')).not.toBeInTheDocument();
  });
});

function unavailable(requestId: string) {
  return HttpResponse.json({
    error: {
      code: 'DEPENDENCY_UNAVAILABLE',
      message: '暂时不可用',
      details: null,
    },
    meta: { request_id: requestId },
  }, { status: 503 });
}

function sellerMe() {
  return {
    account_id: 'seller-account',
    member: {
      id: 'seller-member', display_name: '卖家', role: 'OPERATIONS',
      primary_owner: false,
    },
    organization: {
      id: 'seller-organization', seller_code: 'seller-1', name: '卖家组织',
      marketplace_code: 'JP', status: 'ACTIVE',
    },
    access: {
      read_scope: 'ASSIGNED_STORES', store_ids: ['store-1'],
      can_submit_product_applications: true,
      can_submit_demand_batches: true,
    },
  };
}

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
