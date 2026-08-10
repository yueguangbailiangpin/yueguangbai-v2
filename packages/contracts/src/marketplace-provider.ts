export const MARKETPLACE_READ_PROVIDER_CODES = [
  'RAKUTEN_JP',
  'TIKTOK_JP',
] as const;
export type MarketplaceReadProviderCode =
  typeof MARKETPLACE_READ_PROVIDER_CODES[number];

export const MARKETPLACE_PROVIDER_ERROR_CODES = [
  'CONFIGURATION',
  'UNAVAILABLE',
  'AUTHENTICATION',
  'AUTHORIZATION',
  'RATE_LIMITED',
  'TRANSIENT',
  'CONTRACT',
] as const;
export type MarketplaceProviderErrorCode =
  typeof MARKETPLACE_PROVIDER_ERROR_CODES[number];

export interface MarketplaceReadPageInput {
  /** Provider cursor. It is opaque and must never be decoded or synthesized. */
  cursor: string | null;
  /** Both currently frozen TikTok search APIs accept only 1 through 100. */
  page_size: number;
}

export interface MarketplaceProviderOrderDto {
  marketplace_code: MarketplaceReadProviderCode;
  platform_order_identifier: string;
  provider_status: string;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  platform_product_identifiers: readonly string[];
}

export interface MarketplaceProviderProductDto {
  marketplace_code: MarketplaceReadProviderCode;
  platform_product_identifier: string;
  title: string;
  provider_status: string;
}

export interface MarketplaceReadPage<T> {
  items: readonly T[];
  next_cursor: string | null;
}

/**
 * Read-only provider boundary. It deliberately has no ingestion or mutation
 * method and carries no D1, seller, permission, finance or audit authority.
 */
export interface MarketplaceReadAdapter {
  readonly marketplaceCode: MarketplaceReadProviderCode;
  listOrdersPage(
    input: MarketplaceReadPageInput,
  ): Promise<MarketplaceReadPage<MarketplaceProviderOrderDto>>;
  listProductsPage(
    input: MarketplaceReadPageInput,
  ): Promise<MarketplaceReadPage<MarketplaceProviderProductDto>>;
}
