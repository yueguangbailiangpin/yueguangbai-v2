import type {
  StaffAuthProviderAdapter,
  StaffAuthProviderBindings,
  VerifiedStaffProviderIdentity,
} from '@ygb/contracts';

const CONFIG_VALUE_MAX = 4096;
const PROVIDER_TIMEOUT_MS = 8_000;

export interface StaffAuthRuntimeConfig {
  provider: 'FEISHU';
  authorizationEndpoint: string;
  tokenEndpoint: string;
  identityEndpoint: string;
  appId: string;
  appSecret: string;
  scope: string;
  tenantKey: string;
  redirectUri: string;
  allowedOrigins: ReadonlySet<string>;
  allowedReturnTo: ReadonlySet<string>;
  hashSecret: string;
}

export function requireStaffAuthConfig(
  bindings: StaffAuthProviderBindings,
): StaffAuthRuntimeConfig {
  const provider = cleanRequired(bindings.STAFF_AUTH_PROVIDER, 'provider');
  if (provider !== 'FEISHU') throw new Error('staff_auth_provider_not_supported');
  const authorizationEndpoint = cleanHttpsUrl(
    bindings.STAFF_AUTH_FEISHU_AUTHORIZATION_ENDPOINT,
    'authorization_endpoint',
  );
  const tokenEndpoint = cleanHttpsUrl(
    bindings.STAFF_AUTH_FEISHU_TOKEN_ENDPOINT,
    'token_endpoint',
  );
  const identityEndpoint = cleanHttpsUrl(
    bindings.STAFF_AUTH_FEISHU_IDENTITY_ENDPOINT,
    'identity_endpoint',
  );
  const redirectUri = cleanHttpsUrl(
    bindings.STAFF_AUTH_FEISHU_REDIRECT_URI,
    'redirect_uri',
  );
  const appId = cleanRequired(bindings.STAFF_AUTH_FEISHU_APP_ID, 'app_id');
  const appSecret = cleanRequired(
    bindings.STAFF_AUTH_FEISHU_APP_SECRET,
    'app_secret',
  );
  const scope = cleanRequired(bindings.STAFF_AUTH_FEISHU_SCOPE, 'scope');
  const tenantKey = cleanRequired(
    bindings.STAFF_AUTH_FEISHU_TENANT_KEY,
    'tenant_key',
  );
  const hashSecret = cleanRequired(bindings.STAFF_AUTH_HASH_SECRET, 'hash_secret');
  if (hashSecret.length < 32) throw new Error('staff_auth_hash_secret_too_short');
  return Object.freeze({
    provider: 'FEISHU',
    authorizationEndpoint,
    tokenEndpoint,
    identityEndpoint,
    appId,
    appSecret,
    scope,
    tenantKey,
    redirectUri,
    allowedOrigins: parseAllowedOrigins(bindings.STAFF_AUTH_ALLOWED_ORIGINS),
    allowedReturnTo: parseAllowedReturnTo(bindings.STAFF_AUTH_ALLOWED_RETURN_TO),
    hashSecret,
  });
}

export class FeishuStaffAuthProvider implements StaffAuthProviderAdapter {
  constructor(private readonly config: StaffAuthRuntimeConfig) {}

