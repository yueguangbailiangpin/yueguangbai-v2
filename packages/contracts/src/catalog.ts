export const SELLER_STORE_STATUSES = [
  'ACTIVE',
  'DISABLED',
] as const;

export type SellerStoreStatus =
  typeof SELLER_STORE_STATUSES[number];

export const PRODUCT_STATUSES = [
  'ACTIVE',
  'DISABLED',
] as const;

export type ProductStatus =
  typeof PRODUCT_STATUSES[number];

export interface ProductVersionFields {
  productName: string;
  searchKeywords: readonly string[];
  productUrl: string | null;
  buyerVisibleNotes: string | null;
  internalNotes: string | null;
}
