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

type UnauthenticatedCleanupState = 'IDLE' | 'CLEARING' | 'CLEARED';

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
  const [unauthenticatedCleanup, setUnauthenticatedCleanup] = useState<UnauthenticatedCleanupState>('IDLE');
  const query = useQuery({
    queryKey: queryKeys[target].session,
    queryFn: async ({ signal }) => (await adapter.readSession(signal)).data.session,
    retry: false,
  });
  const mismatch = query.isSuccess
    && query.data.account_type !== expectedAccountType(target);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!mismatch || cleanup.state !== 'IDLE') return;
    setCleanup({ state: 'CLEANING', requestId: null });
    void coordinator.clean().then((result) => {
      if (mountedRef.current) setCleanup(result);
    });
  }, [cleanup.state, coordinator, mismatch]);

  useEffect(() => {
    if (!(isFrontendApiError(query.error) && query.error.httpStatus === 401)
      || unauthenticatedCleanup !== 'IDLE') return;
    setUnauthenticatedCleanup('CLEARING');
    void CUSTOMER_TRANSPORT_INVALIDATION_GROUP.clear(client).then(() => {
      if (mountedRef.current) setUnauthenticatedCleanup('CLEARED');
    });
  }, [client, query.error, unauthenticatedCleanup]);

  const retryCleanup = (): void => {
    setCleanup({ state: 'CLEANING', requestId: null });
    void coordinator.retry().then((result) => {
      if (mountedRef.current) setCleanup(result);
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
  if (unauthenticatedCleanup === 'CLEARING') return { status: 'LOADING' };
  if (unauthenticatedCleanup === 'CLEARED') return { status: 'UNAUTHENTICATED' };
  if (query.isPending) return { status: 'LOADING' };
  if (query.isSuccess) return { status: 'ALLOWED', session: query.data };
  if (isFrontendApiError(query.error) && query.error.httpStatus === 401) {
    return { status: 'UNAUTHENTICATED' };
  }
  return {
    status: 'DEPENDENCY_ERROR',
    requestId: isFrontendApiError(query.error) ? query.error.requestId : null,
    retry: () => { void query.refetch(); },
  };
}
