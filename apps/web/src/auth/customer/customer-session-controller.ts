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

export type CustomerSessionControllerResult =
  | Readonly<{ status: 'LOADING'; value: null; retry: () => void }>
  | Readonly<{ status: 'AUTHENTICATED'; value: CustomerSession; retry: () => void }>
  | Readonly<{ status: 'UNAUTHENTICATED'; value: null; retry: () => void }>
  | Readonly<{
      status: 'DEPENDENCY_ERROR';
      value: null;
      cleanupFailed: boolean;
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

export function useCustomerSessionController(
  target: CustomerTarget,
  adapter: CustomerAuthApiAdapter = customerAuthApi,
): CustomerSessionControllerResult {
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

  const retryQuery = (): void => { void query.refetch(); };
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
    return { status: 'LOADING', value: null, retry: retryQuery };
  }
  if (cleanup.state === 'CLEANED') {
    return { status: 'UNAUTHENTICATED', value: null, retry: retryQuery };
  }
  if (cleanup.state === 'FAILED') {
    return {
      status: 'DEPENDENCY_ERROR',
      value: null,
      cleanupFailed: true,
      requestId: cleanup.requestId,
      retry: retryCleanup,
    };
  }
  if (unauthenticatedCleanup.state === 'CLEARING') {
    return { status: 'LOADING', value: null, retry: retryQuery };
  }
  if (unauthenticatedCleanup.state === 'CLEARED') {
    return { status: 'UNAUTHENTICATED', value: null, retry: retryQuery };
  }
  if (unauthenticatedCleanup.state === 'FAILED') {
    return {
      status: 'DEPENDENCY_ERROR',
      value: null,
      cleanupFailed: true,
      requestId: unauthenticatedCleanup.requestId,
      retry: retryUnauthenticatedCleanup,
    };
  }
  if (!freshSessionResolved) return { status: 'LOADING', value: null, retry: retryQuery };
  if (query.isSuccess) return { status: 'AUTHENTICATED', value: query.data, retry: retryQuery };
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
