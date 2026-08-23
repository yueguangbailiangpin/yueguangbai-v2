import type { QueryClient } from '@tanstack/react-query';
import { approvedApiPath } from '../config/runtime-config';
import { FrontendApiError } from '../api/errors';
import { isReviewRuntime } from '../review/runtime';
import {
  withIdentity401Invalidation,
  type RequestIdentity,
} from '../api/identity-request';
import {
  normalizeResponseError,
  parseApiFailureEnvelope,
} from '../api/transport';
import { fileReadLifecyclePrefix } from './file-read-api';

export const MAXIMUM_FILE_READ_BYTES = 25 * 1024 * 1024;
const SUPPORTED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

export type FileReadTransportProgress = Readonly<{
  loadedBytes: number;
  totalBytes: number;
  percent: number;
}>;

export type FileReadTransportResult = Readonly<{
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
  byteSize: number;
}>;

export function consumeIdentityFileReadIntent(input: {
  client: QueryClient;
  identity: RequestIdentity;
  readIntentId: string;
  accessToken: string;
  signal: AbortSignal;
  onProgress: (progress: FileReadTransportProgress) => void;
}): Promise<FileReadTransportResult> {
  return withIdentity401Invalidation(input.identity, input.client, async () => {
    const path = `${fileReadLifecyclePrefix(input.identity)}/file-read-intents/${input.readIntentId}/content`;
    if (!approvedApiPath(path)) {
      throw new FrontendApiError('INVALID_PATH', 0, null, 'CONTRACT');
    }
    if (isReviewRuntime()) {
      const { demoFileBytes } = await import('../review/demo-api');
      const bytes = demoFileBytes();
      input.onProgress(Object.freeze({
        loadedBytes: bytes.byteLength,
        totalBytes: bytes.byteLength,
        percent: 100,
      }));
      return Object.freeze({
        bytes,
        contentType: 'image/png',
        byteSize: bytes.byteLength,
      });
    }
    try {
      const response = await fetch(path, {
        method: 'GET',
        credentials: 'include',
        headers: {
          Accept: 'application/octet-stream',
          'X-File-Read-Token': input.accessToken,
        },
        signal: input.signal,
      });
      if (response.status !== 200) {
        const payload: unknown = await response.json().catch(() => null);
        return parseApiFailureEnvelope(
          payload,
          response.status,
          response.headers.get('Retry-After'),
        );
      }
      const metadata = validateFileReadHeaders(response);
      const bytes = await readValidatedResponseBytes(
        response,
        metadata.byteSize,
        input.signal,
        input.onProgress,
      );
      return Object.freeze({
        bytes,
        contentType: metadata.contentType,
        byteSize: metadata.byteSize,
      });
    } catch (error: unknown) {
      throw normalizeResponseError(error, input.signal);
    }
  });
}

export function validateFileReadHeaders(response: Response): Readonly<{
  contentType: string;
  byteSize: number;
}> {
  if (response.status !== 200) {
    throw new FrontendApiError(
      'MALFORMED_RESPONSE', response.status, null, 'CONTRACT',
    );
  }
  const rawContentType = response.headers.get('Content-Type');
  const contentType = rawContentType?.trim().toLocaleLowerCase('en-US') ?? '';
  if (!SUPPORTED_CONTENT_TYPES.has(contentType)) {
    throw new FrontendApiError(
      'MALFORMED_RESPONSE', response.status, null, 'CONTRACT',
    );
  }
  const rawLength = response.headers.get('Content-Length');
  if (rawLength === null || !/^[1-9][0-9]*$/u.test(rawLength)) {
    throw new FrontendApiError(
      'MALFORMED_RESPONSE', response.status, null, 'CONTRACT',
    );
  }
  const byteSize = Number(rawLength);
  if (!Number.isSafeInteger(byteSize)
    || byteSize < 1
    || byteSize > MAXIMUM_FILE_READ_BYTES) {
    throw new FrontendApiError(
      'MALFORMED_RESPONSE', response.status, null, 'CONTRACT',
    );
  }
  const cacheControl = response.headers.get('Cache-Control') ?? '';
  const cacheDirectives = cacheControl.toLocaleLowerCase('en-US')
    .split(',').map((part) => part.trim());
  if (!cacheDirectives.includes('no-store')
    || response.headers.get('X-Content-Type-Options')
      ?.trim().toLocaleLowerCase('en-US') !== 'nosniff') {
    throw new FrontendApiError(
      'MALFORMED_RESPONSE', response.status, null, 'CONTRACT',
    );
  }
  return Object.freeze({ contentType, byteSize });
}

async function readValidatedResponseBytes(
  response: Response,
  totalBytes: number,
  signal: AbortSignal,
  onProgress: (progress: FileReadTransportProgress) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  if (response.body === null) {
    const fallback = new Uint8Array(await response.arrayBuffer());
    if (fallback.byteLength !== totalBytes) malformedBytes();
    return fallback;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loadedBytes = 0;
  try {
    while (true) {
      if (signal.aborted) {
        throw new DOMException('File read canceled', 'AbortError');
      }
      const result = await reader.read();
      if (result.done) break;
      const chunk = Uint8Array.from(result.value);
      loadedBytes += chunk.byteLength;
      if (loadedBytes > totalBytes) {
        await reader.cancel('content_length_exceeded').catch(() => undefined);
        malformedBytes();
      }
      chunks.push(chunk);
      onProgress(Object.freeze({
        loadedBytes,
        totalBytes,
        percent: Math.min(99, Math.floor((loadedBytes / totalBytes) * 100)),
      }));
    }
  } catch (error: unknown) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (loadedBytes !== totalBytes) malformedBytes();
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function malformedBytes(): never {
  throw new FrontendApiError('MALFORMED_RESPONSE', 200, null, 'CONTRACT');
}
