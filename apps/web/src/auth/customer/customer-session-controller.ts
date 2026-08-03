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

type UnauthenticatedCleanupState = 'IDLE' | 'CLEARING' | 'CLEARED';

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
  const [unauthenticatedCleanup, setUnauthenticatedCleanup] = useState<UnauthenticatedCleanupState>('IDLE');
  const query = useQuery({
    queryKey: queryKeys[target].session,
    queryFn: async ({ signal }) => (await adapter.readSession(signal)).data.session,
    retry: false,
    enabled: cleanup.state === 'IDLE' && unauthenticatedCleanup === 'IDLE',
  });
  const mismatch = query.isSuccess
    && query.data.account_type !== expectedAccountType(target);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (cleanup.state === 'IDLE' && unauthenticatedCleanup !== 'CLEARED') return;
    client.removeQueries({ queryKey: queryKeys.buyer.root });
    client.removeQueries({ queryKey: queryKeys.seller.root });
  }, [cleanup.state, client, unauthenticatedCleanup]);

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

  const retryQuery = (): void => { void query.refetch(); };
  const retryCleanup = (): void => {
    setCleanup({ state: 'CLEANING', requestId: null });
    void coordinator.retry().then((result) => {
      if (mountedRef.current) setCleanup(result);
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
  if (unauthenticatedCleanup === 'CLEARING') {
    return { status: 'LOADING', value: null, retry: retryQuery };
  }
  if (unauthenticatedCleanup === 'CLEARED') {
    return { status: 'UNAUTHENTICATED', value: null, retry: retryQuery };
  }
  if (query.isPending) return { status: 'LOADING', value: null, retry: retryQuery };
  if (query.isSuccess) return { status: 'AUTHENTICATED', value: query.data, retry: retryQuery };
  if (isFrontendApiError(query.error) && query.error.httpStatus === 401) {
    return { status: 'UNAUTHENTICATED', value: null, retry: retryQuery };
  }
  return {
    status: 'DEPENDENCY_ERROR',
    value: null,
    cleanupFailed: false,
    requestId: isFrontendApiError(query.error) ? query.error.requestId : null,
    retry: retryQuery,
  };
}
