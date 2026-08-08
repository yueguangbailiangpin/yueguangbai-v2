export const sellerQueryKeys = Object.freeze({
  root: ['seller'] as const,
  me: ['seller', 'me'] as const,
  stores: ['seller', 'stores'] as const,
  products: (storeId: string | null) => ['seller', 'products', storeId ?? 'all'] as const,
  applications: (storeId: string | null) => ['seller', 'applications', storeId ?? 'all'] as const,
  application: (id: string) => ['seller', 'application', id] as const,
  demands: (storeId: string | null) => ['seller', 'demands', storeId ?? 'all'] as const,
  orders: (storeId: string | null) => ['seller', 'orders', storeId ?? 'all'] as const,
  reviews: (storeId: string | null) => ['seller', 'reviews', storeId ?? 'all'] as const,
  settlement: ['seller', 'settlement'] as const,
  payables: ['seller', 'settlement', 'payables'] as const,
});
