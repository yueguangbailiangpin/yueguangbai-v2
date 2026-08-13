import app from './index';
import type { ExecutionContext } from 'hono';
import { isScheduledOperationJobName, type ScheduledOperationJobName } from '@ygb/contracts';
import { configuredAlertSink } from './app';
import { runScheduledOperations } from './scheduled-operations';
import { reconcileUnlinkedFileRetention } from './files/retention';
import { hashCanonicalJson } from '@ygb/domain';
import { evaluatePersistedScheduledJobSignals } from './scheduled-operations/signals';
import { driveArchiveRuntime } from './cold-image-archive/runtime';
import { runAcquisitionMaintenance } from './acquisition/maintenance';
import {
  isAllowedSameOriginApiRequest,
  isApiRequestPath,
  resolveCloudflareRuntime,
  withReleaseSecurityHeaders,
  type CloudflareWorkerBindings,
} from './cloudflare-runtime';

const SCHEDULED_HANDLER_TIME_BUDGET_MS=25_000;

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
        return withReleaseSecurityHeaders(
          releaseFailure(pathname, 403), pathname, true,
        );
      }
      return withReleaseSecurityHeaders(
        await app.fetch(request, runtime.appBindings, ctx), pathname, true,
      );
    }
    return withReleaseSecurityHeaders(
      await runtime.assets!.fetch(request), pathname, true,
    );
  },
  async scheduled(event: {scheduledTime?:number}, env: CloudflareWorkerBindings, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    const runtime=await resolveCloudflareRuntime(env);
    if(!runtime)return;
    const bindings=runtime.appBindings;
    if (bindings.SCHEDULED_OPERATIONS_ENABLED !== 'true') return;
    const disabledJobs: ScheduledOperationJobName[] = (bindings.SCHEDULED_OPERATIONS_DISABLED_JOBS ?? '').split(',').map((name: string) => name.trim()).filter(isScheduledOperationJobName);
    const now=Number.isSafeInteger(event.scheduledTime) && Number(event.scheduledTime)>=0 ? Number(event.scheduledTime) : Date.now();
    ctx.waitUntil((async()=>{
      const startedAt=Date.now();
      const deadlineReached=()=>Date.now()-startedAt>=SCHEDULED_HANDLER_TIME_BUDGET_MS;
      const drive=driveArchiveRuntime(bindings);
      const sink=configuredAlertSink(bindings);
      const runs=await runScheduledOperations(bindings.DB, { enabled: true, disabledJobs, storage: bindings.FILE_OBJECT_STORAGE ?? null, outboxAdapter: bindings.OUTBOX_DELIVERY_ADAPTER ?? null,driveAdapter:drive.adapter,driveArchiveEnabled:drive.enabled,driveArchiveCopyEnabled:drive.copyEnabled,driveArchiveProxyReadEnabled:drive.proxyReadEnabled,driveArchiveR2DeleteEnabled:drive.r2DeleteEnabled,now,deadlineReached });
      const fileJob=runs.find((run)=>run.job_name==='file_orphan_cleanup');
      if(fileJob&&fileJob.outcome!=='DISABLED'&&bindings.FILE_OBJECT_STORAGE&&!deadlineReached()){
        try{
          const retention=await reconcileUnlinkedFileRetention(bindings.DB,bindings.FILE_OBJECT_STORAGE,{now,limit:25,deadlineReached});
          const combinedBacklog=fileJob.backlog_count+retention.backlog;
          const retentionFailed=retention.deferred>0;
          await bindings.DB.prepare(`UPDATE scheduled_job_states
            SET last_backlog_count=?,
              last_failed_at=CASE WHEN ?=1 THEN ? ELSE last_failed_at END,
              last_failure_category=CASE WHEN ?=1 THEN 'file_retention_deferred' ELSE last_failure_category END,
              updated_at=MAX(?,updated_at)
            WHERE job_name='file_orphan_cleanup'`).bind(combinedBacklog,retentionFailed?1:0,now,retentionFailed?1:0,now).run();
        }catch(error){
          await bindings.DB.prepare(`UPDATE scheduled_job_states SET last_failed_at=?,last_failure_category='file_retention_failed',updated_at=MAX(?,updated_at) WHERE job_name='file_orphan_cleanup'`).bind(now,now).run().catch(()=>undefined);
          throw error;
        }
      }
      if (bindings.ACQUISITION_MAINTENANCE_ENABLED === 'true') {
        await runAcquisitionMaintenance(bindings.DB, {
          identitySecret: String(bindings.CUSTOMER_SECURITY_TOKEN_SECRET ?? ''),
          now,
        });
      }
      const evaluationId=await hashCanonicalJson({kind:'SCHEDULED_OPERATIONS_EVALUATION',scheduled_time:now});
      await evaluatePersistedScheduledJobSignals(bindings.DB,{evaluationId,now,disabledJobs,...(sink?{sink}:{})});
    })());
  },
};

function releaseFailure(pathname: string, status: 403 | 503): Response {
  const requestId = crypto.randomUUID();
  const response = Response.json({
    error: {
      code: status === 403 ? 'FORBIDDEN' : 'DEPENDENCY_UNAVAILABLE',
      message: status === 403 ? '请求被拒绝' : '服务暂时不可用，请稍后重试',
      details: null,
    },
    meta: { request_id: requestId },
  }, { status, headers: { 'Cache-Control': 'no-store' } });
  return withReleaseSecurityHeaders(response, pathname, status === 503);
}
