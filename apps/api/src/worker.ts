import app from './index';
import { isScheduledOperationJobName } from '@ygb/contracts';
import { configuredAlertSink, type AppBindings } from './app';
import { runScheduledOperations } from './scheduled-operations';
import { hashCanonicalJson } from '@ygb/domain';
import { evaluatePersistedScheduledJobSignals } from './scheduled-operations/signals';
import { driveArchiveRuntime } from './cold-image-archive/runtime';
import { feishuWorkbenchRuntime } from './feishu-workbench';

const SCHEDULED_HANDLER_TIME_BUDGET_MS=25_000;

export default {
  fetch: app.fetch,
  async scheduled(event: {scheduledTime?:number}, env: AppBindings, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    if (env.SCHEDULED_OPERATIONS_ENABLED !== 'true') return;
    const disabledJobs = (env.SCHEDULED_OPERATIONS_DISABLED_JOBS ?? '').split(',').map((name: string) => name.trim()).filter(isScheduledOperationJobName);
    const now=Number.isSafeInteger(event.scheduledTime) && Number(event.scheduledTime)>=0 ? Number(event.scheduledTime) : Date.now();
    ctx.waitUntil((async()=>{
      const startedAt=Date.now();
      const deadlineReached=()=>Date.now()-startedAt>=SCHEDULED_HANDLER_TIME_BUDGET_MS;
      const drive=driveArchiveRuntime(env);
      const feishu=feishuWorkbenchRuntime(env);
      await runScheduledOperations(env.DB, { enabled: true, disabledJobs, storage: env.FILE_OBJECT_STORAGE ?? null, outboxAdapter: env.OUTBOX_DELIVERY_ADAPTER ?? null,feishuAdapter:feishu.adapter,feishuWebOrigin:feishu.webOrigin,driveAdapter:drive.adapter,driveArchiveEnabled:drive.enabled,driveArchiveCopyEnabled:drive.copyEnabled,driveArchiveProxyReadEnabled:drive.proxyReadEnabled,driveArchiveR2DeleteEnabled:drive.r2DeleteEnabled,now,deadlineReached });
      const evaluationId=await hashCanonicalJson({kind:'SCHEDULED_OPERATIONS_EVALUATION',scheduled_time:now});
      const sink=configuredAlertSink(env);
      await evaluatePersistedScheduledJobSignals(env.DB,{evaluationId,now,...(sink?{sink}:{})});
    })());
  },
};
