import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations, SqliteDatabase } from '../packages/testkit/src/index.ts';

const roots = [];
const releaseSha = 'a'.repeat(40);
const LONG_RUNNING_TEST_TIMEOUT_MS = 30_000;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('backup and restore CLI expected schema', () => {
  it.each(['backup-d1.mjs', 'restore-d1.mjs'])('%s requires expected schema before file access', (script) => {
    const result = run(script, []);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('missing_argument:expected-schema');
  });

  it.each(['backup-d1.mjs', 'restore-d1.mjs'])('%s rejects invalid expected schema', (script) => {
    const result = run(script, ['--expected-schema', '0']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('invalid_argument:expected-schema');
  });

  it('rejects an explicit schema mismatch', () => {
    const fixture = localFixture();
    const result = run('backup-d1.mjs', backupArgs(fixture, '37'));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unexpected_schema_version');
  });

  it('creates and restores one anonymous schema-32 fixture when both values match', () => {
    const fixture = localFixture();
    const backup = run('backup-d1.mjs', backupArgs(fixture, '32'));
    expect(backup.status, backup.stderr).toBe(0);
    const restored = run('restore-d1.mjs', [
      '--expected-schema', '32',
      '--bundle', path.join(fixture.backup, 'd1-backup.bundle.aes256gcm'),
      '--attestation', path.join(fixture.backup, 'd1-backup.attestation.json'),
      '--restore-database', path.join(fixture.root, 'restored.sqlite'),
      '--key-file', fixture.key,
      '--expected-release-commit-sha', releaseSha,
    ]);
    expect(restored.status, restored.stderr).toBe(0);
    expect(JSON.parse(restored.stdout)).toMatchObject({ status: 'PASS', schema_version: 32 });
  }, LONG_RUNNING_TEST_TIMEOUT_MS);
});

function localFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'backup-cli-'));
  roots.push(root);
  const database = path.join(root, 'source.sqlite');
  const sqlite = new SqliteDatabase(database);
  applyMigrations(sqlite);
  sqlite.close();
  const key = path.join(root, 'key');
  writeFileSync(key, Buffer.alloc(32, 7), { mode: 0o600 });
  chmodSync(key, 0o600);
  return { root, database, key, backup: path.join(root, 'backup') };
}

function backupArgs(fixture, expectedSchema) {
  return [
    '--expected-schema', expectedSchema,
    '--database', fixture.database,
    '--output-dir', fixture.backup,
    '--key-file', fixture.key,
    '--release-commit-sha', releaseSha,
    '--anonymous-fixture',
  ];
}

function run(script, args) {
  return spawnSync(process.execPath, [path.join('scripts', script), ...args], {
    cwd: path.resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
  });
}
