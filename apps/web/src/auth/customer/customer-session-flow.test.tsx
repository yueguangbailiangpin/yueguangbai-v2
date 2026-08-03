// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrontendApiError } from '../../api/errors';
import type { ApiResult } from '../../api/transport';
import { CustomerSessionBoundary } from './CustomerSessionBoundary';
import type { CustomerAuthApiAdapter, CustomerSession, CustomerTarget } from './customer-auth-api';

afterEach(cleanup);

function deferred<T>(): Readonly<{ promise: Promise<T>; resolve: (value: T) => void }> {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

function session(accountType: CustomerSession['account_type']): CustomerSession {
  return {
    account_id: 'session-test',
    identity_subject_id: 'subject-test',
    account_type: accountType,
    session_version: 1,
    password_change_required: false,
    issued_at: 1,
    expires_at: 9_999_999,
  };
}

function result<T>(data: T, requestId = 'request-session'): ApiResult<T> {
  return { data, requestId };
}

function testClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['buyer', 'fixture'], 'buyer-cache');
  client.setQueryData(['seller', 'fixture'], 'seller-cache');
  client.setQueryData(['staff', 'fixture'], 'staff-cache');
  return client;
}

function adapterFor(accountType: CustomerSession['account_type'], logout: CustomerAuthApiAdapter['logout']): CustomerAuthApiAdapter {
  return {
    login: vi.fn<CustomerAuthApiAdapter['login']>(),
    logout,
    changePassword: vi.fn<CustomerAuthApiAdapter['changePassword']>(),
    readSession: vi.fn<CustomerAuthApiAdapter['readSession']>(async () => result({ session: session(accountType) })),
  };
}

function boundary(target: CustomerTarget, adapter: CustomerAuthApiAdapter, client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/${target}`]}>
        <Routes>
          <Route
            path={`/${target}`}
            element={<CustomerSessionBoundary target={target} adapter={adapter}><div>{target.toUpperCase()} SHELL</div></CustomerSessionBoundary>}
          />
          <Route path={`/${target}/login`} element={<div>{target.toUpperCase()} LOGIN</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Customer Session mismatch controller chain', () => {
  it('logs out a Buyer Session returning SELLER_MEMBER only once across React rerenders', async () => {
    const client = testClient();
    const pendingLogout = deferred<ApiResult<{ logged_out: true; all_devices_logged_out: false }>>();
    const logout = vi.fn<CustomerAuthApiAdapter['logout']>(() => pendingLogout.promise);
    const adapter = adapterFor('SELLER_MEMBER', logout);
    const view = render(boundary('buyer', adapter, client));

    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    expect(screen.queryByText('BUYER SHELL')).not.toBeInTheDocument();
    view.rerender(boundary('buyer', adapter, client));
    expect(logout).toHaveBeenCalledOnce();
    expect(client.getQueryData(['buyer', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['seller', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-cache');

    pendingLogout.resolve(result({ logged_out: true, all_devices_logged_out: false }));
    expect(await screen.findByText('BUYER LOGIN')).toBeVisible();
    expect(logout).toHaveBeenCalledOnce();
  });

  it('logs out a Seller Session returning BUYER and never renders the protected Shell', async () => {
    const client = testClient();
    const logout = vi.fn<CustomerAuthApiAdapter['logout']>(async () => result({ logged_out: true, all_devices_logged_out: false }));
    render(boundary('seller', adapterFor('BUYER', logout), client));

    expect(await screen.findByText('SELLER LOGIN')).toBeVisible();
    expect(logout).toHaveBeenCalledOnce();
    expect(client.getQueryData(['buyer', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['seller', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-cache');
    expect(screen.queryByText('SELLER SHELL')).not.toBeInTheDocument();
  });

  it('keeps a failed mismatch cleanup fail closed until an accessible explicit retry succeeds', async () => {
    const client = testClient();
    const logout = vi.fn<CustomerAuthApiAdapter['logout']>()
      .mockRejectedValueOnce(new FrontendApiError('DEPENDENCY_UNAVAILABLE', 503, 'request-session-cleanup', 'DEPENDENCY'))
      .mockResolvedValueOnce(result({ logged_out: true, all_devices_logged_out: false }));
    const adapter = adapterFor('SELLER_MEMBER', logout);
    const user = userEvent.setup();
    render(boundary('buyer', adapter, client));

    expect(await screen.findByRole('heading', { name: '会话清理失败，请重试或刷新' })).toBeVisible();
    expect(screen.getByText('请求编号：request-session-cleanup')).toBeVisible();
    expect(screen.queryByText('BUYER SHELL')).not.toBeInTheDocument();
    expect(client.getQueryData(['buyer', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['seller', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-cache');

    await user.click(screen.getByRole('button', { name: '重新清理' }));
    expect(await screen.findByText('BUYER LOGIN')).toBeVisible();
    expect(logout).toHaveBeenCalledTimes(2);
  });
});
