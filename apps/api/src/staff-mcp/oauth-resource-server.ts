import type {
  StaffMcpOAuthVerifier,
  StaffMcpVerifiedSession,
} from '@ygb/contracts';
import { STAFF_MCP_REQUIRED_OAUTH_SCOPE } from '@ygb/contracts';
import {
  keyedHash,
  type StaffMcpIdentityStore,
} from './security-state';

const MAX_DOCUMENT_BYTES = 256 * 1024;
const MAX_JWT_BYTES = 16 * 1024;
const CLOCK_SKEW_MS = 60_000;
const MAX_TOKEN_LIFETIME_MS = 60 * 60 * 1000;
const MAX_TOKEN_STATUS_BYTES = 8 * 1024;
const TOKEN_STATUS_URL = 'https://staff-mcp-token-status.internal/v1/status';

export interface StaffMcpOAuthConfig {
  resource: string;
  audience: string;
  resourceDocumentationUrl: string;
  resourcePolicyUrl: string;
  issuer: string;
  metadataUrl: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  revocationEndpoint: string;
}

export interface StaffMcpOAuthDocumentProvider {
  loadAuthorizationServerMetadata(forceRefresh: boolean): Promise<unknown>;
  loadJwks(forceRefresh: boolean): Promise<unknown>;
}

export interface StaffMcpTokenStatusProvider {
  isActive(input: {
    issuer: string;
    subject: string;
    jti: string;
    clientId: string;
    issuedAt: number;
    expiresAt: number;
    now: number;
  }): Promise<boolean>;
}

export interface StaffMcpTokenStatusServiceBinding {
  fetch(request: Request): Promise<Response>;
}

export class ServiceBindingStaffMcpTokenStatusProvider
implements StaffMcpTokenStatusProvider {
  constructor(
    private readonly binding: StaffMcpTokenStatusServiceBinding,
    private readonly hashSecret: string,
    private readonly timeoutMs = 3_000,
  ) {
    if (hashSecret.length < 32 || !Number.isSafeInteger(timeoutMs)
      || timeoutMs < 50 || timeoutMs > 10_000) {
      throw new Error('staff_mcp_token_status_config_invalid');
    }
  }

  async isActive(input: Parameters<StaffMcpTokenStatusProvider['isActive']>[0]) {
    const [issuerHash, subjectHash, jtiHash, clientIdHash] = await Promise.all([
      keyedHash(this.hashSecret, 'issuer', input.issuer),
      keyedHash(this.hashSecret, 'subject', `${input.issuer}\u0000${input.subject}`),
      keyedHash(this.hashSecret, 'jti', `${input.issuer}\u0000${input.jti}`),
      keyedHash(this.hashSecret, 'client', `${input.issuer}\u0000${input.clientId}`),
    ]);
    const controller = new AbortController();
    const response = await withTimeout(this.binding.fetch(new Request(
      TOKEN_STATUS_URL,
      {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          issuer_hash: issuerHash,
          subject_hash: subjectHash,
          jti_hash: jtiHash,
          client_id_hash: clientIdHash,
          issued_at: input.issuedAt,
          expires_at: input.expiresAt,
          checked_at: input.now,
        }),
      },
    )), this.timeoutMs, controller);
    if (response.status !== 200 || response.redirected
      || !/^application\/json(?:\s*;|$)/iu.test(
        response.headers.get('Content-Type') ?? '',
      )) throw new Error('staff_mcp_token_status_unavailable');
    const declaredLength = response.headers.get('Content-Length');
    if (declaredLength && (!/^\d{1,8}$/u.test(declaredLength)
      || Number(declaredLength) > MAX_TOKEN_STATUS_BYTES)) {
      throw new Error('staff_mcp_token_status_invalid');
    }
    const body = await readBoundedText(response, MAX_TOKEN_STATUS_BYTES);
    if (hasDuplicateObjectKeys(body)) throw new Error('staff_mcp_token_status_invalid');
    const value: unknown = JSON.parse(body);
    if (!plainObject(value)
      || Object.keys(value).length !== 4
      || value['active'] !== true
      || value['jti_hash'] !== jtiHash
      || value['expires_at'] !== input.expiresAt
      || value['checked_at'] !== input.now) return false;
    return true;
  }
}

