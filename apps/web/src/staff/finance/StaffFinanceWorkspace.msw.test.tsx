// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import '../../test/msw/lifecycle';
import { StaffSessionBoundary } from '../../auth/staff/StaffSessionBoundary';
import type { StaffAuthApiAdapter, StaffSession } from '../../auth/staff/staff-auth-api';
import { apiUrl } from '../../test/msw/handlers';
import { renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { StaffFinanceWorkspace } from './StaffFinanceWorkspace';

afterEach(cleanup);

describe('财务配置 Staff 工作台', () => {
  it('让 Owner 读取摘要、时间线并确认或拒绝待决策略', async () => {
    const requests: { path: string; body: unknown }[] = [];
    server.use(
      http.get(apiUrl('/api/staff/rate-center'), () =>
        HttpResponse.json({
          data: rateCenterPayload(),
          meta: { request_id: 'rate-center-read' },
        }),
      ),
      http.get(apiUrl('/api/staff/seller-service-fees'), () =>
        HttpResponse.json({
          data: serviceFeesPayload(),
          meta: { request_id: 'fees-read' },
        }),
      ),
      http.get(apiUrl('/api/staff/seller-principal-rate-policies'), () =>
        HttpResponse.json({
          data: { policies: readPayload() },
          meta: { request_id: 'policy-read' },
        }),
      ),
      http.post(
        apiUrl('/api/staff/seller-principal-rate-policies/:id/confirm'),
        async ({ request, params }) => {
          requests.push({ path: `confirm:${params['id']}`, body: await request.json() });
          return HttpResponse.json({
            data: { policy: policy('confirm-1', 'CONFIRMED', 2, '400000', null) },
            meta: { request_id: 'policy-confirm' },
          });
        },
      ),
      http.post(
        apiUrl('/api/staff/seller-principal-rate-policies/:id/reject'),
        async ({ request, params }) => {
          requests.push({ path: `reject:${params['id']}`, body: await request.json() });
          return HttpResponse.json({
            data: { policy: policy('reject-1', 'REJECTED', 2, '0', '不采用') },
            meta: { request_id: 'policy-reject' },
          });
        },
      ),
    );
    const user = userEvent.setup();
    renderWithMsw(
      <StaffSessionBoundary adapter={adapter(owner())}>
        <StaffFinanceWorkspace />
      </StaffSessionBoundary>,
      {
        route: '/staff/finance',
      },
    );
    expect(await screen.findByRole('heading', { name: '财务配置' })).toBeVisible();
    await screen.findByRole('option', { name: '测试卖家 · AMAZON_JP' });
    await user.selectOptions(screen.getByLabelText('卖家组织'), 'seller-1');
    expect(screen.getAllByText('币种对默认加点')[0]).toBeVisible();
    expect(screen.getByText('卖家组织覆盖 · +0.0 · v1')).toBeVisible();
    expect(screen.getByRole('heading', { name: '当前生效摘要' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '生效时间线' })).toBeVisible();
    // Two pending policies from the fixture render as timeline entries.
    expect(screen.getAllByText('待确认').length).toBeGreaterThanOrEqual(2);
    await user.click(screen.getAllByRole('button', { name: '确认生效策略' })[0]!);
    await waitFor(() => expect(requests).toHaveLength(1));
    await user.click(screen.getAllByRole('button', { name: '拒绝' })[1]!);
    await waitFor(() =>
      expect(requests).toEqual([
        { path: 'confirm:pending-default', body: { expected_version: 1 } },
        {
          path: 'reject:pending-override',
          body: { expected_version: 1, rejection_reason: 'Owner 在 Staff 工作台拒绝' },
        },
      ]),
    );
  });

  it('让卖家对接为已分配组织提交明确为 0 的覆盖，并携带版本与幂等请求', async () => {
    let body: unknown;
    let key: string | null = null;
    server.use(
      http.get(apiUrl('/api/staff/rate-center'), () =>
        HttpResponse.json({
          data: rateCenterPayload(),
          meta: { request_id: 'rate-center-read' },
        }),
      ),
      http.get(apiUrl('/api/staff/seller-service-fees'), () =>
        HttpResponse.json({
          data: serviceFeesPayload(),
          meta: { request_id: 'fees-read' },
        }),
      ),
      http.get(apiUrl('/api/staff/seller-principal-rate-policies'), () =>
        HttpResponse.json({
          data: {
            policies: readPayload({
              default_pending_policy: null,
              seller_override_pending_policy: null,
            }),
          },
          meta: { request_id: 'policy-read' },
        }),
      ),
      http.post(apiUrl('/api/staff/seller-principal-rate-policies/submit'), async ({ request }) => {
        body = await request.json();
        key = request.headers.get('Idempotency-Key');
        return HttpResponse.json({
          data: { policy: policy('submitted-1', 'SUBMITTED', 1, '0', null) },
          meta: { request_id: 'policy-submit' },
        });
      }),
    );
    const user = userEvent.setup();
    renderWithMsw(
      <StaffSessionBoundary adapter={adapter(sellerOps())}>
        <StaffFinanceWorkspace />
      </StaffSessionBoundary>,
      {
        route: '/staff/finance',
      },
    );
    expect(await screen.findByRole('heading', { name: '财务配置' })).toBeVisible();
    await screen.findByRole('option', { name: '测试卖家 · AMAZON_JP' });
    await user.selectOptions(screen.getByLabelText('卖家组织'), 'seller-1');
    await screen.findByRole('heading', { name: '币种对默认加点' });
    await user.clear(screen.getByLabelText('卖家本金汇率加点（例如 +0.004 或 0）'));
    await user.type(screen.getByLabelText('卖家本金汇率加点（例如 +0.004 或 0）'), '0');
    await user.click(screen.getByRole('button', { name: '提交待确认策略' }));
    await waitFor(() =>
      expect(body).toMatchObject({
        scope_type: 'SELLER_ORGANIZATION',
        seller_organization_id: 'seller-1',
        source_currency_code: 'JPY',
        markup_rate_value: '0',
      }),
    );
    expect(key).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('让 Owner 提交默认加点并立即生效（免二次确认文案）', async () => {
    let body: unknown;
    let requestedOrganization: string | null = null;
    server.use(
      http.get(apiUrl('/api/staff/rate-center'), () =>
        HttpResponse.json({
          data: rateCenterPayload(),
          meta: { request_id: 'rate-center-read' },
        }),
      ),
      http.get(apiUrl('/api/staff/seller-service-fees'), () =>
        HttpResponse.json({
          data: serviceFeesPayload(),
          meta: { request_id: 'fees-read' },
        }),
      ),
      http.get(apiUrl('/api/staff/seller-principal-rate-policies'), ({ request }) => {
        requestedOrganization = new URL(request.url).searchParams.get('seller_organization_id');
        return HttpResponse.json({
          data: {
            policies: readPayload({
              seller_organization_id: null,
              seller_override_policy: null,
              default_pending_policy: null,
              seller_override_pending_policy: null,
              seller_override_next_version: null,
              selected_policy: policy('default-1', 'CONFIRMED', 2, '400000', null),
            }),
          },
          meta: { request_id: 'owner-read' },
        });
      }),
      http.post(apiUrl('/api/staff/seller-principal-rate-policies/submit'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          data: { policy: policy('submitted-default', 'CONFIRMED', 2, '400000', null) },
          meta: { request_id: 'owner-submit' },
        });
      }),
    );
    const user = userEvent.setup();
    renderWithMsw(
      <StaffSessionBoundary adapter={adapter(owner())}>
        <StaffFinanceWorkspace />
      </StaffSessionBoundary>,
      {
        route: '/staff/finance',
      },
    );
    await screen.findByRole('heading', { name: '财务配置' });
    await screen.findByRole('heading', { name: '币种对默认加点' });
    expect(requestedOrganization).toBeNull();
    expect(screen.getByText('下一版本：选择组织后读取')).toBeVisible();
    expect(
      screen.getByText(/默认加点提交即确认生效，无需 Owner 二次确认/u),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: '提交并生效' }));
    await waitFor(() =>
      expect(body).toMatchObject({
        scope_type: 'CURRENCY_PAIR_DEFAULT',
        seller_organization_id: null,
        source_currency_code: 'JPY',
        markup_rate_value: '0.004',
      }),
    );
  });

  it('回查历史日期时按 as_of 请求并在页面上标注回查口径', async () => {
    const policySearches: string[] = [];
    const feeSearches: string[] = [];
    server.use(
      http.get(apiUrl('/api/staff/rate-center'), () =>
        HttpResponse.json({
          data: rateCenterPayload({ business_date: '2026-08-01' }),
          meta: { request_id: 'rate-center-read' },
        }),
      ),
      http.get(apiUrl('/api/staff/seller-service-fees'), ({ request }) => {
        feeSearches.push(new URL(request.url).search);
        return HttpResponse.json({
          data: serviceFeesPayload(),
          meta: { request_id: 'fees-read' },
        });
      }),
      http.get(apiUrl('/api/staff/seller-principal-rate-policies'), ({ request }) => {
        policySearches.push(new URL(request.url).search);
        return HttpResponse.json({
          data: {
            policies: readPayload({
              default_pending_policy: null,
              seller_override_pending_policy: null,
            }),
          },
          meta: { request_id: 'policy-read' },
        });
      }),
    );
    renderWithMsw(
      <StaffSessionBoundary adapter={adapter(owner())}>
        <StaffFinanceWorkspace />
      </StaffSessionBoundary>,
      {
        route: '/staff/finance?business_date=2026-08-01&seller_organization_id=seller-1&section=base-rate',
      },
    );
    await screen.findByRole('heading', { name: '财务配置' });
    await waitFor(() =>
      expect(screen.getByText(/正在回查 2026-08-01/u)).toBeVisible(),
    );
    await waitFor(() => expect(policySearches.length).toBeGreaterThan(0));
    expect(policySearches[0]).toContain('as_of=');
    await waitFor(() => expect(feeSearches.length).toBeGreaterThan(0));
    expect(feeSearches[0]).toContain('as_of=');
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

function session(role: 'owner' | 'seller_ops', permissions: string[]): StaffSession {
  return {
    staff_id: 'staff-1',
    display_name: '测试员工',
    role:
      role === 'owner'
        ? { code: 'owner', display_name: '总管理员' }
        : { code: 'seller_ops', display_name: '卖家对接' },
    permissions,
    data_scope:
      role === 'owner'
        ? {
            type: 'GLOBAL',
            marketplaceCodes: [],
            buyerCustomerIds: [],
            sellerOrganizationIds: [],
            teamIds: [],
          }
        : {
            type: 'ASSIGNED_SELLER_ORGANIZATIONS',
            marketplaceCodes: ['AMAZON_JP'],
            buyerCustomerIds: [],
            sellerOrganizationIds: ['seller-1'],
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
function sellerOps(): StaffSession {
  return session('seller_ops', ['SELLER_MANAGE']);
}

function policy(
  id: string,
  status: 'SUBMITTED' | 'CONFIRMED' | 'REJECTED',
  version: number,
  markup: string,
  rejection: string | null,
) {
  return {
    policy_version_id: id,
    scope_type: id.includes('override') ? 'SELLER_ORGANIZATION' : 'CURRENCY_PAIR_DEFAULT',
    seller_organization_id: id.includes('override') ? 'seller-1' : null,
    source_currency_code: 'JPY',
    quote_currency_code: 'CNY',
    version_no: 1,
    decision_version: version,
    status,
    markup_rate_value: markup,
    markup_rate_scale: '100000000',
    effective_from: 1_900_000_000_000,
    submitted_at: 1_800_000_000_000,
    confirmed_at: status === 'CONFIRMED' ? 1_800_000_000_001 : null,
    rejection_reason: rejection,
    replayed: false,
  };
}

function readPayload(overrides: Record<string, unknown> = {}) {
  return {
    source_currency_code: 'JPY',
    quote_currency_code: 'CNY',
    seller_organization_id: 'seller-1',
    default_policy: policy('default-1', 'CONFIRMED', 2, '400000', null),
    seller_override_policy: policy('override-1', 'CONFIRMED', 2, '0', null),
    default_pending_policy: policy('pending-default', 'SUBMITTED', 1, '400000', null),
    seller_override_pending_policy: policy('pending-override', 'SUBMITTED', 1, '0', null),
    default_next_version: 2,
    seller_override_next_version: 2,
    selected_policy: policy('override-1', 'CONFIRMED', 2, '0', null),
    default_upcoming_policy: null,
    seller_override_upcoming_policy: null,
    ...overrides,
  };
}

function serviceFeesPayload() {
  return {
    seller_organization_id: 'seller-1',
    fees: ['RATING', 'TEXT', 'IMAGE', 'VIDEO'].map((reviewType) => ({
      review_type: reviewType,
      effective_fee: null,
      pending_fee: null,
      upcoming_fee: null,
      next_version: 1,
    })),
  };
}

function rateCenterPayload(overrides: Record<string, unknown> = {}) {
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
    seller_organizations: [
      {
        seller_organization_id: 'seller-1',
        seller_organization_name: '测试卖家',
        marketplace_code: 'AMAZON_JP',
      },
    ],
    policies: readPayload(),
    ...overrides,
  };
}
