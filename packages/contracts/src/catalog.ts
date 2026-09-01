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
  orderIntervalDays: number;
  ordersPerRun: number;
}

/**
 * D-056 §4.4 product primary contact: at most one current responsible
 * member per product. It is a responsibility marker only — it never
 * restricts any other organization member's read visibility.
 */
export interface SetProductPrimaryContactRequest {
  primary_contact_member_id: string | null;
  expected_version: number;
  reason: string;
}
export interface ProductPrimaryContactDto {
  product_id: string;
  seller_organization_id: string;
  primary_contact_member_id: string | null;
  primary_contact_member_name: string | null;
  version: number;
}
export interface SetProductPrimaryContactResponse {
  product: ProductPrimaryContactDto;
  replayed: boolean;
}
