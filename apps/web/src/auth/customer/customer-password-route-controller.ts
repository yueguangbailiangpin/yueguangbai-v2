import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isFrontendApiError } from '../../api/errors';
import { queryKeys } from '../../api/query-client';
import { CUSTOMER_TRANSPORT_INVALIDATION_GROUP } from '../customer-transport-invalidation';
import {
  customerAuthApi,
  expectedAccountType,
  type CustomerAuthApiAdapter,
  type CustomerSession,
  type CustomerTarget,
} from './customer-auth-api';
import {
  CustomerMismatchCleanupCoordinator,
  type CustomerMismatchCleanupState,
} from './customer-mismatch-cleanup';

export type CustomerPasswordRouteState =
  | Readonly<{ status: 'LOADING' }>
  | Readonly<{ status: 'ALLOWED'; session: CustomerSession }>
  | Readonly<{ status: 'UNAUTHENTICATED' }>
  | Readonly<{ status: 'MISMATCH_CLEANING' }>
  | Readonly<{
      status: 'MISMATCH_CLEANUP_FAILED';
      requestId: string | null;
      retry: () => void;
    }>
  | Readonly<{
      status: 'DEPENDENCY_ERROR';
      requestId: string | null;
      retry: () => void;
    }>;

type CleanupView = Readonly<{
  state: CustomerMismatchCleanupState;
  requestId: string | null;
}>;

type UnauthenticatedCleanupView = Readonly<{
  state: 'IDLE' | 'CLEARING' | 'CLEARED' | 'FAILED';
  requestId: string | null;
}>;

export function useCustomerPasswordRouteController(
  target: CustomerTarget,
  adapter: CustomerAuthApiAdapter = customerAuthApi,
): CustomerPasswordRouteState {
  const client = useQueryClient();
  const coordinator = useMemo(
    () => new CustomerMismatchCleanupCoordinator(client, adapter),
    [adapter, client],
  );
  const mountedRef = useRef(true);
  const [cleanup, setCleanup] = useState<CleanupView>({ state: 'IDLE', requestId: null });
  const [unauthenticatedCleanup, setUnauthenticatedCleanup] = useState<UnauthenticatedCleanupView>({
    state: 'IDLE',
    requestId: null,
  });
  const query = useQuery({
    queryKey: queryKeys[target].session,
    queryFn: async ({ signal }) => (await adapter.readSession(signal)).data.session,
    retry: false,
    refetchOnMount: 'always',
    enabled: cleanup.state === 'IDLE' && unauthenticatedCleanup.state === 'IDLE',
  });
  const freshSessionResolved = query.isFetchedAfterMount && !query.isFetching;
  const mismatch = freshSessionResolved && query.isSuccess
    && query.data.account_type !== expectedAccountType(target);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (cleanup.state === 'IDLE' && unauthenticatedCleanup.state === 'IDLE') return;
    client.removeQueries({ queryKey: queryKeys.buyer.root });
    client.removeQueries({ queryKey: queryKeys.seller.root });
  }, [cleanup.state, client, unauthenticatedCleanup.state]);

  useEffect(() => {
    if (!mismatch || cleanup.state !== 'IDLE') return;
    setCleanup({ state: 'CLEANING', requestId: null });
    void coordinator.clean().then((result) => {
      if (mountedRef.current) setCleanup(result);
    });
  }, [cleanup.state, coordinator, mismatch]);

  useEffect(() => {
    if (!freshSessionResolved
      || !(isFrontendApiError(query.error) && query.error.httpStatus === 401)
      || unauthenticatedCleanup.state !== 'IDLE') return;
    const requestId = query.error.requestId;
    setUnauthenticatedCleanup({ state: 'CLEARING', requestId });
    void CUSTOMER_TRANSPORT_INVALIDATION_GROUP.clear(client).then(() => {
      if (mountedRef.current) setUnauthenticatedCleanup({ state: 'CLEARED', requestId });
    }).catch(() => {
      if (mountedRef.current) setUnauthenticatedCleanup({ state: 'FAILED', requestId });
    });
  }, [client, freshSessionResolved, query.error, unauthenticatedCleanup.state]);

  const retryCleanup = (): void => {
    setCleanup({ state: 'CLEANING', requestId: null });
    void coordinator.retry().then((result) => {
      if (mountedRef.current) setCleanup(result);
    });
  };
  const retryUnauthenticatedCleanup = (): void => {
    const requestId = unauthenticatedCleanup.requestId;
    setUnauthenticatedCleanup({ state: 'CLEARING', requestId });
    void CUSTOMER_TRANSPORT_INVALIDATION_GROUP.clear(client).then(() => {
      if (mountedRef.current) setUnauthenticatedCleanup({ state: 'CLEARED', requestId });
    }).catch(() => {
      if (mountedRef.current) setUnauthenticatedCleanup({ state: 'FAILED', requestId });
    });
  };

  if (cleanup.state === 'CLEANING' || (mismatch && cleanup.state === 'IDLE')) {
    return { status: 'MISMATCH_CLEANING' };
  }
  if (cleanup.state === 'CLEANED') return { status: 'UNAUTHENTICATED' };
  if (cleanup.state === 'FAILED') {
    return {
      status: 'MISMATCH_CLEANUP_FAILED',
      requestId: cleanup.requestId,
      retry: retryCleanup,
    };
  }
  if (unauthenticatedCleanup.state === 'CLEARING') return { status: 'LOADING' };
  if (unauthenticatedCleanup.state === 'CLEARED') return { status: 'UNAUTHENTICATED' };
  if (unauthenticatedCleanup.state === 'FAILED') {
    return {
      status: 'DEPENDENCY_ERROR',
      requestId: unauthenticatedCleanup.requestId,
      retry: retryUnauthenticatedCleanup,
    };
  }
  if (!freshSessionResolved) return { status: 'LOADING' };
  if (query.isSuccess) return { status: 'ALLOWED', session: query.data };
  if (isFrontendApiError(query.error) && query.error.httpStatus === 401) {
    return { status: 'LOADING' };
  }
  return {
    status: 'DEPENDENCY_ERROR',
    requestId: isFrontendApiError(query.error) ? query.error.requestId : null,
    retry: () => { void query.refetch(); },
  };
}
