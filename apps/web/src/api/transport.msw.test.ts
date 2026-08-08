// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import '../test/msw/lifecycle';
import { failureEnvelopeFixture } from '../test/msw/fixtures';
import { apiUrl } from '../test/msw/handlers';
import { server } from '../test/msw/server';
import { FrontendApiError } from './errors';
import { queryClient } from './query-client';
import { retryDelay, shouldRetryQuery } from './retry';
import { apiRequest } from './transport';

const okSchema = z.object({ ok: z.literal(true) }).strict();
const success = (requestId: string) => ({
  data: { ok: true },
  meta: { request_id: requestId },
});

describe('formal MSW API transport matrix', () => {
  it.each([
    ['GET', '/api/buyer-portal/me'],
    ['POST', '/api/customer-auth/buyer/login'],
    ['PUT', '/api/staff/assignment-fallbacks/JP'],
    ['PATCH', '/api/staff/me/availability'],
    ['DELETE', '/api/test/transport-delete'],
  ] as const)('%s sends credentials=include through fetch and returns request_id', async (method, path) => {
    let credentials: RequestCredentials | undefined;
    server.use(http.all(apiUrl(path), ({ request }) => {
      credentials = request.credentials;
      return HttpResponse.json(success(`request-${method.toLowerCase()}`));
    }));

    await expect(apiRequest({ path, method, schema: okSchema })).resolves.toEqual({
      data: { ok: true },
      requestId: `request-${method.toLowerCase()}`,
    });
    expect(credentials).toBe('include');
  });

  it('sends exact JSON, Content-Type, and a custom Idempotency-Key', async () => {
    const body = { current_password: 'old', new_password: 'new' };
    let received: unknown;
    let contentType: string | null = null;
    let idempotencyKey: string | null = null;
    server.use(http.post(apiUrl('/api/customer-auth/change-password'), async ({ request }) => {
      received = await request.json();
      contentType = request.headers.get('Content-Type');
      idempotencyKey = request.headers.get('Idempotency-Key');
      return HttpResponse.json(success('request-json'));
    }));

    await apiRequest({
      path: '/api/customer-auth/change-password',
      method: 'POST',
      schema: okSchema,
      body,
      headers: { 'Idempotency-Key': 'password-operation-1' },
    });
    expect(received).toEqual(body);
    expect(contentType).toBe('application/json');
    expect(idempotencyKey).toBe('password-operation-1');
  });

  it('preserves a trustworthy request_id when business data fails Zod', async () => {
    server.use(http.get(apiUrl('/api/customer-auth/session'), () => HttpResponse.json({
      data: { wrong: true },
      meta: { request_id: 'request-data-malformed' },
    })));
    await expect(apiRequest({
      path: '/api/customer-auth/session',
      method: 'GET',
      schema: z.object({ session: z.string() }).strict(),
    })).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE',
      requestId: 'request-data-malformed',
      category: 'CONTRACT',
    });
  });

  it('rejects a malformed top-level Success Envelope without trusting metadata', async () => {
    server.use(http.get(apiUrl('/api/customer-auth/session'), () => HttpResponse.json({
      data: { ok: true },
      meta: { request_id: 'request-success', extra: true },
    })));
    await expect(apiRequest({
      path: '/api/customer-auth/session', method: 'GET', schema: okSchema,
    })).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE', requestId: null });
  });

  it.each([
    [401, 'UNAUTHENTICATED', 'AUTHENTICATION'],
    [403, 'FORBIDDEN', 'PERMISSION'],
    [404, 'NOT_FOUND', 'NOT_FOUND'],
    [409, 'VERSION_CONFLICT', 'CONFLICT'],
    [422, 'VALIDATION_ERROR', 'VALIDATION'],
    [429, 'RATE_LIMITED', 'RATE_LIMIT'],
    [503, 'DEPENDENCY_UNAVAILABLE', 'DEPENDENCY'],
  ] as const)('normalizes %i Failure Envelope as %s/%s', async (status, code, category) => {
    server.use(http.get(apiUrl('/api/buyer-portal/me'), () => HttpResponse.json(
      failureEnvelopeFixture(code, 'safe public message', null, `request-${status}`),
      { status },
    )));
    await expect(apiRequest({
      path: '/api/buyer-portal/me', method: 'GET', schema: okSchema,
    })).rejects.toMatchObject({ code, httpStatus: status, category, requestId: `request-${status}` });
  });

  it('rejects malformed Failure Envelopes', async () => {
    server.use(http.get(apiUrl('/api/buyer-portal/me'), () => HttpResponse.json({
      error: { code: 'FORBIDDEN', message: 'no details member' },
      meta: { request_id: 'request-malformed-error' },
    }, { status: 403 })));
    await expect(apiRequest({
      path: '/api/buyer-portal/me', method: 'GET', schema: okSchema,
    })).rejects.toMatchObject({ code: 'MALFORMED_ERROR', requestId: null, category: 'CONTRACT' });
  });

  it('projects only code-approved safeDetails and never retains the raw details object', async () => {
    const details = {
      field: 'new_password',
      reason: 'too_short',
      stack: 'secret stack',
      sql: 'SELECT secret',
      query: 'raw query',
      cookie: 'session cookie',
      token: 'provider token',
      authorization: 'Bearer secret',
      object_key: 'private/object',
      signed_url: 'https://private.invalid',
      provider_response: { access_token: 'secret' },
      exception: { message: 'internal' },
    };
    server.use(http.post(apiUrl('/api/customer-auth/change-password'), () => HttpResponse.json(
      failureEnvelopeFixture('VALIDATION_ERROR', 'invalid', details, 'request-safe-details'),
      { status: 422 },
    )));

    const error = await apiRequest({
      path: '/api/customer-auth/change-password',
      method: 'POST',
      schema: okSchema,
      body: {},
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FrontendApiError);
    expect((error as FrontendApiError).safeDetails).toEqual({
      field: 'new_password', reason: 'too_short',
    });
    expect((error as FrontendApiError).safeDetails).not.toBe(details);
    expect(JSON.stringify((error as FrontendApiError).safeDetails)).not.toMatch(
      /stack|sql|query|cookie|token|authorization|object_key|signed_url|provider|exception|secret/iu,
    );
  });

  it('returns null safeDetails for an unapproved error code', async () => {
    server.use(http.get(apiUrl('/api/buyer-portal/me'), () => HttpResponse.json(
      failureEnvelopeFixture('FORBIDDEN', 'forbidden', { reason: 'internal', field: 'secret' }, 'request-no-details'),
      { status: 403 },
    )));
    await expect(apiRequest({
      path: '/api/buyer-portal/me', method: 'GET', schema: okSchema,
    })).rejects.toMatchObject({ safeDetails: null });
  });

  it('normalizes an aborted fetch as CANCELED', async () => {
    server.use(http.get(apiUrl('/api/customer-auth/session'), async () => {
      await delay('infinite');
      return HttpResponse.json(success('never'));
    }));
    const controller = new AbortController();
    const request = apiRequest({
      path: '/api/customer-auth/session', method: 'GET', schema: okSchema, signal: controller.signal,
    });
    controller.abort();
    await expect(request).rejects.toMatchObject({ code: 'CANCELED', category: 'CANCELED' });
  });

  it('normalizes an MSW network failure as NETWORK_FAILURE', async () => {
    server.use(http.get(apiUrl('/api/customer-auth/session'), () => HttpResponse.error()));
    await expect(apiRequest({
      path: '/api/customer-auth/session', method: 'GET', schema: okSchema,
    })).rejects.toMatchObject({ code: 'NETWORK_FAILURE', category: 'NETWORK' });
  });

  it.each(['https://example.test/api/customer-auth/session', '/api/v2/customer-auth/session'])
    ('rejects non-approved path %s before sending', async (path) => {
      await expect(apiRequest({ path, method: 'GET', schema: okSchema }))
        .rejects.toMatchObject({ code: 'INVALID_PATH', category: 'CONTRACT' });
    });
});

