import { describe, expect, it, vi } from 'vitest';
import type {
  MarketplaceProviderOrderDto,
  MarketplaceProviderProductDto,
} from '@ygb/contracts';
import { MarketplaceProviderError } from './error';
import { FakeMarketplaceReadAdapter } from './fake-adapter';
import {
  TikTokShopReadAdapter,
  TIKTOK_SHOP_ORDER_SEARCH_PATH,
  TIKTOK_SHOP_PRODUCT_SEARCH_PATH,
} from './tiktok-read-adapter';
import {
  signTikTokShopRequest,
  TIKTOK_SHOP_OFFICIAL_API_ORIGIN,
} from './tiktok-signature';
import { verifyTikTokShopWebhook } from './tiktok-webhook';
import { RakutenUnavailableReadAdapter } from './unavailable-adapter';

const FIXED_NOW = 1_800_000_000_000;
const TIKTOK_APP_KEY = 'local-test-app-key';
const TIKTOK_APP_SECRET = 'local-test-app-secret';
const TIKTOK_ACCESS_TOKEN = 'local-test-access-token';
const TIKTOK_SHOP_CIPHER = 'local-test-shop-cipher';

describe('TikTok Shop official signatures', () => {
  it('passes the official OpenAPI signing vector', async () => {
    await expect(signTikTokShopRequest({
      appSecret: 'e59af819cc',
      path: '/authorization/202309/shops',
      query: { timestamp: '1623812664', app_key: '29a39d' },
    })).resolves.toBe(
      'b596b73e0cc6de07ac26f036364178ab16b0a907af13d43f0a0cd2345f582dc8',
    );
  });

  it('excludes sign/access_token but signs path, query and exact body', async () => {
    const base = {
      appSecret: TIKTOK_APP_SECRET,
      path: TIKTOK_SHOP_ORDER_SEARCH_PATH,
      query: {
        timestamp: '1800000000',
        app_key: TIKTOK_APP_KEY,
        access_token: 'must-not-be-signed',
        sign: 'must-not-be-signed',
      },
      bodyText: '{}',
    } as const;
    const signature = await signTikTokShopRequest(base);
    await expect(signTikTokShopRequest({
      ...base,
      query: { ...base.query, access_token: 'different', sign: 'different' },
    })).resolves.toBe(signature);
    await expect(signTikTokShopRequest({ ...base, bodyText: '{ }' }))
      .resolves.not.toBe(signature);
    await expect(signTikTokShopRequest({
      ...base,
      path: TIKTOK_SHOP_PRODUCT_SEARCH_PATH,
    })).resolves.not.toBe(signature);
  });

  it('rejects control characters in a signing path', async () => {
    await expect(signTikTokShopRequest({
      appSecret: TIKTOK_APP_SECRET,
      path: '/order/202309/orders/\u0085search',
      query: { timestamp: '1800000000', app_key: TIKTOK_APP_KEY },
      bodyText: '{}',
    })).rejects.toMatchObject({ code: 'CONFIGURATION' });
  });
});

describe('TikTok Shop webhook verifier', () => {
  const rawPayload = '{"type":1,"tts_notification_id":"7380066284010030890","shop_id":"7495540735365777507","timestamp":1718305585,"data":{"is_on_hold_order":true,"order_id":"576653688135258178","order_status":"UNPAID","update_time":1718305585}}';
  const expected = '5dec0f11ec2f6783b8deee53c9ffbf8d024302f7c7e7fa55a35d17629031ac05';

  it('passes the official raw-body golden vector and exposes only a safe envelope', async () => {
    const envelope = await verifyTikTokShopWebhook(
      new TextEncoder().encode(rawPayload),
      expected,
      'abcdef',
      '123',
    );
    expect(envelope).toEqual({
      type: 1,
      notification_id: '7380066284010030890',
      shop_id: '7495540735365777507',
      timestamp_unix_seconds: 1_718_305_585,
    });
    expect(envelope).not.toHaveProperty('data');
    expect(envelope).not.toHaveProperty('order_id');
  });

  it('rejects one changed raw byte or signature without parsing an event', async () => {
    const tampered = new TextEncoder().encode(
      rawPayload.replace('UNPAID', 'CANCELLED'),
    );
    await expect(verifyTikTokShopWebhook(
      tampered,
      expected,
      'abcdef',
      '123',
    )).rejects.toMatchObject({ code: 'AUTHENTICATION' });
    await expect(verifyTikTokShopWebhook(
      new TextEncoder().encode(rawPayload),
      `${expected.slice(0, -1)}6`,
      'abcdef',
      '123',
    )).rejects.toMatchObject({ code: 'AUTHENTICATION' });
  });

  it('signs and parses one immutable byte snapshot', async () => {
    const mutableBody = new TextEncoder().encode(rawPayload);
    const verification = verifyTikTokShopWebhook(
      mutableBody,
      expected,
      'abcdef',
      '123',
    );
    const changed = new TextEncoder().encode(
      rawPayload.replace('7495540735365777507', '1495540735365777507'),
    );
    expect(changed.byteLength).toBe(mutableBody.byteLength);
    mutableBody.set(changed);
    await expect(verification).resolves.toMatchObject({
      shop_id: '7495540735365777507',
      notification_id: '7380066284010030890',
    });
  });
});

