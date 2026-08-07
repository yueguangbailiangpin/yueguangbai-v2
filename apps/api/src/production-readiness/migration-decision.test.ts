import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMigratedTestDatabase } from '@ygb/testkit';

describe('M10 production readiness migration decision', () => {
  it('keeps evidence external and proves schema 34 needs no invented 0035', async () => {
    const root = path.resolve(import.meta.dirname, '../../../..');
    const migrations = readdirSync(path.join(root, 'migrations'))
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
      .sort();
    expect(migrations).toHaveLength(34);
    expect(migrations.at(-1)).toBe('0034_feishu_sync_dead_letter_categories.sql');
    expect(migrations.map((file) => Number(file.slice(0, 4))))
      .toEqual(Array.from({ length: 34 }, (_, index) => index + 1));
    const database = createMigratedTestDatabase();
    try {
      expect(await database.prepare(`SELECT schema_version
        FROM app_schema_state WHERE singleton_id=1`).first())
        .toEqual({ schema_version: 34 });
      const forbidden = await database.prepare(`SELECT name FROM sqlite_schema
        WHERE name LIKE '%backup%' OR name LIKE '%release_evidence%'`).all();
      expect(forbidden.results).toEqual([]);
    } finally {
      database.close();
    }
  });
});
