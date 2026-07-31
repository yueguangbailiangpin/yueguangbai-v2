export interface TestClock {
  now(): number;
  set(value: number): void;
  advance(milliseconds: number): void;
}

export function createTestClock(initial: number): TestClock {
  assertTimestamp(initial);
  let current = initial;

  return {
    now: () => current,
    set(value) {
      assertTimestamp(value);
      current = value;
    },
    advance(milliseconds) {
      if (!Number.isSafeInteger(milliseconds)) {
        throw new Error('invalid_clock_advance');
      }
      const next = current + milliseconds;
      assertTimestamp(next);
      current = next;
    },
  };
}

function assertTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('invalid_test_timestamp');
  }
}
