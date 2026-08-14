import {
  apiFailure,
  apiSuccess,
  isApiErrorCode,
  isScheduledOperationJobName,
  parseScheduledOperationCommandResultDto,
  parseScheduledOperationDeadLetterReplayCommand,
  parseScheduledOperationHealthDto,
  parseScheduledOperationManualRunCommand,
  parseScheduledOperationalAlertAckCommandDto,
  parseScheduledOperationalAlertAckResultDto,
  type ScheduledOperationJobName,
} from '@ygb/contracts';
import { readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../app';
import { requirePermission } from '../staff-assignment/permission-policy';
import {
  replayScheduledDeadLetter,
  runScheduledOperationManually,
  ScheduledOperationCommandError,
} from './commands';
import { SCHEDULED_JOB_NAMES } from './runner';
import {
  acknowledgeScheduledOperationalAlert,
  readScheduledOperationalAlerts,
} from './alerts';
import { driveArchiveRuntime } from '../cold-image-archive/runtime';

const BODY_LIMIT=4096;

export function registerScheduledOperationRoutes(app: Hono<AppEnv>): void {
  app.get('/api/staff/operations/health',withErrors(health));
  app.post('/api/staff/operations/alerts/ack',withErrors(acknowledgeAlert));
  app.post('/api/staff/operations/jobs/:job/retry',withErrors(runManually));
  app.post('/api/staff/operations/dead-letters/:id/replay',withErrors(replayDeadLetter));
}

async function health(context: Context<AppEnv>): Promise<Response> {
  const actor=context.get('staffAuthorization');
  if (!actor || actor.staffStatus!=='ACTIVE') throw new ScheduledOperationCommandError('FORBIDDEN',403);
  requirePermission(actor,'AUDIT_VIEW');
  const rows=await context.env.DB.prepare('SELECT job_name,enabled,last_started_at,last_succeeded_at,last_failed_at,last_failure_category,last_backlog_count AS backlog_count,lease_expires_at FROM scheduled_job_states ORDER BY job_name').all<{job_name:string;enabled:number;last_started_at:number|null;last_succeeded_at:number|null;last_failed_at:number|null;last_failure_category:string|null;backlog_count:number;lease_expires_at:number|null}>();
  const states=new Map(rows.results.map((row)=>[row.job_name,row]));
  const drive=driveArchiveRuntime(context.env);
  const driveEnabled=drive.enabled&&drive.copyEnabled&&Boolean(drive.adapter)&&Boolean(context.env.FILE_OBJECT_STORAGE);
  const jobs=SCHEDULED_JOB_NAMES.map((jobName)=>{ const row=states.get(jobName); const hardDisabled=jobName==='drive_archive'&&!driveEnabled; return parseScheduledOperationHealthDto({job_name:jobName,enabled:hardDisabled?false:row?.enabled!==0,last_started_at:row?.last_started_at??null,last_succeeded_at:row?.last_succeeded_at??null,last_failed_at:row?.last_failed_at??null,last_failure_category:row?.last_failure_category??null,backlog_count:Number(row?.backlog_count??0),lease_expires_at:row?.lease_expires_at??null,capability_scope:jobName==='instruction_expiry'?'LEGACY_JP_ONLY':hardDisabled?'HARD_DISABLED':'ALL_ENABLED_MARKETPLACES'}); });
  const alerts=await readScheduledOperationalAlerts(context.env.DB);
  return context.json(apiSuccess({jobs,alerts,time_basis:'UTC_MS' as const,display_timezone:'Asia/Shanghai' as const},context.get('requestId')));
}

async function acknowledgeAlert(context:Context<AppEnv>):Promise<Response> {
  const actor=requireRunActor(context);
  const command=parseAlertAckBody(await readBoundedJson(context.req.raw,BODY_LIMIT));
  const result=await acknowledgeScheduledOperationalAlert(context.env.DB,command,{actor,idempotencyKey:requireIdempotencyKey(context),requestId:context.get('requestId')});
  return context.json(apiSuccess({acknowledgement:parseScheduledOperationalAlertAckResultDto(result)},context.get('requestId')));
}

async function runManually(context: Context<AppEnv>): Promise<Response> {
  const actor=requireRunActor(context);
  const job=context.req.param('job');
  if (!isScheduledOperationJobName(job)) throw new ScheduledOperationCommandError('VALIDATION_ERROR',400);
  const command=parseManualBody(await readBoundedJson(context.req.raw,BODY_LIMIT));
  const result=await runScheduledOperationManually(context.env.DB,runtime(context),{jobName:job,command},{actor,idempotencyKey:requireIdempotencyKey(context),requestId:context.get('requestId')});
  return context.json(apiSuccess({command:parseScheduledOperationCommandResultDto(result)},context.get('requestId')));
}

async function replayDeadLetter(context: Context<AppEnv>): Promise<Response> {
  const actor=requireRunActor(context);
  const command=parseReplayBody(await readBoundedJson(context.req.raw,BODY_LIMIT));
  const result=await replayScheduledDeadLetter(context.env.DB,runtime(context),{deadLetterId:context.req.param('id')??'',command},{actor,idempotencyKey:requireIdempotencyKey(context),requestId:context.get('requestId')});
  return context.json(apiSuccess({command:parseScheduledOperationCommandResultDto(result)},context.get('requestId')));
}

function requireRunActor(context:Context<AppEnv>) { const actor=context.get('staffAuthorization'); if (!actor || actor.staffStatus!=='ACTIVE') throw new ScheduledOperationCommandError('FORBIDDEN',403); requirePermission(actor,'SCHEDULED_OPERATIONS_RUN'); return actor; }
function requireIdempotencyKey(context:Context<AppEnv>) { const value=context.req.header('Idempotency-Key')?.trim()??''; if (value.length<8 || value.length>128 || /[\u0000-\u001f\u007f]/u.test(value)) throw new ScheduledOperationCommandError('VALIDATION_ERROR',400); return value; }
function parseManualBody(value:unknown) { try { return parseScheduledOperationManualRunCommand(value); } catch { throw new ScheduledOperationCommandError('VALIDATION_ERROR',400); } }
function parseReplayBody(value:unknown) { try { return parseScheduledOperationDeadLetterReplayCommand(value); } catch { throw new ScheduledOperationCommandError('VALIDATION_ERROR',400); } }
function parseAlertAckBody(value:unknown) { try { return parseScheduledOperationalAlertAckCommandDto(value); } catch { throw new ScheduledOperationCommandError('VALIDATION_ERROR',400); } }
function runtime(context:Context<AppEnv>) { const drive=driveArchiveRuntime(context.env); return {enabled:context.env.SCHEDULED_OPERATIONS_ENABLED==='true',disabledJobs:disabledJobs(context.env.SCHEDULED_OPERATIONS_DISABLED_JOBS),storage:context.env.FILE_OBJECT_STORAGE??null,outboxDeliveryEnabled:context.env.OUTBOX_DELIVERY_ENABLED==='true',outboxAdapter:context.env.OUTBOX_DELIVERY_ADAPTER??null,driveAdapter:drive.adapter,driveArchiveEnabled:drive.enabled,driveArchiveCopyEnabled:drive.copyEnabled,driveArchiveProxyReadEnabled:drive.proxyReadEnabled,driveArchiveR2DeleteEnabled:drive.r2DeleteEnabled}; }
function disabledJobs(value:string|undefined):ScheduledOperationJobName[] { return (value??'').split(',').map((job)=>job.trim()).filter(isScheduledOperationJobName); }
function withErrors(handler:(context:Context<AppEnv>)=>Promise<Response>) { return async(context:Context<AppEnv>)=>{ try { return await handler(context); } catch(error) { const codeValue=error!==null && (typeof error==='object' || typeof error==='function')?Reflect.get(error,'code'):undefined; const statusValue=error!==null && (typeof error==='object' || typeof error==='function')?Reflect.get(error,'status'):undefined; const code=isApiErrorCode(codeValue)?codeValue:'DEPENDENCY_UNAVAILABLE'; return context.json(apiFailure(code,message(code),context.get('requestId')),safeStatus(statusValue)); } }; }
function safeStatus(value:unknown):400|403|404|409|503 { switch(value) { case 400:return 400; case 403:return 403; case 404:return 404; case 409:return 409; default:return 503; } }
function message(code:string) { switch(code) { case 'FORBIDDEN': return '无权执行此操作'; case 'NOT_FOUND': return '任务或隔离记录不存在'; case 'IDEMPOTENCY_CONFLICT': return '幂等键已用于不同请求'; case 'REQUEST_IN_PROGRESS': return '请求正在处理中'; case 'STATE_CONFLICT': return '当前状态不允许执行'; case 'VALIDATION_ERROR': return '请求参数不正确'; default:return '服务暂时不可用，请稍后重试'; } }
