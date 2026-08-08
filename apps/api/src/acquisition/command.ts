import type { SqlDatabase, SqlStatement } from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
  type IdempotencyClaim,
} from '../foundation/idempotency';

export interface AcquisitionCommandContext {
  actor: AssignmentStaffAuthorization;
  idempotencyKey: string;
  requestId: string;
  now?: number;
}

export async function acquireAcquisitionCommand<T>(
  database: SqlDatabase,
  command: AcquisitionCommandContext,
  action: string,
  targetType: string,
  targetId: string,
  payload: unknown,
) {
  const requestHash = await hashCanonicalJson({ action, payload });
  const acquired = await acquireIdempotency<T>(database, {
    actorType: 'STAFF', actorId: command.actor.staffId,
    action, targetType, targetId,
    idempotencyKey: command.idempotencyKey, requestHash,
  }, command.now === undefined ? {} : { now: command.now });
  return { acquired, requestHash, now: command.now ?? Date.now() };
}

export function finishAcquisitionCommand(
  database: SqlDatabase,
  claim: IdempotencyClaim,
  response: unknown,
  now: number,
  resultReferences?: unknown,
): SqlStatement[] {
  return [
    completeIdempotencyStatement(database, claim, response, {
      now, ...(resultReferences === undefined ? {} : { resultReferences }),
    }),
    assertIdempotencyCompletionStatement(database, claim),
  ];
}

export async function failAcquisitionCommand(
  database: SqlDatabase,
  claim: IdempotencyClaim,
  now: number,
): Promise<void> {
  await markIdempotencyFailed(database, claim, 'ACQUISITION_COMMAND_FAILED', now)
    .catch(() => false);
}
