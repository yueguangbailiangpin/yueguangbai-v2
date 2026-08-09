// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../test/msw/lifecycle';
import { queryKeys } from '../../api/query-client';
import { useStaffSession } from '../session';
import {
  buyerSessionFixture,
  failureEnvelopeFixture,
  malformedFixtures,
  sellerSessionFixture,
  staffLogoutAllEnvelopeFixture,
  staffLogoutEnvelopeFixture,
  staffSessionEnvelopeFixture,
  staffSessionFixture,
} from '../../test/msw/fixtures';
import { apiUrl } from '../../test/msw/handlers';
import { createMswQueryClient, renderWithMsw } from '../../test/msw/render';
import { server } from '../../test/msw/server';
import { StaffAuthController } from './staff-auth-controller';
import { staffAuthApi } from './staff-auth-api';

afterEach(cleanup);

function seedAllIdentityCaches(client: ReturnType<typeof createMswQueryClient>): void {
  client.setQueryData(queryKeys.buyer.session, buyerSessionFixture);
  client.setQueryData(['buyer', 'fixture'], 'buyer-fixture');
  client.setQueryData(queryKeys.seller.session, sellerSessionFixture);
  client.setQueryData(['seller', 'fixture'], 'seller-fixture');
  client.setQueryData(queryKeys.staff.session, staffSessionFixture);
  client.setQueryData(['staff', 'fixture'], 'staff-fixture');
}

function expectCustomerPreserved(client: ReturnType<typeof createMswQueryClient>): void {
  expect(client.getQueryData(queryKeys.buyer.session)).toEqual(buyerSessionFixture);
  expect(client.getQueryData(['buyer', 'fixture'])).toBe('buyer-fixture');
  expect(client.getQueryData(queryKeys.seller.session)).toEqual(sellerSessionFixture);
  expect(client.getQueryData(['seller', 'fixture'])).toBe('seller-fixture');
}

function StaffProtectedProbe({
  client,
  loginSnapshots = [],
}: {
  client: ReturnType<typeof createMswQueryClient>;
  loginSnapshots?: number[];
}) {
  const session = useStaffSession();
  if (session.status === 'AUTHENTICATED') return <div>STAFF SHELL</div>;
  if (session.status === 'UNAUTHENTICATED') {
    loginSnapshots.push(
      client.getQueriesData({ queryKey: queryKeys.staff.root })
        .filter((entry) => entry[1] !== undefined).length,
    );
    return <div>STAFF LOGIN</div>;
  }
  return <div>{session.status}</div>;
}

