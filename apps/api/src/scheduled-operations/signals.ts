import type {
  ScheduledOperationJobName,
  ScheduledOperationalAlertNotificationDto,
  ScheduledOperationalAlertStatus,
  ScheduledOperationalSignalCategory,
  ScheduledOperationalSignalObservationDto,
  ScheduledOperationalSignalSeverity,
  ScheduledOperationalSignalSummaryCode,
  ScheduledOperationalSignalType,
  SqlDatabase,
} from '@ygb/contracts';
import {
  parseScheduledOperationalAlertNotificationDto,
  parseScheduledOperationalSignalObservationDto,
  statementChangedOnce,
} from '@ygb/contracts';
import { hashCanonicalJson } from '@ygb/domain';

const MINUTE_MS=60_000;
const JOB_SUCCESS_STALE_AFTER_MS=6*60*MINUTE_MS;
const LEASE_STUCK_GRACE_MS=5*MINUTE_MS;

interface SignalPolicy {
  category: ScheduledOperationalSignalCategory;
  severity: ScheduledOperationalSignalSeverity;
  summaryCode: ScheduledOperationalSignalSummaryCode;
  thresholdCount: number;
  thresholdWindowMs: number;
  recoveryCount: number;
  cooldownMs: number;
  accumulation: 'COUNT'|'OBSERVATION';
}

interface AlertStateRow {
  signal_type: ScheduledOperationalSignalType;
  job_name: string;
  category: ScheduledOperationalSignalCategory;
  severity: ScheduledOperationalSignalSeverity;
  summary_code: ScheduledOperationalSignalSummaryCode;
  status: ScheduledOperationalAlertStatus;
  first_seen_at: number|null;
  last_seen_at: number|null;
  consecutive_breach_count: number;
  consecutive_healthy_count: number;
  window_started_at: number;
  window_count_value: number;
  threshold_count: number;
  threshold_window_ms: number;
  recovery_count: number;
  opened_at: number|null;
  acknowledged_at: number|null;
  resolved_at: number|null;
  cooldown_until: number|null;
  suppressed_until: number|null;
  last_notification_at: number|null;
  last_evaluated_at: number;
  incident_version: number;
  version: number;
  updated_at: number;
}

interface PersistedObservationRow {
  signal_type: ScheduledOperationalSignalType;
  category: ScheduledOperationalSignalCategory;
  severity: ScheduledOperationalSignalSeverity;
  summary_code: ScheduledOperationalSignalSummaryCode;
  job_name: ScheduledOperationJobName|null;
  observation_state: 'BREACH'|'HEALTHY';
  observed_at: number;
  count_value: number;
  evaluated_at: number|null;
}

interface ComputedAlertState extends AlertStateRow {
  notification: ScheduledOperationalAlertNotificationDto|null;
}

export interface OperationalAlertSink {
  notify(notification: ScheduledOperationalAlertNotificationDto): Promise<void>;
}

export class MemoryOperationalAlertSink implements OperationalAlertSink {
  readonly notifications: ScheduledOperationalAlertNotificationDto[]=[];
  constructor(private readonly failWhen: (notification: ScheduledOperationalAlertNotificationDto)=>boolean=()=>false) {}
  async notify(value: ScheduledOperationalAlertNotificationDto): Promise<void> {
    const notification=parseScheduledOperationalAlertNotificationDto(value);
    if (this.failWhen(notification)) throw new Error('operational_alert_sink_unavailable');
    this.notifications.push(notification);
  }
}

export class LocalOperationalAlertSink implements OperationalAlertSink {
  constructor(private readonly write: (notification:ScheduledOperationalAlertNotificationDto)=>void|Promise<void>=(notification)=>{ console.warn(JSON.stringify({event:'scheduled_operational_alert',notification})); }) {}
  async notify(value:ScheduledOperationalAlertNotificationDto):Promise<void> {
    await this.write(parseScheduledOperationalAlertNotificationDto(value));
  }
}

