// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import '../../test/msw/lifecycle';
import { StaffSessionBoundary } from '../../auth/staff/StaffSessionBoundary';
import type { StaffAuthApiAdapter, StaffSession } from '../../auth/staff/staff-auth-api';
import { apiUrl } from '../../test/msw/handlers';
import { renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { RateSummaryCard } from './RateSummaryCard';

afterEach(cleanup);

describe('RateSummaryCard', () => {
  it('shows the effective rate facts with missing facts highlighted and a finance link', async () => {
    server.use(
      http.get(apiUrl('/api/staff/rate-center'), () =>
        HttpResponse.json({
          data: {
            business_date: '2026-08-22',
            source_currency_code: 'JPY',
            quote_currency_code: 'CNY',
            base_rate: {
              business_date: '2026-08-22',
              versions: [
                {
                  rate_version_id: 'rate-1',
                  business_date: '2026-08-22',
                  version_no: 1,
                  rate_value: '4600000',
                  rate_scale: '100000000',
                  created_by_staff_id: 'staff-1',
                  created_at: 1_787_424_000_000,
                },
              ],
              active_version: {
                rate_version_id: 'rate-1',
                business_date: '2026-08-22',
                version_no: 1,
                rate_value: '4600000',
                rate_scale: '100000000',
                created_by_staff_id: 'staff-1',
                created_at: 1_787_424_000_000,
              },
              next_version: 2,
            },
            seller_organizations: [
              {
                seller_organization_id: 'seller-1',
                seller_organization_name: '测试卖家',
                marketplace_code: 'AMAZON_JP',
              },
            ],
            policies: {
              source_currency_code: 'JPY',
              quote_currency_code: 'CNY',
              seller_organization_id: 'seller-1',
              default_policy: null,
              seller_override_policy: null,
              default_next_version: 1,
              seller_override_next_version: 1,
              selected_policy: null,
            },
          },
          meta: { request_id: 'rate-summary-read' },
        }),
      ),
      http.get(apiUrl('/api/staff/seller-service-fees'), () =>
        HttpResponse.json({
          data: {
            seller_organization_id: 'seller-1',
            fees: ['RATING', 'TEXT', 'IMAGE', 'VIDEO'].map((reviewType, index) => ({
              review_type: reviewType,
              effective_fee: index === 0
                ? {
                    rule_version_id: 'fee-1',
                    version_no: 1,
                    fee_cny_fen: '1250',
                    effective_from: 1_787_000_000_000,
                    created_at: 1_787_000_000_001,
                  }
                : null,
              next_version: index === 0 ? 2 : 1,
            })),
          },
          meta: { request_id: 'rate-summary-fees' },
        }),
      ),
    );
    renderWithMsw(
      <StaffSessionBoundary adapter={adapter(owner())}>
        <RateSummaryCard organizationId="seller-1" />
      </StaffSessionBoundary>,
      { route: '/staff/seller-customers' },
    );
    expect(await screen.findByRole('heading', { name: '当前生效费率' })).toBeVisible();
    expect(await screen.findByText(/0\.046 CNY \/ JPY/u)).toBeVisible();
    // Fees render for the first rate-center-visible organization.
    expect(await screen.findByText(/服务费（测试卖家）/u)).toBeVisible();
    expect(await screen.findByText(/评分单 ¥12\.50；/u)).toBeVisible();
    expect(screen.getAllByText(/未配置/u).length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole('link', { name: '管理财务配置' })).toHaveAttribute(
      'href',
      '/staff/finance',
    );
  });

  it('renders nothing for roles without SELLER_MANAGE', () => {
    renderWithMsw(
      <StaffSessionBoundary adapter={adapter(preSales())}>
        <RateSummaryCard organizationId={null} />
      </StaffSessionBoundary>,
      { route: '/staff/products' },
    );
    expect(screen.queryByRole('heading', { name: '当前生效费率' })).toBeNull();
  });
});

function adapter(value: StaffSession): StaffAuthApiAdapter {
  return {
    bootstrap: async () => ({
      data: { session: value, access_email: 'staff@example.com' },
      requestId: 'bootstrap',
    }),
    readSession: async () => ({ data: { session: value }, requestId: 'session' }),
    logout: async () => ({
      data: { logged_out: true, all_devices_logged_out: false },
      requestId: 'logout',
    }),
    logoutAll: async () => ({
      data: { logged_out: true, all_devices_logged_out: true, session_version: 2 },
      requestId: 'logout-all',
    }),
  };
}

function session(roleCode: 'owner' | 'pre_sales', permissions: string[]): StaffSession {
  return {
    staff_id: 'staff-1',
    display_name: '测试员工',
    role:
      roleCode === 'owner'
        ? { code: 'owner' as const, display_name: '总管理员' }
        : { code: 'pre_sales' as const, display_name: '售前' },
    permissions,
    data_scope: {
      type: 'GLOBAL',
      marketplaceCodes: [],
      buyerCustomerIds: [],
      sellerOrganizationIds: [],
      teamIds: [],
    },
    authorization_version: 1,
    session_version: 1,
    expires_at: Date.now() + 100_000,
  };
}

function owner(): StaffSession {
  return session('owner', ['SELLER_MANAGE', 'FINANCIAL_CORRECT']);
}
function preSales(): StaffSession {
  return session('pre_sales', ['ORDER_VIEW']);
}
