interface AccessBindings {
  STAFF_ACCESS_TEAM_DOMAIN?: string;
  STAFF_ACCESS_AUD?: string;
}

interface AccessJwtHeader { alg?: unknown; kid?: unknown; typ?: unknown }
interface AccessJwtPayload {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
  iat?: unknown;
  email?: unknown;
  sub?: unknown;
}
interface RemoteJwk { kty?: unknown; kid?: unknown; use?: unknown; alg?: unknown; n?: unknown; e?: unknown }

const jwkCache = new Map<string, { expiresAt: number; keys: RemoteJwk[] }>();
const JWKS_TTL_MS = 5 * 60 * 1000;
const JWKS_MAX_BYTES = 128 * 1024;
const CLOCK_SKEW_SECONDS = 30;

export class CloudflareAccessError extends Error {
  constructor(
    public readonly code: 'CONFIGURATION' | 'UNAUTHENTICATED',
    public readonly reason: string = code,
  ) {
    super(code); this.name = 'CloudflareAccessError';
  }
}

export async function verifyCloudflareAccessIdentity(
  request: Request,
  bindings: AccessBindings,
  now = Date.now(),
): Promise<{ email: string; subject: string | null }> {
  const teamDomain = exactOrigin(bindings.STAFF_ACCESS_TEAM_DOMAIN);
  const audience = clean(bindings.STAFF_ACCESS_AUD, 512);
  if (!teamDomain || !audience) throw new CloudflareAccessError('CONFIGURATION','BINDINGS');
  const token = request.headers.get('Cf-Access-Jwt-Assertion')?.trim() ?? '';
  if (token.length < 16 || token.length > 16 * 1024) throw new CloudflareAccessError('UNAUTHENTICATED','TOKEN_LENGTH');
  const segments = token.split('.');
  if (segments.length !== 3 || segments.some((segment) => segment.length < 1)) throw new CloudflareAccessError('UNAUTHENTICATED','TOKEN_SHAPE');
  const header = jsonSegment<AccessJwtHeader>(segments[0]!);
  const payload = jsonSegment<AccessJwtPayload>(segments[1]!);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length < 1 || header.kid.length > 512) throw new CloudflareAccessError('UNAUTHENTICATED','HEADER');
  const issuer = typeof payload.iss === 'string' ? payload.iss.replace(/\/$/u, '') : '';
  if (issuer !== teamDomain) throw new CloudflareAccessError('UNAUTHENTICATED','ISSUER');
  const audiences = typeof payload.aud === 'string'
    ? [payload.aud]
    : Array.isArray(payload.aud) && payload.aud.every((value) => typeof value === 'string')
      ? payload.aud as string[] : [];
  if (!audiences.includes(audience)) throw new CloudflareAccessError('UNAUTHENTICATED','AUDIENCE');
  const nowSeconds = Math.floor(now / 1000);
  const exp = Number(payload.exp);
  if (!Number.isSafeInteger(payload.exp) || exp <= nowSeconds) throw new CloudflareAccessError('UNAUTHENTICATED','EXPIRY');
  if (payload.nbf !== undefined && (!Number.isSafeInteger(payload.nbf) || Number(payload.nbf) > nowSeconds + CLOCK_SKEW_SECONDS)) throw new CloudflareAccessError('UNAUTHENTICATED','NOT_BEFORE');
  if (payload.iat !== undefined) {
    if (!Number.isSafeInteger(payload.iat)
      || Number(payload.iat) > nowSeconds + CLOCK_SKEW_SECONDS
      || Number(payload.iat) > exp) throw new CloudflareAccessError('UNAUTHENTICATED','ISSUED_AT');
  }
  const email = normalizeEmail(payload.email);
  if (!email) throw new CloudflareAccessError('UNAUTHENTICATED','EMAIL');
  const keys = await signingKeys(teamDomain, now);
  const jwk = keys.find((key) => key.kid === header.kid && key.kty === 'RSA'
    && (key.alg === undefined || key.alg === 'RS256') && (key.use === undefined || key.use === 'sig'));
  if (!jwk) {
    jwkCache.delete(teamDomain);
    const refreshed = await signingKeys(teamDomain, now, true);
    const next = refreshed.find((key) => key.kid === header.kid && key.kty === 'RSA'
      && (key.alg === undefined || key.alg === 'RS256') && (key.use === undefined || key.use === 'sig'));
    if (!next) throw new CloudflareAccessError('UNAUTHENTICATED','SIGNING_KEY');
    if (!await verifySignature(token, next)) throw new CloudflareAccessError('UNAUTHENTICATED','SIGNATURE');
  } else if (!await verifySignature(token, jwk)) {
    throw new CloudflareAccessError('UNAUTHENTICATED','SIGNATURE');
  }
  return { email, subject: typeof payload.sub === 'string' && payload.sub.length <= 512 ? payload.sub : null };
}