export function resolveOperationalAlertSink(input:{mode?:string;localSink?:OperationalAlertSink}):OperationalAlertSink|null {
  const mode=input.mode??'disabled';
  if (mode==='disabled') {
    if (input.localSink!==undefined) throw new Error('operational_alert_sink_disabled_with_adapter');
    return null;
  }
  if (mode==='local') return input.localSink??new LocalOperationalAlertSink();
  throw new Error('invalid_operational_alert_mode');
}

export function safeResolveOperationalAlertSink(input:{mode?:string;localSink?:OperationalAlertSink}):OperationalAlertSink|null {
  try { return resolveOperationalAlertSink(input); } catch { return null; }
}

export interface OperationalSignalEvaluationResult {
  disposition: 'EVALUATED'|'DUPLICATE'|'STALE';
  notification: 'SENT'|'SUPPRESSED'|'FAILED'|'NONE';
  status: ScheduledOperationalAlertStatus;
  incident_version: number;
}

export async function ingestScheduledOperationalSignal(
  database: SqlDatabase,
  rawInput: unknown,
  options: {sink?: OperationalAlertSink|null}={},
): Promise<OperationalSignalEvaluationResult> {
  const input=parseScheduledOperationalSignalObservationDto(rawInput);
  const policy=policyFor(input);
  const jobKey=input.job_name??'';
  await database.prepare(`INSERT OR IGNORE INTO scheduled_operational_signals(id,signal_type,category,severity,summary_code,job_name,observation_state,observed_at,count_value,evaluated_at) VALUES(?,?,?,?,?,?,?,?,?,NULL)`).bind(input.observation_id,input.signal_type,policy.category,policy.severity,policy.summaryCode,input.job_name,input.observation_state,input.observed_at,input.count_value).run();

  for (let attempt=0;attempt<5;attempt+=1) {
    const observation=await database.prepare('SELECT signal_type,category,severity,summary_code,job_name,observation_state,observed_at,count_value,evaluated_at FROM scheduled_operational_signals WHERE id=?').bind(input.observation_id).first<PersistedObservationRow>();
    if (!observation || !sameObservation(input,policy,observation)) throw new Error('scheduled_operational_signal_id_conflict');
    const current=await readAlertState(database,input.signal_type,jobKey,policy.summaryCode);
    if (observation.evaluated_at!==null) return resultFromCurrent('DUPLICATE',current);
    if (current && input.observed_at<current.last_evaluated_at) {
      const stale=await database.prepare('UPDATE scheduled_operational_signals SET evaluated_at=? WHERE id=? AND evaluated_at IS NULL').bind(input.observed_at,input.observation_id).run();
      if (statementChangedOnce(stale)) return {disposition:'STALE',notification:'NONE',status:current.status,incident_version:current.incident_version};
      continue;
    }

    const computed=computeAlertState(current,input,policy,options.sink!=null);
    try {
      await database.batch([
        upsertAlertStateStatement(database,computed,current?.version??0),
        changedOnceStatement(database),
        database.prepare('UPDATE scheduled_operational_signals SET evaluated_at=? WHERE id=? AND evaluated_at IS NULL').bind(input.observed_at,input.observation_id),
        changedOnceStatement(database),
      ]);
    } catch {
      continue;
    }

    if (!computed.notification) {
      return {disposition:'EVALUATED',notification:computed.suppressed_until!==null && computed.suppressed_until>input.observed_at?'SUPPRESSED':'NONE',status:computed.status,incident_version:computed.incident_version};
    }
    try {
      await options.sink?.notify(computed.notification);
      await database.prepare('UPDATE scheduled_alert_states SET last_notification_at=?,updated_at=? WHERE signal_type=? AND job_name=? AND summary_code=? AND (last_notification_at IS NULL OR last_notification_at<?)').bind(input.observed_at,input.observed_at,input.signal_type,jobKey,policy.summaryCode,input.observed_at).run();
      return {disposition:'EVALUATED',notification:'SENT',status:computed.status,incident_version:computed.incident_version};
    } catch {
      await database.prepare('UPDATE scheduled_alert_states SET suppressed_until=COALESCE(cooldown_until,?),updated_at=? WHERE signal_type=? AND job_name=? AND summary_code=?').bind(input.observed_at,input.observed_at,input.signal_type,jobKey,policy.summaryCode).run();
      await recordAlertSinkFailure(database,input,computed.incident_version).catch(()=>undefined);
      return {disposition:'EVALUATED',notification:'FAILED',status:computed.status,incident_version:computed.incident_version};
    }
  }
  throw new Error('scheduled_operational_signal_concurrency_conflict');
}

