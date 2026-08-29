import { describe, expect, it } from 'vitest';
import { DriveArchiveClientError } from '@ygb/contracts';
import { sha256Hex } from '@ygb/domain';
import { createFakeDriveHttpServer } from '../test-support/fake-drive-http';
import {
  createGoogleDriveArchiveClient,
  createGoogleOAuthRefreshTokenProvider,
  createStaticAccessTokenProvider,
  googleDriveArchiveClientFromEnv,
  type GoogleDriveArchiveClientConfig,
} from './drive-http-client';
import { archiveRuntime } from './runtime';

/**
 * Stage 6.5 unit coverage for the production Google Drive HTTP adapter.
 * Every request goes to the local fake Drive server — zero real network, no
 * credentials, no Drive resources. Redaction assertions keep tokens, session
 * URIs and file ids out of every error surface.
 */

const TOKEN = 'unit-test-drive-token';

function clientConfig(
  server: ReturnType<typeof createFakeDriveHttpServer>,
  overrides: Partial<GoogleDriveArchiveClientConfig> = {},
): GoogleDriveArchiveClientConfig {
  return {
    folderId: 'unit-test-folder-123',
    tokenProvider: createStaticAccessTokenProvider(TOKEN),
    fetchImpl: server.fetch,
    requestTimeoutMs: 5_000,
    retryBaseDelayMs: 50,
    ...overrides,
  };
}

function payload(byteLength: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(byteLength));
  for (let index = 0; index < byteLength; index += 1) bytes[index] = (index * 31 + 7) % 251;
  return bytes;
}

/** Every error this module may throw must match the closed vocabulary. */
function redacted(error: unknown): DriveArchiveClientError {
  expect(error).toBeInstanceOf(DriveArchiveClientError);
  const driveError = error as DriveArchiveClientError;
  expect(driveError.message).toMatch(/^drive_archive_[a-z_]+$/u);
  const detail = String(driveError.cause ?? '');
  expect(detail).toMatch(/^(status=\d+|[a-z0-9_]+)$/u);
  const all = `${driveError.message} ${detail}`;
  expect(all).not.toContain(TOKEN);
  expect(all).not.toContain('SECRET-UPLOAD-ID');
  expect(all).not.toContain('https://');
  expect(all).not.toContain('fakeapi-file-');
  return driveError;
}

/** Captures the rejection, checks redaction, and asserts the category. */
async function expectDriveError(
  promise: Promise<unknown>,
  category: Parameters<typeof redacted>[0] extends never ? never : import('@ygb/contracts').DriveArchiveFailureCategory,
): Promise<DriveArchiveClientError> {
  let captured: unknown = 'NO_ERROR_THROWN';
  await promise.then(() => undefined, (error: unknown) => { captured = error; });
  const driveError = redacted(captured);
  expect(driveError.category).toBe(category);
  return driveError;
}

