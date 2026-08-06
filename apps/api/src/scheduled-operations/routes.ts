import { apiFailure, apiSuccess } from '@ygb/contracts';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../app';
import { requirePermission } from '../staff-assignment/permission-policy';
import { SCHEDULED_JOB_NAMES, runScheduledOperations, type ScheduledJobName } from './runner';

export function registerScheduledOperationRoutes(app: Hono<AppEnv>): void {
  app.get('/api/staff/operations/health', health);
  app.post('/api/staff/operations/jobs/:job/retry', retry);
}
async function health(context: Context<AppEnv>): Promise<Response> {
  const actor = context.get('staffAuthorization');
  if (!actor) return forbidden(context);
  requirePermission(actor, 'AUDIT_VIEW');
  const rows = await context.env.DB.prepare(`SELECT job_name,last_started_at,last_succeeded_at,last_failed_at,last_failure_category,last_backlog_count,lease_expires_at FROM scheduled_job_states ORDER BY job_name`).all<Record<string, unknown>>();
  return context.json(apiSuccess({ jobs: rows.results }, context.get('requestId')));
}
async function retry(context: Context<AppEnv>): Promise<Response> {
  const actor = context.get('staffAuthorization');
  if (!actor) return forbidden(context);
  requirePermission(actor, 'AUDIT_VIEW');
  const job = context.req.param('job') ?? '';
  if (!(SCHEDULED_JOB_NAMES as readonly string[]).includes(job)) return context.json(apiFailure('VALIDATION_ERROR','任务不存在',context.get('requestId')),400);
  const result = await runScheduledOperations(context.env.DB, { only: job as ScheduledJobName, trigger: 'MANUAL', storage: (context.env.FILE_OBJECT_STORAGE ?? null) as any, outboxAdapter: (context.env.OUTBOX_DELIVERY_ADAPTER ?? null) as any });
  return context.json(apiSuccess({ run: result[0] }, context.get('requestId')));
}
function forbidden(context: Context<AppEnv>): Response { return context.json(apiFailure('FORBIDDEN','无权执行此操作',context.get('requestId')),403); }
