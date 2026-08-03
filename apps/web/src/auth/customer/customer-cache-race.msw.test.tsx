// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { z } from 'zod';
import '../../test/msw/lifecycle';
import { apiRequest } from '../../api/transport';
import { queryKeys } from '../../api/query-client';
import {
  buyerSessionFixture,
  customerLogoutEnvelopeFixture,
  customerSessionEnvelopeFixture,
  failureEnvelopeFixture,
  sellerSessionFixture,
} from '../../test/msw/fixtures';
import { apiUrl } from '../../test/msw/handlers';
import { createMswQueryClient, renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { CustomerSessionBoundary } from './CustomerSessionBoundary';
import { customerSessionSchema } from './customer-auth-api';

afterEach(cleanup);

function seedSixKeys(client: ReturnType<typeof createMswQueryClient>): void {
  client.setQueryData(['buyer', 'session'], buyerSessionFixture);
  client.setQueryData(['buyer', 'fixture'], 'buyer-fixture');
  client.setQueryData(['seller', 'session'], sellerSessionFixture);
  client.setQueryData(['seller', 'fixture'], 'seller-fixture');
  client.setQueryData(['staff', 'session'], { staff_id: 'staff-session' });
  client.setQueryData(['staff', 'fixture'], 'staff-fixture');
}

function expectOnlyStaff(client: ReturnType<typeof createMswQueryClient>): void {
  expect(client.getQueriesData({ queryKey: queryKeys.buyer.root })).toEqual([]);
  expect(client.getQueriesData({ queryKey: queryKeys.seller.root })).toEqual([]);
  expect(client.getQueryData(['staff', 'session'])).toEqual({ staff_id: 'staff-session' });
  expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-fixture');
}

function routes(client: ReturnType<typeof createMswQueryClient>, loginSnapshots: number[]) {
  function LoginProbe() {
    loginSnapshots.push(
      client.getQueriesData({ queryKey: queryKeys.buyer.root })
        .filter((entry) => entry[1] !== undefined).length
      + client.getQueriesData({ queryKey: queryKeys.seller.root })
        .filter((entry) => entry[1] !== undefined).length,
    );
    return <div>BUYER LOGIN</div>;
  }
  return (
    <Routes>
      <Route path="/buyer" element={<CustomerSessionBoundary target="buyer"><div>BUYER SHELL</div></CustomerSessionBoundary>} />
      <Route path="/buyer/login" element={<LoginProbe />} />
    </Routes>
  );
}

describe('Customer cache isolation and race control through MSW', () => {
  it('awaits Customer 401 two-root cleanup before login navigation and preserves both Staff keys', async () => {
    server.use(http.get(apiUrl('/api/customer-auth/session'), () => HttpResponse.json(
      failureEnvelopeFixture('UNAUTHENTICATED', 'login', null, 'request-customer-401'),
      { status: 401 },
    )));
    const client = createMswQueryClient();
    seedSixKeys(client);
    const loginSnapshots: number[] = [];
    renderWithMsw(routes(client, loginSnapshots), { route: '/buyer', client });

    expect(await screen.findByText('BUYER LOGIN')).toBeVisible();
    expect(loginSnapshots).toEqual([0]);
    expectOnlyStaff(client);
  });

  it('cancels an active Customer Session request and prevents old identity cache refill after mismatch logout', async () => {
    let activeStarted = false;
    let activeCanceled = false;
    let ordinarySessionRequests = 0;
    server.use(
      http.get(apiUrl('/api/customer-auth/session'), async ({ request }) => {
        if (request.headers.get('X-Test-Observer') === 'seller-active') {
          activeStarted = true;
          request.signal.addEventListener('abort', () => { activeCanceled = true; });
          await delay('infinite');
          return HttpResponse.json(customerSessionEnvelopeFixture(sellerSessionFixture, 'request-stale-active'));
        }
        ordinarySessionRequests += 1;
        return HttpResponse.json(customerSessionEnvelopeFixture(sellerSessionFixture, 'request-mismatch-session'));
      }),
      http.post(apiUrl('/api/customer-auth/logout'), () => HttpResponse.json(
        customerLogoutEnvelopeFixture('request-mismatch-logout'),
      )),
    );
    const client = createMswQueryClient();
    seedSixKeys(client);
    const active = client.fetchQuery({
      queryKey: ['seller', 'session', 'active-network-observer'],
      queryFn: ({ signal }) => apiRequest({
        path: '/api/customer-auth/session',
        method: 'GET',
        schema: z.object({ session: customerSessionSchema }).strict(),
        signal,
        headers: { 'X-Test-Observer': 'seller-active' },
      }),
    }).catch(() => undefined);
    await waitFor(() => expect(activeStarted).toBe(true));

    renderWithMsw(routes(client, []), { route: '/buyer', client });
    expect(await screen.findByText('BUYER LOGIN')).toBeVisible();
    await active;
    expect(activeCanceled).toBe(true);
    expect(ordinarySessionRequests).toBe(1);
    expectOnlyStaff(client);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expectOnlyStaff(client);
  });

  it('keeps Customer roots empty after logout failure and sends a second logout only after explicit cleanup retry', async () => {
    let logoutRequests = 0;
    server.use(
      http.get(apiUrl('/api/customer-auth/session'), () => HttpResponse.json(
        customerSessionEnvelopeFixture(sellerSessionFixture, 'request-failed-cleanup-session'),
      )),
      http.post(apiUrl('/api/customer-auth/logout'), () => {
        logoutRequests += 1;
        return logoutRequests === 1
          ? HttpResponse.json(failureEnvelopeFixture(
              'DEPENDENCY_UNAVAILABLE', 'unavailable', null, 'request-failed-cleanup',
            ), { status: 503 })
          : HttpResponse.json(customerLogoutEnvelopeFixture('request-explicit-retry'));
      }),
    );
    const client = createMswQueryClient();
    seedSixKeys(client);
    const user = userEvent.setup();
    renderWithMsw(routes(client, []), { route: '/buyer', client });

    expect(await screen.findByRole('heading', { name: '会话清理失败，请重试或刷新' })).toBeVisible();
    expect(screen.getByText('请求编号：request-failed-cleanup')).toBeVisible();
    expect(logoutRequests).toBe(1);
    expectOnlyStaff(client);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(logoutRequests).toBe(1);
    expectOnlyStaff(client);

    await user.click(screen.getByRole('button', { name: '重新清理' }));
    expect(await screen.findByText('BUYER LOGIN')).toBeVisible();
    expect(logoutRequests).toBe(2);
    expectOnlyStaff(client);
  });
});
