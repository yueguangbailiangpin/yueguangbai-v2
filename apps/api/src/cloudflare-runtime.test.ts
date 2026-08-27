import { describe, expect, it } from 'vitest';
import { createMigratedTestDatabase } from '@ygb/testkit';
import { AnonymousR2Bucket } from '../test-support/anonymous-r2-binding';
import { hashCanonicalJson, operationalAlertDescriptorFromRuntime } from '@ygb/domain';
import worker from './worker';
import {
  isAllowedSameOriginApiRequest,
  resolveCloudflareRuntime,
  type CloudflareWorkerBindings,
} from './cloudflare-runtime';

const origin = 'https://release.example.invalid';
const executionContext = { waitUntil() {}, passThroughOnException() {}, props: {} };
const alertDescriptor = operationalAlertDescriptorFromRuntime({
  serviceTarget: 'ygb-operational-alerts',
  entrypoint: 'OperationalAlertSinkEntrypoint',
  sinkIdentity: 'service:operations-primary',
  sinkDeploymentVersion: 'deploy-001',
})!;
const alertFingerprint = await hashCanonicalJson(alertDescriptor);

describe('production Cloudflare Worker runtime', () => {
  it('routes API to Hono and serves SPA content with security headers', async () => {
    const health = await fetchWorker('/health');
    expect(health.status).toBe(200);
    expect(health.headers.get('content-type')).toContain('application/json');
    expect(health.headers.get('strict-transport-security')).toContain('max-age=31536000');
    const readiness = await fetchWorker('/ready');
    expect(readiness.status).toBe(503);
    expect(readiness.headers.get('content-type')).toContain('application/json');
    expect(await readiness.text()).not.toContain('<!doctype html>');
    const missing = await fetchWorker('/api/not-registered');
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain('<!doctype html>');
    const page = await fetchWorker('/staff/acquisition');
    expect(await page.text()).toContain('<div id="root"></div>');
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(page.headers.get('cache-control')).toBe('no-cache');
    const asset = await fetchWorker('/assets/app.js');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('denies every cross-origin or cross-site API request', () => {
    expect(
      isAllowedSameOriginApiRequest(new Request(`${origin}/api/staff-auth/session`), origin),
    ).toBe(true);
    for (const request of [
      new Request(`${origin}/api/staff-auth/session`, {
        headers: { Origin: 'https://attacker.invalid' },
      }),
      new Request(`${origin}/api/staff-auth/access/bootstrap`, {
        method: 'POST',
        headers: { 'Sec-Fetch-Site': 'cross-site' },
      }),
      new Request('https://wrong-host.invalid/health'),
    ])
      expect(isAllowedSameOriginApiRequest(request, origin)).toBe(false);
  });

  it('uses only Cloudflare Access plus Moonwhite Staff DB configuration', async () => {
    const runtime = await resolveCloudflareRuntime(bindings());
    expect(runtime).not.toBeNull();
    expect(runtime?.appBindings).toMatchObject({
      STAFF_ACCESS_TEAM_DOMAIN: 'https://moonwhite.cloudflareaccess.com',
      STAFF_ACCESS_AUD: 'staff-access-audience-001',
      STAFF_AUTH_ALLOWED_ORIGINS: origin,
    });
    expect(JSON.stringify(runtime?.appBindings)).not.toMatch(/FEISHU|STAFF_AUTH_PROVIDER/u);
  });

  it('fails closed on missing or placeholder release dependencies', async () => {
    const cases = [
      { ...bindings(), FILE_OBJECT_STORAGE_R2: undefined },
      { ...bindings(), APP_ORIGIN: 'REQUIRED_PRODUCTION_HTTPS_ORIGIN' },
      { ...bindings(), STAFF_ACCESS_TEAM_DOMAIN: 'REQUIRED_ACCESS_DOMAIN' },
      { ...bindings(), STAFF_ACCESS_TEAM_DOMAIN: origin },
      { ...bindings(), STAFF_ACCESS_TEAM_DOMAIN: 'https://arbitrary.example.com' },
      { ...bindings(), STAFF_ACCESS_TEAM_DOMAIN: 'https://nested.team.cloudflareaccess.com' },
      { ...bindings(), STAFF_ACCESS_AUD: 'short' },
      { ...bindings(), STAFF_AUTH_ALLOWED_ORIGINS: 'https://other.invalid' },
      { ...bindings(), SCHEDULED_OPERATIONS_ENABLED: 'invalid' },
      { ...bindings(), OPERATIONAL_ALERT_MODE: 'disabled' },
      { ...bindings(), OPERATIONAL_ALERT_SINK: undefined },
      { ...bindings(), APP_RELEASE_SHA: undefined },
      { ...bindings(), APP_RELEASE_SHA: 'abc1234' },
      { ...bindings(), APP_RELEASE_SHA: 'g'.repeat(40) },
      { ...bindings(), APP_RELEASE_SHA: 'REQUIRED_RELEASE_COMMIT_SHA' },
      { ...bindings(), OPERATIONAL_ALERT_SINK_SERVICE: 'ygb-operational-alerts-other' },
      { ...bindings(), OPERATIONAL_ALERT_SINK_ENTRYPOINT: 'OtherEntrypoint' },
      { ...bindings(), OPERATIONAL_ALERT_SINK_IDENTITY: 'REQUIRED_ALERT_SINK' },
      { ...bindings(), OPERATIONAL_ALERT_SINK_DEPLOYMENT_VERSION: 'deploy-002' },
      { ...bindings(), OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT: 'not-a-sha256' },
      { ...bindings(), STAFF_MCP_ENABLED: 'false' },
    ] as unknown as CloudflareWorkerBindings[];
    for (const env of cases) {
      const response = await worker.fetch(new Request(`${origin}/health`), env, executionContext);
      expect(response.status).toBe(503);
      expect(await response.text()).not.toMatch(/REQUIRED|staff-access-audience/u);
    }
  });

  it('uses the canonical entrypoint descriptor at runtime and rejects stale fingerprints', async () => {
    const named = operationalAlertDescriptorFromRuntime({
      serviceTarget: 'ygb-operational-alerts',
      entrypoint: '$sink',
      sinkIdentity: 'service:operations-primary',
      sinkDeploymentVersion: 'deploy-001',
    })!;
    const namedFingerprint = await hashCanonicalJson(named);
    expect(
      await resolveCloudflareRuntime({
        ...bindings(),
        OPERATIONAL_ALERT_SINK_ENTRYPOINT: '$sink',
        OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT: namedFingerprint,
      }),
    ).not.toBeNull();
    expect(
      await resolveCloudflareRuntime({ ...bindings(), OPERATIONAL_ALERT_SINK_ENTRYPOINT: '$sink' }),
    ).toBeNull();
    const missing = bindings();
    delete missing.OPERATIONAL_ALERT_SINK_ENTRYPOINT;
    expect(await resolveCloudflareRuntime(missing)).toBeNull();
    for (const entrypoint of [' white', 'with.dot']) {
      expect(
        await resolveCloudflareRuntime({
          ...bindings(),
          OPERATIONAL_ALERT_SINK_ENTRYPOINT: entrypoint,
        }),
      ).toBeNull();
    }
  });

  it('allows scheduler and acquisition maintenance independently of retired Feishu integration', async () => {
    expect(
      await resolveCloudflareRuntime({
        ...bindings(),
        SCHEDULED_OPERATIONS_ENABLED: 'true',
      }),
    ).not.toBeNull();
    expect(
      await resolveCloudflareRuntime({
        ...bindings(),
        SCHEDULED_OPERATIONS_ENABLED: 'false',
      }),
    ).not.toBeNull();
  });

  it('adapts the production R2 binding before scheduled file cleanup runs', async () => {
    const database = createMigratedTestDatabase();
    try {
      const pending: Promise<unknown>[] = [];
      await worker.scheduled(
        { scheduledTime: 2_000_000_000 },
        {
          ...bindings(),
          DB: database,
          SCHEDULED_OPERATIONS_ENABLED: 'true',
          SCHEDULED_OPERATIONS_DISABLED_JOBS:
            'reservation_expiry,instruction_expiry,outbox_delivery',
        },
        {
          waitUntil(promise) {
            pending.push(promise);
          },
        },
      );
      await Promise.all(pending);
      expect(
        await database
          .prepare(
            "SELECT last_succeeded_at,last_failure_category FROM scheduled_job_states WHERE job_name='file_orphan_cleanup'",
          )
          .first(),
      ).toEqual({ last_succeeded_at: 2_000_000_000, last_failure_category: null });
    } finally {
      database.close();
    }
  });
});

function bindings(): CloudflareWorkerBindings {
  return {
    APP_ENVIRONMENT: 'production',
    APP_ORIGIN: origin,
    APP_ALLOWED_ORIGINS: origin,
    APP_RELEASE_SHA: 'a'.repeat(40),
    DB: {
      prepare() {
        throw new Error('database_not_used');
      },
      async batch() {
        throw new Error('database_not_used');
      },
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
    STAFF_ACCESS_TEAM_DOMAIN: 'https://moonwhite.cloudflareaccess.com',
    STAFF_ACCESS_AUD: 'staff-access-audience-001',
    STAFF_AUTH_ALLOWED_ORIGINS: origin,
    SCHEDULED_OPERATIONS_ENABLED: 'false',
    ARCHIVE_SELECTOR_ENABLED: 'false',
    ARCHIVE_DRIVE_UPLOAD_ENABLED: 'false',
    ARCHIVE_HOT_DELETE_ENABLED: 'false',
    ARCHIVE_RESTORE_WORKER_ENABLED: 'false',
    OPERATIONAL_ALERT_MODE: 'bound',
    OPERATIONAL_ALERT_SINK: {
      async notify() {},
      async verifyOperationalAlertChallenge() {
        return null;
      },
    },
    OPERATIONAL_ALERT_SINK_SERVICE: 'ygb-operational-alerts',
    OPERATIONAL_ALERT_SINK_ENTRYPOINT: 'OperationalAlertSinkEntrypoint',
    OPERATIONAL_ALERT_SINK_IDENTITY: 'service:operations-primary',
    OPERATIONAL_ALERT_SINK_DEPLOYMENT_VERSION: 'deploy-001',
    OPERATIONAL_ALERT_SINK_CONFIG_FINGERPRINT: alertFingerprint,
  };
}
function fetchWorker(pathname: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`${origin}${pathname}`, init), bindings(), executionContext);
}
