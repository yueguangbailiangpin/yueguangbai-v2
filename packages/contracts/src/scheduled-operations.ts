export const SCHEDULED_OPERATION_JOB_NAMES = [
  'reservation_expiry', 'instruction_expiry', 'outbox_delivery',
  'file_orphan_cleanup', 'staff_auth_cleanup', 'drive_archive', 'feishu_sync',
] as const;
export type ScheduledOperationJobName = typeof SCHEDULED_OPERATION_JOB_NAMES[number];
export const SCHEDULED_OPERATION_OUTCOMES = ['SUCCEEDED','PARTIAL','FAILED','SKIPPED','DISABLED'] as const;
export type ScheduledOperationOutcome = typeof SCHEDULED_OPERATION_OUTCOMES[number];
export const SCHEDULED_OPERATION_FAILURE_CATEGORIES = ['adapter_unavailable','delivery_failed','file_cleanup_deferred','reservation_expiry_failed','job_item_failed','job_execution_failed','lease_lost','dependency_unavailable','login_anomaly','worker_5xx'] as const;
export type ScheduledOperationFailureCategory = typeof SCHEDULED_OPERATION_FAILURE_CATEGORIES[number];
export const SCHEDULED_OPERATION_CAPABILITY_SCOPES = ['ALL_ENABLED_MARKETPLACES','LEGACY_JP_ONLY','HARD_DISABLED'] as const;
export type ScheduledOperationCapabilityScope = typeof SCHEDULED_OPERATION_CAPABILITY_SCOPES[number];
export const SCHEDULED_OPERATION_COMMAND_TYPES = ['RUN_JOB','REPLAY_DEAD_LETTER'] as const;
export type ScheduledOperationCommandType = typeof SCHEDULED_OPERATION_COMMAND_TYPES[number];
export const SCHEDULED_OPERATION_REASON_CODES = ['OPERATOR_RETRY','BACKLOG_RECOVERY','DEPENDENCY_RECOVERED','POISON_RECOVERY'] as const;
export type ScheduledOperationReasonCode = typeof SCHEDULED_OPERATION_REASON_CODES[number];
export const SCHEDULED_OPERATIONAL_SIGNAL_TYPES = ['worker_5xx','job_stale','lease_stuck','backlog_sustained','file_failure','login_anomaly','external_adapter_failure'] as const;
export type ScheduledOperationalSignalType = typeof SCHEDULED_OPERATIONAL_SIGNAL_TYPES[number];
export const SCHEDULED_OPERATIONAL_SIGNAL_CATEGORIES = ['worker','scheduler','file','auth','external'] as const;
export type ScheduledOperationalSignalCategory = typeof SCHEDULED_OPERATIONAL_SIGNAL_CATEGORIES[number];
export const SCHEDULED_OPERATIONAL_SIGNAL_SEVERITIES = ['WARNING','CRITICAL'] as const;
export type ScheduledOperationalSignalSeverity = typeof SCHEDULED_OPERATIONAL_SIGNAL_SEVERITIES[number];
export const SCHEDULED_OPERATIONAL_SIGNAL_SUMMARY_CODES = ['WORKER_5XX_THRESHOLD','JOB_SUCCESS_STALE','JOB_LEASE_STUCK','JOB_BACKLOG_SUSTAINED','FILE_PROCESSING_FAILURE','LOGIN_ANOMALY_DETECTED','PRIMARY_ALERT_SINK_FAILURE','FEISHU_ADAPTER_FAILURE'] as const;
export type ScheduledOperationalSignalSummaryCode = typeof SCHEDULED_OPERATIONAL_SIGNAL_SUMMARY_CODES[number];
export const SCHEDULED_OPERATIONAL_OBSERVATION_STATES = ['BREACH','HEALTHY'] as const;
export type ScheduledOperationalObservationState = typeof SCHEDULED_OPERATIONAL_OBSERVATION_STATES[number];
export const SCHEDULED_OPERATIONAL_ALERT_STATUSES = ['OPEN','ACKNOWLEDGED','RESOLVED'] as const;
export type ScheduledOperationalAlertStatus = typeof SCHEDULED_OPERATIONAL_ALERT_STATUSES[number];
export const SCHEDULED_OPERATIONAL_NOTIFICATION_KINDS = ['OPENED','REMINDER','RESOLVED'] as const;
export type ScheduledOperationalNotificationKind = typeof SCHEDULED_OPERATIONAL_NOTIFICATION_KINDS[number];
export interface ScheduledOperationHealthDto {
  job_name: ScheduledOperationJobName;
  enabled: boolean;
  last_started_at: number | null;
  last_succeeded_at: number | null;
  last_failed_at: number | null;
  last_failure_category: ScheduledOperationFailureCategory | null;
  backlog_count: number;
  lease_expires_at: number | null;
  capability_scope: ScheduledOperationCapabilityScope;
}
export interface ScheduledOperationRunDto {
  job_name: ScheduledOperationJobName;
  outcome: ScheduledOperationOutcome;
  processed_count: number;
  succeeded_count: number;
  failed_count: number;
  backlog_count: number;
  failure_category: ScheduledOperationFailureCategory | null;
}
export interface ScheduledOperationManualRunCommandDto {
  reason_code: ScheduledOperationReasonCode;
}
export interface ScheduledOperationDeadLetterReplayCommandDto {
  event_id: string;
  reason_code: ScheduledOperationReasonCode;
}
export interface ScheduledOperationManualRunResultDto {
  command_type: 'RUN_JOB';
  job_name: ScheduledOperationJobName;
  reason_code: ScheduledOperationReasonCode;
  outcome: ScheduledOperationOutcome;
  run: ScheduledOperationRunDto;
}
export interface ScheduledOperationDeadLetterReplayResultDto {
  command_type: 'REPLAY_DEAD_LETTER';
  job_name: 'outbox_delivery';
  reason_code: ScheduledOperationReasonCode;
  outcome: 'SUCCEEDED'|'DISABLED';
  dead_letter_id: string;
  event_id: string;
}
export type ScheduledOperationCommandResultDto = ScheduledOperationManualRunResultDto|ScheduledOperationDeadLetterReplayResultDto;
export interface ScheduledOperationalSignalObservationDto {
  observation_id: string;
  signal_type: ScheduledOperationalSignalType;
  summary_code: ScheduledOperationalSignalSummaryCode;
  job_name: ScheduledOperationJobName|null;
  observation_state: ScheduledOperationalObservationState;
  observed_at: number;
  count_value: number;
}
export interface ScheduledOperationalAlertNotificationDto {
  signal_type: ScheduledOperationalSignalType;
  category: ScheduledOperationalSignalCategory;
  severity: ScheduledOperationalSignalSeverity;
  summary_code: ScheduledOperationalSignalSummaryCode;
  job_name: ScheduledOperationJobName|null;
  notification_kind: ScheduledOperationalNotificationKind;
  status: 'OPEN'|'RESOLVED';
  observed_at: number;
  incident_version: number;
  count_value: number;
}
export interface ScheduledOperationalAlertDto {
  signal_type: ScheduledOperationalSignalType;
  category: ScheduledOperationalSignalCategory;
  severity: ScheduledOperationalSignalSeverity;
  summary_code: ScheduledOperationalSignalSummaryCode;
  job_name: ScheduledOperationJobName|null;
  status: ScheduledOperationalAlertStatus;
  first_seen_at: number|null;
  last_seen_at: number|null;
  consecutive_breach_count: number;
  consecutive_healthy_count: number;
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
  incident_version: number;
  updated_at: number;
  time_basis: 'UTC_MS';
  display_timezone: 'Asia/Shanghai';
}
export interface ScheduledOperationalAlertAckCommandDto {
  signal_type: ScheduledOperationalSignalType;
  summary_code: ScheduledOperationalSignalSummaryCode;
  job_name: ScheduledOperationJobName|null;
  incident_version: number;
}
export interface ScheduledOperationalAlertAckResultDto {
  signal_type: ScheduledOperationalSignalType;
  summary_code: ScheduledOperationalSignalSummaryCode;
  job_name: ScheduledOperationJobName|null;
  incident_version: number;
  status: 'ACKNOWLEDGED';
  acknowledged_at: number;
}