describe('stage 6.5 google drive http client (resumable protocol)', () => {
  it('creates a resumable session with the documented request shape', async () => {
    const server = createFakeDriveHttpServer({ accessToken: TOKEN });
    const client = createGoogleDriveArchiveClient(clientConfig(server));
    const bytes = payload(1_000);
    const session = await client.createUploadSession({
      fileName: 'bundle-1-v1.zip',
      mimeType: 'application/zip',
      totalByteSize: bytes.byteLength,
      sha256Hex: await sha256Hex(bytes),
    });
    expect(session.sessionKey).toMatch(/^drive-upload-session:[0-9a-f-]{36}$/u);
    expect(session.folderKey).toBe('unit-test-folder-123');
    expect(session.acceptedByteSize).toBe(0);
    expect(session.completedFileId).toBeNull();
    const create = server.calls.find((call) => call.kind === 'session_create')!;
    expect(create.method).toBe('POST');
    expect(create.url).toContain('uploadType=resumable');
    expect(create.url).toContain('supportsAllDrives=true');
    expect(create.authorization).toBe(`Bearer ${TOKEN}`);
    expect(create.uploadContentType).toBe('application/zip');
    expect(create.uploadContentLength).toBe('1000');
    expect(JSON.parse(create.bodyText!)).toEqual({
      name: 'bundle-1-v1.zip',
      mimeType: 'application/zip',
      parents: ['unit-test-folder-123'],
    });
    // The opaque session key carries no session URI (that stays a secret in
    // isolate memory — the pipeline persists the KEY in D1, never the URL).
    expect(session.sessionKey).not.toContain(server.sessionUploadId);
  });

  it('adds the driveId parameter when a shared drive is configured', async () => {
    const server = createFakeDriveHttpServer({ accessToken: TOKEN });
    const client = createGoogleDriveArchiveClient(clientConfig(server, { sharedDriveId: 'shared-drive-9' }));
    const bytes = payload(10);
    await client.createUploadSession({
      fileName: 'b.zip', mimeType: 'application/zip',
      totalByteSize: 10, sha256Hex: await sha256Hex(bytes),
    });
    expect(server.calls[0]!.url).toContain('driveId=shared-drive-9');
  });

  it('uploads chunks, parses 308 partial ranges, resumes from the accepted offset and completes', async () => {
    const server = createFakeDriveHttpServer({ accessToken: TOKEN, partialAcceptBytes: 300 });
    const client = createGoogleDriveArchiveClient(clientConfig(server));
    const bytes = payload(1_000);
    const session = await client.createUploadSession({
      fileName: 'b.zip', mimeType: 'application/zip',
      totalByteSize: bytes.byteLength, sha256Hex: await sha256Hex(bytes),
    });
    // First 500-byte chunk: the server accepts only 300 (mid-chunk 308).
    const partial = await client.uploadChunk({
      sessionKey: session.sessionKey,
      offset: 0,
      bytes: bytes.slice(0, 500),
      isFinal: false,
    });
    expect(partial.completedFileId).toBeNull();
    expect(partial.acceptedByteSize).toBe(300);
    // Status query reports the same durable accepted prefix.
    const queried = await client.queryUploadSession(session.sessionKey);
    expect(queried).not.toBeNull();
    expect(queried!.acceptedByteSize).toBe(300);
    // Resume from 300 with the remainder; final chunk completes the file.
    const done = await client.uploadChunk({
      sessionKey: session.sessionKey,
      offset: 300,
      bytes: bytes.slice(300),
      isFinal: true,
    });
    expect(done.completedFileId).toMatch(/^fakeapi-file-/u);
    expect(done.acceptedByteSize).toBe(1_000);
    // The stored Drive bytes equal the payload byte for byte.
    const stored = server.uploadedBytes(done.completedFileId!)!;
    expect(stored.byteLength).toBe(bytes.byteLength);
    expect(await sha256Hex(stored)).toBe(await sha256Hex(bytes));
    const chunkCalls = server.calls.filter((call) => call.kind === 'chunk_put');
    expect(chunkCalls[0]!.contentRange).toBe('bytes 0-499/1000');
    expect(chunkCalls[1]!.contentRange).toBe('bytes 300-999/1000');
    expect(chunkCalls.some((call) => call.url.includes(server.sessionUploadId))).toBe(true);
  });

  it('recovers a mid-chunk network failure with bounded retries', async () => {
    const server = createFakeDriveHttpServer({ accessToken: TOKEN });
    const sleeps: number[] = [];
    let chunkAttempts = 0;
    const failingOnce: typeof fetch = (async (url: unknown, init?: RequestInit) => {
      if (typeof url === 'string' && String(init?.method) === 'PUT' && chunkAttempts === 0) {
        chunkAttempts += 1;
        throw new TypeError('fetch failed');
      }
      return server.fetch(url as string, init);
    }) as typeof fetch;
    const client = createGoogleDriveArchiveClient(clientConfig(server, {
      fetchImpl: failingOnce, sleep: async (ms) => { sleeps.push(ms); },
    }));
    const bytes = payload(100);
    const session = await client.createUploadSession({
      fileName: 'b.zip', mimeType: 'application/zip',
      totalByteSize: 100, sha256Hex: await sha256Hex(bytes),
    });
    const done = await client.uploadChunk({
      sessionKey: session.sessionKey, offset: 0, bytes, isFinal: true,
    });
    expect(done.completedFileId).toMatch(/^fakeapi-file-/u);
    expect(sleeps).toEqual([50]);
    // The first attempt failed before reaching the server, so exactly one
    // chunk PUT was served (the retry).
    expect(server.callCount('chunk_put')).toBe(1);
  });

  it('backs off on 429 honoring Retry-After and on 5xx exponentially', async () => {
    const server = createFakeDriveHttpServer({
      accessToken: TOKEN,
      injections: [
        { kind: 'session_create', status: 429, retryAfterSeconds: 1 },
        { kind: 'session_create', status: 503 },
      ],
    });
    const sleeps: number[] = [];
    const client = createGoogleDriveArchiveClient(clientConfig(server, {
      sleep: async (ms) => { sleeps.push(ms); },
    }));
    const bytes = payload(10);
    const session = await client.createUploadSession({
      fileName: 'b.zip', mimeType: 'application/zip',
      totalByteSize: 10, sha256Hex: await sha256Hex(bytes),
    });
    expect(session.sessionKey).toMatch(/^drive-upload-session:/u);
    // Retry-After 1s wins over the 50 ms exponential base; the next retry
    // doubles the base.
    expect(sleeps).toEqual([1_000, 100]);
    expect(server.callCount('session_create')).toBe(3);
  });

  it('refreshes the token once on 401 and fails closed when it persists', async () => {
    let current = 'stale-token';
    const provider = {
      getAccessToken: async () => current,
      invalidate: () => { current = TOKEN; },
    };
    const server = createFakeDriveHttpServer({ accessToken: TOKEN });
    const client = createGoogleDriveArchiveClient(clientConfig(server, { tokenProvider: provider }));
    const bytes = payload(10);
    const session = await client.createUploadSession({
      fileName: 'b.zip', mimeType: 'application/zip',
      totalByteSize: 10, sha256Hex: await sha256Hex(bytes),
    });
    expect(session.sessionKey).toMatch(/^drive-upload-session:/u);
    expect(server.callCount('session_create')).toBe(2);

    // A server that keeps rejecting → exactly one refresh attempt, then a
    // non-retryable authorization failure.
    const always401 = createFakeDriveHttpServer({ accessToken: 'some-other-token' });
    const rejects = createGoogleDriveArchiveClient(clientConfig(always401, { tokenProvider: provider }));
    await expectDriveError(rejects.createUploadSession({
      fileName: 'b.zip', mimeType: 'application/zip',
      totalByteSize: 10, sha256Hex: await sha256Hex(bytes),
    }), 'authorization_failed');
    expect(always401.callCount()).toBe(2);
  });

  it('fails closed immediately on 403 without retrying', async () => {
    const server = createFakeDriveHttpServer({
      accessToken: TOKEN,
      injections: [{ kind: 'metadata', status: 403 }],
    });
    const client = createGoogleDriveArchiveClient(clientConfig(server));
    await expectDriveError(client.readFileMetadata('fileid123'), 'authorization_failed');
    expect(server.callCount('metadata')).toBe(1);
  });

  it('reads metadata with fields and streams media back for hashing', async () => {
    const server = createFakeDriveHttpServer({ accessToken: TOKEN });
    const client = createGoogleDriveArchiveClient(clientConfig(server));
    const bytes = payload(700);
    const session = await client.createUploadSession({
      fileName: 'b.zip', mimeType: 'application/zip',
      totalByteSize: bytes.byteLength, sha256Hex: await sha256Hex(bytes),
    });
    const done = await client.uploadChunk({
      sessionKey: session.sessionKey, offset: 0, bytes, isFinal: true,
    });
    const metadata = await client.readFileMetadata(done.completedFileId!);
    expect(metadata).toEqual({ byteSize: 700, mimeType: 'application/zip' });
    expect(server.calls.find((call) => call.kind === 'metadata')!.url)
      .toContain('fields=size%2CmimeType');
    expect(server.calls.find((call) => call.kind === 'metadata')!.url)
      .toContain('supportsAllDrives=true');
    const stream = await client.openFileStream(done.completedFileId!);
    expect(stream.byteSize).toBe(700);
    const reader = stream.body.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      chunks.push(value);
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const merged = new Uint8Array(new ArrayBuffer(total));
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    expect(await sha256Hex(merged)).toBe(await sha256Hex(bytes));
    expect(server.calls.find((call) => call.kind === 'media')!.url).toContain('alt=media');
  });

  it('classifies unknown sessions, expired sessions and not-found files', async () => {
    const server = createFakeDriveHttpServer({ accessToken: TOKEN });
    const client = createGoogleDriveArchiveClient(clientConfig(server));
    // Unknown key (e.g. after an isolate restart): null → new session.
    expect(await client.queryUploadSession('drive-upload-session:unknown')).toBeNull();
    // Expired session: 404 → null so the pipeline opens a fresh one.
    const expired = createFakeDriveHttpServer({
      accessToken: TOKEN,
      injections: [{ kind: 'session_query', status: 404 }],
    });
    const expiredClient = createGoogleDriveArchiveClient(clientConfig(expired));
    const bytes = payload(10);
    const session = await expiredClient.createUploadSession({
      fileName: 'b.zip', mimeType: 'application/zip',
      totalByteSize: 10, sha256Hex: await sha256Hex(bytes),
    });
    expect(await expiredClient.queryUploadSession(session.sessionKey)).toBeNull();
    // Chunk PUT against an expired session surfaces session_conflict.
    const expiredChunk = createFakeDriveHttpServer({
      accessToken: TOKEN,
      injections: [{ kind: 'chunk_put', status: 404 }],
    });
    const chunkClient = createGoogleDriveArchiveClient(clientConfig(expiredChunk));
    const chunkSession = await chunkClient.createUploadSession({
      fileName: 'b.zip', mimeType: 'application/zip',
      totalByteSize: 10, sha256Hex: await sha256Hex(bytes),
    });
    await expectDriveError(chunkClient.uploadChunk({
      sessionKey: chunkSession.sessionKey, offset: 0, bytes, isFinal: true,
    }), 'session_conflict');
    await expectDriveError(client.readFileMetadata('missingfile'), 'not_found');
  });

  it('rejects malformed protocol responses without ever leaking secrets', async () => {
    const bytes = payload(10);
    const digest = await sha256Hex(bytes);
    // Missing Location header on session creation.
    const noLocation = createFakeDriveHttpServer({
      accessToken: TOKEN,
      injections: [{ kind: 'session_create', status: 200, bodyText: '{}' }],
    });
    const noLocationClient = createGoogleDriveArchiveClient(clientConfig(noLocation));
    await expectDriveError(noLocationClient.createUploadSession({
      fileName: 'b.zip', mimeType: 'application/zip', totalByteSize: 10, sha256Hex: digest,
    }), 'invalid_response');
    // Malformed completion JSON.
    const badJson = createFakeDriveHttpServer({
      accessToken: TOKEN,
      injections: [{ kind: 'chunk_put', status: 200, bodyText: 'not-json' }],
    });
    const badJsonClient = createGoogleDriveArchiveClient(clientConfig(badJson));
    const badJsonSession = await badJsonClient.createUploadSession({
      fileName: 'b.zip', mimeType: 'application/zip', totalByteSize: 10, sha256Hex: digest,
    });
    await expectDriveError(badJsonClient.uploadChunk({
      sessionKey: badJsonSession.sessionKey, offset: 0, bytes, isFinal: true,
    }), 'invalid_response');
    // Media whose declared length contradicts the metadata.
    const lengthMismatch = createFakeDriveHttpServer({
      accessToken: TOKEN, metadataSizeOverride: 999,
    });
    const mismatchClient = createGoogleDriveArchiveClient(clientConfig(lengthMismatch));
    const mismatchSession = await mismatchClient.createUploadSession({
      fileName: 'b.zip', mimeType: 'application/zip', totalByteSize: 10, sha256Hex: digest,
    });
    const uploaded = await mismatchClient.uploadChunk({
      sessionKey: mismatchSession.sessionKey, offset: 0, bytes, isFinal: true,
    });
    await expectDriveError(mismatchClient.openFileStream(uploaded.completedFileId!), 'invalid_response');
  });

  it('builds no client without complete env config and never throws', () => {
    expect(googleDriveArchiveClientFromEnv({})).toBeNull();
    expect(googleDriveArchiveClientFromEnv({ GOOGLE_DRIVE_FOLDER_ID: 'f' })).toBeNull();
    expect(googleDriveArchiveClientFromEnv({
      GOOGLE_DRIVE_FOLDER_ID: 'f', GOOGLE_DRIVE_CLIENT_ID: 'c',
    })).toBeNull();
    const full = {
      GOOGLE_DRIVE_FOLDER_ID: 'env-folder-1',
      GOOGLE_DRIVE_CLIENT_ID: 'cid',
      GOOGLE_DRIVE_CLIENT_SECRET: 'csecret',
      GOOGLE_DRIVE_REFRESH_TOKEN: 'rtoken',
    };
    expect(googleDriveArchiveClientFromEnv(full)).not.toBeNull();
    // Memoized per fingerprint: the same env reuses the isolate's instance.
    expect(googleDriveArchiveClientFromEnv(full)).toBe(googleDriveArchiveClientFromEnv(full));
    expect(googleDriveArchiveClientFromEnv({ ...full, GOOGLE_DRIVE_FOLDER_ID: 'other' }))
      .not.toBe(googleDriveArchiveClientFromEnv(full));
    // The archive runtime picks the env-built client up; without env config
    // it stays null (the pre-6.5 behavior). An explicitly injected client
    // always wins over env construction.
    expect(archiveRuntime({ ARCHIVE_DRIVE_UPLOAD_ENABLED: 'false' }).client).toBeNull();
    expect(archiveRuntime(full).client).not.toBeNull();
    const injected = createGoogleDriveArchiveClient(clientConfig(createFakeDriveHttpServer({ accessToken: TOKEN })));
    expect(archiveRuntime({ ...full, ARCHIVE_DRIVE_CLIENT: injected }).client).toBe(injected);
  });

  it('keeps every archive capability disabled when runtime switches are absent', () => {
    const full = {
      GOOGLE_DRIVE_FOLDER_ID: 'env-folder-1',
      GOOGLE_DRIVE_CLIENT_ID: 'cid',
      GOOGLE_DRIVE_CLIENT_SECRET: 'csecret',
      GOOGLE_DRIVE_REFRESH_TOKEN: 'rtoken',
    };
    const base = {
      ...full,
      ARCHIVE_SELECTOR_ENABLED: 'false',
      ARCHIVE_DRIVE_UPLOAD_ENABLED: 'false',
      ARCHIVE_HOT_DELETE_ENABLED: 'false',
      ARCHIVE_RESTORE_WORKER_ENABLED: 'false',
    };
    for (const flag of [
      'ARCHIVE_SELECTOR_ENABLED',
      'ARCHIVE_DRIVE_UPLOAD_ENABLED',
      'ARCHIVE_HOT_DELETE_ENABLED',
      'ARCHIVE_RESTORE_WORKER_ENABLED',
    ] as const) {
      const bindings = { ...base };
      delete bindings[flag];
      const runtime = archiveRuntime(bindings);
      expect(runtime).toMatchObject({
        selectorEnabled: false,
        driveUploadEnabled: false,
        hotDeleteEnabled: false,
        restoreWorkerEnabled: false,
      });
    }
  });

  it('refreshes oauth tokens through the token endpoint and caches until expiry', async () => {
    const tokenRequests: { body: string; contentType: string }[] = [];
    let issued = 0;
    const tokenEndpoint: typeof fetch = (async (url: unknown, init?: RequestInit) => {
      if (String(url) !== 'https://oauth2.googleapis.com/token') {
        throw new Error(`unexpected_endpoint:${String(url)}`);
      }
      tokenRequests.push({ body: String(init?.body), contentType: String(new Headers(init?.headers).get('content-type')) });
      issued += 1;
      return new Response(JSON.stringify({ access_token: `token-${issued}`, expires_in: 3600 }), { status: 200 });
    }) as typeof fetch;
    let clock = 1_000_000;
    const provider = createGoogleOAuthRefreshTokenProvider({
      clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtoken',
      fetchImpl: tokenEndpoint, now: () => clock,
    });
    expect(await provider.getAccessToken()).toBe('token-1');
    expect(await provider.getAccessToken()).toBe('token-1');
    clock += 3_600_000; // past the expiry skew window
    expect(await provider.getAccessToken()).toBe('token-2');
    expect(tokenRequests).toHaveLength(2);
    expect(tokenRequests[0]!.contentType).toBe('application/x-www-form-urlencoded');
    for (const field of ['grant_type=refresh_token', 'client_id=cid', 'client_secret=csecret', 'refresh_token=rtoken']) {
      expect(tokenRequests[0]!.body).toContain(field);
    }
    provider.invalidate();
    clock += 1;
    expect(await provider.getAccessToken()).toBe('token-3');
    // Failures are authorization_failed with sanitized details.
    const failing = createGoogleOAuthRefreshTokenProvider({
      clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtoken',
      fetchImpl: (async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })) as typeof fetch,
    });
    await expectDriveError(failing.getAccessToken(), 'authorization_failed');
  });
});
