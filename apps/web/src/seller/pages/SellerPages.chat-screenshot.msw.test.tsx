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
import { SellerDashboardPage, SellerOrdersPage, SellerSettlementsPage } from './SellerPages';
import { SellerLayout } from '../routes/SellerLayout';
import { SellerRoutePage } from '../routes/SellerRouteModule';

afterEach(cleanup);

describe('Seller formal-order chat screenshot UI', () => {
  it('hides every settlement entry and route payload from OPERATIONS members', async () => {
    let settlementRequests = 0;
    server.use(
      http.get(apiUrl('/api/seller-portal/me'), () =>
        HttpResponse.json({ data: { me: sellerMe() }, meta: { request_id: 'seller-me-ops' } }),
      ),
      http.get(apiUrl('/api/seller-portal/stores'), () =>
        HttpResponse.json({
          data: { items: [], page: { limit: 100, next_cursor: null } },
          meta: { request_id: 'seller-stores' },
        }),
      ),
      http.get(apiUrl('/api/seller-portal/settlement/summary'), () => {
        settlementRequests += 1;
        return HttpResponse.json({
          data: {
            settlement: {
              outstanding_principal_cny_fen: '100',
              outstanding_service_fee_cny_fen: '200',
              total_outstanding_cny_fen: '300',
              unallocated_credit_cny_fen: '0',
            },
          },
          meta: { request_id: 'unexpected-settlement' },
        });
      }),
    );
    renderWithMsw(
      <SellerLayout>
        <SellerRoutePage />
      </SellerLayout>,
      { route: '/seller/settlements' },
    );
    expect(await screen.findByText('当前成员角色不能查看财务结算。')).toBeVisible();
    expect(screen.queryByRole('link', { name: '结算' })).not.toBeInTheDocument();
    expect(screen.queryByText('本金与服务费')).not.toBeInTheDocument();
    expect(settlementRequests).toBe(0);
  });

  it('keeps settlement navigation available to FINANCE members', async () => {
    server.use(
      http.get(apiUrl('/api/seller-portal/me'), () =>
        HttpResponse.json({
          data: { me: { ...sellerMe(), member: { ...sellerMe().member, role: 'FINANCE' } } },
          meta: { request_id: 'seller-me-finance' },
        }),
      ),
      http.get(apiUrl('/api/seller-portal/stores'), () =>
        HttpResponse.json({
          data: { items: [], page: { limit: 100, next_cursor: null } },
          meta: { request_id: 'seller-stores' },
        }),
      ),
      http.get(apiUrl('/api/seller-portal/settlement/summary'), () =>
        HttpResponse.json({
          data: {
            settlement: {
              outstanding_principal_cny_fen: '0',
              outstanding_service_fee_cny_fen: '0',
              total_outstanding_cny_fen: '0',
              unallocated_credit_cny_fen: '0',
            },
          },
          meta: { request_id: 'seller-settlement-finance' },
        }),
      ),
      http.get(apiUrl('/api/seller-portal/settlement/payables'), () =>
        HttpResponse.json({
          data: { items: [], page: { limit: 100, next_cursor: null } },
          meta: { request_id: 'seller-payables-finance' },
        }),
      ),
    );
    renderWithMsw(
      <SellerLayout>
        <SellerSettlementsPage />
      </SellerLayout>,
      { route: '/seller/settlements' },
    );
    expect(
      await screen.findByText('这里按你有权限的店铺汇总，不随上方店铺筛选变化。'),
    ).toBeVisible();
    expect(await screen.findAllByRole('link', { name: '结算' })).toHaveLength(2);
  });

  it('labels OWNER settlement as organization-wide and keeps it independent of store selection', async () => {
    const settlementRequests: string[] = [];
    server.use(
      http.get(apiUrl('/api/seller-portal/me'), () =>
        HttpResponse.json({
          data: {
            me: {
              ...sellerMe(),
              member: { ...sellerMe().member, role: 'OWNER' },
              access: {
                ...sellerMe().access,
                read_scope: 'ORGANIZATION',
                store_ids: ['store-1', 'store-2'],
              },
            },
          },
          meta: { request_id: 'seller-me-owner' },
        }),
      ),
      http.get(apiUrl('/api/seller-portal/stores'), () =>
        HttpResponse.json({
          data: {
            items: [
              {
                id: 'store-1',
                marketplace_code: 'JP',
                display_name: '店铺一',
                canonical_marketplace_code: 'AMAZON_JP',
                transaction_currency_code: 'JPY',
                transaction_currency_exponent: 0,
                marketplace_status: 'ACTIVE',
                adapter_status: 'AVAILABLE',
                status: 'ACTIVE',
                version: 1,
                created_at: 1,
                updated_at: 1,
              },
              {
                id: 'store-2',
                marketplace_code: 'JP',
                display_name: '店铺二',
                canonical_marketplace_code: 'AMAZON_JP',
                transaction_currency_code: 'JPY',
                transaction_currency_exponent: 0,
                marketplace_status: 'ACTIVE',
                adapter_status: 'AVAILABLE',
                status: 'ACTIVE',
                version: 1,
                created_at: 1,
                updated_at: 1,
              },
            ],
            page: { limit: 100, next_cursor: null },
          },
          meta: { request_id: 'seller-stores-owner' },
        }),
      ),
      http.get(apiUrl('/api/seller-portal/settlement/summary'), ({ request }) => {
        settlementRequests.push(request.url);
        return HttpResponse.json({
          data: {
            settlement: {
              outstanding_principal_cny_fen: '100',
              outstanding_service_fee_cny_fen: '200',
              total_outstanding_cny_fen: '300',
              unallocated_credit_cny_fen: '0',
            },
          },
          meta: { request_id: 'seller-settlement-owner' },
        });
      }),
      http.get(apiUrl('/api/seller-portal/settlement/payables'), ({ request }) => {
        settlementRequests.push(request.url);
        return HttpResponse.json({
          data: { items: [], page: { limit: 100, next_cursor: null } },
          meta: { request_id: 'seller-payables-owner' },
        });
      }),
    );

    renderWithMsw(
      <SellerLayout>
        <SellerSettlementsPage />
      </SellerLayout>,
      { route: '/seller/settlements' },
    );
    expect(
      await screen.findByText(
        '这里显示整个组织（含已停用店铺）的历史账目，不随上方店铺筛选变化。',
      ),
    ).toBeVisible();
    expect(settlementRequests).toHaveLength(2);
    expect(settlementRequests.every((url) => !new URL(url).searchParams.has('store_id'))).toBe(
      true,
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '店铺' }), 'store-1');
    expect(screen.getByRole('combobox', { name: '店铺' })).toHaveValue('store-1');
    expect(settlementRequests).toHaveLength(2);
  });

  it('renders list status without issuing a screenshot read until the user asks', async () => {
    let readIntentRequests = 0;
    let contentRequests = 0;
    const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: () => 'blob:seller-chat',
    });
    server.use(
      http.get(apiUrl('/api/seller-portal/formal-orders'), () =>
        HttpResponse.json({
          data: {
            items: [
              formalOrder(),
              {
                ...formalOrder(),
                formal_order_id: 'order-2',
                main_image: {
                  file_object_id: 'seller-main-image-1',
                  file_version: 1,
                  client_file_name: 'main.webp',
                },
                order_screenshot: null,
                chat_screenshot: { status: 'NONE', file_version: null },
              },
            ],
            page: { limit: 100, next_cursor: null },
          },
          meta: { request_id: 'seller-orders-list' },
        }),
      ),
      http.post(
        apiUrl(
          SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS.sellerReadIntent.replace(
            ':id',
            'order-1',
          ) as `/api/${string}`,
        ),
        () => {
          readIntentRequests += 1;
          return HttpResponse.json({
            data: {
              read_intent: {
                read_intent_id: 'seller-chat-intent',
                access_token: 'seller-chat-token'.padEnd(40, 'x'),
                access_token_available: true,
                expires_at: 99,
                replayed: false,
              },
            },
            meta: { request_id: 'unexpected-read' },
          });
        },
      ),
      http.post(apiUrl('/api/seller-portal/files/seller-order-shot-1/read-intents'), () =>
        HttpResponse.json({
          data: {
            read_intent_id: 'seller-order-shot-intent',
            file_object_id: 'seller-order-shot-1',
            access_token: 'seller-order-shot-token'.padEnd(40, 'x'),
            access_token_available: true,
            expires_at: 99,
            replayed: false,
          },
          meta: { request_id: 'order-shot-read' },
        })),
      http.get(apiUrl('/api/seller-portal/file-read-intents/seller-order-shot-intent/content'), () =>
        new Response(Uint8Array.of(3, 4), {
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': '2',
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        })),
      http.post(apiUrl('/api/seller-portal/files/seller-main-image-1/read-intents'), () =>
        HttpResponse.json({
          data: {
            read_intent_id: 'seller-main-image-intent',
            file_object_id: 'seller-main-image-1',
            access_token: 'seller-main-token'.padEnd(40, 'x'),
            access_token_available: true,
            expires_at: 99,
            replayed: false,
          },
          meta: { request_id: 'seller-main-image-read' },
        })),
      http.get(apiUrl('/api/seller-portal/file-read-intents/seller-main-image-intent/content'), () =>
        new Response(Uint8Array.of(9, 9), {
          headers: {
            'Content-Type': 'image/webp',
            'Content-Length': '2',
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        })),
      http.get(apiUrl('/api/seller-portal/file-read-intents/:id/content'), ({ request }) => {
        contentRequests += 1;
        expect(request.headers.get('X-File-Read-Token')).toContain('seller-chat-token');
        return new Response(Uint8Array.of(1, 2), {
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': '2',
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }),
    );

    try {
      const { client } = renderWithMsw(<SellerOrdersPage />, { route: '/seller/orders' });

      // 订单明细默认折叠：展开后再核对聊天截图控件
      for (const summary of await screen.findAllByText('订单明细（订单号、金额、汇率等，点开查看）')) {
        await userEvent.click(summary);
      }
      expect(await screen.findByText('展开聊天截图')).toBeTruthy();
      expect(await screen.findByRole('img', { name: '聊天截图商品 主图' })).toBeTruthy();
      expect(await screen.findByRole('img', { name: '订单截图' })).toBeTruthy();
      expect(screen.getAllByText('聊天截图')).toHaveLength(2);
      expect(screen.getByText('已上传')).toBeTruthy();
      expect(screen.getByText('暂无聊天截图')).toBeTruthy();
      expect(screen.queryByAltText('订单聊天截图')).toBeNull();
      expect(readIntentRequests).toBe(0);
      expect(contentRequests).toBe(0);
      expect(client.getQueryData(sellerQueryKeys.ordersPage(null, null))).toBeDefined();
      expect(client.getQueryData(['buyer', 'orders', 'all'])).toBeUndefined();

      await userEvent.click(screen.getByRole('button', { name: '展开聊天截图' }));
      expect(await screen.findByAltText('订单聊天截图')).toBeTruthy();
      expect(readIntentRequests).toBe(1);
      expect(contentRequests).toBe(1);

      await userEvent.click(screen.getByRole('button', { name: '查看大图：订单聊天截图' }));
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(
        JSON.stringify(
          client
            .getQueryCache()
            .getAll()
            .map((query) => query.state.data),
        ),
      ).not.toContain('seller-chat-token');
    } finally {
      if (originalCreateObjectUrl)
        Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl);
      else delete (URL as { createObjectURL?: unknown }).createObjectURL;
    }
  });

  it('preserves loaded orders and follows the opaque Seller cursor', async () => {
    const requests: string[] = [];
    server.use(
      http.get(apiUrl('/api/seller-portal/formal-orders'), ({ request }) => {
        const url = new URL(request.url);
        requests.push(url.search);
        const cursor = url.searchParams.get('cursor');
        return HttpResponse.json({
          data:
            cursor === null
              ? {
                  items: [{
                    ...formalOrder(),
                    product_name: '第一页订单',
                    order_screenshot: null,
                  }],
                  page: { limit: 100, next_cursor: 'opaque-seller-page-2' },
                }
              : {
                  items: [
                    {
                      ...formalOrder(),
                      formal_order_id: 'order-2',
                      product_name: '第二页订单',
                      order_screenshot: null,
                    },
                  ],
                  page: { limit: 100, next_cursor: null },
                },
          meta: { request_id: cursor === null ? 'seller-page-1' : 'seller-page-2' },
        });
      }),
    );

    renderWithMsw(<SellerOrdersPage />, { route: '/seller/orders' });
    expect(await screen.findByText('第一页订单')).toBeVisible();
    await userEvent.click(
      screen.getByRole('button', {
        name: '加载更多正式订单',
      }),
    );

    expect(await screen.findByText('第二页订单')).toBeVisible();
    expect(screen.getByText('第一页订单')).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(new URLSearchParams(requests[0]).get('cursor')).toBeNull();
    expect(new URLSearchParams(requests[1]).get('cursor')).toBe('opaque-seller-page-2');
  });

  it('does not render failed initial order reads as authoritative zero facts', async () => {
    server.use(
      http.get(apiUrl('/api/seller-portal/me'), () =>
        HttpResponse.json({
          data: { me: sellerMe() },
          meta: { request_id: 'seller-me' },
        }),
      ),
      http.get(apiUrl('/api/seller-portal/formal-orders'), () =>
        unavailable('seller-orders-unavailable'),
      ),
      http.get(apiUrl('/api/seller-portal/settlement/summary'), () =>
        HttpResponse.json({
          data: {
            settlement: {
              outstanding_principal_cny_fen: '0',
              outstanding_service_fee_cny_fen: '0',
              total_outstanding_cny_fen: '0',
              unallocated_credit_cny_fen: '0',
            },
          },
          meta: { request_id: 'seller-settlement' },
        }),
      ),
    );

    renderWithMsw(<SellerDashboardPage />, { route: '/seller' });
    expect(await screen.findByText('订单进度暂时不可用，刷新后重试。')).toBeVisible();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('暂无待完成订单')).not.toBeInTheDocument();
  });

  it('does not render a failed payable read as an empty financial ledger', async () => {
    server.use(
      http.get(apiUrl('/api/seller-portal/settlement/summary'), () =>
        HttpResponse.json({
          data: {
            settlement: {
              outstanding_principal_cny_fen: '100',
              outstanding_service_fee_cny_fen: '200',
              total_outstanding_cny_fen: '300',
              unallocated_credit_cny_fen: '0',
            },
          },
          meta: { request_id: 'seller-settlement' },
        }),
      ),
      http.get(apiUrl('/api/seller-portal/settlement/payables'), () =>
        unavailable('seller-payables-unavailable'),
      ),
    );

    renderWithMsw(<SellerSettlementsPage />, {
      route: '/seller/settlements',
    });
    expect(await screen.findByText('结算项目暂时用不了，刷新后重试。')).toBeVisible();
    expect(screen.queryByText('暂无结算项目')).not.toBeInTheDocument();
  });
});

