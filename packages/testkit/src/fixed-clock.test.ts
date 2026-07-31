import { describe, expect, it } from 'vitest';
import { createTestClock } from './fixed-clock';

describe('test clock', () => {
  it('sets and advances deterministically', () => {
    const clock = createTestClock(100);
    expect(clock.now()).toBe(100);
    clock.advance(25);
    expect(clock.now()).toBe(125);
    clock.set(200);
    expect(clock.now()).toBe(200);
  });
});
