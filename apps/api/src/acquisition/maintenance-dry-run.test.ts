import { afterEach, describe, expect, it } from 'vitest';
import { createMigratedTestDatabase, type SqliteDatabase } from '@ygb/testkit';
import { hashNormalizedWechat } from './privacy';
import { runAcquisitionMaintenance } from './maintenance';

const SECRET = 'acquisition-dry-run-secret-at-least-thirty-two-bytes';
let database: SqliteDatabase | null = null;

afterEach(() => { database?.close(); database = null; });

describe('acquisition Worker dry-run', () => {
  it('reports only counts and leaves leads, leases, runs and audit facts unchanged', async () => {
    database = createMigratedTestDatabase();
    const now = Date.UTC(2026, 7, 8, 4);
    await seedCandidate(database, 'dry-run-anonymize', 'dry_run_wx_1', now - 1, null);
    await seedCandidate(database, 'dry-run-exempt', 'dry_run_wx_2', now - 1, 'LEGAL');
    const before = snapshot(database);

    const result = await runAcquisitionMaintenance(database, {
      identitySecret: SECRET, now, dryRun: true, limit: 100,
    });

    expect(result).toEqual({
      outcome: 'SUCCEEDED', linked_count: 0, anonymized_count: 1, exempt_count: 1,
    });
    expect(snapshot(database)).toEqual(before);
    expect(JSON.stringify(result)).not.toMatch(/dry_run_wx|identity|cipher|hash/iu);
  });

  it('fails closed before reading or writing when the identity secret is invalid', async () => {
    database = createMigratedTestDatabase();
    const before = snapshot(database);
    await expect(runAcquisitionMaintenance(database, {
      identitySecret: 'short', now: Date.UTC(2026, 7, 8, 4), dryRun: true,
    })).rejects.toThrow('DEPENDENCY_UNAVAILABLE');
    expect(snapshot(database)).toEqual(before);
  });
});

async function seedCandidate(
  db: SqliteDatabase,
  id: string,
  wechat: string,
  retentionDueAt: number,
  hold: 'LEGAL' | null,
): Promise<void> {
  const hash = await hashNormalizedWechat(wechat, SECRET);
  db.raw.prepare(`INSERT INTO acquisition_channels (
    id,code,channel_type,display_name,status,version,created_by_staff_id,
    created_at,updated_at,disabled_at
  ) VALUES (?,?,?,?, 'ACTIVE',1,'zz-phase3h-test-owner',1,1,NULL)`)
    .run(`channel-${id}`, `CODE_${id.replaceAll('-', '_').toUpperCase()}`,
      'OTHER', `Channel ${id}`);
  db.raw.prepare(`INSERT INTO acquisition_leads (
    id,lead_type,identity_hash,identity_ciphertext,identity_iv,wechat_masked,
    display_name,note,origin_channel_id,origin_staff_id,current_owner_staff_id,
    status,invalidation_reason,retention_hold_reason,version,created_business_date,
    latest_followup_at,retention_due_at,created_at,updated_at,invalidated_at,anonymized_at
  ) VALUES (?,'BUYER',?,'cipher','iv','dr***wx',NULL,NULL,?,
    'zz-phase3h-test-owner','zz-phase3h-test-owner','ACTIVE',NULL,?,1,
    '2025-01-01',1,?,1,1,NULL,NULL)`)
    .run(id, hash, `channel-${id}`, hold, retentionDueAt);
}

function snapshot(db: SqliteDatabase): Record<string, unknown> {
  return {
    leads: db.raw.prepare(`SELECT id,status,identity_hash,identity_ciphertext,
      identity_iv,display_name,note,version FROM acquisition_leads ORDER BY id`).all(),
    maintenance: db.raw.prepare(`SELECT * FROM acquisition_maintenance_state`).all(),
    runs: db.raw.prepare(`SELECT COUNT(*) AS count FROM acquisition_maintenance_runs`).get(),
    audit: db.raw.prepare(`SELECT COUNT(*) AS count FROM audit_events`).get(),
  };
}
