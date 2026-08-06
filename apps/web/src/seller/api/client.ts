import type { QueryClient } from '@tanstack/react-query';
import { identityApiRequest } from '../../api/identity-request';
import {
  sellerDemandsSchema, sellerFormalOrdersSchema, sellerMeSchema, sellerPayablesSchema,
  sellerProductsSchema, sellerReviewsSchema, sellerSettlementSummarySchema, sellerStoresSchema,
} from '../contracts/runtime';

function get<T extends Parameters<typeof identityApiRequest>[2]['schema']>(client: QueryClient, path: string, schema: T, signal?: AbortSignal) {
  return identityApiRequest('seller', client, { path, method: 'GET', schema, ...(signal ? { signal } : {}) });
}

export const sellerApi = Object.freeze({
  me: (client: QueryClient, signal?: AbortSignal) => get(client, '/api/seller-portal/me', sellerMeSchema, signal),
  stores: (client: QueryClient, signal?: AbortSignal) => get(client, '/api/seller-portal/stores?limit=100', sellerStoresSchema, signal),
  products: (client: QueryClient, storeId: string | null, signal?: AbortSignal) => get(client, `/api/seller-portal/products?limit=100${storeId ? `&store_id=${encodeURIComponent(storeId)}` : ''}`, sellerProductsSchema, signal),
  demands: (client: QueryClient, storeId: string | null, signal?: AbortSignal) => get(client, `/api/seller-portal/demand-batches?limit=100${storeId ? `&store_id=${encodeURIComponent(storeId)}` : ''}`, sellerDemandsSchema, signal),
  orders: (client: QueryClient, storeId: string | null, signal?: AbortSignal) => get(client, `/api/seller-portal/formal-orders?limit=100${storeId ? `&store_id=${encodeURIComponent(storeId)}` : ''}`, sellerFormalOrdersSchema, signal),
  reviews: (client: QueryClient, storeId: string | null, signal?: AbortSignal) => get(client, `/api/seller-portal/reviews?limit=100${storeId ? `&store_id=${encodeURIComponent(storeId)}` : ''}`, sellerReviewsSchema, signal),
  settlement: (client: QueryClient, signal?: AbortSignal) => get(client, '/api/seller-portal/settlement/summary', sellerSettlementSummarySchema, signal),
  payables: (client: QueryClient, signal?: AbortSignal) => get(client, '/api/seller-portal/settlement/payables?limit=100', sellerPayablesSchema, signal),
});
