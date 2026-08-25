import type { ObjectStorageAdapter, SqlDatabase } from '@ygb/contracts';
import type { AppBindings } from './app';
import { createR2ObjectStorageAdapter } from './files/r2-object-storage';
import { exactCloudflareAccessTeamOrigin, parseExactGitCommitSha } from '@ygb/domain';
import { resolveOperationalAlertRuntimeConfiguration } from './operational-readiness/alert-runtime';

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
};

export interface ResolvedCloudflareRuntime {
  environment: ReleaseEnvironment;
  appOrigin: string | null;
  appBindings: AppBindings;
  assets: StaticAssetBinding | null;
}

const DISABLED_RELEASE_FLAGS = [
  'ARCHIVE_SELECTOR_ENABLED',
  'ARCHIVE_DRIVE_UPLOAD_ENABLED',
  'ARCHIVE_HOT_DELETE_ENABLED',
  'ARCHIVE_RESTORE_WORKER_ENABLED',
] as const;

export async function resolveCloudflareRuntime(
  bindings: CloudflareWorkerBindings,
): Promise<ResolvedCloudflareRuntime | null> {
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
  const releaseSha=parseExactGitCommitSha(bindings.APP_RELEASE_SHA);
  const storage = createR2ObjectStorageAdapter(
    bindings.FILE_OBJECT_STORAGE_R2,
  );
  if (!appOrigin
    || allowedOrigins.length !== 1
    || allowedOrigins[0] !== appOrigin
    || !isSqlDatabase(bindings.DB)
    || !storage
    || !isStaticAssetBinding(bindings.WEB_ASSETS)
    || DISABLED_RELEASE_FLAGS.some((name) => bindings[name] !== 'false')
    || Object.keys(bindings).some((name) => name.startsWith('STAFF_MCP_'))
    || !validStaffAccessReleaseBindings(bindings, appOrigin)
    || !booleanFlag(bindings.SCHEDULED_OPERATIONS_ENABLED)
    || !booleanFlag(bindings.OUTBOX_DELIVERY_ENABLED)
    || !booleanFlag(bindings.ACQUISITION_MAINTENANCE_ENABLED)
    || !releaseSha
    || !await validOperationalAlertReleaseBindings(bindings,environment)) return null;

  return Object.freeze({
    environment,
    appOrigin,
    appBindings: releaseAppBindings(bindings, storage),
    assets: bindings.WEB_ASSETS,
  });
}

function booleanFlag(value:unknown):value is 'true'|'false' { return value==='true'||value==='false'; }

async function validOperationalAlertReleaseBindings(bindings:CloudflareWorkerBindings,environment:ReleaseEnvironment):Promise<boolean>{
  if(environment==='production')return await resolveOperationalAlertRuntimeConfiguration(bindings)!==null;
  return bindings.OPERATIONAL_ALERT_MODE==='disabled'
    &&bindings.OPERATIONAL_ALERT_SINK===undefined
    &&bindings.OPERATIONAL_ALERT_SINK_SERVICE===undefined
    &&bindings.OPERATIONAL_ALERT_SINK_ENTRYPOINT===undefined
    &&bindings.OPERATIONAL_ALERT_SINK_IDENTITY===undefined
    &&bindings.OPERATIONAL_ALERT_SINK_DEPLOYMENT_VERSION===undefined
    &&bindings.OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT===undefined;
}

export function isApiRequestPath(pathname: string): boolean {
  return pathname === '/health'
    || pathname === '/ready'
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
  return Object.freeze(result) as unknown as AppBindings;
}

function validStaffAccessReleaseBindings(
  bindings: CloudflareWorkerBindings,
  appOrigin: string,
): boolean {
  return exactCloudflareAccessTeamOrigin(bindings.STAFF_ACCESS_TEAM_DOMAIN) !== null
    && safeStaffAuthValue(bindings.STAFF_ACCESS_AUD, 200, 8)
    && bindings.STAFF_AUTH_ALLOWED_ORIGINS === appOrigin
    && exactOriginList(bindings.STAFF_AUTH_ALLOWED_ORIGINS).length === 1;
}

function safeStaffAuthValue(
  value: unknown,
  maximum: number,
  minimum = 1,
): value is string {
  return typeof value === 'string'
    && value.length >= minimum
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && !isPlaceholder(value);
}
