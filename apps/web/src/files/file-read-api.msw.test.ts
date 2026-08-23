// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import '../test/msw/lifecycle';
import { apiUrl } from '../test/msw/handlers';
import { server } from '../test/msw/server';
import { createIdentityFileReadIntentCoalesced } from './file-read-api';
import type { SafeFileReference } from './file-read-contracts';

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function sellerReference(fileObjectId: string): SafeFileReference {
  return {
    file_object_id: fileObjectId,
    file_version: 1,
    purpose: 'ORDER_EVIDENCE',
    visibility: 'SELLER_VISIBLE',
  };
}

function intentResponse(fileObjectId: string) {
  return {
    read_intent_id: `intent-${fileObjectId}`,
    file_object_id: fileObjectId,
    access_token: `token-${fileObjectId}`.padEnd(40, 'x'),
    access_token_available: true,
    expires_at: 99,
    replayed: false,
  };
}

describe('identity read-intent coalescing', () => {
  it('settles every queued seller request through one batch call, not only the first', async () => {
    const batchRequests: string[] = [];
    server.use(
      http.post(apiUrl('/api/seller-portal/file-read-intents/batch'), async ({ request }) => {
        const body = await request.json() as { requests: { file_object_id: string }[] };
        for (const item of body.requests) batchRequests.push(item.file_object_id);
        return HttpResponse.json({
          data: { intents: body.requests.map((item) => intentResponse(item.file_object_id)) },
          meta: { request_id: 'seller-batch' },
        });
      }),
    );

    // 两个 seller 读意图落在同一微任务窗口（同屏多图的真实形状）
    const [first, second] = await Promise.all([
      createIdentityFileReadIntentCoalesced({
        client: client(),
        identity: 'seller',
        reference: sellerReference('seller-file-1'),
        idempotencyKey: 'coalesce-1',
        signal: new AbortController().signal,
      }),
      createIdentityFileReadIntentCoalesced({
        client: client(),
        identity: 'seller',
        reference: sellerReference('seller-file-2'),
        idempotencyKey: 'coalesce-2',
        signal: new AbortController().signal,
      }),
    ]);

    expect(first.data.file_object_id).toBe('seller-file-1');
    expect(second.data.file_object_id).toBe('seller-file-2');
    expect(batchRequests.sort()).toEqual(['seller-file-1', 'seller-file-2']);
  });

  it('splits batch identities into server-limit chunks instead of failing the whole group', async () => {
    const batchSizes: number[] = [];
    server.use(
      http.post(apiUrl('/api/staff/file-read-intents/batch'), async ({ request }) => {
        const body = await request.json() as { requests: { file_object_id: string }[] };
        batchSizes.push(body.requests.length);
        return HttpResponse.json({
          data: { intents: body.requests.map((item) => intentResponse(item.file_object_id)) },
          meta: { request_id: 'batch-chunk' },
        });
      }),
    );

    // 30 个 staff 读意图同窗口：服务端每批硬顶 25，前端必须切两批全部 settle
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        createIdentityFileReadIntentCoalesced({
          client: client(),
          identity: 'staff',
          reference: { ...sellerReference(`staff-file-${index}`), purpose: 'PRODUCT_IMAGE' },
          idempotencyKey: `batch-${index}`,
          signal: new AbortController().signal,
        })),
    );

    expect(results).toHaveLength(30);
    expect(results.every((result) => result.data.access_token_available)).toBe(true);
    expect(batchSizes.sort((a, b) => b - a)).toEqual([25, 5]);
  });
});
