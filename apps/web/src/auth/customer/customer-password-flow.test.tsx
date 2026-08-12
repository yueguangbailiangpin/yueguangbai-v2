// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrontendApiError } from '../../api/errors';
import type { ApiResult } from '../../api/transport';
import { CustomerChangePasswordPage } from './CustomerChangePasswordPage';
import type { CustomerAuthApiAdapter, CustomerSession, CustomerTarget } from './customer-auth-api';

afterEach(cleanup);

function session(accountType: CustomerSession['account_type'], passwordChangeRequired = false): CustomerSession {
  return {
    account_id: 'password-test',
    identity_subject_id: 'subject-test',
    account_type: accountType,
    session_version: 2,
    password_change_required: passwordChangeRequired,
    issued_at: 2,
    expires_at: 9_999_999,
  };
}

function result<T>(data: T, requestId = 'request-password'): ApiResult<T> {
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
  changePassword: CustomerAuthApiAdapter['changePassword'],
  readSession: CustomerAuthApiAdapter['readSession'] = async () => result({ session: session('BUYER') }),
  logout: CustomerAuthApiAdapter['logout'] = async () => result({ logged_out: true, all_devices_logged_out: false }),
): CustomerAuthApiAdapter {
  return {
    login: vi.fn<CustomerAuthApiAdapter['login']>(),
    logout,
    changePassword,
    readSession,
  };
}

