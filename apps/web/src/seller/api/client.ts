import type { QueryClient } from '@tanstack/react-query';
import { identityApiRequest } from '../../api/identity-request';
import {
  sellerApplicationDetailSchema,
  sellerApplicationMutationSchema,
  sellerApplicationsSchema,
  sellerDemandsSchema,
  sellerFormalOrdersSchema,
  sellerMeSchema,
  sellerPayablesSchema,
  sellerDemandMutationSchema,
  sellerProductsSchema,
  sellerReviewsSchema,
  sellerSettlementSummarySchema,
  sellerStoreMutationSchema,
  sellerStoresSchema,
} from '../contracts/runtime';

function get<T extends Parameters<typeof identityApiRequest>[2]['schema']>(
  client: QueryClient,
  path: string,
  schema: T,
  signal?: AbortSignal,
) {
  return identityApiRequest('seller', client, {
    path,
    method: 'GET',
    schema,
    ...(signal ? { signal } : {}),
  });
}
function post<T extends Parameters<typeof identityApiRequest>[2]['schema']>(
  client: QueryClient,
  path: string,
  schema: T,
  body: unknown,
  key: string,
  signal?: AbortSignal,
) {
  return identityApiRequest('seller', client, {
    path,
    method: 'POST',
    schema,
    body,
    headers: { 'Idempotency-Key': key },
    ...(signal ? { signal } : {}),
  });
}

function listPath(
  path: string,
  cursor: string | null,
  storeId?: string | null,
  limit = 100,
): string {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor !== null) query.set('cursor', cursor);
  if (storeId) query.set('store_id', storeId);
  return `${path}?${query.toString()}`;
}

export const sellerApi = Object.freeze({
  me: (client: QueryClient, signal?: AbortSignal) =>
    get(client, '/api/seller-portal/me', sellerMeSchema, signal),
  stores: (client: QueryClient, cursor: string | null, signal?: AbortSignal) =>
    get(client, listPath('/api/seller-portal/stores', cursor), sellerStoresSchema, signal),
  createStore: (client: QueryClient, body: unknown, key: string, signal?: AbortSignal) =>
    post(
      client,
      '/api/seller-portal/stores',
      sellerStoreMutationSchema,
      body,
      key,
      signal,
    ),
  products: (
    client: QueryClient,
    storeId: string | null,
    cursor: string | null,
    signal?: AbortSignal,
  ) =>
    get(
      client,
      listPath('/api/seller-portal/products', cursor, storeId),
      sellerProductsSchema,
      signal,
    ),
  applications: (
    client: QueryClient,
    storeId: string | null,
    cursor: string | null,
    signal?: AbortSignal,
  ) =>
    get(
      client,
      listPath('/api/seller-portal/product-applications', cursor, storeId),
      sellerApplicationsSchema,
      signal,
    ),
  application: (client: QueryClient, id: string, signal?: AbortSignal) =>
    get(
      client,
      `/api/seller-portal/product-applications/${encodeURIComponent(id)}`,
      sellerApplicationDetailSchema,
      signal,
    ),
  submitApplication: (client: QueryClient, body: unknown, key: string, signal?: AbortSignal) =>
    post(
      client,
      '/api/seller-portal/product-applications',
      sellerApplicationMutationSchema,
      body,
      key,
      signal,
    ),
  withdrawApplication: (
    client: QueryClient,
    id: string,
    version: number,
    key: string,
    signal?: AbortSignal,
  ) =>
    post(
      client,
      `/api/seller-portal/product-applications/${encodeURIComponent(id)}/withdraw`,
      sellerApplicationMutationSchema,
      { expected_version: version },
      key,
      signal,
    ),
  demands: (
    client: QueryClient,
    storeId: string | null,
    cursor: string | null,
    signal?: AbortSignal,
  ) =>
    get(
      client,
      listPath('/api/seller-portal/demand-batches', cursor, storeId),
      sellerDemandsSchema,
      signal,
    ),
  submitDemand: (client: QueryClient, body: unknown, key: string, signal?: AbortSignal) =>
    post(
      client,
      '/api/seller-portal/demand-batches',
      sellerDemandMutationSchema,
      body,
      key,
      signal,
    ),
  withdrawDemand: (
    client: QueryClient,
    id: string,
    version: number,
    key: string,
    signal?: AbortSignal,
  ) =>
    post(
      client,
      `/api/seller-portal/demand-batches/${encodeURIComponent(id)}/withdraw`,
      sellerDemandMutationSchema,
      { expected_version: version },
      key,
      signal,
    ),
  orders: (
    client: QueryClient,
    storeId: string | null,
    cursor: string | null,
    signal?: AbortSignal,
  ) =>
    get(
      client,
      // User decision 2026-08-24: the seller order list pages at 20 rows
      // (buyer lists already did); every other seller list keeps 100.
      listPath('/api/seller-portal/formal-orders', cursor, storeId, 20),
      sellerFormalOrdersSchema,
      signal,
    ),
  reviews: (
    client: QueryClient,
    storeId: string | null,
    cursor: string | null,
    signal?: AbortSignal,
  ) =>
    get(
      client,
      listPath('/api/seller-portal/reviews', cursor, storeId),
      sellerReviewsSchema,
      signal,
    ),
  settlement: (client: QueryClient, signal?: AbortSignal) =>
    get(client, '/api/seller-portal/settlement/summary', sellerSettlementSummarySchema, signal),
  payables: (client: QueryClient, cursor: string | null, signal?: AbortSignal) =>
    get(
      client,
      listPath('/api/seller-portal/settlement/payables', cursor),
      sellerPayablesSchema,
      signal,
    ),
});
