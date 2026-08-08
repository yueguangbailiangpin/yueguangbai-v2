import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../../..');
const migrationDirectory = path.join(root, 'migrations');
const files = readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort();
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Migration 0037 product reservation order scheduling', () => {
  it('restores a pre-migration backup and performs forward recovery to schema 37', () => {
    const directory = temporaryDirectory();
    const sourcePath = path.join(directory, 'source.sqlite');
    const backupPath = path.join(directory, 'pre-0037.sqlite');
    const restoredPath = path.join(directory, 'restored-0036.sqlite');
    const forwardPath = path.join(directory, 'forward-recovery.sqlite');
    let source = open(sourcePath);
    applyThrough(source, 36);
    const before = criticalFacts(source);
    expect(schemaVersion(source)).toBe(36);
    source.close();
    copyFileSync(sourcePath, backupPath);

    source = open(sourcePath);
    apply(source, files[36]!);
    expect(schemaVersion(source)).toBe(37);
    expect(criticalFacts(source)).toEqual(before);
    expect(productScheduleColumns(source)).toEqual([
      'order_interval_days', 'orders_per_run',
    ]);
    source.close();

    copyFileSync(backupPath, restoredPath);
    const restored = open(restoredPath);
    expect(schemaVersion(restored)).toBe(36);
    expect(criticalFacts(restored)).toEqual(before);
    expect(scheduleObjects(restored)).toEqual([]);
    restored.close();

    copyFileSync(backupPath, forwardPath);
    const forward = open(forwardPath);
    apply(forward, files[36]!);
    expect(schemaVersion(forward)).toBe(37);
    expect(criticalFacts(forward)).toEqual(before);
    expect(forward.prepare('PRAGMA integrity_check').get())
      .toEqual({ integrity_check: 'ok' });
    expect(forward.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    forward.close();
  });

  it('rejects wrong order and repeat without partial scheduling DDL', () => {
    const wrong = open(':memory:');
    applyThrough(wrong, 35);
    expect(() => apply(wrong, files[36]!)).toThrow(/transaction_assertion_failed/iu);
    expect(schemaVersion(wrong)).toBe(35);
    expect(scheduleObjects(wrong)).toEqual([]);
    expect(productScheduleColumns(wrong)).toEqual([]);
    wrong.close();

    const repeat = open(':memory:');
    applyThrough(repeat, 37);
    expect(() => apply(repeat, files[36]!)).toThrow();
    expect(schemaVersion(repeat)).toBe(37);
    expect(scheduleObjects(repeat)).toContain('demand_order_schedule_versions');
    repeat.close();
  });
});

function open(filename: string): DatabaseSync {
  const database = new DatabaseSync(filename);
  database.exec('PRAGMA foreign_keys=ON;');
  return database;
}

function applyThrough(database: DatabaseSync, version: number): void {
  for (const file of files.slice(0, version)) apply(database, file);
}

function apply(database: DatabaseSync, file: string): void {
  database.exec('BEGIN IMMEDIATE;');
  try {
    database.exec(readFileSync(path.join(migrationDirectory, file), 'utf8'));
    database.exec('COMMIT;');
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK;');
    throw error;
  }
}

function schemaVersion(database: DatabaseSync): number {
  return Number((database.prepare(`SELECT schema_version FROM app_schema_state
    WHERE singleton_id=1`).get() as { schema_version: number }).schema_version);
}

function criticalFacts(database: DatabaseSync): Record<string, number> {
  const row = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM staff_users) AS staff_users,
      (SELECT COUNT(*) FROM staff_role_assignments) AS staff_roles,
      (SELECT COUNT(*) FROM seller_channels) AS seller_channels,
      (SELECT COUNT(*) FROM acquisition_channels) AS acquisition_channels,
      (SELECT COUNT(*) FROM products) AS products,
      (SELECT COUNT(*) FROM demand_batches) AS demands,
      (SELECT COUNT(*) FROM product_reservations) AS reservations,
      (SELECT COUNT(*) FROM formal_orders) AS formal_orders,
      (SELECT COUNT(*) FROM formal_order_financial_snapshots) AS financial_snapshots
  `).get() as Record<string, number>;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

function productScheduleColumns(database: DatabaseSync): string[] {
  return (database.prepare(`PRAGMA table_info(product_versions)`).all() as { name: string }[])
    .map((row) => row.name)
    .filter((name) => name === 'order_interval_days' || name === 'orders_per_run')
    .sort();
}

function scheduleObjects(database: DatabaseSync): string[] {
  return (database.prepare(`SELECT name FROM sqlite_schema
    WHERE name LIKE '%order_schedule%' ORDER BY name`).all() as { name: string }[])
    .map((row) => row.name);
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'ygb-m16-migration-'));
  temporaryDirectories.push(directory);
  return directory;
}
