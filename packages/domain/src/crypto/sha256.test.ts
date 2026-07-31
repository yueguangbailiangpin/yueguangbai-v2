import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

describe('SHA-256', () => {
  it('matches the standard abc digest', async () => {
    await expect(sha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223'
      + 'b00361a396177a9cb410ff61f20015ad',
    );
  });
});
