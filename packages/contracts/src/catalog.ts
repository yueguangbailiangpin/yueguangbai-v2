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

export const PRODUCT_COLOR_SPEC_MODES = [
  'MAIN_IMAGE_VARIANT',
  'ANY_VARIANT',
] as const;

export type ProductColorSpecMode =
  typeof PRODUCT_COLOR_SPEC_MODES[number];

export interface ProductDescriptiveFields {
  productName: string;
  searchKeywords: readonly string[];
  productUrl: string | null;
  buyerVisibleNotes: string | null;
  internalNotes: string | null;
}

export interface ProductVersionFields
extends ProductDescriptiveFields {
  orderingGuideExpectedAmountJpy: number;
  colorSpecMode: ProductColorSpecMode;
  defaultBuyerSelfPayBps?: number;
}
