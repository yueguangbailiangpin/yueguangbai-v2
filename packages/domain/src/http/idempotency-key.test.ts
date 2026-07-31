import { describe, expect, it } from 'vitest';
import { parseIdempotencyKey } from './idempotency-key';

describe('Idempotency-Key', () => {
  it('accepts the published character set and trims edges', () => {
    expect(parseIdempotencyKey(' order:create:1234 ')).toBe(
      'order:create:1234',
    );
  });

  it('rejects short, long, whitespace, and unsupported characters', () => {
    expect(parseIdempotencyKey('short')).toBeNull();
    expect(parseIdempotencyKey('contains space')).toBeNull();
    expect(parseIdempotencyKey('中文幂等键123456')).toBeNull();
    expect(parseIdempotencyKey('x'.repeat(129))).toBeNull();
  });
});
