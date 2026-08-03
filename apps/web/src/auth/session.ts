import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { isFrontendApiError } from '../api/errors';
import { queryKeys } from '../api/query-client';
import { apiRequest } from '../api/transport';
import { clearStaffTransport } from './customer-transport-invalidation';
import { customerSessionSchema, type CustomerSession } from './customer/customer-auth-api';

export type Identity = 'buyer' | 'seller' | 'staff';

const staffSessionSchema = z.object({
  staff_id: z.string(),
  display_name: z.string(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  data_scope: z.unknown(),
  authorization_version: z.number().int(),
  session_version: z.number().int(),
  expires_at: z.number().int(),
}).strict();

const staffSessionResponseSchema = z.object({ session: staffSessionSchema }).strict();

export type { CustomerSession };
export type StaffSession = z.output<typeof staffSessionSchema>;
export type StaffSessionResult =
  | Readonly<{ status: 'LOADING'; value: null }>
  | Readonly<{ status: 'AUTHENTICATED'; value: StaffSession }>
  | Readonly<{ status: 'UNAUTHENTICATED'; value: null }>
  | Readonly<{ status: 'DEPENDENCY_ERROR'; value: null }>;

export function useStaffSession(): StaffSessionResult {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.staff.session,
    queryFn: async ({ signal }) => (await apiRequest({
      path: '/api/staff-auth/session',
      method: 'GET',
      schema: staffSessionResponseSchema,
      signal,
    })).data.session,
    retry: false,
  });

  useEffect(() => {
    if (isFrontendApiError(query.error) && query.error.httpStatus === 401) {
      void clearStaffTransport(client);
    }
  }, [client, query.error]);

  if (query.isPending) return { status: 'LOADING', value: null };
  if (query.isSuccess) return { status: 'AUTHENTICATED', value: query.data };
  if (isFrontendApiError(query.error) && query.error.httpStatus === 401) {
    return { status: 'UNAUTHENTICATED', value: null };
  }
  return { status: 'DEPENDENCY_ERROR', value: null };
}

export { customerSessionSchema, staffSessionSchema };
