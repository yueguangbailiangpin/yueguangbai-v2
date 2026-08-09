import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const historicalMigrationBaseline =
  '384873ac3c5c6f83d73e6dd8e1788992081b78e7';
export const immutableHistoricalMigrationCount = 42;
export const historicalMigrationAggregateSha256 =
  'd389081b1d9a4a5d00b62fa00781e4e97a72695283d38f2bb969cb390e4a9119';

export function verifyHistoricalMigrationImmutability(root) {
  const migrationsDirectory = path.join(root, 'migrations');
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
    .filter((name) => Number(name.slice(0, 4)) <= 42)
    .sort();
  const manifestPath = path.join(
    migrationsDirectory,
    'HISTORICAL_MIGRATIONS_0001_0042.sha256',
  );
  const manifestLines = readFileSync(manifestPath, 'utf8')
    .split(/\r?\n/u)
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (migrationFiles.length !== immutableHistoricalMigrationCount
    || manifestLines.length !== immutableHistoricalMigrationCount) {
    throw new Error('historical migration baseline must contain 0001-0042');
  }

  const historicalAggregate = createHash('sha256');
  for (const [index, line] of manifestLines.entries()) {
    const match = /^([a-f0-9]{64})  (migrations\/(\d{4}_[a-z0-9_-]+\.sql))$/u
      .exec(line);
    if (!match) {
      throw new Error(`invalid historical migration manifest line: ${line}`);
    }
    const [, expectedHash, repositoryPath, fileName] = match;
    if (fileName !== migrationFiles[index]) {
      throw new Error(
        `historical migration manifest order mismatch: ${fileName}`,
      );
    }
    const migrationBytes = readFileSync(path.join(root, repositoryPath));
    const actualHash = createHash('sha256')
      .update(migrationBytes)
      .digest('hex');
    if (actualHash !== expectedHash) {
      throw new Error(
        `historical migration changed after ${historicalMigrationBaseline}: `
        + repositoryPath,
      );
    }
    historicalAggregate.update(fileName);
    historicalAggregate.update(Buffer.from([0]));
    historicalAggregate.update(migrationBytes);
    historicalAggregate.update(Buffer.from([0]));
  }

  const actualAggregateSha256 = historicalAggregate.digest('hex');
  if (actualAggregateSha256 !== historicalMigrationAggregateSha256) {
    throw new Error(
      `historical migration aggregate changed after ${historicalMigrationBaseline}`,
    );
  }
  return {
    baseline: historicalMigrationBaseline,
    count: immutableHistoricalMigrationCount,
    aggregateSha256: actualAggregateSha256,
  };
}
