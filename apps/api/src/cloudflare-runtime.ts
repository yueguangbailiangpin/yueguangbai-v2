import type { ObjectStorageAdapter, SqlDatabase } from '@ygb/contracts';
import type { AppBindings } from './app';
import { createR2ObjectStorageAdapter } from './files/r2-object-storage';
import { feishuWorkbenchRuntime } from './feishu-workbench/runtime';

export type ReleaseEnvironment = 'local' | 'staging' | 'production';

export interface StaticAssetBinding {
  fetch(request: Request): Promise<Response>;
}

export type CloudflareWorkerBindings = Omit<AppBindings, 'FILE_OBJECT_STORAGE'> & {
  APP_ENVIRONMENT?: string;
  APP_ORIGIN?: string;
  APP_ALLOWED_ORIGINS?: string;
  FILE_OBJECT_STORAGE?: ObjectStorageAdapter;
  FILE_OBJECT_STORAGE_R2?: unknown;
  WEB_ASSETS?: StaticAssetBinding;
  STAFF_AUTH_ENABLED?: string;
  STAFF_MCP_ENABLED?: string;
  STAFF_MCP_LOCAL_MOCK_ENABLED?: string;
  STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED?: string;
};

export interface ResolvedCloudflareRuntime {
  environment: ReleaseEnvironment;
  appOrigin: string | null;
  appBindings: AppBindings;
  assets: StaticAssetBinding | null;
}

const DISABLED_RELEASE_FLAGS = [
  'DRIVE_ARCHIVE_ENABLED',
  'DRIVE_ARCHIVE_COPY_ENABLED',
  'DRIVE_ARCHIVE_PROXY_READ_ENABLED',
  'DRIVE_ARCHIVE_R2_DELETE_ENABLED',
  'STAFF_AUTH_ENABLED',
  'STAFF_MCP_LOCAL_MOCK_ENABLED',
] as const;

const DISABLED_STAFF_AUTH_BINDINGS = [
  'STAFF_AUTH_PROVIDER',
  'STAFF_AUTH_FEISHU_AUTHORIZATION_ENDPOINT',
  'STAFF_AUTH_FEISHU_TOKEN_ENDPOINT',
  'STAFF_AUTH_FEISHU_IDENTITY_ENDPOINT',
  'STAFF_AUTH_FEISHU_APP_ID',
  'STAFF_AUTH_FEISHU_APP_SECRET',
  'STAFF_AUTH_FEISHU_SCOPE',
  'STAFF_AUTH_FEISHU_TENANT_KEY',
  'STAFF_AUTH_FEISHU_REDIRECT_URI',
  'STAFF_AUTH_ALLOWED_ORIGINS',
  'STAFF_AUTH_ALLOWED_RETURN_TO',
  'STAFF_AUTH_HASH_SECRET',
  'STAFF_AUTH_PROVIDER_ADAPTER',
] as const;

