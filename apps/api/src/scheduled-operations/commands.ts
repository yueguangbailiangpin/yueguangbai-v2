import type {
  ObjectStorageAdapter,
  ScheduledOperationCommandResultDto,
  ScheduledOperationJobName,
  ScheduledOperationManualRunCommandDto,
  SqlDatabase,
} from '@ygb/contracts';
import {
  isScheduledOperationJobName,
  parseScheduledOperationCommandResultDto,
  parseScheduledOperationManualRunCommand,
  statementChangedOnce,
} from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
  type IdempotencyClaim,
  type IdempotencyError,
} from '../foundation/idempotency';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { runScheduledOperations, type ArchiveScheduledRuntime } from './runner';


export class ScheduledOperationCommandError extends Error {
  constructor(
    public readonly code:
      | 'VALIDATION_ERROR'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'STATE_CONFLICT'
      | 'IDEMPOTENCY_CONFLICT'
      | 'REQUEST_IN_PROGRESS'
      | 'DEPENDENCY_UNAVAILABLE',
    public readonly status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
    this.name = 'ScheduledOperationCommandError';
  }
}

export interface ScheduledOperationCommandDependencies {
  enabled: boolean;
  disabledJobs?: readonly ScheduledOperationJobName[];
  storage?: ObjectStorageAdapter | null;
  archive?: ArchiveScheduledRuntime | null;
  afterReplayClaimed?: (() => Promise<void>) | undefined;
}

export interface ScheduledOperationCommandContext {
  actor: AssignmentStaffAuthorization;
  idempotencyKey: string;
  requestId?: string | null;
  now?: number;
}

export async function runScheduledOperationManually(
  database: SqlDatabase,
  dependencies: ScheduledOperationCommandDependencies,
  input: { jobName: ScheduledOperationJobName; command: ScheduledOperationManualRunCommandDto },
  context: ScheduledOperationCommandContext,
): Promise<ScheduledOperationCommandResultDto> {
  requireActor(context.actor);
  if (!isScheduledOperationJobName(input.jobName))
    throw new ScheduledOperationCommandError('VALIDATION_ERROR', 400);
  const command = parseManualCommand(input.command);
  const now = validNow(context.now ?? Date.now());
  const requestHash = await hashCanonicalJson({
    command_type: 'RUN_JOB',
    job_name: input.jobName,
    reason_code: command.reason_code,
  });
  const acquired = await acquire(database, {
    actor: context.actor,
    idempotencyKey: context.idempotencyKey,
    requestHash,
    action: 'SCHEDULED_OPERATION_MANUAL_RUN',
    targetType: 'SCHEDULED_JOB',
    targetId: input.jobName,
    now,
  });
  if (acquired.kind === 'REPLAY') return parseResult(acquired.response);
  const commandId = crypto.randomUUID();
  try {
    await ensureJobAndCommand(database, {
      commandId,
      commandType: 'RUN_JOB',
      jobName: input.jobName,
      targetId: input.jobName,
      reasonCode: command.reason_code,
      actor: context.actor,
      idempotencyKey: context.idempotencyKey,
      requestHash,
      requestId: context.requestId ?? null,
      now,
    });
    const runs = await runScheduledOperations(database, {
      only: input.jobName,
      trigger: 'MANUAL',
      enabled: dependencies.enabled,
      ...(dependencies.disabledJobs ? { disabledJobs: dependencies.disabledJobs } : {}),
      storage: dependencies.storage ?? null,
      archive: dependencies.archive ?? null,
      now,
    });
    const run = runs[0];
    if (!run) throw new ScheduledOperationCommandError('DEPENDENCY_UNAVAILABLE', 503);
    const result = parseResult({
      command_type: 'RUN_JOB',
      job_name: input.jobName,
      reason_code: command.reason_code,
      outcome: run.outcome,
      run,
    });
    await completeCommand(database, {
      commandId,
      claim: acquired.claim,
      result,
      actor: context.actor,
      requestId: context.requestId ?? null,
      idempotencyKey: context.idempotencyKey,
      reasonCode: command.reason_code,
      targetId: input.jobName,
      now,
    });
    return result;
  } catch (error) {
    await failCommand(database, {
      commandId,
      commandType: 'RUN_JOB',
      jobName: input.jobName,
      targetId: input.jobName,
      reasonCode: command.reason_code,
      actor: context.actor,
      requestId: context.requestId ?? null,
      idempotencyKey: context.idempotencyKey,
      now,
    }).catch(() => undefined);
    await markIdempotencyFailed(database, acquired.claim, safeErrorCode(error), now).catch(
      () => false,
    );
    throw normalize(error);
  }
}


