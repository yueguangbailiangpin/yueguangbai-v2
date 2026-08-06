import { z } from 'zod';
import type { ApiResult } from '../../api/transport';
import { apiRequest } from '../../api/transport';

export const customerSessionSchema = z.object({
  account_id: z.string(),
  identity_subject_id: z.string(),
  account_type: z.enum(['BUYER', 'SELLER_MEMBER']),
  available_personas: z.array(z.enum(['BUYER', 'SELLER_MEMBER'])).optional(),
  session_version: z.number().int(),
  password_change_required: z.boolean(),
  issued_at: z.number().int(),
  expires_at: z.number().int(),
}).strict();

const customerSessionResponseSchema = z.object({
  session: customerSessionSchema,
}).strict();

const customerLogoutResponseSchema = z.object({
  logged_out: z.literal(true),
  all_devices_logged_out: z.literal(false),
}).strict();

export type CustomerSession = z.output<typeof customerSessionSchema>;
export type CustomerTarget = 'buyer' | 'seller';
export type CustomerLoginBody = Readonly<{
  login_identifier: string;
  password: string;
  persona?: 'BUYER' | 'SELLER_MEMBER';
}>;
export type CustomerPasswordBody = Readonly<{
  current_password: string;
  new_password: string;
}>;

export interface CustomerAuthApiAdapter {
  login(body: CustomerLoginBody, signal?: AbortSignal): Promise<ApiResult<{ session: CustomerSession }>>;
  logout(signal?: AbortSignal): Promise<ApiResult<{ logged_out: true; all_devices_logged_out: false }>>;
  changePassword(body: CustomerPasswordBody, idempotencyKey: string, signal?: AbortSignal): Promise<ApiResult<{ session: CustomerSession }>>;
  readSession(signal?: AbortSignal): Promise<ApiResult<{ session: CustomerSession }>>;
  selectPersona?(persona: 'BUYER' | 'SELLER_MEMBER', signal?: AbortSignal): Promise<ApiResult<{ session: CustomerSession }>>;
}

export const customerAuthApi: CustomerAuthApiAdapter = Object.freeze({
  login: (body: CustomerLoginBody, signal?: AbortSignal) => apiRequest({
    path: '/api/customer-auth/login',
    method: 'POST',
    schema: customerSessionResponseSchema,
    body,
    ...(signal ? { signal } : {}),
  }),
  logout: (signal?: AbortSignal) => apiRequest({
    path: '/api/customer-auth/logout',
    method: 'POST',
    schema: customerLogoutResponseSchema,
    ...(signal ? { signal } : {}),
  }),
  changePassword: (body: CustomerPasswordBody, idempotencyKey: string, signal?: AbortSignal) => apiRequest({
    path: '/api/customer-auth/change-password',
    method: 'POST',
    schema: customerSessionResponseSchema,
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
    ...(signal ? { signal } : {}),
  }),
  readSession: (signal?: AbortSignal) => apiRequest({
    path: '/api/customer-auth/session',
    method: 'GET',
    schema: customerSessionResponseSchema,
    ...(signal ? { signal } : {}),
  }),
  selectPersona: (
    persona: 'BUYER' | 'SELLER_MEMBER',
    signal?: AbortSignal,
  ) => apiRequest({
    path: '/api/customer-auth/select-persona',
    method: 'POST',
    schema: customerSessionResponseSchema,
    body: { persona },
    ...(signal ? { signal } : {}),
  }),
});

export function expectedAccountType(target: CustomerTarget): CustomerSession['account_type'] {
  return target === 'buyer' ? 'BUYER' : 'SELLER_MEMBER';
}