export async function evaluatePersistedScheduledJobSignals(
  database: SqlDatabase,
  input: {evaluationId:string;now:number;sink?:OperationalAlertSink|null;disabledJobs?:readonly ScheduledOperationJobName[]},
): Promise<OperationalSignalEvaluationResult[]> {
  if (!/^[0-9a-f]{64}$/u.test(input.evaluationId) || !Number.isSafeInteger(input.now) || input.now<0) throw new Error('invalid_scheduled_operational_evaluation');
  const jobs=await database.prepare(`SELECT job_name,lease_token,lease_expires_at,last_started_at,last_succeeded_at,last_failure_category,last_backlog_count,updated_at FROM scheduled_job_states WHERE enabled=1 ORDER BY job_name`).all<{job_name:ScheduledOperationJobName;lease_token:string|null;lease_expires_at:number|null;last_started_at:number|null;last_succeeded_at:number|null;last_failure_category:string|null;last_backlog_count:number;updated_at:number}>();
  const results: OperationalSignalEvaluationResult[]=[];
  for (const job of jobs.results) {
    if (input.disabledJobs?.includes(job.job_name)) continue;
    const baseline=job.last_succeeded_at??job.last_started_at??job.updated_at;
    results.push(await ingestDerived(database,input,{signalType:'job_stale',summaryCode:'JOB_SUCCESS_STALE',jobName:job.job_name,breach:input.now-baseline>=JOB_SUCCESS_STALE_AFTER_MS,countValue:1},input.sink));
    results.push(await ingestDerived(database,input,{signalType:'lease_stuck',summaryCode:'JOB_LEASE_STUCK',jobName:job.job_name,breach:job.lease_token!==null && job.lease_expires_at!==null && input.now-job.lease_expires_at>=LEASE_STUCK_GRACE_MS,countValue:1},input.sink));
    results.push(await ingestDerived(database,input,{signalType:'backlog_sustained',summaryCode:'JOB_BACKLOG_SUSTAINED',jobName:job.job_name,breach:job.last_backlog_count>0,countValue:job.last_backlog_count},input.sink));
    if (job.job_name==='file_orphan_cleanup'||job.job_name==='drive_archive') results.push(await ingestDerived(database,input,{signalType:'file_failure',summaryCode:'FILE_PROCESSING_FAILURE',jobName:job.job_name,breach:job.job_name==='file_orphan_cleanup'?job.last_failure_category==='file_cleanup_deferred':job.last_failure_category!==null,countValue:1},input.sink));
  }
  for (const global of GLOBAL_RECOVERY_SIGNALS) {
    const state=await readAlertState(database,global.signalType,'',global.summaryCode);
    if (!state || state.status==='RESOLVED') continue;
    const recent=await database.prepare("SELECT 1 AS found FROM scheduled_operational_signals WHERE signal_type=? AND summary_code=? AND job_name IS NULL AND observation_state='BREACH' AND observed_at>? LIMIT 1").bind(global.signalType,global.summaryCode,input.now-global.quietWindowMs).first<{found:number}>();
    if (!recent) results.push(await ingestGlobalHealthy(database,input,global,input.sink));
  }
  return results;
}

export async function recordWorker5xxSignal(
  database:SqlDatabase,
  input:{requestId:string;observedAt:number;sink?:OperationalAlertSink|null},
) {
  if (typeof input.requestId!=='string' || input.requestId.length<1 || input.requestId.length>200 || !Number.isSafeInteger(input.observedAt) || input.observedAt<0) throw new Error('invalid_worker_5xx_signal');
  const observationId=await hashCanonicalJson({kind:'WORKER_5XX',request_id:input.requestId});
  return ingestScheduledOperationalSignal(database,{observation_id:observationId,signal_type:'worker_5xx',summary_code:'WORKER_5XX_THRESHOLD',job_name:null,observation_state:'BREACH',observed_at:input.observedAt,count_value:1},input.sink===undefined?{}:{sink:input.sink});
}

