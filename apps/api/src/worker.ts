import app from './index';
import type { ExecutionContext } from 'hono';
import { isScheduledOperationJobName, type ScheduledOperationJobName } from '@ygb/contracts';
import { configuredAlertSink } from './app';
import { runScheduledOperations } from './scheduled-operations';
import { reconcileUnlinkedFileRetention } from './files/retention';
import { hashCanonicalJson } from '@ygb/domain';
import { evaluatePersistedScheduledJobSignals } from './scheduled-operations/signals';
import { archiveRuntime } from './cold-image-archive/runtime';
import { processArchiveQueueMessage } from './cold-image-archive/queue-consumer';
import {
  isAllowedSameOriginApiRequest,
  isApiRequestPath,
  resolveCloudflareRuntime,
  withReleaseSecurityHeaders,
  type CloudflareWorkerBindings,
} from './cloudflare-runtime';

const SCHEDULED_HANDLER_TIME_BUDGET_MS = 25_000;

export default {
  async fetch(
    request: Request,
    env: CloudflareWorkerBindings,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const runtime = await resolveCloudflareRuntime(env);
    const pathname = new URL(request.url).pathname;
    if (!runtime) return releaseFailure(pathname, 503);
    if (runtime.environment === 'local') {
      return app.fetch(request, runtime.appBindings, ctx);
    }
    if (isApiRequestPath(pathname)) {
      if (!isAllowedSameOriginApiRequest(request, runtime.appOrigin!)) {
        return withReleaseSecurityHeaders(releaseFailure(pathname, 403), pathname, true);
      }
      return withReleaseSecurityHeaders(
        await app.fetch(request, runtime.appBindings, ctx),
        pathname,
        true,
      );
    }
    return withReleaseSecurityHeaders(await runtime.assets!.fetch(request), pathname, true);
  },
  async scheduled(
    event: { scheduledTime?: number },
    env: CloudflareWorkerBindings,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void> {
    const runtime = await resolveCloudflareRuntime(env);
    if (!runtime) return;
    const bindings = runtime.appBindings;
    if (bindings.SCHEDULED_OPERATIONS_ENABLED !== 'true') return;
    const disabledJobs: ScheduledOperationJobName[] = (
      bindings.SCHEDULED_OPERATIONS_DISABLED_JOBS ?? ''
    )
      .split(',')
      .map((name: string) => name.trim())
      .filter(isScheduledOperationJobName);
    const now =
      Number.isSafeInteger(event.scheduledTime) && Number(event.scheduledTime) >= 0
        ? Number(event.scheduledTime)
        : Date.now();
    ctx.waitUntil(
      (async () => {
        const startedAt = Date.now();
        const deadlineReached = () => Date.now() - startedAt >= SCHEDULED_HANDLER_TIME_BUDGET_MS;
        const archive = archiveRuntime(bindings);
        const sink = configuredAlertSink(bindings);
        const runs = await runScheduledOperations(bindings.DB, {
          enabled: true,
          disabledJobs,
          storage: bindings.FILE_OBJECT_STORAGE ?? null,
          archive: {
            client: archive.client,
            queue: archive.queue,
            selectorEnabled: archive.selectorEnabled,
            driveUploadEnabled: archive.driveUploadEnabled,
            hotDeleteEnabled: archive.hotDeleteEnabled,
            restoreWorkerEnabled: archive.restoreWorkerEnabled,
          },
          now,
          deadlineReached,
        });
        const fileJob = runs.find((run) => run.job_name === 'file_orphan_cleanup');
        if (
          fileJob &&
          fileJob.outcome !== 'DISABLED' &&
          bindings.FILE_OBJECT_STORAGE &&
          !deadlineReached()
        ) {
          try {
            const retention = await reconcileUnlinkedFileRetention(
              bindings.DB,
              bindings.FILE_OBJECT_STORAGE,
              { now, limit: 25, deadlineReached },
            );
            const combinedBacklog = fileJob.backlog_count + retention.backlog;
            const retentionFailed = retention.deferred > 0;
            await bindings.DB.prepare(
              `UPDATE scheduled_job_states
            SET last_backlog_count=?,
              last_failed_at=CASE WHEN ?=1 THEN ? ELSE last_failed_at END,
              last_failure_category=CASE WHEN ?=1 THEN 'file_retention_deferred' ELSE last_failure_category END,
              updated_at=MAX(?,updated_at)
            WHERE job_name='file_orphan_cleanup'`,
            )
              .bind(combinedBacklog, retentionFailed ? 1 : 0, now, retentionFailed ? 1 : 0, now)
              .run();
          } catch (error) {
            await bindings.DB.prepare(
              `UPDATE scheduled_job_states SET last_failed_at=?,last_failure_category='file_retention_failed',updated_at=MAX(?,updated_at) WHERE job_name='file_orphan_cleanup'`,
            )
              .bind(now, now)
              .run()
              .catch(() => undefined);
            throw error;
          }
        }
        const evaluationId = await hashCanonicalJson({
          kind: 'SCHEDULED_OPERATIONS_EVALUATION',
          scheduled_time: now,
        });
        await evaluatePersistedScheduledJobSignals(bindings.DB, {
          evaluationId,
          now,
          disabledJobs,
          ...(sink ? { sink } : {}),
        });
      })(),
    );
  },
  /**
   * Cloudflare Queues push consumer (template wiring lives commented in
   * wrangler.example.jsonc; no real queue exists in this stage). Per-message
   * ack/retry with exponential backoff + jitter; the D1 archive_jobs lease
   * makes duplicate delivery a no-op. No floating promises: every message is
   * resolved before the handler returns.
   */
  async queue(
    batch: {
      queue: string;
      messages: readonly {
        id: string;
        body: unknown;
        attempts: number;
        ack(): void;
        retry(options?: { delaySeconds?: number }): void;
      }[];
    },
    env: CloudflareWorkerBindings,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const runtime = await resolveCloudflareRuntime(env);
    if (!runtime) {
      batch.messages.forEach((message) => message.retry());
      return;
    }
    const bindings = runtime.appBindings;
    const archive = archiveRuntime(bindings);
    const storage = bindings.FILE_OBJECT_STORAGE ?? null;
    const client = archive.client;
    if (!storage || !client) {
      batch.messages.forEach((message) => message.retry());
      return;
    }
    const now = Date.now();
    const controls = await bindings.DB
      .prepare(
        `SELECT drive_upload_enabled,hot_delete_enabled,restore_worker_enabled,shadow_copy_only
       FROM archive_runtime_controls WHERE singleton_id=1`,
      )
      .first<{
        drive_upload_enabled: number; hot_delete_enabled: number;
        restore_worker_enabled: number; shadow_copy_only: number;
      }>()
      .catch(() => null);
    for (const message of batch.messages) {
      const disposition = await processArchiveQueueMessage(
        bindings.DB,
        message.body,
        { now, queueMessageId: message.id },
        { storage, drive: client },
        {
          driveUploadEnabled: archive.driveUploadEnabled && controls?.drive_upload_enabled === 1,
          hotDeleteEnabled: archive.hotDeleteEnabled && controls?.hot_delete_enabled === 1,
          shadowCopyOnly: controls?.shadow_copy_only === 1,
          restoreWorkerEnabled: archive.restoreWorkerEnabled && controls?.restore_worker_enabled === 1,
        },
      ).catch(() => null);
      if (!disposition) {
        message.retry({ delaySeconds: 60 });
        continue;
      }
      if (disposition.action === 'RETRY') {
        message.retry(disposition.delaySeconds === undefined ? undefined : { delaySeconds: disposition.delaySeconds });
      } else {
        message.ack();
      }
    }
  },
};

function releaseFailure(pathname: string, status: 403 | 503): Response {
  const requestId = crypto.randomUUID();
  const response = Response.json(
    {
      error: {
        code: status === 403 ? 'FORBIDDEN' : 'DEPENDENCY_UNAVAILABLE',
        message: status === 403 ? '请求被拒绝' : '服务暂时不可用，请稍后重试',
        details: null,
      },
      meta: { request_id: requestId },
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
  return withReleaseSecurityHeaders(response, pathname, status === 503);
}
