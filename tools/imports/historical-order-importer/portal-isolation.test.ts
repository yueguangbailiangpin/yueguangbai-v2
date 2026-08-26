import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Task 6.8 permission regression: the historical import tables are internal
 * staff tooling facts with zero portal surface. No Buyer/Seller/Staff route
 * may expose them, and the API contract inventory stays at its stage 5
 * baseline of 248 endpoints.
 */

// vitest runs from the repository root (root vitest.config.ts), so resolve
// repository-relative paths from the process working directory.
const REPOSITORY_ROOT = process.cwd();
const ROUTE_INVENTORY = path.join(REPOSITORY_ROOT, 'docs/contracts/V2_API_ROUTE_INVENTORY.md');
const API_SOURCE_ROOT = path.join(REPOSITORY_ROOT, 'apps/api/src');
const EXPECTED_ENDPOINT_COUNT = 248;

function collectSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectSourceFiles(entryPath));
    else if (/\.(ts|tsx)$/u.test(entry.name)) files.push(entryPath);
  }
  return files;
}

describe('historical import portal isolation (task 6.8)', () => {
  it('keeps the API contract inventory at the stage 5 baseline of 248 endpoints', () => {
    const inventory = readFileSync(ROUTE_INVENTORY, 'utf8');
    const endpointLines = inventory
      .split(/\r?\n/u)
      .filter((line) => /^(GET|POST|PUT|PATCH|DELETE) \/.*$/u.test(line.trim()));
    expect(endpointLines.length).toBe(EXPECTED_ENDPOINT_COUNT);
  });

  it('exposes no historical-import route or table reference in the API surface', () => {
    const offenders: string[] = [];
    for (const filePath of collectSourceFiles(API_SOURCE_ROOT)) {
      const source = readFileSync(filePath, 'utf8');
      // Any route path mentioning historical imports, or any API-layer
      // reference to the historical_* snapshot tables, counts as exposure.
      if (/['"`]\/api\/[^'"`]*historical/u.test(source)
        || /historical_orders\b|historical_order_files\b|historical_import_/u.test(source)) {
        offenders.push(path.relative(REPOSITORY_ROOT, filePath));
      }
    }
    expect(offenders).toEqual([]);
  });
});
