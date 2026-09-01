// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router';
import '../test/msw/lifecycle';
import { FrontendApiError, isFrontendApiError } from '../api/errors';
import { type RequestIdentity } from '../api/identity-request';
import { queryKeys } from '../api/query-client';
import { buyerApi } from '../buyer/api/client';
import { sellerApi } from '../seller/api/client';
import { staffApi } from '../staff/api/client';
import { RequestIdDisplay } from '../ui/primitives';
import {
  buyerSessionFixture,
  failureEnvelopeFixture,
  sellerSessionFixture,
  staffSessionFixture,
} from '../test/msw/fixtures';
import { apiUrl } from '../test/msw/handlers';
import { createMswQueryClient, renderWithMsw } from '../test/msw/render';
import { server } from '../test/msw/server';

afterEach(cleanup);

const identityPaths = [
  ['buyer', '/api/buyer-portal/me'],
  ['seller', '/api/seller-portal/me'],
  ['staff', '/api/staff/me/assignments'],
] as const;

function readProtected(identity: RequestIdentity, client: QueryClient, signal?: AbortSignal) {
  if (identity === 'buyer') return buyerApi.me(client, signal);
  if (identity === 'seller') return sellerApi.me(client, signal);
  return staffApi.assignments(client, signal);
}

function seedEveryIdentity(client: QueryClient): void {
  client.setQueryData(queryKeys.buyer.session, buyerSessionFixture);
  client.setQueryData(['buyer', 'fixture'], 'buyer-fixture');
  client.setQueryData(queryKeys.seller.session, sellerSessionFixture);
  client.setQueryData(['seller', 'fixture'], 'seller-fixture');
  client.setQueryData(queryKeys.staff.session, staffSessionFixture);
  client.setQueryData(['staff', 'fixture'], 'staff-fixture');
}

function expectEveryIdentityPreserved(client: QueryClient): void {
  expect(client.getQueryData(queryKeys.buyer.session)).toEqual(buyerSessionFixture);
  expect(client.getQueryData(['buyer', 'fixture'])).toBe('buyer-fixture');
  expect(client.getQueryData(queryKeys.seller.session)).toEqual(sellerSessionFixture);
  expect(client.getQueryData(['seller', 'fixture'])).toBe('seller-fixture');
  expect(client.getQueryData(queryKeys.staff.session)).toEqual(staffSessionFixture);
  expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-fixture');
}

function expectCustomerClearedStaffPreserved(client: QueryClient): void {
  expect(client.getQueriesData({ queryKey: queryKeys.buyer.root })).toEqual([]);
  expect(client.getQueriesData({ queryKey: queryKeys.seller.root })).toEqual([]);
  expect(client.getQueryData(queryKeys.staff.session)).toEqual(staffSessionFixture);
  expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-fixture');
}

function expectStaffClearedCustomerPreserved(client: QueryClient): void {
  expect(client.getQueriesData({ queryKey: queryKeys.staff.root })).toEqual([]);
  expect(client.getQueryData(queryKeys.buyer.session)).toEqual(buyerSessionFixture);
  expect(client.getQueryData(['buyer', 'fixture'])).toBe('buyer-fixture');
  expect(client.getQueryData(queryKeys.seller.session)).toEqual(sellerSessionFixture);
  expect(client.getQueryData(['seller', 'fixture'])).toBe('seller-fixture');
}

function ProtectedProbe({ identity }: { identity: RequestIdentity }) {
  const client = useQueryClient();
  const location = useLocation();
  const [error, setError] = useState<FrontendApiError | null>(null);
  return (
    <main>
      <div>PATH:{location.pathname}</div>
      <button type="button" onClick={() => {
        void readProtected(identity, client).catch((caught: unknown) => {
          if (isFrontendApiError(caught)) setError(caught);
        });
      }}>读取保护资源</button>
      {error && <div role="alert"><span>{error.code}</span><RequestIdDisplay requestId={error.requestId} /></div>}
    </main>
  );
}

describe('protected resource 401 identity invalidation through real adapters', () => {
  it.each(identityPaths)('%s 401 awaits the matching cache clear before rethrowing the validated error', async (
    identity,
    path,
  ) => {
    server.use(http.get(apiUrl(path), () => HttpResponse.json(
      failureEnvelopeFixture('UNAUTHENTICATED', 'login', null, `request-${identity}-protected-401`),
      { status: 401 },
    )));
    const client = createMswQueryClient();
    seedEveryIdentity(client);
    const originalCancelQueries = client.cancelQueries.bind(client);
    let releaseCancellation!: () => void;
    const cancellationGate = new Promise<void>((resolve) => { releaseCancellation = resolve; });
    const cancelQueries = vi.spyOn(client, 'cancelQueries').mockImplementation(async (filters) => {
      await cancellationGate;
      return originalCancelQueries(filters);
    });
    let rejected = false;
    const request = readProtected(identity, client).catch((error: unknown) => {
      rejected = true;
      throw error;
    });
    const expectedCancellations = identity === 'staff' ? 1 : 2;

    await waitFor(() => expect(cancelQueries).toHaveBeenCalledTimes(expectedCancellations));
    expect(rejected).toBe(false);
    expectEveryIdentityPreserved(client);

    releaseCancellation();
    const error = await request.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FrontendApiError);
    expect(error).toMatchObject({
      code: 'UNAUTHENTICATED',
      httpStatus: 401,
      requestId: `request-${identity}-protected-401`,
    });
    if (identity === 'staff') expectStaffClearedCustomerPreserved(client);
    else expectCustomerClearedStaffPreserved(client);
  });
});

