import {
  DriveArchiveClientError,
  type DriveArchiveClient,
  type DriveArchiveFailureCategory,
  type DriveUploadSessionState,
} from '@ygb/contracts';

/**
 * Production Google Drive HTTP adapter for the D-055 DriveArchiveClient port
 * (stage 6.5). Implements the official Drive v3 resumable-upload protocol:
 *
 *   1. POST  /upload/drive/v3/files?uploadType=resumable  (+metadata JSON,
 *      X-Upload-Content-Type/-Length) → 200 + `Location` session URI.
 *   2. PUT   <session URI> with `Content-Range: bytes start-end/total`
 *      chunks that are multiples of 256 KiB except the final one.
 *      308 Resume Incomplete → the `Range: bytes=0-N` header reports the
 *      accepted prefix (next byte = N+1; no header = zero bytes).
 *   3. PUT   <session URI> with the star-total status range and an empty
 *      body queries status; 404 means the session expired (about one week).
 *   4. GET   /drive/v3/files/<id>?supportsAllDrives=true&fields=size,mimeType
 *      reads metadata; `alt=media` streams the bytes back.
 *
 * Security contract (mirrors the port's doc): tokens, session URIs (they
 * embed the upload_id bearer) and Drive file ids NEVER reach error messages,
 * logs, D1 columns other than the designed drive_file_id/drive_folder_id, or
 * any client response. The session URI lives only in this isolate's memory;
 * after a cold restart queryUploadSession returns null and the pipeline opens
 * a fresh session (the temp R2 ZIP is immutable, so nothing is lost). No
 * permissions call exists — archived files are never shared publicly — and
 * no delete call exists — Drive copies are permanent.
 *
 * The adapter performs zero HTTP requests unless the pipeline invokes it, and
 * the pipeline only does so behind ARCHIVE_DRIVE_UPLOAD_ENABLED + the D1
 * archive_runtime_controls gate (both default OFF).
 */

const DRIVE_UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
const OAUTH_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

const DRIVE_FILE_ID_PATTERN = /^[\w-]{1,128}$/u;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

/** Whitelisted detail vocabulary — status codes and closed reason tokens. */
function fail(category: DriveArchiveFailureCategory, detail: string): never {
  throw new DriveArchiveClientError(category, detail);
}

// ---------------------------------------------------------------------------
// Access-token providers (abstraction + OAuth refresh implementation)
// ---------------------------------------------------------------------------

export interface DriveAccessTokenProvider {
  /** Returns a valid bearer token, refreshing when the cached one expired. */
  getAccessToken(): Promise<string>;
  /** Drops the cached token after a 401 so the next call re-authenticates. */
  invalidate(): void;
}

/** Deterministic provider for tests and controlled manual operation only. */
export function createStaticAccessTokenProvider(token: string): DriveAccessTokenProvider {
  return {
    async getAccessToken() {
      if (typeof token !== 'string' || token.length === 0) {
        fail('authorization_failed', 'empty_static_token');
      }
      return token;
    },
    invalidate() { /* a static token cannot be refreshed */ },
  };
}

export interface GoogleOAuthRefreshTokenProviderConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  requestTimeoutMs?: number;
}

/**
 * OAuth 2.0 refresh-token provider (grant_type=refresh_token against the
 * Google token endpoint). Caches the access token until 60 s before its
 * expiry. Client secrets and tokens are never logged or thrown; failures are
 * categorized as authorization_failed with a closed detail vocabulary.
 */
export function createGoogleOAuthRefreshTokenProvider(
  config: GoogleOAuthRefreshTokenProviderConfig,
): DriveAccessTokenProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? Date.now;
  const requestTimeoutMs = config.requestTimeoutMs ?? 30_000;
  let cache: { token: string; expiresAtMs: number } | null = null;
  return {
    invalidate() {
      cache = null;
    },
    async getAccessToken() {
      if (cache && cache.expiresAtMs > now() + 60_000) return cache.token;
      const form = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
      });
      let response: Response;
      try {
        response = await fetchImpl(OAUTH_TOKEN_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
          redirect: 'error',
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
      } catch {
        // Network/timeout during refresh is surfaced as authorization
        // failure: fail closed rather than retry-storming the token endpoint.
        fail('authorization_failed', 'token_refresh_unreachable');
      }
      if (!response.ok) fail('authorization_failed', `status=${response.status}`);
      let parsed: { access_token?: unknown; expires_in?: unknown };
      try {
        parsed = await response.json() as { access_token?: unknown; expires_in?: unknown };
      } catch {
        fail('authorization_failed', 'token_refresh_malformed_json');
      }
      if (typeof parsed.access_token !== 'string' || parsed.access_token.length === 0) {
        fail('authorization_failed', 'token_refresh_missing_access_token');
      }
      const expiresIn = typeof parsed.expires_in === 'number' ? parsed.expires_in : 3_600;
      cache = {
        token: parsed.access_token,
        expiresAtMs: now() + Math.max(60, expiresIn) * 1000,
      };
      return cache.token;
    },
  };
}

