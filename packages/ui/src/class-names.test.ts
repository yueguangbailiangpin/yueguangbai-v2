import { describe, expect, it } from 'vitest';
import { classNames } from './class-names';

describe('classNames', () => {
  it('joins only non-empty strings', () => {
    expect(classNames('one', false, null, undefined, '', 'two'))
      .toBe('one two');
  });
});