export function resolveCloudflareRuntime(
  bindings: CloudflareWorkerBindings,
): ResolvedCloudflareRuntime | null {
  const environment = bindings.APP_ENVIRONMENT;
  if (environment !== 'local'
    && environment !== 'staging'
    && environment !== 'production') return null;

  if (environment === 'local') {
    return {
      environment,
      appOrigin: null,
      appBindings: bindings as AppBindings,
      assets: null,
    };
  }

  const appOrigin = exactHttpsOrigin(bindings.APP_ORIGIN);
  const allowedOrigins = exactOriginList(bindings.APP_ALLOWED_ORIGINS);
  const storage = createR2ObjectStorageAdapter(
    bindings.FILE_OBJECT_STORAGE_R2,
  );
  const feishu = feishuWorkbenchRuntime(bindings);
  const scheduledEnabled=bindings.SCHEDULED_OPERATIONS_ENABLED==='true';
  if (!appOrigin
    || allowedOrigins.length !== 1
    || allowedOrigins[0] !== appOrigin
    || !isSqlDatabase(bindings.DB)
    || !storage
    || !isStaticAssetBinding(bindings.WEB_ASSETS)
    || DISABLED_RELEASE_FLAGS.some((name) => bindings[name] !== 'false')
    || !booleanFlag(bindings.STAFF_MCP_ENABLED)
    || !booleanFlag(bindings.STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED)
    || !booleanFlag(bindings.STAFF_MCP_CLEANUP_ENABLED)
    || (bindings.STAFF_MCP_ENABLED === 'true'
      && (bindings.STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED !== 'true'
        || bindings.STAFF_MCP_CLEANUP_ENABLED !== 'true'
        || !isStaticAssetBinding(bindings.STAFF_MCP_TOKEN_STATUS_SERVICE)))
    || (bindings.STAFF_MCP_ENABLED === 'false'
      && (bindings.STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED !== 'false'
        || bindings.STAFF_MCP_CLEANUP_ENABLED !== 'false'))
    || !booleanFlag(bindings.SCHEDULED_OPERATIONS_ENABLED)
    || !booleanFlag(bindings.ACQUISITION_MAINTENANCE_ENABLED)
    || (scheduledEnabled && (bindings.FEISHU_WORKBENCH_SYNC_ENABLED!=='true'
      || bindings.ACQUISITION_MAINTENANCE_ENABLED !== 'false'
      || !feishuOnlySchedule(bindings.SCHEDULED_OPERATIONS_DISABLED_JOBS)))
    || (!scheduledEnabled && bindings.FEISHU_WORKBENCH_SYNC_ENABLED==='true')
    || !booleanFlag(bindings.FEISHU_WORKBENCH_SYNC_ENABLED)
    || !booleanFlag(bindings.FEISHU_WORKBENCH_CALLBACK_ENABLED)
    || (bindings.FEISHU_WORKBENCH_SYNC_ENABLED === 'true' && !feishu.syncEnabled)
    || (bindings.FEISHU_WORKBENCH_CALLBACK_ENABLED === 'true' && !feishu.callbackEnabled)
    || bindings.OPERATIONAL_ALERT_MODE !== 'disabled') return null;

  return Object.freeze({
    environment,
    appOrigin,
    appBindings: releaseAppBindings(bindings, storage),
    assets: bindings.WEB_ASSETS,
  });
}

function booleanFlag(value:unknown):value is 'true'|'false' { return value==='true'||value==='false'; }
function feishuOnlySchedule(value:unknown):boolean {
  if(typeof value!=='string')return false;
  const actual=new Set(value.split(',').map((name)=>name.trim()).filter(Boolean));
  const required=['reservation_expiry','instruction_expiry','outbox_delivery','file_orphan_cleanup','staff_auth_cleanup','drive_archive'];
  return actual.size===required.length&&required.every((name)=>actual.has(name));
}

export function isApiRequestPath(pathname: string): boolean {
  return pathname === '/health'
    || pathname === '/api'
    || pathname.startsWith('/api/')
    || pathname === '/mcp'
    || pathname === '/.well-known/oauth-protected-resource/mcp';
}

export function isAllowedSameOriginApiRequest(
  request: Request,
  appOrigin: string,
): boolean {
  const url = new URL(request.url);
  if (url.origin !== appOrigin) return false;
  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== appOrigin) return false;
  return request.headers.get('Sec-Fetch-Site') !== 'cross-site';
}

export function withReleaseSecurityHeaders(
  response: Response,
  pathname: string,
  secureEnvironment: boolean,
): Response {
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' blob: data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
  ].join('; '));
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  if (secureEnvironment) {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (!isApiRequestPath(pathname)) {
    headers.set('Cache-Control', pathname.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function exactHttpsOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || isPlaceholder(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.origin === value
      && !url.username
      && !url.password ? value : null;
  } catch {
    return null;
  }
}

function exactOriginList(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);
  return items.every((item) => exactHttpsOrigin(item) === item) ? items : [];
}

function isPlaceholder(value: string): boolean {
  return /REQUIRED|REPLACE|PLACEHOLDER|CHANGEME|TODO/iu.test(value);
}

function isSqlDatabase(value: unknown): value is SqlDatabase {
  if (!value || typeof value !== 'object') return false;
  const database = value as Partial<SqlDatabase>;
  return typeof database.prepare === 'function'
    && typeof database.batch === 'function';
}

function isStaticAssetBinding(value: unknown): value is StaticAssetBinding {
  return !!value && typeof value === 'object'
    && typeof (value as Partial<StaticAssetBinding>).fetch === 'function';
}

function releaseAppBindings(
  bindings: CloudflareWorkerBindings,
  storage: ObjectStorageAdapter,
): AppBindings {
  const result: Record<string, unknown> = {
    ...bindings,
    FILE_OBJECT_STORAGE: storage,
  };
  for (const name of DISABLED_STAFF_AUTH_BINDINGS) delete result[name];
  return Object.freeze(result) as unknown as AppBindings;
}
