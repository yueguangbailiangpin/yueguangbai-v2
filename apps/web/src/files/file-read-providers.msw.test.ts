// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS } from '@ygb/contracts';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import '../test/msw/lifecycle';
import { apiUrl } from '../test/msw/handlers';
import { server } from '../test/msw/server';
import {
  BuyerInstructionImageReadIntentAdapter,
  BuyerOrderEvidenceFileReadIntentAdapter,
  BuyerReviewFileReadIntentAdapter,
  GenericBuyerFileReadIntentAdapter,
  SellerOrderChatScreenshotReadIntentAdapter,
} from './file-read-providers';

const token = 'private-read-token'.padEnd(40, 'x');
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const invalidActionSets: ReadonlyArray<readonly [readonly string[]]> = [
  [[]],
  [['SUBMIT']],
  [['CREATE_READ_INTENT', 'OTHER']],
];

describe('Module 1 narrow file read providers', () => {
  it('keeps generic Buyer reads on the generic fixed lifecycle route', async () => {
    server.use(http.post(apiUrl('/api/buyer-portal/files/file-1/read-intents'), async ({ request }) => {
      expect(await request.json()).toEqual({ expected_file_version: 3 });
      return HttpResponse.json({ data: intent('file-1'), meta: { request_id: 'generic-request' } });
    }));
    const provider = new GenericBuyerFileReadIntentAdapter({
      file_object_id: 'file-1', file_version: 3, purpose: 'ORDER_EVIDENCE', visibility: 'BUYER_VISIBLE',
    });
    await expect(provider.create(client(), 'generic-key', new AbortController().signal)).resolves.toMatchObject({
      fileObjectId: 'file-1', replayed: false, authorityAssertion: 'VERIFIED',
    });
  });

  it('validates instruction DTO path against reservation and main position', async () => {
    const path = '/api/buyer-portal/reservations/res-1/order-instruction/images/main/read-intent';
    server.use(http.post(apiUrl(path), () => HttpResponse.json({
      data: { read_intent: { read_intent_id: 'intent-main', access_token: token, access_token_available: true, expires_at: 99 } },
      meta: { request_id: 'instruction-request' },
    })));
    const result = await new BuyerInstructionImageReadIntentAdapter('res-1', 'main', path)
      .create(client(), 'instruction-key', new AbortController().signal);
    expect(result).toMatchObject({ fileObjectId: null, replayed: null, authorityAssertion: 'UNVERIFIABLE_MISSING_FIELDS' });
  });

  it.each([
    ['foreign reservation', 'res-1', 'main', '/api/buyer-portal/reservations/res-2/order-instruction/images/main/read-intent'],
    ['foreign position', 'res-1', 2, '/api/buyer-portal/reservations/res-1/order-instruction/images/3/read-intent'],
    ['arbitrary API path', 'res-1', 'main', '/api/staff/files/private/read-intent'],
  ] as const)('rejects %s before network', (_name, reservation, position, path) => {
    expect(() => new BuyerInstructionImageReadIntentAdapter(reservation, position, path)).toThrow();
  });

  it('constructs the review path from verified entity identifiers', async () => {
    server.use(http.post(apiUrl('/api/buyer-portal/reviews/review-1/files/link-1/read-intent'), async ({ request }) => {
      expect(await request.json()).toEqual({ expected_file_version: 4 });
      return HttpResponse.json({ data: intent('review-file'), meta: { request_id: 'review-request' } });
    }));
    const result = await new BuyerReviewFileReadIntentAdapter('review-1', 'link-1', 'review-file', 4, ['CREATE_READ_INTENT'])
      .create(client(), 'review-key', new AbortController().signal);
    expect(result.fileObjectId).toBe('review-file');
  });

  it('constructs the order evidence path from verified authority', async () => {
    server.use(http.post(apiUrl('/api/buyer-portal/order-evidence/evidence-1/files/link-2/read-intent'), () => HttpResponse.json({
      data: intent('evidence-file'), meta: { request_id: 'evidence-request' },
    })));
    const result = await new BuyerOrderEvidenceFileReadIntentAdapter('evidence-1', 'link-2', 'evidence-file', 5, ['CREATE_READ_INTENT'])
      .create(client(), 'evidence-key', new AbortController().signal);
    expect(result.authorityAssertion).toBe('VERIFIED');
  });

  it.each(invalidActionSets)('rejects missing or expanded file actions %#', (actions) => {
    expect(() => new BuyerOrderEvidenceFileReadIntentAdapter('e1', 'l1', 'f1', 1, actions)).toThrow();
  });

  it('rejects a mismatched returned file object', async () => {
    server.use(http.post(apiUrl('/api/buyer-portal/reviews/review-1/files/link-1/read-intent'), () => HttpResponse.json({
      data: intent('foreign-file'), meta: { request_id: 'mismatch-request' },
    })));
    await expect(new BuyerReviewFileReadIntentAdapter('review-1', 'link-1', 'expected-file', 2, ['CREATE_READ_INTENT'])
      .create(client(), 'mismatch-key', new AbortController().signal)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
  });

  it('preserves tokenless replay as restart-required input without inventing a token', async () => {
    server.use(http.post(apiUrl('/api/buyer-portal/order-evidence/e1/files/l1/read-intent'), () => HttpResponse.json({
      data: { ...intent('f1'), access_token: null, access_token_available: false, replayed: true },
      meta: { request_id: 'replay-request' },
    })));
    await expect(new BuyerOrderEvidenceFileReadIntentAdapter('e1', 'l1', 'f1', 1, ['CREATE_READ_INTENT'])
      .create(client(), 'replay-key', new AbortController().signal)).resolves.toMatchObject({ accessToken: null, replayed: true });
  });

  it('uses only the entity-specific Seller chat screenshot read-intent route', async () => {
    const path = SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS.sellerReadIntent
      .replace(':id', 'order-1') as `/api/${string}`;
    server.use(http.post(apiUrl(path), async ({ request }) => {
      expect(await request.json()).toEqual({ expected_file_version: 3 });
      expect(request.headers.get('Idempotency-Key')).toBe('seller-chat-key');
      return HttpResponse.json({ data: {
        read_intent: {
          read_intent_id: 'seller-chat-intent',
          access_token: token,
          access_token_available: true,
          expires_at: 99,
          replayed: false,
        },
      }, meta: { request_id: 'seller-chat-request' } });
    }));
    const provider = new SellerOrderChatScreenshotReadIntentAdapter('order-1', 3);
    await expect(provider.create(client(), 'seller-chat-key', new AbortController().signal))
      .resolves.toMatchObject({
        accessToken: token,
        fileObjectId: null,
        authorityAssertion: 'UNVERIFIABLE_MISSING_FIELDS',
      });
  });

  it('fails closed when the Seller read-intent response is a replay without a token', async () => {
    const path = SELLER_ORDER_CHAT_SCREENSHOT_HTTP_PATHS.sellerReadIntent
      .replace(':id', 'order-1') as `/api/${string}`;
    server.use(http.post(apiUrl(path), () => HttpResponse.json({
      data: { read_intent: {
        read_intent_id: 'seller-chat-intent', access_token: null,
        access_token_available: false, expires_at: 99, replayed: true,
      } },
      meta: { request_id: 'seller-chat-replay' },
    })));
    await expect(new SellerOrderChatScreenshotReadIntentAdapter('order-1', 3)
      .create(client(), 'seller-chat-replay-key', new AbortController().signal))
      .rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
  });
});

function intent(fileObjectId: string) {
  return { read_intent_id: 'intent-1', file_object_id: fileObjectId, access_token: token,
    access_token_available: true, expires_at: 99, replayed: false };
}
