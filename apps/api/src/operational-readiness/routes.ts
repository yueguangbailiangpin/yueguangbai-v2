import { apiSuccess, type ObjectStorageAdapter, type SqlDatabase } from '@ygb/contracts';
import type { Hono } from 'hono';
import {
  safeResolveOperationalAlertSink,
  type OperationalAlertSink,
} from '../scheduled-operations/signals';
import { operationalAlertAttestationReady } from './alert-attestation';
import type { AppBindings } from '../app';
import { exactCloudflareAccessTeamOrigin, parseExactGitCommitSha } from '@ygb/domain';

const TARGET_SCHEMA = 42;
const MAX_JOB_STALENESS_MS = 6 * 60 * 60 * 1000;
const MAX_JOB_BACKLOG = 1000;
const REQUIRED_JOBS = [
  'reservation_expiry',
  'instruction_expiry',
  'file_orphan_cleanup',
] as const;
const REQUIRED_SCHEDULER_JOBS = [
  'reservation_expiry',
  'instruction_expiry',
  'file_orphan_cleanup',
] as const;
const OBJECT_STORAGE_READINESS_PROBE_KEY = '__ygb_readiness__/binding-probe';
type CheckStatus = 'ok' | 'failed' | 'not_required';

export function registerOperationalReadinessRoutes(app: Hono<any>): void {
  app.get('/ready', async (context) => {
    const now = Date.now();
    const result = await evaluateReadiness(
      context.env.DB,
      context.env.FILE_OBJECT_STORAGE ?? null,
      context.env,
      now,
    ).catch(() => failedReadiness());
    context.header('Cache-Control', 'no-store');
    return context.json(
      apiSuccess(
        {
          status: result.ready ? ('ready' as const) : ('not_ready' as const),
          checks: result.checks,
          timestamp: now,
        },
        String(context.get('requestId') ?? crypto.randomUUID()),
      ),
      result.ready ? 200 : 503,
    );
  });
}

async function evaluateReadiness(
  database: SqlDatabase,
  storage: ObjectStorageAdapter | null,
  bindings: AppBindings,
  now: number,
) {
  const schemaRow = await database
    .prepare(`SELECT schema_version FROM app_schema_state WHERE singleton_id=1`)
    .first<{ schema_version: number }>();
  const schema = Number(schemaRow?.schema_version) === TARGET_SCHEMA;
  const jobs = await database
    .prepare(
      `SELECT job_name,last_succeeded_at,last_failed_at,last_backlog_count FROM scheduled_job_states WHERE job_name IN (${REQUIRED_JOBS.map(() => '?').join(',')})`,
    )
    .bind(...REQUIRED_JOBS)
    .all<{
      job_name: string;
      last_succeeded_at: number | null;
      last_failed_at: number | null;
      last_backlog_count: number | null;
    }>();
  const byName = new Map(jobs.results.map((row) => [row.job_name, row]));
  const schedulerEnabled = bindings['SCHEDULED_OPERATIONS_ENABLED'] === 'true';
  const jobHealthy = (name: string) => {
    const row = byName.get(name);
    if (!row || row.last_succeeded_at === null) return false;
    const succeeded = Number(row.last_succeeded_at),
      failed = row.last_failed_at === null ? null : Number(row.last_failed_at),
      backlog = row.last_backlog_count === null ? 0 : Number(row.last_backlog_count);
    return (
      now - succeeded <= MAX_JOB_STALENESS_MS &&
      (failed === null || succeeded >= failed) &&
      Number.isSafeInteger(backlog) &&
      backlog >= 0 &&
      backlog <= MAX_JOB_BACKLOG
    );
  };
  const schedulerHealthy = schedulerEnabled && REQUIRED_SCHEDULER_JOBS.every(jobHealthy);
  const operationalAlertsHealthy = await operationalAlertsReady(database, bindings, now);
  const objectStorageHealthy = await storageReady(database, storage);
  const runningRelease = parseExactGitCommitSha(bindings.APP_RELEASE_SHA);
  const release = runningRelease !== null;
  const recoveryRow = await database
    .prepare(
      `SELECT release_sha,schema_version FROM production_recovery_attestations WHERE schema_version=? ORDER BY verified_at DESC,id DESC LIMIT 1`,
    )
    .bind(TARGET_SCHEMA)
    .first<{ release_sha: string; schema_version: number }>();
  const recoveryHealthy =
    release &&
    Number(recoveryRow?.schema_version ?? 0) === TARGET_SCHEMA &&
    String(recoveryRow?.release_sha ?? '').toLowerCase() === runningRelease;
  const staffAccessHealthy = validAccessConfig(
    bindings['STAFF_ACCESS_TEAM_DOMAIN'],
    bindings['STAFF_ACCESS_AUD'],
  );
  const environment = bindings.APP_ENVIRONMENT;
  if (environment === 'production') {
    const checks = {
      schema: status(schema),
      scheduler: status(schedulerHealthy),
      operational_alerts: status(operationalAlertsHealthy),
      object_storage: status(objectStorageHealthy),
      recovery: status(recoveryHealthy),
      staff_access: status(staffAccessHealthy),
      release: status(release),
    };
    return {
      ready: Object.values(checks).every((value) => value === 'ok' || value === 'not_required'),
      checks,
    };
  }
  if (environment === 'staging') {
    const scheduler =
      bindings['SCHEDULED_OPERATIONS_ENABLED'] === 'false'
        ? ('not_required' as const)
        : ('failed' as const);
    const operational_alerts = operationalAlertsHealthy
      ? ('not_required' as const)
      : ('failed' as const);
    const checks = {
      schema: status(schema),
      scheduler,
      operational_alerts,
      object_storage: status(objectStorageHealthy),
      recovery: 'not_required' as const,
      staff_access: status(staffAccessHealthy),
      release: status(release),
    };
    return {
      ready:
        checks.schema === 'ok' &&
        checks.scheduler === 'not_required' &&
          checks.operational_alerts === 'not_required' &&
        checks.object_storage === 'ok' &&
        checks.recovery === 'not_required' &&
        checks.staff_access === 'ok' &&
        checks.release === 'ok',
      checks,
    };
  }
  if (environment === 'local') {
    const checks = {
      schema: status(schema),
      scheduler: status(schedulerHealthy),
      operational_alerts: status(operationalAlertsHealthy),
      object_storage: status(objectStorageHealthy),
      recovery: status(recoveryHealthy),
      staff_access: status(staffAccessHealthy),
      release: status(release),
    };
    return {
      ready: Object.values(checks).every((value) => value === 'ok' || value === 'not_required'),
      checks,
    };
  }
  return failedReadiness();
}

