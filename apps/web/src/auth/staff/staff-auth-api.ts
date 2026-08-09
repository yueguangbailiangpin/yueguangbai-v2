import { z } from 'zod';
import type { ApiResult } from '../../api/transport';
import { apiRequest } from '../../api/transport';
import { staffLogoutAllResponseSchema, staffLogoutResponseSchema } from './staff-logout-schemas';

export const staffLoginStartResponseSchema = z.object({
  provider: z.literal('FEISHU'),
  authorization_url: z.string().url(),
  expires_at: z.number().int(),
}).strict();

export const staffSessionSchema = z.object({
  staff_id: z.string(),
  display_name: z.string(),
  role: z.discriminatedUnion('code', [
    z.object({ code: z.literal('owner'), display_name: z.literal('总管理员') }).strict(),
    z.object({ code: z.literal('pre_sales'), display_name: z.literal('售前') }).strict(),
    z.object({ code: z.literal('seller_ops'), display_name: z.literal('卖家对接') }).strict(),
    z.object({ code: z.literal('buyer_refund'), display_name: z.literal('买家返款') }).strict(),
  ]),
  permissions: z.array(z.string()),
  data_scope: z.object({
    type: z.enum(['GLOBAL', 'ASSIGNED_BUYERS', 'ASSIGNED_SELLER_ORGANIZATIONS', 'TEAM_ASSIGNMENTS']),
    buyerCustomerIds: z.array(z.string()),
    sellerOrganizationIds: z.array(z.string()),
    teamIds: z.array(z.string()),
  }).strict(),
  authorization_version: z.number().int(),
  session_version: z.number().int(),
  expires_at: z.number().int(),
}).strict();

const staffSessionResponseSchema = z.object({ session: staffSessionSchema }).strict();

export type StaffSession = z.output<typeof staffSessionSchema>;
export type StaffLoginStart = z.output<typeof staffLoginStartResponseSchema>;

export interface StaffAuthApiAdapter {
  loginStart(returnTo: string, signal?: AbortSignal): Promise<ApiResult<StaffLoginStart>>;
  readSession(signal?: AbortSignal): Promise<ApiResult<{ session: StaffSession }>>;
  logout(signal?: AbortSignal): Promise<ApiResult<{ logged_out: true; all_devices_logged_out: false }>>;
  logoutAll(idempotencyKey: string, signal?: AbortSignal): Promise<ApiResult<{
    logged_out: true;
    all_devices_logged_out: true;
    session_version: number;
  }>>;
}

export const staffAuthApi: StaffAuthApiAdapter = Object.freeze({
  loginStart: (returnTo: string, signal?: AbortSignal) => apiRequest({
    path: '/api/staff-auth/login/start',
    method: 'POST',
    schema: staffLoginStartResponseSchema,
    body: { return_to: returnTo },
    ...(signal ? { signal } : {}),
  }),
  readSession: (signal?: AbortSignal) => apiRequest({
    path: '/api/staff-auth/session',
    method: 'GET',
    schema: staffSessionResponseSchema,
    ...(signal ? { signal } : {}),
  }),
  logout: (signal?: AbortSignal) => apiRequest({
    path: '/api/staff-auth/logout',
    method: 'POST',
    schema: staffLogoutResponseSchema,
    ...(signal ? { signal } : {}),
  }),
  logoutAll: (idempotencyKey: string, signal?: AbortSignal) => apiRequest({
    path: '/api/staff-auth/logout-all',
    method: 'POST',
    schema: staffLogoutAllResponseSchema,
    body: {},
    headers: { 'Idempotency-Key': idempotencyKey },
    ...(signal ? { signal } : {}),
  }),
});

export function startStaffBinding(
  inviteToken: string,
  signal?: AbortSignal,
): Promise<ApiResult<StaffLoginStart>> {
  return apiRequest({
    path: '/api/staff-auth/binding/start',
    method: 'POST',
    schema: staffLoginStartResponseSchema,
    body: { invite_token: inviteToken },
    ...(signal ? { signal } : {}),
  });
}
