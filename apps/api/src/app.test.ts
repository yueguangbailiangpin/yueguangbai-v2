import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('API application foundation', () => {
  it('returns a structured health response and security headers', async () => {
    const app = createApp();
    const response = await app.request('https://local.test/health');

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toBe('no-store');

    const body = await response.json();
    expect(body).toMatchObject({
      data: { status: 'ok' },
      meta: { request_id: response.headers.get('x-request-id') },
    });
    expect(Number.isSafeInteger(body.data.timestamp)).toBe(true);
  });

  it('returns a stable not-found contract', async () => {
    const app = createApp();
    const response = await app.request('https://local.test/missing');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'NOT_FOUND',
        message: '请求的资源不存在',
        details: null,
      },
    });
  });

  it('does not expose raw exception messages or stack traces', async () => {
    const app = createApp();
    app.get('/test-error', () => {
      throw new Error('private-secret-value');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await app.request('https://local.test/test-error');
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(serialized).not.toContain('private-secret-value');
    expect(serialized).not.toContain('stack');
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).not.toContain('private-secret-value');
  });
});