export async function recordLoginAnomalySignal(
  database:SqlDatabase,
  input:{securityEventId:string;observedAt:number;sink?:OperationalAlertSink|null},
) {
  validateSafeSourceFact(input.securityEventId,input.observedAt);
  const observationId=await hashCanonicalJson({kind:'STAFF_LOGIN_ANOMALY',security_event_id:input.securityEventId});
  return ingestScheduledOperationalSignal(database,{observation_id:observationId,signal_type:'login_anomaly',summary_code:'LOGIN_ANOMALY_DETECTED',job_name:null,observation_state:'BREACH',observed_at:input.observedAt,count_value:1},input.sink===undefined?{}:{sink:input.sink});
}

export async function recordFeishuAdapterFailureSignal(
  database:SqlDatabase,
  input:{securityEventId:string;observedAt:number;sink?:OperationalAlertSink|null},
) {
  validateSafeSourceFact(input.securityEventId,input.observedAt);
  const observationId=await hashCanonicalJson({kind:'FEISHU_ADAPTER_FAILURE',security_event_id:input.securityEventId});
  return ingestScheduledOperationalSignal(database,{observation_id:observationId,signal_type:'external_adapter_failure',summary_code:'FEISHU_ADAPTER_FAILURE',job_name:null,observation_state:'BREACH',observed_at:input.observedAt,count_value:1},input.sink===undefined?{}:{sink:input.sink});
}

function policyFor(input: ScheduledOperationalSignalObservationDto): SignalPolicy {
  switch (input.signal_type) {
    case 'worker_5xx':
      assertShape(input,'WORKER_5XX_THRESHOLD',false);
      return policy('worker','CRITICAL','WORKER_5XX_THRESHOLD',3,5*MINUTE_MS,30*MINUTE_MS,'COUNT');
    case 'job_stale':
      assertShape(input,'JOB_SUCCESS_STALE',true);
      return policy('scheduler','WARNING','JOB_SUCCESS_STALE',1,60*MINUTE_MS,60*MINUTE_MS,'OBSERVATION');
    case 'lease_stuck':
      assertShape(input,'JOB_LEASE_STUCK',true);
      return policy('scheduler','CRITICAL','JOB_LEASE_STUCK',1,15*MINUTE_MS,60*MINUTE_MS,'OBSERVATION');
    case 'backlog_sustained':
      assertShape(input,'JOB_BACKLOG_SUSTAINED',true);
      return policy('scheduler','WARNING','JOB_BACKLOG_SUSTAINED',3,30*MINUTE_MS,60*MINUTE_MS,'OBSERVATION');
    case 'file_failure':
      assertShape(input,'FILE_PROCESSING_FAILURE',true);
      if (input.job_name!=='file_orphan_cleanup'&&input.job_name!=='drive_archive') throw new Error('invalid_scheduled_operational_signal_scope');
      return policy('file','WARNING','FILE_PROCESSING_FAILURE',3,30*MINUTE_MS,60*MINUTE_MS,'COUNT');
    case 'login_anomaly':
      assertShape(input,'LOGIN_ANOMALY_DETECTED',false);
      return policy('auth','CRITICAL','LOGIN_ANOMALY_DETECTED',5,10*MINUTE_MS,30*MINUTE_MS,'COUNT');
    case 'external_adapter_failure':
      assertShape(input,input.summary_code,false);
      if (input.summary_code==='PRIMARY_ALERT_SINK_FAILURE') return policy('external','CRITICAL','PRIMARY_ALERT_SINK_FAILURE',1,5*MINUTE_MS,30*MINUTE_MS,'COUNT');
      if (input.summary_code==='FEISHU_ADAPTER_FAILURE') return policy('external','WARNING','FEISHU_ADAPTER_FAILURE',3,15*MINUTE_MS,60*MINUTE_MS,'COUNT');
      throw new Error('invalid_scheduled_operational_signal_summary');
  }
}

