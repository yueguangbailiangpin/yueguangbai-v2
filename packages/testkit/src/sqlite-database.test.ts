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
      database.prepare(`INSERT INTO audit_events (
        id, aggregate_type, aggregate_id, event_type, actor_json,
        request_id, idempotency_key, previous_state_json, next_state_json, created_at
      ) VALUES (
        'rollback-before-failure', 'TEST', 'aggregate-1', 'TEST_EVENT',
        '{}', NULL, NULL, NULL, '{}', 1
      )`),
      database.prepare(`INSERT INTO transaction_assertions
        (assertion_value) VALUES (0)`),
    ])).rejects.toThrow();

    const row = await database.prepare(
      `SELECT id FROM audit_events
       WHERE id='rollback-before-failure'`,
    ).first();
    expect(row).toBeNull();
  });
});
