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
  it('mounts the approved Staff rate center workspace', async () => {
    server.use(
      http.get(apiUrl('/api/staff-auth/session'), () =>
        HttpResponse.json(
          staffSessionEnvelopeFixture(
            {
              ...staffSessionFixture,
              permissions: ['SELLER_MANAGE', 'FINANCIAL_CORRECT'],
            },
            'request-staff-rate-center-route',
          ),
        ),
      ),
      http.get(apiUrl('/api/staff/rate-center'), () =>
        HttpResponse.json({
          data: rateCenterFixture(),
          meta: { request_id: 'request-staff-rate-center-read' },
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
              default_pending_policy: null,
              seller_override_pending_policy: null,
              default_next_version: 1,
              seller_override_next_version: null,
              selected_policy: null,
            },
          },
          meta: { request_id: 'request-staff-rate-center-policies' },
        }),
      ),
    );

    renderWithMsw(<AppRoutes />, { route: '/staff/rate-center' });

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: '汇率中心',
      }),
    ).toBeVisible();
  });

  it('labels the Staff navigation with the seven approved sections and retired names', async () => {
    server.use(
      http.get(apiUrl('/api/staff-auth/session'), () =>
        HttpResponse.json(
          staffSessionEnvelopeFixture(
            {
              ...staffSessionFixture,
              permissions: ['SELLER_MANAGE', 'FINANCIAL_CORRECT', 'STAFF_MANAGE'],
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
    );

    renderWithMsw(<AppRoutes />, { route: '/staff' });

    const nav = await screen.findByRole('navigation', { name: '员工工作台导航' });
    for (const label of [
      '工作台',
      '获客',
      '卖家',
      '产品与投放',
      '买家与订单',
      '财务配置',
      '系统',
      '员工与访问管理',
      '经营看板',
      '运行完整性工具',
    ]) {
      expect(screen.getAllByText(label).some((node) => nav.contains(node))).toBe(true);
    }
    // 旧叫法只允许出现在过渡期页面内容里（如汇率中心页内 h2），不允许再出现在导航。
    for (const retired of ['产品库', '汇率中心', '客户开发', '工作队列', '买家客户', '卖家客户', '员工管理']) {
      expect(nav.textContent).not.toContain(retired);
    }
  });

  it('mounts the operating integrity tools under /staff/operations', async () => {
    server.use(
      http.get(apiUrl('/api/staff-auth/session'), () =>
        HttpResponse.json(
          staffSessionEnvelopeFixture(staffSessionFixture, 'request-staff-operations-route'),
        ),
      ),
    );

    renderWithMsw(<AppRoutes />, { route: '/staff/operations' });

    expect(
      await screen.findByRole('heading', { level: 2, name: '业务完整性工具' }),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 1, name: '运行完整性工具' }),
    ).toBeVisible();
  });
});

function rateCenterFixture() {
  return {
    business_date: '2026-08-22',
    source_currency_code: 'JPY',
    quote_currency_code: 'CNY',
    base_rate: {
      business_date: '2026-08-22',
      confirmed_rate: null,
      pending_rate: null,
      next_version: 1,
    },
    seller_organizations: [],
    policies: {
      source_currency_code: 'JPY',
      quote_currency_code: 'CNY',
      seller_organization_id: null,
      default_policy: null,
      seller_override_policy: null,
      default_pending_policy: null,
      seller_override_pending_policy: null,
      default_next_version: 1,
      seller_override_next_version: null,
      selected_policy: null,
    },
  };
}
