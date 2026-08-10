import type {
  MarketplaceProviderOrderDto,
  MarketplaceProviderProductDto,
  MarketplaceReadAdapter,
  MarketplaceReadPage,
  MarketplaceReadPageInput,
  MarketplaceReadProviderCode,
} from '@ygb/contracts';
import { MarketplaceProviderError } from './error';
import { validateReadPageInput } from './validation';

export interface FakeMarketplaceReadAdapterOptions {
  marketplaceCode: MarketplaceReadProviderCode;
  orders?: readonly MarketplaceProviderOrderDto[];
  products?: readonly MarketplaceProviderProductDto[];
}

/** Local-only deterministic provider substitute. It has no network capability. */
export class FakeMarketplaceReadAdapter implements MarketplaceReadAdapter {
  readonly orderInputs: MarketplaceReadPageInput[] = [];
  readonly productInputs: MarketplaceReadPageInput[] = [];
  nextError: MarketplaceProviderError | null = null;
  private readonly orders: readonly MarketplaceProviderOrderDto[];
  private readonly products: readonly MarketplaceProviderProductDto[];

  constructor(options: FakeMarketplaceReadAdapterOptions) {
    this.marketplaceCode = options.marketplaceCode;
    this.orders = Object.freeze([...(options.orders ?? [])]);
    this.products = Object.freeze([...(options.products ?? [])]);
  }

  readonly marketplaceCode: MarketplaceReadProviderCode;

  async listOrdersPage(
    input: MarketplaceReadPageInput,
  ): Promise<MarketplaceReadPage<MarketplaceProviderOrderDto>> {
    const validated = validateReadPageInput(input);
    this.orderInputs.push(validated);
    this.maybeFail();
    return fakePage('orders', this.orders, validated);
  }

  async listProductsPage(
    input: MarketplaceReadPageInput,
  ): Promise<MarketplaceReadPage<MarketplaceProviderProductDto>> {
    const validated = validateReadPageInput(input);
    this.productInputs.push(validated);
    this.maybeFail();
    return fakePage('products', this.products, validated);
  }

  private maybeFail(): void {
    if (!this.nextError) return;
    const error = this.nextError;
    this.nextError = null;
    throw error;
  }
}

function fakePage<T>(
  kind: 'orders' | 'products',
  values: readonly T[],
  input: Readonly<MarketplaceReadPageInput>,
): MarketplaceReadPage<T> {
  const start = input.cursor === null ? 0 : parseFakeCursor(kind, input.cursor);
  if (start > values.length) throw new MarketplaceProviderError('CONTRACT');
  const end = Math.min(values.length, start + input.page_size);
  return Object.freeze({
    items: Object.freeze(values.slice(start, end)),
    next_cursor: end < values.length ? `fake:${kind}:${end}` : null,
  });
}

function parseFakeCursor(kind: 'orders' | 'products', cursor: string): number {
  const match = new RegExp(`^fake:${kind}:(\\d+)$`, 'u').exec(cursor);
  const value = match?.[1];
  if (!value) throw new MarketplaceProviderError('CONTRACT');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new MarketplaceProviderError('CONTRACT');
  }
  return parsed;
}
