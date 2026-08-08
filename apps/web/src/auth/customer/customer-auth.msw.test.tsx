// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import '../../test/msw/lifecycle';
import {
  buyerSessionFixture,
  customerLogoutEnvelopeFixture,
  customerSessionEnvelopeFixture,
  failureEnvelopeFixture,
  malformedFixtures,
  sellerSessionFixture,
} from '../../test/msw/fixtures';
import { apiUrl } from '../../test/msw/handlers';
import { createMswQueryClient, renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { queryKeys } from '../../api/query-client';
import { CustomerSessionBoundary } from './CustomerSessionBoundary';
import { CustomerAuthController } from './customer-auth-controller';
import { customerAuthApi, type CustomerPasswordBody } from './customer-auth-api';
import { CustomerPasswordOperationController } from './customer-password-operation';

afterEach(cleanup);

function seedAllIdentityCaches(client: QueryClient): void {
  client.setQueryData(queryKeys.buyer.session, buyerSessionFixture);
  client.setQueryData(['buyer', 'fixture'], 'buyer-cache');
  client.setQueryData(queryKeys.seller.session, sellerSessionFixture);
  client.setQueryData(['seller', 'fixture'], 'seller-cache');
  client.setQueryData(queryKeys.staff.session, { staff_id: 'staff-cache' });
  client.setQueryData(['staff', 'fixture'], 'staff-cache');
}

function expectCustomerClearedStaffPreserved(client: QueryClient): void {
  expect(client.getQueriesData({ queryKey: queryKeys.buyer.root })).toEqual([]);
  expect(client.getQueriesData({ queryKey: queryKeys.seller.root })).toEqual([]);
  expect(client.getQueryData(queryKeys.staff.session)).toEqual({ staff_id: 'staff-cache' });
  expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-cache');
}

const loginBody = { login_identifier: 'customer-1', password: 'password-1' };
const passwordBody: CustomerPasswordBody = {
  current_password: 'current-password',
  new_password: 'new-password',
};

describe('Customer Auth formal MSW chain', () => {
  it.each([
    ['buyer', buyerSessionFixture],
    ['seller', sellerSessionFixture],
  ] as const)('logs in the %s identity through the real Adapter and Transport', async (target, session) => {
    let body: unknown;
    server.use(http.post(apiUrl(`/api/customer-auth/${target}/login`), async ({ request }) => {
      body = await request.json();
      return HttpResponse.json(customerSessionEnvelopeFixture(session, `request-${target}-login`));
    }));
    const client = createMswQueryClient();
    const result = await new CustomerAuthController(client, customerAuthApi).login(target, loginBody);
    expect(body).toEqual(loginBody);
    expect(result).toMatchObject({ kind: 'AUTHENTICATED', session });
    expect(client.getQueryData(queryKeys[target].session)).toEqual(session);
  });

  it.each([
    ['buyer', { ...buyerSessionFixture, password_change_required: true }],
    ['seller', { ...sellerSessionFixture, password_change_required: true }],
  ] as const)('keeps %s login in the password-change boundary when required', async (target, session) => {
    server.use(http.post(apiUrl(`/api/customer-auth/${target}/login`), () => HttpResponse.json(
      customerSessionEnvelopeFixture(session, `request-${target}-password-required`),
    )));
    const result = await new CustomerAuthController(createMswQueryClient(), customerAuthApi)
      .login(target, loginBody);
    expect(result).toEqual({ kind: 'PASSWORD_CHANGE_REQUIRED' });
  });

  it.each([
    ['buyer', sellerSessionFixture],
    ['seller', buyerSessionFixture],
  ] as const)('fails closed for %s entry identity mismatch and sends one real logout', async (target, session) => {
    const requests: string[] = [];
    server.use(
      http.post(apiUrl(`/api/customer-auth/${target}/login`), () => {
        requests.push('login');
        return HttpResponse.json(customerSessionEnvelopeFixture(session, 'request-mismatch-login'));
      }),
      http.post(apiUrl('/api/customer-auth/logout'), () => {
        requests.push('logout');
        return HttpResponse.json(customerLogoutEnvelopeFixture('request-mismatch-logout'));
      }),
    );
    const client = createMswQueryClient();
    seedAllIdentityCaches(client);
    const result = await new CustomerAuthController(client, customerAuthApi).login(target, loginBody);
    expect(result).toEqual({ kind: 'MISMATCH_CLEANED' });
    expect(requests).toEqual(['login', 'logout']);
    expectCustomerClearedStaffPreserved(client);
  });

  it('keeps mismatch logout 503 fail closed and sends a second logout only on explicit retry', async () => {
    let logoutRequests = 0;
    server.use(
      http.post(apiUrl('/api/customer-auth/buyer/login'), () => HttpResponse.json(
        customerSessionEnvelopeFixture(sellerSessionFixture, 'request-mismatch-login'),
      )),
      http.post(apiUrl('/api/customer-auth/logout'), () => {
        logoutRequests += 1;
        return logoutRequests === 1
          ? HttpResponse.json(failureEnvelopeFixture(
              'DEPENDENCY_UNAVAILABLE', 'unavailable', null, 'request-mismatch-503',
            ), { status: 503 })
          : HttpResponse.json(customerLogoutEnvelopeFixture('request-mismatch-retry'));
      }),
    );
    const client = createMswQueryClient();
    seedAllIdentityCaches(client);
    const controller = new CustomerAuthController(client, customerAuthApi);
    expect(await controller.login('buyer', loginBody)).toEqual({
      kind: 'MISMATCH_CLEANUP_FAILED', requestId: 'request-mismatch-503',
    });
    expect(logoutRequests).toBe(1);
    expectCustomerClearedStaffPreserved(client);
    expect(await controller.retryMismatchCleanup()).toEqual({ kind: 'MISMATCH_CLEANED' });
    expect(logoutRequests).toBe(2);
  });

  it('treats Customer Session 503 as dependency failure without clearing caches or redirecting', async () => {
    server.use(http.get(apiUrl('/api/customer-auth/session'), () => HttpResponse.json(
      failureEnvelopeFixture('DEPENDENCY_UNAVAILABLE', 'unavailable', null, 'request-session-503'),
      { status: 503 },
    )));
    const client = createMswQueryClient();
    seedAllIdentityCaches(client);
    renderWithMsw(
      <Routes>
        <Route path="/buyer" element={<CustomerSessionBoundary target="buyer"><div>BUYER SHELL</div></CustomerSessionBoundary>} />
        <Route path="/buyer/login" element={<div>BUYER LOGIN</div>} />
      </Routes>,
      { route: '/buyer', client },
    );
    expect(await screen.findByRole('heading', { name: '服务暂时不可用' })).toBeVisible();
    expect(screen.queryByText('BUYER LOGIN')).not.toBeInTheDocument();
    expect(client.getQueryData(['buyer', 'fixture'])).toBe('buyer-cache');
    expect(client.getQueryData(['seller', 'fixture'])).toBe('seller-cache');
  });

  it.each([
    ['customer', '/api/customer-auth/session', malformedFixtures.flatCustomerSession],
  ] as const)('rejects a flat %s Session Envelope', async (_label, path, envelope) => {
    server.use(http.get(apiUrl(path), () => HttpResponse.json(envelope)));
    await expect(customerAuthApi.readSession()).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE', requestId: 'malformed-flat-customer',
    });
  });
});

