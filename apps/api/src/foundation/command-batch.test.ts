import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  hashCanonicalJson,
} from '@ygb/domain';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import {
  createAuditEventStatement,
} from './audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
} from './idempotency';

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('foundation command batch', () => {
  it('commits response and audit as one atomic batch', async () => {
    database = createMigratedTestDatabase();
    const requestHash = await hashCanonicalJson({
      action: 'TEST_COMMAND',
      aggregate_id: 'aggregate-1',
    });
    const acquired = await acquireIdempotency(database, {
      actorType: 'STAFF',
      actorId: 'staff-1',
      action: 'TEST_COMMAND',
      targetType: 'TEST',
      targetId: 'aggregate-1',
      idempotencyKey: 'test:command:0001',
      requestHash,
    }, { now: 1000 });
    if (acquired.kind !== 'ACQUIRED') throw new Error('expected_claim');


    await database.batch([
      createAuditEventStatement(database, {
        id: 'audit-command-1',
        aggregateType: 'TEST',
        aggregateId: 'aggregate-1',
        eventType: 'TEST_CHANGED',
        actor: {
          type: 'STAFF',
          id: 'staff-1',
          roles: ['owner'],
        },
        nextState: { version: 1 },
        idempotencyKey: acquired.claim.idempotencyKey,
        createdAt: 1100,
      }),
      completeIdempotencyStatement(
        database,
        acquired.claim,
        { aggregate_id: 'aggregate-1', version: 1 },
        { now: 1100 },
      ),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);

    const counts = await database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM audit_events) AS audits,
        (SELECT COUNT(*) FROM command_idempotency_records
          WHERE status='COMMITTED') AS committed
    `).first<{
      audits: number;
      committed: number;
    }>();

    expect(counts).toEqual({
      audits: 1,
      committed: 1,
    });
  });
});
