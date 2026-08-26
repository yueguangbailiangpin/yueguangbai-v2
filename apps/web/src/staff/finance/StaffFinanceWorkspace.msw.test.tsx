// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import '../../test/msw/lifecycle';
import { StaffSessionBoundary } from '../../auth/staff/StaffSessionBoundary';
import { chinaDate, shiftChinaDate } from './finance-format';
import type { StaffAuthApiAdapter, StaffSession } from '../../auth/staff/staff-auth-api';
import { apiUrl } from '../../test/msw/handlers';
import { renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { StaffFinanceWorkspace } from './StaffFinanceWorkspace';

afterEach(cleanup);

describe('财务配置 Staff 工作台（D-056 单次保存模型）', () => {
  it('卖家对接保存明确为 0 的单独加点：单次保存立即生效并携带幂等键（无确认步骤）', async () => {
    const posts: string[] = [];
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
          data: { policies: readPayload() },
          meta: { request_id: 'policy-read' },
        }),
      ),
      http.post(apiUrl('/api/staff/seller-principal-rate-policies/save'), async ({ request }) => {
        posts.push('policy-save');
        body = await request.json();
        key = request.headers.get('Idempotency-Key');
        return HttpResponse.json({
          data: { policy: policy('saved-override', 'SELLER_ORGANIZATION', 2, '0') },
          meta: { request_id: 'policy-save' },
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
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(body).toMatchObject({
        scope_type: 'SELLER_ORGANIZATION',
        seller_organization_id: 'seller-1',
        source_currency_code: 'JPY',
        markup_rate_value: '0',
        expected_version: 1,
      }),
    );
    // 单次保存模型：请求体不再携带 effective_from。
    expect(body).not.toHaveProperty('effective_from');
    expect(key).toMatch(/^[0-9a-f-]{36}$/u);
    // 保存即生效的提示，且没有确认按钮。
    expect(await screen.findByText('已保存，立即生效。')).toBeVisible();
    expect(screen.queryByRole('button', { name: '确认生效' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '拒绝' })).not.toBeInTheDocument();
    await waitFor(() => expect(posts).toEqual(['policy-save']));
  });

  it('Owner 保存全体默认加点：不再发送生效时间，保存后立即生效', async () => {
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
              seller_override_next_version: null,
              selected_policy: policy('default-1', 'CURRENCY_PAIR_DEFAULT', 2, '400000'),
            }),
          },
          meta: { request_id: 'policy-read' },
        }),
      ),
      http.post(apiUrl('/api/staff/seller-principal-rate-policies/save'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          data: {
            policy: policy('saved-default', 'CURRENCY_PAIR_DEFAULT', 3, '400000'),
          },
          meta: { request_id: 'owner-save' },
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
    const markupInput = screen.getByLabelText('加点（例如 +0.004 或 0）');
    await user.clear(markupInput);
    await user.type(markupInput, '0.004');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(body).toMatchObject({
        scope_type: 'CURRENCY_PAIR_DEFAULT',
        seller_organization_id: null,
        source_currency_code: 'JPY',
        markup_rate_value: '0.004',
        expected_version: 1,
      }),
    );
    expect(body).not.toHaveProperty('effective_from');
    expect(await screen.findByText('已保存，立即生效。')).toBeVisible();
  });

  it('版本冲突会浮现错误信息而不是静默失败', async () => {
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
              seller_override_next_version: null,
              selected_policy: policy('default-1', 'CURRENCY_PAIR_DEFAULT', 2, '400000'),
            }),
          },
          meta: { request_id: 'policy-read' },
        }),
      ),
      http.post(apiUrl('/api/staff/seller-principal-rate-policies/save'), () =>
        HttpResponse.json(
          {
            error: { code: 'VERSION_CONFLICT', message: '配置已发生变化，请刷新后重试', details: null },
            meta: { request_id: 'policy-save-conflict' },
          },
          { status: 409 },
        ),
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
    await screen.findByRole('heading', { name: '财务配置' });
    await screen.findByText('全体卖家');
    await user.click(screen.getByRole('button', { name: '修改' }));
    const markupInput = screen.getByLabelText('加点（例如 +0.004 或 0）');
    await user.clear(markupInput);
    await user.type(markupInput, '0.004');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText(/操作未完成（VERSION_CONFLICT）/u)).toBeVisible();
  });

  it('Owner 保存服务费：不再发送生效时间，也没有一键补默认入口', async () => {
    const posts: string[] = [];
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
          data: { policies: readPayload() },
          meta: { request_id: 'policy-read' },
        }),
      ),
      http.post(apiUrl('/api/staff/seller-service-fees'), async ({ request }) => {
        posts.push('fee-save');
        body = await request.json();
        return HttpResponse.json({
          data: {
            fee: {
              rule_version_id: 'fee-rule-1',
              seller_organization_id: 'seller-1',
              marketplace_code: 'AMAZON_JP',
              review_type: 'RATING',
              version_no: 1,
              fee_cny_fen: '1250',
              effective_from: 1_900_000_000_000,
              replayed: false,
            },
          },
          meta: { request_id: 'fee-save' },
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
    expect(await screen.findByRole('heading', { name: '财务配置' })).toBeVisible();
    await screen.findByRole('option', { name: '测试卖家 · AMAZON_JP' });
    await user.selectOptions(screen.getByLabelText('针对卖家组织'), 'seller-1');
    expect(await screen.findByText(/服务费未配置：测试卖家 还有 4\/4 类评价类型未配/u)).toBeVisible();
    // 补默认批量接口已随 D-056 移除。
    expect(screen.queryByRole('button', { name: /补默认/u })).not.toBeInTheDocument();
    // 服务费区块（评分单行）的「设置」按钮。
    const feeSetButton = await waitFor(() => {
      const button = within(document.getElementById('finance-section-service-fee')!)
        .getAllByRole('button', { name: '设置' })
        .at(0)!;
      expect(button).toBeTruthy();
      return button;
    });
    await user.click(feeSetButton);
    const feeInput = screen.getByLabelText('服务费（元，例如 12.50）');
    await user.clear(feeInput);
    await user.type(feeInput, '12.50');
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(body).toMatchObject({
        seller_organization_id: 'seller-1',
        review_type: 'RATING',
        fee_cny_fen: '1250',
        expected_version: 0,
      }),
    );
    expect(body).not.toHaveProperty('effective_from');
    expect(await screen.findByText('已保存，立即生效。')).toBeVisible();
    expect(screen.queryByRole('button', { name: '确认' })).not.toBeInTheDocument();
    await waitFor(() => expect(posts).toEqual(['fee-save']));
  });

  it('Owner 提前设明天：单次保存明天汇率（不再有确认步骤）', async () => {
    const posts: { path: string; body: any }[] = [];
    const tomorrow = shiftChinaDate(chinaDate(), 1);
    server.use(
      http.get(apiUrl('/api/staff/rate-center'), ({ request }) => {
        // 今天已有生效版本；明天（提前设明天的目标日）为空
        const requested = new URL(request.url).searchParams.get('business_date');
        const activeToday = requested !== tomorrow;
        const version = (date: string, value: string) => ({
          rate_version_id: `rate-${date}`,
          business_date: date,
          version_no: 1,
          rate_value: value,
          rate_scale: '100000000',
          created_by_staff_id: 'staff-1',
          created_at: 1_787_424_000_000,
        });
        return HttpResponse.json({
          data: rateCenterPayload({
            business_date: requested ?? '2026-08-22',
            base_rate: activeToday
              ? {
                  business_date: requested ?? '2026-08-22',
                  versions: [version(requested ?? '2026-08-22', '4600000')],
                  active_version: version(requested ?? '2026-08-22', '4600000'),
                  next_version: 2,
                }
              : {
                  business_date: tomorrow,
                  versions: [],
                  active_version: null,
                  next_version: 1,
                },
          }),
          meta: { request_id: 'rate-center-read' },
        });
      }),
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
      http.post(apiUrl('/api/staff/rate-center/base-rates'), async ({ request }) => {
        posts.push({ path: 'save', body: await request.json() });
        return HttpResponse.json({
          data: {
            base_rate: {
              rate_version_id: 'rate-tomorrow-1',
              business_date: tomorrow,
              version_no: 1,
              rate_value: '4600000',
              rate_scale: '100000000',
              effective_from: 1_787_424_000_000,
              replayed: false,
            },
          },
          meta: { request_id: 'base-save' },
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
    expect(await screen.findByRole('heading', { name: '财务配置' })).toBeVisible();
    // 今日已有生效版本 → 显示说明与提前设明天入口
    expect(await screen.findByText(/当日汇率已保存并立即生效/u)).toBeVisible();
    await user.click(screen.getByRole('button', { name: '提前设明天' }));
    const input = screen.getByRole('textbox', {
      name: /明天（\d{4}-\d{2}-\d{2}）基础汇率/u,
    });
    await user.clear(input);
    await user.type(input, '0.046');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText(/已保存.*的汇率，立即生效/u)).toBeVisible();
    // 单次保存模型：只有一次保存请求，没有确认请求。
    expect(posts).toEqual([
      { path: 'save', body: { business_date: tomorrow, rate_value: '0.046', expected_version: 0 } },
    ]);
  });

  it('无 SELLER_MANAGE 的角色只看到拒绝提示，看不到任何配置动作', async () => {
    server.use(
      http.get(apiUrl('/api/staff/rate-center'), () =>
        HttpResponse.json({
          data: rateCenterPayload(),
          meta: { request_id: 'rate-center-read' },
        }),
      ),
    );
    renderWithMsw(
      <StaffSessionBoundary adapter={adapter(preSales())}>
        <StaffFinanceWorkspace />
      </StaffSessionBoundary>,
      {
        route: '/staff/finance',
      },
    );
    expect(
      await screen.findByText('当前员工没有此权限，后端会拒绝访问。'),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '设置' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '单独设置' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '提前设明天' })).not.toBeInTheDocument();
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
          data: { policies: readPayload() },
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

function session(
  role: 'owner' | 'seller_ops' | 'pre_sales',
  permissions: string[],
): StaffSession {
  return {
    staff_id: 'staff-1',
    display_name: '测试员工',
    role:
      role === 'owner'
        ? { code: 'owner' as const, display_name: '总管理员' }
        : role === 'seller_ops'
          ? { code: 'seller_ops' as const, display_name: '卖家对接' }
          : { code: 'pre_sales' as const, display_name: '售前' },
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
  return session('owner', ['SELLER_MANAGE']);
}
function sellerOps(): StaffSession {
  return session('seller_ops', ['SELLER_MANAGE']);
}
function preSales(): StaffSession {
  return session('pre_sales', ['ORDER_VIEW']);
}

function policy(
  id: string,
  scopeType: 'CURRENCY_PAIR_DEFAULT' | 'SELLER_ORGANIZATION',
  version: number,
  markup: string,
) {
  return {
    policy_version_id: id,
    scope_type: scopeType,
    seller_organization_id: scopeType === 'SELLER_ORGANIZATION' ? 'seller-1' : null,
    source_currency_code: 'JPY',
    quote_currency_code: 'CNY',
    version_no: version,
    markup_rate_value: markup,
    markup_rate_scale: '100000000',
    effective_from: 1_900_000_000_000,
    created_by_staff_id: 'staff-1',
    created_at: 1_900_000_000_000,
    replayed: false,
  };
}

function readPayload(overrides: Record<string, unknown> = {}) {
  return {
    source_currency_code: 'JPY',
    quote_currency_code: 'CNY',
    seller_organization_id: 'seller-1',
    default_policy: policy('default-1', 'CURRENCY_PAIR_DEFAULT', 1, '400000'),
    seller_override_policy: policy('override-1', 'SELLER_ORGANIZATION', 1, '0'),
    default_next_version: 2,
    seller_override_next_version: 2,
    selected_policy: policy('override-1', 'SELLER_ORGANIZATION', 1, '0'),
    ...overrides,
  };
}

function serviceFeesPayload() {
  return {
    seller_organization_id: 'seller-1',
    fees: ['RATING', 'TEXT', 'IMAGE', 'VIDEO'].map((reviewType) => ({
      review_type: reviewType,
      effective_fee: null,
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
      versions: [],
      active_version: null,
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
