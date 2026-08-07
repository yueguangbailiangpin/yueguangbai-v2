// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState, type ReactNode } from 'react';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import '../test/msw/lifecycle';
import { FrontendApiError, isFrontendApiError } from '../api/errors';
import { protectedResourcesApi } from '../api/protected-resources';
import { queryKeys } from '../api/query-client';
import { getSessionInvalidationSnapshot, type SessionInvalidationIdentity } from './session-invalidation';
import { RequestIdDisplay } from '../ui/primitives';
import {
  buyerSessionFixture,
  customerSessionEnvelopeFixture,
  failureEnvelopeFixture,
  sellerSessionFixture,
  staffSessionEnvelopeFixture,
  staffSessionFixture,
} from '../test/msw/fixtures';
import { apiUrl } from '../test/msw/handlers';
import { createMswQueryClient, renderWithMsw } from '../test/msw/render';
import { server } from '../test/msw/server';
import { CustomerSessionBoundary } from './customer/CustomerSessionBoundary';
import { StaffSessionBoundary } from './staff/StaffSessionBoundary';

afterEach(cleanup);

type MountedIdentity = SessionInvalidationIdentity;
type LoginSnapshot = Readonly<{ path: string; protectedEntries: number }>;

const mountedCases = [
  ['buyer', '/api/buyer-portal/me', 'BUYER'],
  ['seller', '/api/seller-portal/me', 'SELLER'],
  ['staff', '/api/staff/me/assignments', 'STAFF'],
] as const;

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

function readProtected(identity: MountedIdentity, client: QueryClient): Promise<unknown> {
  if (identity === 'buyer') return protectedResourcesApi.readBuyerMe(client);
  if (identity === 'seller') return protectedResourcesApi.readSellerMe(client);
  return protectedResourcesApi.readStaffAssignments(client);
}

function installSuccessfulSession(identity: MountedIdentity, requestCounter?: { current: number }): void {
  if (identity === 'staff') {
    server.use(http.get(apiUrl('/api/staff-auth/session'), () => {
      if (requestCounter) requestCounter.current += 1;
      return HttpResponse.json(staffSessionEnvelopeFixture(
        staffSessionFixture,
        `request-mounted-staff-session-${requestCounter?.current ?? 1}`,
      ));
    }));
    return;
  }
  const session = identity === 'buyer' ? buyerSessionFixture : sellerSessionFixture;
  server.use(http.get(apiUrl('/api/customer-auth/session'), () => {
    if (requestCounter) requestCounter.current += 1;
    return HttpResponse.json(customerSessionEnvelopeFixture(
      session,
      `request-mounted-${identity}-session-${requestCounter?.current ?? 1}`,
    ));
  }));
}

function MountedShellProbe({
  identity,
  label,
  observedErrors,
}: {
  identity: MountedIdentity;
  label: string;
  observedErrors: FrontendApiError[];
}) {
  const client = useQueryClient();
  const [error, setError] = useState<FrontendApiError | null>(null);
  const capture = (caught: unknown): void => {
    if (isFrontendApiError(caught)) {
      observedErrors.push(caught);
      setError(caught);
    }
  };
  return (
    <section>
      <h1>{label} MOUNTED SHELL</h1>
      <p>{label} PRIVATE CONTENT</p>
      <button type="button" onClick={() => { void readProtected(identity, client).catch(capture); }}>
        读取{label}保护资源
      </button>
      <button type="button" onClick={() => {
        void Promise.allSettled([
          readProtected(identity, client),
          readProtected(identity, client),
        ]).then((results) => {
          const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
          if (rejected) capture(rejected.reason);
        });
      }}>并发读取{label}保护资源</button>
      <button type="button" onClick={() => {
        void client.refetchQueries({ queryKey: queryKeys[identity].session });
      }}>刷新{label}会话</button>
      {error && (
        <div role="alert">
          <span>{error.code}</span>
          <RequestIdDisplay requestId={error.requestId} />
        </div>
      )}
    </section>
  );
}

function LoginProbe({
  identity,
  label,
  snapshots,
}: {
  identity: MountedIdentity;
  label: string;
  snapshots: LoginSnapshot[];
}) {
  const client = useQueryClient();
  const location = useLocation();
  const roots = identity === 'staff'
    ? [queryKeys.staff.root]
    : [queryKeys.buyer.root, queryKeys.seller.root];
  snapshots.push({
    path: location.pathname,
    protectedEntries: roots.reduce(
      (count, root) => count + client.getQueriesData({ queryKey: root })
        .filter((entry) => entry[1] !== undefined).length,
      0,
    ),
  });
  return <div>{label} LOGIN</div>;
}

