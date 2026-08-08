import {
  apiFailure,
  apiSuccess,
  isDashboardDrillDownMetric,
  isDashboardGranularity,
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
import {
  readAdminBusinessDashboardDrillDown,
  readAdminBusinessDashboardSummary,
  readAdminBusinessDashboardTrend,
} from './read-model';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export function registerAdminBusinessDashboardRoutes(app: Hono<any>): void {
  app.get('/api/staff/admin-business-dashboard/summary', withErrors(summary));
  app.get('/api/staff/admin-business-dashboard/trends', withErrors(trends));
  app.get('/api/staff/admin-business-dashboard/drill-down', withErrors(drillDown));
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

async function trends(context: Context<any>): Promise<Response> {
  requireActor(context);
  const url = new URL(context.req.url);
  assertExactQueryParameters(url, ['from_date', 'to_date', 'granularity']);
  const fromDate = url.searchParams.get('from_date');
  const toDate = url.searchParams.get('to_date');
  const granularity = url.searchParams.get('granularity');
  if (fromDate === null || toDate === null || !isDashboardGranularity(granularity)) {
    validation();
  }
  return success(context, {
    trend: await readAdminBusinessDashboardTrend(context.env.DB, {
      fromDate,
      toDate,
      granularity,
    }),
  });
}

async function drillDown(context: Context<any>): Promise<Response> {
  requireActor(context);
  const url = new URL(context.req.url);
  assertExactQueryParameters(url, [
    'metric', 'from_date', 'to_date', 'limit', 'cursor',
  ]);
  const metric = url.searchParams.get('metric');
  const fromDate = url.searchParams.get('from_date');
  const toDate = url.searchParams.get('to_date');
  if (!isDashboardDrillDownMetric(metric) || fromDate === null || toDate === null) {
    validation();
  }
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) validation();
  const cursor = url.searchParams.get('cursor');
  if (cursor !== null && (cursor.length < 1 || cursor.length > 1000)) validation();
  return success(context, {
    drill_down: await readAdminBusinessDashboardDrillDown(context.env.DB, {
      metric,
      fromDate,
      toDate,
      limit,
      cursor,
    }),
  });
}

function requireActor(context: Context<any>): AssignmentStaffAuthorization {
  return requireFinancialActor(
    context.get('staffAuthorization') as AssignmentStaffAuthorization | null | undefined,
  );
}

function withErrors(handler: (context: Context<any>) => Promise<Response>) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      const normalized = normalizeError(error);
      return context.json(apiFailure(
        normalized.code,
        publicMessage(normalized.code),
        requestIdFromContext(context),
      ), normalized.status);
    }
  };
}

function normalizeError(error: unknown): InternalFinanceError {
  if (error instanceof InternalFinanceError) return error;
  if (error instanceof Error
    && (error.message.startsWith('invalid_dashboard_')
      || error.message === 'invalid_business_date')) {
    return new InternalFinanceError('VALIDATION_ERROR', 400);
  }
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
