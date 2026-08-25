import type {
  MarketplaceCode,
  MarketplaceRecord,
  SqlDatabase,
} from '@ygb/contracts';

export class MarketplaceRegistryError extends Error {
  constructor(
    public readonly code:
      | 'MARKETPLACE_NOT_FOUND'
      | 'MARKETPLACE_DISABLED'
      | 'MARKETPLACE_ADAPTER_UNAVAILABLE',
    public readonly status: 400 | 409 | 503,
  ) {
    super(code);
    this.name = 'MarketplaceRegistryError';
  }
}

export async function resolveMarketplace(
  database: SqlDatabase,
  code: MarketplaceCode,
  options: { requireActive?: boolean; requireAdapter?: boolean } = {},
): Promise<MarketplaceRecord> {
  const row = await database.prepare(`
    SELECT
      marketplace.code, marketplace.platform_code, marketplace.region_code,
      marketplace.transaction_currency_code, currency.exponent AS currency_exponent,
      marketplace.status, marketplace.adapter_status,
      marketplace.display_name_zh
    FROM marketplace_registry marketplace
    JOIN currencies currency
      ON currency.code=marketplace.transaction_currency_code
    WHERE marketplace.code=?
  `).bind(code).first<MarketplaceRecord>();
  if (!row) throw new MarketplaceRegistryError('MARKETPLACE_NOT_FOUND', 400);
  if (options.requireActive && row.status !== 'ACTIVE') {
    throw new MarketplaceRegistryError('MARKETPLACE_DISABLED', 409);
  }
  if (options.requireAdapter && row.adapter_status !== 'AVAILABLE') {
    throw new MarketplaceRegistryError(
      'MARKETPLACE_ADAPTER_UNAVAILABLE',
      503,
    );
  }
  return row;
}
