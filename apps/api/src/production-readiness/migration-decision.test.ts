import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMigratedTestDatabase } from '@ygb/testkit';

describe('M10 production readiness migration decision', () => {
  it('keeps evidence external while accepting the governed schema 40', async () => {
    const root = path.resolve(import.meta.dirname, '../../../..');
    const migrations = readdirSync(path.join(root, 'migrations'))
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
      .sort();
    expect(migrations).toHaveLength(40);
    expect(migrations.at(-4)).toBe('0037_product_reservation_order_scheduling.sql');
    expect(migrations.at(-3)).toBe('0038_staff_mcp_production_transport_oauth.sql');
    expect(migrations.at(-2)).toBe('0039_staff_access_binding_management.sql');
    expect(migrations.at(-1)).toBe('0040_seller_partner_master_data_import.sql');
    expect(migrations.map((file) => Number(file.slice(0, 4))))
      .toEqual(Array.from({ length: 40 }, (_, index) => index + 1));
    const database = createMigratedTestDatabase();
    try {
      expect(await database.prepare(`SELECT schema_version
        FROM app_schema_state WHERE singleton_id=1`).first())
        .toEqual({ schema_version: 40 });
      const forbidden = await database.prepare(`SELECT name FROM sqlite_schema
        WHERE name LIKE '%backup%' OR name LIKE '%release_evidence%'`).all();
      expect(forbidden.results).toEqual([]);
    } finally {
      database.close();
    }
  });
});
