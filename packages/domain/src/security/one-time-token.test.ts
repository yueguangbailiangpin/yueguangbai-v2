import { describe, expect, it } from 'vitest';
import {
  deriveOneTimeToken,
  hashOneTimeToken,
  isOneTimeToken,
} from './one-time-token';

describe('one-time security tokens', () => {
  it('derives a stable 256-bit token per idempotent command without storing it', async () => {
    const secret = 's'.repeat(32);
    const first = await deriveOneTimeToken(
      secret, 'BUYER_INVITATION', 'staff-1', 'idem-key-123', 'a'.repeat(64),
    );
    const replay = await deriveOneTimeToken(
      secret, 'BUYER_INVITATION', 'staff-1', 'idem-key-123', 'a'.repeat(64),
    );
    const other = await deriveOneTimeToken(
      secret, 'PASSWORD_RESET', 'staff-1', 'idem-key-123', 'a'.repeat(64),
    );

    expect(first).toBe(replay);
    expect(first).not.toBe(other);
    expect(isOneTimeToken(first)).toBe(true);
    expect(await hashOneTimeToken(first)).toMatch(/^[0-9a-f]{64}$/u);
    await expect(hashOneTimeToken('not-a-token')).rejects.toThrow();
  });
});
