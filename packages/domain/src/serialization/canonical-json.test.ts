import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json';

describe('canonical JSON', () => {
  it('sorts object keys recursively while preserving array order', () => {
    expect(canonicalJson({
      z: 1,
      a: { y: true, b: 'value' },
      list: [{ d: 4, c: 3 }, 2],
    })).toBe(
      '{"a":{"b":"value","y":true},"list":[{"c":3,"d":4},2],"z":1}',
    );
  });

  it('rejects values that cannot be stable JSON facts', () => {
    expect(() => canonicalJson({ value: undefined }))
      .toThrow('undefined_json_value');
    expect(() => canonicalJson({ value: Number.NaN }))
      .toThrow('non_json_number');
    expect(() => canonicalJson(new Date()))
      .toThrow('non_plain_json_object');

    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow('cyclic_json');
  });
});