function status(value: boolean): CheckStatus {
  return value ? 'ok' : 'failed';
}
function failedReadiness() {
  return {
    ready: false,
    checks: {
      schema: 'failed',
      scheduler: 'failed',
      operational_alerts: 'failed',
      object_storage: 'failed',
      recovery: 'failed',
      staff_access: 'failed',
      release: 'failed',
    } as const,
  };
}

async function operationalAlertsReady(
  database: SqlDatabase,
  bindings: AppBindings,
  now: number,
): Promise<boolean> {
  const environment = bindings.APP_ENVIRONMENT;
  const mode = bindings.OPERATIONAL_ALERT_MODE;
  const injected = bindings.OPERATIONAL_ALERT_SINK;
  const sink = safeResolveOperationalAlertSink({
    ...(typeof mode === 'string' ? { mode } : {}),
    ...(injected && typeof injected === 'object' && 'notify' in injected && mode === 'bound'
      ? { boundSink: injected as OperationalAlertSink }
      : {}),
    ...(injected && typeof injected === 'object' && 'notify' in injected && mode !== 'bound'
      ? { localSink: injected as OperationalAlertSink }
      : {}),
  });
  if (environment === 'production')
    return await operationalAlertAttestationReady(database, bindings, now);
  if (environment === 'local')
    return (mode === 'disabled' && injected === undefined) || (mode === 'local' && sink !== null);
  if (environment === 'staging') return mode === 'disabled' && injected === undefined;
  return false;
}

async function storageReady(
  database: SqlDatabase,
  storage: ObjectStorageAdapter | null,
): Promise<boolean> {
  if (!storage) return false;
  const row = await database
    .prepare(
      `SELECT object_key,uploaded_byte_size,uploaded_sha256 FROM file_objects WHERE status='VERIFIED' AND uploaded_byte_size IS NOT NULL AND uploaded_sha256 IS NOT NULL ORDER BY rowid DESC LIMIT 1`,
    )
    .first<{ object_key: string; uploaded_byte_size: number; uploaded_sha256: string }>();
  if (!row) {
    try {
      await storage.headObject(OBJECT_STORAGE_READINESS_PROBE_KEY);
      return true;
    } catch {
      return false;
    }
  }
  const head = await storage.headObject(row.object_key).catch(() => null);
  return Boolean(
    head &&
      head.byteSize === Number(row.uploaded_byte_size) &&
      head.checksumSha256 === row.uploaded_sha256,
  );
}
function validAccessConfig(domain: unknown, aud: unknown): boolean {
  if (
    typeof domain !== 'string' ||
    typeof aud !== 'string' ||
    aud.trim().length < 8 ||
    aud.startsWith('REQUIRED_')
  )
    return false;
  return exactCloudflareAccessTeamOrigin(domain) !== null;
}
