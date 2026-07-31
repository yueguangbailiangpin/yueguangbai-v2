import { afterEach, describe, expect, it } from 'vitest';
import type { SqliteDatabase } from './sqlite-database';
import {
  createMigratedTestDatabase,
} from './sqlite-database';

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('SQLite D1-compatible test adapter', () => {
  it('applies the foundation migration and runs an atomic batch', async () => {
    database = createMigratedTestDatabase();

    const results = await database.batch([
      database.prepare(`INSERT INTO transaction_assertions
        (assertion_value) VALUES (1)`),
      database.prepare(`INSERT INTO transaction_assertions
        (assertion_value) VALUES (1)`),
    ]);

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.meta.changes === 1))
      .toBe(true);
    const count = await database.prepare(
      'SELECT COUNT(*) AS total FROM transaction_assertions',
    ).first<{ total: number }>();
    expect(Number(count?.total)).toBe(0);
  });

  it('rolls back the complete batch when an assertion fails', async () => {
    database = createMigratedTestDatabase();

    await expect(database.batch([
      database.prepare(`INSERT INTO integration_outbox (
        id, dedup_key, event_type, aggregate_type, aggregate_id,
        payload_json, payload_hash, status, available_at,
        lease_token, lease_expires_at, attempt_count, last_error,
        created_at, updated_at, sent_at
      ) VALUES (
        'outbox-before-failure', 'dedup-before-failure', 'TEST',
        'TEST', 'aggregate-1', '{}',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'PENDING', 1, NULL, NULL, 0, NULL, 1, 1, NULL
      )`),
      database.prepare(`INSERT INTO transaction_assertions
        (assertion_value) VALUES (0)`),
    ])).rejects.toThrow();

    const row = await database.prepare(
      `SELECT id FROM integration_outbox
       WHERE id='outbox-before-failure'`,
    ).first();
    expect(row).toBeNull();
  });
});