function unavailable(requestId: string) {
  return HttpResponse.json(
    {
      error: {
        code: 'DEPENDENCY_UNAVAILABLE',
        message: '暂时不可用',
        details: null,
      },
      meta: { request_id: requestId },
    },
    { status: 503 },
  );
}

function sellerMe() {
  return {
    account_id: 'seller-account',
    member: {
      id: 'seller-member',
      display_name: '卖家',
      role: 'OPERATIONS',
      primary_owner: false,
    },
    organization: {
      id: 'seller-organization',
      seller_code: 'seller-1',
      name: '卖家组织',
      marketplace_code: 'JP',
      status: 'ACTIVE',
    },
    access: {
      read_scope: 'ASSIGNED_STORES',
      store_ids: ['store-1'],
      can_submit_product_applications: true,
      can_submit_demand_batches: true,
    },
  };
}

function formalOrder() {
  return {
    formal_order_id: 'order-1',
    status: 'CONFIRMED',
    legacy_projection: 'AMAZON',
    marketplace_code: 'JP',
    canonical_marketplace_code: 'AMAZON_JP',
    amazon_order_number: '111-1111111-1111111',
    platform_order_identifier: '111-1111111-1111111',
    store: { id: 'store-1', display_name: '店铺一' },
    asin: 'B012345678',
    platform_product_identifier: 'B012345678',
    main_image: null,
    order_screenshot: {
      file_object_id: 'seller-order-shot-1',
      file_version: 3,
    },
    product_name: '聊天截图商品',
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
      base_rate_confirmed_at: 1,
      base_rate_value: '5000000',
      base_rate_scale: '100000000',
      policy_version_id: 'policy-1',
      policy_scope_type: 'SELLER_ORGANIZATION',
      policy_seller_organization_id: 'seller-organization',
      policy_version_no: 1,
      policy_effective_from: 1,
      policy_confirmed_at: 1,
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
      confirmed_at: 1,
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
    chat_screenshot: { status: 'AVAILABLE', file_version: 2 },
    confirmed_at: 1,
    confirmed_business_date: '2026-08-01',
  };
}
