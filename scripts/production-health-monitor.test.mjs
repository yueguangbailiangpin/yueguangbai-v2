import { describe, expect, it, vi } from 'vitest';
import {
  HEALTH_ISSUE_TITLE,
  probeProductionHealth,
  reconcileHealthIssue,
} from './production-health-monitor.mjs';

const endpoint = 'https://app.example.test/health';

describe('independent production health monitor', () => {
  it('accepts only the bounded health envelope', async () => {
    const healthy = await probeProductionHealth({
      endpoint,
      fetchImpl: vi.fn(async () => Response.json({
        data: { status: 'ok', timestamp: 1 }, meta: { request_id: 'request-1' },
      })),
    });
    expect(healthy).toMatchObject({ healthy: true, reason: 'HEALTHY' });

    const malformed = await probeProductionHealth({
      endpoint,
      fetchImpl: vi.fn(async () => Response.json({ status: 'ok' })),
    });
    expect(malformed).toMatchObject({
      healthy: false, reason: 'MALFORMED_HEALTH_RESPONSE',
    });
  });

  it('maps HTTP and network failures to fixed low-cardinality reasons', async () => {
    await expect(probeProductionHealth({
      endpoint,
      fetchImpl: vi.fn(async () => new Response('', { status: 503 })),
    })).resolves.toMatchObject({ healthy: false, reason: 'HTTP_503' });
    await expect(probeProductionHealth({
      endpoint,
      fetchImpl: vi.fn(async () => { throw new Error('sensitive provider detail'); }),
    })).resolves.toMatchObject({ healthy: false, reason: 'NETWORK_OR_TIMEOUT' });
  });

  it('creates one issue for a failure and does not duplicate an open incident', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init = {}) => {
      calls.push({ url, init });
      if (String(url).includes('/issues?')) return Response.json([]);
      return Response.json({ number: 7, title: HEALTH_ISSUE_TITLE }, { status: 201 });
    });
    await expect(reconcileHealthIssue({
      fetchImpl,
      outcome: { healthy: false, reason: 'HTTP_503', checkedAt: 1 },
      repository: 'owner/repository', token: 'test-token',
    })).resolves.toEqual({ action: 'CREATED' });
    expect(JSON.parse(calls[1].init.body)).toMatchObject({ title: HEALTH_ISSUE_TITLE });
    expect(calls[1].init.headers.Authorization).toBe('Bearer test-token');

    const alreadyOpen = vi.fn(async () => Response.json([
      { number: 7, title: HEALTH_ISSUE_TITLE, state: 'open' },
    ]));
    await expect(reconcileHealthIssue({
      fetchImpl: alreadyOpen,
      outcome: { healthy: false, reason: 'HTTP_503', checkedAt: 2 },
      repository: 'owner/repository', token: 'test-token',
    })).resolves.toEqual({ action: 'ALREADY_OPEN' });
    expect(alreadyOpen).toHaveBeenCalledTimes(1);
  });

  it('records recovery and closes the open issue', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init = {}) => {
      calls.push({ url, init });
      if (String(url).includes('/issues?')) return Response.json([
        { number: 7, title: HEALTH_ISSUE_TITLE, state: 'open' },
      ]);
      return Response.json({ ok: true });
    });
    await expect(reconcileHealthIssue({
      fetchImpl,
      outcome: { healthy: true, reason: 'SIMULATED_RECOVERY', checkedAt: 3 },
      repository: 'owner/repository', token: 'test-token',
    })).resolves.toEqual({ action: 'CLOSED' });
    expect(JSON.parse(calls[2].init.body)).toEqual({
      state: 'closed', state_reason: 'completed',
    });
  });

  it('rejects cross-purpose endpoints before a network call', async () => {
    const fetchImpl = vi.fn();
    await expect(probeProductionHealth({
      endpoint: 'https://app.example.test/api/private', fetchImpl,
    })).rejects.toThrow('invalid_health_url');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