function policy(category:ScheduledOperationalSignalCategory,severity:ScheduledOperationalSignalSeverity,summaryCode:ScheduledOperationalSignalSummaryCode,thresholdCount:number,thresholdWindowMs:number,cooldownMs:number,accumulation:'COUNT'|'OBSERVATION'): SignalPolicy {
  return {category,severity,summaryCode,thresholdCount,thresholdWindowMs,recoveryCount:2,cooldownMs,accumulation};
}

function assertShape(input:ScheduledOperationalSignalObservationDto,summaryCode:ScheduledOperationalSignalSummaryCode,requiresJob:boolean) {
  if (input.summary_code!==summaryCode || (requiresJob ? input.job_name===null : input.job_name!==null)) throw new Error('invalid_scheduled_operational_signal_scope');
}

function computeAlertState(current:AlertStateRow|null,input:ScheduledOperationalSignalObservationDto,policy:SignalPolicy,deliveryEnabled:boolean): ComputedAlertState {
  const now=input.observed_at;
  const base=current??initialState(input,policy);
  const expired=now-base.window_started_at>=policy.thresholdWindowMs;
  let status=base.status;
  let firstSeen=base.first_seen_at??now;
  let breachCount=base.consecutive_breach_count;
  let healthyCount=base.consecutive_healthy_count;
  let windowStarted=expired?now:base.window_started_at;
  let windowCount=expired?0:base.window_count_value;
  let openedAt=base.opened_at;
  let acknowledgedAt=base.acknowledged_at;
  let resolvedAt=base.resolved_at;
  let incidentVersion=base.incident_version;
  let cooldownUntil=base.cooldown_until;
  let suppressedUntil=base.suppressed_until;
  let notificationKind: 'OPENED'|'REMINDER'|'RESOLVED'|null=null;

  if (input.observation_state==='BREACH') {
    breachCount=expired?1:breachCount+1;
    healthyCount=0;
    windowCount+=policy.accumulation==='COUNT'?input.count_value:1;
    if (windowCount>=policy.thresholdCount) {
      if (status==='RESOLVED') {
        status='OPEN';
        openedAt=now;
        acknowledgedAt=null;
        resolvedAt=null;
        incidentVersion+=1;
        notificationKind='OPENED';
      } else if (status==='OPEN') {
        notificationKind='REMINDER';
      }
    }
  } else {
    breachCount=0;
    healthyCount+=1;
    windowStarted=now;
    windowCount=0;
    if ((status==='OPEN' || status==='ACKNOWLEDGED') && healthyCount>=policy.recoveryCount) {
      status='RESOLVED';
      resolvedAt=now;
      notificationKind='RESOLVED';
    }
  }

  const blockedByCooldown=notificationKind!==null && notificationKind!=='RESOLVED' && cooldownUntil!==null && cooldownUntil>now;
  if (blockedByCooldown) {
    notificationKind=null;
    suppressedUntil=cooldownUntil;
  } else if (notificationKind!==null && deliveryEnabled) {
    cooldownUntil=now+policy.cooldownMs;
    suppressedUntil=null;
  } else if (notificationKind!==null) {
    notificationKind=null;
  }

  const version=(current?.version??0)+1;
  const state: ComputedAlertState={
    signal_type:input.signal_type,job_name:input.job_name??'',category:policy.category,severity:policy.severity,summary_code:policy.summaryCode,
    status,first_seen_at:firstSeen,last_seen_at:now,consecutive_breach_count:breachCount,consecutive_healthy_count:healthyCount,
    window_started_at:windowStarted,window_count_value:windowCount,threshold_count:policy.thresholdCount,threshold_window_ms:policy.thresholdWindowMs,recovery_count:policy.recoveryCount,
    opened_at:openedAt,acknowledged_at:acknowledgedAt,resolved_at:resolvedAt,cooldown_until:cooldownUntil,suppressed_until:suppressedUntil,last_notification_at:base.last_notification_at,
    last_evaluated_at:now,incident_version:incidentVersion,version,updated_at:now,notification:null,
  };
  if (notificationKind!==null) {
    state.notification=parseScheduledOperationalAlertNotificationDto({signal_type:input.signal_type,category:policy.category,severity:policy.severity,summary_code:policy.summaryCode,job_name:input.job_name,notification_kind:notificationKind,status:notificationKind==='RESOLVED'?'RESOLVED':'OPEN',observed_at:now,incident_version:incidentVersion,count_value:windowCount});
  }
  return state;
}

