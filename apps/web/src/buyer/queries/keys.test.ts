import { describe, expect, it } from 'vitest';
import { buyerQueryKeys } from './keys';

describe('Module 1 buyer query authority', () => {
  it('roots every key at buyer and excludes idempotency material', () => {
    const keys = [buyerQueryKeys.me(), buyerQueryKeys.demands('page'), buyerQueryKeys.reservation('r1'),
      buyerQueryKeys.instruction('r1', 2), buyerQueryKeys.evidence('e1'), buyerQueryKeys.formalOrder('o1'),
      buyerQueryKeys.review('v1'), buyerQueryKeys.refund('f1')];
    for (const key of keys) {
      expect(key[0]).toBe('buyer');
      expect(JSON.stringify(key)).not.toMatch(/idempotency|operation-key/iu);
    }
  });

  it('separates detail, list, state, and content facts', () => {
    expect(new Set([
      JSON.stringify(buyerQueryKeys.instructionState('r1')),
      JSON.stringify(buyerQueryKeys.instruction('r1', 1)),
      JSON.stringify(buyerQueryKeys.instruction('r1', 2)),
      JSON.stringify(buyerQueryKeys.reservation('r1')),
    ]).size).toBe(4);
  });
});
