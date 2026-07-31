import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import { hashCanonicalJson } from '@ygb/domain';
import {
  createMigratedTestDatabase,
  type SqliteDatabase,
} from '@ygb/testkit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  IdempotencyError,
  markIdempotencyFailed,
} from './idempotency';

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('command idempotency', () => {
  it('acquires, atomically completes, and replays the same response', async () => {
    database = createMigratedTestDatabase();
    const identity = {
      actorType: 'STAFF',
      actorId: 'staff-1',
      action: 'TEST_CREATE',
      targetType: 'TEST',
      targetId: 'target-1',
      idempotencyKey: 'test:create:0001',
      requestHash: await hashCanonicalJson({ value: 1 }),
    };

    const acquired = await acquireIdempotency<{ id: string }>(
      database,
      identity,
      { now: 1000 },
    );
    expect(acquired.kind).toBe('ACQUIRED');
    if (acquired.kind !== 'ACQUIRED') throw new Error('expected_claim');

    const response = { id: 'result-1' };
    await database.batch([
      completeIdempotencyStatement(
        database,
        acquired.claim,
        response,
        { now: 1100 },
      ),
      assertIdempotencyCompletionStatement(database, acquired.claim),
    ]);

    const replay = await acquireIdempotency<{ id: string }>(
      database,
      identity,
      { now: 1200 },
    );
    expect(replay).toEqual({
      kind: 'REPLAY',
      response,
    });
  });

  it('rejects a different request under the same key', async () => {
    database = createMigratedTestDatabase();
    const base = {
      actorType: 'STAFF',
      actorId: 'staff-1',
      action: 'TEST_CREATE',
      targetType: 'TEST',
      targetId: 'target-1',
      idempotencyKey: 'test:create:0002',
      requestHash: await hashCanonicalJson({ value: 1 }),
    };

    await acquireIdempotency(database, base, { now: 1000 });

    await expect(acquireIdempotency(database, {
      ...base,
      requestHash: await hashCanonicalJson({ value: 2 }),
    }, { now: 1001 })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      status: 409,
    });
  });

  it('blocks a live lease and permits takeover after failure', async () => {
    database = createMigratedTestDatabase();
    const identity = {
      actorType: 'STAFF',
      actorId: 'staff-1',
      action: 'TEST_CREATE',
      targetType: 'TEST',
      targetId: 'target-1',
      idempotencyKey: 'test:create:0003',
      requestHash: await hashCanonicalJson({ value: 1 }),
    };

    const first = await acquireIdempotency(database, identity, {
      now: 1000,
      leaseMs: 500,
    });
    if (first.kind !== 'ACQUIRED') throw new Error('expected_claim');

    await expect(acquireIdempotency(database, identity, {
      now: 1200,
      leaseMs: 500,
    })).rejects.toBeInstanceOf(IdempotencyError);

    await expect(markIdempotencyFailed(
      database,
      first.claim,
      'TEST_FAILURE',
      1250,
    )).resolves.toBe(true);

    const takeover = await acquireIdempotency(database, identity, {
      now: 1300,
      leaseMs: 500,
    });
    expect(takeover.kind).toBe('ACQUIRED');
    if (takeover.kind !== 'ACQUIRED') throw new Error('expected_claim');
    expect(takeover.claim.leaseToken).not.toBe(first.claim.leaseToken);
  });
});
