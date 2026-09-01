/**
 * Local-only fake of the Google Drive v3 HTTP surface used by the production
 * drive-http-client. It emulates the resumable-upload protocol exactly as
 * the API behaves (200+Location session creation, 308+Range partial
 * acceptance, 200/201 completion with a file resource, metadata probes with
 * STRING sizes, alt=media streaming) so tests exercise the real wire format.
 * Nothing here touches the network.
 */

export type FakeDriveRequestKind =
  | 'session_create' | 'chunk_put' | 'session_query' | 'metadata' | 'media';

export interface FakeDriveHttpInjection {
  kind: FakeDriveRequestKind;
  status: number;
  retryAfterSeconds?: number;
  bodyText?: string;
}

export interface FakeDriveHttpServerOptions {
  /** The token the server accepts; anything else gets 401. */
  accessToken: string;
  /** If set, non-final chunk PUTs accept only this many of the sent bytes. */
  partialAcceptBytes?: number;
  /** Status injections, consumed in order per matching request kind. */
  injections?: FakeDriveHttpInjection[];
  /** Corrupts one byte on alt=media read-back (verification drill). */
  corruptMediaByte?: boolean;
  /** Overrides the metadata size report (size/mime mismatch drill). */
  metadataSizeOverride?: number;
}

export interface RecordedDriveCall {
  kind: FakeDriveRequestKind;
  method: string;
  url: string;
  authorization: string | null;
  contentType: string | null;
  contentRange: string | null;
  uploadContentType: string | null;
  uploadContentLength: string | null;
  bodyText: string | null;
  bodyBytes: number;
}

