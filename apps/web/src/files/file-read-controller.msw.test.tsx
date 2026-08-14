// @vitest-environment jsdom
import type { QueryClient } from '@tanstack/react-query';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import '../test/msw/lifecycle';
import {
  captureSessionCycle,
  createSessionInvalidationMarker,
  establishFreshSessionCycle,
} from '../auth/session-invalidation';
import { failureEnvelopeFixture } from '../test/msw/fixtures';
import { apiUrl } from '../test/msw/handlers';
import { createMswQueryClient } from '../test/msw/render';
import { server } from '../test/msw/server';
import {
  type FileReadClock,
  FileReadController,
  type ObjectUrlAdapter,
} from './file-read-controller';
import { safeFileReferenceSchema } from './file-read-contracts';
import { GenericBuyerFileReadIntentAdapter } from './file-read-providers';
import { FileReadTestHarness } from './file-read-test-harness';
import { MAXIMUM_FILE_READ_BYTES } from './file-read-transport';

afterEach(cleanup);

const reference = Object.freeze({
  file_object_id: 'file-safe-1',
  file_version: 3,
  purpose: 'ORDER_EVIDENCE' as const,
  visibility: 'BUYER_VISIBLE' as const,
});
const bytes = new TextEncoder().encode('verified-file-bytes');
const readToken = 'read-token-private'.padEnd(40, 'x');

type ReadEvidence = {
  intentPaths: string[];
  contentPaths: string[];
  intentBodies: unknown[];
  intentKeys: string[];
  contentTokens: string[];
  credentials: RequestCredentials[];
  accepts: (string | null)[];
};

function evidence(): ReadEvidence {
  return {
    intentPaths: [], contentPaths: [], intentBodies: [], intentKeys: [],
    contentTokens: [], credentials: [], accepts: [],
  };
}

function prefix(identity: 'buyer' | 'seller' | 'staff'):
'/api/buyer-portal' | '/api/seller-portal' | '/api/staff' {
  if (identity === 'buyer') return '/api/buyer-portal';
  if (identity === 'seller') return '/api/seller-portal';
  return '/api/staff';
}

function binaryResponse(
  body: BodyInit = bytes,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

function installReadChain(
  identity: 'buyer' | 'seller' | 'staff',
  record: ReadEvidence,
  response: () => Response = () => binaryResponse(),
): void {
  const lifecycle = prefix(identity);
  server.use(
    http.post(apiUrl(`${lifecycle}/files/:fileObjectId/read-intents`), async ({ request, params }) => {
      record.intentPaths.push(new URL(request.url).pathname);
      record.intentBodies.push(await request.json());
      record.intentKeys.push(request.headers.get('Idempotency-Key') ?? '');
      record.credentials.push(request.credentials);
      record.accepts.push(request.headers.get('Accept'));
      return HttpResponse.json({
        data: {
          read_intent_id: `intent-${identity}`,
          file_object_id: String(params['fileObjectId']),
          access_token: readToken,
          access_token_available: true,
          expires_at: 1_900_000_000_000,
          replayed: false,
        },
        meta: { request_id: `request-intent-${identity}` },
      });
    }),
    http.get(apiUrl(`${lifecycle}/file-read-intents/:id/content`), ({ request }) => {
      record.contentPaths.push(new URL(request.url).pathname);
      record.contentTokens.push(request.headers.get('X-File-Read-Token') ?? '');
      record.credentials.push(request.credentials);
      record.accepts.push(request.headers.get('Accept'));
      return response();
    }),
  );
}

function objectUrls() {
  const created: Blob[] = [];
  const revoked: string[] = [];
  let next = 0;
  const adapter: ObjectUrlAdapter = Object.freeze({
    createObjectURL: (blob) => {
      created.push(blob);
      next += 1;
      return `blob:wave14a-${next}`;
    },
    revokeObjectURL: (value) => { revoked.push(value); },
  });
  return { adapter, created, revoked };
}

function manualClock(initial = 10_000) {
  let now = initial;
  let sequence = 0;
  const scheduled = new Map<number, { at: number; callback: () => void }>();
  const clock: FileReadClock = Object.freeze({
    now: () => now,
    schedule: (callback, delay) => {
      sequence += 1;
      const id = sequence;
      scheduled.set(id, { at: now + delay, callback });
      return () => { scheduled.delete(id); };
    },
  });
  const advance = (milliseconds: number): void => {
    now += milliseconds;
    while (true) {
      const ready = [...scheduled.entries()]
        .filter(([, task]) => task.at <= now)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!ready) return;
      scheduled.delete(ready[0]);
      ready[1].callback();
    }
  };
  return { clock, advance };
}

