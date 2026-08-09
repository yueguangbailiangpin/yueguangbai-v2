import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { createApp, type AppBindings } from '../app';
import { registerStaffMcpTransportRoutes } from './transport';
import { staffMcpProductionRuntime } from './runtime';
import {
  ANONYMOUS_HASH_SECRET,
  ANONYMOUS_OAUTH_CONFIG,
  AnonymousDocumentProvider,
  AnonymousTokenStatusService,
  anonymousSigningFixture,
  seedAnonymousBinding,
  signAnonymousToken,
} from './test-helpers';

describe('Staff MCP HTTPS JSON-RPC transport', () => {
  let database: SqliteDatabase;
  let fixture: Awaited<ReturnType<typeof anonymousSigningFixture>>;
  beforeAll(async () => { fixture = await anonymousSigningFixture(); });
  beforeEach(async () => {
    database = createMigratedTestDatabase();
    await seedAnonymousBinding(database);
  });
  afterEach(() => database.close());

  it('serves RFC 9728 metadata without authentication and no Secret values', async () => {
    const response = await request(
      '/.well-known/oauth-protected-resource/mcp',
      undefined,
      bindings(),
    );
    expect(response.status).toBe(200);
    const serialized = await response.text();
    expect(JSON.parse(serialized)).toEqual({
      resource: ANONYMOUS_OAUTH_CONFIG.resource,
      authorization_servers: [ANONYMOUS_OAUTH_CONFIG.issuer],
      scopes_supported: ['staff:mcp'],
      bearer_methods_supported: ['header'],
      resource_name: 'Yueguangbai Staff MCP',
    });
    expect(serialized).not.toContain(ANONYMOUS_HASH_SECRET);
  });

  it('challenges missing/invalid bearer and accepts anonymous initialize', async () => {
    await enableGlobal();
    const missing = await request('/mcp', jsonRequest({
      jsonrpc: '2.0', id: 1, method: 'initialize', params: {},
    }), bindings());
    expect(missing.status).toBe(401);
    expect(missing.headers.get('WWW-Authenticate')).toBe(
      'Bearer resource_metadata="https://staff-mcp.invalid/.well-known/oauth-protected-resource/mcp"',
    );
    const token = await signAnonymousToken(
      fixture.privateKey,
      fixture.kid,
      liveClaims(),
    );
    const accepted = await request('/mcp', jsonRequest({
      jsonrpc: '2.0', id: 2, method: 'initialize', params: {},
    }, token), bindings());
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: { capabilities: { tools: { listChanged: false } } },
    });
    const list = await request('/mcp', jsonRequest({
      jsonrpc: '2.0', id: 3, method: 'tools/list', params: {},
    }, token), bindings());
    const listed = await list.json() as { result: { tools: { name: string }[] } };
    expect(listed.result.tools).toHaveLength(11);
    expect(listed.result.tools.map((tool) => tool.name))
      .not.toContain('read_task_screenshot_v1');
    expect(listed.result.tools.map((tool) => tool.name))
      .not.toContain('list_staff_exceptions_v1');
    expect(staffMcpProductionRuntime(bindings())?.productionActivationSupported)
      .toBe(true);
  });

  it('rejects method/content/batch/body violations and keeps Web health independent', async () => {
    await enableGlobal();
    const env = bindings();
    expect((await request('/mcp', { method: 'GET' }, env)).status).toBe(404);
    expect((await request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    }, env)).status).toBe(415);
    const token = await signAnonymousToken(
      fixture.privateKey,
      fixture.kid,
      liveClaims(),
    );
    expect((await request('/mcp', jsonRequest([], token), env)).status).toBe(400);

    const disabled = { ...env, STAFF_MCP_ENABLED: 'false' };
    expect((await request('/mcp', jsonRequest({}, token), disabled)).status).toBe(404);
    const cleanupDisabled = { ...env, STAFF_MCP_CLEANUP_ENABLED: 'false' };
    expect((await request('/mcp', jsonRequest({}, token), cleanupDisabled)).status)
      .toBe(404);
    const app = createApp();
    registerStaffMcpTransportRoutes(app);
    expect((await app.request('https://staff-mcp.invalid/health', {}, disabled)).status)
      .toBe(200);
  });

  it('fails closed when bounded cleanup is unavailable while health stays online', async () => {
    await enableGlobal();
    const env = bindings();
    env.DB = {
      prepare: database.prepare.bind(database),
      async batch() { throw new Error('anonymous_cleanup_outage'); },
    };
    const token = await signAnonymousToken(fixture.privateKey, fixture.kid, liveClaims());
    expect((await request('/mcp', jsonRequest({
      jsonrpc: '2.0', id: 4, method: 'initialize', params: {},
    }, token), env)).status).toBe(503);
    const app = createApp();
    expect((await app.request('https://staff-mcp.invalid/health', {}, env)).status)
      .toBe(200);
  });

  function bindings(): AppBindings {
    return {
      DB: database,
      STAFF_MCP_ENABLED: 'true',
      STAFF_MCP_PRODUCTION_TRANSPORT_ENABLED: 'true',
      STAFF_MCP_LOCAL_MOCK_ENABLED: 'false',
      STAFF_MCP_CLEANUP_ENABLED: 'true',
      STAFF_MCP_RESOURCE: ANONYMOUS_OAUTH_CONFIG.resource,
      STAFF_MCP_OAUTH_AUDIENCE: ANONYMOUS_OAUTH_CONFIG.audience,
      STAFF_MCP_OAUTH_ISSUER: ANONYMOUS_OAUTH_CONFIG.issuer,
      STAFF_MCP_OAUTH_METADATA_URL: ANONYMOUS_OAUTH_CONFIG.metadataUrl,
      STAFF_MCP_OAUTH_AUTHORIZATION_ENDPOINT:
        ANONYMOUS_OAUTH_CONFIG.authorizationEndpoint,
      STAFF_MCP_OAUTH_TOKEN_ENDPOINT: ANONYMOUS_OAUTH_CONFIG.tokenEndpoint,
      STAFF_MCP_OAUTH_JWKS_URI: ANONYMOUS_OAUTH_CONFIG.jwksUri,
      STAFF_MCP_OAUTH_REVOCATION_ENDPOINT:
        ANONYMOUS_OAUTH_CONFIG.revocationEndpoint,
      STAFF_MCP_BINDING_HASH_SECRET: ANONYMOUS_HASH_SECRET,
      STAFF_MCP_OAUTH_DOCUMENT_PROVIDER: new AnonymousDocumentProvider(fixture.jwk),
      STAFF_MCP_TOKEN_STATUS_SERVICE: new AnonymousTokenStatusService(),
    };
  }

  async function enableGlobal() {
    await database.prepare(`
      UPDATE staff_mcp_runtime_controls SET
        enabled=1,version=version+1,reason_code='LOCAL_TEST',updated_at=updated_at+1
      WHERE control_type='GLOBAL' AND control_name='staff-mcp'
    `).run();
  }
});

function jsonRequest(value: unknown, token?: string): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(value),
  };
}

function request(path: string, init: RequestInit | undefined, env: AppBindings) {
  const app = createApp();
  registerStaffMcpTransportRoutes(app);
  return app.request(`${new URL(ANONYMOUS_OAUTH_CONFIG.resource).origin}${path}`, init, env);
}

function liveClaims() {
  const now = Math.floor(Date.now() / 1000);
  return { iat: now, nbf: now, exp: now + 600 };
}
