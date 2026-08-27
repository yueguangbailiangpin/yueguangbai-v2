import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';

// D-056: the acquisition CRM API is retired. Customer intake keeps two
// adapters: a static channel label (the channel registry is gone) and the
// buyer-registration invitation endpoint that creates the formal buyer
// profile with its permanent customer number.

export interface CustomerChannel {
  channel_id: string;
  code: string;
  label: string;
  lead_type: 'BUYER' | 'SELLER';
  marketplace_code: string;
  status: 'ACTIVE';
}

export const STATIC_AMAZON_JP_CHANNEL: CustomerChannel = {
  channel_id: 'static-amazon-jp',
  code: 'WECHAT',
  label: '微信对接',
  lead_type: 'BUYER',
  marketplace_code: 'AMAZON_JP',
  status: 'ACTIVE',
};

const createBuyerResponse = z
  .object({
    buyer: z.object({
      buyer_customer_id: z.string().min(1),
    }).strict(),
  })
  .strict();

async function write(
  client: QueryClient,
  path: string,
  body: unknown,
  schema: z.ZodType,
  key: string,
) {
  const { identityApiRequest } = await import('../api/identity-request');
  const { operationHeaders } = await import('../api/idempotency');
  return identityApiRequest('staff', client, {
    path,
    method: 'POST',
    schema,
    body,
    headers: operationHeaders({ key, body }),
  });
}

export const customerIntakeApi = Object.freeze({
  createBuyer: (
    client: QueryClient,
    body: { wechat_id: string; display_name?: string; marketplace_code: string },
    key: string,
  ) =>
    write(
      client,
      '/api/staff/customer-onboarding/buyer-registration-invitations',
      body,
      createBuyerResponse,
      key,
    ),
});
