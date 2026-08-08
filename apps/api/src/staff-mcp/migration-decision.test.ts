import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMigratedTestDatabase } from '@ygb/testkit';

const root = resolve(import.meta.dirname, '../../../..');

describe('Staff MCP migration decision', () => {
  it('reuses the immutable generic audit table beneath the governed schema 36', async () => {
    const migrations = readdirSync(resolve(root, 'migrations'))
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
      .sort();
    expect(migrations.at(-2)).toBe('0035_staff_four_role_consolidation.sql');
    expect(migrations.at(-1)).toBe('0036_staff_acquisition_funnel_workbench.sql');
    expect(migrations).toHaveLength(36);
    const foundation = readFileSync(resolve(root, 'migrations/0001_foundation.sql'), 'utf8');
    expect(foundation).toContain('CREATE TABLE audit_events');
    expect(foundation).toContain('trg_audit_events_no_update');
    expect(foundation).toContain('trg_audit_events_no_delete');

    const database = createMigratedTestDatabase();
    try {
      const state = await database.prepare(`
        SELECT schema_version FROM app_schema_state WHERE singleton_id=1
      `).first<{ schema_version: number }>();
      expect(state).toEqual({ schema_version: 36 });
    } finally {
      database.close();
    }
  });
});