function controller(
  client: QueryClient = createMswQueryClient(),
  adapter: ObjectUrlAdapter = objectUrls().adapter,
  clock?: FileReadClock,
): FileReadController {
  let key = 0;
  return new FileReadController(
    client,
    () => `read-operation-key-${++key}`,
    adapter,
    clock,
  );
}

function seed(client: QueryClient): void {
  client.setQueryData(['buyer', 'session'], 'buyer');
  client.setQueryData(['seller', 'session'], 'seller');
  client.setQueryData(['staff', 'session'], 'staff');
}

describe('formal MSW identity-bound file read chain', () => {
  it.each(['buyer', 'seller', 'staff'] as const)(
    '%s fixes Intent/content paths, request body, credentials, headers, and private authority',
    async (identity) => {
      const record = evidence();
      const urls = objectUrls();
      installReadChain(identity, record);
      const client = createMswQueryClient();
      const target = controller(client, urls.adapter);
      const progress: (number | null)[] = [];
      const unsubscribe = target.subscribe(() => {
        progress.push(target.getSnapshot().progress.percent);
      });

      await target.start(identity, reference);
      unsubscribe();

      expect(target.getSnapshot()).toMatchObject({
        identity,
        state: 'READY',
        safeFileReference: reference,
        contentType: 'image/png',
        byteSize: bytes.byteLength,
        ephemeralObjectUrl: 'blob:wave14a-1',
        requestId: `request-intent-${identity}`,
        progress: { loadedBytes: bytes.byteLength, percent: 100 },
      });
      expect(record.intentPaths).toEqual([
        `${prefix(identity)}/files/${reference.file_object_id}/read-intents`,
      ]);
      expect(record.contentPaths).toEqual([
        `${prefix(identity)}/file-read-intents/intent-${identity}/content`,
      ]);
      expect(record.intentBodies).toEqual([{ expected_file_version: 3 }]);
      expect(record.intentKeys).toEqual(['read-operation-key-1']);
      expect(record.contentTokens).toEqual([readToken]);
      expect(record.credentials).toEqual(['include', 'include']);
      expect(record.accepts).toEqual([
        'application/json', 'application/octet-stream',
      ]);
      expect(progress.indexOf(100)).toBe(progress.length - 1);
      expect(urls.created).toHaveLength(1);
      expect(urls.created[0]!.type).toBe('image/png');
      expect(Array.from(
        new Uint8Array(await urls.created[0]!.arrayBuffer()),
      )).toEqual(Array.from(bytes));
      const serialized = JSON.stringify(target.getSnapshot());
      expect(serialized).not.toMatch(
        /read-token|operation-key|access_token|Idempotency-Key|ArrayBuffer|Uint8Array/iu,
      );
      expect(JSON.stringify(client.getQueryCache().getAll())).not.toMatch(
        /read-token|verified-file-bytes|blob:wave14a/iu,
      );
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    },
  );

  it('renders the Controller path and disposes the object URL on unmount', async () => {
    const record = evidence();
    const urls = objectUrls();
    installReadChain('buyer', record);
    const target = controller(createMswQueryClient(), urls.adapter);
    const rendered = render(<FileReadTestHarness
      controller={target}
      identity="buyer"
      reference={reference}
    />);
    await userEvent.click(screen.getByRole('button', { name: '读取文件' }));
    expect(await screen.findByText('READY')).toBeVisible();
    expect(screen.getByRole('link', { name: '打开文件' })).toHaveAttribute(
      'href', 'blob:wave14a-1',
    );
    rendered.unmount();
    expect(urls.revoked).toEqual(['blob:wave14a-1']);
  });
});

