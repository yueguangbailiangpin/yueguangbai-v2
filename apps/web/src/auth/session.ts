import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { z } from 'zod';
import { apiRequest } from '../api/transport';
import { queryKeys } from '../api/query-client';
import { isFrontendApiError } from '../api/errors';
import { CUSTOMER_TRANSPORT_INVALIDATION_GROUP, clearStaffTransport } from './customer-transport-invalidation';

export type SessionStatus = 'UNKNOWN' | 'LOADING' | 'AUTHENTICATED' | 'UNAUTHENTICATED' | 'DEPENDENCY_ERROR';
export type Identity = 'buyer' | 'seller' | 'staff';

const customerSession = z.object({
  account_id: z.string(), identity_subject_id: z.string(), account_type: z.enum(['BUYER', 'SELLER_MEMBER']),
  session_version: z.number().int(), password_change_required: z.boolean(), issued_at: z.number().int(), expires_at: z.number().int(),
}).strict();
const staffSession = z.object({
  staff_id: z.string(), display_name: z.string(), roles: z.array(z.string()), permissions: z.array(z.string()),
  data_scope: z.unknown(), authorization_version: z.number().int(), session_version: z.number().int(), expires_at: z.number().int(),
}).strict();

export type CustomerSession = z.output<typeof customerSession>;
export type StaffSession = z.output<typeof staffSession>;
export type SessionValue = CustomerSession | StaffSession;

export const customerSessionResponseSchema = z.object({ session: customerSession }).strict();
export const staffSessionResponseSchema = z.object({ session: staffSession }).strict();

function sessionEndpoint(identity: Identity): { path: string; schema: typeof customerSessionResponseSchema | typeof staffSessionResponseSchema } {
  if (identity === 'staff') return { path: '/api/staff-auth/session', schema: staffSessionResponseSchema };
  return { path: '/api/customer-auth/session', schema: customerSessionResponseSchema };
}

function keyFor(identity: Identity) {
  return queryKeys[identity].session;
}

export function useIdentitySession(identity: Identity): Readonly<{ status: SessionStatus; value: SessionValue | null; refetch: () => void }> {
  const client = useQueryClient();
  const endpoint = sessionEndpoint(identity);
  const query = useQuery({
    queryKey: keyFor(identity),
    queryFn: async ({ signal }) => (await apiRequest({ path: endpoint.path, method: 'GET', schema: endpoint.schema, signal })).data.session,
    retry: false,
  });
  useEffect(() => { if (isFrontendApiError(query.error) && query.error.httpStatus === 401) { if (identity === 'staff') void clearStaffTransport(client); else void CUSTOMER_TRANSPORT_INVALIDATION_GROUP.clear(client); } }, [client, identity, query.error]);
  if (query.isPending) return { status: 'LOADING', value: null, refetch: () => { void query.refetch(); } };
  if (query.isSuccess) {
    const value = query.data;
    if ((identity === 'buyer' && (!('account_type' in value) || value.account_type !== 'BUYER')) ||
        (identity === 'seller' && (!('account_type' in value) || value.account_type !== 'SELLER_MEMBER')) ||
        (identity === 'staff' && 'account_type' in value)) {
      return { status: 'UNAUTHENTICATED', value: null, refetch: () => { void query.refetch(); } };
    }
    return { status: 'AUTHENTICATED', value, refetch: () => { void query.refetch(); } };
  }
  if (isFrontendApiError(query.error) && query.error.httpStatus === 401) return { status: 'UNAUTHENTICATED', value: null, refetch: () => { void query.refetch(); } };
  return { status: 'DEPENDENCY_ERROR', value: null, refetch: () => { void query.refetch(); } };
}

export const customerSessionSchema = customerSession;
export const staffSessionSchema = staffSession;