export class FetchStaffMcpOAuthDocumentProvider
implements StaffMcpOAuthDocumentProvider {
  constructor(
    private readonly config: StaffMcpOAuthConfig,
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 5_000,
  ) {}

  loadAuthorizationServerMetadata(forceRefresh: boolean): Promise<unknown> {
    return this.load(this.config.metadataUrl, forceRefresh);
  }

  loadJwks(forceRefresh: boolean): Promise<unknown> {
    return this.load(this.config.jwksUri, forceRefresh);
  }

  private async load(url: string, forceRefresh: boolean): Promise<unknown> {
    const response = await this.fetcher(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        Accept: 'application/json',
        'Cache-Control': forceRefresh ? 'no-cache' : 'max-age=60',
      },
    });
    if (response.status !== 200
      || !/^application\/(?:json|jwk-set\+json)(?:\s*;|$)/iu.test(
        response.headers.get('Content-Type') ?? '',
      )) {
      throw new Error('staff_mcp_oauth_document_unavailable');
    }
    const declaredLength = response.headers.get('Content-Length');
    if (declaredLength && (!/^\d{1,10}$/u.test(declaredLength)
      || Number(declaredLength) > MAX_DOCUMENT_BYTES)) {
      throw new Error('staff_mcp_oauth_document_invalid');
    }
    const body = await readBoundedText(response, MAX_DOCUMENT_BYTES);
    if (hasDuplicateObjectKeys(body)) {
      throw new Error('staff_mcp_oauth_document_invalid');
    }
    return JSON.parse(body) as unknown;
  }
}

export class ProductionStaffMcpOAuthVerifier implements StaffMcpOAuthVerifier {
  constructor(
    private readonly config: StaffMcpOAuthConfig,
    private readonly documents: StaffMcpOAuthDocumentProvider,
    private readonly identities: StaffMcpIdentityStore,
    private readonly tokenStatus: StaffMcpTokenStatusProvider,
  ) {
    assertStaffMcpOAuthConfig(config);
  }

  async verifyAccessToken(
    accessToken: string,
    now: number,
  ): Promise<StaffMcpVerifiedSession | null> {
    if (!Number.isSafeInteger(now) || now < 0) return null;
    const token = parseJwt(accessToken);
    if (!token) return null;
    const metadata = await this.documents.loadAuthorizationServerMetadata(false);
    if (!validAuthorizationServerMetadata(metadata, this.config)) return null;

    let key = selectSigningKey(await this.documents.loadJwks(false), token.header.kid);
    if (key === 'MISSING') {
      key = selectSigningKey(await this.documents.loadJwks(true), token.header.kid);
    }
    if (key === 'MISSING' || key === 'AMBIGUOUS') return null;
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      key,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      token.signature.buffer.slice(
        token.signature.byteOffset,
        token.signature.byteOffset + token.signature.byteLength,
      ) as ArrayBuffer,
      new TextEncoder().encode(token.signingInput),
    );
    if (!verified) return null;

    const claims = validateClaims(token.payload, this.config, now);
    if (!claims) return null;
    if (!await this.tokenStatus.isActive({
      issuer: claims.issuer,
      subject: claims.subject,
      jti: claims.jti,
      clientId: claims.clientId,
      issuedAt: claims.issuedAt,
      expiresAt: claims.expiresAt,
      now,
    })) return null;
    const staffId = await this.identities.resolveActiveStaff({
      issuer: claims.issuer,
      subject: claims.subject,
      jti: claims.jti,
      tokenExpiresAt: claims.expiresAt,
      now,
    });
    if (!staffId) return null;
    const [clientHash, sessionHash] = await Promise.all([
      sha256Hex(`${claims.issuer}\u0000${claims.clientId}`),
      sha256Hex(`${claims.issuer}\u0000${claims.sessionId}`),
    ]);
    return Object.freeze({
      clientId: `client-${clientHash.slice(0, 32)}`,
      sessionId: `session-${sessionHash.slice(0, 32)}`,
      staffId,
      expiresAt: claims.expiresAt,
      scopes: Object.freeze(claims.scopes),
    });
  }
}