describe('Staff login/start and Session formal MSW chain', () => {
  it('sends the exact login/start body and accepts only the configured Provider Origin', async () => {
    let body: unknown;
    server.use(http.post(apiUrl('/api/staff-auth/login/start'), async ({ request }) => {
      body = await request.json();
      return HttpResponse.json({
        data: {
          provider: 'FEISHU',
          authorization_url: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=test',
          expires_at: 1_700_000_600_000,
        },
        meta: { request_id: 'request-staff-start' },
      });
    }));
    const url = await new StaffAuthController(createMswQueryClient()).startLogin('/staff');
    expect(body).toEqual({ return_to: '/staff' });
    expect(url).toBe('https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=test');
  });

  it('rejects an arbitrary HTTPS Provider Origin after the real response is validated', async () => {
    server.use(http.post(apiUrl('/api/staff-auth/login/start'), () => HttpResponse.json({
      data: {
        provider: 'FEISHU',
        authorization_url: 'https://attacker.invalid/authorize',
        expires_at: 1_700_000_600_000,
      },
      meta: { request_id: 'request-staff-unsafe-origin' },
    })));
    await expect(new StaffAuthController(createMswQueryClient()).startLogin('/staff'))
      .rejects.toThrow('unsafe_provider_url');
  });

  it('reads a real data.session Staff Session', async () => {
    server.use(http.get(apiUrl('/api/staff-auth/session'), () => HttpResponse.json(
      staffSessionEnvelopeFixture(staffSessionFixture, 'request-staff-session'),
    )));
    await expect(staffAuthApi.readSession()).resolves.toEqual({
      data: { session: staffSessionFixture },
      requestId: 'request-staff-session',
    });
  });

  it('rejects a flat Staff Session Envelope and preserves its trustworthy request_id', async () => {
    server.use(http.get(apiUrl('/api/staff-auth/session'), () => HttpResponse.json(
      malformedFixtures.flatStaffSession,
    )));
    await expect(staffAuthApi.readSession()).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE', requestId: 'malformed-flat-staff',
    });
  });

  it('keeps cached Staff protected content hidden until this mount receives a fresh Session success', async () => {
    let sessionRequestStarted = false;
    let releaseSession!: () => void;
    const sessionGate = new Promise<void>((resolve) => { releaseSession = resolve; });
    server.use(http.get(apiUrl('/api/staff-auth/session'), async () => {
      sessionRequestStarted = true;
      await sessionGate;
      return HttpResponse.json(staffSessionEnvelopeFixture(
        staffSessionFixture,
        'request-fresh-staff',
      ));
    }));
    const client = createMswQueryClient();
    seedAllIdentityCaches(client);
    renderWithMsw(<StaffProtectedProbe client={client} />, { client });

    await waitFor(() => expect(sessionRequestStarted).toBe(true));
    expect(screen.getByText('LOADING')).toBeVisible();
    expect(screen.queryByText('STAFF SHELL')).not.toBeInTheDocument();

    releaseSession();
    expect(await screen.findByText('STAFF SHELL')).toBeVisible();
  });

  it('awaits Staff-only cache clearing for Session 401 and leaves every Customer key intact', async () => {
    server.use(http.get(apiUrl('/api/staff-auth/session'), () => HttpResponse.json(
      failureEnvelopeFixture('UNAUTHENTICATED', 'login', null, 'request-staff-401'),
      { status: 401 },
    )));
    const client = createMswQueryClient();
    seedAllIdentityCaches(client);
    const cancelQueries = vi.spyOn(client, 'cancelQueries');
    const loginSnapshots: number[] = [];
    renderWithMsw(<StaffProtectedProbe client={client} loginSnapshots={loginSnapshots} />, { client });
    expect(screen.queryByText('STAFF SHELL')).not.toBeInTheDocument();
    expect(await screen.findByText('STAFF LOGIN')).toBeVisible();
    expect(loginSnapshots).toEqual([0]);
    expect(cancelQueries).toHaveBeenCalledOnce();
    expect(client.getQueriesData({ queryKey: queryKeys.staff.root })).toEqual([]);
    expectCustomerPreserved(client);
  });

  it('classifies Staff Session 503 as dependency error without clearing any identity cache', async () => {
    server.use(http.get(apiUrl('/api/staff-auth/session'), () => HttpResponse.json(
      failureEnvelopeFixture('DEPENDENCY_UNAVAILABLE', 'unavailable', null, 'request-staff-503'),
      { status: 503 },
    )));
    const client = createMswQueryClient();
    seedAllIdentityCaches(client);
    renderWithMsw(<StaffProtectedProbe client={client} />, { client });
    expect(await screen.findByText('DEPENDENCY_ERROR')).toBeVisible();
    expect(screen.queryByText('STAFF SHELL')).not.toBeInTheDocument();
    expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-fixture');
    expectCustomerPreserved(client);
  });
});

describe('Staff logout formal MSW chain', () => {
  it('ordinary logout sends no invented body, clears Staff only, and reports success', async () => {
    let body = 'not-observed';
    server.use(http.post(apiUrl('/api/staff-auth/logout'), async ({ request }) => {
      body = await request.text();
      return HttpResponse.json(staffLogoutEnvelopeFixture('request-staff-logout'));
    }));
    const client = createMswQueryClient();
    seedAllIdentityCaches(client);
    expect(await new StaffAuthController(client).logout()).toEqual({
      kind: 'LOGGED_OUT', requestId: 'request-staff-logout',
    });
    expect(body).toBe('');
    expect(client.getQueriesData({ queryKey: queryKeys.staff.root })).toEqual([]);
    expectCustomerPreserved(client);
  });

  it('ordinary logout 401 is treated as already logged out and clears Staff only', async () => {
    server.use(http.post(apiUrl('/api/staff-auth/logout'), () => HttpResponse.json(
      failureEnvelopeFixture('UNAUTHENTICATED', 'login', null, 'request-staff-logout-401'),
      { status: 401 },
    )));
    const client = createMswQueryClient();
    seedAllIdentityCaches(client);
    expect(await new StaffAuthController(client).logout()).toEqual({
      kind: 'LOGGED_OUT', requestId: 'request-staff-logout-401',
    });
    expect(client.getQueriesData({ queryKey: queryKeys.staff.root })).toEqual([]);
    expectCustomerPreserved(client);
  });

  it('ordinary logout 503 does not claim success or clear any cache', async () => {
    let requests = 0;
    server.use(http.post(apiUrl('/api/staff-auth/logout'), () => {
      requests += 1;
      return HttpResponse.json(failureEnvelopeFixture(
        'DEPENDENCY_UNAVAILABLE', 'unavailable', null, 'request-staff-logout-503',
      ), { status: 503 });
    }));
    const client = createMswQueryClient();
    seedAllIdentityCaches(client);
    expect(await new StaffAuthController(client).logout()).toEqual({
      kind: 'FAILED', requestId: 'request-staff-logout-503',
    });
    expect(requests).toBe(1);
    expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-fixture');
    expectCustomerPreserved(client);
  });
});