describe('Module 1 provider-backed formal Controller path', () => {
  it.each([429, 503] as const)('reuses the provider token after recoverable %i', async (status) => {
    const record = evidence();
    const time = manualClock();
    let calls = 0;
    installReadChain('buyer', record);
    server.use(http.get(apiUrl('/api/buyer-portal/file-read-intents/:id/content'), ({ request }) => {
      calls += 1;
      record.contentTokens.push(request.headers.get('X-File-Read-Token') ?? '');
      if (calls > 1) return binaryResponse();
      return HttpResponse.json(
        failureEnvelopeFixture(status === 429 ? 'RATE_LIMITED' : 'DEPENDENCY_UNAVAILABLE', 'retry', null, `provider-${status}`),
        { status, ...(status === 429 ? { headers: { 'Retry-After': '1' } } : {}) },
      );
    }));
    const target = controller(createMswQueryClient(), objectUrls().adapter, time.clock);
    const provider = new GenericBuyerFileReadIntentAdapter(reference);
    await target.startWithProvider(provider);
    expect(target.getSnapshot().state).toBe('DEPENDENCY_UNAVAILABLE');
    if (status === 429) time.advance(1_000);
    await target.retry();
    expect(target.getSnapshot().state).toBe('READY');
    expect(record.intentKeys).toEqual(['read-operation-key-1']);
    expect(record.contentTokens[0]).toBe(record.contentTokens[1]);
  });

  it('rejects a structurally similar object or string before any network request', async () => {
    let requests = 0;
    server.events.on('request:start', () => { requests += 1; });
    try {
      for (const candidate of ['/api/private', { identity: 'buyer', create: async () => ({}) }]) {
        const target = controller();
        await target.startWithProvider(candidate);
        expect(target.getSnapshot()).toMatchObject({ state: 'ERROR', safeError: { code: 'VALIDATION_ERROR' } });
      }
      expect(requests).toBe(0);
    } finally {
      server.events.removeAllListeners('request:start');
    }
  });
});

