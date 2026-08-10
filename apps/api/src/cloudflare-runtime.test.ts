import { describe, expect, it } from 'vitest';
import { AnonymousR2Bucket } from '../test-support/anonymous-r2-binding';
import worker from './worker';
import {
  isAllowedSameOriginApiRequest,
  resolveCloudflareRuntime,
  type CloudflareWorkerBindings,
} from './cloudflare-runtime';
import { MockFeishuWorkbenchAdapter } from './feishu-workbench/mock-adapter';

const origin = 'https://release.example.invalid';
const executionContext = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
};

describe('production Cloudflare Worker runtime', () => {
  it('routes API to Hono and never falls back to SPA HTML', async () => {
    const health = await fetchWorker('/health');
    expect(health.status).toBe(200);
    expect(health.headers.get('content-type')).toContain('application/json');
    expect(health.headers.get('strict-transport-security')).toContain('max-age=31536000');

    const missing = await fetchWorker('/api/not-registered');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('content-type')).toContain('application/json');
    expect(await missing.text()).not.toContain('<!doctype html>');
  });

  it('serves SPA deep links and applies static security/cache headers', async () => {
    const deepLink = await fetchWorker('/buyer/orders/anonymous-1', {
      headers: { 'Sec-Fetch-Mode': 'navigate' },
    });
    expect(deepLink.status).toBe(200);
    expect(await deepLink.text()).toContain('<div id="root"></div>');
    expect(deepLink.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(deepLink.headers.get('x-frame-options')).toBe('DENY');
    expect(deepLink.headers.get('cache-control')).toBe('no-cache');

    const asset = await fetchWorker('/assets/app-abc123.js');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(asset.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rejects CORS/preflight and cross-origin API access without wildcard headers', async () => {
    for (const request of [
      new Request(`${origin}/api/example`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://attacker.invalid', 'Sec-Fetch-Site': 'cross-site' },
      }),
      new Request('https://wrong-host.invalid/health'),
    ]) {
      const response = await worker.fetch(request, bindings(), executionContext);
      expect(response.status).toBe(403);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(await response.text()).not.toContain('attacker.invalid');
    }
  });

  it('allows only the exact cross-site top-level Feishu callback navigation', () => {
    const callback = `${origin}/api/staff-auth/feishu/callback?code=test&state=test`;
    const navigationHeaders = {
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document',
    };
    expect(isAllowedSameOriginApiRequest(
      new Request(callback, { headers: navigationHeaders }),
      origin,
    )).toBe(true);
    for (const request of [
      new Request(callback, {
        method: 'POST',
        headers: navigationHeaders,
      }),
      new Request(callback, {
        headers: { ...navigationHeaders, Origin: 'https://accounts.feishu.cn' },
      }),
      new Request(callback, {
        headers: { ...navigationHeaders, 'Sec-Fetch-Mode': 'cors' },
      }),
      new Request(`${origin}/api/staff-auth/session`, {
        headers: navigationHeaders,
      }),
    ]) {
      expect(isAllowedSameOriginApiRequest(request, origin)).toBe(false);
    }
  });

  it('fails closed and redacts missing, placeholder and wrong-environment bindings', async () => {
    const cases = [
      { ...bindings(), FILE_OBJECT_STORAGE_R2: undefined },
      { ...bindings(), APP_ORIGIN: 'REQUIRED_PRODUCTION_HTTPS_ORIGIN' },
      { ...bindings(), APP_ENVIRONMENT: 'development' },
      { ...bindings(), SCHEDULED_OPERATIONS_ENABLED: 'true' },
      { ...bindings(), ACQUISITION_MAINTENANCE_ENABLED: undefined },
    ];
    for (const env of cases) {
      const response = await worker.fetch(
        new Request(`${origin}/health`), env as CloudflareWorkerBindings,
        executionContext,
      );
      expect(response.status).toBe(503);
      const body = await response.text();
      expect(body).not.toContain('REQUIRED_PRODUCTION_HTTPS_ORIGIN');
      expect(body).not.toContain('anonymous-secret-value');
    }
  });

  it('removes Staff Auth provider authority while the release kill switch is off', async () => {
    let providerCalls = 0;
    const env = bindings();
    Object.assign(env, {
      STAFF_AUTH_PROVIDER: 'FEISHU',
      STAFF_AUTH_FEISHU_APP_SECRET: 'anonymous-secret-value',
      STAFF_AUTH_HASH_SECRET: 'h'.repeat(32),
      STAFF_AUTH_PROVIDER_ADAPTER: {
        createAuthorizationUrl() {
          providerCalls += 1;
          return 'https://provider.example.invalid';
        },
      },
    });
    const response = await worker.fetch(new Request(
      `${origin}/api/staff-auth/login/start`,
      {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ return_to: '/staff' }),
      },
    ), env, executionContext);
    expect(response.status).toBe(503);
    expect(providerCalls).toBe(0);
    expect(await response.text()).not.toContain('anonymous-secret-value');
  });

  it('allows Staff Auth only with a complete official Feishu production shape', async () => {
    const env = enabledStaffAuthBindings();
    const runtime = resolveCloudflareRuntime(env);
    expect(runtime).not.toBeNull();
    expect(runtime?.appBindings).toMatchObject({
      STAFF_AUTH_PROVIDER: 'FEISHU',
      STAFF_AUTH_FEISHU_APP_ID: 'cli_anonymous_release',
      STAFF_AUTH_ALLOWED_ORIGINS: origin,
      STAFF_AUTH_ALLOWED_RETURN_TO: '/staff',
    });
    expect(runtime?.appBindings.STAFF_AUTH_FEISHU_APP_SECRET)
      .toBe('anonymous-secret-value');
    expect(runtime?.appBindings.STAFF_AUTH_PROVIDER_ADAPTER).toBeUndefined();
    expect((await worker.fetch(
      new Request(`${origin}/health`), env, executionContext,
    )).status).toBe(200);
  });

  it('fails closed when any enabled Staff Auth production boundary drifts', async () => {
    const cases = [
      { STAFF_AUTH_PROVIDER: 'OTHER' },
      { STAFF_AUTH_FEISHU_AUTHORIZATION_ENDPOINT: 'https://example.invalid/authorize' },
      { STAFF_AUTH_FEISHU_TOKEN_ENDPOINT: 'https://example.invalid/token' },
      { STAFF_AUTH_FEISHU_IDENTITY_ENDPOINT: 'https://example.invalid/user' },
      { STAFF_AUTH_FEISHU_APP_ID: 'REQUIRED_APP_ID' },
      { STAFF_AUTH_FEISHU_APP_SECRET: '' },
      { STAFF_AUTH_FEISHU_SCOPE: 'contact:user:readonly' },
      { STAFF_AUTH_FEISHU_TENANT_KEY: 'PLACEHOLDER' },
      { STAFF_AUTH_FEISHU_REDIRECT_URI: 'https://other.invalid/callback' },
      { STAFF_AUTH_ALLOWED_ORIGINS: 'https://other.invalid' },
      { STAFF_AUTH_ALLOWED_RETURN_TO: '/admin' },
      { STAFF_AUTH_HASH_SECRET: 'too-short' },
    ];
    for (const drift of cases) {
      const response = await worker.fetch(
        new Request(`${origin}/health`),
        { ...enabledStaffAuthBindings(), ...drift } as CloudflareWorkerBindings,
        executionContext,
      );
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain('anonymous-secret-value');
    }
  });

  it('allows only a complete Feishu-only schedule while Staff Auth remains off', async () => {
    const env=bindings();
    Object.assign(env,{
      SCHEDULED_OPERATIONS_ENABLED:'true',
      SCHEDULED_OPERATIONS_DISABLED_JOBS:'reservation_expiry,instruction_expiry,outbox_delivery,file_orphan_cleanup,staff_auth_cleanup,drive_archive',
      FEISHU_WORKBENCH_SYNC_ENABLED:'true',
      ACQUISITION_MAINTENANCE_ENABLED:'false',
      FEISHU_WORKBENCH_WEB_ORIGIN:origin,
      FEISHU_WORKBENCH_TENANT_KEY:'tenant-anonymous',
      FEISHU_WORKBENCH_ADAPTER:new MockFeishuWorkbenchAdapter(),
    });
    expect((await worker.fetch(new Request(`${origin}/health`),env,executionContext)).status).toBe(200);
    expect(env.STAFF_AUTH_ENABLED).toBe('false');
    expect((await worker.fetch(new Request(`${origin}/health`),{
      ...env,SCHEDULED_OPERATIONS_DISABLED_JOBS:'drive_archive',
    },executionContext)).status).toBe(503);
    expect((await worker.fetch(new Request(`${origin}/health`),{
      ...env,FEISHU_WORKBENCH_TENANT_KEY:'',
    },executionContext)).status).toBe(503);
    expect((await worker.fetch(new Request(`${origin}/health`),{
      ...env,ACQUISITION_MAINTENANCE_ENABLED:'true',
    },executionContext)).status).toBe(503);
  });

  it('accepts alerts only for one complete formal Feishu app identity', async () => {
    const env=enabledStaffAuthBindings();
    Object.assign(env,{
      SCHEDULED_OPERATIONS_ENABLED:'true',
      SCHEDULED_OPERATIONS_DISABLED_JOBS:'reservation_expiry,instruction_expiry,outbox_delivery,file_orphan_cleanup,staff_auth_cleanup,drive_archive',
      ACQUISITION_MAINTENANCE_ENABLED:'false',
      FEISHU_WORKBENCH_SYNC_ENABLED:'true',
      FEISHU_WORKBENCH_CALLBACK_ENABLED:'true',
      FEISHU_WORKBENCH_WEB_ORIGIN:origin,
      FEISHU_WORKBENCH_API_ORIGIN:'https://open.feishu.cn',
      FEISHU_WORKBENCH_APP_ID:'cli_anonymous_release',
      FEISHU_WORKBENCH_APP_SECRET:'anonymous-secret-value-at-least-thirty-two-characters',
      FEISHU_WORKBENCH_TENANT_KEY:'anonymous-tenant',
      FEISHU_WORKBENCH_ENCRYPT_KEY:'anonymous-encrypt-key-at-least-thirty-two-characters',
      FEISHU_WORKBENCH_VERIFICATION_TOKEN:'anonymous-verification-token',
      FEISHU_WORKBENCH_REQUEST_TIMEOUT_MS:'3000',
      FEISHU_WORKBENCH_MAX_ATTEMPTS:'3',
      FEISHU_WORKBENCH_RATE_LIMIT_PER_SECOND:'10',
      FEISHU_OPERATIONAL_ALERT_ENABLED:'true',
      FEISHU_OPERATIONAL_ALERT_CHAT_ID:'oc_anonymous_internal_alerts',
      FEISHU_OPERATIONAL_ALERT_RATE_LIMIT_PER_SECOND:'1',
    });
    expect((await worker.fetch(new Request(`${origin}/health`),env,executionContext)).status)
      .toBe(200);
    expect((await worker.fetch(new Request(`${origin}/health`),{
      ...env,FEISHU_WORKBENCH_APP_ID:'cli_different_app',
    },executionContext)).status).toBe(503);
    expect((await worker.fetch(new Request(`${origin}/health`),{
      ...env,FEISHU_OPERATIONAL_ALERT_CHAT_ID:'',
    },executionContext)).status).toBe(503);
  });
});

