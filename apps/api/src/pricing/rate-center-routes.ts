import {
  apiFailure,
  apiSuccess,
  type SqlDatabase,
  type StaffRateCenterReadDto,
  type StaffDataScope,
} from '@ygb/contracts';
import type { Context, Hono } from 'hono';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { scopeAllowsSellerOrganization } from '../staff-assignment/data-scope';
import {
  confirmBuyerDailyExchangeRate,
  readBuyerDailyExchangeRateVersions,
  submitBuyerDailyExchangeRate,
} from './buyer-daily-exchange-rates';
import { PricingError, parseAsOfParameter } from './pricing-shared';
import { readSellerPrincipalRatePolicies } from './seller-principal-rate-policy';

const BODY_LIMIT = 16 * 1024;

/**
 * The rate center is deliberately a thin Staff surface over the established
 * immutable pricing streams.  A confirmed base-rate row is the shared source
 * of truth for buyer refund and seller-principal calculations on an Amazon
 * order date; seller markups retain their own approval and effective-time
 * lifecycle.
 */
export function registerStaffRateCenterRoutes(app: Hono<any>): void {
  app.get('/api/staff/rate-center', withErrors(readRateCenter));
  app.post('/api/staff/rate-center/base-rates/submit', withErrors(submitBaseRate));
  app.post('/api/staff/rate-center/base-rates/:id/confirm', withErrors(confirmBaseRate));
}

async function readRateCenter(context: Context<any>): Promise<Response> {
  const actor = staffActor(context);
  const scope = staffDataScope(context);
  requireRateCenterRead(actor);
  const parameters = new URL(context.req.url).searchParams;
  if (
    parameters.getAll('business_date').length !== 1 ||
    parameters.getAll('seller_organization_id').length > 1 ||
    parameters.getAll('as_of').length > 1
  ) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  const businessDate = parameters.get('business_date');
  const requestedOrganization = parameters.get('seller_organization_id');
  const asOf = parseAsOfParameter(parameters.get('as_of'));
  if (businessDate === null) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  if (
    requestedOrganization !== null &&
    !scopeAllowsSellerOrganization(scope, requestedOrganization)
  ) {
    throw new PricingError('NOT_FOUND', 404);
  }
  const organizations = await readVisibleOrganizations(context, scope, actor);
  if (
    requestedOrganization !== null &&
    !organizations.some(
      (organization) => organization.seller_organization_id === requestedOrganization,
    )
  ) {
    throw new PricingError('NOT_FOUND', 404);
  }
  const selectedOrganization =
    requestedOrganization === null
      ? scope.type === 'GLOBAL'
        ? null
        : (organizations.at(0)?.seller_organization_id ?? null)
      : requestedOrganization;
  const [baseRate, policies] = await Promise.all([
    readBuyerDailyExchangeRateVersions(context.env.DB, { businessDate }),
    readSellerPrincipalRatePolicies(context.env.DB, {
      sourceCurrencyCode: 'JPY',
      sellerOrganizationId: selectedOrganization,
      at: asOf,
    }),
  ]);
  const response: StaffRateCenterReadDto = {
    business_date: baseRate.business_date,
    source_currency_code: 'JPY',
    quote_currency_code: 'CNY',
    base_rate: baseRate,
    seller_organizations: organizations,
    policies,
  };
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(response, requestId(context)));
}

async function submitBaseRate(context: Context<any>): Promise<Response> {
  const actor = staffActor(context);
  requireBaseRateSubmit(actor, staffDataScope(context));
  const body = await bodyRecord(context);
  exactKeys(body, ['business_date', 'rate_value', 'expected_version']);
  if (
    typeof body['business_date'] !== 'string' ||
    typeof body['rate_value'] !== 'string' ||
    typeof body['expected_version'] !== 'number'
  ) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  const result = await submitBuyerDailyExchangeRate(
    context.env.DB,
    {
      businessDate: body['business_date'],
      cnyPerJpyE8: decimalRateToE8(body['rate_value']),
      expectedVersion: body['expected_version'],
    },
    command(context, actor),
  );
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess({ base_rate: result }, requestId(context)));
}

async function confirmBaseRate(context: Context<any>): Promise<Response> {
  const actor = staffActor(context);
  requireBaseRateConfirm(actor);
  const body = await bodyRecord(context);
  exactKeys(body, ['expected_version']);
  if (typeof body['expected_version'] !== 'number') {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  const result = await confirmBuyerDailyExchangeRate(
    context.env.DB,
    {
      rateId: requiredId(context.req.param('id')),
      expectedVersion: body['expected_version'],
    },
    command(context, actor),
  );
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess({ base_rate: result }, requestId(context)));
}

