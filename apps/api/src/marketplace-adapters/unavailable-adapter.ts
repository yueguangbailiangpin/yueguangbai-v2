import type {
  MarketplaceProviderOrderDto,
  MarketplaceProviderProductDto,
  MarketplaceReadAdapter,
  MarketplaceReadPage,
  MarketplaceReadPageInput,
} from '@ygb/contracts';
import { MarketplaceProviderError } from './error';

/** Rakuten remains network-inert until the current authorized RMS specs exist. */
export class RakutenUnavailableReadAdapter implements MarketplaceReadAdapter {
  readonly marketplaceCode = 'RAKUTEN_JP' as const;
  readonly blocker = 'RAKUTEN_CURRENT_OFFICIAL_CONTRACT_BLOCKED' as const;

  async listOrdersPage(
    _input: MarketplaceReadPageInput,
  ): Promise<MarketplaceReadPage<MarketplaceProviderOrderDto>> {
    throw new MarketplaceProviderError('UNAVAILABLE');
  }

  async listProductsPage(
    _input: MarketplaceReadPageInput,
  ): Promise<MarketplaceReadPage<MarketplaceProviderProductDto>> {
    throw new MarketplaceProviderError('UNAVAILABLE');
  }
}