// ---------------------------------------------------------------------------
// Client configuration and env wiring
// ---------------------------------------------------------------------------

export interface GoogleDriveArchiveClientConfig {
  /** Target folder id — a regular My Drive folder or a Shared Drive folder. */
  folderId: string;
  /** Optional Shared Drive id; adds the driveId parameter to calls. */
  sharedDriveId?: string;
  tokenProvider: DriveAccessTokenProvider;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  /** Retries per call for 429/5xx/network failures. */
  maxRetriesPerCall?: number;
  retryBaseDelayMs?: number;
  /** Injectable for deterministic backoff assertions in tests. */
  sleep?: (milliseconds: number) => Promise<void>;
}

export type GoogleDriveEnvBindings = {
  GOOGLE_DRIVE_FOLDER_ID?: string;
  GOOGLE_DRIVE_SHARED_DRIVE_ID?: string;
  GOOGLE_DRIVE_CLIENT_ID?: string;
  GOOGLE_DRIVE_CLIENT_SECRET?: string;
  GOOGLE_DRIVE_REFRESH_TOKEN?: string;
  GOOGLE_DRIVE_ACCESS_TOKEN?: string;
};

let envMemo: { fingerprint: string; client: DriveArchiveClient | null } | null = null;

/**
 * Builds the Drive client from worker env vars, or null when the Drive
 * configuration is absent/incomplete (the historical "no adapter" state).
 * Never throws — a malformed Drive config must not break worker boot.
 * Memoized per config fingerprint so one isolate reuses its session registry.
 * The production path is the OAuth refresh-token triple as wrangler-managed
 * SECRETS; GOOGLE_DRIVE_ACCESS_TOKEN exists for controlled manual operation
 * and tests only.
 */
export function googleDriveArchiveClientFromEnv(
  env: GoogleDriveEnvBindings,
): DriveArchiveClient | null {
  const folderId = env.GOOGLE_DRIVE_FOLDER_ID ?? '';
  const sharedDriveId = env.GOOGLE_DRIVE_SHARED_DRIVE_ID ?? '';
  const clientId = env.GOOGLE_DRIVE_CLIENT_ID ?? '';
  const clientSecret = env.GOOGLE_DRIVE_CLIENT_SECRET ?? '';
  const refreshToken = env.GOOGLE_DRIVE_REFRESH_TOKEN ?? '';
  const accessToken = env.GOOGLE_DRIVE_ACCESS_TOKEN ?? '';
  const fingerprint = [folderId, sharedDriveId, clientId, clientSecret, refreshToken, accessToken].join('\u0000');
  if (envMemo && envMemo.fingerprint === fingerprint) return envMemo.client;
  let client: DriveArchiveClient | null = null;
  if (folderId !== '') {
    const sharedDrive = sharedDriveId === '' ? {} : { sharedDriveId };
    if (clientId !== '' && clientSecret !== '' && refreshToken !== '') {
      client = createGoogleDriveArchiveClient({
        folderId,
        ...sharedDrive,
        tokenProvider: createGoogleOAuthRefreshTokenProvider({ clientId, clientSecret, refreshToken }),
      });
    } else if (accessToken !== '') {
      client = createGoogleDriveArchiveClient({
        folderId,
        ...sharedDrive,
        tokenProvider: createStaticAccessTokenProvider(accessToken),
      });
    }
  }
  envMemo = { fingerprint, client };
  return client;
}

// ---------------------------------------------------------------------------
// The HTTP client
// ---------------------------------------------------------------------------

interface ResumableSession {
  /**
   * Drive's resumable session URI. SECRET: it embeds the upload_id bearer —
   * it is kept in isolate memory only, never in D1, logs or thrown errors.
   */
  sessionUrl: string;
  folderKey: string;
  fileName: string;
  totalByteSize: number;
  sha256Hex: string;
}

interface DriveHttpResponse {
  status: number;
  headers: Headers;
  json: () => Promise<unknown>;
  body: ReadableStream<Uint8Array> | null;
}

