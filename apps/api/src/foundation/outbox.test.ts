import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import {
  claimNextOutboxEvent,
  createOutboxStatements,
  markOutboxFailed,
  markOutboxSent,
  prepareOutboxEvent,
} from './outbox';

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('integration outbox', () => {
  it('deduplicates identical events and rejects a conflicting payload', async () => {
    database = createMigratedTestDatabase();

    const first = await prepareOutboxEvent({
      id: 'outbox-1',
      dedupKey: 'task:create:aggregate-1',
      eventType: 'TASK_CREATED',
      aggregateType: 'TEST',
      aggregateId: 'aggregate-1',
      payload: { b: 2, a: 1 },
      createdAt: 1000,
    });
    await database.batch(createOutboxStatements(database, first));

    const replay = await prepareOutboxEvent({
      id: 'outbox-replay',
      dedupKey: 'task:create:aggregate-1',
      eventType: 'TASK_CREATED',
      aggregateType: 'TEST',
      aggregateId: 'aggregate-1',
      payload: { a: 1, b: 2 },
      createdAt: 1100,
    });
    await expect(database.batch(
      createOutboxStatements(database, replay),
    )).resolves.toHaveLength(2);

    const count = await database.prepare(`
      SELECT COUNT(*) AS total
      FROM integration_outbox
    `).first<{ total: number }>();
    expect(Number(count?.total)).toBe(1);

    const conflict = await prepareOutboxEvent({
      id: 'outbox-conflict',
      dedupKey: 'task:create:aggregate-1',
      eventType: 'TASK_CREATED',
      aggregateType: 'TEST',
      aggregateId: 'aggregate-1',
      payload: { a: 999 },
      createdAt: 1200,
    });
    await expect(database.batch(
      createOutboxStatements(database, conflict),
    )).rejects.toThrow('transaction_assertion_failed');
  });

  it('claims, fails with retry, reclaims, and marks sent', async () => {
    database = createMigratedTestDatabase();

    const prepared = await prepareOutboxEvent({
      id: 'outbox-2',
      dedupKey: 'task:update:aggregate-2',
      eventType: 'TASK_UPDATED',
      aggregateType: 'TEST',
      aggregateId: 'aggregate-2',
      payload: { version: 2 },
      createdAt: 1000,
    });
    await database.batch(createOutboxStatements(database, prepared));

    const claimed = await claimNextOutboxEvent(database, {
      now: 1100,
      leaseMs: 200,
    });
    expect(claimed).not.toBeNull();
    if (!claimed) throw new Error('expected_claim');

    await expect(claimNextOutboxEvent(database, {
      now: 1200,
      leaseMs: 200,
    })).resolves.toBeNull();

    await expect(markOutboxFailed(database, claimed, {
      error: 'temporary_failure',
      nextAttemptAt: 1400,
      now: 1250,
    })).resolves.toBe(true);

    await expect(claimNextOutboxEvent(database, {
      now: 1399,
      leaseMs: 200,
    })).resolves.toBeNull();

    const retried = await claimNextOutboxEvent(database, {
      now: 1400,
      leaseMs: 200,
    });
    expect(retried?.attempt_count).toBe(2);
    if (!retried) throw new Error('expected_retry');

    await expect(markOutboxSent(
      database,
      retried,
      1450,
    )).resolves.toBe(true);

    const row = await database.prepare(`
      SELECT status, attempt_count, sent_at
      FROM integration_outbox
      WHERE id='outbox-2'
    `).first<{
      status: string;
      attempt_count: number;
      sent_at: number;
    }>();

    expect(row).toEqual({
      status: 'SENT',
      attempt_count: 2,
      sent_at: 1450,
    });
  });
});
