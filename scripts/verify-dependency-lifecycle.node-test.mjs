import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LIFECYCLE_PACKAGE_ALLOWLIST } from './dependency-lifecycle-allowlist.mjs';
import { verifyLifecycleProvenance } from './verify-dependency-lifecycle.mjs';

const lockfile = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

function fixture() {
  return structuredClone(lockfile);
}

function lifecycleEntry(lock, path = 'node_modules/@fission-ai/openspec') {
  return lock.packages[path];
}

function expectProvenanceFailure(lock, expectedField) {
  assert.throws(() => verifyLifecycleProvenance(lock), (error) => {
    assert.equal(error.name, 'LifecycleProvenanceError');
    const report = JSON.parse(error.message);
    assert.ok(report.violations.some((violation) => (
      violation.kind === 'provenance_mismatch'
      && violation.fields.includes(expectedField)
    )));
    return true;
  });
}

test('accepts the committed lifecycle provenance fixture', () => {
  assert.equal(verifyLifecycleProvenance(fixture()).length, LIFECYCLE_PACKAGE_ALLOWLIST.length);
});

test('rejects a changed resolved tarball for the same package and version', () => {
  const lock = fixture();
  lifecycleEntry(lock).resolved = 'https://registry.npmjs.org/@fission-ai/openspec/-/other.tgz';
  expectProvenanceFailure(lock, 'resolved');
});

test('rejects changed integrity', () => {
  const lock = fixture();
  lifecycleEntry(lock).integrity = 'sha512-not-the-approved-integrity';
  expectProvenanceFailure(lock, 'integrity');
});

test('rejects a missing resolved field', () => {
  const lock = fixture();
  delete lifecycleEntry(lock).resolved;
  expectProvenanceFailure(lock, 'resolved');
});

test('rejects a missing integrity field', () => {
  const lock = fixture();
  delete lifecycleEntry(lock).integrity;
  expectProvenanceFailure(lock, 'integrity');
});
