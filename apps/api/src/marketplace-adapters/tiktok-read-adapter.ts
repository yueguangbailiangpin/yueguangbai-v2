import type {
  MarketplaceProviderOrderDto,
  MarketplaceProviderProductDto,
  MarketplaceReadAdapter,
  MarketplaceReadPage,
  MarketplaceReadPageInput,
} from '@ygb/contracts';
import { normalizePlatformIdentifier } from '@ygb/domain';
import {
  MarketplaceProviderError,
  normalizeMarketplaceProviderError,
} from './error';
import {
  signTikTokShopRequest,
  TIKTOK_SHOP_OFFICIAL_API_ORIGIN,
} from './tiktok-signature';
import {
  boundedInteger,
  boundedProviderString,
  discardProviderResponseBody,
  normalizedDisplayText,
  parseNextProviderCursor,
  providerRecord,
  readBoundedProviderJson,
  validateReadPageInput,
} from './validation';

export const TIKTOK_SHOP_ORDER_SEARCH_PATH =
  '/order/202309/orders/search';
export const TIKTOK_SHOP_PRODUCT_SEARCH_PATH =
  '/product/202502/products/search';
export const TIKTOK_SHOP_REQUIRED_READ_SCOPES = Object.freeze([
  'seller.order.info',
  'seller.product.basic',
] as const);

const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const RETRYABLE_HTTP_STATUSES = new Set([503]);
const RETRYABLE_PROVIDER_CODES = new Map<number, 'RATE_LIMITED' | 'TRANSIENT'>([
  [36009002, 'RATE_LIMITED'],
  [36009003, 'TRANSIENT'],
  [36009007, 'TRANSIENT'],
]);
const AUTHENTICATION_PROVIDER_CODES = new Set([105002, 106001]);
const AUTHORIZATION_PROVIDER_CODES = new Set([101000, 105005, 36009033]);
const CONFIGURATION_PROVIDER_CODES = new Set([106013]);
const CONTRACT_PROVIDER_CODES = new Set([
  36009009,
  36009010,
  36009014,
  36009022,
  36009023,
]);

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface TikTokShopReadAdapterOptions {
  apiOrigin?: string;
  appKey: string;
  appSecret: string;
  accessToken: string;
  /** Must come from the authorized-shops result, never request input. */
  shopCipher: string;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Returns a value in [0, 1); injected in tests, Web Crypto by default. */
  jitter?: () => number;
  requestTimeoutMs?: number;
  maxAttempts?: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  maxResponseBytes?: number;
}

export class TikTokShopReadAdapter implements MarketplaceReadAdapter {
  readonly marketplaceCode = 'TIKTOK_JP' as const;
  private readonly apiOrigin: string;
  private readonly fetcher: FetchLike;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly jitter: () => number;
  private readonly requestTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly maxResponseBytes: number;
  readonly #appKey: string;
  readonly #appSecret: string;
  readonly #accessToken: string;
  readonly #shopCipher: string;