function initialState(input:ScheduledOperationalSignalObservationDto,policy:SignalPolicy): AlertStateRow {
  return {signal_type:input.signal_type,job_name:input.job_name??'',category:policy.category,severity:policy.severity,summary_code:policy.summaryCode,status:'RESOLVED',first_seen_at:null,last_seen_at:null,consecutive_breach_count:0,consecutive_healthy_count:0,window_started_at:input.observed_at,window_count_value:0,threshold_count:policy.thresholdCount,threshold_window_ms:policy.thresholdWindowMs,recovery_count:policy.recoveryCount,opened_at:null,acknowledged_at:null,resolved_at:input.observed_at,cooldown_until:null,suppressed_until:null,last_notification_at:null,last_evaluated_at:input.observed_at,incident_version:0,version:0,updated_at:input.observed_at};
}

function upsertAlertStateStatement(database:SqlDatabase,state:ComputedAlertState,expectedVersion:number) {
  return database.prepare(`INSERT INTO scheduled_alert_states(signal_type,job_name,category,severity,summary_code,status,first_seen_at,last_seen_at,consecutive_breach_count,consecutive_healthy_count,window_started_at,window_count_value,threshold_count,threshold_window_ms,recovery_count,opened_at,acknowledged_at,resolved_at,cooldown_until,suppressed_until,last_notification_at,last_evaluated_at,incident_version,version,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(signal_type,job_name,summary_code) DO UPDATE SET category=excluded.category,severity=excluded.severity,status=excluded.status,first_seen_at=excluded.first_seen_at,last_seen_at=excluded.last_seen_at,consecutive_breach_count=excluded.consecutive_breach_count,consecutive_healthy_count=excluded.consecutive_healthy_count,window_started_at=excluded.window_started_at,window_count_value=excluded.window_count_value,threshold_count=excluded.threshold_count,threshold_window_ms=excluded.threshold_window_ms,recovery_count=excluded.recovery_count,opened_at=excluded.opened_at,acknowledged_at=excluded.acknowledged_at,resolved_at=excluded.resolved_at,cooldown_until=excluded.cooldown_until,suppressed_until=excluded.suppressed_until,last_notification_at=excluded.last_notification_at,last_evaluated_at=excluded.last_evaluated_at,incident_version=excluded.incident_version,version=excluded.version,updated_at=excluded.updated_at WHERE scheduled_alert_states.version=?`).bind(state.signal_type,state.job_name,state.category,state.severity,state.summary_code,state.status,state.first_seen_at,state.last_seen_at,state.consecutive_breach_count,state.consecutive_healthy_count,state.window_started_at,state.window_count_value,state.threshold_count,state.threshold_window_ms,state.recovery_count,state.opened_at,state.acknowledged_at,state.resolved_at,state.cooldown_until,state.suppressed_until,state.last_notification_at,state.last_evaluated_at,state.incident_version,state.version,state.updated_at,expectedVersion);
}

async function readAlertState(database:SqlDatabase,signalType:ScheduledOperationalSignalType,jobKey:string,summaryCode:ScheduledOperationalSignalSummaryCode) {
  return database.prepare('SELECT signal_type,job_name,category,severity,summary_code,status,first_seen_at,last_seen_at,consecutive_breach_count,consecutive_healthy_count,window_started_at,window_count_value,threshold_count,threshold_window_ms,recovery_count,opened_at,acknowledged_at,resolved_at,cooldown_until,suppressed_until,last_notification_at,last_evaluated_at,incident_version,version,updated_at FROM scheduled_alert_states WHERE signal_type=? AND job_name=? AND summary_code=?').bind(signalType,jobKey,summaryCode).first<AlertStateRow>();
}

