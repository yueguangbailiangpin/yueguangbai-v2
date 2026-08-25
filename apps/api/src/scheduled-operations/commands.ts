import type {
  ObjectStorageAdapter,
  ScheduledOperationCommandResultDto,
  ScheduledOperationDeadLetterReplayCommandDto,
  ScheduledOperationJobName,
  ScheduledOperationManualRunCommandDto,
  SqlDatabase,
} from '@ygb/contracts';
import {
  isScheduledOperationJobName,
  parseScheduledOperationCommandResultDto,
  parseScheduledOperationDeadLetterReplayCommand,
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
import { runScheduledOperations, type ArchiveScheduledRuntime, type OutboxDeliveryAdapter } from './runner';

const REPLAY_LEASE_MS = 5 * 60 * 1000;

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
  outboxDeliveryEnabled?: boolean;
  outboxAdapter?: OutboxDeliveryAdapter | null;
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
      outboxDeliveryEnabled: dependencies.outboxDeliveryEnabled !== false,
      outboxAdapter: dependencies.outboxAdapter ?? null,
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

export async function replayScheduledDeadLetter(
  database: SqlDatabase,
  dependencies: ScheduledOperationCommandDependencies,
  input: { deadLetterId: string; command: ScheduledOperationDeadLetterReplayCommandDto },
  context: ScheduledOperationCommandContext,
): Promise<ScheduledOperationCommandResultDto> {
  requireActor(context.actor);
  const deadLetterId = safeId(input.deadLetterId);
  const command = parseReplayCommand(input.command);
  const now = validNow(context.now ?? Date.now());
  const requestHash = await hashCanonicalJson({
    command_type: 'REPLAY_DEAD_LETTER',
    dead_letter_id: deadLetterId,
    event_id: command.event_id,
    reason_code: command.reason_code,
  });
  const acquired = await acquire(database, {
    actor: context.actor,
    idempotencyKey: context.idempotencyKey,
    requestHash,
    action: 'SCHEDULED_OPERATION_DEAD_LETTER_REPLAY',
    targetType: 'SCHEDULED_DEAD_LETTER',
    targetId: deadLetterId,
    now,
  });
  if (acquired.kind === 'REPLAY') return parseResult(acquired.response);
  const commandId = crypto.randomUUID();
  const jobName = 'outbox_delivery' as const;
  try {
    const target = await database
      .prepare(
        "SELECT job_name FROM scheduled_dead_letters WHERE id=? AND source_kind='OUTBOX' AND source_id=? AND job_name='outbox_delivery'",
      )
      .bind(deadLetterId, command.event_id)
      .first<{ job_name: 'outbox_delivery' }>();
    if (!target) throw new ScheduledOperationCommandError('NOT_FOUND', 404);
    await ensureJobAndCommand(database, {
      commandId,
      commandType: 'REPLAY_DEAD_LETTER',
      jobName,
      targetId: deadLetterId,
      reasonCode: command.reason_code,
      actor: context.actor,
      idempotencyKey: context.idempotencyKey,
      requestHash,
      requestId: context.requestId ?? null,
      now,
    });
    if (!(await jobEnabled(database, jobName, dependencies))) {
      const disabled = parseResult({
        command_type: 'REPLAY_DEAD_LETTER',
        job_name: jobName,
        reason_code: command.reason_code,
        outcome: 'DISABLED',
        dead_letter_id: deadLetterId,
        event_id: command.event_id,
      });
      await completeCommand(database, {
        commandId,
        claim: acquired.claim,
        result: disabled,
        actor: context.actor,
        requestId: context.requestId ?? null,
        idempotencyKey: context.idempotencyKey,
        reasonCode: command.reason_code,
        targetId: deadLetterId,
        now,
      });
      return disabled;
    }
    const replayToken = `dead-letter-replay:${crypto.randomUUID()}`;
    const claimed = await database
      .prepare(
        `UPDATE scheduled_dead_letters SET replay_status='PROCESSING',replay_lease_token=?,replay_lease_expires_at=?,replay_version=replay_version+1 WHERE id=? AND job_name=? AND source_kind='OUTBOX' AND source_id=? AND (replay_status='QUARANTINED' OR (replay_status='PROCESSING' AND replay_lease_expires_at<=?)) AND EXISTS(SELECT 1 FROM integration_outbox event WHERE event.id=scheduled_dead_letters.source_id AND event.status IN ('PENDING','FAILED') AND event.sent_at IS NULL AND event.aggregate_type<>'STAFF_WORK_ITEM') RETURNING source_id`,
      )
      .bind(replayToken, now + REPLAY_LEASE_MS, deadLetterId, jobName, command.event_id, now)
      .first<{ source_id: string }>();
    if (!claimed) {
      const processing = await database
        .prepare(
          "SELECT replay_lease_expires_at FROM scheduled_dead_letters WHERE id=? AND source_kind='OUTBOX' AND source_id=? AND replay_status='PROCESSING'",
        )
        .bind(deadLetterId, command.event_id)
        .first<{ replay_lease_expires_at: number }>();
      throw processing && processing.replay_lease_expires_at > now
        ? new ScheduledOperationCommandError('REQUEST_IN_PROGRESS', 409)
        : new ScheduledOperationCommandError('NOT_FOUND', 404);
    }
    await dependencies.afterReplayClaimed?.();
    const result = parseResult({
      command_type: 'REPLAY_DEAD_LETTER',
      job_name: jobName,
      reason_code: command.reason_code,
      outcome: 'SUCCEEDED',
      dead_letter_id: deadLetterId,
      event_id: claimed.source_id,
    });
    await database.batch([
      database
        .prepare(
          "UPDATE scheduled_dead_letters SET replay_status='REPLAYED',replay_lease_token=NULL,replay_lease_expires_at=NULL,replayed_at=?,replayed_by_staff_id=?,replay_request_id=?,replay_idempotency_key=?,replay_version=replay_version+1 WHERE id=? AND source_id=? AND replay_status='PROCESSING' AND replay_lease_token=?",
        )
        .bind(
          now,
          context.actor.staffId,
          context.requestId ?? null,
          context.idempotencyKey,
          deadLetterId,
          claimed.source_id,
          replayToken,
        ),
      changedOnce(database),
      database
        .prepare(
          "UPDATE integration_outbox SET status='PENDING',available_at=?,lease_token=NULL,lease_expires_at=NULL,attempt_count=0,last_error=NULL,sent_at=NULL,updated_at=? WHERE id=? AND status IN ('PENDING','FAILED') AND sent_at IS NULL",
        )
        .bind(now, now, claimed.source_id),
      changedOnce(database),
      ...completionStatements(database, {
        commandId,
        claim: acquired.claim,
        result,
        actor: context.actor,
        requestId: context.requestId ?? null,
        idempotencyKey: context.idempotencyKey,
        reasonCode: command.reason_code,
        targetId: deadLetterId,
        now,
      }),
    ]);
    return result;
  } catch (error) {
    await failCommand(database, {
      commandId,
      commandType: 'REPLAY_DEAD_LETTER',
      jobName,
      targetId: deadLetterId,
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
async function jobEnabled(
  database: SqlDatabase,
  jobName: ScheduledOperationJobName,
  dependencies: ScheduledOperationCommandDependencies,
) {
  if (
    !dependencies.enabled ||
    dependencies.disabledJobs?.includes(jobName) ||
    (jobName === 'outbox_delivery' && dependencies.outboxDeliveryEnabled === false)
  )
    return false;
  const row = await database
    .prepare('SELECT enabled FROM scheduled_job_states WHERE job_name=?')
    .bind(jobName)
    .first<{ enabled: number }>();
  return row?.enabled !== 0;
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
function safeId(value: string) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
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
function parseReplayCommand(value: unknown) {
  try {
    return parseScheduledOperationDeadLetterReplayCommand(value);
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