function boundary(identity: MountedIdentity, children: ReactNode): ReactNode {
  if (identity === 'staff') return <StaffSessionBoundary>{children}</StaffSessionBoundary>;
  return <CustomerSessionBoundary target={identity}>{children}</CustomerSessionBoundary>;
}

function MountedRoutes({
  identity,
  label,
  loginSnapshots,
  observedErrors = [],
}: {
  identity: MountedIdentity;
  label: string;
  loginSnapshots: LoginSnapshot[];
  observedErrors?: FrontendApiError[];
}) {
  return (
    <Routes>
      <Route path={`/${identity}`} element={boundary(
        identity,
        <MountedShellProbe identity={identity} label={label} observedErrors={observedErrors} />,
      )} />
      <Route
        path={`/${identity}/login`}
        element={<LoginProbe identity={identity} label={label} snapshots={loginSnapshots} />}
      />
      {identity === 'seller' && <Route path="/buyer/login" element={<div>BUYER LOGIN</div>} />}
    </Routes>
  );
}

function installProtectedFailure(
  path: `/api/${string}`,
  status: 401 | 403 | 404,
  code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND',
  requestId: string,
): void {
  server.use(http.get(apiUrl(path), () => HttpResponse.json(
    failureEnvelopeFixture(code, 'public message', {
      reason: 'internal-only',
      token: 'secret-token',
      object_key: 'private-object',
    }, requestId),
    { status },
  )));
}