export function protectedResourceMetadata(config: StaffMcpOAuthConfig) {
  assertStaffMcpOAuthConfig(config);
  return Object.freeze({
    resource: config.resource,
    authorization_servers: Object.freeze([config.issuer]),
    scopes_supported: Object.freeze([STAFF_MCP_REQUIRED_OAUTH_SCOPE]),
    bearer_methods_supported: Object.freeze(['header']),
    resource_name: 'Yueguangbai Staff MCP',
    resource_documentation: config.resourceDocumentationUrl,
    resource_policy_uri: config.resourcePolicyUrl,
  });
}

export function assertStaffMcpOAuthConfig(
  config: StaffMcpOAuthConfig,
): void {
  if (!exactHttpsUrl(config.resource, true)
    || new URL(config.resource).pathname !== '/mcp'
    || !exactHttpsUrl(config.audience, true)
    || config.audience !== config.resource
    || !validPublicResourceUrl(config.resourceDocumentationUrl, config.resource)
    || !validPublicResourceUrl(config.resourcePolicyUrl, config.resource)
    || config.resourceDocumentationUrl === config.resourcePolicyUrl
    || !exactHttpsUrl(config.issuer, false)
    || !exactHttpsUrl(config.metadataUrl, true)
    || !exactHttpsUrl(config.authorizationEndpoint, true)
    || !exactHttpsUrl(config.tokenEndpoint, true)
    || !exactHttpsUrl(config.jwksUri, true)
    || !exactHttpsUrl(config.revocationEndpoint, true)) {
    throw new Error('staff_mcp_oauth_config_invalid');
  }
}

function validPublicResourceUrl(value: string, resource: string): boolean {
  if (!exactHttpsUrl(value, true)) return false;
  const candidate = new URL(value);
  const resourceUrl = new URL(resource);
  return candidate.origin === resourceUrl.origin
    && candidate.pathname !== '/'
    && candidate.pathname !== '/mcp'
    && candidate.pathname !== '/.well-known/oauth-protected-resource/mcp';
}

function validAuthorizationServerMetadata(
  value: unknown,
  config: StaffMcpOAuthConfig,
): boolean {
  if (!plainObject(value)) return false;
  return value['issuer'] === config.issuer
    && value['authorization_endpoint'] === config.authorizationEndpoint
    && value['token_endpoint'] === config.tokenEndpoint
    && value['jwks_uri'] === config.jwksUri
    && value['revocation_endpoint'] === config.revocationEndpoint
    && stringArrayIncludes(value['grant_types_supported'], 'authorization_code')
    && stringArrayIncludes(value['response_types_supported'], 'code')
    && stringArrayIncludes(value['code_challenge_methods_supported'], 'S256')
    && !stringArrayIncludes(value['code_challenge_methods_supported'], 'plain');
}

type SelectedKey = JsonWebKey | 'MISSING' | 'AMBIGUOUS';

