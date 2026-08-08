// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrontendApiError } from '../../api/errors';
import { queryKeys } from '../../api/query-client';
import type { ApiResult } from '../../api/transport';
import { CustomerLoginPage } from './CustomerLoginPage';
import type { CustomerAuthApiAdapter, CustomerSession, CustomerTarget } from './customer-auth-api';

afterEach(cleanup);

function session(accountType: CustomerSession['account_type']): CustomerSession {
  return {
    account_id: 'customer-test',
    identity_subject_id: 'subject-test',
    account_type: accountType,
    session_version: 1,
    password_change_required: false,
    issued_at: 1,
    expires_at: 9_999_999,
  };
}

function result<T>(data: T, requestId = 'request-test'): ApiResult<T> {
  return { data, requestId };
}

function testClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['buyer', 'fixture'], 'buyer-cache');
  client.setQueryData(['seller', 'fixture'], 'seller-cache');
  client.setQueryData(['staff', 'fixture'], 'staff-cache');
  return client;
}

function createAdapter(accountType: CustomerSession['account_type'], logout: CustomerAuthApiAdapter['logout']) {
  const login = vi.fn<CustomerAuthApiAdapter['login']>(async () => result({ session: session(accountType) }));
  const adapter: CustomerAuthApiAdapter = {
    login,
    logout,
    changePassword: vi.fn<CustomerAuthApiAdapter['changePassword']>(),
    readSession: vi.fn<CustomerAuthApiAdapter['readSession']>(),
  };
  return { adapter, login };
}

async function renderMismatch(target: CustomerTarget, adapter: CustomerAuthApiAdapter, client: QueryClient) {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/${target}/login`]}>
        <Routes>
          <Route path={`/${target}/login`} element={<CustomerLoginPage target={target} adapter={adapter} />} />
          <Route path="/buyer" element={<div>BUYER SHELL</div>} />
          <Route path="/seller" element={<div>SELLER SHELL</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.type(screen.getByLabelText('账号'), 'customer');
  await user.type(screen.getByLabelText('密码'), 'password');
  await user.click(screen.getByRole('button', { name: '登录' }));
  return user;
}

describe('Customer login mismatch controller chain', () => {
  it.each(['buyer', 'seller'] as const)('renders the %s login with no Persona authority', (target) => {
    const client = testClient();
    const { adapter } = createAdapter(
      target === 'buyer' ? 'BUYER' : 'SELLER_MEMBER',
      vi.fn<CustomerAuthApiAdapter['logout']>(),
    );
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/${target}/login`]}>
          <Routes><Route path={`/${target}/login`} element={<CustomerLoginPage target={target} adapter={adapter} />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText('月光白')).toBeVisible();
    expect(screen.getByLabelText('账号')).toBeVisible();
    expect(screen.getByLabelText('密码')).toBeVisible();
    expect(screen.getByRole('button', { name: '登录' })).toBeVisible();
    expect(screen.queryByLabelText('进入身份')).not.toBeInTheDocument();
    expect(screen.queryByText(/买家服务|卖家工作区|安全访问/u)).not.toBeInTheDocument();
  });

  it('cleans both Customer roots for Buyer login returning SELLER_MEMBER and preserves Staff', async () => {
    const client = testClient();
    const logout = vi.fn<CustomerAuthApiAdapter['logout']>(async () => result({ logged_out: true, all_devices_logged_out: false }));
    const { adapter } = createAdapter('SELLER_MEMBER', logout);
    await renderMismatch('buyer', adapter, client);

    expect(await screen.findByRole('alert')).toHaveTextContent('该账号不适用于此登录入口，请确认账号或联系工作人员。');
    expect(logout).toHaveBeenCalledOnce();
    expect(client.getQueryData(['buyer', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['seller', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-cache');
    expect(screen.queryByText('SELLER SHELL')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /卖家/u })).not.toBeInTheDocument();
  });

  it('cleans both Customer roots for Seller login returning BUYER without cross-identity navigation', async () => {
    const client = testClient();
    const logout = vi.fn<CustomerAuthApiAdapter['logout']>(async () => result({ logged_out: true, all_devices_logged_out: false }));
    const { adapter } = createAdapter('BUYER', logout);
    await renderMismatch('seller', adapter, client);

    expect(await screen.findByRole('alert')).toHaveTextContent('该账号不适用于此登录入口，请确认账号或联系工作人员。');
    expect(logout).toHaveBeenCalledOnce();
    expect(client.getQueryData(['buyer', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['seller', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-cache');
    expect(screen.queryByText('BUYER SHELL')).not.toBeInTheDocument();
  });

  it('keeps both Customer roots empty and exposes a safe retry when mismatch logout fails', async () => {
    const client = testClient();
    const logout = vi.fn<CustomerAuthApiAdapter['logout']>()
      .mockRejectedValueOnce(new FrontendApiError('DEPENDENCY_UNAVAILABLE', 503, 'request-cleanup', 'DEPENDENCY'))
      .mockResolvedValueOnce(result({ logged_out: true, all_devices_logged_out: false }, 'request-retry'));
    const { adapter } = createAdapter('SELLER_MEMBER', logout);
    const user = await renderMismatch('buyer', adapter, client);

    expect(await screen.findByRole('alert')).toHaveTextContent('会话清理失败，请重试或刷新');
    expect(screen.getByText('请求编号：request-cleanup')).toBeVisible();
    expect(client.getQueryData(queryKeys.buyer.root)).toBeUndefined();
    expect(client.getQueryData(queryKeys.seller.root)).toBeUndefined();
    expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-cache');
    expect(screen.queryByText('BUYER SHELL')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '重新清理' }));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toHaveTextContent('该账号不适用于此登录入口，请确认账号或联系工作人员。');
  });
});
