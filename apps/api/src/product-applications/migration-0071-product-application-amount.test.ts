import { describe, expect, it } from 'vitest';
import { createMigratedTestDatabase } from '@ygb/testkit';

describe('Migration 0071 product application amount', () => {
  it('advances the schema and adds a guarded nullable legacy column', async () => {
    const database = createMigratedTestDatabase();
    try {
      await expect(database.prepare(`
        SELECT schema_version
        FROM app_schema_state
        WHERE singleton_id=1
      `).first()).resolves.toEqual({ schema_version: 71 });

      const columns = await database.prepare(
        `PRAGMA table_info(product_applications)`,
      ).all<{ name: string }>();
      expect(columns.results.some(
        (column) => column.name === 'ordering_guide_expected_amount_jpy',
      )).toBe(true);
    } finally {
      database.close();
    }
  });
});