export function isScheduledOperationJobName(value: unknown): value is ScheduledOperationJobName { return published(value,SCHEDULED_OPERATION_JOB_NAMES); }
export function parseScheduledOperationManualRunCommand(value: unknown): ScheduledOperationManualRunCommandDto {
  const record=exactRecord(value,['reason_code']);
  if (!published(record['reason_code'],SCHEDULED_OPERATION_REASON_CODES)) throw new Error('invalid_scheduled_operation_command');
  return {reason_code:record['reason_code']};
}
export function parseScheduledOperationDeadLetterReplayCommand(value: unknown): ScheduledOperationDeadLetterReplayCommandDto {
  const record=exactRecord(value,['event_id','reason_code']);
  if (!safeIdentifier(record['event_id']) || !published(record['reason_code'],SCHEDULED_OPERATION_REASON_CODES)) throw new Error('invalid_scheduled_operation_command');
  return {event_id:record['event_id'],reason_code:record['reason_code']};
}
export function parseScheduledOperationRunDto(value: unknown): ScheduledOperationRunDto {
  const record=exactRecord(value,['job_name','outcome','processed_count','succeeded_count','failed_count','backlog_count','failure_category']);
  if (!isScheduledOperationJobName(record['job_name']) || !published(record['outcome'],SCHEDULED_OPERATION_OUTCOMES) || !count(record['processed_count']) || !count(record['succeeded_count']) || !count(record['failed_count']) || !count(record['backlog_count']) || !(record['failure_category']===null || published(record['failure_category'],SCHEDULED_OPERATION_FAILURE_CATEGORIES))) throw new Error('invalid_scheduled_operation_run');
  return {job_name:record['job_name'],outcome:record['outcome'],processed_count:record['processed_count'],succeeded_count:record['succeeded_count'],failed_count:record['failed_count'],backlog_count:record['backlog_count'],failure_category:record['failure_category']};
}
export function parseScheduledOperationHealthDto(value: unknown): ScheduledOperationHealthDto {
  const record=exactRecord(value,['job_name','enabled','last_started_at','last_succeeded_at','last_failed_at','last_failure_category','backlog_count','lease_expires_at','capability_scope']);
  if (!isScheduledOperationJobName(record['job_name']) || typeof record['enabled']!=='boolean' || !nullableTimestamp(record['last_started_at']) || !nullableTimestamp(record['last_succeeded_at']) || !nullableTimestamp(record['last_failed_at']) || !(record['last_failure_category']===null || published(record['last_failure_category'],SCHEDULED_OPERATION_FAILURE_CATEGORIES)) || !count(record['backlog_count']) || !nullableTimestamp(record['lease_expires_at']) || !published(record['capability_scope'],SCHEDULED_OPERATION_CAPABILITY_SCOPES)) throw new Error('invalid_scheduled_operation_health');
  return {job_name:record['job_name'],enabled:record['enabled'],last_started_at:record['last_started_at'],last_succeeded_at:record['last_succeeded_at'],last_failed_at:record['last_failed_at'],last_failure_category:record['last_failure_category'],backlog_count:record['backlog_count'],lease_expires_at:record['lease_expires_at'],capability_scope:record['capability_scope']};
}
export function parseScheduledOperationCommandResultDto(value: unknown): ScheduledOperationCommandResultDto {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('invalid_scheduled_operation_result');
  const commandType=(value as Record<string,unknown>)['command_type'];
  if (commandType==='RUN_JOB') {
    const record=exactRecord(value,['command_type','job_name','reason_code','outcome','run']);
    const run=parseScheduledOperationRunDto(record['run']);
    if (!isScheduledOperationJobName(record['job_name']) || record['job_name']!==run.job_name || !published(record['reason_code'],SCHEDULED_OPERATION_REASON_CODES) || !published(record['outcome'],SCHEDULED_OPERATION_OUTCOMES) || record['outcome']!==run.outcome) throw new Error('invalid_scheduled_operation_result');
    return {command_type:'RUN_JOB',job_name:record['job_name'],reason_code:record['reason_code'],outcome:record['outcome'],run};
  }
  const record=exactRecord(value,['command_type','job_name','reason_code','outcome','dead_letter_id','event_id']);
  if (record['command_type']!=='REPLAY_DEAD_LETTER' || record['job_name']!=='outbox_delivery' || !published(record['reason_code'],SCHEDULED_OPERATION_REASON_CODES) || (record['outcome']!=='SUCCEEDED' && record['outcome']!=='DISABLED') || !safeIdentifier(record['dead_letter_id']) || !safeIdentifier(record['event_id'])) throw new Error('invalid_scheduled_operation_result');
  return {command_type:'REPLAY_DEAD_LETTER',job_name:'outbox_delivery',reason_code:record['reason_code'],outcome:record['outcome'],dead_letter_id:record['dead_letter_id'],event_id:record['event_id']};
}
export function parseScheduledOperationalSignalObservationDto(value: unknown): ScheduledOperationalSignalObservationDto {
  const record=exactRecord(value,['observation_id','signal_type','summary_code','job_name','observation_state','observed_at','count_value']);
  if (!opaqueObservationId(record['observation_id']) || !published(record['signal_type'],SCHEDULED_OPERATIONAL_SIGNAL_TYPES) || !published(record['summary_code'],SCHEDULED_OPERATIONAL_SIGNAL_SUMMARY_CODES) || !(record['job_name']===null || isScheduledOperationJobName(record['job_name'])) || !published(record['observation_state'],SCHEDULED_OPERATIONAL_OBSERVATION_STATES) || !timestamp(record['observed_at']) || !count(record['count_value']) || (record['observation_state']==='BREACH' ? record['count_value']<1 : record['count_value']!==0)) throw new Error('invalid_scheduled_operational_signal');
  return {observation_id:record['observation_id'],signal_type:record['signal_type'],summary_code:record['summary_code'],job_name:record['job_name'],observation_state:record['observation_state'],observed_at:record['observed_at'],count_value:record['count_value']};
}
export function parseScheduledOperationalAlertNotificationDto(value: unknown): ScheduledOperationalAlertNotificationDto {
  const record=exactRecord(value,['signal_type','category','severity','summary_code','job_name','notification_kind','status','observed_at','incident_version','count_value']);
  if (!published(record['signal_type'],SCHEDULED_OPERATIONAL_SIGNAL_TYPES) || !published(record['category'],SCHEDULED_OPERATIONAL_SIGNAL_CATEGORIES) || !published(record['severity'],SCHEDULED_OPERATIONAL_SIGNAL_SEVERITIES) || !published(record['summary_code'],SCHEDULED_OPERATIONAL_SIGNAL_SUMMARY_CODES) || !(record['job_name']===null || isScheduledOperationJobName(record['job_name'])) || !published(record['notification_kind'],SCHEDULED_OPERATIONAL_NOTIFICATION_KINDS) || (record['status']!=='OPEN' && record['status']!=='RESOLVED') || (record['notification_kind']==='RESOLVED')!==(record['status']==='RESOLVED') || !timestamp(record['observed_at']) || !count(record['incident_version']) || !count(record['count_value'])) throw new Error('invalid_scheduled_operational_notification');
  return {signal_type:record['signal_type'],category:record['category'],severity:record['severity'],summary_code:record['summary_code'],job_name:record['job_name'],notification_kind:record['notification_kind'],status:record['status'],observed_at:record['observed_at'],incident_version:record['incident_version'],count_value:record['count_value']};
}
export function parseScheduledOperationalAlertDto(value: unknown): ScheduledOperationalAlertDto {
  const record=exactRecord(value,['signal_type','category','severity','summary_code','job_name','status','first_seen_at','last_seen_at','consecutive_breach_count','consecutive_healthy_count','window_count_value','threshold_count','threshold_window_ms','recovery_count','opened_at','acknowledged_at','resolved_at','cooldown_until','suppressed_until','last_notification_at','incident_version','updated_at','time_basis','display_timezone']);
  if (!published(record['signal_type'],SCHEDULED_OPERATIONAL_SIGNAL_TYPES) || !published(record['category'],SCHEDULED_OPERATIONAL_SIGNAL_CATEGORIES) || !published(record['severity'],SCHEDULED_OPERATIONAL_SIGNAL_SEVERITIES) || !published(record['summary_code'],SCHEDULED_OPERATIONAL_SIGNAL_SUMMARY_CODES) || !(record['job_name']===null || isScheduledOperationJobName(record['job_name'])) || !published(record['status'],SCHEDULED_OPERATIONAL_ALERT_STATUSES) || !nullableTimestamp(record['first_seen_at']) || !nullableTimestamp(record['last_seen_at']) || !count(record['consecutive_breach_count']) || !count(record['consecutive_healthy_count']) || !count(record['window_count_value']) || !positiveCount(record['threshold_count']) || !positiveCount(record['threshold_window_ms']) || !positiveCount(record['recovery_count']) || !nullableTimestamp(record['opened_at']) || !nullableTimestamp(record['acknowledged_at']) || !nullableTimestamp(record['resolved_at']) || !nullableTimestamp(record['cooldown_until']) || !nullableTimestamp(record['suppressed_until']) || !nullableTimestamp(record['last_notification_at']) || !count(record['incident_version']) || !timestamp(record['updated_at']) || record['time_basis']!=='UTC_MS' || record['display_timezone']!=='Asia/Shanghai' || (record['status']==='OPEN' && record['opened_at']===null) || (record['status']==='ACKNOWLEDGED' && (record['opened_at']===null || record['acknowledged_at']===null)) || (record['status']==='RESOLVED' && record['resolved_at']===null)) throw new Error('invalid_scheduled_operational_alert');
  return {signal_type:record['signal_type'],category:record['category'],severity:record['severity'],summary_code:record['summary_code'],job_name:record['job_name'],status:record['status'],first_seen_at:record['first_seen_at'],last_seen_at:record['last_seen_at'],consecutive_breach_count:record['consecutive_breach_count'],consecutive_healthy_count:record['consecutive_healthy_count'],window_count_value:record['window_count_value'],threshold_count:record['threshold_count'],threshold_window_ms:record['threshold_window_ms'],recovery_count:record['recovery_count'],opened_at:record['opened_at'],acknowledged_at:record['acknowledged_at'],resolved_at:record['resolved_at'],cooldown_until:record['cooldown_until'],suppressed_until:record['suppressed_until'],last_notification_at:record['last_notification_at'],incident_version:record['incident_version'],updated_at:record['updated_at'],time_basis:'UTC_MS',display_timezone:'Asia/Shanghai'};
}
export function parseScheduledOperationalAlertAckCommandDto(value:unknown):ScheduledOperationalAlertAckCommandDto {
  const record=exactRecord(value,['signal_type','summary_code','job_name','incident_version']);
  if (!published(record['signal_type'],SCHEDULED_OPERATIONAL_SIGNAL_TYPES) || !published(record['summary_code'],SCHEDULED_OPERATIONAL_SIGNAL_SUMMARY_CODES) || !(record['job_name']===null || isScheduledOperationJobName(record['job_name'])) || !positiveCount(record['incident_version'])) throw new Error('invalid_scheduled_operational_alert_ack');
  return {signal_type:record['signal_type'],summary_code:record['summary_code'],job_name:record['job_name'],incident_version:record['incident_version']};
}
export function parseScheduledOperationalAlertAckResultDto(value:unknown):ScheduledOperationalAlertAckResultDto {
  const record=exactRecord(value,['signal_type','summary_code','job_name','incident_version','status','acknowledged_at']);
  if (!published(record['signal_type'],SCHEDULED_OPERATIONAL_SIGNAL_TYPES) || !published(record['summary_code'],SCHEDULED_OPERATIONAL_SIGNAL_SUMMARY_CODES) || !(record['job_name']===null || isScheduledOperationJobName(record['job_name'])) || !positiveCount(record['incident_version']) || record['status']!=='ACKNOWLEDGED' || !timestamp(record['acknowledged_at'])) throw new Error('invalid_scheduled_operational_alert_ack_result');
  return {signal_type:record['signal_type'],summary_code:record['summary_code'],job_name:record['job_name'],incident_version:record['incident_version'],status:'ACKNOWLEDGED',acknowledged_at:record['acknowledged_at']};
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string,unknown> { if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('invalid_scheduled_operation_contract'); const record=value as Record<string,unknown>; if (Object.keys(record).length!==keys.length || Object.keys(record).some((key)=>!keys.includes(key))) throw new Error('invalid_scheduled_operation_contract'); return record; }
function published<T extends string>(value: unknown, values: readonly T[]): value is T { return typeof value==='string' && (values as readonly string[]).includes(value); }
function count(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value)>=0; }
function positiveCount(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value)>=1; }
function nullableTimestamp(value: unknown): value is number|null { return value===null || (Number.isSafeInteger(value) && Number(value)>=0); }
function timestamp(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value)>=0; }
function safeIdentifier(value: unknown): value is string { return typeof value==='string' && value.length>=1 && value.length<=200 && !/[\u0000-\u001f\u007f]/u.test(value); }
function opaqueObservationId(value: unknown): value is string { return typeof value==='string' && /^[0-9a-f]{64}$/u.test(value); }
