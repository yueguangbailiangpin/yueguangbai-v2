import { describe, expect, it } from 'vitest';
import { statementChangedOnce } from './sql';

describe('SQL contracts', () => {
  it('recognizes exactly one changed row', () => {
    expect(statementChangedOnce({ meta: { changes: 1 } })).toBe(true);
    expect(statementChangedOnce({ meta: { changes: 0 } })).toBe(false);
    expect(statementChangedOnce({ meta: { changes: 2 } })).toBe(false);
    expect(statementChangedOnce(undefined)).toBe(false);
  });
});
