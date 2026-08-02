import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

function migrations(max: number): string[] {
  return readdirSync(join(process.cwd(), 'migrations'))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort()
    .filter((name) => Number(name.slice(0, 4)) <= max)
    .map((name) => readFileSync(join(process.cwd(), 'migrations', name), 'utf8'));
}

function apply(max: number): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const sql of migrations(max)) {
    db.exec(`BEGIN;\n${sql}\nCOMMIT;`);
  }
  return db;
}

describe('migration 0021 order instructions', () => {
  it('applies the complete 0001-0021 chain', () => {
    const db = apply(21);
    const row = db.prepare('SELECT schema_version FROM app_schema_state WHERE singleton_id=1').get() as { schema_version: number };
    expect(row.schema_version).toBe(21);
  });

  it('leaves foreign-key check empty', () => {
    expect(apply(21).prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('leaves integrity check ok', () => {
    const rows = apply(21).prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
    expect(rows).toEqual([{ integrity_check: 'ok' }]);
  });

  it('rejects schema 19 as a predecessor', () => {
    const db = apply(19);
    const sql = migrations(21).at(-1)!;
    expect(() => db.exec(`BEGIN;\n${sql}\nCOMMIT;`)).toThrow();
    try { db.exec('ROLLBACK'); } catch { /* transaction already rolled back */ }
    const row = db.prepare('SELECT schema_version FROM app_schema_state WHERE singleton_id=1').get() as { schema_version: number };
    expect(row.schema_version).toBe(19);
  });

  it.each([
    'order_instructions',
    'order_instruction_versions',
    'order_instruction_asset_batches',
    'order_instruction_asset_items',
    'order_instruction_keyword_images',
    'order_instruction_events',
    'formal_order_number_claims',
    'formal_order_number_conflicts',
  ])('creates %s', (table) => {
    const row = apply(21).prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    ).get(table) as { name: string } | undefined;
    expect(row?.name).toBe(table);
  });

  it('contains no REAL financial column', () => {
    const sql = migrations(21).at(-1)!;
    expect(sql).not.toMatch(/\bREAL\b|\bFLOAT\b/u);
  });
});
