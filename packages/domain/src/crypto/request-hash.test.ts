import { describe, expect, it } from 'vitest';
import { hashCanonicalJson } from './request-hash';

describe('canonical request hash', () => {
  it('produces the same hash for equivalent object key order', async () => {
    const first = await hashCanonicalJson({
      action: 'CREATE',
      payload: { b: 2, a: 1 },
    });
    const second = await hashCanonicalJson({
      payload: { a: 1, b: 2 },
      action: 'CREATE',
    });

    expect(first).toBe(second);
  });

  it('changes when an array order changes', async () => {
    await expect(hashCanonicalJson({ values: [1, 2] }))
      .resolves.not.toBe(await hashCanonicalJson({ values: [2, 1] }));
  });
});
