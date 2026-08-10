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
interface RemoteJwk {
  kty?: unknown; kid?: unknown; use?: unknown; alg?: unknown;
  n?: unknown; e?: unknown;
}

const jwkCache = new Map<string, { expiresAt: number; keys: RemoteJwk[] }>();
const JWKS_TTL_MS = 5 * 60 * 1000;

export class CloudflareAccessError extends Error {
  constructor(public readonly code: 'CONFIGURATION' | 'UNAUTHENTICATED') {
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
  if (!teamDomain || !audience) throw new CloudflareAccessError('CONFIGURATION');
  const token = request.headers.get('Cf-Access-Jwt-Assertion')?.trim() ?? '';
  const segments = token.split('.');
  if (segments.length !== 3 || segments.some((segment) => segment.length < 1)) {
    throw new CloudflareAccessError('UNAUTHENTICATED');
  }
  const header = jsonSegment<AccessJwtHeader>(segments[0]!);
  const payload = jsonSegment<AccessJwtPayload>(segments[1]!);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length < 1) {
    throw new CloudflareAccessError('UNAUTHENTICATED');
  }
  const issuer = typeof payload.iss === 'string' ? payload.iss.replace(/\/$/u, '') : '';
  if (issuer !== teamDomain) throw new CloudflareAccessError('UNAUTHENTICATED');
  const audiences = typeof payload.aud === 'string'
    ? [payload.aud]
    : Array.isArray(payload.aud) && payload.aud.every((value) => typeof value === 'string')
      ? payload.aud as string[] : [];
  if (!audiences.includes(audience)) throw new CloudflareAccessError('UNAUTHENTICATED');
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isSafeInteger(payload.exp) || Number(payload.exp) <= nowSeconds
    || (payload.nbf !== undefined && (!Number.isSafeInteger(payload.nbf) || Number(payload.nbf) > nowSeconds + 30))) {
    throw new CloudflareAccessError('UNAUTHENTICATED');
  }
  const email = normalizeEmail(payload.email);
  if (!email) throw new CloudflareAccessError('UNAUTHENTICATED');
  const keys = await signingKeys(teamDomain, now);
  const jwk = keys.find((key) => key.kid === header.kid && key.kty === 'RSA'
    && (key.alg === undefined || key.alg === 'RS256') && (key.use === undefined || key.use === 'sig'));
  if (!jwk) {
    jwkCache.delete(teamDomain);
    const refreshed = await signingKeys(teamDomain, now, true);
    const next = refreshed.find((key) => key.kid === header.kid && key.kty === 'RSA'
      && (key.alg === undefined || key.alg === 'RS256') && (key.use === undefined || key.use === 'sig'));
    if (!next || !await verifySignature(token, next)) throw new CloudflareAccessError('UNAUTHENTICATED');
  } else if (!await verifySignature(token, jwk)) {
    throw new CloudflareAccessError('UNAUTHENTICATED');
  }
  return { email, subject: typeof payload.sub === 'string' && payload.sub.length <= 512 ? payload.sub : null };
}

async function signingKeys(teamDomain: string, now: number, force = false): Promise<RemoteJwk[]> {
  const cached = jwkCache.get(teamDomain);
  if (!force && cached && cached.expiresAt > now) return cached.keys;
  let response: Response;
  try {
    response = await fetch(`${teamDomain}/cdn-cgi/access/certs`, {
      method: 'GET', redirect: 'error', headers: { Accept: 'application/json' },
    });
  } catch { throw new CloudflareAccessError('UNAUTHENTICATED'); }
  if (!response.ok) throw new CloudflareAccessError('UNAUTHENTICATED');
  const value = await response.json().catch(() => null) as { keys?: unknown } | null;
  if (!value || !Array.isArray(value.keys) || value.keys.length < 1 || value.keys.length > 20) {
    throw new CloudflareAccessError('UNAUTHENTICATED');
  }
  const keys = value.keys.filter((item): item is RemoteJwk => item !== null && typeof item === 'object');
  if (keys.length < 1) throw new CloudflareAccessError('UNAUTHENTICATED');
  jwkCache.set(teamDomain, { keys, expiresAt: now + JWKS_TTL_MS });
  return keys;
}

async function verifySignature(token: string, jwk: RemoteJwk): Promise<boolean> {
  if (typeof jwk.n !== 'string' || typeof jwk.e !== 'string') return false;
  const [header, payload, signature] = token.split('.');
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key, base64UrlBytes(signature!),
      new TextEncoder().encode(`${header}.${payload}`),
    );
  } catch { return false; }
}

function jsonSegment<T>(value: string): T {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(base64UrlBytes(value));
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    return parsed as T;
  } catch { throw new CloudflareAccessError('UNAUTHENTICATED'); }
}

function base64UrlBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new CloudflareAccessError('UNAUTHENTICATED');
  const padded = value.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat((4 - value.length % 4) % 4);
  const decoded = atob(padded); const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}
function exactOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.hash
      && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}
function clean(value: string | undefined, maximum: number): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length >= 1 && normalized.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(normalized)
    ? normalized : null;
}
export function normalizeStaffEmail(value: unknown): string | null { return normalizeEmail(value); }
function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)
    || /[\u0000-\u001f\u007f]/u.test(normalized)) return null;
  return normalized;
}
