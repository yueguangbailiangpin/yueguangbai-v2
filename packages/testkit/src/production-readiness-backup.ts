import { spawnSync } from 'node:child_process';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import {
  chmodSync,
  existsSync,
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
  restorePath: string;
  key: Buffer;
  verifiedAtUtcMs?: number;
  expectedSchemaVersion?: number;
}

export async function createEncryptedD1Backup(
  input: CreateBackupInput,
): Promise<CreateBackupResult> {
  validateKey(input.key);
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
    const manifestBytes = Buffer.from(stableJson(manifest));
    const payload = encodePayload(manifestBytes, compressed);
    const encrypted = encryptPayload(payload, input.key);
    writeFileSync(bundlePath, encrypted, { mode: 0o600, flag: 'wx' });
    chmodSync(bundlePath, 0o600);

    const attestation: D1BackupAttestation = {
      format_version: PRODUCTION_READINESS_FORMAT_VERSION,
      generated_at_utc_ms: generatedAtUtcMs,
      schema_version: evidence.schemaVersion,
      cipher: 'AES-256-GCM',
      key_id: sha256(input.key).slice(0, 16),
      encrypted_bundle_bytes: encrypted.byteLength,
      encrypted_bundle_sha256: sha256(encrypted),
      manifest_sha256: sha256(manifestBytes),
      anonymous_fixture: input.anonymousFixture === true,
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
  if (existsSync(input.restorePath)) throw new Error('restore_target_exists');
  const encrypted = readFileSync(input.bundlePath);
  const payload = decryptPayload(encrypted, input.key);
  const { manifestBytes, compressed } = decodePayload(payload);
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as D1BackupManifest;
  validateManifest(manifest);
  if (sha256(compressed) !== manifest.backup.compressed_sha256
    || compressed.byteLength !== manifest.backup.compressed_bytes) {
    throw new Error('compressed_backup_mismatch');
  }
  const sqlDump = gunzipSync(compressed);
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
  return Buffer.from(result.stdout);
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
  if (manifestLength < 2 || compressedStart >= payload.byteLength) {
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

function validateManifest(manifest: D1BackupManifest): void {
  if (manifest.format_version !== PRODUCTION_READINESS_FORMAT_VERSION
    || manifest.time_basis !== 'UTC_MS'
    || manifest.display_timezone !== 'Asia/Shanghai'
    || !Number.isSafeInteger(manifest.schema_version)
    || manifest.schema_version < 1
    || !/^[0-9a-f]{64}$/u.test(manifest.schema_fingerprint_sha256)
    || !/^[0-9a-f]{64}$/u.test(manifest.backup.compressed_sha256)
    || !/^[0-9a-f]{64}$/u.test(manifest.backup.uncompressed_sha256)) {
    throw new Error('invalid_backup_manifest');
  }
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
