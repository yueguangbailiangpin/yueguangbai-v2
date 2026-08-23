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
  return HttpResponse.json({
    data: {
      read_intent_id: `intent-${fileObjectId}`,
      file_object_id: fileObjectId,
      access_token: `token-${fileObjectId}`.padEnd(40, 'x'),
      access_token_available: true,
      expires_at: 99,
      replayed: false,
    },
    meta: { request_id: `request-${fileObjectId}` },
  });
}

describe('identity read-intent coalescing', () => {
  it('settles every queued request for non-batch identities, not only the first', async () => {
    const requested: string[] = [];
    server.use(
      http.post(apiUrl('/api/seller-portal/files/:fileObjectId/read-intents'), ({ params }) => {
        const fileObjectId = String(params['fileObjectId']);
        requested.push(fileObjectId);
        return intentResponse(fileObjectId);
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
    expect(requested.sort()).toEqual(['seller-file-1', 'seller-file-2']);
  });
});
