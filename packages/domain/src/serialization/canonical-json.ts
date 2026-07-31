export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  return serialize(value, seen);
}

function serialize(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null';

  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non_json_number');
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('cyclic_json');
    seen.add(value);
    try {
      return `[${value.map((item) => serialize(item, seen)).join(',')}]`;
    } finally {
      seen.delete(value);
    }
  }

  if (typeof value === 'object') {
    if (seen.has(value)) throw new Error('cyclic_json');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('non_plain_json_object');
    }

    seen.add(value);
    try {
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const fields: string[] = [];

      for (const key of keys) {
        const item = record[key];
        if (item === undefined) throw new Error('undefined_json_value');
        fields.push(`${JSON.stringify(key)}:${serialize(item, seen)}`);
      }
      return `{${fields.join(',')}}`;
    } finally {
      seen.delete(value);
    }
  }

  throw new Error('unsupported_json_value');
}
