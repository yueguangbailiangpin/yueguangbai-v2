import { describe, expect, it } from 'vitest';
import { AnonymousR2Bucket } from '../test-support/anonymous-r2-binding';
import worker from './worker';
import {
  isAllowedSameOriginApiRequest,
  resolveCloudflareRuntime,
  type CloudflareWorkerBindings,
} from './cloudflare-runtime';

const origin='https://release.example.invalid';
const executionContext={waitUntil(){},passThroughOnException(){},props:{}};

describe('production Cloudflare Worker runtime',()=>{
  it('routes API to Hono and serves SPA content with security headers',async()=>{
    const health=await fetchWorker('/health');
    expect(health.status).toBe(200);
    expect(health.headers.get('content-type')).toContain('application/json');
    expect(health.headers.get('strict-transport-security')).toContain('max-age=31536000');
    const readiness=await fetchWorker('/ready');
    expect(readiness.status).toBe(503);
    expect(readiness.headers.get('content-type')).toContain('application/json');
    expect(await readiness.text()).not.toContain('<!doctype html>');
    const missing=await fetchWorker('/api/not-registered');
    expect(missing.status).toBe(404);
    expect(await missing.text()).not.toContain('<!doctype html>');
    const page=await fetchWorker('/staff/acquisition');
    expect(await page.text()).toContain('<div id="root"></div>');
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(page.headers.get('cache-control')).toBe('no-cache');
    const asset=await fetchWorker('/assets/app.js');
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('denies every cross-origin or cross-site API request',()=>{
    expect(isAllowedSameOriginApiRequest(new Request(`${origin}/api/staff-auth/session`),origin)).toBe(true);
    for(const request of [
      new Request(`${origin}/api/staff-auth/session`,{headers:{Origin:'https://attacker.invalid'}}),
      new Request(`${origin}/api/staff-auth/access/bootstrap`,{method:'POST',headers:{'Sec-Fetch-Site':'cross-site'}}),
      new Request('https://wrong-host.invalid/health'),
    ])expect(isAllowedSameOriginApiRequest(request,origin)).toBe(false);
  });

  it('uses only Cloudflare Access plus Moonwhite Staff DB configuration',()=>{
    const runtime=resolveCloudflareRuntime(bindings());
    expect(runtime).not.toBeNull();
    expect(runtime?.appBindings).toMatchObject({
      STAFF_ACCESS_TEAM_DOMAIN:'https://moonwhite.cloudflareaccess.com',
      STAFF_ACCESS_AUD:'staff-access-audience-001',
      STAFF_AUTH_ALLOWED_ORIGINS:origin,
    });
    expect(JSON.stringify(runtime?.appBindings)).not.toMatch(/FEISHU|STAFF_AUTH_PROVIDER/u);
  });

  it('fails closed on missing or placeholder release dependencies',async()=>{
    const cases=[
      {...bindings(),FILE_OBJECT_STORAGE_R2:undefined},
      {...bindings(),APP_ORIGIN:'REQUIRED_PRODUCTION_HTTPS_ORIGIN'},
      {...bindings(),STAFF_ACCESS_TEAM_DOMAIN:'REQUIRED_ACCESS_DOMAIN'},
      {...bindings(),STAFF_ACCESS_AUD:'short'},
      {...bindings(),STAFF_AUTH_ALLOWED_ORIGINS:'https://other.invalid'},
      {...bindings(),SCHEDULED_OPERATIONS_ENABLED:'invalid'},
      {...bindings(),ACQUISITION_MAINTENANCE_ENABLED:undefined},
      {...bindings(),STAFF_MCP_ENABLED:'true'},
    ] as unknown as CloudflareWorkerBindings[];
    for(const env of cases){
      const response=await worker.fetch(new Request(`${origin}/health`),env,executionContext);
      expect(response.status).toBe(503);
      expect(await response.text()).not.toMatch(/REQUIRED|staff-access-audience/u);
    }
  });

  it('allows scheduler and acquisition maintenance independently of retired Feishu integration',()=>{
    expect(resolveCloudflareRuntime({...bindings(),SCHEDULED_OPERATIONS_ENABLED:'true',ACQUISITION_MAINTENANCE_ENABLED:'true'})).not.toBeNull();
    expect(resolveCloudflareRuntime({...bindings(),SCHEDULED_OPERATIONS_ENABLED:'false',ACQUISITION_MAINTENANCE_ENABLED:'true'})).not.toBeNull();
  });
});

function bindings():CloudflareWorkerBindings{return {
  APP_ENVIRONMENT:'production',APP_ORIGIN:origin,APP_ALLOWED_ORIGINS:origin,
  DB:{prepare(){throw new Error('database_not_used')},async batch(){throw new Error('database_not_used')}},
  FILE_OBJECT_STORAGE_R2:new AnonymousR2Bucket(),
  WEB_ASSETS:{async fetch(request:Request){return new URL(request.url).pathname.startsWith('/assets/')?new Response('export {};',{headers:{'Content-Type':'text/javascript'}}):new Response('<!doctype html><div id="root"></div>',{headers:{'Content-Type':'text/html; charset=utf-8'}})}},
  STAFF_ACCESS_TEAM_DOMAIN:'https://moonwhite.cloudflareaccess.com',
  STAFF_ACCESS_AUD:'staff-access-audience-001',STAFF_AUTH_ALLOWED_ORIGINS:origin,
  SCHEDULED_OPERATIONS_ENABLED:'false',ACQUISITION_MAINTENANCE_ENABLED:'false',
  DRIVE_ARCHIVE_ENABLED:'false',DRIVE_ARCHIVE_COPY_ENABLED:'false',DRIVE_ARCHIVE_PROXY_READ_ENABLED:'false',DRIVE_ARCHIVE_R2_DELETE_ENABLED:'false',
  STAFF_MCP_ENABLED:'false',STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED:'false',STAFF_MCP_LOCAL_MOCK_ENABLED:'false',STAFF_MCP_CLEANUP_ENABLED:'false',
  OPERATIONAL_ALERT_MODE:'disabled',
};}
function fetchWorker(pathname:string,init?:RequestInit):Promise<Response>{return worker.fetch(new Request(`${origin}${pathname}`,init),bindings(),executionContext);}
