import app from './index';
import type { AppBindings } from './app';
import { runScheduledOperations, type OutboxDeliveryAdapter } from './scheduled-operations';

export default {
  fetch: app.fetch,
  async scheduled(_event: unknown, env: AppBindings & { SCHEDULED_OPERATIONS_ENABLED?: string; SCHEDULED_OPERATIONS_DISABLED_JOBS?: string; OUTBOX_DELIVERY_ADAPTER?: OutboxDeliveryAdapter }, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    if (env.SCHEDULED_OPERATIONS_ENABLED !== 'true') return;
    const disabledJobs = (env.SCHEDULED_OPERATIONS_DISABLED_JOBS ?? '').split(',').map((name: string) => name.trim()).filter(Boolean);
    ctx.waitUntil(runScheduledOperations(env.DB, { enabled: true, disabledJobs, storage: (env.FILE_OBJECT_STORAGE ?? null) as any, outboxAdapter: env.OUTBOX_DELIVERY_ADAPTER ?? null }).then(() => undefined));
  },
};