async function readVisibleOrganizations(
  context: Context<any>,
  scope: StaffDataScope,
  actor: AssignmentStaffAuthorization,
): Promise<StaffRateCenterReadDto['seller_organizations']> {
  const allowed = scope.type === 'GLOBAL' ? null : scope.sellerOrganizationIds;
  if (allowed !== null && allowed.length === 0) return [];
  const limitedToAssignment = !actor.roles.has('owner');
  const where =
    allowed === null
      ? `organization.status='ACTIVE'`
      : `organization.status='ACTIVE' AND organization.id IN (${allowed.map(() => '?').join(',')})`;
  const database = context.env.DB as SqlDatabase;
  const rows = await database
    .prepare(
      `
    SELECT organization.id,organization.organization_name,organization.marketplace_code
    FROM seller_organizations organization
    ${
      limitedToAssignment
        ? `JOIN seller_staff_assignments assignment
      ON assignment.seller_organization_id=organization.id
      AND assignment.duty_code='SELLER_ACCOUNT_MANAGER'
      AND assignment.status='ACTIVE' AND assignment.staff_id=?`
        : ''
    }
    WHERE ${where}
    ORDER BY organization.organization_name,organization.id
  `,
    )
    .bind(...(limitedToAssignment ? [actor.staffId, ...(allowed ?? [])] : (allowed ?? [])))
    .all<{
      id: string;
      organization_name: string;
      marketplace_code: string;
    }>();
  return rows.results.map((row) => ({
    seller_organization_id: row.id,
    seller_organization_name: row.organization_name,
    marketplace_code: row.marketplace_code,
  }));
}

function requireRateCenterRead(actor: AssignmentStaffAuthorization): void {
  if (
    (!actor.roles.has('owner') && !actor.roles.has('seller_ops')) ||
    !actor.permissions.has('SELLER_MANAGE')
  ) {
    throw new PricingError('FORBIDDEN', 403);
  }
}

function requireBaseRateSubmit(actor: AssignmentStaffAuthorization, scope: StaffDataScope): void {
  if (
    !actor.roles.has('owner') ||
    !actor.permissions.has('SELLER_MANAGE') ||
    !actor.permissions.has('FINANCIAL_CORRECT') ||
    scope.type !== 'GLOBAL'
  ) {
    throw new PricingError('FORBIDDEN', 403);
  }
}

function requireBaseRateConfirm(actor: AssignmentStaffAuthorization): void {
  if (!actor.roles.has('owner') || !actor.permissions.has('FINANCIAL_CORRECT')) {
    throw new PricingError('FORBIDDEN', 403);
  }
}

function decimalRateToE8(value: string): string {
  const normalized = value.normalize('NFKC').trim();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,8}))?$/u.exec(normalized);
  if (!match) throw new PricingError('VALIDATION_ERROR', 400);
  const fraction = (match[2] ?? '').padEnd(8, '0');
  const encoded = BigInt(match[1] ?? '0') * 100_000_000n + BigInt(fraction || '0');
  if (encoded <= 0n) throw new PricingError('VALIDATION_ERROR', 400);
  return encoded.toString(10);
}

function command(context: Context<any>, actor: AssignmentStaffAuthorization) {
  const key = parseIdempotencyKey(context.req.header('Idempotency-Key'));
  if (!key) throw new PricingError('VALIDATION_ERROR', 400);
  return {
    actor: { staffId: actor.staffId, displayName: actor.displayName, roles: [...actor.roles] },
    idempotencyKey: key,
    requestId: requestId(context),
  };
}

function staffActor(context: Context<any>): AssignmentStaffAuthorization {
  const actor = context.get('staffAuthorization') as
    | AssignmentStaffAuthorization
    | null
    | undefined;
  if (!actor) throw new PricingError('FORBIDDEN', 403);
  return actor;
}

function staffDataScope(context: Context<any>): StaffDataScope {
  const scope = context.get('staffDataScope') as StaffDataScope | null | undefined;
  if (!scope) throw new PricingError('FORBIDDEN', 403);
  return scope;
}

async function bodyRecord(context: Context<any>): Promise<Record<string, unknown>> {
  const value = await readBoundedJson(context.req.raw, BODY_LIMIT);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  return value as Record<string, unknown>;
}

function exactKeys(body: Record<string, unknown>, keys: readonly string[]): void {
  if (
    Object.keys(body).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(body, key))
  ) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
}

function requiredId(value: string | undefined): string {
  if (!value || value.length < 1 || value.length > 120) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  return value;
}

function requestId(context: Context<any>): string {
  return String(context.get('requestId') ?? crypto.randomUUID());
}

function withErrors(handler: (context: Context<any>) => Promise<Response>) {
  return async (context: Context<any>): Promise<Response> => {
    context.header('Cache-Control', 'no-store');
    try {
      return await handler(context);
    } catch (error) {
      const candidate = error as { code?: unknown; status?: unknown };
      const code = typeof candidate.code === 'string' ? candidate.code : 'DEPENDENCY_UNAVAILABLE';
      const status =
        typeof candidate.status === 'number' && [400, 403, 404, 409, 503].includes(candidate.status)
          ? (candidate.status as 400 | 403 | 404 | 409 | 503)
          : 503;
      return context.json(apiFailure(code as any, message(code), requestId(context)), status);
    }
  };
}

function message(code: string): string {
  switch (code) {
    case 'FORBIDDEN':
      return '无权管理汇率中心';
    case 'NOT_FOUND':
      return '资源不存在或不在当前授权范围内';
    case 'VERSION_CONFLICT':
      return '配置已发生变化，请刷新后重试';
    case 'PRICING_RULE_PENDING_CONFLICT':
      return '该订单日已有待确认基础汇率';
    case 'PRICING_RULE_ALREADY_DECIDED':
      return '该订单日基础汇率已经确认，历史不回写';
    case 'PRICING_RULE_NOT_FOUND':
      return '基础汇率版本不存在';
    case 'VALIDATION_ERROR':
      return '请填写有效的订单日和基础汇率';
    default:
      return '服务暂时不可用，请稍后重试';
  }
}
