import type { MarketplaceProviderErrorCode } from '@ygb/contracts';

export class MarketplaceProviderError extends Error {
  constructor(
    public readonly code: MarketplaceProviderErrorCode,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(code);
    this.name = 'MarketplaceProviderError';
  }
}

export function normalizeMarketplaceProviderError(
  value: unknown,
): MarketplaceProviderError {
  return value instanceof MarketplaceProviderError
    ? value
    : new MarketplaceProviderError('TRANSIENT');
}
