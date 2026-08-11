import { z } from 'zod';
import type { ApiResult } from '../../api/transport';
import { apiRequest } from '../../api/transport';
import { staffLogoutAllResponseSchema, staffLogoutResponseSchema } from './staff-logout-schemas';

export const staffSessionSchema = z.object({
  staff_id: z.string(), display_name: z.string(),
  role: z.discriminatedUnion('code', [
    z.object({ code: z.literal('owner'), display_name: z.literal('总管理员') }).strict(),
    z.object({ code: z.literal('acquisition'), display_name: z.literal('获客') }).strict(),
    z.object({ code: z.literal('pre_sales'), display_name: z.literal('售前') }).strict(),
    z.object({ code: z.literal('seller_ops'), display_name: z.literal('卖家对接') }).strict(),
    z.object({ code: z.literal('buyer_refund'), display_name: z.literal('买家返款') }).strict(),
  ]),
  permissions: z.array(z.string()),
  data_scope: z.object({
    type: z.enum(['GLOBAL','MARKETPLACE','ASSIGNED_BUYERS','ASSIGNED_SELLER_ORGANIZATIONS','TEAM_ASSIGNMENTS']),
    marketplaceCodes: z.array(z.string()),
    buyerCustomerIds: z.array(z.string()),
    sellerOrganizationIds: z.array(z.string()),
    teamIds: z.array(z.string()),
  }).strict(),
  authorization_version: z.number().int(), session_version: z.number().int(), expires_at: z.number().int(),
}).strict();

const staffSessionResponseSchema = z.object({ session: staffSessionSchema }).strict();
const staffAccessBootstrapSchema = z.object({ session: staffSessionSchema, access_email: z.string().email() }).strict();
export type StaffSession = z.output<typeof staffSessionSchema>;

export interface StaffAuthApiAdapter {
  bootstrap(signal?: AbortSignal): Promise<ApiResult<z.output<typeof staffAccessBootstrapSchema>>>;
  readSession(signal?: AbortSignal): Promise<ApiResult<{ session: StaffSession }>>;
  logout(signal?: AbortSignal): Promise<ApiResult<{ logged_out: true; all_devices_logged_out: false }>>;
  logoutAll(idempotencyKey: string, signal?: AbortSignal): Promise<ApiResult<{ logged_out: true; all_devices_logged_out: true; session_version: number }>>;
}

export const staffAuthApi: StaffAuthApiAdapter = Object.freeze({
  bootstrap: (signal?: AbortSignal) => apiRequest({
    path: '/api/staff-auth/access/bootstrap', method: 'POST', schema: staffAccessBootstrapSchema,
    body: {}, ...(signal ? { signal } : {}),
  }),
  readSession: (signal?: AbortSignal) => apiRequest({
    path: '/api/staff-auth/session', method: 'GET', schema: staffSessionResponseSchema,
    ...(signal ? { signal } : {}),
  }),
  logout: (signal?: AbortSignal) => apiRequest({
    path: '/api/staff-auth/logout', method: 'POST', schema: staffLogoutResponseSchema,
    ...(signal ? { signal } : {}),
  }),
  logoutAll: (idempotencyKey: string, signal?: AbortSignal) => apiRequest({
    path: '/api/staff-auth/logout-all', method: 'POST', schema: staffLogoutAllResponseSchema,
    body: {}, headers: { 'Idempotency-Key': idempotencyKey }, ...(signal ? { signal } : {}),
  }),
});