describe('Safe File Reference and Intent recovery', () => {
  it.each([
    ['empty id', { ...reference, file_object_id: '' }],
    ['oversized id', { ...reference, file_object_id: 'a'.repeat(121) }],
    ['unsafe id', { ...reference, file_object_id: '../secret' }],
    ['zero version', { ...reference, file_version: 0 }],
    ['fractional version', { ...reference, file_version: 1.5 }],
    ['unknown purpose', { ...reference, purpose: 'UNKNOWN' }],
    ['unknown visibility', { ...reference, visibility: 'PUBLIC' }],
    ['object key', { ...reference, object_key: 'private/key' }],
    ['URL', { ...reference, url: 'https://example.test/file' }],
    ['owner', { ...reference, owner: 'buyer-1' }],
  ])('strictly rejects %s without a request', async (_name, candidate) => {
    let requests = 0;
    server.events.on('request:start', () => { requests += 1; });
    try {
      expect(safeFileReferenceSchema.safeParse(candidate).success).toBe(false);
      const target = controller();
      await target.start('buyer', candidate);
      expect(target.getSnapshot()).toMatchObject({
        state: 'ERROR', safeError: { code: 'VALIDATION_ERROR' },
      });
      expect(requests).toBe(0);
    } finally {
      server.events.removeAllListeners('request:start');
    }
  });

  it('requires an explicit restart with a fresh key after tokenless replay', async () => {
    const keys: string[] = [];
    let calls = 0;
    server.use(http.post(
      apiUrl('/api/buyer-portal/files/:id/read-intents'),
      ({ request }) => {
        calls += 1;
        keys.push(request.headers.get('Idempotency-Key') ?? '');
        return HttpResponse.json({
          data: {
            read_intent_id: `intent-replay-${calls}`,
            file_object_id: reference.file_object_id,
            access_token: null,
            access_token_available: false,
            expires_at: 1_900_000_000_000,
            replayed: true,
          },
          meta: { request_id: `request-replay-${calls}` },
        });
      },
    ));
    const target = controller();
    await target.start('buyer', reference);
    expect(target.getSnapshot()).toMatchObject({
      state: 'RESTART_REQUIRED', restartRequired: true,
    });
    await target.restart();
    expect(calls).toBe(2);
    expect(keys).toEqual(['read-operation-key-1', 'read-operation-key-2']);
  });

  it.each([
    [409, 'VERSION_CONFLICT'],
    [409, 'REQUEST_IN_PROGRESS'],
  ] as const)('Intent %i %s cannot silently replay the old key', async (status, code) => {
    let calls = 0;
    const keys: string[] = [];
    server.use(http.post(
      apiUrl('/api/buyer-portal/files/:id/read-intents'),
      ({ request }) => {
        calls += 1;
        keys.push(request.headers.get('Idempotency-Key') ?? '');
        return HttpResponse.json(
          failureEnvelopeFixture(code, 'retry', null, `request-${code}`),
          { status },
        );
      },
    ));
    const target = controller();
    await target.start('buyer', reference);
    expect(target.getSnapshot()).toMatchObject({
      state: 'RESTART_REQUIRED', canRetry: false, restartRequired: true,
    });
    expect(calls).toBe(1);
    await target.restart();
    expect(calls).toBe(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('treats an ambiguous Intent network result as restart-required with a new key', async () => {
    let calls = 0;
    const keys: string[] = [];
    server.use(http.post(
      apiUrl('/api/buyer-portal/files/:id/read-intents'),
      ({ request }) => {
        calls += 1;
        keys.push(request.headers.get('Idempotency-Key') ?? '');
        return calls === 1 ? HttpResponse.error() : HttpResponse.json({
          data: {
            read_intent_id: 'intent-recovered',
            file_object_id: reference.file_object_id,
            access_token: readToken,
            access_token_available: true,
            expires_at: 1_900_000_000_000,
            replayed: false,
          },
          meta: { request_id: 'request-recovered' },
        });
      },
    ));
    server.use(http.get(
      apiUrl('/api/buyer-portal/file-read-intents/:id/content'),
      () => binaryResponse(),
    ));
    const target = controller();
    await target.start('buyer', reference);
    expect(target.getSnapshot().state).toBe('RESTART_REQUIRED');
    await target.restart();
    expect(target.getSnapshot().state).toBe('READY');
    expect(keys).toEqual(['read-operation-key-1', 'read-operation-key-2']);
  });
});

describe('binary header, byte, progress, cancellation, and retry boundaries', () => {
  it.each([
    ['HTML', { 'Content-Type': 'text/html' }],
    ['SVG', { 'Content-Type': 'image/svg+xml' }],
    ['JavaScript', { 'Content-Type': 'application/javascript' }],
    ['missing Content-Length', { 'Content-Length': '' }],
    ['zero Content-Length', { 'Content-Length': '0' }],
    ['over 25 MiB', { 'Content-Length': String(MAXIMUM_FILE_READ_BYTES + 1) }],
    ['missing no-store', { 'Cache-Control': 'private' }],
    ['missing nosniff', { 'X-Content-Type-Options': '' }],
  ])('rejects %s before object URL creation', async (_name, headers) => {
    const record = evidence();
    const urls = objectUrls();
    installReadChain('buyer', record, () => binaryResponse(bytes, headers));
    const target = controller(createMswQueryClient(), urls.adapter);
    await target.start('buyer', reference);
    expect(target.getSnapshot()).toMatchObject({
      state: 'RESTART_REQUIRED',
      ephemeralObjectUrl: null,
      safeError: { code: 'MALFORMED_RESPONSE' },
    });
    expect(urls.created).toHaveLength(0);
  });

  it('rejects a body shorter than Content-Length', async () => {
    const record = evidence();
    const urls = objectUrls();
    installReadChain('buyer', record, () => binaryResponse(
      bytes.slice(0, bytes.byteLength - 1),
      { 'Content-Length': String(bytes.byteLength) },
    ));
    const target = controller(createMswQueryClient(), urls.adapter);
    await target.start('buyer', reference);
    expect(target.getSnapshot()).toMatchObject({
      state: 'RESTART_REQUIRED', ephemeralObjectUrl: null,
    });
    expect(urls.created).toHaveLength(0);
  });

  it('stops immediately when streamed bytes exceed Content-Length', async () => {
    const record = evidence();
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(bytes);
        streamController.enqueue(Uint8Array.of(1));
        streamController.close();
      },
    });
    const urls = objectUrls();
    installReadChain('buyer', record, () => binaryResponse(stream, {
      'Content-Length': String(bytes.byteLength),
    }));
    const target = controller(createMswQueryClient(), urls.adapter);
    await target.start('buyer', reference);
    expect(target.getSnapshot()).toMatchObject({
      state: 'RESTART_REQUIRED', ephemeralObjectUrl: null,
    });
    expect(urls.created).toHaveLength(0);
  });

  it('streams multiple chunks and never publishes 100 before completion', async () => {
    const record = evidence();
    const chunks = [bytes.slice(0, 4), bytes.slice(4, 11), bytes.slice(11)];
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
    });
    installReadChain('buyer', record, () => binaryResponse(stream));
    const target = controller();
    const progress: number[] = [];
    target.subscribe(() => {
      const percent = target.getSnapshot().progress.percent;
      if (percent !== null) progress.push(percent);
    });
    await target.start('buyer', reference);
    expect(target.getSnapshot().state).toBe('READY');
    expect(progress.at(-1)).toBe(100);
    expect(progress.slice(0, -1).every((value) => value < 100)).toBe(true);
    expect(progress.some((value) => value > 0 && value < 100)).toBe(true);
  });

  it('cancels an active download, discards its token, and restarts with a new Intent', async () => {
    const record = evidence();
    let contentCalls = 0;
    installReadChain('buyer', record, () => {
      contentCalls += 1;
      if (contentCalls === 1) {
        const stream = new ReadableStream<Uint8Array>({
          async pull(streamController) {
            await new Promise((resolve) => setTimeout(resolve, 80));
            streamController.enqueue(bytes);
            streamController.close();
          },
        });
        return binaryResponse(stream);
      }
      return binaryResponse();
    });
    const target = controller();
    const running = target.start('buyer', reference);
    await waitFor(() => expect(target.getSnapshot().state).toBe('DOWNLOADING'));
    target.cancel();
    await running;
    expect(target.getSnapshot()).toMatchObject({
      state: 'CANCELED', restartRequired: true, canRetry: false,
    });
    await target.restart();
    expect(target.getSnapshot().state).toBe('READY');
    expect(record.intentKeys).toEqual([
      'read-operation-key-1', 'read-operation-key-2',
    ]);
  });

  it('blocks 429 retry for 7 seconds, then reuses the same token once', async () => {
    const record = evidence();
    installReadChain('buyer', record);
    const time = manualClock();
    let calls = 0;
    server.use(http.get(
      apiUrl('/api/buyer-portal/file-read-intents/:id/content'),
      ({ request }) => {
        calls += 1;
        record.contentTokens.push(
          request.headers.get('X-File-Read-Token') ?? '',
        );
        if (calls === 1) {
          return HttpResponse.json(
            failureEnvelopeFixture('RATE_LIMITED', 'retry', null, 'request-429'),
            {
              status: 429,
              headers: { 'Retry-After': '7' },
            },
          );
        }
        return binaryResponse();
      },
    ));
    const target = controller(createMswQueryClient(), objectUrls().adapter, time.clock);
    await target.start('buyer', reference);
    expect(target.getSnapshot()).toMatchObject({
      state: 'DEPENDENCY_UNAVAILABLE', canRetry: false, restartRequired: true,
      safeError: { retryAfter: 7_000 },
    });
    expect(calls).toBe(1);
    await target.retry();
    expect(calls).toBe(1);
    time.advance(6_999);
    await target.retry();
    expect(calls).toBe(1);
    time.advance(1);
    expect(target.getSnapshot().canRetry).toBe(true);
    expect(calls).toBe(1);
    await target.retry();
    expect(target.getSnapshot().state).toBe('READY');
    expect(calls).toBe(2);
    expect(record.contentTokens[0]).toBe(record.contentTokens[1]);
    expect(target.getSnapshot()).toMatchObject({
      canRetry: false, restartRequired: false,
    });
    expect(JSON.stringify(target.getSnapshot())).not.toContain('retryAvailableAt');
  });

  it('clears a pending 429 window on cancel without another request', async () => {
    const record = evidence();
    const time = manualClock();
    installReadChain('buyer', record, () => HttpResponse.json(
      failureEnvelopeFixture('RATE_LIMITED', 'retry', null, 'request-cancel-429'),
      { status: 429, headers: { 'Retry-After': '7' } },
    ));
    const target = controller(createMswQueryClient(), objectUrls().adapter, time.clock);
    await target.start('buyer', reference);
    expect(record.contentPaths).toHaveLength(1);
    target.cancel();
    expect(target.getSnapshot().state).toBe('CANCELED');
    time.advance(7_000);
    await target.retry();
    expect(record.contentPaths).toHaveLength(1);
  });

  it('allows 429 restart with a new Intent and clears the old wait window', async () => {
    const record = evidence();
    const time = manualClock();
    let calls = 0;
    installReadChain('buyer', record, () => {
      calls += 1;
      return calls === 1 ? HttpResponse.json(
        failureEnvelopeFixture('RATE_LIMITED', 'retry', null, 'request-restart-429'),
        { status: 429, headers: { 'Retry-After': '7' } },
      ) : binaryResponse();
    });
    const target = controller(createMswQueryClient(), objectUrls().adapter, time.clock);
    await target.start('buyer', reference);
    await target.restart();
    expect(target.getSnapshot().state).toBe('READY');
    expect(record.intentKeys).toEqual([
      'read-operation-key-1', 'read-operation-key-2',
    ]);
    time.advance(7_000);
    expect(calls).toBe(2);
  });

  it('requires a new Intent when 429 Retry-After is invalid', async () => {
    const record = evidence();
    let calls = 0;
    installReadChain('buyer', record, () => {
      calls += 1;
      return calls === 1 ? HttpResponse.json(
        failureEnvelopeFixture('RATE_LIMITED', 'retry', null, 'request-invalid-429'),
        { status: 429, headers: { 'Retry-After': 'invalid' } },
      ) : binaryResponse();
    });
    const target = controller();
    await target.start('buyer', reference);
    expect(target.getSnapshot()).toMatchObject({
      state: 'RESTART_REQUIRED', canRetry: false, restartRequired: true,
    });
    await target.retry();
    expect(calls).toBe(1);
    await target.restart();
    expect(calls).toBe(2);
    expect(record.intentKeys).toEqual([
      'read-operation-key-1', 'read-operation-key-2',
    ]);
  });

  it('keeps explicit immediate same-token retry for clear 503', async () => {
    const record = evidence();
    let calls = 0;
    installReadChain('buyer', record);
    server.use(http.get(
      apiUrl('/api/buyer-portal/file-read-intents/:id/content'),
      ({ request }) => {
        calls += 1;
        record.contentTokens.push(
          request.headers.get('X-File-Read-Token') ?? '',
        );
        return calls === 1 ? HttpResponse.json(
          failureEnvelopeFixture(
            'DEPENDENCY_UNAVAILABLE', 'retry', null, 'request-503',
          ),
          { status: 503 },
        ) : binaryResponse();
      },
    ));
    const target = controller();
    await target.start('buyer', reference);
    expect(target.getSnapshot()).toMatchObject({
      state: 'DEPENDENCY_UNAVAILABLE', canRetry: true,
      restartRequired: false,
    });
    await target.retry();
    expect(target.getSnapshot().state).toBe('READY');
    expect(calls).toBe(2);
    expect(record.contentTokens[0]).toBe(record.contentTokens[1]);
  });

  it.each([
    [409, 'FILE_STORAGE_CONFLICT', 'FILE_STORAGE_CONFLICT', false],
    [410, 'FILE_UPLOAD_EXPIRED', 'RESTART_REQUIRED', true],
    [403, 'FORBIDDEN', 'ERROR', false],
    [404, 'NOT_FOUND', 'ERROR', false],
  ] as const)('maps %i %s to its safe terminal state', async (
    status,
    code,
    state,
    restartRequired,
  ) => {
    const record = evidence();
    installReadChain('buyer', record, () => HttpResponse.json(
      failureEnvelopeFixture(code, 'safe', null, `request-${code}`),
      { status },
    ));
    const target = controller();
    await target.start('buyer', reference);
    expect(target.getSnapshot()).toMatchObject({
      state, restartRequired, canRetry: false, ephemeralObjectUrl: null,
      safeError: { code, requestId: `request-${code}` },
    });
  });
});