export function createFakeDriveHttpServer(options: FakeDriveHttpServerOptions) {
  const UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files';
  const FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
  const calls: RecordedDriveCall[] = [];
  const files = new Map<string, { bytes: Uint8Array<ArrayBuffer>; mimeType: string }>();
  const injections = [...(options.injections ?? [])];
  const sessionUploadId = `SECRET-UPLOAD-ID-${Math.random().toString(36).slice(2)}`;
  const sessionUrl = `${UPLOAD_ENDPOINT}?uploadType=resumable&upload_id=${sessionUploadId}`;
  const state = {
    sessionTotalBytes: 0,
    sessionAccepted: 0,
    sessionBuffer: new Uint8Array(new ArrayBuffer(0)),
    completedFileId: null as string | null,
    createdFileCount: 0,
    chunkPutCount: 0,
  };

  function respond(status: number, body: BodyInit | null, headers: Record<string, string> = {}): Response {
    return new Response(body, { status, headers });
  }

  async function fetchImpl(url: string | URL | Request, init?: RequestInit): Promise<Response> {
    const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    let bodyText: string | null = null;
    let bodyBytes: Uint8Array = new Uint8Array(new ArrayBuffer(0));
    if (typeof init?.body === 'string') bodyText = init.body;
    else if (init?.body instanceof Uint8Array) bodyBytes = init.body as Uint8Array<ArrayBuffer>;

    // Chunk PUTs and status-query PUTs share the session URL; the
    // Content-Range header distinguishes them.
    let kind: FakeDriveRequestKind;
    if (target.startsWith(`${UPLOAD_ENDPOINT}?`) && method === 'POST') kind = 'session_create';
    else if (target.startsWith(`${UPLOAD_ENDPOINT}?`) && method === 'PUT') {
      kind = /^bytes \*\//u.test(headers.get('content-range') ?? '') ? 'session_query' : 'chunk_put';
    } else if (target.startsWith(FILES_ENDPOINT) && target.includes('alt=media')) kind = 'media';
    else kind = 'metadata';
    calls.push({
      kind,
      method,
      url: target,
      authorization: headers.get('authorization'),
      contentType: headers.get('content-type'),
      contentRange: headers.get('content-range'),
      uploadContentType: headers.get('x-upload-content-type'),
      uploadContentLength: headers.get('x-upload-content-length'),
      bodyText,
      bodyBytes: bodyBytes.byteLength,
    });

    const injection = injections[0];
    if (injection && injection.kind === kind) {
      injections.shift();
      const headers2: Record<string, string> = {};
      if (injection.retryAfterSeconds !== undefined) headers2['Retry-After'] = String(injection.retryAfterSeconds);
      return respond(injection.status, injection.bodyText ?? null, headers2);
    }

    if (headers.get('authorization') !== `Bearer ${options.accessToken}`) {
      return respond(401, JSON.stringify({ error: 'invalid_grant' }));
    }

    if (kind === 'session_create') {
      const metadata = JSON.parse(bodyText ?? '{}') as { name?: string; parents?: string[] };
      if (typeof metadata.name !== 'string' || !Array.isArray(metadata.parents)) {
        return respond(400, JSON.stringify({ error: 'badRequest' }));
      }
      state.sessionTotalBytes = Number(headers.get('x-upload-content-length') ?? '0');
      state.sessionAccepted = 0;
      state.sessionBuffer = new Uint8Array(new ArrayBuffer(state.sessionTotalBytes));
      state.completedFileId = null;
      return respond(200, null, { Location: sessionUrl });
    }

    if (kind === 'chunk_put' || kind === 'session_query') {
      const range = headers.get('content-range') ?? '';
      const totalMatch = /\/(\d+)$/u.exec(range);
      const total = totalMatch ? Number(totalMatch[1]) : state.sessionTotalBytes;
      if (/^bytes \*\/\d+$/u.test(range)) {
        // Status query: empty PUT.
        if (state.completedFileId) {
          return respond(200, JSON.stringify({
            id: state.completedFileId, size: String(total), mimeType: 'application/zip',
          }));
        }
        if (state.sessionAccepted === 0) return respond(308, null, {});
        return respond(308, null, { Range: `bytes=0-${state.sessionAccepted - 1}` });
      }
      const chunkMatch = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(range);
      if (!chunkMatch) return respond(400, JSON.stringify({ error: 'badRequest' }));
      const offset = Number(chunkMatch[1]);
      const sent = Number(chunkMatch[2]) - offset + 1;
      if (offset !== state.sessionAccepted) {
        return respond(308, null, { Range: `bytes=0-${state.sessionAccepted - 1}` });
      }
      // partialAcceptBytes simulates ONE mid-chunk interruption (the first
      // chunk PUT of the session); later chunks are accepted in full.
      state.chunkPutCount += 1;
      const accept = options.partialAcceptBytes !== undefined && state.chunkPutCount === 1
        && sent > options.partialAcceptBytes
        ? options.partialAcceptBytes
        : sent;
      state.sessionBuffer.set(bodyBytes.slice(0, accept), offset);
      state.sessionAccepted += accept;
      if (state.sessionAccepted >= total) {
        const fileId = `fakeapi-file-${state.createdFileCount + 1}`;
        files.set(fileId, { bytes: state.sessionBuffer.slice(), mimeType: 'application/zip' });
        state.completedFileId = fileId;
        state.createdFileCount += 1;
        return respond(200, JSON.stringify({
          id: fileId, size: String(total), mimeType: 'application/zip',
        }));
      }
      return respond(308, null, { Range: `bytes=0-${state.sessionAccepted - 1}` });
    }

    if (kind === 'metadata') {
      const fileId = target.slice(FILES_ENDPOINT.length + 1).split('?')[0]!;
      const file = files.get(fileId);
      if (!file) return respond(404, JSON.stringify({ error: 'notFound' }));
      const size = options.metadataSizeOverride ?? file.bytes.byteLength;
      return respond(200, JSON.stringify({ id: fileId, size: String(size), mimeType: file.mimeType }));
    }

    // alt=media streaming read-back.
    const fileId = target.slice(FILES_ENDPOINT.length + 1).split('?')[0]!;
    const file = files.get(fileId);
    if (!file) return respond(404, JSON.stringify({ error: 'notFound' }));
    let bytes: Uint8Array<ArrayBuffer> = file.bytes;
    if (options.corruptMediaByte && bytes.byteLength > 0) {
      bytes = file.bytes.slice();
      bytes[bytes.byteLength - 1] = (bytes[bytes.byteLength - 1]! + 1) % 256;
    }
    return respond(200, bytes, {
      'Content-Type': file.mimeType,
      'Content-Length': String(bytes.byteLength),
    });
  }

  return {
    fetch: fetchImpl as unknown as typeof fetch,
    calls,
    files,
    state,
    sessionUploadId,
    uploadedBytes(fileId: string): Uint8Array | null {
      return files.get(fileId)?.bytes ?? null;
    },
    callCount(kind?: FakeDriveRequestKind): number {
      return kind ? calls.filter((call) => call.kind === kind).length : calls.length;
    },
  };
}
