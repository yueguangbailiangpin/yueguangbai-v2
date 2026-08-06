// @vitest-environment jsdom
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { FrontendApiError } from '../../api/errors';
import '../../test/msw/lifecycle';
import { apiUrl } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { BuyerMutationController } from './BuyerMutationController';

const endpoints = [
  '/api/buyer-portal/demands/d1/reservations',
  '/api/buyer-portal/reservations/r1/cancel',
  '/api/buyer-portal/order-evidence',
  '/api/buyer-portal/order-evidence/e1/resubmit',
  '/api/buyer-portal/order-evidence/e1/withdraw',
  '/api/buyer-portal/reviews',
  '/api/buyer-portal/reviews/v1/resubmit',
  '/api/buyer-portal/reviews/v1/withdraw',
] as const;

function controller() {
  let sequence = 0;
  return new BuyerMutationController<Record<string, unknown>, Response>(() => `buyer-operation-${++sequence}`);
}

describe('Buyer eight-operation idempotency controller', () => {
  it.each(endpoints)('sends a directly asserted key and unchanged body to %s', async (path) => {
    const seen: { key: string | null; body: unknown }[] = [];
    server.use(http.post(apiUrl(path), async ({ request }) => {
      seen.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() });
      return HttpResponse.json({ ok: true });
    }));
    const body = { expected_version: 3, operation: path };
    await controller().execute(body, (retained, key, signal) => fetch(apiUrl(path), {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(retained),
    }));
    expect(seen).toEqual([{ key: 'buyer-operation-1', body }]);
  });

  it('retries an ambiguous result with the same key and byte-equivalent body only after explicit retry', async () => {
    const target = controller();
    const calls: { key: string; body: string }[] = [];
    let attempt = 0;
    const operation = async (body: Record<string, unknown>, key: string): Promise<Response> => {
      calls.push({ key, body: JSON.stringify(body) });
      attempt += 1;
      if (attempt === 1) throw new FrontendApiError('NETWORK_FAILURE', 0, null, 'NETWORK');
      return new Response(null, { status: 200 });
    };
    await expect(target.execute({ expected_version: 2 }, operation)).rejects.toMatchObject({ code: 'NETWORK_FAILURE' });
    await expect(target.execute({ expected_version: 2 }, operation)).rejects.toMatchObject({ code: 'NETWORK_FAILURE' });
    expect(calls).toHaveLength(1);
    await target.retry();
    expect(calls).toEqual([
      { key: 'buyer-operation-1', body: '{"expected_version":2}' },
      { key: 'buyer-operation-1', body: '{"expected_version":2}' },
    ]);
  });

  it('coalesces repeated clicks and rotates authority after changed body, success, and 409', async () => {
    const target = controller();
    const keys: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow = async (_body: Record<string, unknown>, key: string): Promise<Response> => {
      keys.push(key); await gate; return new Response(null, { status: 200 });
    };
    const first = target.execute({ version: 1 }, slow);
    const repeat = target.execute({ version: 1 }, slow);
    expect(first).toBe(repeat);
    release(); await first;
    await target.execute({ version: 1 }, async (_body, key) => { keys.push(key); return new Response(); });
    await expect(target.execute({ version: 2 }, async (_body, key) => {
      keys.push(key); throw new FrontendApiError('VERSION_CONFLICT', 409, 'request-409', 'CONFLICT');
    })).rejects.toMatchObject({ httpStatus: 409 });
    await target.execute({ version: 2 }, async (_body, key) => { keys.push(key); return new Response(); });
    expect(keys).toEqual(['buyer-operation-1', 'buyer-operation-2', 'buyer-operation-3', 'buyer-operation-4']);
  });
});
