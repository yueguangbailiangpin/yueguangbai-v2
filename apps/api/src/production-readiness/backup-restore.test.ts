import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations, SqliteDatabase } from '@ygb/testkit';
import type { D1BackupAttestation, D1BackupManifest } from '@ygb/contracts';
import {
  createEncryptedD1Backup,
  collectFinancialAggregates,
  restoreEncryptedD1Backup,
  readBackupKey,
  validateBackupManifest,
  verifyDatabaseAgainstManifest,
} from '@ygb/testkit';

const CURRENT_SCHEMA = 70;
const directories: string[] = [];
const RELEASE_SHA = 'a'.repeat(40);
const LONG_RUNNING_TEST_TIMEOUT_MS = 30_000;
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('encrypted D1 backup and isolated restore', () => {
  it(
    'backs up the current schema, restores it and verifies rows, finance, relations and smoke reads',
    async () => {
      const directory = temporaryDirectory();
      const sourcePath = path.join(directory, 'source.sqlite');
      const database = new SqliteDatabase(sourcePath);
      applyMigrations(database);
      database.exec(`INSERT INTO staff_users (
      id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at
    ) VALUES ('anonymous-owner','匿名负责人','ACTIVE',1,1,1,1,NULL)`);
      database.exec(`INSERT INTO staff_role_assignments (
      staff_id,role_code,status,assigned_by_staff_id,assigned_at,
      revoked_at,created_at,updated_at
    ) VALUES ('anonymous-owner','owner','ACTIVE',NULL,1,NULL,1,1)`);
      database.close();
      const key = Buffer.alloc(32, 7);
      const backup = await createEncryptedD1Backup({
        databasePath: sourcePath,
        outputDirectory: path.join(directory, 'backup'),
        key,
        releaseCommitSha: RELEASE_SHA,
        generatedAtUtcMs: 1_786_083_200_000,
        expectedSchemaVersion: CURRENT_SCHEMA,
        anonymousFixture: true,
      });
      expect(backup.manifest.schema_version).toBe(CURRENT_SCHEMA);
      expect(backup.manifest.release_commit_sha).toBe(RELEASE_SHA);
      expect(backup.manifest.row_counts['staff_users']).toBe(1);
      expect(backup.manifest.inventory.tables.length).toBeGreaterThan(0);
      expect(backup.manifest.inventory.triggers.length).toBeGreaterThan(0);
      expect(backup.manifest.integrity).toEqual({
        integrity_check: 'ok',
        foreign_key_violations: 0,
      });
      expect(backup.manifest.financial_aggregates['formal_order_snapshots']).toMatchObject({
        row_count: 0,
        buyer_expected_cny_fen: '0',
      });
      const attestation = readFileSync(backup.attestationPath, 'utf8');
      expect(attestation).not.toContain(sourcePath);
      expect(attestation).not.toContain('anonymous-owner');

      const restorePath = path.join(directory, 'isolated', 'restored.sqlite');
      const restored = restoreEncryptedD1Backup({
        bundlePath: backup.bundlePath,
        attestationPath: backup.attestationPath,
        restorePath,
        key,
        expectedReleaseCommitSha: RELEASE_SHA,
        verifiedAtUtcMs: 1_786_083_201_000,
        expectedSchemaVersion: CURRENT_SCHEMA,
      });
      expect(restored.report).toMatchObject({
        status: 'PASS',
        release_commit_sha: RELEASE_SHA,
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
      expect(isolated.prepare('SELECT display_name FROM staff_users').get()).toEqual({
        display_name: '匿名负责人',
      });
      isolated.close();
    },
    LONG_RUNNING_TEST_TIMEOUT_MS,
  );

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
      releaseCommitSha: RELEASE_SHA,
      expectedSchemaVersion: CURRENT_SCHEMA,
      anonymousFixture: true,
    });
    const bytes = readFileSync(backup.bundlePath);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    const corruptPath = path.join(directory, 'corrupt.bundle');
    writeFileSync(corruptPath, bytes);
    expect(() =>
      restoreEncryptedD1Backup({
        bundlePath: corruptPath,
        attestationPath: backup.attestationPath,
        restorePath: path.join(directory, 'must-not-exist.sqlite'),
        key,
        expectedReleaseCommitSha: RELEASE_SHA,
      }),
    ).toThrow('bundle_attestation_mismatch');
  });

  it(
    'reports post-restore row drift and refuses to overwrite a restore target',
    async () => {
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
        releaseCommitSha: RELEASE_SHA,
        expectedSchemaVersion: CURRENT_SCHEMA,
        anonymousFixture: true,
      });
      const restorePath = path.join(directory, 'restored.sqlite');
      restoreEncryptedD1Backup({
        bundlePath: backup.bundlePath,
        attestationPath: backup.attestationPath,
        restorePath,
        key,
        expectedReleaseCommitSha: RELEASE_SHA,
      });
      expect(() =>
        restoreEncryptedD1Backup({
          bundlePath: backup.bundlePath,
          attestationPath: backup.attestationPath,
          restorePath,
          key,
          expectedReleaseCommitSha: RELEASE_SHA,
        }),
      ).toThrow('restore_target_exists');
      const restored = new DatabaseSync(restorePath);
      restored.exec(`INSERT INTO staff_users (
      id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at
    ) VALUES ('drift','漂移','ACTIVE',1,1,2,2,NULL)`);
      const report = verifyDatabaseAgainstManifest(restored, backup.manifest, 3);
      restored.close();
      expect(report.status).toBe('FAIL');
      expect(report.mismatches).toContain('row_counts');
      expect(report.mismatches).toContain('smoke_reads');
    },
    LONG_RUNNING_TEST_TIMEOUT_MS,
  );

  it(
    'fails closed before target creation for wrong, tampered or swapped provenance',
    async () => {
      const directory = temporaryDirectory();
      const sourcePath = path.join(directory, 'source.sqlite');
      const source = new SqliteDatabase(sourcePath);
      applyMigrations(source);
      source.close();
      const key = Buffer.alloc(32, 10);
      const first = await createEncryptedD1Backup({
        databasePath: sourcePath,
        outputDirectory: path.join(directory, 'first'),
        key,
        releaseCommitSha: RELEASE_SHA,
        generatedAtUtcMs: 10,
        expectedSchemaVersion: CURRENT_SCHEMA,
        anonymousFixture: true,
      });
      const second = await createEncryptedD1Backup({
        databasePath: sourcePath,
        outputDirectory: path.join(directory, 'second'),
        key,
        releaseCommitSha: RELEASE_SHA,
        generatedAtUtcMs: 11,
        expectedSchemaVersion: CURRENT_SCHEMA,
        anonymousFixture: true,
      });
      const tamperedAttestationPath = path.join(directory, 'tampered-attestation.json');
      writeFileSync(
        tamperedAttestationPath,
        JSON.stringify({ ...first.attestation, anonymous_fixture: false }),
        { mode: 0o600 },
      );
      const malformedAttestationPath = path.join(directory, 'wrong-attestation.json');
      writeFileSync(
        malformedAttestationPath,
        JSON.stringify({ ...first.attestation, unknown_field: true }),
        { mode: 0o600 },
      );
      const cases = [
        {
          name: 'tampered',
          attestationPath: tamperedAttestationPath,
          expectedReleaseCommitSha: RELEASE_SHA,
          error: 'attestation_hmac_mismatch',
        },
        {
          name: 'wrong',
          attestationPath: malformedAttestationPath,
          expectedReleaseCommitSha: RELEASE_SHA,
          error: 'invalid_backup_attestation',
        },
        {
          name: 'release',
          attestationPath: first.attestationPath,
          expectedReleaseCommitSha: 'b'.repeat(40),
          error: 'release_commit_mismatch',
        },
        {
          name: 'swap',
          attestationPath: second.attestationPath,
          expectedReleaseCommitSha: RELEASE_SHA,
          error: 'bundle_attestation_mismatch',
        },
      ];
      for (const scenario of cases) {
        const restorePath = path.join(directory, `${scenario.name}.sqlite`);
        expect(() =>
          restoreEncryptedD1Backup({
            bundlePath: first.bundlePath,
            attestationPath: scenario.attestationPath,
            restorePath,
            key,
            expectedReleaseCommitSha: scenario.expectedReleaseCommitSha,
          }),
        ).toThrow(scenario.error);
        expect(existsSync(restorePath)).toBe(false);
      }
    },
    LONG_RUNNING_TEST_TIMEOUT_MS,
  );

  it('rejects authenticated malformed, unknown and oversized manifests before restore', async () => {
    const directory = temporaryDirectory();
    const sourcePath = path.join(directory, 'source.sqlite');
    const source = new SqliteDatabase(sourcePath);
    applyMigrations(source);
    source.close();
    const key = Buffer.alloc(32, 11);
    const backup = await createEncryptedD1Backup({
      databasePath: sourcePath,
      outputDirectory: path.join(directory, 'original'),
      key,
      releaseCommitSha: RELEASE_SHA,
      expectedSchemaVersion: CURRENT_SCHEMA,
      anonymousFixture: true,
    });
    expect(() => validateBackupManifest({ ...backup.manifest, row_counts: [] })).toThrow(
      'invalid_backup_manifest',
    );
    const variants = [
      {
        name: 'wrong-type',
        manifest: { ...backup.manifest, row_counts: [] },
        error: 'invalid_backup_manifest',
      },
      {
        name: 'unknown-field',
        manifest: { ...backup.manifest, malicious_unknown: true },
        error: 'invalid_backup_manifest',
      },
      {
        name: 'financial-decimal',
        manifest: {
          ...backup.manifest,
          financial_aggregates: {
            ...backup.manifest.financial_aggregates,
            formal_order_snapshots: {
              ...backup.manifest.financial_aggregates['formal_order_snapshots'],
              buyer_expected_cny_fen: '01',
            },
          },
        },
        error: 'invalid_backup_manifest',
      },
      {
        name: 'oversized',
        manifest: { ...backup.manifest, malicious_unknown: 'x'.repeat(8 * 1024 * 1024) },
        error: 'invalid_backup_payload',
      },
    ];
    for (const variant of variants) {
      const rewritten = writeAuthenticatedVariant({
        directory: path.join(directory, variant.name),
        backup,
        key,
        manifest: variant.manifest,
      });
      const restorePath = path.join(directory, `${variant.name}.sqlite`);
      expect(() =>
        restoreEncryptedD1Backup({
          bundlePath: rewritten.bundlePath,
          attestationPath: rewritten.attestationPath,
          restorePath,
          key,
          expectedReleaseCommitSha: RELEASE_SHA,
        }),
      ).toThrow(variant.error);
      expect(existsSync(restorePath)).toBe(false);
    }
  });

  it('requires a regular owner-only key file on POSIX', () => {
    const directory = temporaryDirectory();
    const keyPath = path.join(directory, 'backup.key');
    writeFileSync(keyPath, Buffer.alloc(32, 12), { mode: 0o600 });
    expect(readBackupKey(keyPath)).toEqual(Buffer.alloc(32, 12));
    if (process.platform !== 'win32') {
      chmodSync(keyPath, 0o644);
      expect(() => readBackupKey(keyPath)).toThrow('insecure_backup_key_permissions');
    }
    expect(() => readBackupKey(directory)).toThrow('backup_key_must_be_regular_file');
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
      INSERT INTO seller_payments VALUES (303);INSERT INTO seller_payment_allocations VALUES (204);INSERT INTO seller_payment_allocation_reversals VALUES (4);
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
function writeAuthenticatedVariant(input: {
  directory: string;
  backup: { bundlePath: string; attestation: D1BackupAttestation; manifest: D1BackupManifest };
  key: Buffer;
  manifest: unknown;
}): { bundlePath: string; attestationPath: string } {
  const encryptionKey = Buffer.from(
    hkdfSync(
      'sha256',
      input.key,
      Buffer.from('yueguangbai-v2/d1-backup/v1', 'utf8'),
      Buffer.from('aes-256-gcm', 'utf8'),
      32,
    ),
  );
  const authenticationKey = Buffer.from(
    hkdfSync(
      'sha256',
      input.key,
      Buffer.from('yueguangbai-v2/d1-backup/v1', 'utf8'),
      Buffer.from('attestation-hmac', 'utf8'),
      32,
    ),
  );
  const original = readFileSync(input.backup.bundlePath);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, original.subarray(9, 21));
  decipher.setAuthTag(original.subarray(21, 37));
  const payload = Buffer.concat([decipher.update(original.subarray(37)), decipher.final()]);
  const originalManifestLength = payload.readUInt32BE(9),
    compressed = payload.subarray(13 + originalManifestLength),
    manifestBytes = Buffer.from(JSON.stringify(input.manifest), 'utf8'),
    length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(manifestBytes.byteLength);
  const rewrittenPayload = Buffer.concat([
      Buffer.from('YGBD1PAY1', 'ascii'),
      length,
      manifestBytes,
      compressed,
    ]),
    iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', encryptionKey, iv),
    ciphertext = Buffer.concat([cipher.update(rewrittenPayload), cipher.final()]),
    encrypted = Buffer.concat([
      Buffer.from('YGBD1ENC1', 'ascii'),
      iv,
      cipher.getAuthTag(),
      ciphertext,
    ]);
  const { attestation_hmac_sha256: ignored, ...originalCore } = input.backup.attestation;
  void ignored;
  const core: Omit<D1BackupAttestation, 'attestation_hmac_sha256'> = {
    ...originalCore,
    encrypted_bundle_bytes: encrypted.byteLength,
    encrypted_bundle_sha256: sha256ForTest(encrypted),
    manifest_sha256: sha256ForTest(manifestBytes),
  };
  const attestation: D1BackupAttestation = {
    ...core,
    attestation_hmac_sha256: createHmac('sha256', authenticationKey)
      .update(Buffer.from(stableJsonForTest(core)))
      .digest('hex'),
  };
  const bundlePath = path.join(input.directory, 'variant.bundle'),
    attestationPath = path.join(input.directory, 'variant.attestation.json');
  mkdirSync(input.directory, { recursive: true, mode: 0o700 });
  writeFileSync(bundlePath, encrypted, { mode: 0o600 });
  writeFileSync(attestationPath, JSON.stringify(attestation), { mode: 0o600 });
  return { bundlePath, attestationPath };
}
function sha256ForTest(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
function stableJsonForTest(value: unknown): string {
  return JSON.stringify(sortForTest(value));
}
function sortForTest(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForTest);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortForTest(nested)]),
  );
}