describe('TikTok Shop read adapter', () => {
  it('signs and parses a minimal order page without PII or finance authority', async () => {
    let seenUrlText = '';
    let seenInit: RequestInit | undefined;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      seenUrlText = String(input);
      seenInit = init;
      return jsonResponse({
        code: 0,
        message: 'Success',
        request_id: 'safe-request-id',
        data: {
          next_page_token: 'opaque+/=cursor',
          total_count: 1,
          orders: [{
            id: '585123456789012345',
            status: 'AWAITING_SHIPMENT',
            create_time: 1_718_305_500,
            update_time: 1_718_305_585,
            buyer_email: 'must-not-leave-provider-parser@example.invalid',
            payment: { currency: 'JPY', total_amount: '999999' },
            recipient_address: { phone_number: 'must-not-leave-parser' },
            line_items: [
              { id: 'line-1', product_id: '7495540735365777507' },
              { id: 'line-2', product_id: '7495540735365777507' },
            ],
          }],
        },
      });
    });
    const adapter = adapterWith({ fetch: fetcher });
    const page = await adapter.listOrdersPage({ cursor: null, page_size: 20 });
    expect(page).toEqual({
      items: [{
        marketplace_code: 'TIKTOK_JP',
        platform_order_identifier: '585123456789012345',
        provider_status: 'AWAITING_SHIPMENT',
        created_at_unix_ms: 1_718_305_500_000,
        updated_at_unix_ms: 1_718_305_585_000,
        platform_product_identifiers: ['7495540735365777507'],
      }],
      next_cursor: 'opaque+/=cursor',
    });
    expect(page.items[0]).not.toHaveProperty('buyer_email');
    expect(page.items[0]).not.toHaveProperty('payment');
    expect(page.items[0]).not.toHaveProperty('recipient_address');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(seenUrlText).not.toBe('');
    const url = new URL(seenUrlText);
    expect(url.origin).toBe(TIKTOK_SHOP_OFFICIAL_API_ORIGIN);
    expect(url.pathname).toBe(TIKTOK_SHOP_ORDER_SEARCH_PATH);
    expect(url.searchParams.get('app_key')).toBe(TIKTOK_APP_KEY);
    expect(url.searchParams.get('shop_cipher')).toBe(TIKTOK_SHOP_CIPHER);
    expect(url.searchParams.get('page_size')).toBe('20');
    expect(url.searchParams.get('timestamp')).toBe('1800000000');
    expect(url.searchParams.has('access_token')).toBe(false);
    expect(seenInit).toMatchObject({
      method: 'POST', redirect: 'manual', credentials: 'omit', body: '{}',
    });
    expect(new Headers(seenInit?.headers).get('x-tts-access-token'))
      .toBe(TIKTOK_ACCESS_TOKEN);
    expect(new Headers(seenInit?.headers).get('content-type'))
      .toBe('application/json');
    const query = Object.fromEntries(url.searchParams.entries());
    const receivedSignature = query['sign'];
    delete query['sign'];
    await expect(signTikTokShopRequest({
      appSecret: TIKTOK_APP_SECRET,
      path: url.pathname,
      query,
      bodyText: String(seenInit?.body),
    })).resolves.toBe(receivedSignature);
  });

  it('returns an opaque cursor byte-for-byte and sends it only as page_token', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('page_token')).toBe('opaque+/=cursor');
      return jsonResponse({
        code: 0,
        message: 'Success',
        request_id: 'safe-request-id',
        data: { next_page_token: '', products: [{
          id: '7495540735365777507',
          title: '月光白本地测试产品',
          status: 'LIVE',
          seller_sku: 'must-not-be-promoted-without-source-mapping',
        }] },
      });
    });
    const page = await adapterWith({ fetch: fetcher }).listProductsPage({
      cursor: 'opaque+/=cursor',
      page_size: 1,
    });
    expect(page).toEqual({
      items: [{
        marketplace_code: 'TIKTOK_JP',
        platform_product_identifier: '7495540735365777507',
        title: '月光白本地测试产品',
        provider_status: 'LIVE',
      }],
      next_cursor: null,
    });
    expect(page.items[0]).not.toHaveProperty('seller_sku');
  });

  it('does not enumerate secrets or retain a caller-mutable options object', async () => {
    let seenUrlText = '';
    let seenToken = '';
    const mutableOptions: ConstructorParameters<typeof TikTokShopReadAdapter>[0] = {
      appKey: TIKTOK_APP_KEY,
      appSecret: TIKTOK_APP_SECRET,
      accessToken: TIKTOK_ACCESS_TOKEN,
      shopCipher: TIKTOK_SHOP_CIPHER,
      now: () => FIXED_NOW,
      jitter: () => 0,
      maxAttempts: 1,
      fetch: async (input, init) => {
        seenUrlText = String(input);
        seenToken = new Headers(init?.headers).get('x-tts-access-token') ?? '';
        return jsonResponse({
          code: 0,
          message: 'Success',
          request_id: 'safe-request-id',
          data: { next_page_token: '', products: [] },
        });
      },
    };
    const adapter = new TikTokShopReadAdapter(mutableOptions);
    const serialized = JSON.stringify(adapter);
    for (const sensitive of [
      TIKTOK_APP_SECRET,
      TIKTOK_ACCESS_TOKEN,
      TIKTOK_SHOP_CIPHER,
    ]) expect(serialized).not.toContain(sensitive);

    mutableOptions.appKey = 'mutated-app-key';
    mutableOptions.appSecret = 'mutated-app-secret';
    mutableOptions.accessToken = 'mutated-access-token';
    mutableOptions.shopCipher = 'mutated-shop-cipher';
    await adapter.listProductsPage({ cursor: null, page_size: 1 });
    const url = new URL(seenUrlText);
    expect(url.searchParams.get('app_key')).toBe(TIKTOK_APP_KEY);
    expect(url.searchParams.get('shop_cipher')).toBe(TIKTOK_SHOP_CIPHER);
    expect(seenToken).toBe(TIKTOK_ACCESS_TOKEN);
    const query = Object.fromEntries(url.searchParams.entries());
    const receivedSignature = query['sign'];
    delete query['sign'];
    await expect(signTikTokShopRequest({
      appSecret: TIKTOK_APP_SECRET,
      path: TIKTOK_SHOP_PRODUCT_SEARCH_PATH,
      query,
      bodyText: '{}',
    })).resolves.toBe(receivedSignature);
  });

  it('honors Retry-After as a minimum and retries only a read request', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('', {
        status: 429,
        headers: { 'Retry-After': '2' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        message: 'Success',
        request_id: 'safe-request-id',
        data: { next_page_token: '', orders: [] },
      }));
    await expect(adapterWith({ fetch: fetcher, sleep }).listOrdersPage({
      cursor: null,
      page_size: 20,
    })).resolves.toEqual({ items: [], next_cursor: null });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it('does not retry earlier than an over-cap or malformed Retry-After', async () => {
    for (const retryAfter of ['61', 'not-a-valid-http-date']) {
      const sleep = vi.fn(async () => undefined);
      const fetcher = vi.fn(async () => new Response('', {
        status: 429,
        headers: { 'Retry-After': retryAfter },
      }));
      await expect(adapterWith({ fetch: fetcher, sleep }).listOrdersPage({
        cursor: null,
        page_size: 20,
      })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  });

  it.each([408, 425, 500, 502, 504])(
    'does not invent retry semantics for unfrozen HTTP status %s',
    async (status) => {
      const sleep = vi.fn(async () => undefined);
      const fetcher = vi.fn(async () => jsonResponse({
        code: 0,
        message: 'not-authoritative-for-http-failure',
        request_id: 'safe-request-id',
      }, status));
      await expect(adapterWith({ fetch: fetcher, sleep }).listOrdersPage({
        cursor: null,
        page_size: 20,
      })).rejects.toMatchObject({ code: 'CONTRACT' });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it.each([
    [105002, 'AUTHENTICATION'],
    [106001, 'AUTHENTICATION'],
    [101000, 'AUTHORIZATION'],
    [105005, 'AUTHORIZATION'],
    [106013, 'CONFIGURATION'],
    [36009033, 'AUTHORIZATION'],
    [36009004, 'CONTRACT'],
    [36009014, 'CONTRACT'],
  ] as const)('maps provider code %s to %s without retry', async (code, expected) => {
    const fetcher = vi.fn(async () => jsonResponse({
      code,
      message: 'provider-message-is-not-surfaced',
      request_id: 'safe-request-id',
    }));
    await expect(adapterWith({ fetch: fetcher }).listOrdersPage({
      cursor: null,
      page_size: 20,
    })).rejects.toMatchObject({ code: expected });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retries a documented transient body code and rejects oversized output', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        code: 36009007,
        message: 'timeout',
        request_id: 'safe-request-id',
      }))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        message: 'Success',
        request_id: 'safe-request-id',
        data: { next_page_token: '', orders: [] },
      }));
    const sleep = vi.fn(async () => undefined);
    await expect(adapterWith({ fetch: fetcher, sleep }).listOrdersPage({
      cursor: null,
      page_size: 20,
    })).resolves.toEqual({ items: [], next_cursor: null });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000);

    const oversized = adapterWith({
      maxResponseBytes: 1_024,
      fetch: async () => new Response(JSON.stringify({ value: 'x'.repeat(2_000) }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    });
    await expect(oversized.listProductsPage({ cursor: null, page_size: 1 }))
      .rejects.toMatchObject({ code: 'CONTRACT' });
  });

  it('cancels rejected Provider bodies at both header and streaming bounds', async () => {
    for (const declaredLength of [true, false]) {
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(600));
        },
        cancel() {
          cancelled = true;
        },
      });
      const adapter = adapterWith({
        maxAttempts: 1,
        maxResponseBytes: 1_024,
        fetch: async () => new Response(stream, {
          headers: {
            'Content-Type': 'application/json',
            ...(declaredLength ? { 'Content-Length': '2048' } : {}),
          },
        }),
      });
      await expect(adapter.listProductsPage({ cursor: null, page_size: 1 }))
        .rejects.toMatchObject({ code: 'CONTRACT' });
      expect(cancelled).toBe(true);
    }
  });

  it('rejects missing/unsafe configuration, bad page bounds and redirects before parsing', async () => {
    expect(() => adapterWith({ apiOrigin: 'https://example.invalid' }))
      .toThrow(MarketplaceProviderError);
    expect(() => adapterWith({ appSecret: '' }))
      .toThrow(MarketplaceProviderError);

    const fetcher = vi.fn(async () => new Response('', {
      status: 302,
      headers: { Location: 'https://example.invalid/leak' },
    }));
    const adapter = adapterWith({ fetch: fetcher });
    await expect(adapter.listOrdersPage({ cursor: null, page_size: 0 }))
      .rejects.toMatchObject({ code: 'CONTRACT' });
    await expect(adapter.listOrdersPage({ cursor: 'bad\u0085cursor', page_size: 1 }))
      .rejects.toMatchObject({ code: 'CONTRACT' });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(adapter.listOrdersPage({ cursor: null, page_size: 1 }))
      .rejects.toMatchObject({ code: 'CONTRACT' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects C1 controls in Provider display values', async () => {
    const adapter = adapterWith({
      maxAttempts: 1,
      fetch: async () => jsonResponse({
        code: 0,
        message: 'Success',
        request_id: 'safe-request-id',
        data: {
          next_page_token: '',
          products: [{
            id: '7495540735365777507',
            title: 'bad\u009ftitle',
            status: 'LIVE',
          }],
        },
      }),
    });
    await expect(adapter.listProductsPage({ cursor: null, page_size: 1 }))
      .rejects.toMatchObject({ code: 'CONTRACT' });
  });

  it('keeps the timeout active while the bounded response body is read', async () => {
    const fetcher = vi.fn(async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const signal = init?.signal;
      return new Response(new ReadableStream({
        start(controller) {
          signal?.addEventListener('abort', () => {
            controller.error(new DOMException('aborted', 'AbortError'));
          });
        },
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    await expect(adapterWith({
      fetch: fetcher,
      requestTimeoutMs: 100,
      maxAttempts: 1,
    }).listProductsPage({ cursor: null, page_size: 1 }))
      .rejects.toMatchObject({ code: 'TRANSIENT' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('unavailable and fake provider boundaries', () => {
  it('keeps Rakuten truthful unavailable with no network or mutation capability', async () => {
    const adapter = new RakutenUnavailableReadAdapter();
    expect(adapter.marketplaceCode).toBe('RAKUTEN_JP');
    expect(adapter.blocker).toBe('RAKUTEN_CURRENT_OFFICIAL_CONTRACT_BLOCKED');
    expect(adapter).not.toHaveProperty('fetch');
    expect(adapter).not.toHaveProperty('createOrder');
    await expect(adapter.listOrdersPage({ cursor: null, page_size: 20 }))
      .rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(adapter.listProductsPage({ cursor: null, page_size: 20 }))
      .rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('paginates deterministic local fixtures while preserving R-1/S-1 and TikTok strings', async () => {
    const orders: MarketplaceProviderOrderDto[] = [
      rakutenOrder('order-r-1', 'R-1'),
      rakutenOrder('order-s-1', 'S-1'),
    ];
    const products: MarketplaceProviderProductDto[] = [
      rakutenProduct('R-1'),
      rakutenProduct('S-1'),
    ];
    const adapter = new FakeMarketplaceReadAdapter({
      marketplaceCode: 'RAKUTEN_JP',
      orders,
      products,
    });
    const first = await adapter.listOrdersPage({ cursor: null, page_size: 1 });
    expect(first).toEqual({ items: [orders[0]], next_cursor: 'fake:orders:1' });
    await expect(adapter.listOrdersPage({
      cursor: first.next_cursor,
      page_size: 1,
    })).resolves.toEqual({ items: [orders[1]], next_cursor: null });
    await expect(adapter.listProductsPage({ cursor: null, page_size: 2 }))
      .resolves.toEqual({ items: products, next_cursor: null });
    expect(adapter.orderInputs).toHaveLength(2);
    expect(adapter.productInputs).toHaveLength(1);

    const tiktokSourceCompatibility = new FakeMarketplaceReadAdapter({
      marketplaceCode: 'TIKTOK_JP',
      products: [{
        marketplace_code: 'TIKTOK_JP',
        platform_product_identifier: 'tiktokDLP2555Q',
        title: '来源字段兼容夹具',
        provider_status: 'LOCAL_FIXTURE',
      }],
    });
    await expect(tiktokSourceCompatibility.listProductsPage({
      cursor: null,
      page_size: 1,
    })).resolves.toMatchObject({
      items: [{ platform_product_identifier: 'tiktokDLP2555Q' }],
    });
  });
});

function adapterWith(
  overrides: Partial<ConstructorParameters<typeof TikTokShopReadAdapter>[0]> = {},
): TikTokShopReadAdapter {
  return new TikTokShopReadAdapter({
    appKey: TIKTOK_APP_KEY,
    appSecret: TIKTOK_APP_SECRET,
    accessToken: TIKTOK_ACCESS_TOKEN,
    shopCipher: TIKTOK_SHOP_CIPHER,
    now: () => FIXED_NOW,
    jitter: () => 0,
    maxAttempts: 3,
    ...overrides,
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function rakutenOrder(
  identifier: string,
  productIdentifier: string,
): MarketplaceProviderOrderDto {
  return Object.freeze({
    marketplace_code: 'RAKUTEN_JP',
    platform_order_identifier: identifier,
    provider_status: 'LOCAL_FIXTURE',
    created_at_unix_ms: 1,
    updated_at_unix_ms: 1,
    platform_product_identifiers: Object.freeze([productIdentifier]),
  });
}

function rakutenProduct(identifier: string): MarketplaceProviderProductDto {
  return Object.freeze({
    marketplace_code: 'RAKUTEN_JP',
    platform_product_identifier: identifier,
    title: `本地夹具 ${identifier}`,
    provider_status: 'LOCAL_FIXTURE',
  });
}
