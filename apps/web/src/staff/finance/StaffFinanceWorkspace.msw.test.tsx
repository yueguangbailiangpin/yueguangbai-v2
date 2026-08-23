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
  it('Owner 在顶部待办条里确认/拒绝待决策略，并看到一单示例', async () => {
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
    await user.selectOptions(screen.getByLabelText('针对卖家组织'), 'seller-1');
    // 顶部待办条：缺口 + 待决
    expect(
      await screen.findByText(/服务费未配置：测试卖家 还有 4\/4 类评价类型未配/u),
    ).toBeVisible();
    expect(await screen.findByText(/全体卖家加点 · \+0\.004 待你确认/u)).toBeVisible();
    expect(await screen.findByText(/测试卖家单独加点 · \+0\.0 待你确认/u)).toBeVisible();
    // 一单示例
    expect(await screen.findByRole('heading', { name: '今天生效' })).toBeVisible();
    expect(await screen.findByText(/一单 ¥3,000 日元（评分单）为例/u)).toBeVisible();
    expect(await screen.findByRole('heading', { name: '接下来的变更' })).toBeVisible();
    await user.click(screen.getAllByRole('button', { name: '确认生效' })[0]!);
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

  it('卖家对接为已分配组织提交明确为 0 的单独加点，携带幂等键', async () => {
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
    await user.click(await screen.findByRole('button', { name: '单独设置' }));
    const markupInput = screen.getByLabelText('加点（例如 +0.005 或 0）');
    await user.clear(markupInput);
    await user.type(markupInput, '0');
    await user.click(screen.getByRole('button', { name: '提交待确认' }));
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

  it('Owner 修改全体卖家加点：提交即生效，无需他人确认', async () => {
    let body: unknown;
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
              seller_organization_id: null,
              seller_override_policy: null,
              default_pending_policy: null,
              seller_override_pending_policy: null,
              seller_override_next_version: null,
              selected_policy: policy('default-1', 'CONFIRMED', 2, '400000', null),
            }),
          },
          meta: { request_id: 'policy-read' },
        }),
      ),
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
    await screen.findByText('全体卖家');
    await user.click(screen.getByRole('button', { name: '修改' }));
    expect(screen.getByText(/提交后立即确认，到生效时间自动生效/u)).toBeVisible();
    const markupInput = screen.getByLabelText('加点（例如 +0.004 或 0）');
    await user.clear(markupInput);
    await user.type(markupInput, '0.004');
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

  it('回查历史日期时按 as_of 请求并标注回查口径', async () => {
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
    await waitFor(() => expect(screen.getByText(/正在回查 2026-08-01/u)).toBeTruthy());
    expect(await screen.findByRole('heading', { name: /回查 2026-08-01 生效/u })).toBeVisible();
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