function bindings(): CloudflareWorkerBindings {
  return {
    APP_ENVIRONMENT: 'production',
    APP_ORIGIN: origin,
    APP_ALLOWED_ORIGINS: origin,
    DB: {
      prepare() { throw new Error('database_not_used'); },
      async batch() { throw new Error('database_not_used'); },
    },
    FILE_OBJECT_STORAGE_R2: new AnonymousR2Bucket(),
    WEB_ASSETS: {
      async fetch(request: Request) {
        return new URL(request.url).pathname.startsWith('/assets/')
          ? new Response('export {};', { headers: { 'Content-Type': 'text/javascript' } })
          : new Response('<!doctype html><div id="root"></div>', {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
      },
    },
    CUSTOMER_SESSION_SECRET: 'anonymous-secret-value',
    SCHEDULED_OPERATIONS_ENABLED: 'false',
    ACQUISITION_MAINTENANCE_ENABLED: 'false',
    DRIVE_ARCHIVE_ENABLED: 'false',
    DRIVE_ARCHIVE_COPY_ENABLED: 'false',
    DRIVE_ARCHIVE_PROXY_READ_ENABLED: 'false',
    DRIVE_ARCHIVE_R2_DELETE_ENABLED: 'false',
    FEISHU_WORKBENCH_SYNC_ENABLED: 'false',
    FEISHU_WORKBENCH_CALLBACK_ENABLED: 'false',
    FEISHU_OPERATIONAL_ALERT_ENABLED: 'false',
    STAFF_AUTH_ENABLED: 'false',
    STAFF_MCP_ENABLED: 'false',
    STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED: 'false',
    STAFF_MCP_LOCAL_MOCK_ENABLED: 'false',
    STAFF_MCP_CLEANUP_ENABLED: 'false',
    OPERATIONAL_ALERT_MODE: 'disabled',
  } as unknown as CloudflareWorkerBindings;
}

function enabledStaffAuthBindings(): CloudflareWorkerBindings {
  return {
    ...bindings(),
    STAFF_AUTH_ENABLED: 'true',
    STAFF_AUTH_PROVIDER: 'FEISHU',
    STAFF_AUTH_FEISHU_AUTHORIZATION_ENDPOINT:
      'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
    STAFF_AUTH_FEISHU_TOKEN_ENDPOINT:
      'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
    STAFF_AUTH_FEISHU_IDENTITY_ENDPOINT:
      'https://open.feishu.cn/open-apis/authen/v1/user_info',
    STAFF_AUTH_FEISHU_APP_ID: 'cli_anonymous_release',
    STAFF_AUTH_FEISHU_APP_SECRET: 'anonymous-secret-value',
    STAFF_AUTH_FEISHU_SCOPE: 'contact:user.base:readonly',
    STAFF_AUTH_FEISHU_TENANT_KEY: 'anonymous-tenant',
    STAFF_AUTH_FEISHU_REDIRECT_URI:
      `${origin}/api/staff-auth/feishu/callback`,
    STAFF_AUTH_ALLOWED_ORIGINS: origin,
    STAFF_AUTH_ALLOWED_RETURN_TO: '/staff',
    STAFF_AUTH_HASH_SECRET: 'h'.repeat(32),
    STAFF_AUTH_PROVIDER_ADAPTER: {
      createAuthorizationUrl: () => 'https://example.invalid',
    },
  } as unknown as CloudflareWorkerBindings;
}

function fetchWorker(pathname: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(
    new Request(`${origin}${pathname}`, init), bindings(), executionContext,
  );
}
