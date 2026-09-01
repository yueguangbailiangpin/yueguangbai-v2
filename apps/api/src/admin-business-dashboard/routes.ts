import {
  apiFailure,
  apiSuccess,
  isDashboardWindow,
  type ApiErrorCode,
} from '@ygb/contracts';
import type { Context, Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import { assertExactQueryParameters } from '../internal-finance/filters';
import {
  InternalFinanceError,
  requireFinancialActor,
  validation,
} from '../internal-finance/shared';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { readAdminBusinessDashboardSummary } from './read-model';

export function registerAdminBusinessDashboardRoutes(app: Hono<any>): void {
  app.get('/api/staff/admin-business-dashboard/summary', withErrors(summary));
}
async function summary(context: Context<any>): Promise<Response> {
  requireActor(context);
  const url = new URL(context.req.url);
  assertExactQueryParameters(url, ['window']);
  const window = url.searchParams.get('window') ?? 'TODAY';
  if (!isDashboardWindow(window)) validation();
  return success(context, {
    summary: await readAdminBusinessDashboardSummary(context.env.DB, window),
  });
}
function requireActor(context: Context<any>): AssignmentStaffAuthorization {
  return requireFinancialActor(
    context.get('staffAuthorization') as AssignmentStaffAuthorization | null | undefined,
  );
}
function withErrors(handler: (context: Context<any>) => Promise<Response>) {
  return async (context: Context<any>) => {
    try {
      return await handler(context);
    } catch (error) {
      const normalized = normalizeError(error);
      return context.json(
        apiFailure(normalized.code, publicMessage(normalized.code), requestIdFromContext(context)),
        normalized.status,
      );
    }
  };
}
function normalizeError(error: unknown): InternalFinanceError {
  if (error instanceof InternalFinanceError) return error;
  if (
    error instanceof Error &&
    (error.message.startsWith('invalid_dashboard_') ||
      error.message === 'invalid_business_date' ||
      error.message === 'invalid_financial_projection_amount')
  )
    return new InternalFinanceError('VALIDATION_ERROR', 400);
  return new InternalFinanceError('DEPENDENCY_UNAVAILABLE', 503);
}
function publicMessage(code: ApiErrorCode): string {
  if (code === 'UNAUTHENTICATED') return '员工会话无效';
  if (code === 'FORBIDDEN') return '仅总管理员可查看经营看板';
  if (code === 'VALIDATION_ERROR') return '看板请求参数不正确';
  return '经营看板暂时不可用';
}
function success(context: Context<any>, data: unknown): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(data, requestIdFromContext(context)));
}
