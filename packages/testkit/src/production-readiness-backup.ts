import { spawnSync } from 'node:child_process';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync, backup as backupDatabase } from 'node:sqlite';
import { gunzipSync, gzipSync } from 'node:zlib';
import type {
  D1BackupAttestation,
  D1BackupManifest,
  D1RestoreReport,
  DatabaseInventoryEntry,
} from '@ygb/contracts';

const PRODUCTION_READINESS_FORMAT_VERSION = 1 as const;

const ENVELOPE_MAGIC = Buffer.from('YGBD1ENC1', 'ascii');
const PAYLOAD_MAGIC = Buffer.from('YGBD1PAY1', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_DUMP_BYTES = 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_ATTESTATION_BYTES = 64 * 1024;
const MAX_BUNDLE_BYTES = MAX_DUMP_BYTES + MAX_MANIFEST_BYTES + 1024 * 1024;
const MAX_INVENTORY_ENTRIES = 20_000;
const MAX_RECORD_ENTRIES = 20_000;
const MAX_FINANCIAL_GROUPS = 200;
const MAX_FINANCIAL_FIELDS = 200;
const MAX_SMOKE_READS = 200;
const RELEASE_COMMIT_SHA = /^[0-9a-f]{40}$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const HKDF_SALT = Buffer.from('yueguangbai-v2/d1-backup/v1', 'utf8');
const FINANCIAL_AGGREGATE_FIELDS = {
  formal_order_snapshots: [
    'row_count', 'buyer_expected_cny_fen', 'seller_expected_cny_fen',
    'service_fee_cny_fen',
  ],
  buyer_refund_obligations: ['row_count', 'due_cny_fen'],
  buyer_refund_entries: ['row_count', 'net_paid_cny_fen'],
  seller_payables: ['row_count', 'principal_cny_fen', 'service_fee_cny_fen'],
  seller_payments: ['row_count', 'paid_cny_fen'],
  seller_allocations: ['row_count', 'allocated_cny_fen'],
  seller_allocation_reversals: ['row_count', 'reversed_cny_fen'],
} as const;

const SMOKE_QUERIES = {
  active_staff_authorization: `SELECT COUNT(DISTINCT staff.id) AS count
    FROM staff_users staff
    LEFT JOIN staff_role_assignments assignment
      ON assignment.staff_id=staff.id AND assignment.status='ACTIVE'
    WHERE staff.status='ACTIVE'`,
  buyer_portal_identity: 'SELECT COUNT(*) AS count FROM buyer_customers',
  seller_portal_identity: 'SELECT COUNT(*) AS count FROM seller_organizations',
  formal_order_detail: `SELECT COUNT(*) AS count FROM formal_orders formal_order
    LEFT JOIN formal_order_financial_snapshots snapshot
      ON snapshot.formal_order_id=formal_order.id`,
  protected_file_authority: `SELECT COUNT(*) AS count FROM file_objects object
    JOIN file_upload_intents intent ON intent.id=object.upload_intent_id`,
  scheduled_health: 'SELECT COUNT(*) AS count FROM scheduled_job_states',
} as const;

export interface CreateBackupInput {
  databasePath: string;
  outputDirectory: string;
  key: Buffer;
  releaseCommitSha: string;
  generatedAtUtcMs?: number;
  expectedSchemaVersion?: number;
  anonymousFixture?: boolean;
}

export interface CreateBackupResult {
  bundlePath: string;
  attestationPath: string;
  manifest: D1BackupManifest;
  attestation: D1BackupAttestation;
}

export interface RestoreBackupInput {
  bundlePath: string;
  attestationPath: string;
  restorePath: string;
  key: Buffer;
  expectedReleaseCommitSha: string;
  verifiedAtUtcMs?: number;
  expectedSchemaVersion?: number;
}

export async function createEncryptedD1Backup(
  input: CreateBackupInput,
): Promise<CreateBackupResult> {
  validateKey(input.key);
  validateReleaseCommitSha(input.releaseCommitSha);
  if (!existsSync(input.databasePath)) throw new Error('backup_source_missing');
  mkdirSync(input.outputDirectory, { recursive: true, mode: 0o700 });
  const bundlePath = path.join(input.outputDirectory, 'd1-backup.bundle.aes256gcm');
  const attestationPath = path.join(input.outputDirectory, 'd1-backup.attestation.json');
  if (existsSync(bundlePath) || existsSync(attestationPath)) {
    throw new Error('backup_output_exists');
  }

  const workingDirectory = mkdtempSync(path.join(tmpdir(), 'ygb-d1-backup-'));
  const snapshotPath = path.join(workingDirectory, 'snapshot.sqlite');
  try {
    const source = new DatabaseSync(input.databasePath, { readOnly: true });
    try {
      await backupDatabase(source, snapshotPath);
    } finally {
      source.close();
    }

    const snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
    const evidence = collectDatabaseEvidence(snapshot);
    snapshot.close();
    if (input.expectedSchemaVersion !== undefined
      && evidence.schemaVersion !== input.expectedSchemaVersion) {
      throw new Error('unexpected_schema_version');
    }

    const sqlDump = dumpDatabase(snapshotPath);
    const compressed = gzipSync(sqlDump, { level: 9 });
    const generatedAtUtcMs = input.generatedAtUtcMs ?? Date.now();
    assertTimestamp(generatedAtUtcMs);
    const manifest: D1BackupManifest = {
      format_version: PRODUCTION_READINESS_FORMAT_VERSION,
      generated_at_utc_ms: generatedAtUtcMs,
      release_commit_sha: input.releaseCommitSha,
      time_basis: 'UTC_MS',
      display_timezone: 'Asia/Shanghai',
      source: {
        kind: 'LOCAL_OR_ISOLATED_D1_EXPORT',
        anonymous_fixture: input.anonymousFixture === true,
      },
      schema_version: evidence.schemaVersion,
      schema_fingerprint_sha256: evidence.schemaFingerprint,
      inventory: evidence.inventory,
      row_counts: evidence.rowCounts,
      financial_aggregates: evidence.financialAggregates,
      integrity: evidence.integrity,
      smoke_reads: evidence.smokeReads,
      tools: collectToolVersions(),
      backup: {
        compression: 'gzip',
        uncompressed_bytes: sqlDump.byteLength,
        uncompressed_sha256: sha256(sqlDump),
        compressed_bytes: compressed.byteLength,
        compressed_sha256: sha256(compressed),
      },
    };
    validateBackupManifest(manifest);
    const manifestBytes = Buffer.from(stableJson(manifest));
    if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
      throw new Error('backup_manifest_too_large');
    }
    const payload = encodePayload(manifestBytes, compressed);
    const keys = deriveBackupKeys(input.key);
    const encrypted = encryptPayload(payload, keys.encryptionKey);
    writeFileSync(bundlePath, encrypted, { mode: 0o600, flag: 'wx' });
    chmodSync(bundlePath, 0o600);

    const core: Omit<D1BackupAttestation, 'attestation_hmac_sha256'> = {
      format_version: PRODUCTION_READINESS_FORMAT_VERSION,
      generated_at_utc_ms: generatedAtUtcMs,
      release_commit_sha: input.releaseCommitSha,
      schema_version: evidence.schemaVersion,
      cipher: 'AES-256-GCM',
      kdf: 'HKDF-SHA256',
      key_id: backupKeyId(keys.authenticationKey),
      encrypted_bundle_bytes: encrypted.byteLength,
      encrypted_bundle_sha256: sha256(encrypted),
      manifest_sha256: sha256(manifestBytes),
      anonymous_fixture: input.anonymousFixture === true,
    };
    const attestation: D1BackupAttestation = {
      ...core,
      attestation_hmac_sha256: hmacSha256(
        keys.authenticationKey,
        Buffer.from(stableJson(core)),
      ),
    };
    writeFileSync(attestationPath, `${stableJson(attestation)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    chmodSync(attestationPath, 0o600);
    return { bundlePath, attestationPath, manifest, attestation };
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
}

export function restoreEncryptedD1Backup(
  input: RestoreBackupInput,
): { manifest: D1BackupManifest; report: D1RestoreReport } {
  validateKey(input.key);
  validateReleaseCommitSha(input.expectedReleaseCommitSha);
  if (existsSync(input.restorePath)) throw new Error('restore_target_exists');
  const attestationBytes = readBoundedRegularFile(
    input.attestationPath,
    MAX_ATTESTATION_BYTES,
    'attestation',
  );
  const attestation = parseJson(attestationBytes, 'invalid_backup_attestation');
  validateBackupAttestation(attestation);
  const keys = deriveBackupKeys(input.key);
  const { attestation_hmac_sha256: suppliedHmac, ...core } = attestation;
  const expectedHmac = hmacSha256(
    keys.authenticationKey,
    Buffer.from(stableJson(core)),
  );
  if (!secureHexEqual(suppliedHmac, expectedHmac)) {
    throw new Error('attestation_hmac_mismatch');
  }
  if (attestation.key_id !== backupKeyId(keys.authenticationKey)) {
    throw new Error('backup_key_id_mismatch');
  }
  if (attestation.release_commit_sha !== input.expectedReleaseCommitSha) {
    throw new Error('release_commit_mismatch');
  }
  const encrypted = readBoundedRegularFile(
    input.bundlePath,
    MAX_BUNDLE_BYTES,
    'bundle',
  );
  if (encrypted.byteLength !== attestation.encrypted_bundle_bytes
    || sha256(encrypted) !== attestation.encrypted_bundle_sha256) {
    throw new Error('bundle_attestation_mismatch');
  }
  const payload = decryptPayload(encrypted, keys.encryptionKey);
  const { manifestBytes, compressed } = decodePayload(payload);
  if (sha256(manifestBytes) !== attestation.manifest_sha256) {
    throw new Error('manifest_attestation_mismatch');
  }
  const manifest = parseJson(manifestBytes, 'invalid_backup_manifest');
  validateBackupManifest(manifest);
  if (manifest.generated_at_utc_ms !== attestation.generated_at_utc_ms
    || manifest.schema_version !== attestation.schema_version
    || manifest.release_commit_sha !== attestation.release_commit_sha
    || manifest.source.anonymous_fixture !== attestation.anonymous_fixture) {
    throw new Error('manifest_attestation_mismatch');
  }
  if (manifest.release_commit_sha !== input.expectedReleaseCommitSha) {
    throw new Error('release_commit_mismatch');
  }
  if (sha256(compressed) !== manifest.backup.compressed_sha256
    || compressed.byteLength !== manifest.backup.compressed_bytes) {
    throw new Error('compressed_backup_mismatch');
  }
  const sqlDump = gunzipSync(compressed, { maxOutputLength: MAX_DUMP_BYTES });
  if (sha256(sqlDump) !== manifest.backup.uncompressed_sha256
    || sqlDump.byteLength !== manifest.backup.uncompressed_bytes) {
    throw new Error('uncompressed_backup_mismatch');
  }
  if (input.expectedSchemaVersion !== undefined
    && manifest.schema_version !== input.expectedSchemaVersion) {
    throw new Error('unexpected_schema_version');
  }
  mkdirSync(path.dirname(input.restorePath), { recursive: true, mode: 0o700 });
  const restored = new DatabaseSync(input.restorePath);
  chmodSync(input.restorePath, 0o600);
  try {
    restored.exec(sqlDump.toString('utf8'));
    restored.exec('PRAGMA foreign_keys = ON;');
  } catch (error) {
    restored.close();
    rmSync(input.restorePath, { force: true });
    throw error;
  }

  try {
    const report = verifyDatabaseAgainstManifest(
      restored,
      manifest,
      input.verifiedAtUtcMs ?? Date.now(),
    );
    return { manifest, report };
  } finally {
    restored.close();
  }
}

export function verifyDatabaseAgainstManifest(
  database: DatabaseSync,
  manifest: D1BackupManifest,
  verifiedAtUtcMs = Date.now(),
): D1RestoreReport {
  validateBackupManifest(manifest);
  assertTimestamp(verifiedAtUtcMs);
  const evidence = collectDatabaseEvidence(database);
  const mismatches: string[] = [];
  const schemaMatch = evidence.schemaVersion === manifest.schema_version;
  const inventoryMatch = evidence.schemaFingerprint
    === manifest.schema_fingerprint_sha256;
  const rowCountsMatch = stableJson(evidence.rowCounts)
    === stableJson(manifest.row_counts);
  const financialAggregatesMatch = stableJson(evidence.financialAggregates)
    === stableJson(manifest.financial_aggregates);
  const smokeReadsMatch = stableJson(evidence.smokeReads)
    === stableJson(manifest.smoke_reads);
  if (!schemaMatch) mismatches.push('schema_version');
  if (!inventoryMatch) mismatches.push('schema_inventory');
  if (!rowCountsMatch) mismatches.push('row_counts');
  if (!financialAggregatesMatch) mismatches.push('financial_aggregates');
  if (!smokeReadsMatch) mismatches.push('smoke_reads');
  if (evidence.integrity.integrity_check !== 'ok') mismatches.push('integrity_check');
  if (evidence.integrity.foreign_key_violations !== 0) {
    mismatches.push('foreign_key_check');
  }
  return {
    format_version: PRODUCTION_READINESS_FORMAT_VERSION,
    verified_at_utc_ms: verifiedAtUtcMs,
    release_commit_sha: manifest.release_commit_sha,
    status: mismatches.length === 0 ? 'PASS' : 'FAIL',
    schema_version: evidence.schemaVersion,
    schema_match: schemaMatch,
    inventory_match: inventoryMatch,
    row_counts_match: rowCountsMatch,
    financial_aggregates_match: financialAggregatesMatch,
    integrity_check: evidence.integrity.integrity_check === 'ok' ? 'ok' : 'failed',
    foreign_key_violations: evidence.integrity.foreign_key_violations,
    smoke_reads_match: smokeReadsMatch,
    mismatches,
  };
}

export function collectDatabaseEvidence(database: DatabaseSync): {
  schemaVersion: number;
  schemaFingerprint: string;
  inventory: D1BackupManifest['inventory'];
  rowCounts: Record<string, number>;
  financialAggregates: D1BackupManifest['financial_aggregates'];
  integrity: D1BackupManifest['integrity'];
  smokeReads: Record<string, number>;
} {
  const schemaVersionRow = database.prepare(
    'SELECT schema_version FROM app_schema_state WHERE singleton_id=1',
  ).get() as { schema_version?: unknown } | undefined;
  if (!schemaVersionRow || !Number.isSafeInteger(schemaVersionRow.schema_version)) {
    throw new Error('schema_version_missing');
  }
  const schemaRows = database.prepare(`SELECT type,name,tbl_name,sql
    FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type,name`).all() as Array<{
      type: string;
      name: string;
      tbl_name: string;
      sql: string | null;
    }>;
  const inventory = {
    tables: inventoryFor(schemaRows, 'table'),
    views: inventoryFor(schemaRows, 'view'),
    triggers: inventoryFor(schemaRows, 'trigger'),
    indexes: inventoryFor(schemaRows, 'index'),
  };
  const rowCounts: Record<string, number> = {};
  for (const entry of inventory.tables) {
    const row = database.prepare(
      `SELECT COUNT(*) AS count FROM ${quoteIdentifier(entry.name)}`,
    ).get() as { count: number };
    if (!Number.isSafeInteger(row.count) || row.count < 0) {
      throw new Error('unsafe_row_count');
    }
    rowCounts[entry.name] = row.count;
  }
  const integrityRows = database.prepare('PRAGMA integrity_check').all() as Array<{
    integrity_check: string;
  }>;
  const foreignKeyRows = database.prepare('PRAGMA foreign_key_check').all();
  if (integrityRows.length !== 1 || integrityRows[0]?.integrity_check !== 'ok') {
    throw new Error('database_integrity_failed');
  }
  const smokeReads: Record<string, number> = {};
  for (const [name, sql] of Object.entries(SMOKE_QUERIES)) {
    const row = database.prepare(sql).get() as { count: number };
    if (!Number.isSafeInteger(row.count) || row.count < 0) {
      throw new Error('invalid_smoke_read');
    }
    smokeReads[name] = row.count;
  }
  return {
    schemaVersion: Number(schemaVersionRow.schema_version),
    schemaFingerprint: sha256(Buffer.from(stableJson(inventory))),
    inventory,
    rowCounts,
    financialAggregates: collectFinancialAggregates(database),
    integrity: {
      integrity_check: 'ok',
      foreign_key_violations: foreignKeyRows.length,
    },
    smokeReads,
  };
}

export function collectFinancialAggregates(
  database: DatabaseSync,
): Record<string, Record<string, string | number>> {
  const result: Record<string, Record<string, string | number>> = {};
  if (schemaObjectExists(database, 'formal_order_financial_snapshots', 'table')) {
    const sums = sumIntegerRows(database, `SELECT
      buyer_expected_principal_cny_fen AS buyer,
      seller_expected_principal_cny_fen AS seller,
      service_fee_cny_fen AS fee FROM formal_order_financial_snapshots`,
    { buyer: 'buyer_expected_cny_fen', seller: 'seller_expected_cny_fen', fee: 'service_fee_cny_fen' });
    result['formal_order_snapshots'] = sums;
  }
  if (schemaObjectExists(database, 'buyer_refund_obligations', 'table')) {
    result['buyer_refund_obligations'] = sumIntegerRows(database,
      'SELECT due_amount_cny_fen AS due FROM buyer_refund_obligations',
      { due: 'due_cny_fen' });
  }
  if (schemaObjectExists(database, 'buyer_refund_payment_entries', 'table')) {
    let rowCount = 0;
    let netPaid = 0n;
    for (const row of rows(database, `SELECT entry_type,amount_cny_fen
      FROM buyer_refund_payment_entries`)) {
      rowCount += 1;
      const amount = exactInteger(row['amount_cny_fen']);
      netPaid += row['entry_type'] === 'PAYMENT' ? amount : -amount;
    }
    result['buyer_refund_entries'] = {
      row_count: rowCount,
      net_paid_cny_fen: netPaid.toString(),
    };
  }
  if (schemaObjectExists(database, 'seller_payables', 'table')) {
    let rowCount = 0;
    let principal = 0n;
    let serviceFee = 0n;
    for (const row of rows(database, `SELECT payable_type,amount_cny_fen
      FROM seller_payables`)) {
      rowCount += 1;
      const amount = exactInteger(row['amount_cny_fen']);
      if (row['payable_type'] === 'SELLER_PRINCIPAL') principal += amount;
      else if (row['payable_type'] === 'SELLER_SERVICE_FEE') serviceFee += amount;
      else throw new Error('invalid_seller_payable_type');
    }
    result['seller_payables'] = {
      row_count: rowCount,
      principal_cny_fen: principal.toString(),
      service_fee_cny_fen: serviceFee.toString(),
    };
  }
  for (const definition of [
    ['seller_payments', 'seller_payments', 'paid_cny_fen'],
    ['seller_allocations', 'seller_payment_allocations', 'allocated_cny_fen'],
    ['seller_allocation_reversals', 'seller_payment_allocation_reversals', 'reversed_cny_fen'],
  ] as const) {
    const [name, table, output] = definition;
    if (schemaObjectExists(database, table, 'table')) {
      result[name] = sumIntegerRows(database,
        `SELECT amount_cny_fen AS amount FROM ${quoteIdentifier(table)}`,
        { amount: output });
    }
  }
  return result;
}

function sumIntegerRows(
  database: DatabaseSync,
  sql: string,
  fields: Record<string, string>,
): Record<string, string | number> {
  let rowCount = 0;
  const sums = new Map(Object.entries(fields).map(([source, output]) => [
    source,
    { output, value: 0n },
  ]));
  for (const row of rows(database, sql)) {
    rowCount += 1;
    for (const [source, aggregate] of sums) {
      aggregate.value += exactInteger(row[source]);
    }
  }
  return Object.fromEntries([
    ['row_count', rowCount],
    ...[...sums.values()].map((aggregate) => [
      aggregate.output,
      aggregate.value.toString(),
    ]),
  ]);
}

function rows(database: DatabaseSync, sql: string): Iterable<Record<string, unknown>> {
  const statement = database.prepare(sql);
  statement.setReadBigInts(true);
  return statement.iterate() as Iterable<Record<string, unknown>>;
}

function exactInteger(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (!Number.isSafeInteger(value)) throw new Error('invalid_financial_integer');
  return BigInt(Number(value));
}

export function readBackupKey(keyPath: string): Buffer {
  const metadata = lstatSync(keyPath);
  if (!metadata.isFile()) throw new Error('backup_key_must_be_regular_file');
  if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
    throw new Error('insecure_backup_key_permissions');
  }
  if (metadata.size < 32 || metadata.size > 128) {
    throw new Error('invalid_backup_key_file_size');
  }
  const source = readFileSync(keyPath);
  const text = source.toString('utf8').trim();
  const key = /^[0-9a-f]{64}$/iu.test(text)
    ? Buffer.from(text, 'hex')
    : source.length === 33 && source[32] === 10
      ? source.subarray(0, 32)
      : source;
  validateKey(key);
  return Buffer.from(key);
}

function collectToolVersions(): D1BackupManifest['tools'] {
  return {
    node: process.version,
    npm: commandVersion('npm', ['--version']),
    sqlite: commandVersion('sqlite3', ['--version']).split(/\s/u)[0] ?? 'unknown',
    wrangler: packageVersion('wrangler'),
  };
}

function packageVersion(packageName: string): string {
  try {
    const packagePath = path.resolve('node_modules', packageName, 'package.json');
    const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function commandVersion(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0 || result.error) return 'unavailable';
  return result.stdout.trim();
}

function dumpDatabase(databasePath: string): Buffer {
  const result = spawnSync('sqlite3', [databasePath, '.dump'], {
    encoding: null,
    maxBuffer: MAX_DUMP_BYTES,
  });
  if (result.error || result.status !== 0) throw new Error('sqlite_dump_failed');
  // sqlite3 CLI emits sqlite_sequence (AUTOINCREMENT counter) as CREATE TABLE /
  // DELETE / INSERT statements. Node's DatabaseSync rejects creating the
  // reserved internal table on restore, and the counter is not business data:
  // AUTOINCREMENT tables rebuild it from max(rowid)+1 on the next insert.
  // Drop those lines from the dump so a real database containing AUTOINCREMENT
  // tables (e.g. D1's d1_migrations ledger) can be restored.
  const filtered = Buffer.from(result.stdout)
    .toString('utf8')
    .split('\n')
    .filter((line) => !/^(CREATE TABLE IF NOT EXISTS sqlite_sequence|DELETE FROM sqlite_sequence|INSERT INTO sqlite_sequence)\b/.test(line))
    .join('\n');
  return Buffer.from(filtered);
}

function inventoryFor(
  rows: Array<{ type: string; name: string; tbl_name: string; sql: string | null }>,
  type: string,
): DatabaseInventoryEntry[] {
  return rows.filter((row) => row.type === type).map((row) => ({
    name: row.name,
    table_name: row.tbl_name,
    definition_sha256: sha256(Buffer.from(row.sql ?? '')),
  }));
}

function schemaObjectExists(
  database: DatabaseSync,
  name: string,
  type: string,
): boolean {
  return database.prepare(
    'SELECT 1 FROM sqlite_schema WHERE name=? AND type=?',
  ).get(name, type) !== undefined;
}

function encodePayload(manifest: Buffer, compressed: Buffer): Buffer {
  if (manifest.byteLength < 2 || manifest.byteLength > MAX_MANIFEST_BYTES
    || compressed.byteLength < 1 || compressed.byteLength > MAX_BUNDLE_BYTES) {
    throw new Error('invalid_backup_payload');
  }
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(manifest.byteLength);
  return Buffer.concat([PAYLOAD_MAGIC, length, manifest, compressed]);
}

function decodePayload(payload: Buffer): { manifestBytes: Buffer; compressed: Buffer } {
  if (payload.byteLength < PAYLOAD_MAGIC.byteLength + 4
    || !payload.subarray(0, PAYLOAD_MAGIC.byteLength).equals(PAYLOAD_MAGIC)) {
    throw new Error('invalid_backup_payload');
  }
  const lengthOffset = PAYLOAD_MAGIC.byteLength;
  const manifestLength = payload.readUInt32BE(lengthOffset);
  const manifestStart = lengthOffset + 4;
  const compressedStart = manifestStart + manifestLength;
  if (manifestLength < 2 || manifestLength > MAX_MANIFEST_BYTES
    || compressedStart >= payload.byteLength) {
    throw new Error('invalid_backup_payload');
  }
  return {
    manifestBytes: payload.subarray(manifestStart, compressedStart),
    compressed: payload.subarray(compressedStart),
  };
}

function encryptPayload(payload: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([ENVELOPE_MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

function decryptPayload(envelope: Buffer, key: Buffer): Buffer {
  const headerLength = ENVELOPE_MAGIC.byteLength + IV_BYTES + TAG_BYTES;
  if (envelope.byteLength <= headerLength
    || !envelope.subarray(0, ENVELOPE_MAGIC.byteLength).equals(ENVELOPE_MAGIC)) {
    throw new Error('invalid_backup_envelope');
  }
  const ivStart = ENVELOPE_MAGIC.byteLength;
  const tagStart = ivStart + IV_BYTES;
  const ciphertextStart = tagStart + TAG_BYTES;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    envelope.subarray(ivStart, tagStart),
  );
  decipher.setAuthTag(envelope.subarray(tagStart, ciphertextStart));
  try {
    return Buffer.concat([
      decipher.update(envelope.subarray(ciphertextStart)),
      decipher.final(),
    ]);
  } catch {
    throw new Error('backup_authentication_failed');
  }
}

export function validateBackupManifest(
  value: unknown,
): asserts value is D1BackupManifest {
  const manifest = exactObject(value, [
    'format_version', 'generated_at_utc_ms', 'release_commit_sha', 'time_basis',
    'display_timezone', 'source', 'schema_version', 'schema_fingerprint_sha256',
    'inventory', 'row_counts', 'financial_aggregates', 'integrity',
    'smoke_reads', 'tools', 'backup',
  ], 'invalid_backup_manifest');
  if (manifest['format_version'] !== PRODUCTION_READINESS_FORMAT_VERSION
    || !validTimestamp(manifest['generated_at_utc_ms'])
    || !isReleaseCommitSha(manifest['release_commit_sha'])
    || manifest['time_basis'] !== 'UTC_MS'
    || manifest['display_timezone'] !== 'Asia/Shanghai'
    || !positiveSafeInteger(manifest['schema_version'])
    || !isSha256(manifest['schema_fingerprint_sha256'])) {
    throw new Error('invalid_backup_manifest');
  }

  const source = exactObject(manifest['source'], [
    'kind', 'anonymous_fixture',
  ], 'invalid_backup_manifest');
  if (source['kind'] !== 'LOCAL_OR_ISOLATED_D1_EXPORT'
    || typeof source['anonymous_fixture'] !== 'boolean') {
    throw new Error('invalid_backup_manifest');
  }

  const inventory = exactObject(manifest['inventory'], [
    'tables', 'views', 'triggers', 'indexes',
  ], 'invalid_backup_manifest');
  const inventoryNames: Record<string, string[]> = {};
  for (const kind of ['tables', 'views', 'triggers', 'indexes']) {
    const entries = inventory[kind];
    if (!Array.isArray(entries) || entries.length < 1
      || entries.length > MAX_INVENTORY_ENTRIES) {
      throw new Error('invalid_backup_manifest');
    }
    const names = new Set<string>();
    inventoryNames[kind] = [];
    for (const valueEntry of entries) {
      const entry = exactObject(valueEntry, [
        'name', 'table_name', 'definition_sha256',
      ], 'invalid_backup_manifest');
      if (!safeObjectName(entry['name']) || !safeObjectName(entry['table_name'])
        || !isSha256(entry['definition_sha256']) || names.has(entry['name'])) {
        throw new Error('invalid_backup_manifest');
      }
      names.add(entry['name']);
      inventoryNames[kind]!.push(entry['name']);
    }
  }
  if (sha256(Buffer.from(stableJson(inventory)))
    !== manifest['schema_fingerprint_sha256']) {
    throw new Error('invalid_backup_manifest');
  }

  const rowCounts = boundedRecord(
    manifest['row_counts'],
    MAX_RECORD_ENTRIES,
    'invalid_backup_manifest',
  );
  for (const [name, count] of Object.entries(rowCounts)) {
    if (!safeObjectName(name) || !nonNegativeSafeInteger(count)) {
      throw new Error('invalid_backup_manifest');
    }
  }
  if (stableJson(Object.keys(rowCounts).sort())
    !== stableJson((inventoryNames['tables'] ?? []).sort())) {
    throw new Error('invalid_backup_manifest');
  }

  const financial = boundedRecord(
    manifest['financial_aggregates'],
    MAX_FINANCIAL_GROUPS,
    'invalid_backup_manifest',
  );
  if (stableJson(Object.keys(financial).sort())
    !== stableJson(Object.keys(FINANCIAL_AGGREGATE_FIELDS).sort())) {
    throw new Error('invalid_backup_manifest');
  }
  for (const [groupName, groupValue] of Object.entries(financial)) {
    if (!safeRecordKey(groupName)) throw new Error('invalid_backup_manifest');
    const expectedFields = FINANCIAL_AGGREGATE_FIELDS[
      groupName as keyof typeof FINANCIAL_AGGREGATE_FIELDS
    ];
    if (!expectedFields || expectedFields.length > MAX_FINANCIAL_FIELDS) {
      throw new Error('invalid_backup_manifest');
    }
    const group = exactObject(groupValue, expectedFields, 'invalid_backup_manifest');
    for (const [field, amount] of Object.entries(group)) {
      if (!safeRecordKey(field)
        || (field === 'row_count'
          ? !nonNegativeSafeInteger(amount)
          : !financialDecimalString(amount))) {
        throw new Error('invalid_backup_manifest');
      }
    }
  }

  const integrity = exactObject(manifest['integrity'], [
    'integrity_check', 'foreign_key_violations',
  ], 'invalid_backup_manifest');
  if (integrity['integrity_check'] !== 'ok'
    || integrity['foreign_key_violations'] !== 0) {
    throw new Error('invalid_backup_manifest');
  }

  const smokeReads = boundedRecord(
    manifest['smoke_reads'],
    MAX_SMOKE_READS,
    'invalid_backup_manifest',
  );
  if (stableJson(Object.keys(smokeReads).sort())
    !== stableJson(Object.keys(SMOKE_QUERIES).sort())) {
    throw new Error('invalid_backup_manifest');
  }
  for (const [name, count] of Object.entries(smokeReads)) {
    if (!safeRecordKey(name) || !nonNegativeSafeInteger(count)) {
      throw new Error('invalid_backup_manifest');
    }
  }

  const tools = exactObject(manifest['tools'], [
    'node', 'npm', 'sqlite', 'wrangler',
  ], 'invalid_backup_manifest');
  if (Object.values(tools).some((version) => !boundedText(version, 256))) {
    throw new Error('invalid_backup_manifest');
  }

  const backup = exactObject(manifest['backup'], [
    'compression', 'uncompressed_bytes', 'uncompressed_sha256',
    'compressed_bytes', 'compressed_sha256',
  ], 'invalid_backup_manifest');
  if (backup['compression'] !== 'gzip'
    || !boundedPositiveSize(backup['uncompressed_bytes'], MAX_DUMP_BYTES)
    || !boundedPositiveSize(backup['compressed_bytes'], MAX_BUNDLE_BYTES)
    || !isSha256(backup['uncompressed_sha256'])
    || !isSha256(backup['compressed_sha256'])) {
    throw new Error('invalid_backup_manifest');
  }
}

function validateBackupAttestation(
  value: unknown,
): asserts value is D1BackupAttestation {
  const attestation = exactObject(value, [
    'format_version', 'generated_at_utc_ms', 'release_commit_sha',
    'schema_version', 'cipher', 'kdf', 'key_id', 'encrypted_bundle_bytes',
    'encrypted_bundle_sha256', 'manifest_sha256', 'anonymous_fixture',
    'attestation_hmac_sha256',
  ], 'invalid_backup_attestation');
  if (attestation['format_version'] !== PRODUCTION_READINESS_FORMAT_VERSION
    || !validTimestamp(attestation['generated_at_utc_ms'])
    || !isReleaseCommitSha(attestation['release_commit_sha'])
    || !positiveSafeInteger(attestation['schema_version'])
    || attestation['cipher'] !== 'AES-256-GCM'
    || attestation['kdf'] !== 'HKDF-SHA256'
    || typeof attestation['key_id'] !== 'string'
    || !/^[0-9a-f]{16}$/u.test(attestation['key_id'])
    || !boundedPositiveSize(attestation['encrypted_bundle_bytes'], MAX_BUNDLE_BYTES)
    || !isSha256(attestation['encrypted_bundle_sha256'])
    || !isSha256(attestation['manifest_sha256'])
    || typeof attestation['anonymous_fixture'] !== 'boolean'
    || !isSha256(attestation['attestation_hmac_sha256'])) {
    throw new Error('invalid_backup_attestation');
  }
}

function deriveBackupKeys(masterKey: Buffer): {
  encryptionKey: Buffer;
  authenticationKey: Buffer;
} {
  validateKey(masterKey);
  return {
    encryptionKey: Buffer.from(hkdfSync(
      'sha256', masterKey, HKDF_SALT, Buffer.from('aes-256-gcm', 'utf8'), 32,
    )),
    authenticationKey: Buffer.from(hkdfSync(
      'sha256', masterKey, HKDF_SALT, Buffer.from('attestation-hmac', 'utf8'), 32,
    )),
  };
}

function backupKeyId(authenticationKey: Buffer): string {
  return createHmac('sha256', authenticationKey)
    .update('backup-key-id/v1', 'utf8').digest('hex').slice(0, 16);
}

function hmacSha256(key: Buffer, value: Buffer): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

function secureHexEqual(left: string, right: string): boolean {
  if (!isSha256(left) || !isSha256(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function readBoundedRegularFile(
  filePath: string,
  maximumBytes: number,
  label: string,
): Buffer {
  const metadata = lstatSync(filePath);
  if (!metadata.isFile()) throw new Error(`${label}_must_be_regular_file`);
  if (metadata.size < 1 || metadata.size > maximumBytes) {
    throw new Error(`${label}_file_size_invalid`);
  }
  return readFileSync(filePath);
}

function parseJson(bytes: Buffer, errorCode: string): unknown {
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error(errorCode);
  }
}

function exactObject(
  value: unknown,
  allowedKeys: readonly string[],
  errorCode: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(errorCode);
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) throw new Error(errorCode);
  const keys = Object.keys(value);
  if (keys.length !== allowedKeys.length
    || keys.some((key) => !allowedKeys.includes(key))) {
    throw new Error(errorCode);
  }
  return value as Record<string, unknown>;
}

function boundedRecord(
  value: unknown,
  maximumEntries: number,
  errorCode: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(errorCode);
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) throw new Error(errorCode);
  const keys = Object.keys(value);
  if (keys.length > maximumEntries) throw new Error(errorCode);
  return value as Record<string, unknown>;
}

function validTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function boundedPositiveSize(value: unknown, maximum: number): value is number {
  return positiveSafeInteger(value) && Number(value) <= maximum;
}

function isReleaseCommitSha(value: unknown): value is string {
  return typeof value === 'string' && RELEASE_COMMIT_SHA.test(value);
}

function validateReleaseCommitSha(value: unknown): asserts value is string {
  if (!isReleaseCommitSha(value)) throw new Error('invalid_release_commit_sha');
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX.test(value);
}

function safeObjectName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,127}$/u.test(value);
}

function safeRecordKey(value: string): boolean {
  return /^[a-z][a-z0-9_]{0,127}$/u.test(value);
}

function financialDecimalString(value: unknown): value is string {
  return typeof value === 'string' && /^-?(?:0|[1-9][0-9]{0,38})$/u.test(value);
}

function boundedText(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= maximumLength
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validateKey(key: Buffer): void {
  if (key.byteLength !== 32) throw new Error('backup_key_must_be_32_bytes');
}

function assertTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_timestamp');
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortRecursively(value));
}

function sortRecursively(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecursively);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, sortRecursively(nested)]));
}
