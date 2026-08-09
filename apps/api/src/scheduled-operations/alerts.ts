import type {
  ScheduledOperationalAlertAckResultDto,
  ScheduledOperationalAlertDto,
  SqlDatabase,
} from '@ygb/contracts';
import {
  parseScheduledOperationalAlertAckCommandDto,
  parseScheduledOperationalAlertAckResultDto,
  parseScheduledOperationalAlertDto,
} from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
  type IdempotencyError,
} from '../foundation/idempotency';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { ScheduledOperationCommandError } from './commands';

interface AlertAckContext {
  actor:AssignmentStaffAuthorization;
  idempotencyKey:string;
  requestId?:string|null;
  now?:number;
}

interface AlertStateVersionRow {
  status:'OPEN'|'ACKNOWLEDGED'|'RESOLVED';
  incident_version:number;
  version:number;
}

export async function readScheduledOperationalAlerts(database:SqlDatabase):Promise<ScheduledOperationalAlertDto[]> {
  const rows=await database.prepare('SELECT signal_type,category,severity,summary_code,job_name,status,first_seen_at,last_seen_at,consecutive_breach_count,consecutive_healthy_count,window_count_value,threshold_count,threshold_window_ms,recovery_count,opened_at,acknowledged_at,resolved_at,cooldown_until,suppressed_until,last_notification_at,incident_version,updated_at FROM scheduled_alert_states ORDER BY CASE status WHEN \'OPEN\' THEN 1 WHEN \'ACKNOWLEDGED\' THEN 2 ELSE 3 END,severity DESC,signal_type,job_name').all<Record<string,unknown>>();
  return rows.results.map((row)=>parseScheduledOperationalAlertDto({...row,job_name:row['job_name']===''?null:row['job_name'],time_basis:'UTC_MS',display_timezone:'Asia/Shanghai'}));
}

export async function acknowledgeScheduledOperationalAlert(
  database:SqlDatabase,
  rawCommand:unknown,
  context:AlertAckContext,
):Promise<ScheduledOperationalAlertAckResultDto> {
  requireActor(context.actor);
  const command=parseCommand(rawCommand);
  const now=validNow(context.now??Date.now());
  const jobKey=command.job_name??'';
  const targetId=`${command.signal_type}:${command.summary_code}:${jobKey||'GLOBAL'}:${command.incident_version}`;
  const requestHash=await hashCanonicalJson({command_type:'ACK_ALERT',signal_type:command.signal_type,summary_code:command.summary_code,job_name:command.job_name,incident_version:command.incident_version});
  const acquired=await acquire(database,{actor:context.actor,idempotencyKey:context.idempotencyKey,requestHash,targetId,now});
  if (acquired.kind==='REPLAY') return parseResult(acquired.response);
  try {
    const state=await database.prepare('SELECT status,incident_version,version FROM scheduled_alert_states WHERE signal_type=? AND job_name=? AND summary_code=?').bind(command.signal_type,jobKey,command.summary_code).first<AlertStateVersionRow>();
    if (!state) throw new ScheduledOperationCommandError('NOT_FOUND',404);
    if (state.status!=='OPEN' || state.incident_version!==command.incident_version) throw new ScheduledOperationCommandError('STATE_CONFLICT',409);
    const result=parseResult({signal_type:command.signal_type,summary_code:command.summary_code,job_name:command.job_name,incident_version:command.incident_version,status:'ACKNOWLEDGED',acknowledged_at:now});
    await database.batch([
      database.prepare("UPDATE scheduled_alert_states SET status='ACKNOWLEDGED',acknowledged_at=?,version=version+1,updated_at=MAX(updated_at,?) WHERE signal_type=? AND job_name=? AND summary_code=? AND status='OPEN' AND incident_version=? AND version=?").bind(now,now,command.signal_type,jobKey,command.summary_code,command.incident_version,state.version),
      changedOnce(database),
      createAuditEventStatement(database,{id:crypto.randomUUID(),aggregateType:'SCHEDULED_OPERATION_ALERT',aggregateId:targetId,eventType:'SCHEDULED_OPERATION_ALERT_ACKNOWLEDGED',actor:{type:'STAFF',id:context.actor.staffId,roles:[...context.actor.roles]},requestId:context.requestId??null,idempotencyKey:context.idempotencyKey,previousState:{signal_type:command.signal_type,summary_code:command.summary_code,job_name:command.job_name,incident_version:command.incident_version,status:'OPEN'},nextState:{signal_type:command.signal_type,summary_code:command.summary_code,job_name:command.job_name,incident_version:command.incident_version,status:'ACKNOWLEDGED'},reason:'OPERATOR_ACKNOWLEDGED',metadata:{},createdAt:now}),
      completeIdempotencyStatement(database,acquired.claim,result,{resultReferences:{signal_type:command.signal_type,summary_code:command.summary_code,job_name:command.job_name,incident_version:command.incident_version},now}),
      assertIdempotencyCompletionStatement(database,acquired.claim),
    ]);
    return result;
  } catch(error) {
    await markIdempotencyFailed(database,acquired.claim,safeErrorCode(error),now).catch(()=>false);
    throw normalize(error);
  }
}

async function acquire(database:SqlDatabase,input:{actor:AssignmentStaffAuthorization;idempotencyKey:string;requestHash:string;targetId:string;now:number}) {
  try {
    return await acquireIdempotency<ScheduledOperationalAlertAckResultDto>(database,{actorType:'STAFF',actorId:input.actor.staffId,action:'SCHEDULED_OPERATION_ALERT_ACK',targetType:'SCHEDULED_OPERATION_ALERT',targetId:input.targetId,idempotencyKey:input.idempotencyKey,requestHash:input.requestHash},{now:input.now});
  } catch(error) { throw normalize(error); }
}

function requireActor(actor:AssignmentStaffAuthorization) {
  if (actor.staffStatus!=='ACTIVE' || !actor.permissions.has('SCHEDULED_OPERATIONS_RUN')) throw new ScheduledOperationCommandError('FORBIDDEN',403);
}
function parseCommand(value:unknown) { try { return parseScheduledOperationalAlertAckCommandDto(value); } catch { throw new ScheduledOperationCommandError('VALIDATION_ERROR',400); } }
function parseResult(value:unknown) { try { return parseScheduledOperationalAlertAckResultDto(value); } catch { throw new ScheduledOperationCommandError('DEPENDENCY_UNAVAILABLE',503); } }
function validNow(value:number) { if (!Number.isSafeInteger(value) || value<0) throw new ScheduledOperationCommandError('VALIDATION_ERROR',400); return value; }
function changedOnce(database:SqlDatabase) { return database.prepare('INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END'); }
function safeErrorCode(error:unknown) { const code=(error as {code?:unknown}|null)?.code; return typeof code==='string' && /^[A-Z_]{1,100}$/u.test(code)?code:'STATE_CONFLICT'; }
function normalize(error:unknown):ScheduledOperationCommandError {
  if (error instanceof ScheduledOperationCommandError) return error;
  const candidate=error as Partial<IdempotencyError>;
  if (candidate?.code==='VALIDATION_ERROR') return new ScheduledOperationCommandError('VALIDATION_ERROR',400);
  if (candidate?.code==='IDEMPOTENCY_CONFLICT') return new ScheduledOperationCommandError('IDEMPOTENCY_CONFLICT',409);
  if (candidate?.code==='REQUEST_IN_PROGRESS') return new ScheduledOperationCommandError('REQUEST_IN_PROGRESS',409);
  return new ScheduledOperationCommandError('STATE_CONFLICT',409);
}
