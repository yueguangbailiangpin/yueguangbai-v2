// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrontendApiError } from '../../api/errors';
import type { ApiResult } from '../../api/transport';
import { CustomerChangePasswordPage } from './CustomerChangePasswordPage';
import { CustomerPasswordRouteBoundary } from './CustomerPasswordRouteBoundary';
import type { CustomerAuthApiAdapter, CustomerSession, CustomerTarget } from './customer-auth-api';

afterEach(cleanup);

function session(
  accountType: CustomerSession['account_type'],
  passwordChangeRequired: boolean,
): CustomerSession {
  return {
    account_id: 'password-route-test',
    identity_subject_id: 'subject-test',
    account_type: accountType,
    session_version: 2,
    password_change_required: passwordChangeRequired,
    issued_at: 2,
    expires_at: 9_999_999,
  };
}

function result<T>(data: T, requestId = 'request-password-route'): ApiResult<T> {
  return { data, requestId };
}

function testClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['buyer', 'fixture'], 'buyer-cache');
  client.setQueryData(['seller', 'fixture'], 'seller-cache');
  client.setQueryData(['staff', 'fixture'], 'staff-cache');
  return client;
}

function adapterWith(
  readSession: CustomerAuthApiAdapter['readSession'],
  logout: CustomerAuthApiAdapter['logout'] = async () => result({ logged_out: true, all_devices_logged_out: false }),
): CustomerAuthApiAdapter {
  return {
    login: vi.fn<CustomerAuthApiAdapter['login']>(),
    logout,
    changePassword: vi.fn<CustomerAuthApiAdapter['changePassword']>(),
    readSession,
  };
}