describe('identity 401 generation and Object URL lifecycle', () => {
  it.each([
    ['buyer', ['buyer', 'seller'], ['staff']],
    ['seller', ['buyer', 'seller'], ['staff']],
    ['staff', ['staff'], ['buyer', 'seller']],
  ] as const)('%s 401 clears only its session domain after invalidation completes', async (
    identity,
    cleared,
    preserved,
  ) => {
    const client = createMswQueryClient();
    seed(client);
    const lifecycle = prefix(identity);
    server.use(http.post(
      apiUrl(`${lifecycle}/files/:id/read-intents`),
      () => HttpResponse.json(
        failureEnvelopeFixture(
          'UNAUTHENTICATED', 'login', null, `request-${identity}-401`,
        ),
        { status: 401 },
      ),
    ));
    const target = controller(client);
    await target.start(identity, reference);
    for (const root of cleared) {
      expect(client.getQueriesData({ queryKey: [root] })).toEqual([]);
    }
    for (const root of preserved) {
      expect(client.getQueryData([root, 'session'])).toBe(root);
    }
    expect(target.getSnapshot().state).toBe('RESTART_REQUIRED');
  });

  it('ignores an old download 401 after a fresh session generation is established', async () => {
    const client = createMswQueryClient();
    seed(client);
    const record = evidence();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    installReadChain('buyer', record, () => HttpResponse.json(
      failureEnvelopeFixture('UNAUTHENTICATED', 'login', null, 'request-old-401'),
      { status: 401 },
    ));
    server.use(http.get(
      apiUrl('/api/buyer-portal/file-read-intents/:id/content'),
      async () => {
        await gate;
        return HttpResponse.json(
          failureEnvelopeFixture(
            'UNAUTHENTICATED', 'login', null, 'request-old-401',
          ),
          { status: 401 },
        );
      },
    ));
    const target = controller(client);
    const running = target.start('buyer', reference);
    await waitFor(() => expect(target.getSnapshot().state).toBe('DOWNLOADING'));
    const cycle = captureSessionCycle(client, 'buyer');
    const marker=await createSessionInvalidationMarker('buyer','buyer-fresh',1,1);
    expect(establishFreshSessionCycle(client, 'buyer', cycle, marker)).not.toBeNull();
    release();
    await running;
    expect(client.getQueryData(['buyer', 'session'])).toBe('buyer');
    expect(client.getQueryData(['seller', 'session'])).toBe('seller');
  });

  it('revokes on release and revokes the first URL before creating a second', async () => {
    const record = evidence();
    const urls = objectUrls();
    installReadChain('buyer', record);
    const target = controller(createMswQueryClient(), urls.adapter);
    await target.start('buyer', reference);
    expect(target.getSnapshot().ephemeralObjectUrl).toBe('blob:wave14a-1');
    await target.start('buyer', { ...reference, file_object_id: 'file-safe-2' });
    expect(urls.revoked).toEqual(['blob:wave14a-1']);
    expect(target.getSnapshot().ephemeralObjectUrl).toBe('blob:wave14a-2');
    target.release();
    expect(urls.revoked).toEqual(['blob:wave14a-1', 'blob:wave14a-2']);
    expect(target.getSnapshot()).toMatchObject({
      state: 'IDLE', ephemeralObjectUrl: null, canRelease: false,
    });
  });

  it('dispose aborts an active operation without creating or leaking a URL', async () => {
    const record = evidence();
    const urls = objectUrls();
    installReadChain('buyer', record);
    server.use(http.get(
      apiUrl('/api/buyer-portal/file-read-intents/:id/content'),
      async () => {
        await delay(100);
        return binaryResponse();
      },
    ));
    const target = controller(createMswQueryClient(), urls.adapter);
    const running = target.start('buyer', reference);
    await waitFor(() => expect(target.getSnapshot().state).toBe('DOWNLOADING'));
    act(() => target.dispose());
    await running;
    expect(urls.created).toHaveLength(0);
    expect(urls.revoked).toHaveLength(0);
  });
});