describe('Staff logout-all Idempotency formal MSW chain', () => {
  it('sends {}, an Idempotency-Key, parses session_version, reuses a retry key, then creates a new operation key', async () => {
    const keys: string[] = [];
    const bodies: unknown[] = [];
    let requests = 0;
    server.use(http.post(apiUrl('/api/staff-auth/logout-all'), async ({ request }) => {
      requests += 1;
      keys.push(request.headers.get('Idempotency-Key') ?? '');
      bodies.push(await request.json());
      if (requests === 1) return HttpResponse.json(failureEnvelopeFixture(
        'DEPENDENCY_UNAVAILABLE', 'unavailable', null, 'request-logout-all-503',
      ), { status: 503 });
      return HttpResponse.json(staffLogoutAllEnvelopeFixture({
        logged_out: true,
        all_devices_logged_out: true,
        session_version: requests,
      }, `request-logout-all-${requests}`));
    }));
    let generated = 0;
    const client = createMswQueryClient();
    seedAllIdentityCaches(client);
    const controller = new StaffAuthController(client, staffAuthApi, () => `staff-key-${++generated}`);
    expect(await controller.logoutAll()).toMatchObject({ kind: 'FAILED' });
    expect(await controller.logoutAll()).toMatchObject({ kind: 'LOGGED_OUT', sessionVersion: 2 });
    expect(await controller.logoutAll()).toMatchObject({ kind: 'LOGGED_OUT', sessionVersion: 3 });
    expect(keys).toEqual(['staff-key-1', 'staff-key-1', 'staff-key-2']);
    expect(bodies).toEqual([{}, {}, {}]);
    expectCustomerPreserved(client);
  });

  it.each([
    ['IDEMPOTENCY_CONFLICT', 409, 'IDEMPOTENCY_CONFLICT'],
    ['RATE_LIMITED', 429, 'FAILED'],
    ['DEPENDENCY_UNAVAILABLE', 503, 'FAILED'],
  ] as const)('%s sends once with no automatic retry', async (code, status, kind) => {
    let requests = 0;
    server.use(http.post(apiUrl('/api/staff-auth/logout-all'), () => {
      requests += 1;
      return HttpResponse.json(failureEnvelopeFixture(
        code, 'failure', null, `request-${code}`,
      ), { status });
    }));
    const result = await new StaffAuthController(createMswQueryClient()).logoutAll();
    expect(result).toMatchObject({ kind });
    expect(requests).toBe(1);
  });

  it('blocks concurrent submission and keeps REQUEST_IN_PROGRESS on the same logical key', async () => {
    let requests = 0;
    const keys: string[] = [];
    server.use(http.post(apiUrl('/api/staff-auth/logout-all'), async ({ request }) => {
      requests += 1;
      keys.push(request.headers.get('Idempotency-Key') ?? '');
      await delay(20);
      return HttpResponse.json(failureEnvelopeFixture(
        'REQUEST_IN_PROGRESS', 'in progress', null, 'request-in-progress',
      ), { status: 409 });
    }));
    const controller = new StaffAuthController(
      createMswQueryClient(), staffAuthApi, () => 'staff-in-progress-key',
    );
    const first = controller.logoutAll();
    expect(await controller.logoutAll()).toEqual({ kind: 'ALREADY_SUBMITTING', requestId: null });
    expect(await first).toEqual({ kind: 'REQUEST_IN_PROGRESS', requestId: 'request-in-progress' });
    expect(requests).toBe(1);
    expect(await controller.logoutAll()).toEqual({
      kind: 'REQUEST_IN_PROGRESS', requestId: 'request-in-progress',
    });
    expect(keys).toEqual(['staff-in-progress-key', 'staff-in-progress-key']);
  });
});