function routeTree(
  target: CustomerTarget,
  adapter: CustomerAuthApiAdapter,
  client: QueryClient,
) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/${target}/change-password`]}>
        <Routes>
          <Route
            path={`/${target}/change-password`}
            element={(
              <CustomerPasswordRouteBoundary target={target} adapter={adapter}>
                <CustomerChangePasswordPage target={target} adapter={adapter} keyFactory={() => 'route-test-key'} />
              </CustomerPasswordRouteBoundary>
            )}
          />
          <Route path={`/${target}/login`} element={<div>{target.toUpperCase()} LOGIN</div>} />
          <Route path="/buyer" element={<div>BUYER SHELL</div>} />
          <Route path="/seller" element={<div>SELLER SHELL</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function deferred<T>(): Readonly<{ promise: Promise<T>; resolve: (value: T) => void }> {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

describe('Customer password route boundary chain', () => {
  it('redirects an unauthenticated Buyer route only after clearing both Customer roots', async () => {
    const client = testClient();
    const readSession = vi.fn<CustomerAuthApiAdapter['readSession']>(async () => {
      throw new FrontendApiError('UNAUTHENTICATED', 401, 'request-buyer-401', 'AUTHENTICATION');
    });
    render(routeTree('buyer', adapterWith(readSession), client));

    expect(await screen.findByText('BUYER LOGIN')).toBeVisible();
    expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument();
    expect(client.getQueryData(['buyer', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['seller', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-cache');
  });

  it('redirects an unauthenticated Seller route without showing its password form', async () => {
    const client = testClient();
    const readSession = vi.fn<CustomerAuthApiAdapter['readSession']>(async () => {
      throw new FrontendApiError('UNAUTHENTICATED', 401, 'request-seller-401', 'AUTHENTICATION');
    });
    render(routeTree('seller', adapterWith(readSession), client));

    expect(await screen.findByText('SELLER LOGIN')).toBeVisible();
    expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument();
    expect(client.getQueryData(['buyer', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['seller', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-cache');
  });

  it('allows a matching BUYER Session with password_change_required=true', async () => {
    const readSession = vi.fn<CustomerAuthApiAdapter['readSession']>(async () => result({ session: session('BUYER', true) }));
    render(routeTree('buyer', adapterWith(readSession), testClient()));
    expect(await screen.findByRole('heading', { name: '买家修改密码' })).toBeVisible();
    expect(screen.getByLabelText('当前密码')).toBeVisible();
  });

  it('allows a matching SELLER_MEMBER Session with password_change_required=true', async () => {
    const readSession = vi.fn<CustomerAuthApiAdapter['readSession']>(async () => result({ session: session('SELLER_MEMBER', true) }));
    render(routeTree('seller', adapterWith(readSession), testClient()));
    expect(await screen.findByRole('heading', { name: '卖家修改密码' })).toBeVisible();
  });

  it('allows a matching Session with password_change_required=false for voluntary password changes', async () => {
    const readSession = vi.fn<CustomerAuthApiAdapter['readSession']>(async () => result({ session: session('BUYER', false) }));
    render(routeTree('buyer', adapterWith(readSession), testClient()));
    expect(await screen.findByRole('heading', { name: '买家修改密码' })).toBeVisible();
    expect(screen.queryByText('BUYER SHELL')).not.toBeInTheDocument();
  });

  it('fails closed when SELLER_MEMBER reaches the Buyer password route', async () => {
    const client = testClient();
    const logout = vi.fn<CustomerAuthApiAdapter['logout']>(async () => result({ logged_out: true, all_devices_logged_out: false }));
    const readSession = vi.fn<CustomerAuthApiAdapter['readSession']>(async () => result({ session: session('SELLER_MEMBER', false) }));
    render(routeTree('buyer', adapterWith(readSession, logout), client));

    expect(await screen.findByText('BUYER LOGIN')).toBeVisible();
    expect(logout).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /卖家/u })).not.toBeInTheDocument();
    expect(client.getQueryData(['buyer', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['seller', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-cache');
  });

  it('fails closed when BUYER reaches the Seller password route', async () => {
    const client = testClient();
    const logout = vi.fn<CustomerAuthApiAdapter['logout']>(async () => result({ logged_out: true, all_devices_logged_out: false }));
    const readSession = vi.fn<CustomerAuthApiAdapter['readSession']>(async () => result({ session: session('BUYER', false) }));
    render(routeTree('seller', adapterWith(readSession, logout), client));

    expect(await screen.findByText('SELLER LOGIN')).toBeVisible();
    expect(logout).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument();
    expect(client.getQueryData(['buyer', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['seller', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-cache');
  });

  it('keeps the form and Shells hidden when mismatch logout fails and exposes safe cleanup retry', async () => {
    const client = testClient();
    const logout = vi.fn<CustomerAuthApiAdapter['logout']>()
      .mockRejectedValueOnce(new FrontendApiError('DEPENDENCY_UNAVAILABLE', 503, 'request-route-cleanup', 'DEPENDENCY'))
      .mockResolvedValueOnce(result({ logged_out: true, all_devices_logged_out: false }));
    const readSession = vi.fn<CustomerAuthApiAdapter['readSession']>(async () => result({ session: session('SELLER_MEMBER', true) }));
    const user = userEvent.setup();
    render(routeTree('buyer', adapterWith(readSession, logout), client));

    expect(await screen.findByRole('heading', { name: '会话清理失败，请重试或刷新' })).toBeVisible();
    expect(screen.getByText('请求编号：request-route-cleanup')).toBeVisible();
    expect(screen.getByRole('button', { name: '重新清理' })).toBeVisible();
    expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument();
    expect(screen.queryByText('BUYER SHELL')).not.toBeInTheDocument();
    expect(screen.queryByText('SELLER SHELL')).not.toBeInTheDocument();
    expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-cache');

    await user.click(screen.getByRole('button', { name: '重新清理' }));
    expect(await screen.findByText('BUYER LOGIN')).toBeVisible();
    expect(logout).toHaveBeenCalledTimes(2);
  });

  it('renders a retryable dependency state for 503 instead of redirecting to login', async () => {
    const readSession = vi.fn<CustomerAuthApiAdapter['readSession']>()
      .mockRejectedValueOnce(new FrontendApiError('DEPENDENCY_UNAVAILABLE', 503, 'request-route-503', 'DEPENDENCY'))
      .mockResolvedValueOnce(result({ session: session('BUYER', false) }));
    const user = userEvent.setup();
    render(routeTree('buyer', adapterWith(readSession), testClient()));

    expect(await screen.findByRole('heading', { name: '服务暂时不可用' })).toBeVisible();
    expect(screen.getByText('请求编号：request-route-503')).toBeVisible();
    expect(screen.queryByText('BUYER LOGIN')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { name: '买家修改密码' })).toBeVisible();
  });

  it('does not repeat mismatch logout across React rerenders', async () => {
    const client = testClient();
    const pendingLogout = deferred<ApiResult<{ logged_out: true; all_devices_logged_out: false }>>();
    const logout = vi.fn<CustomerAuthApiAdapter['logout']>(() => pendingLogout.promise);
    const readSession = vi.fn<CustomerAuthApiAdapter['readSession']>(async () => result({ session: session('SELLER_MEMBER', false) }));
    const adapter = adapterWith(readSession, logout);
    const view = render(routeTree('buyer', adapter, client));
    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    view.rerender(routeTree('buyer', adapter, client));
    expect(logout).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('当前密码')).not.toBeInTheDocument();

    pendingLogout.resolve(result({ logged_out: true, all_devices_logged_out: false }));
    expect(await screen.findByText('BUYER LOGIN')).toBeVisible();
    expect(logout).toHaveBeenCalledOnce();
  });
});