describe('403 and 404 preserve identity Sessions through real protected adapters', () => {
  it.each(identityPaths.flatMap(([identity, path]) => [
    [identity, path, 403, 'FORBIDDEN'],
    [identity, path, 404, 'NOT_FOUND'],
  ] as const))('%s protected API on %s returns %i without clearing Session state', async (
    identity,
    path,
    status,
    code,
  ) => {
    server.use(http.get(apiUrl(path), () => HttpResponse.json(
      failureEnvelopeFixture(code, 'public message', {
        reason: 'internal-only',
        token: 'secret-token',
        object_key: 'private-key',
      }, `request-${identity}-protected-${status}`),
      { status },
    )));
    const client = createMswQueryClient();
    seedEveryIdentity(client);
    const user = userEvent.setup();
    renderWithMsw(<ProtectedProbe identity={identity} />, { route: '/protected', client });
    await user.click(screen.getByRole('button', { name: '读取保护资源' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(code);
    expect(screen.getByText(`请求编号：request-${identity}-protected-${status}`)).toBeVisible();
    expect(screen.getByText('PATH:/protected')).toBeVisible();
    expect(screen.queryByText(/secret-token|private-key|internal-only/u)).not.toBeInTheDocument();
    expectEveryIdentityPreserved(client);
  });
});

const semanticFailures = [
  [409, 'STATE_CONFLICT'],
  [422, 'VALIDATION_ERROR'],
  [429, 'RATE_LIMITED'],
  [503, 'DEPENDENCY_UNAVAILABLE'],
] as const;

describe('all non-401 failures preserve every identity cache', () => {
  it.each(identityPaths.flatMap(([identity, path]) => semanticFailures.map(([status, code]) => [
    identity,
    path,
    status,
    code,
  ] as const)))('%s %i error is rethrown without identity invalidation', async (
    identity,
    path,
    status,
    code,
  ) => {
    server.use(http.get(apiUrl(path), () => HttpResponse.json(
      failureEnvelopeFixture(code, 'failure', null, `request-${identity}-${status}`),
      { status },
    )));
    const client = createMswQueryClient();
    seedEveryIdentity(client);

    await expect(readProtected(identity, client)).rejects.toMatchObject({
      code,
      httpStatus: status,
      requestId: `request-${identity}-${status}`,
    });
    expectEveryIdentityPreserved(client);
  });

  it.each(identityPaths)('%s malformed protected response preserves every cache and request ID', async (
    identity,
    path,
  ) => {
    server.use(http.get(apiUrl(path), () => HttpResponse.json({
      data: { unexpected: true },
      meta: { request_id: `request-${identity}-malformed` },
    })));
    const client = createMswQueryClient();
    seedEveryIdentity(client);

    await expect(readProtected(identity, client)).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE',
      requestId: `request-${identity}-malformed`,
    });
    expectEveryIdentityPreserved(client);
  });

  it.each(identityPaths)('%s network failure preserves every identity cache', async (identity, path) => {
    server.use(http.get(apiUrl(path), () => HttpResponse.error()));
    const client = createMswQueryClient();
    seedEveryIdentity(client);

    await expect(readProtected(identity, client)).rejects.toMatchObject({
      code: 'NETWORK_FAILURE',
      requestId: null,
    });
    expectEveryIdentityPreserved(client);
  });

  it.each(identityPaths)('%s canceled protected request preserves every identity cache', async (
    identity,
    path,
  ) => {
    let requestStarted = false;
    server.use(http.get(apiUrl(path), async () => {
      requestStarted = true;
      await delay('infinite');
      return HttpResponse.json({ data: {}, meta: { request_id: 'unreachable' } });
    }));
    const client = createMswQueryClient();
    seedEveryIdentity(client);
    const controller = new AbortController();
    const request = readProtected(identity, client, controller.signal);
    await waitFor(() => expect(requestStarted).toBe(true));
    controller.abort();

    await expect(request).rejects.toMatchObject({ code: 'CANCELED', requestId: null });
    expectEveryIdentityPreserved(client);
  });
});
