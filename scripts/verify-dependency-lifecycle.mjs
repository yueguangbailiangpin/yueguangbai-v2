import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LIFECYCLE_PACKAGE_ALLOWLIST } from './dependency-lifecycle-allowlist.mjs';

const PROVENANCE_FIELDS = Object.freeze(['name', 'version', 'path', 'optional', 'resolved', 'integrity']);

function packageNameFromLockPath(lockPath) {
  const segment = lockPath.slice(lockPath.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const parts = segment.split('/');
  return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function recordId(record) {
  return `${record.path} (${record.name}@${record.version})`;
}

function recordKey(record) {
  return `${record.path}\u0000${record.name}\u0000${record.version}`;
}

function readExactField(metadata, field) {
  return Object.hasOwn(metadata, field) ? metadata[field] : null;
}

function validateAllowlistRecord(record) {
  const missing = ['name', 'version', 'path', 'reason'].filter((field) => !record[field]);
  if (missing.length || typeof record.optional !== 'boolean') {
    throw new Error(`invalid lifecycle allowlist record: ${record.path ?? '<unknown>'}`);
  }
  for (const field of ['resolved', 'integrity']) {
    if (typeof record[field] !== 'string' && record[field] !== null) {
      throw new Error(`invalid ${field} approval for ${recordId(record)}`);
    }
    if (record[field] === null && !record.provenanceNote) {
      throw new Error(`missing provenanceNote for absent ${field} approval: ${recordId(record)}`);
    }
  }
}

function failure(violations) {
  const error = new Error(JSON.stringify({
    status: 'FAIL',
    source: 'package-lock.json packages[*].hasInstallScript',
    violations,
  }, null, 2));
  error.name = 'LifecycleProvenanceError';
  return error;
}

export function verifyLifecycleProvenance(lockfile, allowlist = LIFECYCLE_PACKAGE_ALLOWLIST) {
  const approvedByKey = new Map();
  for (const record of allowlist) {
    validateAllowlistRecord(record);
    const key = recordKey(record);
    if (approvedByKey.has(key)) {
      throw new Error(`duplicate lifecycle allowlist record: ${recordId(record)}`);
    }
    approvedByKey.set(key, record);
  }

  const actualRecords = [];
  const invalidRecords = [];
  for (const [lockPath, metadata] of Object.entries(lockfile.packages ?? {})) {
    if (!metadata.hasInstallScript) continue;
    if (!lockPath.includes('node_modules/') || !metadata.version) {
      invalidRecords.push({ kind: 'unverifiable_lifecycle_record', path: lockPath });
      continue;
    }
    actualRecords.push({
      name: packageNameFromLockPath(lockPath),
      version: metadata.version,
      path: lockPath,
      optional: metadata.optional === true,
      resolved: readExactField(metadata, 'resolved'),
      integrity: readExactField(metadata, 'integrity'),
    });
  }

  const actualByKey = new Map(actualRecords.map((record) => [recordKey(record), record]));
  const violations = [...invalidRecords];
  for (const [key, actual] of actualByKey) {
    const approved = approvedByKey.get(key);
    if (!approved) {
      violations.push({ kind: 'unapproved_lifecycle_record', record: recordId(actual) });
      continue;
    }
    const mismatchedFields = PROVENANCE_FIELDS.filter((field) => actual[field] !== approved[field]);
    if (mismatchedFields.length) {
      violations.push({
        kind: 'provenance_mismatch',
        record: recordId(actual),
        fields: mismatchedFields,
      });
    }
  }
  for (const [key, approved] of approvedByKey) {
    if (!actualByKey.has(key)) {
      violations.push({ kind: 'approved_record_missing_from_lockfile', record: recordId(approved) });
    }
  }
  if (violations.length) throw failure(violations);

  return [...actualRecords]
    .sort((left, right) => recordId(left).localeCompare(recordId(right)))
    .map((actual) => ({ ...actual, reason: approvedByKey.get(recordKey(actual)).reason }));
}

function run() {
  const lockfile = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const lifecyclePackages = verifyLifecycleProvenance(lockfile);
  console.log(JSON.stringify({
    status: 'PASS',
    source: 'package-lock.json packages[*].hasInstallScript',
    approval: 'exact name/version/path/optional/resolved/integrity allowlist',
    lifecycle_packages: lifecyclePackages,
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run();
