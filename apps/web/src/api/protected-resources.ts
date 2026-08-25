import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { identityApiRequest } from './identity-request';

const buyerPortalMeSchema = z.object({
  buyer: z.object({
    display_name: z.string(),
    marketplace_code: z.literal('AMAZON_JP'),
    identity_review_status: z.enum(['CLEAR', 'REVIEW_REQUIRED']),
    customer_number: z.string().nullable(),
  }).strict(),
}).strict();

const sellerPortalMeSchema = z.object({
  me: z.object({
    account_id: z.string(),
    member: z.object({
      id: z.string(),
      display_name: z.string(),
      role: z.enum(['OWNER', 'OPERATIONS', 'FINANCE', 'VIEWER']),
      primary_owner: z.boolean(),
    }).strict(),
    organization: z.object({
      id: z.string(),
      seller_code: z.string(),
      name: z.string(),
      marketplace_code: z.literal('AMAZON_JP'),
      status: z.literal('ACTIVE'),
    }).strict(),
    access: z.object({
      read_scope: z.enum(['ORGANIZATION', 'ASSIGNED_STORES']),
      store_ids: z.array(z.string()),
      can_submit_product_applications: z.boolean(),
      can_submit_demand_batches: z.boolean(),
    }).strict(),
  }).strict(),
}).strict();

const staffAssignmentsSchema = z.object({
  assignments: z.array(z.object({
    assignment_id: z.string(),
    subject_type: z.enum(['BUYER_CUSTOMER', 'SELLER_ORGANIZATION']),
    subject_id: z.string(),
    duty_code: z.enum([
      'SELLER_ACCOUNT_MANAGER',
      'BUYER_PRE_SALES_OWNER',
      'BUYER_AFTER_SALES_OWNER',
      'BUYER_REFUND_OWNER',
    ]),
    staff_id: z.string(),
    status: z.enum(['ACTIVE', 'REVOKED']),
    source: z.enum([
      'AUTO_INITIAL',
      'AUTO_REPLACEMENT',
      'OWNER_FALLBACK',
      'MANUAL_REASSIGN',
      'BATCH_TRANSFER',
    ]),
    reason: z.string().nullable(),
    version: z.number().int(),
    created_at: z.number().int(),
    revoked_at: z.number().int().nullable(),
  }).strict()),
}).strict();

export const protectedResourcesApi = Object.freeze({
  readBuyerMe: (client: QueryClient, signal?: AbortSignal) => identityApiRequest(
    'buyer',
    client,
    {
      path: '/api/buyer-portal/me',
      method: 'GET',
      schema: buyerPortalMeSchema,
      ...(signal ? { signal } : {}),
    },
  ),
  readSellerMe: (client: QueryClient, signal?: AbortSignal) => identityApiRequest(
    'seller',
    client,
    {
      path: '/api/seller-portal/me',
      method: 'GET',
      schema: sellerPortalMeSchema,
      ...(signal ? { signal } : {}),
    },
  ),
  readStaffAssignments: (client: QueryClient, signal?: AbortSignal) => identityApiRequest(
    'staff',
    client,
    {
      path: '/api/staff/me/assignments',
      method: 'GET',
      schema: staffAssignmentsSchema,
      ...(signal ? { signal } : {}),
    },
  ),
});
