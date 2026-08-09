import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMigratedTestDatabase,
  SqliteDatabase,
} from '@ygb/testkit';

let database: SqliteDatabase | null = null;
afterEach(() => {
  database?.close();
  database = null;
});

describe('Migration 0028 Amazon order date facts', () => {
  it('keeps object counts and adds nullable checked history columns', async () => {
    database = createMigratedTestDatabase();
    expect(await database.prepare(`
      SELECT schema_version FROM app_schema_state WHERE singleton_id=1
    `).first()).toEqual({ schema_version: 39 });
    const tables = await database.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all();
    const triggers = await database.prepare(`
      SELECT name FROM sqlite_schema WHERE type='trigger'
    `).all();
    const views = await database.prepare(`
      SELECT name FROM sqlite_schema WHERE type='view'
    `).all();
    expect(tables.results).toHaveLength(172);
    expect(triggers.results).toHaveLength(319);
    expect(views.results).toHaveLength(10);

    for (const table of ['order_evidence_versions', 'formal_orders']) {
      const columns = await database.prepare(
        `PRAGMA table_info(${table})`,
      ).all<{ name: string; type: string; notnull: number }>();
      expect(columns.results).toContainEqual(expect.objectContaining({
        name: 'amazon_order_date',
        type: 'TEXT',
        notnull: 0,
      }));
      const schema = await database.prepare(`
        SELECT sql FROM sqlite_schema WHERE type='table' AND name=?
      `).bind(table).first<{ sql: string }>();
      expect(schema?.sql).toContain("date(amazon_order_date)=amazon_order_date");
      expect(schema?.sql).toContain("[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]");
    }
  });

  it('accepts leap day and rejects malformed or impossible dates', () => {
    database = new SqliteDatabase();
    database.exec(`
      CREATE TABLE date_probe (
        value TEXT CHECK (
          value IS NULL OR (
            length(value)=10
            AND value GLOB
              '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
            AND date(value) IS NOT NULL
            AND date(value)=value
          )
        )
      ) STRICT;
      INSERT INTO date_probe (value) VALUES (NULL), ('2024-02-29');
    `);
    for (const value of [
      '2023-02-29', '2024-02-30', '2024-00-01', '2024-13-01',
      '2024-01-00', '2024-01-01T00:00:00Z',
      ' 2024-01-01', '2024-01-01 ',
    ]) {
      expect(() => database!.raw.prepare(
        'INSERT INTO date_probe (value) VALUES (?)',
      ).run(value)).toThrow();
    }
  });

  it('requires dates on new writes, source equality, and no historical backfill', async () => {
    database = createMigratedTestDatabase();
    const guardRows = await database.prepare(`
      SELECT name, sql FROM sqlite_schema
      WHERE type='trigger' AND name IN (
        'trg_order_evidence_version_submission_guard',
        'trg_formal_order_source_guard',
        'trg_order_evidence_versions_no_update',
        'trg_formal_orders_no_update'
      ) ORDER BY name
    `).all<{ name: string; sql: string }>();
    const guards = new Map(guardRows.results.map((row) => [row.name, row.sql]));
    expect(guards.get('trg_order_evidence_version_submission_guard'))
      .toContain('NEW.amazon_order_date IS NULL');
    expect(guards.get('trg_formal_order_source_guard'))
      .toContain('evidence.amazon_order_date=NEW.amazon_order_date');
    expect(guards.get('trg_order_evidence_versions_no_update'))
      .toContain('order_evidence_versions_are_immutable');
    expect(guards.get('trg_formal_orders_no_update'))
      .toContain('formal_orders_are_immutable');

    const source = readFileSync(path.resolve(
      process.cwd(),
      'migrations/0028_buyer_amazon_order_date.sql',
    ), 'utf8');
    expect(source).not.toMatch(/UPDATE\s+order_evidence_versions/iu);
    expect(source).not.toMatch(/UPDATE\s+formal_orders/iu);
    expect(source).not.toMatch(/submitted_at|confirmed_at|confirmed_business_date|created_at|updated_at/iu);
  });
});
