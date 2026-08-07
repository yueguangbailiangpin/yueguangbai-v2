import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations, SqliteDatabase } from '@ygb/testkit';
import {
  createEncryptedD1Backup,
  collectFinancialAggregates,
  restoreEncryptedD1Backup,
  verifyDatabaseAgainstManifest,
} from '@ygb/testkit';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('encrypted D1 backup and isolated restore', () => {
  it('backs up schema 34, restores it and verifies rows, finance, relations and smoke reads', async () => {
    const directory = temporaryDirectory();
    const sourcePath = path.join(directory, 'source.sqlite');
    const database = new SqliteDatabase(sourcePath);
    applyMigrations(database);
    database.exec(`INSERT INTO staff_users (
      id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at
    ) VALUES ('anonymous-owner','匿名负责人','ACTIVE',1,1,1,1,NULL)`);
    database.close();
    const key = Buffer.alloc(32, 7);
    const backup = await createEncryptedD1Backup({
      databasePath: sourcePath,
      outputDirectory: path.join(directory, 'backup'),
      key,
      generatedAtUtcMs: 1_786_083_200_000,
      expectedSchemaVersion: 34,
      anonymousFixture: true,
    });
    expect(backup.manifest.schema_version).toBe(34);
    expect(backup.manifest.row_counts['staff_users']).toBe(1);
    expect(backup.manifest.inventory.tables).toHaveLength(150);
    expect(backup.manifest.inventory.views).toHaveLength(10);
    expect(backup.manifest.inventory.triggers).toHaveLength(285);
    expect(backup.manifest.inventory.indexes).toHaveLength(209);
    expect(backup.manifest.integrity).toEqual({
      integrity_check: 'ok',
      foreign_key_violations: 0,
    });
    expect(backup.manifest.financial_aggregates['formal_order_snapshots'])
      .toMatchObject({ row_count: 0, buyer_expected_cny_fen: '0' });
    const attestation = readFileSync(backup.attestationPath, 'utf8');
    expect(attestation).not.toContain(sourcePath);
    expect(attestation).not.toContain('anonymous-owner');

    const restorePath = path.join(directory, 'isolated', 'restored.sqlite');
    const restored = restoreEncryptedD1Backup({
      bundlePath: backup.bundlePath,
      restorePath,
      key,
      verifiedAtUtcMs: 1_786_083_201_000,
      expectedSchemaVersion: 34,
    });
    expect(restored.report).toMatchObject({
      status: 'PASS',
      schema_match: true,
      inventory_match: true,
      row_counts_match: true,
      financial_aggregates_match: true,
      integrity_check: 'ok',
      foreign_key_violations: 0,
      smoke_reads_match: true,
    });
    expect(statSync(restorePath).mode & 0o777).toBe(0o600);
    const isolated = new DatabaseSync(restorePath, { readOnly: true });
    expect(isolated.prepare('SELECT display_name FROM staff_users').get())
      .toEqual({ display_name: '匿名负责人' });
    isolated.close();
  });

  it('does not mistake a created backup for a usable restore', async () => {
    const directory = temporaryDirectory();
    const sourcePath = path.join(directory, 'source.sqlite');
    const database = new SqliteDatabase(sourcePath);
    applyMigrations(database);
    database.close();
    const key = Buffer.alloc(32, 8);
    const backup = await createEncryptedD1Backup({
      databasePath: sourcePath,
      outputDirectory: path.join(directory, 'backup'),
      key,
      expectedSchemaVersion: 34,
      anonymousFixture: true,
    });
    const bytes = readFileSync(backup.bundlePath);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    const corruptPath = path.join(directory, 'corrupt.bundle');
    writeFileSync(corruptPath, bytes);
    expect(() => restoreEncryptedD1Backup({
      bundlePath: corruptPath,
      restorePath: path.join(directory, 'must-not-exist.sqlite'),
      key,
    })).toThrow('backup_authentication_failed');
  });

  it('reports post-restore row drift and refuses to overwrite a restore target', async () => {
    const directory = temporaryDirectory();
    const sourcePath = path.join(directory, 'source.sqlite');
    const source = new SqliteDatabase(sourcePath);
    applyMigrations(source);
    source.close();
    const key = Buffer.alloc(32, 9);
    const backup = await createEncryptedD1Backup({
      databasePath: sourcePath,
      outputDirectory: path.join(directory, 'backup'),
      key,
      expectedSchemaVersion: 34,
      anonymousFixture: true,
    });
    const restorePath = path.join(directory, 'restored.sqlite');
    restoreEncryptedD1Backup({ bundlePath: backup.bundlePath, restorePath, key });
    expect(() => restoreEncryptedD1Backup({
      bundlePath: backup.bundlePath,
      restorePath,
      key,
    })).toThrow('restore_target_exists');
    const restored = new DatabaseSync(restorePath);
    restored.exec(`INSERT INTO staff_users (
      id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at
    ) VALUES ('drift','漂移','ACTIVE',1,1,2,2,NULL)`);
    const report = verifyDatabaseAgainstManifest(restored, backup.manifest, 3);
    restored.close();
    expect(report.status).toBe('FAIL');
    expect(report.mismatches).toContain('row_counts');
    expect(report.mismatches).toContain('smoke_reads');
  });

  it('uses exact BigInt aggregation and the canonical seller payable types', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE buyer_refund_payment_entries(entry_type TEXT,amount_cny_fen INTEGER);
      CREATE TABLE seller_payables(payable_type TEXT,amount_cny_fen INTEGER);
      CREATE TABLE seller_payments(amount_cny_fen INTEGER);
      CREATE TABLE seller_payment_allocations(amount_cny_fen INTEGER);
      CREATE TABLE seller_payment_allocation_reversals(amount_cny_fen INTEGER);
      INSERT INTO buyer_refund_payment_entries VALUES ('PAYMENT',9007199254740993),('REVERSAL',1);
      INSERT INTO seller_payables VALUES ('SELLER_PRINCIPAL',101),('SELLER_SERVICE_FEE',202);
      INSERT INTO seller_payments VALUES (303);
      INSERT INTO seller_payment_allocations VALUES (204);
      INSERT INTO seller_payment_allocation_reversals VALUES (4);
    `);
    expect(collectFinancialAggregates(database)).toMatchObject({
      buyer_refund_entries: { row_count: 2, net_paid_cny_fen: '9007199254740992' },
      seller_payables: { row_count: 2, principal_cny_fen: '101', service_fee_cny_fen: '202' },
      seller_payments: { row_count: 1, paid_cny_fen: '303' },
      seller_allocations: { row_count: 1, allocated_cny_fen: '204' },
      seller_allocation_reversals: { row_count: 1, reversed_cny_fen: '4' },
    });
    database.close();
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'ygb-production-readiness-'));
  directories.push(directory);
  return directory;
}
