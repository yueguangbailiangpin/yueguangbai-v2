import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMigratedTestDatabase } from '@ygb/testkit';

describe('M10 production readiness migration decision', () => {
  it('keeps evidence external while accepting the governed M13 schema 35', async () => {
    const root = path.resolve(import.meta.dirname, '../../../..');
    const migrations = readdirSync(path.join(root, 'migrations'))
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
      .sort();
    expect(migrations).toHaveLength(35);
    expect(migrations.at(-1)).toBe('0035_staff_four_role_consolidation.sql');
    expect(migrations.map((file) => Number(file.slice(0, 4))))
      .toEqual(Array.from({ length: 35 }, (_, index) => index + 1));
    const database = createMigratedTestDatabase();
    try {
      expect(await database.prepare(`SELECT schema_version
        FROM app_schema_state WHERE singleton_id=1`).first())
        .toEqual({ schema_version: 35 });
      const forbidden = await database.prepare(`SELECT name FROM sqlite_schema
        WHERE name LIKE '%backup%' OR name LIKE '%release_evidence%'`).all();
      expect(forbidden.results).toEqual([]);
    } finally {
      database.close();
    }
  });
});
