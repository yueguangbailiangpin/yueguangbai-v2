import app from './index';
import type { ExecutionContext } from 'hono';
import { isScheduledOperationJobName, type ScheduledOperationJobName } from '@ygb/contracts';
import { configuredAlertSink, type AppBindings } from './app';
import { runScheduledOperations } from './scheduled-operations';
import { hashCanonicalJson } from '@ygb/domain';
import { evaluatePersistedScheduledJobSignals } from './scheduled-operations/signals';
import { driveArchiveRuntime } from './cold-image-archive/runtime';
import { feishuWorkbenchRuntime } from './feishu-workbench';
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
    const runtime = resolveCloudflareRuntime(env);
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
  async scheduled(event: {scheduledTime?:number}, env: AppBindings, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    if (env.SCHEDULED_OPERATIONS_ENABLED !== 'true') return;
    const disabledJobs: ScheduledOperationJobName[] = (env.SCHEDULED_OPERATIONS_DISABLED_JOBS ?? '').split(',').map((name: string) => name.trim()).filter(isScheduledOperationJobName);
    const now=Number.isSafeInteger(event.scheduledTime) && Number(event.scheduledTime)>=0 ? Number(event.scheduledTime) : Date.now();
    ctx.waitUntil((async()=>{
      const startedAt=Date.now();
      const deadlineReached=()=>Date.now()-startedAt>=SCHEDULED_HANDLER_TIME_BUDGET_MS;
      const drive=driveArchiveRuntime(env);
      const feishu=feishuWorkbenchRuntime(env);
      const sink=configuredAlertSink(env);
      await runScheduledOperations(env.DB, { enabled: true, disabledJobs, storage: env.FILE_OBJECT_STORAGE ?? null, outboxAdapter: env.OUTBOX_DELIVERY_ADAPTER ?? null,feishuAdapter:feishu.adapter,feishuWebOrigin:feishu.webOrigin,feishuTenantKey:feishu.tenantKey,driveAdapter:drive.adapter,driveArchiveEnabled:drive.enabled,driveArchiveCopyEnabled:drive.copyEnabled,driveArchiveProxyReadEnabled:drive.proxyReadEnabled,driveArchiveR2DeleteEnabled:drive.r2DeleteEnabled,...(sink?{alertSink:sink}:{}),now,deadlineReached });
      if (env.ACQUISITION_MAINTENANCE_ENABLED === 'true') {
        await runAcquisitionMaintenance(env.DB, {
          identitySecret: String(env.CUSTOMER_SECURITY_TOKEN_SECRET ?? ''),
          now,
        });
      }
      const evaluationId=await hashCanonicalJson({kind:'SCHEDULED_OPERATIONS_EVALUATION',scheduled_time:now});
      const evaluationDisabledJobs: ScheduledOperationJobName[]=feishu.syncEnabled?disabledJobs:[...disabledJobs,'feishu_sync'];
      await evaluatePersistedScheduledJobSignals(env.DB,{evaluationId,now,disabledJobs:evaluationDisabledJobs,...(sink?{sink}:{})});
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
