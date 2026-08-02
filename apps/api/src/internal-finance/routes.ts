import {
  apiFailure,
  apiSuccess,
  isFinanceDateBasis,
  isFinanceGroupBy,
  isFinancialExportType,
  type ApiErrorCode,
} from '@ygb/contracts';
import { FinancialCsvError, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { generateAuditedFinancialCsv } from './exports';
import {
  FINANCE_QUERY_KEYS,
  assertCashFinanceDateBasis,
  assertExactQueryParameters,
  assertFinancialExportDateBasis,
  assertOrderFinanceDateBasis,
  normalizeFinanceFilters,
  normalizeFinanceQuery,
} from './filters';
import { buildFinanceOrderDetail } from './order-detail';
import {
  readFinanceCashFlow,
  readFinanceExceptionPage,
  readFinanceGroups,
  readFinanceOrder,
  readFinanceOrderPage,
  readFinanceSummary,
} from './read-model';
import {
  financeIdentifier,
  InternalFinanceError,
  requireFinancialActor,
  validation,
} from './shared';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const BODY_LIMIT = 32 * 1024;
const FILTER_KEYS = FINANCE_QUERY_KEYS.filter(
  (key) => key !== 'limit' && key !== 'cursor' && key !== 'group_by',
);

export function registerStaffFinanceRoutes(app: Hono<any>): void {
  app.get('/api/staff/finance/summary', withErrors(summary));
  app.get('/api/staff/finance/orders', withErrors(orders));
  app.get('/api/staff/finance/orders/:formalOrderId', withErrors(order));
  app.get('/api/staff/finance/groups', withErrors(groups));
  app.get('/api/staff/finance/cash-flow', withErrors(cashFlow));
  app.get('/api/staff/finance/exceptions', withErrors(exceptions));
  app.post('/api/staff/finance/exports/csv', withErrors(exportCsv));
}

async function summary(context: Context<any>): Promise<Response> {
  requireActor(context);
  const url = new URL(context.req.url);
  assertExactQueryParameters(url, FILTER_KEYS);
  const filters = normalizeFinanceQuery(url);
  assertOrderFinanceDateBasis(filters);
  return success(context, {
    summary: await readFinanceSummary(context.env.DB, filters),
  });
}
async function orders(context: Context<any>): Promise<Response> {
  requireActor(context);
  const url = new URL(context.req.url);
  assertExactQueryParameters(url, [...FILTER_KEYS, 'limit', 'cursor']);
  const filters = normalizeFinanceQuery(url);
  assertOrderFinanceDateBasis(filters);
  return success(context, await readFinanceOrderPage(
    context.env.DB,
    filters,
    pagination(url),
  ));
}
async function order(context: Context<any>): Promise<Response> {
  requireActor(context);
  const url = new URL(context.req.url);
  assertExactQueryParameters(url, []);
  const position = await readFinanceOrder(
    context.env.DB,
    financeIdentifier(context.req.param('formalOrderId')),
  );
  return success(context, {
    order: buildFinanceOrderDetail(position),
  });
}
async function groups(context: Context<any>): Promise<Response> {
  requireActor(context);
  const url = new URL(context.req.url);
  assertExactQueryParameters(url, [...FILTER_KEYS, 'group_by']);
  const groupBy = url.searchParams.get('group_by');
  if (!isFinanceGroupBy(groupBy)) validation();
  const filters = normalizeFinanceQuery(urlWithout(url, ['group_by']));
  assertOrderFinanceDateBasis(filters);
  return success(context, {
    group_by: groupBy,
    groups: await readFinanceGroups(context.env.DB, filters, groupBy),
    filters,
    data_as_of: Date.now(),
  });
}
async function cashFlow(context: Context<any>): Promise<Response> {
  requireActor(context);
  const url = new URL(context.req.url);
  const allowed = [
    'from_date', 'to_date', 'date_basis', 'seller_organization_id',
  ];
  assertExactQueryParameters(url, allowed);
  const filters = normalizeFinanceQuery(url);
  assertCashFinanceDateBasis(filters);
  return success(context, {
    cash_flow: await readFinanceCashFlow(context.env.DB, filters),
  });
}
async function exceptions(context: Context<any>): Promise<Response> {
  requireActor(context);
  const url = new URL(context.req.url);
  assertExactQueryParameters(url, [...FILTER_KEYS, 'limit', 'cursor']);
  const filters = normalizeFinanceQuery(url);
  assertOrderFinanceDateBasis(filters);
  const page = await readFinanceExceptionPage(
    context.env.DB,
    filters,
    pagination(url),
  );
  return success(context, {
    exceptions: page.items,
    page: page.page,
    filters: page.filters,
    data_as_of: page.data_as_of,
  });
}
async function exportCsv(context: Context<any>): Promise<Response> {
  const actor = requireActor(context, { export: true });
  const body = await bodyRecord(context);
  exactKeys(body, ['export_type', 'filters', 'date_basis']);
  if (!isFinancialExportType(body['export_type'])
    || !isFinanceDateBasis(body['date_basis'])) validation();
  assertFinancialExportDateBasis(body['export_type'], body['date_basis']);
  const filters = normalizeFinanceFilters(
    record(body['filters']),
    Date.now(),
    body['date_basis'],
  );
  const generated = await generateAuditedFinancialCsv(context.env.DB, actor, {
    exportType: body['export_type'],
    filters,
    requestId: requestIdFromContext(context),
  });
  return new Response(generated.bytes, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${generated.filename}"`,
      'X-Financial-Export-ID': generated.exportId,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function requireActor(
  context: Context<any>,
  options: { export?: boolean } = {},
): AssignmentStaffAuthorization {
  return requireFinancialActor(
    context.get('staffAuthorization') as
      | AssignmentStaffAuthorization
      | null
      | undefined,
    options,
  );
}
function pagination(url: URL): { limit: number; cursor: string | null } {
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    validation();
  }
  const cursor = url.searchParams.get('cursor');
  if (cursor !== null && (cursor.length < 1 || cursor.length > 1000)) {
    validation();
  }
  return { limit, cursor };
}
async function bodyRecord(
  context: Context<any>,
): Promise<Record<string, unknown>> {
  return record(await readBoundedJson(context.req.raw, BODY_LIMIT));
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) validation();
  return value as Record<string, unknown>;
}
function exactKeys(
  body: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (Object.keys(body).length !== keys.length
    || keys.some((key) => !Object.hasOwn(body, key))
    || Object.keys(body).some((key) => !keys.includes(key))) validation();
}
function urlWithout(url: URL, keys: readonly string[]): URL {
  const copy = new URL(url);
  for (const key of keys) copy.searchParams.delete(key);
  return copy;
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
  if (error instanceof FinancialCsvError && error.code === 'EXPORT_TOO_LARGE') {
    return new InternalFinanceError('EXPORT_TOO_LARGE', 413);
  }
  return new InternalFinanceError('DEPENDENCY_UNAVAILABLE', 503);
}
function publicMessage(code: ApiErrorCode): string {
  if (code === 'UNAUTHENTICATED') return '员工会话无效';
  if (code === 'FORBIDDEN') return '仅系统所有者可查看或导出内部财务';
  if (code === 'VALIDATION_ERROR') return '请求参数不正确';
  if (code === 'NOT_FOUND') return '财务订单不存在';
  if (code === 'EXPORT_TOO_LARGE') return '导出超过 50000 行或 25 MiB 限制';
  return '内部财务服务暂时不可用';
}
function success(context: Context<any>, data: unknown): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(data, requestIdFromContext(context)));
}
