import { describe, expect, it } from 'vitest';
import {
  generateFileObjectKey,
  isSystemGeneratedFileObjectKey,
} from './object-key';
import {
  constantTimeHexEqual,
  generateOpaqueFileToken,
  hashOpaqueFileToken,
} from './access-token';

describe('file object identity', () => {
  it('creates unguessable keys without original filenames', () => {
    const first = generateFileObjectKey(
      'ORDER_EVIDENCE',
      Date.UTC(2026, 6, 31),
    );
    const second = generateFileObjectKey(
      'ORDER_EVIDENCE',
      Date.UTC(2026, 6, 31),
    );
    expect(first).not.toBe(second);
    expect(isSystemGeneratedFileObjectKey(first)).toBe(true);
    expect(first).toContain('/order-evidence/');
    expect(first.split('/').at(-1)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('hashes opaque tokens and compares fixed-length hashes', async () => {
    const token = generateOpaqueFileToken();
    const hash = await hashOpaqueFileToken(token);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(constantTimeHexEqual(hash, hash)).toBe(true);
    const different = `${hash[0] === '0' ? '1' : '0'}${hash.slice(1)}`;
    expect(constantTimeHexEqual(hash, different)).toBe(false);
  });
});
