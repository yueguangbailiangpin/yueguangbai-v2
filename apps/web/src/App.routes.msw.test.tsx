// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { AppRoutes } from './App';
import { staffSessionEnvelopeFixture, staffSessionFixture } from './test/msw/fixtures';
import { apiUrl } from './test/msw/handlers';
import './test/msw/lifecycle';
import { renderWithMsw } from './test/msw/render';
import { server } from './test/msw/server';

afterEach(cleanup);

describe('application route registration', () => {
  it('mounts the finance configuration workspace under /staff/finance', async () => {
    server.use(
      http.get(apiUrl('/api/staff-auth/session'), () =>
        HttpResponse.json(
          staffSessionEnvelopeFixture(
            {
              ...staffSessionFixture,
              permissions: ['SELLER_MANAGE', 'FINANCIAL_CORRECT'],
            },
            'request-staff-finance-route',
          ),
        ),
      ),
      http.get(apiUrl('/api/staff/rate-center'), () =>
        HttpResponse.json({
          data: rateCenterFixture(),
          meta: { request_id: 'request-staff-finance-read' },
        }),
      ),
      http.get(apiUrl('/api/staff/seller-principal-rate-policies'), () =>
        HttpResponse.json({
          data: {
            policies: {
              source_currency_code: 'JPY',
              quote_currency_code: 'CNY',
              seller_organization_id: null,
              default_policy: null,
              seller_override_policy: null,
              default_next_version: 1,
              seller_override_next_version: null,
              selected_policy: null,
            },
          },
          meta: { request_id: 'request-staff-finance-policies' },
        }),
      ),
    );

    renderWithMsw(<AppRoutes />, { route: '/staff/finance' });

    // 页面标题“财务”由 Shell 渲染；工作台内以区块标题为准（7F-1）。
    expect(
      await screen.findByRole('heading', {
        level: 3,
        name: '今天生效',
      }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { level: 3, name: '今天生效' })).toBeVisible();
  });

  it('mounts the buyer refund workbench under /staff/refunds', async () => {
    server.use(
      http.get(apiUrl('/api/staff-auth/session'), () =>
        HttpResponse.json(
          staffSessionEnvelopeFixture(staffSessionFixture, 'request-staff-refunds-route'),
        ),
      ),
      http.get(apiUrl('/api/staff/buyer-refunds'), () =>
        HttpResponse.json({
          data: {
            items: [
              {
                obligation_id: 'route-refund-1',
                buyer_customer_id: 'buyer-1',
                formal_order_id: 'order-1',
                due_amount_cny_fen: '10000',
                gross_paid_cny_fen: '5000',
                reversed_cny_fen: '0',
                net_paid_cny_fen: '5000',
                outstanding_amount_cny_fen: '5000',
                overpaid_amount_cny_fen: '0',
                status: 'PARTIALLY_PAID',
                version: 2,
                created_at: 1_787_000_000_000,
                updated_at: 1_787_000_000_000,
                review_approved_at: 1_787_000_000_000,
                promise_deadline_at: 1_787_606_400_000,
                reminder_count: 0,
                last_reminded_at: null,
                buyer: { buyer_customer_id: 'buyer-1', buyer_customer_no: 'B-1' },
                order: {
                  formal_order_id: 'order-1',
                  marketplace: 'AMAZON_JP',
                  amazon_order_number_normalized: '503-5555555-6666666',
                  product_id: 'product-1',
                  asin: 'B000000001',
                },
                workflow: {
                  work_item_id: null,
                  assigned_staff_id: null,
                  assigned_team_id: null,
                  fixed_assignment_id: null,
                },
              },
            ],
            next_cursor: null,
          },
          meta: { request_id: 'request-staff-refunds-list' },
        }),
      ),
    );

    renderWithMsw(<AppRoutes />, { route: '/staff/refunds' });

    // 页面标题“买家返款”由 Shell 渲染；工作台以记录行为准（7F-1）。
    expect(await screen.findByText(/待结清 \d+ 笔/u)).toBeVisible();
    expect(await screen.findByRole('link', { name: '去处理' })).toHaveAttribute(
      'href',
      '/staff/refunds/route-refund-1',
    );
  });

  it('redirects the legacy rate center paths to /staff/finance with the query intact', async () => {
    server.use(
      http.get(apiUrl('/api/staff-auth/session'), () =>
        HttpResponse.json(
          staffSessionEnvelopeFixture(
            {
              ...staffSessionFixture,
              permissions: ['SELLER_MANAGE', 'FINANCIAL_CORRECT'],
            },
            'request-staff-rate-center-redirect',
          ),
        ),
      ),
      http.get(apiUrl('/api/staff/rate-center'), () =>
        HttpResponse.json({
          data: rateCenterFixture({ business_date: '2026-08-01' }),
          meta: { request_id: 'request-staff-rate-center-redirect-read' },
        }),
      ),
      http.get(apiUrl('/api/staff/seller-principal-rate-policies'), () =>
        HttpResponse.json({
          data: {
            policies: {
              source_currency_code: 'JPY',
              quote_currency_code: 'CNY',
              seller_organization_id: null,
              default_policy: null,
              seller_override_policy: null,
              default_next_version: 1,
              seller_override_next_version: null,
              selected_policy: null,
            },
          },
          meta: { request_id: 'request-staff-rate-center-redirect-policies' },
        }),
      ),
      http.get(apiUrl('/api/staff/seller-service-fees'), () =>
        HttpResponse.json({
          data: {
            seller_organization_id: '',
            fees: (['RATING', 'TEXT', 'IMAGE', 'VIDEO'] as const).map((review_type) => ({
              review_type,
              effective_fee: null,
              next_version: 1,
            })),
          },
          meta: { request_id: 'request-staff-rate-center-redirect-fees' },
        }),
      ),
    );

    renderWithMsw(<AppRoutes />, {
      route: '/staff/rate-center?section=base-rate&business_date=2026-08-01',
    });

    // 重定向后 Shell 渲染财务页标题，且回查参数原样到达（7F-1）。
    expect(await screen.findByRole('heading', { name: '财务' })).toBeVisible();
    expect(
      await screen.findByText(/基础汇率、加点、服务费共同决定/u),
    ).toBeVisible();
    expect(await screen.findByLabelText('订单日期（回查）')).toHaveValue('2026-08-01');
  });

  it('labels the Staff navigation with the seven approved sections and retired names', async () => {
    server.use(
      http.get(apiUrl('/api/staff-auth/session'), () =>
        HttpResponse.json(
          staffSessionEnvelopeFixture(
            {
              ...staffSessionFixture,
              permissions: ['SELLER_MANAGE', 'FINANCIAL_CORRECT', 'STAFF_MANAGE', 'FINANCIAL_VIEW'],
            },
            'request-staff-nav-route',
          ),
        ),
      ),
      http.get(apiUrl('/api/staff/me/work-items'), () =>
        HttpResponse.json({
          data: { work_items: [], next_cursor: null },
          meta: { request_id: 'request-staff-nav-work-items' },
        }),
      ),
      http.get(apiUrl('/api/staff/me/work-items/summary'), () =>
        HttpResponse.json({
          data: {
            summary: {
              open_count: 0,
              due_today_count: 0,
              overdue_count: 0,
              exception_order_count: 0,
              refund_due_today_cny_fen: null,
              recent: [],
            },
          },
          meta: { request_id: 'request-staff-nav-summary' },
        }),
      ),
      http.get(apiUrl('/api/staff/admin-business-dashboard/summary'), () =>
        HttpResponse.json(
          {
            data: {
              summary: {
                window: {
                  key: 'TODAY',
                  from_date: '2026-08-29',
                  to_date: '2026-08-29',
                  timezone: 'Asia/Shanghai',
                  data_as_of: 0,
                },
                cards: { new_customers_buyer: 0, new_customers_seller: 0, reservations: 0, formal_orders: 0 },
                pending: { buyer_refunds: 0, seller_settlements: 0 },
                overdue: { open_work_items: 0, finance_exceptions: 0 },
                owner_summary: {
                  projected_profit: { amount_cny_fen: '0', valid_order_count: 0, conflict_order_count: 0 },
                  completed_profit: { amount_cny_fen: '0', valid_order_count: 0, conflict_order_count: 0 },
                },
              },
            },
            meta: { request_id: 'request-staff-nav-dashboard' },
          },
        ),
      ),
    );

    renderWithMsw(<AppRoutes />, { route: '/staff' });

    const nav = await screen.findByRole('navigation', { name: '员工工作台主导航' });
    // 7F-1 信息架构：客户两项平级、无规划中占位。
    for (const label of [
      '工作台',
      '买家客户',
      '卖家客户',
      '产品与预约',
      '订单',
      '买家返款',
      '财务',
      '员工与权限',
      '系统设置',
      '经营看板',
      '客服渠道',
    ]) {
      expect(screen.getAllByText(label).some((node) => nav.contains(node))).toBe(true);
    }
    // 旧叫法与已退役入口不允许再出现在导航。
    for (const retired of ['产品库', '汇率中心', '客户开发', '工作队列', '员工管理', '产品与投放', '买家与订单', '财务配置', '员工与访问管理', '运行完整性工具', '获客', '认领', '可认领', '规划中', '评论与凭证', '卖家结算', '文件归档']) {
      expect(nav.textContent).not.toContain(retired);
    }
  });

  it('retired /staff/operations falls through to the workbench, not a standalone tool page', async () => {
    server.use(
      http.get(apiUrl('/api/staff-auth/session'), () =>
        HttpResponse.json(
          staffSessionEnvelopeFixture(staffSessionFixture, 'request-staff-operations-route'),
        ),
      ),
      http.get(apiUrl('/api/staff/me/work-items'), () =>
        HttpResponse.json({
          data: { work_items: [], next_cursor: null },
          meta: { request_id: 'request-staff-operations-fallback' },
        }),
      ),
    );

    renderWithMsw(<AppRoutes />, { route: '/staff/operations' });

    // 旧路径已从路由表移除：StaffRouteModule 兜底渲染工作台。
    expect(await screen.findByText((_, element) =>
      element?.matches('.sp-hello__summary')
      && /今天有 \d+ 件固定分配给你的工作/u.test(element.textContent ?? ''),
    )).toBeVisible();
    expect(screen.queryByRole('heading', { name: '业务完整性工具' })).not.toBeInTheDocument();
  });
});

function rateCenterFixture(overrides: Record<string, unknown> = {}) {
  return {
    business_date: '2026-08-22',
    source_currency_code: 'JPY',
    quote_currency_code: 'CNY',
    base_rate: {
      business_date: '2026-08-22',
      versions: [],
      active_version: null,
      next_version: 1,
    },
    seller_organizations: [],
    policies: {
      source_currency_code: 'JPY',
      quote_currency_code: 'CNY',
      seller_organization_id: null,
      default_policy: null,
      seller_override_policy: null,
      default_next_version: 1,
      seller_override_next_version: null,
      selected_policy: null,
    },
    ...overrides,
  };
}