  constructor(options: TikTokShopReadAdapterOptions) {
    this.apiOrigin = options.apiOrigin ?? TIKTOK_SHOP_OFFICIAL_API_ORIGIN;
    if (this.apiOrigin !== TIKTOK_SHOP_OFFICIAL_API_ORIGIN
      || !boundedProviderString(options.appKey, 256)
      || !boundedProviderString(options.appSecret, 4_096)
      || !boundedProviderString(options.accessToken, 4_096)
      || !boundedProviderString(options.shopCipher, 1_024)) {
      throw new MarketplaceProviderError('CONFIGURATION');
    }
    this.#appKey = options.appKey;
    this.#appSecret = options.appSecret;
    this.#accessToken = options.accessToken;
    this.#shopCipher = options.shopCipher;
    this.requestTimeoutMs = boundedInteger(
      options.requestTimeoutMs ?? 5_000,
      100,
      10_000,
    );
    this.maxAttempts = boundedInteger(options.maxAttempts ?? 3, 1, 5);
    this.baseRetryDelayMs = boundedInteger(
      options.baseRetryDelayMs ?? 1_000,
      100,
      5_000,
    );
    this.maxRetryDelayMs = boundedInteger(
      options.maxRetryDelayMs ?? 60_000,
      1_000,
      60_000,
    );
    if (this.maxRetryDelayMs < this.baseRetryDelayMs) {
      throw new MarketplaceProviderError('CONFIGURATION');
    }
    this.maxResponseBytes = boundedInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      1_024,
      8 * 1024 * 1024,
    );
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep
      ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.jitter = options.jitter ?? cryptographicJitter;
  }

  async listOrdersPage(
    input: MarketplaceReadPageInput,
  ): Promise<MarketplaceReadPage<MarketplaceProviderOrderDto>> {
    const validated = validateReadPageInput(input);
    const payload = await this.search(TIKTOK_SHOP_ORDER_SEARCH_PATH, validated);
    return parseOrderPage(payload, validated.page_size);
  }

  async listProductsPage(
    input: MarketplaceReadPageInput,
  ): Promise<MarketplaceReadPage<MarketplaceProviderProductDto>> {
    const validated = validateReadPageInput(input);
    const payload = await this.search(TIKTOK_SHOP_PRODUCT_SEARCH_PATH, validated);
    return parseProductPage(payload, validated.page_size);
  }

  private async search(
    path: string,
    input: Readonly<MarketplaceReadPageInput>,
  ): Promise<unknown> {
    let lastError: MarketplaceProviderError | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.requestOnce(path, input);
      } catch (error) {
        lastError = normalizeMarketplaceProviderError(error);
        if (attempt >= this.maxAttempts
          || !['RATE_LIMITED', 'TRANSIENT'].includes(lastError.code)) {
          throw lastError;
        }
        const delay = this.retryDelay(lastError, attempt);
        if (delay === null) throw lastError;
        await this.sleep(delay);
      }
    }
    throw lastError ?? new MarketplaceProviderError('TRANSIENT');
  }

  private async requestOnce(
    path: string,
    input: Readonly<MarketplaceReadPageInput>,
  ): Promise<unknown> {
    const timestamp = Math.floor(this.now() / 1_000);
    if (!Number.isSafeInteger(timestamp)
      || timestamp < 1_000_000_000 || timestamp > 9_999_999_999) {
      throw new MarketplaceProviderError('CONFIGURATION');
    }
    const query: Record<string, string> = {
      app_key: this.#appKey,
      page_size: String(input.page_size),
      shop_cipher: this.#shopCipher,
      timestamp: String(timestamp),
      ...(input.cursor === null ? {} : { page_token: input.cursor }),
    };
    const bodyText = '{}';
    const sign = await signTikTokShopRequest({
      appSecret: this.#appSecret,
      path,
      query,
      bodyText,
    });
    const search = new URLSearchParams(
      [...Object.entries({ ...query, sign })]
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetcher(
        `${this.apiOrigin}${path}?${search.toString()}`,
        {
          method: 'POST',
          redirect: 'manual',
          credentials: 'omit',
          headers: {
            'Content-Type': 'application/json',
            'x-tts-access-token': this.#accessToken,
          },
          body: bodyText,
          signal: controller.signal,
        },
      );
      return await this.parseResponse(response);
    } catch (error) {
      if (error instanceof MarketplaceProviderError) throw error;
      throw new MarketplaceProviderError('TRANSIENT');
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseResponse(response: Response): Promise<unknown> {
    if (response.status >= 300 && response.status < 400) {
      await discardProviderResponseBody(response);
      throw new MarketplaceProviderError('CONTRACT');
    }
    if (response.status === 401) {
      await discardProviderResponseBody(response);
      throw new MarketplaceProviderError('AUTHENTICATION');
    }
    if (response.status === 403) {
      await discardProviderResponseBody(response);
      throw new MarketplaceProviderError('AUTHORIZATION');
    }
    if (response.status === 429) {
      const retryAfterMs = retryAfterMilliseconds(response, this.now());
      await discardProviderResponseBody(response);
      throw new MarketplaceProviderError('RATE_LIMITED', retryAfterMs);
    }
    if (RETRYABLE_HTTP_STATUSES.has(response.status)) {
      const retryAfterMs = retryAfterMilliseconds(response, this.now());
      await discardProviderResponseBody(response);
      throw new MarketplaceProviderError('TRANSIENT', retryAfterMs);
    }
    const payload = await readBoundedProviderJson(
      response,
      this.maxResponseBytes,
    );
    const envelope = providerRecord(payload);
    const providerCode = envelope?.['code'];
    if (!Number.isSafeInteger(providerCode)) {
      throw new MarketplaceProviderError('CONTRACT');
    }
    if (providerCode !== 0) throw providerError(Number(providerCode));
    if (!response.ok) throw new MarketplaceProviderError('CONTRACT');
    return payload;
  }

  private retryDelay(
    error: MarketplaceProviderError,
    attempt: number,
  ): number | null {
    const retryAfter = error.retryAfterMs;
    if (retryAfter !== null && retryAfter > this.maxRetryDelayMs) return null;
    const exponential = Math.min(
      this.maxRetryDelayMs,
      this.baseRetryDelayMs * 2 ** (attempt - 1),
    );
    const jitter = this.jitter();
    if (!Number.isFinite(jitter) || jitter < 0 || jitter >= 1) {
      throw new MarketplaceProviderError('CONFIGURATION');
    }
    const withJitter = Math.min(
      this.maxRetryDelayMs,
      exponential + Math.floor(jitter * 500),
    );
    return Math.max(withJitter, retryAfter ?? 0);
  }
}

function parseOrderPage(
  payload: unknown,
  pageSize: number,
): MarketplaceReadPage<MarketplaceProviderOrderDto> {
  const data = successData(payload);
  const rawItems = data['orders'];
  if (!Array.isArray(rawItems) || rawItems.length > pageSize) {
    throw new MarketplaceProviderError('CONTRACT');
  }
  const items = rawItems.map(parseOrder);
  return Object.freeze({
    items: Object.freeze(items),
    next_cursor: parseNextProviderCursor(data['next_page_token']),
  });
}

function parseProductPage(
  payload: unknown,
  pageSize: number,
): MarketplaceReadPage<MarketplaceProviderProductDto> {
  const data = successData(payload);
  const rawItems = data['products'];
  if (!Array.isArray(rawItems) || rawItems.length > pageSize) {
    throw new MarketplaceProviderError('CONTRACT');
  }
  const items = rawItems.map(parseProduct);
  return Object.freeze({
    items: Object.freeze(items),
    next_cursor: parseNextProviderCursor(data['next_page_token']),
  });
}

function successData(payload: unknown): Record<string, unknown> {
  const envelope = providerRecord(payload);
  if (envelope?.['code'] !== 0) throw new MarketplaceProviderError('CONTRACT');
  const data = providerRecord(envelope['data']);
  if (!data) throw new MarketplaceProviderError('CONTRACT');
  return data;
}

function parseOrder(value: unknown): MarketplaceProviderOrderDto {
  const order = providerRecord(value);
  const lineItems = order?.['line_items'];
  if (!order || !Array.isArray(lineItems) || lineItems.length > 1_000) {
    throw new MarketplaceProviderError('CONTRACT');
  }
  try {
    const identifiers = lineItems.map((lineItem) => {
      const productId = providerRecord(lineItem)?.['product_id'];
      if (typeof productId !== 'string') {
        throw new MarketplaceProviderError('CONTRACT');
      }
      return normalizePlatformIdentifier('TIKTOK_JP', 'PRODUCT', productId);
    });
    return Object.freeze({
      marketplace_code: 'TIKTOK_JP',
      platform_order_identifier: normalizePlatformIdentifier(
        'TIKTOK_JP',
        'ORDER',
        typeof order['id'] === 'string' ? order['id'] : '',
      ),
      provider_status: normalizedDisplayText(order['status'], 100),
      created_at_unix_ms: unixSecondsToMilliseconds(order['create_time']),
      updated_at_unix_ms: unixSecondsToMilliseconds(order['update_time']),
      platform_product_identifiers: Object.freeze([...new Set(identifiers)]),
    });
  } catch (error) {
    if (error instanceof MarketplaceProviderError) throw error;
    throw new MarketplaceProviderError('CONTRACT');
  }
}

function parseProduct(value: unknown): MarketplaceProviderProductDto {
  const product = providerRecord(value);
  if (!product) throw new MarketplaceProviderError('CONTRACT');
  try {
    return Object.freeze({
      marketplace_code: 'TIKTOK_JP',
      platform_product_identifier: normalizePlatformIdentifier(
        'TIKTOK_JP',
        'PRODUCT',
        typeof product['id'] === 'string' ? product['id'] : '',
      ),
      title: normalizedDisplayText(product['title'], 1_000),
      provider_status: normalizedDisplayText(product['status'], 100),
    });
  } catch (error) {
    if (error instanceof MarketplaceProviderError) throw error;
    throw new MarketplaceProviderError('CONTRACT');
  }
}

function unixSecondsToMilliseconds(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1
    || Number(value) > Math.floor(Number.MAX_SAFE_INTEGER / 1_000)) {
    throw new MarketplaceProviderError('CONTRACT');
  }
  return Number(value) * 1_000;
}