export function createGoogleDriveArchiveClient(
  config: GoogleDriveArchiveClientConfig,
): DriveArchiveClient {
  const fetchImpl = config.fetchImpl ?? fetch;
  const requestTimeoutMs = config.requestTimeoutMs ?? 60_000;
  const maxRetries = config.maxRetriesPerCall ?? 3;
  const retryBaseDelayMs = config.retryBaseDelayMs ?? 500;
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const sessions = new Map<string, ResumableSession>();
  const folderKey = config.folderId;

  if (typeof config.folderId !== 'string' || config.folderId.length === 0
    || config.folderId.length > 256 || !DRIVE_FILE_ID_PATTERN.test(config.folderId)) {
    throw new DriveArchiveClientError('invalid_response', 'invalid_folder_id');
  }

  function fileUrl(fileId: string, params: Record<string, string>): string {
    const query = new URLSearchParams({ supportsAllDrives: 'true', ...params });
    if (config.sharedDriveId) query.set('driveId', config.sharedDriveId);
    return `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}?${query.toString()}`;
  }

  async function backoffDelay(attempt: number, retryAfterSeconds: number | null): Promise<number> {
    const exponential = retryBaseDelayMs * 2 ** attempt;
    if (retryAfterSeconds === null) return exponential;
    const honored = retryAfterSeconds * 1000;
    return Math.max(exponential, Math.min(honored, 120_000));
  }

  /**
   * One authorized Drive request with the failure contract: 429/5xx/network
   * retry with exponential backoff (honoring Retry-After up to 120 s), 401
   * refreshes the token once then fails closed, 403 always fails closed, and
   * every other status returns to the caller for protocol-specific parsing.
   */
  async function request(input: {
    method: 'GET' | 'POST' | 'PUT';
    url: string;
    headers: Record<string, string>;
    body?: Uint8Array<ArrayBuffer> | string;
  }): Promise<DriveHttpResponse> {
    let tokenRefreshed = false;
    for (let attempt = 0; ; attempt += 1) {
      const token = await config.tokenProvider.getAccessToken();
      const requestInit: RequestInit = {
        method: input.method,
        headers: { ...input.headers, Authorization: `Bearer ${token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(requestTimeoutMs),
      };
      if (input.body !== undefined) requestInit.body = input.body;
      let response: Response;
      try {
        response = await fetchImpl(input.url, requestInit);
      } catch {
        if (attempt < maxRetries) {
          await sleep(await backoffDelay(attempt, null));
          continue;
        }
        fail('interrupted', 'network_or_timeout');
      }
      if (response.status === 401 && !tokenRefreshed) {
        tokenRefreshed = true;
        config.tokenProvider.invalidate();
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        fail('authorization_failed', `status=${response.status}`);
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt < maxRetries) {
          const retryAfter = Number(response.headers.get('retry-after'));
          await sleep(await backoffDelay(attempt, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null));
          continue;
        }
        fail(response.status === 429 ? 'rate_limited' : 'service_unavailable', `status=${response.status}`);
      }
      return {
        status: response.status,
        headers: response.headers,
        json: () => response.json(),
        body: response.body as ReadableStream<Uint8Array> | null,
      };
    }
  }

  function requireSession(sessionKey: string): ResumableSession | null {
    return sessions.get(sessionKey) ?? null;
  }

  function parseAcceptedBytes(rangeHeader: string | null): number {
    if (rangeHeader === null) return 0;
    const match = /^bytes=0-(\d+)$/u.exec(rangeHeader);
    if (!match) fail('invalid_response', 'invalid_range_header');
    const accepted = Number(match[1]) + 1;
    if (!Number.isSafeInteger(accepted) || accepted < 0) fail('invalid_response', 'invalid_range_header');
    return accepted;
  }

  async function parseCompletion(response: DriveHttpResponse): Promise<{ fileId: string }> {
    let parsed: { id?: unknown };
    try {
      parsed = await response.json() as { id?: unknown };
    } catch {
      fail('invalid_response', 'malformed_completion_json');
    }
    if (typeof parsed.id !== 'string' || parsed.id.length === 0 || !DRIVE_FILE_ID_PATTERN.test(parsed.id)) {
      fail('invalid_response', 'invalid_completion_file_id');
    }
    return { fileId: parsed.id };
  }

  return {
    async createUploadSession(input): Promise<DriveUploadSessionState> {
      if (typeof input.fileName !== 'string' || input.fileName.length === 0
        || input.fileName.length > 256 || input.mimeType !== 'application/zip'
        || !Number.isSafeInteger(input.totalByteSize) || input.totalByteSize < 0
        || !SHA256_HEX_PATTERN.test(input.sha256Hex)) {
        fail('invalid_response', 'invalid_session_input');
      }
      const query = new URLSearchParams({ uploadType: 'resumable', supportsAllDrives: 'true' });
      if (config.sharedDriveId) query.set('driveId', config.sharedDriveId);
      const response = await request({
        method: 'POST',
        url: `${DRIVE_UPLOAD_ENDPOINT}?${query.toString()}`,
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'application/zip',
          'X-Upload-Content-Length': String(input.totalByteSize),
        },
        body: JSON.stringify({ name: input.fileName, mimeType: 'application/zip', parents: [folderKey] }),
      });
      if (response.status !== 200) fail('invalid_response', `status=${response.status}`);
      const location = response.headers.get('location');
      if (location === null || !location.startsWith('https://')) {
        fail('invalid_response', 'missing_location_header');
      }
      const sessionKey = `drive-upload-session:${crypto.randomUUID()}`;
      sessions.set(sessionKey, {
        sessionUrl: location,
        folderKey,
        fileName: input.fileName,
        totalByteSize: input.totalByteSize,
        sha256Hex: input.sha256Hex,
      });
      return { sessionKey, folderKey, acceptedByteSize: 0, completedFileId: null };
    },

    async uploadChunk(input): Promise<{ acceptedByteSize: number; completedFileId: string | null }> {
      const session = requireSession(input.sessionKey);
      if (!session) fail('session_conflict', 'unknown_session');
      if (!Number.isSafeInteger(input.offset) || input.offset < 0
        || input.offset + input.bytes.byteLength > session.totalByteSize) {
        fail('session_conflict', 'chunk_out_of_range');
      }
      const response = await request({
        method: 'PUT',
        url: session.sessionUrl,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Range': input.bytes.byteLength === 0
            ? `bytes */${session.totalByteSize}`
            : `bytes ${input.offset}-${input.offset + input.bytes.byteLength - 1}/${session.totalByteSize}`,
        },
        body: input.bytes,
      });
      if (response.status === 308) {
        return { acceptedByteSize: parseAcceptedBytes(response.headers.get('range')), completedFileId: null };
      }
      if (response.status === 200 || response.status === 201) {
        const { fileId } = await parseCompletion(response);
        return { acceptedByteSize: session.totalByteSize, completedFileId: fileId };
      }
      if (response.status === 404) fail('session_conflict', 'status=404');
      fail('invalid_response', `status=${response.status}`);
    },

    async queryUploadSession(sessionKey): Promise<DriveUploadSessionState | null> {
      const session = requireSession(sessionKey);
      if (!session) return null;
      const response = await request({
        method: 'PUT',
        url: session.sessionUrl,
        headers: { 'Content-Range': `bytes */${session.totalByteSize}` },
        body: new Uint8Array(new ArrayBuffer(0)),
      });
      if (response.status === 404) return null;
      if (response.status === 308) {
        return {
          sessionKey,
          folderKey: session.folderKey,
          acceptedByteSize: parseAcceptedBytes(response.headers.get('range')),
          completedFileId: null,
        };
      }
      if (response.status === 200 || response.status === 201) {
        const { fileId } = await parseCompletion(response);
        return {
          sessionKey,
          folderKey: session.folderKey,
          acceptedByteSize: session.totalByteSize,
          completedFileId: fileId,
        };
      }
      fail('invalid_response', `status=${response.status}`);
    },

    async readFileMetadata(fileId): Promise<{ byteSize: number; mimeType: string }> {
      if (typeof fileId !== 'string' || !DRIVE_FILE_ID_PATTERN.test(fileId)) {
        fail('invalid_response', 'invalid_file_id');
      }
      const response = await request({
        method: 'GET',
        url: fileUrl(fileId, { fields: 'size,mimeType' }),
        headers: {},
      });
      if (response.status === 404) fail('not_found', 'status=404');
      if (response.status !== 200) fail('invalid_response', `status=${response.status}`);
      let parsed: { size?: unknown; mimeType?: unknown };
      try {
        parsed = await response.json() as { size?: unknown; mimeType?: unknown };
      } catch {
        fail('invalid_response', 'malformed_metadata_json');
      }
      const byteSize = Number(parsed.size);
      if (!Number.isSafeInteger(byteSize) || byteSize < 0) fail('invalid_response', 'invalid_metadata_size');
      if (typeof parsed.mimeType !== 'string' || parsed.mimeType.length === 0) {
        fail('invalid_response', 'invalid_metadata_mime');
      }
      return { byteSize, mimeType: parsed.mimeType };
    },

    async openFileStream(fileId): Promise<{
      byteSize: number;
      mimeType: string;
      body: ReadableStream<Uint8Array>;
    }> {
      const metadata = await this.readFileMetadata(fileId);
      const response = await request({
        method: 'GET',
        url: fileUrl(fileId, { alt: 'media' }),
        headers: {},
      });
      if (response.status === 404) fail('not_found', 'status=404');
      if (response.status !== 200) fail('invalid_response', `status=${response.status}`);
      if (!response.body) fail('invalid_response', 'empty_media_body');
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength !== metadata.byteSize) {
        await response.body.cancel().catch(() => undefined);
        fail('invalid_response', 'media_length_mismatch');
      }
      return { byteSize: metadata.byteSize, mimeType: metadata.mimeType, body: response.body };
    },
  };
}
