// Shared bootstrap for legacy-named verifiers that were originally anchored on
// historical migration files (0022/0023/0024/...). Since the stage 3 clean
// baseline (D-054) replaced the 0001-0075 chain, these verifiers anchor on the
// applied final schema of the new 0001-0019 chain instead. Chain-number
// assertions retired with the old chain; every schema constraint assertion is
// preserved against the real baseline state.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

export function applyBaseline() {
  const directory = path.join(repositoryRoot, 'migrations');
  const files = readdirSync(directory)
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort();
  if (files.length === 0) throw new Error('no baseline migrations found');
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON;');
  for (const file of files) {
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(readFileSync(path.join(directory, file), 'utf8'));
      database.exec('COMMIT;');
    } catch (error) {
      try {
        database.exec('ROLLBACK;');
      } catch {
        /* no open transaction */
      }
      throw new Error(`baseline application failed at ${file}: ${error}`);
    }
  }
  return database;
}

export function baselineSchemaText(database) {
  return database
    .prepare(
      `SELECT sql FROM sqlite_schema
       WHERE sql IS NOT NULL
       ORDER BY type, name`,
    )
    .all()
    .map((row) => String(row.sql))
    .join('\n');
}
