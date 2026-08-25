import { describe, expect, it } from 'vitest';
import { IncrementalCrc32 } from './crc32';

describe('IncrementalCrc32', () => {
  it('produces the canonical CRC-32 of "123456789" (0xCBF43926)', () => {
    const hasher = new IncrementalCrc32();
    hasher.update(new TextEncoder().encode('123456789'));
    expect(hasher.digest()).toBe(0xcbf43926);
  });

  it('is chunk-order stable across arbitrary splits', () => {
    const bytes = new TextEncoder().encode('the quick brown fox jumps over the lazy dog');
    const whole = new IncrementalCrc32().update(bytes).digest();
    for (let size = 1; size <= bytes.byteLength; size += 3) {
      const hasher = new IncrementalCrc32();
      for (let offset = 0; offset < bytes.byteLength; offset += size) {
        hasher.update(bytes.subarray(offset, Math.min(offset + size, bytes.byteLength)));
      }
      expect(hasher.digest()).toBe(whole);
    }
  });

  it('returns the empty-input digest 0', () => {
    expect(new IncrementalCrc32().digest()).toBe(0);
  });

  it('refuses use after finish', () => {
    const hasher = new IncrementalCrc32();
    hasher.digest();
    expect(() => hasher.digest()).toThrow('crc32_already_finished');
    expect(() => hasher.update(new Uint8Array([1]))).toThrow('crc32_already_finished');
  });
});