async function signingKeys(teamDomain: string, now: number, force = false): Promise<RemoteJwk[]> {
  const cached = jwkCache.get(teamDomain);
  if (!force && cached && cached.expiresAt > now) return cached.keys;
  let response: Response;
  try {
    response = await fetch(`${teamDomain}/cdn-cgi/access/certs`, {
      method: 'GET', redirect: 'manual', headers: { Accept: 'application/json' },
    });
  } catch { throw new CloudflareAccessError('UNAUTHENTICATED','JWKS_FETCH'); }
  if (!response.ok) throw new CloudflareAccessError('UNAUTHENTICATED','JWKS_HTTP');
  const declared = Number(response.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(declared) && declared > JWKS_MAX_BYTES) throw new CloudflareAccessError('UNAUTHENTICATED','JWKS_SIZE');
  const text = await response.text().catch(() => '');
  if (new TextEncoder().encode(text).byteLength > JWKS_MAX_BYTES) throw new CloudflareAccessError('UNAUTHENTICATED','JWKS_SIZE');
  let value: { keys?: unknown } | null = null;
  try { value = JSON.parse(text) as { keys?: unknown }; } catch { throw new CloudflareAccessError('UNAUTHENTICATED','JWKS_JSON'); }
  if (!value || !Array.isArray(value.keys) || value.keys.length < 1 || value.keys.length > 20) throw new CloudflareAccessError('UNAUTHENTICATED','JWKS_SHAPE');
  const keys = value.keys.filter((item): item is RemoteJwk => item !== null && typeof item === 'object');
  if (keys.length < 1) throw new CloudflareAccessError('UNAUTHENTICATED','JWKS_KEYS');
  jwkCache.set(teamDomain, { keys, expiresAt: now + JWKS_TTL_MS });
  return keys;
}

async function verifySignature(token: string, jwk: RemoteJwk): Promise<boolean> {
  if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string' || jwk.n.length > 4096 || jwk.e.length > 64) return false;
  const [header, payload, signature] = token.split('.');
  try {
    const key = await crypto.subtle.importKey('jwk',{ kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },false,['verify']);
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64UrlBytes(signature!),new TextEncoder().encode(`${header}.${payload}`));
  } catch { return false; }
}

function jsonSegment<T>(value: string): T {
  if (value.length > 8 * 1024) throw new CloudflareAccessError('UNAUTHENTICATED','TOKEN_SEGMENT_SIZE');
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(base64UrlBytes(value));
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    return parsed as T;
  } catch (error) {
    if (error instanceof CloudflareAccessError) throw error;
    throw new CloudflareAccessError('UNAUTHENTICATED','TOKEN_JSON');
  }
}
function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new CloudflareAccessError('UNAUTHENTICATED','TOKEN_BASE64URL');
  const padded = value.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat((4 - value.length % 4) % 4);
  const decoded = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}
function exactOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value.trim()); return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password ? url.origin : null; }
  catch { return null; }
}
function clean(value: string | undefined, maximum: number): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length >= 1 && normalized.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(normalized) ? normalized : null;
}
export function normalizeStaffEmail(value: unknown): string | null { return normalizeEmail(value); }
function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized) || /[\u0000-\u001f\u007f]/u.test(normalized)) return null;
  return normalized;
}
