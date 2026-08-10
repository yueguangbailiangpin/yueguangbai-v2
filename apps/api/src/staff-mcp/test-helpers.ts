import type { SqlDatabase } from '@ygb/contracts';
import type {
  StaffMcpOAuthConfig,
  StaffMcpOAuthDocumentProvider,
} from './oauth-resource-server';
import { keyedHash } from './security-state';

export const ANONYMOUS_OAUTH_CONFIG: StaffMcpOAuthConfig = {
  resource: 'https://staff-mcp.invalid/mcp',
  audience: 'https://staff-mcp.invalid/mcp',
  resourceDocumentationUrl: 'https://staff-mcp.invalid/staff-mcp-guide',
  resourcePolicyUrl: 'https://staff-mcp.invalid/privacy/staff-mcp',
  issuer: 'https://issuer.invalid/',
  metadataUrl: 'https://issuer.invalid/.well-known/oauth-authorization-server',
  authorizationEndpoint: 'https://issuer.invalid/authorize',
  tokenEndpoint: 'https://issuer.invalid/token',
  jwksUri: 'https://issuer.invalid/jwks',
  revocationEndpoint: 'https://issuer.invalid/revoke',
};

export const ANONYMOUS_HASH_SECRET = 'anonymous-staff-mcp-hash-secret-00000001';

export function anonymousMetadata() {
  return {
    issuer: ANONYMOUS_OAUTH_CONFIG.issuer,
    authorization_endpoint: ANONYMOUS_OAUTH_CONFIG.authorizationEndpoint,
    token_endpoint: ANONYMOUS_OAUTH_CONFIG.tokenEndpoint,
    jwks_uri: ANONYMOUS_OAUTH_CONFIG.jwksUri,
    revocation_endpoint: ANONYMOUS_OAUTH_CONFIG.revocationEndpoint,
    grant_types_supported: ['authorization_code'],
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
  };
}

export async function anonymousSigningFixture(kid = 'anonymous-key-1') {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    kid,
    privateKey: pair.privateKey,
    jwk: { ...jwk, kid, alg: 'RS256', use: 'sig', key_ops: ['verify'] },
  };
}

export async function signAnonymousToken(
  privateKey: CryptoKey,
  kid: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const nowSeconds = 1_000;
  const header = base64UrlJson({ alg: 'RS256', typ: 'at+jwt', kid });
  const payload = base64UrlJson({
    iss: ANONYMOUS_OAUTH_CONFIG.issuer,
    sub: 'anonymous-subject',
    aud: ANONYMOUS_OAUTH_CONFIG.audience,
    resource: ANONYMOUS_OAUTH_CONFIG.resource,
    exp: nowSeconds + 600,
    iat: nowSeconds,
    nbf: nowSeconds,
    scope: 'staff:mcp',
    client_id: 'anonymous-client',
    sid: 'anonymous-session',
    jti: 'anonymous-jti',
    ...overrides,
  });
  const input = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(input),
  );
  return `${input}.${base64Url(new Uint8Array(signature))}`;
}

export async function seedAnonymousBinding(
  database: SqlDatabase,
  staffId = 'zz-phase3h-test-owner',
): Promise<void> {
  const issuerHash = await keyedHash(
    ANONYMOUS_HASH_SECRET,
    'issuer',
    ANONYMOUS_OAUTH_CONFIG.issuer,
  );
  const subjectHash = await keyedHash(
    ANONYMOUS_HASH_SECRET,
    'subject',
    `${ANONYMOUS_OAUTH_CONFIG.issuer}\u0000anonymous-subject`,
  );
  await database.prepare(`
    INSERT INTO staff_mcp_subject_bindings (
      issuer_hash,subject_hash,staff_id,status,created_at,updated_at,revoked_at
    ) VALUES (?, ?, ?, 'ACTIVE', 1, 1, NULL)
  `).bind(issuerHash, subjectHash, staffId).run();
}

export class AnonymousDocumentProvider
implements StaffMcpOAuthDocumentProvider {
  metadata: unknown = anonymousMetadata();
  jwks: unknown;
  refreshedJwks: unknown | null = null;
  metadataFailure = false;
  jwksFailure = false;
  forceRefreshes = 0;

  constructor(jwk: JsonWebKey) {
    this.jwks = { keys: [jwk] };
  }

  async loadAuthorizationServerMetadata(): Promise<unknown> {
    if (this.metadataFailure) throw new Error('anonymous_metadata_outage');
    return this.metadata;
  }

  async loadJwks(forceRefresh: boolean): Promise<unknown> {
    if (this.jwksFailure) throw new Error('anonymous_jwks_outage');
    if (forceRefresh) {
      this.forceRefreshes += 1;
      return this.refreshedJwks ?? this.jwks;
    }
    return this.jwks;
  }
}

export const ANONYMOUS_ACTIVE_TOKEN_STATUS = Object.freeze({
  async isActive() { return true; },
});

export class AnonymousTokenStatusService {
  bodies: unknown[] = [];

  async fetch(request: Request): Promise<Response> {
    const body = await request.json() as Record<string, unknown>;
    this.bodies.push(body);
    return Response.json({
      active: true,
      jti_hash: body['jti_hash'],
      expires_at: body['expires_at'],
      checked_at: body['checked_at'],
    });
  }
}

function base64UrlJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
