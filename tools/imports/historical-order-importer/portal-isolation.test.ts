import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { HISTORICAL_CSV_HEADERS } from './index';
import { runHistoricalImport } from './pipeline';

/**
 * Task 6.8 / stage 6.5 permission regression: the historical import tables
 * (order snapshots AND image inventory facts) are internal staff tooling
 * facts with zero portal surface. No Buyer/Seller/Staff route may expose
 * them, unmatched or quarantined rows never promote into portal-visible
 * business tables, and the API contract inventory stays at its stage 5
 * baseline of 246 endpoints (stage 6.6B).
 */

// vitest runs from the repository root (root vitest.config.ts), so resolve
// repository-relative paths from the process working directory.
const REPOSITORY_ROOT = process.cwd();
const ROUTE_INVENTORY = path.join(REPOSITORY_ROOT, 'docs/contracts/V2_API_ROUTE_INVENTORY.md');
const API_SOURCE_ROOT = path.join(REPOSITORY_ROOT, 'apps/api/src');
const EXPECTED_ENDPOINT_COUNT = 240;

function collectSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectSourceFiles(entryPath));
    else if (/\.(ts|tsx)$/u.test(entry.name)) entryPath && files.push(entryPath);
  }
  return files;
}

describe('historical import portal isolation (task 6.8)', () => {
  it('keeps the API contract inventory at the stage 7.5R baseline of 240 endpoints', () => {
    const inventory = readFileSync(ROUTE_INVENTORY, 'utf8');
    const endpointLines = inventory
      .split(/\r?\n/u)
      .filter((line) => /^(GET|POST|PUT|PATCH|DELETE) \/.*$/u.test(line.trim()));
    expect(endpointLines.length).toBe(EXPECTED_ENDPOINT_COUNT);
  });

  it('exposes no historical-import route or table reference in the API surface', () => {
    const offenders: string[] = [];
    for (const filePath of collectSourceFiles(API_SOURCE_ROOT)) {
      // The boundary guard test itself must enumerate the forbidden table
      // names to enforce the rule; it is an allowlisted enforcement artifact.
      if (filePath.includes('architecture-guards/historical-import-boundary.test.ts')) continue;
      const source = readFileSync(filePath, 'utf8');
      // Any route path mentioning historical imports, or any API-layer
      // reference to the historical_* snapshot / image-inventory tables,
      // counts as exposure.
      if (/['"`]\/api\/[^'"`]*historical/u.test(source)
        || /historical_orders\b|historical_order_files\b|historical_import_/u.test(source)
        || /historical_image_inventory_/u.test(source)) {
        offenders.push(path.relative(REPOSITORY_ROOT, filePath));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never promotes unmatched or quarantined import rows into portal-visible tables', async () => {
    const database: SqliteDatabase = createMigratedTestDatabase();
    const portalCounts = `SELECT (SELECT COUNT(*) FROM formal_orders) AS formal_orders,
      (SELECT COUNT(*) FROM buyer_customers) AS buyers,
      (SELECT COUNT(*) FROM seller_organizations) AS sellers,
      (SELECT COUNT(*) FROM order_evidence_submissions) AS evidence`;
    const before = await database.prepare(portalCounts).first<Record<string, number>>();

    // One fully-unmatched historical row (no seeded identities anywhere).
    const cells: Record<string, string> = {};
    const valid: Record<string, string> = {
      '下单日期': '2026-01-10', '更新状态': '已完成', '客户编号': 'C001', '买家微信': 'wx-unmatched-a',
      '店铺名字': '未匹配店铺', 'ASIN': 'B0TEST0001', '订单价格': '1980',
      '订单号': '123-1234567-9000001', '返款汇率': '0.058', '卖家返金汇率': '0.053',
      '汇率差': '0.005', '服务费金额': '25', '买家返金金额': '95.5', '卖家返金金额': '90',
    };
    for (const header of HISTORICAL_CSV_HEADERS) cells[header] = valid[header] ?? '';
    const csv = `${HISTORICAL_CSV_HEADERS.join(',')}\n${HISTORICAL_CSV_HEADERS.map((h) => cells[h]).join(',')}\n`;
    const applied = await runHistoricalImport(database, {
      sourceSystem: 'HISTORICAL_ORDER_CSV',
      files: [{ name: 'unmatched.csv', text: csv }],
    }, { mode: 'APPLY_LOCAL', now: Date.UTC(2026, 7, 26) });

    // The row imports losslessly and is EXPLICITLY unresolved (durable
    // IDENTITY_UNMATCHED quarantine fact) — but nothing portal-visible moves.
    expect(applied.applied_orders).toBe(1);
    expect(applied.report.quarantine_by_code['IDENTITY_UNMATCHED']).toBe(1);
    const unresolved = await database.prepare(
      `SELECT COUNT(*) AS count FROM historical_import_quarantine
       WHERE exception_code IN ('IDENTITY_UNMATCHED','IDENTITY_CONFLICT','MULTI_LINE_ORDER_REQUIRES_MAPPING')`,
    ).first<{ count: number }>();
    expect(unresolved!.count).toBe(1);
    const after = await database.prepare(portalCounts).first<Record<string, number>>();
    expect(after).toEqual(before);

    // Structural promotion boundaries: no view reads the historical tables,
    // and formal_orders has no foreign-key linkage into them — Buyer/Seller
    // portal queries (which select from formal_orders and its view chain)
    // cannot surface unresolved data by construction.
    const views = database.raw
      .prepare("SELECT sql FROM sqlite_schema WHERE type='view' AND sql IS NOT NULL")
      .all() as { sql: string }[];
    expect(views.some((view) => /historical_/u.test(view.sql))).toBe(false);
    const foreignKeys = database.raw
      .prepare('PRAGMA foreign_key_list(formal_orders)')
      .all() as { table: string }[];
    expect(foreignKeys.some((key) => key.table.startsWith('historical_'))).toBe(false);
    database.close();
  });
});
