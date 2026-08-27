import { describe, expect, it } from 'vitest';
import {
  SCHEDULED_OPERATION_FAILURE_CATEGORIES,
  SCHEDULED_OPERATION_JOB_NAMES,
  SCHEDULED_OPERATION_OUTCOMES,
  SCHEDULED_OPERATIONAL_SIGNAL_CATEGORIES,
  SCHEDULED_OPERATIONAL_SIGNAL_SUMMARY_CODES,
  SCHEDULED_OPERATIONAL_SIGNAL_TYPES,
  parseScheduledOperationCommandResultDto,
  parseScheduledOperationalAlertNotificationDto,
  parseScheduledOperationalAlertDto,
  parseScheduledOperationalAlertAckCommandDto,
  parseScheduledOperationalAlertAckResultDto,
  parseScheduledOperationalSignalObservationDto,
} from './scheduled-operations';

describe('scheduled operations public contract', () => {
  it('uses finite low-cardinality enums and no payload-shaped DTO fields', () => {
    expect(SCHEDULED_OPERATION_JOB_NAMES).toHaveLength(4);
    expect(SCHEDULED_OPERATION_OUTCOMES).toContain('PARTIAL');
    expect(SCHEDULED_OPERATION_FAILURE_CATEGORIES).not.toContain('payload');
  });


  it('rejects payload-shaped or unknown command results at runtime', () => {
    // D-056: REPLAY_DEAD_LETTER is retired with the dead-letter queue —
    // replay-shaped payloads must fail closed.
    expect(() =>
      parseScheduledOperationCommandResultDto({
        command_type: 'REPLAY_DEAD_LETTER',
        job_name: 'outbox_delivery',
        reason_code: 'POISON_RECOVERY',
        outcome: 'SUCCEEDED',
        dead_letter_id: 'dead-1',
        event_id: 'event-1',
      }),
    ).toThrow('invalid_scheduled_operation_result');
    expect(() =>
      parseScheduledOperationCommandResultDto({ command_type: 'UNKNOWN' }),
    ).toThrow('invalid_scheduled_operation_result');
    expect(
      parseScheduledOperationCommandResultDto({
        command_type: 'RUN_JOB',
        job_name: 'reservation_expiry',
        reason_code: 'OPERATOR_RETRY',
        outcome: 'SUCCEEDED',
        run: {
          job_name: 'reservation_expiry',
          outcome: 'SUCCEEDED',
          processed_count: 1,
          succeeded_count: 1,
          failed_count: 0,
          backlog_count: 0,
          failure_category: null,
        },
      }),
    ).toMatchObject({ outcome: 'SUCCEEDED' });
  });

  it('publishes only the fixed low-cardinality operational signal vocabulary', () => {
    expect(SCHEDULED_OPERATIONAL_SIGNAL_TYPES).toEqual([
      'worker_5xx',
      'job_stale',
      'lease_stuck',
      'backlog_sustained',
      'file_failure',
      'login_anomaly',
      'external_adapter_failure',
    ]);
    expect(SCHEDULED_OPERATIONAL_SIGNAL_CATEGORIES).toEqual([
      'worker',
      'scheduler',
      'file',
      'auth',
      'external',
    ]);
    expect(SCHEDULED_OPERATIONAL_SIGNAL_SUMMARY_CODES).toHaveLength(7);
  });

  it('strictly parses opaque operational observations without detail fields', () => {
    const observation = {
      observation_id: 'a'.repeat(64),
      signal_type: 'worker_5xx',
      summary_code: 'WORKER_5XX_THRESHOLD',
      job_name: null,
      observation_state: 'BREACH',
      observed_at: 1_000,
      count_value: 1,
    };
    expect(parseScheduledOperationalSignalObservationDto(observation)).toEqual(observation);
    expect(() =>
      parseScheduledOperationalSignalObservationDto({ ...observation, path: '/private/order/1' }),
    ).toThrow();
    expect(() =>
      parseScheduledOperationalSignalObservationDto({
        ...observation,
        observation_id: 'customer-wechat-id',
      }),
    ).toThrow();
    expect(() =>
      parseScheduledOperationalSignalObservationDto({
        ...observation,
        observation_state: 'HEALTHY',
        count_value: 1,
      }),
    ).toThrow();
  });

  it('strictly parses safe notification facts and rejects raw error details', () => {
    const notification = {
      signal_type: 'login_anomaly',
      category: 'auth',
      severity: 'CRITICAL',
      summary_code: 'LOGIN_ANOMALY_DETECTED',
      job_name: null,
      notification_kind: 'OPENED',
      status: 'OPEN',
      observed_at: 2_000,
      incident_version: 1,
      count_value: 5,
    };
    expect(parseScheduledOperationalAlertNotificationDto(notification)).toEqual(notification);
    expect(() =>
      parseScheduledOperationalAlertNotificationDto({ ...notification, error: 'token=secret' }),
    ).toThrow();
    expect(() =>
      parseScheduledOperationalAlertNotificationDto({ ...notification, category: 'user-123' }),
    ).toThrow();
  });

  it('projects alert state with UTC truth and the Beijing display convention', () => {
    const alert = {
      signal_type: 'login_anomaly',
      category: 'auth',
      severity: 'CRITICAL',
      summary_code: 'LOGIN_ANOMALY_DETECTED',
      job_name: null,
      status: 'OPEN',
      first_seen_at: 1000,
      last_seen_at: 2000,
      consecutive_breach_count: 5,
      consecutive_healthy_count: 0,
      window_count_value: 5,
      threshold_count: 5,
      threshold_window_ms: 600000,
      recovery_count: 2,
      opened_at: 2000,
      acknowledged_at: null,
      resolved_at: null,
      cooldown_until: 1802000,
      suppressed_until: null,
      last_notification_at: 2000,
      incident_version: 1,
      updated_at: 2000,
      time_basis: 'UTC_MS',
      display_timezone: 'Asia/Shanghai',
    };
    expect(parseScheduledOperationalAlertDto(alert)).toEqual(alert);
    expect(() =>
      parseScheduledOperationalAlertDto({ ...alert, object_key: 'secret/customer.jpg' }),
    ).toThrow();
    expect(() =>
      parseScheduledOperationalAlertDto({ ...alert, display_timezone: 'local' }),
    ).toThrow();
  });

  it('strictly parses one fixed alert acknowledgement command and result', () => {
    const command = {
      signal_type: 'login_anomaly',
      summary_code: 'LOGIN_ANOMALY_DETECTED',
      job_name: null,
      incident_version: 1,
    };
    expect(parseScheduledOperationalAlertAckCommandDto(command)).toEqual(command);
    expect(
      parseScheduledOperationalAlertAckResultDto({
        ...command,
        status: 'ACKNOWLEDGED',
        acknowledged_at: 3000,
      }),
    ).toMatchObject({ status: 'ACKNOWLEDGED' });
    expect(() =>
      parseScheduledOperationalAlertAckCommandDto({ ...command, reason: 'arbitrary' }),
    ).toThrow();
    expect(() =>
      parseScheduledOperationalAlertAckCommandDto({ ...command, incident_version: 0 }),
    ).toThrow();
  });
});