describe('Customer password formal MSW chain', () => {
  it.each([
    ['buyer', buyerSessionFixture],
    ['seller', sellerSessionFixture],
  ] as const)('changes the %s password, sends Idempotency-Key, and rereads Session', async (target, session) => {
    const sequence: string[] = [];
    let receivedBody: unknown;
    let receivedKey: string | null = null;
    server.use(
      http.post(apiUrl('/api/customer-auth/change-password'), async ({ request }) => {
        sequence.push('change-password');
        receivedBody = await request.json();
        receivedKey = request.headers.get('Idempotency-Key');
        return HttpResponse.json(customerSessionEnvelopeFixture(session, 'request-password-change'));
      }),
      http.get(apiUrl('/api/customer-auth/session'), () => {
        sequence.push('session');
        return HttpResponse.json(customerSessionEnvelopeFixture(session, 'request-password-reread'));
      }),
    );
    const client = createMswQueryClient();
    seedAllIdentityCaches(client);
    const controller = new CustomerPasswordOperationController(
      client,
      customerAuthApi,
      () => `password-${target}-key`,
    );
    expect(await controller.submit(target, passwordBody)).toEqual({ kind: 'AUTHENTICATED' });
    expect(receivedBody).toEqual(passwordBody);
    expect(receivedKey).toBe(`password-${target}-key`);
    expect(sequence).toEqual(['change-password', 'session']);
    expect(client.getQueryData(queryKeys[target].session)).toEqual(session);
  });

  it('reuses one key for the same safe retry and generates a new key after body edit', async () => {
    const keys: string[] = [];
    let sequence = 0;
    server.use(
      http.post(apiUrl('/api/customer-auth/change-password'), ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key') ?? '');
        sequence += 1;
        if (sequence < 3) return HttpResponse.json(failureEnvelopeFixture(
          'DEPENDENCY_UNAVAILABLE', 'unavailable', null, `request-retry-${sequence}`,
        ), { status: 503 });
        return HttpResponse.json(customerSessionEnvelopeFixture(buyerSessionFixture, 'request-change-success'));
      }),
      http.get(apiUrl('/api/customer-auth/session'), () => HttpResponse.json(
        customerSessionEnvelopeFixture(buyerSessionFixture, 'request-reread-success'),
      )),
    );
    let generated = 0;
    const controller = new CustomerPasswordOperationController(
      createMswQueryClient(), customerAuthApi, () => `password-key-${++generated}`,
    );
    expect(await controller.submit('buyer', passwordBody)).toMatchObject({ kind: 'FAILED_RETRYABLE' });
    expect(await controller.submit('buyer', passwordBody)).toMatchObject({ kind: 'FAILED_RETRYABLE' });
    controller.edit();
    expect(await controller.submit('buyer', { ...passwordBody, new_password: 'changed-again' }))
      .toEqual({ kind: 'AUTHENTICATED' });
    expect(keys).toEqual(['password-key-1', 'password-key-1', 'password-key-2']);
  });

  it('clears both Customer roots on change-password 401 and preserves Staff', async () => {
    server.use(http.post(apiUrl('/api/customer-auth/change-password'), () => HttpResponse.json(
      failureEnvelopeFixture('UNAUTHENTICATED', 'login', null, 'request-password-401'),
      { status: 401 },
    )));
    const client = createMswQueryClient();
    seedAllIdentityCaches(client);
    const result = await new CustomerPasswordOperationController(client, customerAuthApi)
      .submit('buyer', passwordBody);
    expect(result).toEqual({ kind: 'UNAUTHENTICATED' });
    expectCustomerClearedStaffPreserved(client);
  });

  it.each([
    ['IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_CONFLICT'],
    ['REQUEST_IN_PROGRESS', 'REQUEST_IN_PROGRESS'],
  ] as const)('handles %s without automatic resubmission', async (code, kind) => {
    let requests = 0;
    server.use(http.post(apiUrl('/api/customer-auth/change-password'), () => {
      requests += 1;
      return HttpResponse.json(
        failureEnvelopeFixture(code, 'conflict', null, `request-${code}`),
        { status: 409 },
      );
    }));
    const result = await new CustomerPasswordOperationController(createMswQueryClient(), customerAuthApi)
      .submit('buyer', passwordBody);
    expect(result).toMatchObject({ kind });
    expect(requests).toBe(1);
  });

  it('logs out and fails closed when the post-change Session reread has the wrong identity', async () => {
    let logoutRequests = 0;
    server.use(
      http.post(apiUrl('/api/customer-auth/change-password'), () => HttpResponse.json(
        customerSessionEnvelopeFixture(buyerSessionFixture, 'request-change-matching'),
      )),
      http.get(apiUrl('/api/customer-auth/session'), () => HttpResponse.json(
        customerSessionEnvelopeFixture(sellerSessionFixture, 'request-reread-mismatch'),
      )),
      http.post(apiUrl('/api/customer-auth/logout'), () => {
        logoutRequests += 1;
        return HttpResponse.json(customerLogoutEnvelopeFixture('request-reread-logout'));
      }),
    );
    const client = createMswQueryClient();
    seedAllIdentityCaches(client);
    const result = await new CustomerPasswordOperationController(client, customerAuthApi)
      .submit('buyer', passwordBody);
    expect(result).toEqual({ kind: 'MISMATCH_CLEANED' });
    expect(logoutRequests).toBe(1);
    expectCustomerClearedStaffPreserved(client);
  });
});