describe('mounted protected API 401 Session transitions', () => {
  it.each(mountedCases)('%s mounted Shell fails closed and enters only its login after 401 cleanup', async (
    identity,
    path,
    label,
  ) => {
    installSuccessfulSession(identity);
    installProtectedFailure(path, 401, 'UNAUTHENTICATED', `request-mounted-${identity}-401`);
    const client = createMswQueryClient();
    seedEveryIdentity(client);
    let releaseCancellation!: () => void;
    const cancellationGate = new Promise<void>((resolve) => { releaseCancellation = resolve; });
    const originalCancelQueries = client.cancelQueries.bind(client);
    const cancelQueries = vi.spyOn(client, 'cancelQueries').mockImplementation(async (filters) => {
      await cancellationGate;
      return originalCancelQueries(filters);
    });
    const loginSnapshots: LoginSnapshot[] = [];
    const user = userEvent.setup();
    renderWithMsw(<MountedRoutes
      identity={identity}
      label={label}
      loginSnapshots={loginSnapshots}
    />, { route: `/${identity}`, client });

    expect(await screen.findByText(`${label} MOUNTED SHELL`)).toBeVisible();
    await user.click(screen.getByRole('button', { name: `读取${label}保护资源` }));
    const expectedCancellations = identity === 'staff' ? 1 : 2;
    await waitFor(() => expect(cancelQueries).toHaveBeenCalledTimes(expectedCancellations));
    await waitFor(() => expect(screen.queryByText(`${label} MOUNTED SHELL`)).not.toBeInTheDocument());
    expect(screen.queryByText(`${label} PRIVATE CONTENT`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${label} LOGIN`)).not.toBeInTheDocument();
    expect(screen.queryByText(/secret-token|private-object|internal-only/u)).not.toBeInTheDocument();

    releaseCancellation();
    expect(await screen.findByText(`${label} LOGIN`)).toBeVisible();
    expect(loginSnapshots).toEqual([{ path: `/${identity}/login`, protectedEntries: 0 }]);
    expect(cancelQueries).toHaveBeenCalledTimes(expectedCancellations);
    if (identity === 'staff') expectStaffClearedCustomerPreserved(client);
    else expectCustomerClearedStaffPreserved(client);
    if (identity === 'seller') expect(screen.queryByText('BUYER LOGIN')).not.toBeInTheDocument();
  });

  it.each([
    ['buyer', '/api/buyer-portal/me', 'BUYER'],
    ['staff', '/api/staff/me/assignments', 'STAFF'],
  ] as const)('%s concurrent 401 responses reuse one in-flight identity cleanup', async (
    identity,
    path,
    label,
  ) => {
    installSuccessfulSession(identity);
    let protectedRequests = 0;
    server.use(http.get(apiUrl(path), () => {
      protectedRequests += 1;
      return HttpResponse.json(failureEnvelopeFixture(
        'UNAUTHENTICATED', 'login', null, `request-${identity}-duplicate-${protectedRequests}`,
      ), { status: 401 });
    }));
    const client = createMswQueryClient();
    seedEveryIdentity(client);
    let releaseCancellation!: () => void;
    const cancellationGate = new Promise<void>((resolve) => { releaseCancellation = resolve; });
    const originalCancelQueries = client.cancelQueries.bind(client);
    const cancelQueries = vi.spyOn(client, 'cancelQueries').mockImplementation(async (filters) => {
      await cancellationGate;
      return originalCancelQueries(filters);
    });
    const user = userEvent.setup();
    renderWithMsw(<MountedRoutes identity={identity} label={label} loginSnapshots={[]} />, {
      route: `/${identity}`,
      client,
    });

    expect(await screen.findByText(`${label} MOUNTED SHELL`)).toBeVisible();
    await user.click(screen.getByRole('button', { name: `并发读取${label}保护资源` }));
    const expectedCancellations = identity === 'staff' ? 1 : 2;
    await waitFor(() => expect(protectedRequests).toBe(2));
    await waitFor(() => expect(cancelQueries).toHaveBeenCalledTimes(expectedCancellations));
    await waitFor(() => expect(screen.queryByText(`${label} MOUNTED SHELL`)).not.toBeInTheDocument());

    releaseCancellation();
    expect(await screen.findByText(`${label} LOGIN`)).toBeVisible();
    expect(cancelQueries).toHaveBeenCalledTimes(expectedCancellations);
  });
});

describe('stale protected 401 cannot invalidate a newer fresh Session cycle', () => {
  it.each([
    ['buyer', '/api/buyer-portal/me', 'BUYER'],
    ['staff', '/api/staff/me/assignments', 'STAFF'],
  ] as const)('%s old 401 preserves the newer mounted Session and cache generation', async (
    identity,
    path,
    label,
  ) => {
    const sessionRequests = { current: 0 };
    installSuccessfulSession(identity, sessionRequests);
    let protectedStarted = false;
    let releaseProtected!: () => void;
    const protectedGate = new Promise<void>((resolve) => { releaseProtected = resolve; });
    server.use(http.get(apiUrl(path), async () => {
      protectedStarted = true;
      await protectedGate;
      return HttpResponse.json(failureEnvelopeFixture(
        'UNAUTHENTICATED', 'login', { token: 'old-secret' }, `request-${identity}-stale-401`,
      ), { status: 401 });
    }));
    const client = createMswQueryClient();
    seedEveryIdentity(client);
    const cancelQueries = vi.spyOn(client, 'cancelQueries');
    const observedErrors: FrontendApiError[] = [];
    const user = userEvent.setup();
    renderWithMsw(<MountedRoutes
      identity={identity}
      label={label}
      loginSnapshots={[]}
      observedErrors={observedErrors}
    />, {
      route: `/${identity}`,
      client,
    });

    expect(await screen.findByText(`${label} MOUNTED SHELL`)).toBeVisible();
    const firstGeneration = getSessionInvalidationSnapshot(client, identity).generation;
    await user.click(screen.getByRole('button', { name: `读取${label}保护资源` }));
    await waitFor(() => expect(protectedStarted).toBe(true));
    await user.click(screen.getByRole('button', { name: `刷新${label}会话` }));
    await waitFor(() => expect(sessionRequests.current).toBe(2));
    await waitFor(() => expect(
      getSessionInvalidationSnapshot(client, identity).generation,
    ).toBe(firstGeneration + 1));
    expect(await screen.findByText(`${label} MOUNTED SHELL`)).toBeVisible();
    if (identity === 'staff') client.setQueryData(['staff', 'fixture'], 'staff-new-cycle');
    else {
      client.setQueryData(['buyer', 'fixture'], 'buyer-new-cycle');
      client.setQueryData(['seller', 'fixture'], 'seller-new-cycle');
    }

    releaseProtected();
    await waitFor(() => expect(observedErrors).toHaveLength(1));
    expect(observedErrors[0]).toMatchObject({
      code: 'UNAUTHENTICATED',
      requestId: `request-${identity}-stale-401`,
    });
    expect(screen.getByText(`${label} MOUNTED SHELL`)).toBeVisible();
    expect(screen.queryByText(`${label} LOGIN`)).not.toBeInTheDocument();
    expect(screen.queryByText('old-secret')).not.toBeInTheDocument();
    expect(cancelQueries).not.toHaveBeenCalled();
    if (identity === 'staff') {
      expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-new-cycle');
      expect(client.getQueryData(['buyer', 'fixture'])).toBe('buyer-fixture');
      expect(client.getQueryData(['seller', 'fixture'])).toBe('seller-fixture');
    } else {
      expect(client.getQueryData(['buyer', 'fixture'])).toBe('buyer-new-cycle');
      expect(client.getQueryData(['seller', 'fixture'])).toBe('seller-new-cycle');
      expect(client.getQueryData(['staff', 'fixture'])).toBe('staff-fixture');
    }
  });
});

describe('mounted 403 and 404 keep the authenticated identity Shell', () => {
  it.each(mountedCases.flatMap(([identity, path, label]) => [
    [identity, path, label, 403, 'FORBIDDEN'],
    [identity, path, label, 404, 'NOT_FOUND'],
  ] as const))('%s mounted Shell remains authenticated after %i', async (
    identity,
    path,
    label,
    status,
    code,
  ) => {
    installSuccessfulSession(identity);
    installProtectedFailure(
      path,
      status,
      code,
      `request-mounted-${identity}-${status}`,
    );
    const client = createMswQueryClient();
    seedEveryIdentity(client);
    const user = userEvent.setup();
    renderWithMsw(<MountedRoutes identity={identity} label={label} loginSnapshots={[]} />, {
      route: `/${identity}`,
      client,
    });

    expect(await screen.findByText(`${label} MOUNTED SHELL`)).toBeVisible();
    await user.click(screen.getByRole('button', { name: `读取${label}保护资源` }));
    expect(await screen.findByRole('alert')).toHaveTextContent(code);
    expect(screen.getByText(`请求编号：request-mounted-${identity}-${status}`)).toBeVisible();
    expect(screen.getByText(`${label} MOUNTED SHELL`)).toBeVisible();
    expect(screen.getByText(`${label} PRIVATE CONTENT`)).toBeVisible();
    expect(screen.queryByText(`${label} LOGIN`)).not.toBeInTheDocument();
    expect(screen.queryByText(/secret-token|private-object|internal-only/u)).not.toBeInTheDocument();
    expectEveryIdentityPreserved(client);
  });
});

describe('mounted protected 401 cleanup failures remain fail closed and explicitly retryable', () => {
  it.each([
    ['buyer', '/api/buyer-portal/me', 'BUYER'],
    ['staff', '/api/staff/me/assignments', 'STAFF'],
  ] as const)('%s cleanup failure hides its Shell and retries only after user action', async (
    identity,
    path,
    label,
  ) => {
    installSuccessfulSession(identity);
    installProtectedFailure(path, 401, 'UNAUTHENTICATED', `request-${identity}-cleanup-failed`);
    const client = createMswQueryClient();
    seedEveryIdentity(client);
    const originalCancelQueries = client.cancelQueries.bind(client);
    let cancellationFails = true;
    const cancelQueries = vi.spyOn(client, 'cancelQueries').mockImplementation(async (filters) => {
      if (cancellationFails) throw new Error('cancel-failed');
      return originalCancelQueries(filters);
    });
    const loginSnapshots: LoginSnapshot[] = [];
    const user = userEvent.setup();
    renderWithMsw(<MountedRoutes
      identity={identity}
      label={label}
      loginSnapshots={loginSnapshots}
    />, { route: `/${identity}`, client });

    expect(await screen.findByText(`${label} MOUNTED SHELL`)).toBeVisible();
    await user.click(screen.getByRole('button', { name: `读取${label}保护资源` }));
    expect(await screen.findByRole('heading', { name: '会话清理失败，请重试或刷新' })).toBeVisible();
    expect(screen.getByText(`请求编号：request-${identity}-cleanup-failed`)).toBeVisible();
    expect(screen.queryByText(`${label} MOUNTED SHELL`)).not.toBeInTheDocument();
    expect(screen.queryByText(`${label} LOGIN`)).not.toBeInTheDocument();
    if (identity === 'staff') expectStaffClearedCustomerPreserved(client);
    else expectCustomerClearedStaffPreserved(client);

    cancellationFails = false;
    await user.click(screen.getByRole('button', { name: '重新清理' }));
    expect(await screen.findByText(`${label} LOGIN`)).toBeVisible();
    expect(loginSnapshots).toEqual([{ path: `/${identity}/login`, protectedEntries: 0 }]);
    expect(cancelQueries).toHaveBeenCalledTimes(identity === 'staff' ? 2 : 4);
  });
});