function selectSigningKey(value: unknown, kid: string): SelectedKey {
  if (!plainObject(value) || !Array.isArray(value['keys'])
    || value['keys'].length > 20) return 'AMBIGUOUS';
  const matches = value['keys'].filter((candidate): candidate is JsonWebKey => {
    if (!plainObject(candidate)) return false;
    return candidate['kid'] === kid
      && candidate['kty'] === 'RSA'
      && candidate['alg'] === 'RS256'
      && candidate['use'] === 'sig'
      && typeof candidate['n'] === 'string'
      && typeof candidate['e'] === 'string'
      && /^[A-Za-z0-9_-]{64,2048}$/u.test(candidate['n'])
      && /^[A-Za-z0-9_-]{2,16}$/u.test(candidate['e'])
      && (candidate['key_ops'] === undefined
        || exactStringSet(candidate['key_ops'], ['verify']))
      && candidate['d'] === undefined
      && candidate['p'] === undefined
      && candidate['q'] === undefined;
  });
  if (matches.length === 0) return 'MISSING';
  if (matches.length !== 1) return 'AMBIGUOUS';
  return matches[0]!;
}

interface ParsedJwt {
  header: { alg: 'RS256'; kid: string; typ: 'at+jwt' };
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array;
}

function parseJwt(value: string): ParsedJwt | null {
  if (typeof value !== 'string' || value.length < 32 || value.length > MAX_JWT_BYTES) {
    return null;
  }
  const parts = value.split('.');
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/u.test(part))) {
    return null;
  }
  try {
    const headerJson = decodeBase64UrlText(parts[0]!);
    const payloadJson = decodeBase64UrlText(parts[1]!);
    if (hasDuplicateObjectKeys(headerJson) || hasDuplicateObjectKeys(payloadJson)) {
      return null;
    }
    const header: unknown = JSON.parse(headerJson);
    const payload: unknown = JSON.parse(payloadJson);
    if (!plainObject(header) || !plainObject(payload)
      || Object.keys(header).some((key) => !['alg', 'kid', 'typ'].includes(key))
      || header['alg'] !== 'RS256'
      || header['typ'] !== 'at+jwt'
      || typeof header['kid'] !== 'string'
      || !/^[A-Za-z0-9._-]{1,128}$/u.test(header['kid'])) return null;
    return {
      header: { alg: 'RS256', kid: header['kid'], typ: 'at+jwt' },
      payload,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: decodeBase64Url(parts[2]!),
    };
  } catch {
    return null;
  }
}

function validateClaims(
  value: Record<string, unknown>,
  config: StaffMcpOAuthConfig,
  now: number,
): {
  issuer: string;
  subject: string;
  jti: string;
  clientId: string;
  sessionId: string;
  expiresAt: number;
  issuedAt: number;
  scopes: string[];
} | null {
  const issuer = boundedString(value['iss'], 2048);
  const subject = boundedString(value['sub'], 512);
  const jti = boundedString(value['jti'], 512);
  const clientId = boundedString(value['client_id'], 512);
  const sessionId = boundedString(value['sid'], 512);
  const exp = numericDate(value['exp']);
  const iat = numericDate(value['iat']);
  const nbf = value['nbf'] === undefined ? iat : numericDate(value['nbf']);
  const scope = boundedString(value['scope'], 1024);
  if (!issuer || issuer !== config.issuer || !subject || !jti || !clientId
    || !sessionId || exp === null || iat === null || nbf === null || !scope
    || !validAudience(value['aud'], config.audience)
    || value['resource'] !== config.resource) return null;
  const expiresAt = exp * 1000;
  const issuedAt = iat * 1000;
  const notBefore = nbf * 1000;
  if (expiresAt <= now - CLOCK_SKEW_MS
    || issuedAt > now + CLOCK_SKEW_MS
    || notBefore > now + CLOCK_SKEW_MS
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > MAX_TOKEN_LIFETIME_MS) return null;
  const scopes = scope.split(' ');
  if (scopes.length < 1 || scopes.length > 16
    || scopes.some((item) => !/^[a-z][a-z0-9:._-]{0,63}$/u.test(item))
    || new Set(scopes).size !== scopes.length
    || !scopes.includes(STAFF_MCP_REQUIRED_OAUTH_SCOPE)) return null;
  return { issuer, subject, jti, clientId, sessionId, expiresAt, issuedAt, scopes };
}

