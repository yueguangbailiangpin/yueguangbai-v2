import { Hono, type Context } from 'hono';
import type { AppEnv } from '../app';
import { protectedResourceMetadata } from './oauth-resource-server';
import { staffMcpProductionRuntime } from './runtime';

const METADATA_PATH = '/.well-known/oauth-protected-resource/mcp';
const MCP_PATH = '/mcp';
const MAX_BODY_BYTES = 1024 * 1024;

export function registerStaffMcpTransportRoutes(app: Hono<AppEnv>): void {
  app.get(METADATA_PATH, (context) => {
    const runtime = staffMcpProductionRuntime(context.env);
    if (!runtime || !requestMatchesResource(context.req.raw, runtime.config.resource)) {
      return context.json({ error: 'not_found' }, 404);
    }
    return context.json(protectedResourceMetadata(runtime.config), 200, {
      'Cache-Control': 'public, max-age=300',
    });
  });

  app.post(MCP_PATH, async (context) => {
    const runtime = staffMcpProductionRuntime(context.env);
    if (!runtime || !requestMatchesResource(context.req.raw, runtime.config.resource)) {
      return context.json({ error: 'not_found' }, 404);
    }
    const metadataUrl = new URL(METADATA_PATH, runtime.config.resource).toString();
    if (!await runtime.cleanup.run(Date.now(), runtime.cleanupLimit)
      .then(() => true, () => false)) {
      return context.json(protocolError(null, -32000, 'Staff MCP 当前不可用'), 503);
    }
    if (!await runtime.controlStore.isGloballyEnabled().catch(() => false)) {
      return context.json(protocolError(null, -32000, 'Staff MCP 当前不可用'), 503);
    }
    const contentType = context.req.header('Content-Type') ?? '';
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)) {
      return context.json(protocolError(null, -32600, '请求必须为 JSON'), 415);
    }
    const contentLength = context.req.header('Content-Length');
    if (contentLength && (!/^\d{1,10}$/u.test(contentLength)
      || Number(contentLength) > MAX_BODY_BYTES)) {
      return context.json(protocolError(null, -32600, '请求体过大'), 413);
    }
    const accessToken = bearerToken(context.req.header('Authorization'));
    if (!accessToken) return unauthorized(context, metadataUrl);
    if (!await runtime.adapter.authenticate(accessToken)) {
      return unauthorized(context, metadataUrl);
    }
    const body = await context.req.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return context.json(protocolError(null, -32600, '请求体过大'), 413);
    }
    let request: unknown;
    try {
      request = JSON.parse(body) as unknown;
    } catch {
      return context.json(protocolError(null, -32700, 'JSON 解析失败'), 400);
    }
    if (Array.isArray(request)) {
      return context.json(protocolError(null, -32600, '不支持批量请求'), 400);
    }
    const response = await runtime.adapter.handleJsonRpc(
      request,
      accessToken,
      true,
    );
    return context.json(response);
  });
}

function bearerToken(value: string | undefined): string | null {
  if (!value || value.length > 20_000) return null;
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u.exec(value);
  return match?.[1] ?? null;
}

function requestMatchesResource(request: Request, resource: string): boolean {
  const actual = new URL(request.url);
  const expected = new URL(resource);
  return actual.protocol === 'https:'
    && actual.origin === expected.origin
    && !actual.search
    && !actual.hash;
}

function unauthorized(
  context: Context<AppEnv>,
  metadataUrl: string,
) {
  return context.json(
    protocolError(null, -32001, '员工身份不可用'),
    401,
    {
      'WWW-Authenticate': `Bearer resource_metadata="${metadataUrl}"`,
      'Cache-Control': 'no-store',
    },
  );
}

function protocolError(id: null, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id, error: { code, message } };
}
