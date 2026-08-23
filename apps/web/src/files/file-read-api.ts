import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { FrontendApiError } from '../api/errors';
import { operationHeaders } from '../api/idempotency';
import {
  identityApiRequest,
  type RequestIdentity,
} from '../api/identity-request';
import {
  fileReadIntentBody,
  fileReadIntentResponseSchema,
  type FileReadIntentResponse,
  type SafeFileReference,
} from './file-read-contracts';

const READ_PREFIX = Object.freeze({
  buyer: '/api/buyer-portal',
  seller: '/api/seller-portal',
  staff: '/api/staff',
} as const satisfies Record<RequestIdentity, string>);

export function fileReadLifecyclePrefix(identity: RequestIdentity):
  '/api/buyer-portal' | '/api/seller-portal' | '/api/staff' {
  return READ_PREFIX[identity];
}

export async function createIdentityFileReadIntent(input: {
  client: QueryClient;
  identity: RequestIdentity;
  reference: SafeFileReference;
  idempotencyKey: string;
  signal: AbortSignal;
}): Promise<Readonly<{ data: FileReadIntentResponse; requestId: string }>> {
  const body = fileReadIntentBody(input.reference);
  const result = await identityApiRequest(input.identity, input.client, {
    path: `${fileReadLifecyclePrefix(input.identity)}/files/${input.reference.file_object_id}/read-intents`,
    method: 'POST',
    schema: fileReadIntentResponseSchema,
    body,
    headers: operationHeaders({ key: input.idempotencyKey, body }),
    signal: input.signal,
  });
  if (result.data.file_object_id !== input.reference.file_object_id
    || result.data.replayed === result.data.access_token_available
    || (result.data.access_token_available
      ? result.data.access_token === null
      : result.data.access_token !== null)) {
    throw new FrontendApiError(
      'MALFORMED_RESPONSE', 200, result.requestId, 'CONTRACT',
    );
  }
  return result;
}

const batchFileReadIntentResponseSchema = z.object({
  intents: z.array(fileReadIntentResponseSchema),
}).strict();

// 与后端 createFileReadIntentsBatch 的硬顶保持一致（超出整批 400）。
const BATCH_READ_INTENT_LIMIT = 25;

interface BrokeredReadIntent {
  client: QueryClient;
  identity: RequestIdentity;
  reference: SafeFileReference;
  idempotencyKey: string;
  signal: AbortSignal;
  resolve: (value: Readonly<{
    data: FileReadIntentResponse;
    requestId: string;
  }>) => void;
  reject: (error: unknown) => void;
}

let readIntentQueue: BrokeredReadIntent[] = [];
let readIntentFlushScheduled = false;

/**
 * Coalescing entry point used by image previews: read-intent requests that
 * arrive within the same commit (a list screen mounting N protected images)
 * share ONE batch POST when their identity supports it, falling back to the
 * single-file endpoint for lone requests. The queue flushes on a microtask
 * so request timing stays promise-like. Semantics per file (idempotency,
 * replay contract) are identical to the single endpoint.
 */
export function createIdentityFileReadIntentCoalesced(input: {
  client: QueryClient;
  identity: RequestIdentity;
  reference: SafeFileReference;
  idempotencyKey: string;
  signal: AbortSignal;
}): Promise<Readonly<{ data: FileReadIntentResponse; requestId: string }>> {
  return new Promise((resolve, reject) => {
    readIntentQueue.push({ ...input, resolve, reject });
    if (!readIntentFlushScheduled) {
      readIntentFlushScheduled = true;
      queueMicrotask(() => {
        readIntentFlushScheduled = false;
        void flushReadIntentQueue();
      });
    }
  });
}

async function flushReadIntentQueue(): Promise<void> {
  const queued = readIntentQueue;
  readIntentQueue = [];
  const groups = new Map<RequestIdentity, BrokeredReadIntent[]>();
  for (const request of queued) {
    const group = groups.get(request.identity) ?? [];
    group.push(request);
    groups.set(request.identity, group);
  }
  await Promise.all(
    [...groups.entries()].map(([identity, items]) =>
      items.length === 1 || !batchSupported(identity)
        ? Promise.all(items.map((item) => settleSingleReadIntent(item)))
        : settleBatchReadIntents(identity, items),
    ),
  );
}

function batchSupported(identity: RequestIdentity): boolean {
  return identity === 'staff' || identity === 'buyer' || identity === 'seller';
}

async function settleSingleReadIntent(
  request: BrokeredReadIntent,
): Promise<void> {
  try {
    request.resolve(await createIdentityFileReadIntent({
      client: request.client,
      identity: request.identity,
      reference: request.reference,
      idempotencyKey: request.idempotencyKey,
      signal: request.signal,
    }));
  } catch (error) {
    request.reject(error);
  }
}

async function settleBatchReadIntents(
  identity: RequestIdentity,
  items: readonly BrokeredReadIntent[],
): Promise<void> {
  if (!batchSupported(identity)) {
    await Promise.all(items.map((item) => settleSingleReadIntent(item)));
    return;
  }
  // 服务端每批硬顶 25 条（file-read-service createFileReadIntentsBatch）；
  // 同屏挂载更多图时切多发几批，而不是让整组请求一起失败。
  for (let offset = 0; offset < items.length; offset += BATCH_READ_INTENT_LIMIT) {
    const chunk = items.slice(offset, offset + BATCH_READ_INTENT_LIMIT);
    await settleOneBatchReadIntentChunk(identity, chunk);
  }
}

async function settleOneBatchReadIntentChunk(
  identity: RequestIdentity,
  items: readonly BrokeredReadIntent[],
): Promise<void> {
  try {
    const body = {
      requests: items.map((item) => ({
        file_object_id: item.reference.file_object_id,
        expected_file_version: item.reference.file_version,
      })),
    };
    const key = crypto.randomUUID();
    const result = await identityApiRequest(identity, items[0]!.client, {
      path: `${fileReadLifecyclePrefix(identity)}/file-read-intents/batch`,
      method: 'POST',
      schema: batchFileReadIntentResponseSchema,
      body,
      headers: operationHeaders({ key, body }),
    });
    const byObjectId = new Map(
      result.data.intents.map((intent) => [intent.file_object_id, intent]),
    );
    for (const item of items) {
      const intent = byObjectId.get(item.reference.file_object_id);
      if (!intent
        || intent.replayed === intent.access_token_available
        || (intent.access_token_available
          ? intent.access_token === null
          : intent.access_token !== null)) {
        item.reject(new FrontendApiError(
          'MALFORMED_RESPONSE', 200, result.requestId, 'CONTRACT',
        ));
        continue;
      }
      item.resolve({
        data: intent,
        requestId: result.requestId,
      });
    }
  } catch (error) {
    for (const item of items) {
      item.reject(error);
    }
  }
}
