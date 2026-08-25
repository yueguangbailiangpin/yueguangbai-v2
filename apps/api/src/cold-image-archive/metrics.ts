import type { ArchiveMetricsDto, SqlDatabase } from '@ygb/contracts';

/**
 * No-PII archive metrics (stage 5.7): pure D1 aggregates over the bundle,
 * job and restore tables. Safe for the staff metrics endpoint and for signal
 * ingestion; counts and bytes only.
 */
export async function computeArchiveMetrics(
  database: SqlDatabase,
  input: { now: number },
): Promise<ArchiveMetricsDto> {
  const backlog = await database
    .prepare(
      `SELECT COUNT(*) AS bundles,
       COALESCE(SUM(bundle.manifest_file_count),0) AS files,
       COALESCE(SUM(bundle.manifest_total_bytes),0) AS bytes,
       MIN(bundle.eligibility_at) AS oldest_eligibility
     FROM archive_bundles bundle
     WHERE bundle.is_current=1 AND bundle.state='ONLINE'
       AND bundle.eligibility_at<=?`,
    )
    .bind(input.now)
    .first<{ bundles: number; files: number; bytes: number; oldest_eligibility: number | null }>();
  const jobs = await database
    .prepare(
      `SELECT
       SUM(CASE WHEN state='PENDING' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN state='LEASED' THEN 1 ELSE 0 END) AS processing,
       SUM(CASE WHEN state='FAILED_RETRYABLE' THEN 1 ELSE 0 END) AS retry_scheduled,
       SUM(CASE WHEN state='FAILED_RETRYABLE' AND next_retry_at>? THEN 1 ELSE 0 END) AS failed_waiting
     FROM archive_jobs`,
    )
    .bind(input.now)
    .first<{ pending: number | null; processing: number | null; retry_scheduled: number | null; failed_waiting: number | null }>();
  const dead = await database
    .prepare(`SELECT COUNT(*) AS dead FROM archive_jobs WHERE state='DEAD_LETTERED'`)
    .first<{ dead: number }>();
  const archiveTotals = await database
    .prepare(
      `SELECT
       SUM(CASE WHEN job_type='ARCHIVE_BUNDLE' AND state='SUCCEEDED' THEN 1 ELSE 0 END) AS archive_ok,
       SUM(CASE WHEN job_type='ARCHIVE_BUNDLE' AND state='DEAD_LETTERED' THEN 1 ELSE 0 END) AS archive_dead,
       SUM(CASE WHEN job_type='RESTORE_BUNDLE' AND state='SUCCEEDED' THEN 1 ELSE 0 END) AS restore_ok,
       SUM(CASE WHEN job_type='RESTORE_BUNDLE' AND state='DEAD_LETTERED' THEN 1 ELSE 0 END) AS restore_dead,
       MAX(CASE WHEN state='SUCCEEDED' THEN finished_at ELSE NULL END) AS last_success
     FROM archive_jobs`,
    )
    .first<{
      archive_ok: number | null; archive_dead: number | null;
      restore_ok: number | null; restore_dead: number | null;
      last_success: number | null;
    }>();
  const restores = await database
    .prepare(
      `SELECT
       SUM(CASE WHEN state='COMPLETED' AND restore_expires_at>? THEN 1 ELSE 0 END) AS active_temp,
       SUM(CASE WHEN state='COMPLETED' AND restore_expires_at<=? THEN 1 ELSE 0 END) AS cleanup_backlog
     FROM archive_restores`,
    )
    .bind(input.now, input.now)
    .first<{ active_temp: number | null; cleanup_backlog: number | null }>();
  const shadow = await database
    .prepare(
      `SELECT COALESCE(SUM(bundle.manifest_file_count),0) AS files,
       COALESCE(SUM(bundle.manifest_total_bytes),0) AS bytes
     FROM archive_bundles bundle WHERE bundle.shadow_completed_at IS NOT NULL`,
    )
    .first<{ files: number; bytes: number }>();
  return {
    generated_at: input.now,
    eligible_backlog_bundles: Number(backlog?.bundles ?? 0),
    eligible_backlog_files: Number(backlog?.files ?? 0),
    eligible_backlog_bytes: Number(backlog?.bytes ?? 0),
    oldest_eligible_age_ms: backlog?.oldest_eligibility == null
      ? null
      : Math.max(0, input.now - Number(backlog.oldest_eligibility)),
    jobs_pending: Number(jobs?.pending ?? 0),
    jobs_processing: Number(jobs?.processing ?? 0),
    jobs_retry_scheduled: Number(jobs?.retry_scheduled ?? 0),
    jobs_failed: Number(jobs?.failed_waiting ?? 0),
    jobs_dead_lettered: Number(dead?.dead ?? 0),
    archive_succeeded_total: Number(archiveTotals?.archive_ok ?? 0),
    archive_failed_total: Number(archiveTotals?.archive_dead ?? 0),
    restore_succeeded_total: Number(archiveTotals?.restore_ok ?? 0),
    restore_failed_total: Number(archiveTotals?.restore_dead ?? 0),
    last_success_at: archiveTotals?.last_success ?? null,
    temporary_restore_active_count: Number(restores?.active_temp ?? 0),
    cleanup_backlog: Number(restores?.cleanup_backlog ?? 0),
    shadow_copy_projected_files: Number(shadow?.files ?? 0),
    shadow_copy_projected_bytes: Number(shadow?.bytes ?? 0),
  };
}
