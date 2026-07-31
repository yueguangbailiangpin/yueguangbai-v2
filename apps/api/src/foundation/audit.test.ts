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
import { createAuditEventStatement } from './audit';

let database: SqliteDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('immutable audit events', () => {
  it('writes a canonical audit fact and prevents updates or deletes', async () => {
    database = createMigratedTestDatabase();

    await createAuditEventStatement(database, {
      id: 'audit-1',
      aggregateType: 'TEST',
      aggregateId: 'aggregate-1',
      eventType: 'TEST_CREATED',
      actor: {
        type: 'STAFF',
        id: 'staff-1',
        roles: ['seller_ops', 'owner'],
      },
      previousState: null,
      nextState: { z: 2, a: 1 },
      metadata: { source: 'unit-test' },
      createdAt: 1000,
    }).run();

    const row = await database.prepare(`
      SELECT actor_roles_json, next_state_json
      FROM audit_events
      WHERE id='audit-1'
    `).first<{
      actor_roles_json: string;
      next_state_json: string;
    }>();

    expect(row).toEqual({
      actor_roles_json: '["owner","seller_ops"]',
      next_state_json: '{"a":1,"z":2}',
    });

    await expect(database.prepare(`
      UPDATE audit_events
      SET event_type='MUTATED'
      WHERE id='audit-1'
    `).run()).rejects.toThrow('audit_events_are_immutable');

    await expect(database.prepare(`
      DELETE FROM audit_events
      WHERE id='audit-1'
    `).run()).rejects.toThrow('audit_events_are_immutable');
  });
});