function providerError(code: number): MarketplaceProviderError {
  const retryable = RETRYABLE_PROVIDER_CODES.get(code);
  if (retryable) return new MarketplaceProviderError(retryable);
  if (AUTHENTICATION_PROVIDER_CODES.has(code)) {
    return new MarketplaceProviderError('AUTHENTICATION');
  }
  if (AUTHORIZATION_PROVIDER_CODES.has(code)) {
    return new MarketplaceProviderError('AUTHORIZATION');
  }
  if (CONFIGURATION_PROVIDER_CODES.has(code)) {
    return new MarketplaceProviderError('CONFIGURATION');
  }
  if (CONTRACT_PROVIDER_CODES.has(code)) {
    return new MarketplaceProviderError('CONTRACT');
  }
  // 36009004 is intentionally not classified by number alone: the official
  // documentation assigns multiple incompatible meanings to that code.
  return new MarketplaceProviderError('CONTRACT');
}

function retryAfterMilliseconds(response: Response, now: number): number | null {
  const raw = response.headers.get('retry-after');
  if (raw === null) return null;
  if (/^\d+$/u.test(raw)) {
    const seconds = Number(raw);
    return Number.isSafeInteger(seconds)
      && seconds <= Math.floor(Number.MAX_SAFE_INTEGER / 1_000)
      ? seconds * 1_000
      : Number.MAX_SAFE_INTEGER;
  }
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, timestamp - now);
}

function cryptographicJitter(): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return (value[0] ?? 0) / 2 ** 32;
}
