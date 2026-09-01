import { describe, expect, it } from 'vitest';

const INTERMEDIATE_TABLES = [
  'seller_partner_import_batches',
  'seller_partner_import_source_records',
  'standard_products',
  'seller_product_offerings',
  'product_reservation_openings',
  'historical_import_batches',
  'historical_orders',
  'historical_order_files',
  'historical_import_quarantine',
  'historical_import_identity_overrides',
  'historical_image_inventory_batches',
  'historical_image_inventory_files',
  'historical_image_inventory_findings',
] as const;

const ALLOWED_DIRECTORIES = [
  'apps/api/src/architecture-guards',
  'tools/imports',
] as const;

function productionRuntimeFiles(): string[] {
  // apps/api portal and formal business routes must not touch the import
  // intermediate or historical_* tables. Walk the tree with node:fs.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readdirSync, readFileSync, statSync } = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path');
  const root = process.cwd();
  const apiRoot = path.join(root, 'apps/api/src');
  const skip = new Set(
    ALLOWED_DIRECTORIES.map((relative) =>
      path.join(root, relative).replace(/\/$/, ''),
    ),
  );
  const files: string[] = [];
  const walk = (directory: string): void => {
    if ([...skip].some((allowed) => directory === allowed || directory.startsWith(`${allowed}/`)))
      return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (/\.(ts|tsx)$/u.test(entry.name) && !/\.test\./u.test(entry.name)) files.push(entryPath);
    }
  };
  walk(apiRoot);
  void readFileSync;
  void statSync;
  return files;
}

describe('historical import intermediate-model source boundary (D-056 §6.6.6)', () => {
  it('keeps import intermediate and historical_* tables out of runtime portal and staff routes', () => {
    const violations: string[] = [];
    for (const file of productionRuntimeFiles()) {
      const source = require('node:fs').readFileSync(file, 'utf8') as string;
      for (const table of INTERMEDIATE_TABLES) {
        // Word-boundary match catches both SQL text and TS identifiers.
        if (new RegExp(`\\b${table}\\b`, 'u').test(source)) {
          violations.push(`${file.replace(`${process.cwd()}/`, '')}: ${table}`);
        }
      }
    }
    expect(violations, JSON.stringify(violations, null, 1)).toEqual([]);
  });

  it('keeps the four legacy customer-onboarding runtime reads off the import tables', () => {
    // The four documented call sites were rewritten or deleted in 6.6C; this
    // assertion guards the specific modules so a regression cannot return.
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { existsSync } = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const guardFiles = [
      'apps/api/src/customer-onboarding/historical-seller-directory.ts',
      'apps/api/src/customer-onboarding/lead-guard.ts',
      'apps/api/src/seller-registration/service.ts',
    ];
    for (const relative of guardFiles) {
      const absolute = path.join(process.cwd(), relative);
      if (!existsSync(absolute)) continue; // deleted by 6.6C (lead-guard)
      const source = readFileSync(absolute, 'utf8');
      for (const table of INTERMEDIATE_TABLES) {
        expect(
          new RegExp(`\\b${table}\\b`, 'u').test(source),
          `${relative} references ${table}`,
        ).toBe(false);
      }
    }
  });
});