function page(
  target: CustomerTarget,
  adapter: CustomerAuthApiAdapter,
  client: QueryClient,
  keyFactory: () => string,
) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/${target}/change-password`]}>
        <Routes>
          <Route path={`/${target}/change-password`} element={<CustomerChangePasswordPage target={target} adapter={adapter} keyFactory={keyFactory} />} />
          <Route path={`/${target}`} element={<div>{target.toUpperCase()} SHELL</div>} />
          <Route path={`/${target}/login`} element={<div>{target.toUpperCase()} LOGIN</div>} />
          <Route path={target === 'buyer' ? '/seller' : '/buyer'} element={<div>{target === 'buyer' ? 'SELLER' : 'BUYER'} SHELL</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function fillForm(user: UserEvent, current = 'current-secret', next = 'next-secret'): Promise<void> {
  await user.type(screen.getByLabelText('当前密码'), current);
  await user.type(screen.getByLabelText('新密码'), next);
  await user.type(screen.getByLabelText('确认新密码'), next);
}

function sequentialKeys(): Readonly<{ factory: () => string; values: string[] }> {
  const values: string[] = [];
  let count = 0;
  return {
    values,
    factory: () => {
      count += 1;
      const key = `operation-key-${count}`;
      values.push(key);
      return key;
    },
  };
}

function deferred<T>(): Readonly<{ promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void }> {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

describe('Customer password operation controller chain', () => {
  it('generates one first key, reuses it for an identical-body network retry, then clears both roots and rereads Session', async () => {
    const client = testClient();
    const keys: string[] = [];
    const changePassword = vi.fn<CustomerAuthApiAdapter['changePassword']>(async (_body, key) => {
      keys.push(key);
      if (keys.length === 1) throw new FrontendApiError('NETWORK_FAILURE', 0, null, 'NETWORK');
      return result({ session: session('BUYER') }, 'request-change');
    });
    const readSession = vi.fn<CustomerAuthApiAdapter['readSession']>(async () => result({ session: session('BUYER') }, 'request-reread'));
    const keySequence = sequentialKeys();
    const user = userEvent.setup();
    render(page('buyer', adapterWith(changePassword, readSession), client, keySequence.factory));
    await fillForm(user);

    await user.click(screen.getByRole('button', { name: '修改密码' }));
    expect(await screen.findByRole('button', { name: '重试修改密码' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '重试修改密码' }));

    expect(await screen.findByText('BUYER SHELL')).toBeVisible();
    expect(keys).toEqual(['operation-key-1', 'operation-key-1']);
    expect(keySequence.values).toEqual(['operation-key-1']);
    expect(readSession).toHaveBeenCalledOnce();
    expect(client.getQueryData(['buyer', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['seller', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-cache');
    expect(client.getQueryData(['buyer', 'session'])).toEqual(session('BUYER'));
  });

  it('releases the old key when either password body field changes', async () => {
    const keys: string[] = [];
    const changePassword = vi.fn<CustomerAuthApiAdapter['changePassword']>(async (_body, key) => {
      keys.push(key);
      throw new FrontendApiError('NETWORK_FAILURE', 0, null, 'NETWORK');
    });
    const keySequence = sequentialKeys();
    const user = userEvent.setup();
    render(page('buyer', adapterWith(changePassword), testClient(), keySequence.factory));
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: '修改密码' }));
    expect(await screen.findByRole('button', { name: '重试修改密码' })).toBeVisible();

    await user.clear(screen.getByLabelText('新密码'));
    await user.type(screen.getByLabelText('新密码'), 'different-secret');
    await user.clear(screen.getByLabelText('确认新密码'));
    await user.type(screen.getByLabelText('确认新密码'), 'different-secret');
    await user.click(screen.getByRole('button', { name: '修改密码' }));
    await waitFor(() => expect(changePassword).toHaveBeenCalledTimes(2));
    expect(keys).toEqual(['operation-key-1', 'operation-key-2']);
  });

  it('releases the old key after cancel before a later new submission', async () => {
    const keys: string[] = [];
    const changePassword = vi.fn<CustomerAuthApiAdapter['changePassword']>(async (_body, key) => {
      keys.push(key);
      throw new FrontendApiError('NETWORK_FAILURE', 0, null, 'NETWORK');
    });
    const keySequence = sequentialKeys();
    const user = userEvent.setup();
    render(page('buyer', adapterWith(changePassword), testClient(), keySequence.factory));
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: '修改密码' }));
    expect(await screen.findByRole('button', { name: '重试修改密码' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '取消本次操作' }));
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: '修改密码' }));
    await waitFor(() => expect(changePassword).toHaveBeenCalledTimes(2));
    expect(keys).toEqual(['operation-key-1', 'operation-key-2']);
  });

  it('keeps the active key stable across a React rerender', async () => {
    const pending = deferred<ApiResult<{ session: CustomerSession }>>();
    const keys: string[] = [];
    const changePassword = vi.fn<CustomerAuthApiAdapter['changePassword']>((_body, key) => {
      keys.push(key);
      return keys.length === 1 ? pending.promise : Promise.resolve(result({ session: session('BUYER') }));
    });
    const client = testClient();
    const keySequence = sequentialKeys();
    const adapter = adapterWith(changePassword);
    const user = userEvent.setup();
    const view = render(page('buyer', adapter, client, keySequence.factory));
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: '修改密码' }));
    await waitFor(() => expect(changePassword).toHaveBeenCalledOnce());
    view.rerender(page('buyer', adapter, client, keySequence.factory));
    expect(keys).toEqual(['operation-key-1']);

    pending.reject(new FrontendApiError('NETWORK_FAILURE', 0, null, 'NETWORK'));
    expect(await screen.findByRole('button', { name: '重试修改密码' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '重试修改密码' }));
    expect(await screen.findByText('BUYER SHELL')).toBeVisible();
    expect(keys).toEqual(['operation-key-1', 'operation-key-1']);
  });

  it('logs out and blocks both Shells when the password response account type mismatches', async () => {
    const client = testClient();
    const changePassword = vi.fn<CustomerAuthApiAdapter['changePassword']>(async () => result({ session: session('SELLER_MEMBER') }));
    const readSession = vi.fn<CustomerAuthApiAdapter['readSession']>();
    const logout = vi.fn<CustomerAuthApiAdapter['logout']>(async () => result({ logged_out: true, all_devices_logged_out: false }));
    const user = userEvent.setup();
    render(page('buyer', adapterWith(changePassword, readSession, logout), client, sequentialKeys().factory));
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: '修改密码' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('这个账号不能在这儿登录，请确认后重试，或联系工作人员。');
    expect(logout).toHaveBeenCalledOnce();
    expect(readSession).not.toHaveBeenCalled();
    expect(client.getQueryData(['buyer', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['seller', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-cache');
    expect(screen.queryByText('SELLER SHELL')).not.toBeInTheDocument();
  });

  it('logs out when the reread Session account type mismatches after a matching password response', async () => {
    const client = testClient();
    const changePassword = vi.fn<CustomerAuthApiAdapter['changePassword']>(async () => result({ session: session('SELLER_MEMBER') }));
    const readSession = vi.fn<CustomerAuthApiAdapter['readSession']>(async () => result({ session: session('BUYER') }));
    const logout = vi.fn<CustomerAuthApiAdapter['logout']>(async () => result({ logged_out: true, all_devices_logged_out: false }));
    const user = userEvent.setup();
    render(page('seller', adapterWith(changePassword, readSession, logout), client, sequentialKeys().factory));
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: '修改密码' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('这个账号不能在这儿登录，请确认后重试，或联系工作人员。');
    expect(readSession).toHaveBeenCalledOnce();
    expect(logout).toHaveBeenCalledOnce();
    expect(screen.queryByText('BUYER SHELL')).not.toBeInTheDocument();
    expect(screen.queryByText('SELLER SHELL')).not.toBeInTheDocument();
  });

  it('handles a password 401 by clearing Customer roots, preserving Staff, and returning to login', async () => {
    const client = testClient();
    const changePassword = vi.fn<CustomerAuthApiAdapter['changePassword']>(async () => {
      throw new FrontendApiError('UNAUTHENTICATED', 401, 'request-401', 'AUTHENTICATION');
    });
    const user = userEvent.setup();
    render(page('buyer', adapterWith(changePassword), client, sequentialKeys().factory));
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: '修改密码' }));

    expect(await screen.findByText('BUYER LOGIN')).toBeVisible();
    expect(client.getQueryData(['buyer', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['seller', 'fixture'])).toBeUndefined();
    expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-cache');
  });

  it('ends an IDEMPOTENCY_CONFLICT operation so the next explicit submit uses a new key', async () => {
    const keys: string[] = [];
    const changePassword = vi.fn<CustomerAuthApiAdapter['changePassword']>(async (_body, key) => {
      keys.push(key);
      throw keys.length === 1
        ? new FrontendApiError('IDEMPOTENCY_CONFLICT', 409, 'request-conflict', 'CONFLICT')
        : new FrontendApiError('VALIDATION_ERROR', 422, 'request-validation', 'VALIDATION');
    });
    const user = userEvent.setup();
    render(page('buyer', adapterWith(changePassword), testClient(), sequentialKeys().factory));
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: '修改密码' }));
    expect(await screen.findByRole('button', { name: '发起新操作' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '发起新操作' }));
    await waitFor(() => expect(changePassword).toHaveBeenCalledTimes(2));
    expect(keys).toEqual(['operation-key-1', 'operation-key-2']);
  });

  it('does not submit concurrently for REQUEST_IN_PROGRESS and keeps its key for explicit retry', async () => {
    const first = deferred<ApiResult<{ session: CustomerSession }>>();
    const keys: string[] = [];
    const changePassword = vi.fn<CustomerAuthApiAdapter['changePassword']>((_body, key) => {
      keys.push(key);
      if (keys.length === 1) return first.promise;
      return Promise.reject(new FrontendApiError('NETWORK_FAILURE', 0, null, 'NETWORK'));
    });
    const user = userEvent.setup();
    render(page('buyer', adapterWith(changePassword), testClient(), sequentialKeys().factory));
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: '修改密码' }));
    expect(screen.getByRole('button', { name: '正在提交' })).toBeDisabled();
    expect(changePassword).toHaveBeenCalledOnce();

    first.reject(new FrontendApiError('REQUEST_IN_PROGRESS', 409, 'request-progress', 'CONFLICT'));
    expect(await screen.findByRole('button', { name: '重试修改密码' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '重试修改密码' }));
    await waitFor(() => expect(changePassword).toHaveBeenCalledTimes(2));
    expect(keys).toEqual(['operation-key-1', 'operation-key-1']);
  });

  it('keeps the user in the password flow when the reread Session still requires a password change', async () => {
    const changePassword = vi.fn<CustomerAuthApiAdapter['changePassword']>(async () => result({ session: session('BUYER') }));
    const readSession = vi.fn<CustomerAuthApiAdapter['readSession']>(async () => result({ session: session('BUYER', true) }, 'request-still-required'));
    const user = userEvent.setup();
    render(page('buyer', adapterWith(changePassword, readSession), testClient(), sequentialKeys().factory));
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: '修改密码' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('密码修改状态尚未确认，请先别离开当前页面。');
    expect(screen.getByRole('heading', { name: '修改密码' })).toBeVisible();
    expect(screen.queryByText('BUYER SHELL')).not.toBeInTheDocument();
  });
});
