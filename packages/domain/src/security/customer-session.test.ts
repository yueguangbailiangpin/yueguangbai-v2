import { describe, expect, it } from 'vitest';
import {
  createCustomerSessionPayload,
  signCustomerSession,
  verifyCustomerSession,
} from './customer-session';

const SECRET = 'test-session-secret-that-is-longer-than-32-bytes';

describe('customer session codec', () => {
  it('signs and verifies a bounded session payload', async () => {
    const payload = createCustomerSessionPayload({
      accountId: 'account-1',
      identitySubjectId: 'subject-1',
      accountType: 'BUYER',
      sessionVersion: 3,
      now: 1000,
      ttlMs: 60_000,
    });
    const token = await signCustomerSession(payload, SECRET);

    await expect(verifyCustomerSession(
      token,
      SECRET,
      30_000,
    )).resolves.toEqual(payload);
  });

  it('rejects tampering, expiry, and the wrong secret', async () => {
    const payload = createCustomerSessionPayload({
      accountId: 'account-1',
      identitySubjectId: 'subject-1',
      accountType: 'SELLER_MEMBER',
      sessionVersion: 1,
      now: 1000,
      ttlMs: 60_000,
    });
    const token = await signCustomerSession(payload, SECRET);
    const tampered = `${token.slice(0, -1)}x`;

    await expect(verifyCustomerSession(
      tampered,
      SECRET,
      2000,
    )).resolves.toBeNull();
    await expect(verifyCustomerSession(
      token,
      'another-test-session-secret-longer-than-32-bytes',
      2000,
    )).resolves.toBeNull();
    await expect(verifyCustomerSession(
      token,
      SECRET,
      61_000,
    )).resolves.toBeNull();
  });

  it('rejects secrets shorter than 32 bytes', async () => {
    const payload = createCustomerSessionPayload({
      accountId: 'account-1',
      identitySubjectId: 'subject-1',
      accountType: 'BUYER',
      sessionVersion: 1,
      now: 1000,
      ttlMs: 60_000,
    });

    await expect(signCustomerSession(payload, 'too-short'))
      .rejects.toThrow('customer_session_secret_too_short');
  });
});
