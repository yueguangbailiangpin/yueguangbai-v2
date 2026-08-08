import type { QueryClient } from '@tanstack/react-query';
import { identityApiRequest } from '../../api/identity-request';
import {
  sellerApplicationDetailSchema, sellerApplicationMutationSchema, sellerApplicationsSchema,
  sellerDemandsSchema, sellerFormalOrdersSchema, sellerMeSchema, sellerPayablesSchema,
  sellerDemandMutationSchema, sellerProductsSchema, sellerReviewsSchema, sellerSettlementSummarySchema, sellerStoresSchema,
} from '../contracts/runtime';

function get<T extends Parameters<typeof identityApiRequest>[2]['schema']>(client: QueryClient, path: string, schema: T, signal?: AbortSignal) {
  return identityApiRequest('seller', client, { path, method: 'GET', schema, ...(signal ? { signal } : {}) });
}
function post<T extends Parameters<typeof identityApiRequest>[2]['schema']>(client: QueryClient, path: string, schema: T, body: unknown, key: string, signal?: AbortSignal) {
  return identityApiRequest('seller', client, { path, method: 'POST', schema, body, headers: { 'Idempotency-Key': key }, ...(signal ? { signal } : {}) });
}

export const sellerApi = Object.freeze({
  me: (client: QueryClient, signal?: AbortSignal) => get(client, '/api/seller-portal/me', sellerMeSchema, signal),
  stores: (client: QueryClient, signal?: AbortSignal) => get(client, '/api/seller-portal/stores?limit=100', sellerStoresSchema, signal),
  products: (client: QueryClient, storeId: string | null, signal?: AbortSignal) => get(client, `/api/seller-portal/products?limit=100${storeId ? `&store_id=${encodeURIComponent(storeId)}` : ''}`, sellerProductsSchema, signal),
  applications: (client: QueryClient, storeId: string | null, signal?: AbortSignal) => get(client, `/api/seller-portal/product-applications?limit=100${storeId ? `&store_id=${encodeURIComponent(storeId)}` : ''}`, sellerApplicationsSchema, signal),
  application: (client: QueryClient, id: string, signal?: AbortSignal) => get(client, `/api/seller-portal/product-applications/${encodeURIComponent(id)}`, sellerApplicationDetailSchema, signal),
  submitApplication: (client: QueryClient, body: unknown, key: string, signal?: AbortSignal) => post(client, '/api/seller-portal/product-applications', sellerApplicationMutationSchema, body, key, signal),
  withdrawApplication: (client: QueryClient, id: string, version: number, key: string, signal?: AbortSignal) => post(client, `/api/seller-portal/product-applications/${encodeURIComponent(id)}/withdraw`, sellerApplicationMutationSchema, { expected_version: version }, key, signal),
  demands: (client: QueryClient, storeId: string | null, signal?: AbortSignal) => get(client, `/api/seller-portal/demand-batches?limit=100${storeId ? `&store_id=${encodeURIComponent(storeId)}` : ''}`, sellerDemandsSchema, signal),
  submitDemand: (client: QueryClient, body: unknown, key: string, signal?: AbortSignal) => post(client, '/api/seller-portal/demand-batches', sellerDemandMutationSchema, body, key, signal),
  withdrawDemand: (client: QueryClient, id: string, version: number, key: string, signal?: AbortSignal) => post(client, `/api/seller-portal/demand-batches/${encodeURIComponent(id)}/withdraw`, sellerDemandMutationSchema, { expected_version: version }, key, signal),
  orders: (client: QueryClient, storeId: string | null, signal?: AbortSignal) => get(client, `/api/seller-portal/formal-orders?limit=100${storeId ? `&store_id=${encodeURIComponent(storeId)}` : ''}`, sellerFormalOrdersSchema, signal),
  reviews: (client: QueryClient, storeId: string | null, signal?: AbortSignal) => get(client, `/api/seller-portal/reviews?limit=100${storeId ? `&store_id=${encodeURIComponent(storeId)}` : ''}`, sellerReviewsSchema, signal),
  settlement: (client: QueryClient, signal?: AbortSignal) => get(client, '/api/seller-portal/settlement/summary', sellerSettlementSummarySchema, signal),
  payables: (client: QueryClient, signal?: AbortSignal) => get(client, '/api/seller-portal/settlement/payables?limit=100', sellerPayablesSchema, signal),
});