function validAudience(value: unknown, expected: string): boolean {
  return value === expected
    || (Array.isArray(value) && value.length === 1 && value[0] === expected);
}

function numericDate(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0
    && Number(value) <= 9_007_199_254_740 ? Number(value) : null;
}

function boundedString(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.length >= 1 && value.length <= maximum
    ? value : null;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactStringSet(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item) => typeof item === 'string')
    && new Set(value).size === value.length
    && expected.every((item) => value.includes(item));
}

function stringArrayIncludes(value: unknown, expected: string): boolean {
  return Array.isArray(value)
    && value.length <= 20
    && value.every((item) => typeof item === 'string')
    && new Set(value).size === value.length
    && value.includes(expected);
}

function exactHttpsUrl(value: string, requirePath: boolean): boolean {
  if (typeof value !== 'string' || value.length > 2048
    || /REQUIRED|REPLACE|PLACEHOLDER|CHANGEME|TODO/iu.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.toString() === value
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && (!requirePath || url.pathname !== '/');
  } catch {
    return false;
  }
}

function decodeBase64UrlText(value: string): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64Url(value));
}

function decodeBase64Url(value: string): Uint8Array {
  if (value.length % 4 === 1) throw new Error('invalid_base64url');
  const standard = value.replaceAll('-', '+').replaceAll('_', '/');
  const padding = '='.repeat((4 - standard.length % 4) % 4);
  const decoded = atob(standard + padding);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  let canonical = '';
  for (const byte of bytes) canonical += String.fromCharCode(byte);
  canonical = btoa(canonical).replaceAll('+', '-').replaceAll('/', '_')
    .replace(/=+$/u, '');
  if (canonical !== value) throw new Error('invalid_base64url');
  return bytes;
}

async function readBoundedText(response: Response, maximum: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new Error('staff_mcp_oauth_document_invalid');
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => {
            controller.abort();
            reject(new Error('staff_mcp_token_status_timeout'));
          },
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Detect duplicate object member names before JSON.parse discards them. */
function hasDuplicateObjectKeys(source: string): boolean {
  let index = 0;
  function whitespace() { while (/\s/u.test(source[index] ?? '')) index += 1; }
  function string(): string {
    const start = index;
    index += 1;
    while (index < source.length) {
      if (source[index] === '\\') { index += 2; continue; }
      if (source[index] === '"') { index += 1; return JSON.parse(source.slice(start, index)); }
      index += 1;
    }
    throw new Error('invalid_json');
  }
  function value(): boolean {
    whitespace();
    if (source[index] === '{') return object();
    if (source[index] === '[') return array();
    if (source[index] === '"') { string(); return false; }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u
      .exec(source.slice(index));
    if (!match) throw new Error('invalid_json');
    index += match[0].length;
    return false;
  }
  function object(): boolean {
    index += 1;
    whitespace();
    const keys = new Set<string>();
    if (source[index] === '}') { index += 1; return false; }
    while (index < source.length) {
      whitespace();
      if (source[index] !== '"') throw new Error('invalid_json');
      const key = string();
      if (keys.has(key)) return true;
      keys.add(key);
      whitespace();
      if (source[index] !== ':') throw new Error('invalid_json');
      index += 1;
      if (value()) return true;
      whitespace();
      if (source[index] === '}') { index += 1; return false; }
      if (source[index] !== ',') throw new Error('invalid_json');
      index += 1;
    }
    throw new Error('invalid_json');
  }
  function array(): boolean {
    index += 1;
    whitespace();
    if (source[index] === ']') { index += 1; return false; }
    while (index < source.length) {
      if (value()) return true;
      whitespace();
      if (source[index] === ']') { index += 1; return false; }
      if (source[index] !== ',') throw new Error('invalid_json');
      index += 1;
    }
    throw new Error('invalid_json');
  }
  try {
    const duplicate = value();
    whitespace();
    return duplicate || index !== source.length;
  } catch {
    return true;
  }
}