async function acquire(
  database: SqlDatabase,
  input: {
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestHash: string;
    action: string;
    targetType: string;
    targetId: string;
    now: number;
  },
) {
  try {
    return await acquireIdempotency<ScheduledOperationCommandResultDto>(
      database,
      {
        actorType: 'STAFF',
        actorId: input.actor.staffId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      },
      { now: input.now },
    );
  } catch (error) {
    throw normalize(error);
  }
}
async function ensureJobAndCommand(
  database: SqlDatabase,
  input: {
    commandId: string;
    commandType: 'RUN_JOB' | 'REPLAY_DEAD_LETTER';
    jobName: ScheduledOperationJobName;
    targetId: string;
    reasonCode: string;
    actor: AssignmentStaffAuthorization;
    idempotencyKey: string;
    requestHash: string;
    requestId: string | null;
    now: number;
  },
) {
  await database.batch([
    database
      .prepare('INSERT OR IGNORE INTO scheduled_job_states(job_name,updated_at) VALUES(?,?)')
      .bind(input.jobName, input.now),
    database
      .prepare(
        'INSERT INTO scheduled_manual_commands(id,command_type,job_name,target_id,reason_code,staff_id,idempotency_key,request_hash,request_id,outcome,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,NULL,?,NULL)',
      )
      .bind(
        input.commandId,
        input.commandType,
        input.jobName,
        input.targetId,
        input.reasonCode,
        input.actor.staffId,
        input.idempotencyKey,
        input.requestHash,
        input.requestId,
        input.now,
      ),
  ]);
}
async function completeCommand(
  database: SqlDatabase,
  input: {
    commandId: string;
    claim: IdempotencyClaim;
    result: ScheduledOperationCommandResultDto;
    actor: AssignmentStaffAuthorization;
    requestId: string | null;
    idempotencyKey: string;
    reasonCode: string;
    targetId: string;
    now: number;
  },
) {
  await database.batch(completionStatements(database, input));
}
async function failCommand(
  database: SqlDatabase,
  input: {
    commandId: string;
    commandType: 'RUN_JOB' | 'REPLAY_DEAD_LETTER';
    jobName: ScheduledOperationJobName;
    targetId: string;
    reasonCode: string;
    actor: AssignmentStaffAuthorization;
    requestId: string | null;
    idempotencyKey: string;
    now: number;
  },
) {
  const updated = await database
    .prepare(
      "UPDATE scheduled_manual_commands SET outcome='FAILED',completed_at=? WHERE id=? AND outcome IS NULL",
    )
    .bind(input.now, input.commandId)
    .run();
  if (!statementChangedOnce(updated)) return;
  await database.batch([
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'SCHEDULED_OPERATION',
      aggregateId: input.targetId,
      eventType:
        input.commandType === 'RUN_JOB'
          ? 'SCHEDULED_OPERATION_MANUAL_RUN'
          : 'SCHEDULED_OPERATION_DEAD_LETTER_REPLAY',
      actor: { type: 'STAFF', id: input.actor.staffId, roles: [...input.actor.roles] },
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      nextState: {
        command_type: input.commandType,
        job_name: input.jobName,
        outcome: 'FAILED',
        reason_code: input.reasonCode,
      },
      reason: input.reasonCode,
      metadata: {},
      createdAt: input.now,
    }),
  ]);
}
function completionStatements(
  database: SqlDatabase,
  input: {
    commandId: string;
    claim: IdempotencyClaim;
    result: ScheduledOperationCommandResultDto;
    actor: AssignmentStaffAuthorization;
    requestId: string | null;
    idempotencyKey: string;
    reasonCode: string;
    targetId: string;
    now: number;
  },
) {
  return [
    database
      .prepare(
        'UPDATE scheduled_manual_commands SET outcome=?,completed_at=? WHERE id=? AND outcome IS NULL',
      )
      .bind(input.result.outcome, input.now, input.commandId),
    changedOnce(database),
    createAuditEventStatement(database, {
      id: crypto.randomUUID(),
      aggregateType: 'SCHEDULED_OPERATION',
      aggregateId: input.targetId,
      eventType:
        input.result.command_type === 'RUN_JOB'
          ? 'SCHEDULED_OPERATION_MANUAL_RUN'
          : 'SCHEDULED_OPERATION_DEAD_LETTER_REPLAY',
      actor: { type: 'STAFF', id: input.actor.staffId, roles: [...input.actor.roles] },
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      nextState: {
        command_type: input.result.command_type,
        job_name: input.result.job_name,
        outcome: input.result.outcome,
        reason_code: input.reasonCode,
      },
      reason: input.reasonCode,
      metadata: {},
      createdAt: input.now,
    }),
    completeIdempotencyStatement(database, input.claim, input.result, {
      resultReferences: { command_type: input.result.command_type, target_id: input.targetId },
      now: input.now,
    }),
    assertIdempotencyCompletionStatement(database, input.claim),
  ] as const;
}
function changedOnce(database: SqlDatabase) {
  return database.prepare(
    'INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END',
  );
}
function requireActor(actor: AssignmentStaffAuthorization) {
  if (actor.staffStatus !== 'ACTIVE' || !actor.permissions.has('SCHEDULED_OPERATIONS_RUN'))
    throw new ScheduledOperationCommandError('FORBIDDEN', 403);
}
function validNow(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new ScheduledOperationCommandError('VALIDATION_ERROR', 400);
  return value;
}
function parseManualCommand(value: unknown) {
  try {
    return parseScheduledOperationManualRunCommand(value);
  } catch {
    throw new ScheduledOperationCommandError('VALIDATION_ERROR', 400);
  }
}
function parseResult(value: unknown) {
  try {
    return parseScheduledOperationCommandResultDto(value);
  } catch {
    throw new ScheduledOperationCommandError('DEPENDENCY_UNAVAILABLE', 503);
  }
}
function safeErrorCode(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z_]{1,100}$/u.test(code)
    ? code
    : 'DEPENDENCY_UNAVAILABLE';
}
function normalize(error: unknown): ScheduledOperationCommandError {
  if (error instanceof ScheduledOperationCommandError) return error;
  const candidate = error as Partial<IdempotencyError>;
  if (candidate?.code === 'VALIDATION_ERROR')
    return new ScheduledOperationCommandError('VALIDATION_ERROR', 400);
  if (candidate?.code === 'IDEMPOTENCY_CONFLICT')
    return new ScheduledOperationCommandError('IDEMPOTENCY_CONFLICT', 409);
  if (candidate?.code === 'REQUEST_IN_PROGRESS')
    return new ScheduledOperationCommandError('REQUEST_IN_PROGRESS', 409);
  return new ScheduledOperationCommandError('DEPENDENCY_UNAVAILABLE', 503);
}
