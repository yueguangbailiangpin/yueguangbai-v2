import { describe, expect, it } from 'vitest';
import { FrontendApiError } from '../../api/errors';
import {
  StaffMutationAuthority,
  staffMutationSignature,
  type StaffMutationRequest,
} from './StaffMutationAuthority';

const networkFailure = () => new FrontendApiError(
  'NETWORK_FAILURE', 0, 'network-request', 'NETWORK',
);
const versionConflict = () => new FrontendApiError(
  'VERSION_CONFLICT', 409, 'version-request', 'CONFLICT',
);

describe('Staff mutation idempotency authority', () => {
  it('replays an ambiguous original request with the exact key and cloned body', async () => {
    const calls: Array<{ key: string; request: StaffMutationRequest }> = [];
    let attempt = 0;
    const authority = new StaffMutationAuthority<string>(() => 'key-original');
    const body = { expected_version: 2, reason: '原始原因' };
    const request = { action: 'approve', path: '/api/staff/reviews/review-1/approve', body };
    const operation = async (value: StaffMutationRequest, key: string) => {
      calls.push({ key, request: structuredClone(value) });
      if (attempt++ === 0) throw networkFailure();
      return 'ok';
    };
    await expect(authority.execute(request, operation)).rejects.toMatchObject({ code: 'NETWORK_FAILURE' });
    body.reason = '员工随后修改但未提交';
    await expect(authority.retry()).resolves.toBe('ok');
    expect(calls).toEqual([
      { key: 'key-original', request: { ...request, body: { expected_version: 2, reason: '原始原因' } } },
      { key: 'key-original', request: { ...request, body: { expected_version: 2, reason: '原始原因' } } },
    ]);
  });

  it('uses a new key after deterministic failure and whenever the body changes', async () => {
    const keys = ['key-1', 'key-2', 'key-3']; let index = 0;
    const authority = new StaffMutationAuthority<string>(() => keys[index++]!);
    const seen: string[] = [];
    const fail = async (_request: StaffMutationRequest, key: string) => { seen.push(key); throw versionConflict(); };
    const pass = async (_request: StaffMutationRequest, key: string) => { seen.push(key); return 'ok'; };
    const base = { action: 'approve', path: '/api/staff/order-evidence/evidence-1/approve', body: { expected_version: 1 } };
    await expect(authority.execute(base, fail)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(authority.canRetry()).toBe(false);
    await expect(authority.execute(base, pass)).resolves.toBe('ok');
    await expect(authority.execute({ ...base, body: { expected_version: 2 } }, pass)).resolves.toBe('ok');
    expect(seen).toEqual(['key-1', 'key-2', 'key-3']);
  });

  it('never shares authority across payment, reversal and allocation actions', async () => {
    const keys = ['payment-key', 'reversal-key', 'allocation-key']; let index = 0;
    const authority = new StaffMutationAuthority<string>(() => keys[index++]!);
    const seen: Array<{ action: string; path: string; key: string }> = [];
    const ambiguous = async (request: StaffMutationRequest, key: string) => {
      seen.push({ action: request.action, path: request.path, key }); throw networkFailure();
    };
    const pass = async (request: StaffMutationRequest, key: string) => {
      seen.push({ action: request.action, path: request.path, key }); return 'ok';
    };
    await expect(authority.execute({ action: 'payment', path: '/refunds/1/payments', body: { amount: '100' } }, ambiguous)).rejects.toMatchObject({ code: 'NETWORK_FAILURE' });
    await authority.execute({ action: 'reversal', path: '/refunds/1/payments/2/reversals', body: { amount: '100' } }, pass);
    await authority.execute({ action: 'allocation', path: '/seller-payments/3/allocations', body: { amount: '100' } }, pass);
    expect(seen.map(({ key }) => key)).toEqual(keys);
    expect(new Set(seen.map(({ key }) => key)).size).toBe(3);
  });

  it('binds stable body bytes together with exact action and path', () => {
    const left = { action: 'approve', path: '/reviews/1/approve', body: { b: 2, a: 1 } };
    const reordered = { action: 'approve', path: '/reviews/1/approve', body: { a: 1, b: 2 } };
    expect(staffMutationSignature(left)).toBe(staffMutationSignature(reordered));
    expect(staffMutationSignature({ ...left, action: 'reject' })).not.toBe(staffMutationSignature(left));
    expect(staffMutationSignature({ ...left, path: '/reviews/2/approve' })).not.toBe(staffMutationSignature(left));
  });
});
