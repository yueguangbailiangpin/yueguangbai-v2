import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isFrontendApiError } from '../api/errors';
import { queryKeys } from '../api/query-client';
import { clearStaffTransport } from './customer-transport-invalidation';
import { customerSessionSchema, type CustomerSession } from './customer/customer-auth-api';
import { staffAuthApi, staffSessionSchema, type StaffAuthApiAdapter, type StaffSession } from './staff/staff-auth-api';

export type Identity = 'buyer' | 'seller' | 'staff';

export type { CustomerSession };
export type { StaffSession };
export type StaffSessionResult =
  | Readonly<{ status: 'LOADING'; value: null }>
  | Readonly<{ status: 'AUTHENTICATED'; value: StaffSession }>
  | Readonly<{ status: 'UNAUTHENTICATED'; value: null }>
  | Readonly<{ status: 'DEPENDENCY_ERROR'; value: null }>;

export function useStaffSession(adapter: StaffAuthApiAdapter = staffAuthApi): StaffSessionResult {
  const client = useQueryClient();
  const [clearing, setClearing] = useState<'IDLE' | 'CLEARING' | 'CLEARED'>('IDLE');
  const query = useQuery({
    queryKey: queryKeys.staff.session,
    queryFn: async ({ signal }) => (await adapter.readSession(signal)).data.session,
    retry: false,
    enabled: clearing === 'IDLE',
  });

  useEffect(() => {
    if (isFrontendApiError(query.error) && query.error.httpStatus === 401) {
      setClearing('CLEARING');
      void clearStaffTransport(client).then(() => setClearing('CLEARED'));
    }
  }, [client, query.error]);

  useEffect(() => {
    if (clearing !== 'IDLE') client.removeQueries({ queryKey: queryKeys.staff.root });
  }, [clearing, client]);

  if (clearing === 'CLEARING') return { status: 'LOADING', value: null };
  if (clearing === 'CLEARED') return { status: 'UNAUTHENTICATED', value: null };
  if (query.isPending) return { status: 'LOADING', value: null };
  if (query.isSuccess) return { status: 'AUTHENTICATED', value: query.data };
  if (isFrontendApiError(query.error) && query.error.httpStatus === 401) {
    return { status: 'UNAUTHENTICATED', value: null };
  }
  return { status: 'DEPENDENCY_ERROR', value: null };
}

export { customerSessionSchema, staffSessionSchema };
