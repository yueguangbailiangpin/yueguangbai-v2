import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import {
  createOutboxStatements,
  prepareOutboxEvent,
} from '../foundation/outbox';

export async function prepareStaffAssignmentOutboxStatements(
  database: SqlDatabase,
  input: {
    dedupKey: string;
    eventType: string;
    aggregateType:
      | 'STAFF_AVAILABILITY'
      | 'STAFF_ASSIGNMENT'
      | 'STAFF_ASSIGNMENT_FALLBACK'
      | 'STAFF_REASSIGNMENT_BATCH';
    aggregateId: string;
    payload: unknown;
    now: number;
  },
): Promise<readonly SqlStatement[]> {
  const event = await prepareOutboxEvent({
    id: crypto.randomUUID(),
    dedupKey: input.dedupKey,
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    payload: input.payload,
    createdAt: input.now,
  });
  return createOutboxStatements(database, event);
}