function sameObservation(input:ScheduledOperationalSignalObservationDto,policy:SignalPolicy,row:PersistedObservationRow) {
  return row.signal_type===input.signal_type && row.category===policy.category && row.severity===policy.severity && row.summary_code===policy.summaryCode && row.job_name===input.job_name && row.observation_state===input.observation_state && row.observed_at===input.observed_at && row.count_value===input.count_value;
}

function resultFromCurrent(disposition:'DUPLICATE',current:AlertStateRow|null): OperationalSignalEvaluationResult {
  return {disposition,notification:'NONE',status:current?.status??'RESOLVED',incident_version:current?.incident_version??0};
}

function changedOnceStatement(database:SqlDatabase) {
  return database.prepare('INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN changes()=1 THEN 1 ELSE 0 END');
}

function validateSafeSourceFact(value:string,observedAt:number) {
  if (typeof value!=='string' || value.length<1 || value.length>200 || /[\u0000-\u001f\u007f]/u.test(value) || !Number.isSafeInteger(observedAt) || observedAt<0) throw new Error('invalid_operational_signal_source');
}

async function recordAlertSinkFailure(database:SqlDatabase,source:ScheduledOperationalSignalObservationDto,incidentVersion:number) {
  const observationId=await hashCanonicalJson({kind:'PRIMARY_ALERT_SINK_FAILURE',source_observation_id:source.observation_id,incident_version:incidentVersion});
  await ingestScheduledOperationalSignal(database,{observation_id:observationId,signal_type:'external_adapter_failure',summary_code:'PRIMARY_ALERT_SINK_FAILURE',job_name:null,observation_state:'BREACH',observed_at:source.observed_at,count_value:1});
}

async function ingestDerived(database:SqlDatabase,evaluation:{evaluationId:string;now:number},derived:{signalType:ScheduledOperationalSignalType;summaryCode:ScheduledOperationalSignalSummaryCode;jobName:ScheduledOperationJobName;breach:boolean;countValue:number},sink:OperationalAlertSink|null|undefined) {
  const observationState=derived.breach?'BREACH':'HEALTHY';
  const observationId=await hashCanonicalJson({evaluation_id:evaluation.evaluationId,signal_type:derived.signalType,job_name:derived.jobName});
  return ingestScheduledOperationalSignal(database,{observation_id:observationId,signal_type:derived.signalType,summary_code:derived.summaryCode,job_name:derived.jobName,observation_state:observationState,observed_at:evaluation.now,count_value:derived.breach?derived.countValue:0},sink===undefined?{}:{sink});
}

const GLOBAL_RECOVERY_SIGNALS = [
  {signalType:'worker_5xx',summaryCode:'WORKER_5XX_THRESHOLD',quietWindowMs:5*MINUTE_MS},
  {signalType:'login_anomaly',summaryCode:'LOGIN_ANOMALY_DETECTED',quietWindowMs:10*MINUTE_MS},
  {signalType:'external_adapter_failure',summaryCode:'PRIMARY_ALERT_SINK_FAILURE',quietWindowMs:5*MINUTE_MS},
  {signalType:'external_adapter_failure',summaryCode:'FEISHU_ADAPTER_FAILURE',quietWindowMs:15*MINUTE_MS},
] as const satisfies readonly {signalType:ScheduledOperationalSignalType;summaryCode:ScheduledOperationalSignalSummaryCode;quietWindowMs:number}[];

async function ingestGlobalHealthy(database:SqlDatabase,evaluation:{evaluationId:string;now:number},global:(typeof GLOBAL_RECOVERY_SIGNALS)[number],sink:OperationalAlertSink|null|undefined) {
  const observationId=await hashCanonicalJson({evaluation_id:evaluation.evaluationId,signal_type:global.signalType,summary_code:global.summaryCode});
  return ingestScheduledOperationalSignal(database,{observation_id:observationId,signal_type:global.signalType,summary_code:global.summaryCode,job_name:null,observation_state:'HEALTHY',observed_at:evaluation.now,count_value:0},sink===undefined?{}:{sink});
}
