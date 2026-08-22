import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMigratedTestDatabase } from '@ygb/testkit';

const root = resolve(import.meta.dirname, '../../../..');

describe('Staff MCP production transport migration', () => {
  it('preserves guarded schema 38 beneath the current schema 72 authority', async () => {
    const migrations = readdirSync(resolve(root, 'migrations'))
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
      .sort();
    expect(migrations[36]).toBe('0037_product_reservation_order_scheduling.sql');
    expect(migrations[37]).toBe('0038_staff_mcp_production_transport_oauth.sql');
    expect(migrations[38]).toBe('0039_staff_access_binding_management.sql');
    expect(migrations[40]).toBe('0041_seller_principal_rate_policy.sql');
    expect(migrations[41]).toBe('0042_rakuten_tiktok_jp_marketplace_foundation.sql');
    expect(migrations[42]).toBe('0043_seller_principal_rate_integrity_hardening.sql');
    expect(migrations).toHaveLength(72);
    expect(migrations.at(-1)).toBe('0072_unified_order_day_rate_center.sql');
    const foundation = readFileSync(resolve(root, 'migrations/0001_foundation.sql'), 'utf8');
    const migration = readFileSync(
      resolve(root, 'migrations/0038_staff_mcp_production_transport_oauth.sql'),
      'utf8',
    );
    expect(foundation).toContain('CREATE TABLE audit_events');
    expect(foundation).toContain('trg_audit_events_no_update');
    expect(foundation).toContain('trg_audit_events_no_delete');
    expect(migration).toContain("'COMPLETED_NO_RESPONSE'");
    expect(migration).toContain('length(response_json)<=262144');
    expect(migration).not.toContain('16777216');

    const database = createMigratedTestDatabase();
    try {
      const state = await database.prepare(`
        SELECT schema_version FROM app_schema_state WHERE singleton_id=1
      `).first<{ schema_version: number }>();
      expect(state).toEqual({ schema_version: 72 });
      const control = await database.prepare(`
        SELECT enabled, reason_code FROM staff_mcp_runtime_controls
        WHERE control_type='GLOBAL' AND control_name='staff-mcp'
      `).first();
      expect(control).toEqual({ enabled: 0, reason_code: 'DEFAULT_DISABLED' });
      await expect(database.prepare(`
        INSERT INTO staff_mcp_replay_records (
          replay_key_hash,request_hash,tool_name,status,lease_token_hash,
          lease_expires_at,response_json,expires_at,created_at,updated_at,completed_at
        ) VALUES (?,?,'read_task_screenshot_v1','COMPLETED_NO_RESPONSE',
          NULL,NULL,?,100,1,2,2)
      `).bind('1'.repeat(64), '2'.repeat(64), '"raw-image-forbidden"').run())
        .rejects.toThrow();
    } finally {
      database.close();
    }
  });
});