describe('formal Query retry policy', () => {
  it('retries approved GET NETWORK_FAILURE only twice and never sends a fourth request', async () => {
    let requests = 0;
    server.use(http.get(apiUrl('/api/customer-auth/session'), () => {
      requests += 1;
      return HttpResponse.error();
    }));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: shouldRetryQuery, retryDelay: 0 } },
    });
    await expect(client.fetchQuery({
      queryKey: ['transport', 'finite-network-retry'],
      queryFn: () => apiRequest({
        path: '/api/customer-auth/session', method: 'GET', schema: okSchema,
      }),
    })).rejects.toMatchObject({ code: 'NETWORK_FAILURE' });
    expect(requests).toBe(3);
  });

  it.each([
    ['AUTHENTICATION', 401], ['PERMISSION', 403], ['NOT_FOUND', 404],
    ['CONFLICT', 409], ['VALIDATION', 422], ['RATE_LIMIT', 429],
    ['DEPENDENCY', 503], ['CANCELED', 0], ['CONTRACT', 200],
  ] as const)('does not retry %s errors', (category, status) => {
    expect(shouldRetryQuery(0, new FrontendApiError('TEST', status, 'request-retry', category, 60_000))).toBe(false);
  });

  it('fails closed for unknown JavaScript exceptions', () => {
    expect(shouldRetryQuery(0, new Error('unknown'))).toBe(false);
  });

  it('keeps mutation retry disabled and Retry-After unable to override eligibility', () => {
    expect(queryClient.getDefaultOptions().mutations?.retry).toBe(false);
    const rateLimit = new FrontendApiError('RATE_LIMITED', 429, 'request-rate', 'RATE_LIMIT', 60_000);
    expect(retryDelay(0, rateLimit)).toBe(60_000);
    expect(shouldRetryQuery(0, rateLimit)).toBe(false);
  });
});