  createAuthorizationUrl(input: {
    state: string;
    redirectUri: string;
    scope: string;
  }): string {
    const url = new URL(this.config.authorizationEndpoint);
    url.searchParams.set('app_id', this.config.appId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('scope', input.scope);
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    redirectUri: string;
    signal: AbortSignal;
  }): Promise<VerifiedStaffProviderIdentity> {
    const tokenResponse = await fetch(this.config.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: this.config.appId,
        client_secret: this.config.appSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
      }),
      signal: input.signal,
    });
    const tokenJson = await readProviderJson(tokenResponse);
    const accessToken = readString(
      tokenJson.access_token
        ?? asRecord(tokenJson.data)?.access_token,
      16,
      4096,
    );
    if (!accessToken) throw new Error('feishu_access_token_missing');

    const identityResponse = await fetch(this.config.identityEndpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: input.signal,
    });
    const identityJson = await readProviderJson(identityResponse);
    const data = asRecord(identityJson.data) ?? identityJson;
    const openId = readString(data.open_id, 1, 200);
    const tenantKey = readString(data.tenant_key, 1, 200);
    const userId = data.user_id === undefined || data.user_id === null
      ? null
      : readString(data.user_id, 1, 200);
    if (!openId || !tenantKey) throw new Error('feishu_identity_missing');
    if (tenantKey !== this.config.tenantKey) {
      throw new Error('feishu_tenant_mismatch');
    }
    return Object.freeze({
      provider: 'FEISHU',
      tenantKey,
      openId,
      userId,
    });
  }
}

export class FakeStaffAuthProvider implements StaffAuthProviderAdapter {
  constructor(
    private readonly identity: VerifiedStaffProviderIdentity,
    private readonly failure: Error | null = null,
  ) {}

  createAuthorizationUrl(input: {
    state: string;
    redirectUri: string;
    scope: string;
  }): string {
    const url = new URL('https://fake-feishu.invalid/authorize');
    url.searchParams.set('state', input.state);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('scope', input.scope);
    return url.toString();
  }

  async exchangeAuthorizationCode(): Promise<VerifiedStaffProviderIdentity> {
    if (this.failure) throw this.failure;
    return this.identity;
  }
}

export async function withStaffProviderTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function parseAllowedOrigins(value: string | undefined): ReadonlySet<string> {
  const result = new Set<string>();
  for (const item of splitConfigList(value, 'allowed_origins')) {
    const url = new URL(item);
    if (url.protocol !== 'https:' || url.origin !== item) {
      throw new Error('invalid_staff_auth_allowed_origin');
    }
    result.add(item);
  }
  if (result.size === 0) throw new Error('staff_auth_allowed_origins_empty');
  return result;
}

function parseAllowedReturnTo(value: string | undefined): ReadonlySet<string> {
  const result = new Set<string>();
  for (const item of splitConfigList(value, 'allowed_return_to')) {
    if (!isAllowedRelativeReturnTo(item)) {
      throw new Error('invalid_staff_auth_return_to');
    }
    result.add(item);
  }
  if (result.size === 0) throw new Error('staff_auth_return_to_empty');
  return result;
}

export function isAllowedRelativeReturnTo(value: string): boolean {
  return value.length >= 1
    && value.length <= 1024
    && value.startsWith('/')
    && !value.startsWith('//')
    && !value.includes('\\')
    && !value.includes('\u0000')
    && !value.includes('\r')
    && !value.includes('\n');
}

function splitConfigList(value: string | undefined, name: string): string[] {
  const cleaned = cleanRequired(value, name);
  return cleaned.split(',').map((item) => item.trim()).filter(Boolean);
}

function cleanRequired(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`staff_auth_${name}_missing`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > CONFIG_VALUE_MAX) {
    throw new Error(`staff_auth_${name}_invalid`);
  }
  return cleaned;
}

function cleanHttpsUrl(value: unknown, name: string): string {
  const cleaned = cleanRequired(value, name);
  const url = new URL(cleaned);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error(`staff_auth_${name}_invalid`);
  }
  return url.toString();
}

async function readProviderJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`feishu_http_${response.status}`);
  const value = await response.json().catch(() => null);
  const record = asRecord(value);
  if (!record) throw new Error('feishu_invalid_json');
  const code = record.code;
  if (code !== undefined && code !== 0 && code !== '0') {
    throw new Error('feishu_provider_error');
  }
  return record;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(
  value: unknown,
  minimum: number,
  maximum: number,
): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned.length >= minimum && cleaned.length <= maximum
    ? cleaned
    : null;
}
