import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FrontendApiError, isFrontendApiError } from '../api/errors';
import { queryKeys } from '../api/query-client';
import { clearStaffTransport } from './customer-transport-invalidation';
import {
  broadcastSessionInvalidation,
  captureSessionCycle,
  createSessionInvalidationMarker,
  establishFreshSessionCycle,
  retrySessionInvalidation,
  type SessionCycle,
  useSessionInvalidation,
} from './session-invalidation';
import { customerSessionSchema, type CustomerSession } from './customer/customer-auth-api';
import { staffAuthApi, staffSessionSchema, type StaffAuthApiAdapter, type StaffSession } from './staff/staff-auth-api';

export type Identity = 'buyer' | 'seller' | 'staff';

export type { CustomerSession };
export type { StaffSession };
export type StaffSessionResult =
  | Readonly<{ status: 'LOADING'; value: null; retry: () => void }>
  | Readonly<{ status: 'AUTHENTICATED'; value: StaffSession }>
  | Readonly<{ status: 'UNAUTHENTICATED'; value: null; retry: () => void }>
  | Readonly<{
      status: 'DEPENDENCY_ERROR';
      value: null;
      cleanupFailed: boolean;
      requestId: string | null;
      retry: () => void;
    }>;

type StaffCleanupView = Readonly<{
  state: 'IDLE' | 'CLEARING' | 'CLEARED' | 'FAILED';
  requestId: string | null;
}>;

export function useStaffSession(adapter: StaffAuthApiAdapter = staffAuthApi): StaffSessionResult {
  const client = useQueryClient();
  const mountedRef = useRef(true);
  const verifiedGenerationRef = useRef<number | null>(null);
  const sessionReadCycleRef = useRef<SessionCycle | null>(null);
  const [clearing, setClearing] = useState<StaffCleanupView>({ state: 'IDLE', requestId: null });
  const invalidation = useSessionInvalidation(client, 'staff');
  const mayResolveInvalidatedMountRef = useRef(invalidation.status === 'INVALIDATED');
  const invalidationAllowsSessionRead = invalidation.status === 'STABLE'
    || (mayResolveInvalidatedMountRef.current && invalidation.status === 'INVALIDATED');
  const query = useQuery({
    queryKey: queryKeys.staff.session,
    queryFn: async ({ signal }) => {
      const requestCycle = captureSessionCycle(client, 'staff');
      sessionReadCycleRef.current = requestCycle;
      const session = (await adapter.readSession(signal)).data.session;
      const marker = await createSessionInvalidationMarker(
        'staff', session.staff_id, session.session_version, session.expires_at,
      );
      const generation = establishFreshSessionCycle(client, 'staff', requestCycle, marker);
      if (generation === null) {
        throw new FrontendApiError('CANCELED', 0, null, 'CANCELED');
      }
      verifiedGenerationRef.current = generation;
      sessionReadCycleRef.current = null;
      mayResolveInvalidatedMountRef.current = false;
      return session;
    },
    retry: false,
    refetchOnMount: 'always',
    enabled: clearing.state === 'IDLE' && invalidationAllowsSessionRead,
  });
  const freshSessionResolved = query.isFetchedAfterMount && !query.isFetching;
  const verifiedFreshSession = freshSessionResolved
    && query.isSuccess
    && invalidation.status === 'STABLE'
    && verifiedGenerationRef.current === invalidation.generation;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (freshSessionResolved
      && clearing.state === 'IDLE'
      && isFrontendApiError(query.error)
      && query.error.httpStatus === 401) {
      const requestId = query.error.requestId;
      const requestCycle = sessionReadCycleRef.current;
      if (requestCycle) broadcastSessionInvalidation(client, 'staff', requestCycle, requestId);
      setClearing({ state: 'CLEARING', requestId });
      void clearStaffTransport(client).then(() => {
        if (mountedRef.current) setClearing({ state: 'CLEARED', requestId });
      }).catch(() => {
        if (mountedRef.current) setClearing({ state: 'FAILED', requestId });
      });
    }
  }, [clearing.state, client, freshSessionResolved, query.error]);

  useEffect(() => {
    if (clearing.state !== 'IDLE' || invalidation.status !== 'STABLE') {
      client.removeQueries({ queryKey: queryKeys.staff.root });
    }
  }, [clearing.state, client, invalidation.status]);

  const retryQuery = (): void => { void query.refetch(); };
  const retrySessionCleanup = (): void => {
    const requestId = clearing.requestId;
    setClearing({ state: 'CLEARING', requestId });
    void clearStaffTransport(client).then(() => {
      if (mountedRef.current) setClearing({ state: 'CLEARED', requestId });
    }).catch(() => {
      if (mountedRef.current) setClearing({ state: 'FAILED', requestId });
    });
  };
  const retryProtectedInvalidation = (): void => {
    void retrySessionInvalidation(client, 'staff').catch(() => undefined);
  };

  if (invalidation.status === 'CLEARING') {
    return { status: 'LOADING', value: null, retry: retryQuery };
  }
  if (invalidation.status === 'FAILED') {
    return {
      status: 'DEPENDENCY_ERROR',
      value: null,
      cleanupFailed: true,
      requestId: invalidation.requestId,
      retry: retryProtectedInvalidation,
    };
  }
  if (clearing.state === 'CLEARING') return { status: 'LOADING', value: null, retry: retryQuery };
  if (clearing.state === 'CLEARED') return { status: 'UNAUTHENTICATED', value: null, retry: retryQuery };
  if (clearing.state === 'FAILED') {
    return {
      status: 'DEPENDENCY_ERROR',
      value: null,
      cleanupFailed: true,
      requestId: clearing.requestId,
      retry: retrySessionCleanup,
    };
  }
  if (invalidation.status === 'INVALIDATED' && !mayResolveInvalidatedMountRef.current) {
    return { status: 'UNAUTHENTICATED', value: null, retry: retryQuery };
  }
  if (!freshSessionResolved) return { status: 'LOADING', value: null, retry: retryQuery };
  if (verifiedFreshSession) return { status: 'AUTHENTICATED', value: query.data };
  if (isFrontendApiError(query.error) && query.error.httpStatus === 401) {
    return { status: 'LOADING', value: null, retry: retryQuery };
  }
  return {
    status: 'DEPENDENCY_ERROR',
    value: null,
    cleanupFailed: false,
    requestId: isFrontendApiError(query.error) ? query.error.requestId : null,
    retry: retryQuery,
  };
}

export { customerSessionSchema, staffSessionSchema };
