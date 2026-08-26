import { apiFailure, apiSuccess, isCurrencyCode, type SqlDatabase } from '@ygb/contracts';
import type { Context, Hono } from 'hono';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import type { StaffDataScope } from '@ygb/contracts';
import { scopeAllowsSellerOrganization } from '../staff-assignment/data-scope';
import {
  readSellerPrincipalRatePolicies,
  saveSellerPrincipalRatePolicy,
} from './seller-principal-rate-policy';
import { PricingError, parseAsOfParameter } from './pricing-shared';

const BODY_LIMIT = 16 * 1024;

export function registerSellerPrincipalRatePolicyRoutes(app: Hono<any>): void {
  app.get('/api/staff/seller-principal-rate-policies', withErrors(read));
  app.post('/api/staff/seller-principal-rate-policies/save', withErrors(save));
}

async function read(context: Context<any>): Promise<Response> {
  const actor = staffActor(context);
  const scope = staffDataScope(context);
  requireManage(actor);
  const parameters = new URL(context.req.url).searchParams;
  if (
    parameters.getAll('source_currency_code').length !== 1 ||
    parameters.getAll('seller_organization_id').length > 1 ||
    parameters.getAll('as_of').length > 1
  ) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  const source = parameters.get('source_currency_code');
  const organizationId = parameters.get('seller_organization_id');
  const asOf = parseAsOfParameter(parameters.get('as_of'));
  if (
    !isCurrencyCode(source) ||
    source === 'CNY' ||
    (organizationId !== null && (organizationId.length < 1 || organizationId.length > 120))
  ) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  if (organizationId === null) {
    requireGlobalPolicyScope(scope);
  } else {
    if (!scopeAllowsSellerOrganization(scope, organizationId)) {
      throw new PricingError('NOT_FOUND', 404);
    }
    const activeOrganization = (await context.env.DB.prepare(
      `
      SELECT 1 AS present FROM seller_organizations
      WHERE id=? AND status='ACTIVE'
    `,
    )
      .bind(organizationId)
      .first()) as { present: number } | null;
    if (!activeOrganization) throw new PricingError('NOT_FOUND', 404);
  }
  context.header('Cache-Control', 'no-store');
  return context.json(
    apiSuccess(
      {
        policies: await readSellerPrincipalRatePolicies(context.env.DB, {
          sourceCurrencyCode: source,
          sellerOrganizationId: organizationId,
          at: asOf,
        }),
      },
      requestId(context),
    ),
  );
}

async function save(context: Context<any>): Promise<Response> {
  const actor = staffActor(context);
  const dataScope = staffDataScope(context);
  requireManage(actor);
  const body = await bodyRecord(context);
  exactKeys(body, [
    'scope_type',
    'seller_organization_id',
    'source_currency_code',
    'markup_rate_value',
    'expected_version',
  ]);
  const source = body['source_currency_code'];
  const policyScope = body['scope_type'];
  if (
    !isCurrencyCode(source) ||
    source === 'CNY' ||
    (policyScope !== 'CURRENCY_PAIR_DEFAULT' && policyScope !== 'SELLER_ORGANIZATION') ||
    (body['seller_organization_id'] !== null &&
      typeof body['seller_organization_id'] !== 'string') ||
    typeof body['markup_rate_value'] !== 'string' ||
    typeof body['expected_version'] !== 'number'
  ) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  if (policyScope === 'CURRENCY_PAIR_DEFAULT') {
    if (body['seller_organization_id'] !== null) {
      throw new PricingError('VALIDATION_ERROR', 400);
    }
    requireGlobalPolicyScope(dataScope);
  } else {
    if (typeof body['seller_organization_id'] !== 'string') {
      throw new PricingError('VALIDATION_ERROR', 400);
    }
    await requireSellerOrganizationWriteScope(
      context.env.DB,
      dataScope,
      actor,
      body['seller_organization_id'],
    );
  }
  const result = await saveSellerPrincipalRatePolicy(
    context.env.DB,
    {
      scopeType: policyScope,
      sellerOrganizationId: body['seller_organization_id'],
      sourceCurrencyCode: source,
      markupRateValue: body['markup_rate_value'],
      expectedVersion: body['expected_version'],
    },
    command(context, actor),
  );
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess({ policy: result }, requestId(context)));
}

function command(context: Context<any>, actor: AssignmentStaffAuthorization) {
  const key = parseIdempotencyKey(context.req.header('Idempotency-Key'));
  if (!key) throw new PricingError('VALIDATION_ERROR', 400);
  return {
    actor: {
      staffId: actor.staffId,
      displayName: actor.displayName,
      roles: [...actor.roles],
    },
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

async function requireSellerOrganizationWriteScope(
  database: SqlDatabase,
  scope: StaffDataScope,
  actor: AssignmentStaffAuthorization,
  organizationId: string,
): Promise<void> {
  if (!scopeAllowsSellerOrganization(scope, organizationId)) {
    throw new PricingError('FORBIDDEN', 403);
  }
  // D-056: owner and seller_ops have identical rate maintenance rights.  The
  // organization must still be ACTIVE and inside the caller's data scope.
  if (
    (!actor.roles.has('seller_ops') && !actor.roles.has('owner')) ||
    !actor.permissions.has('SELLER_MANAGE')
  ) {
    throw new PricingError('FORBIDDEN', 403);
  }
  const activeOrganization = await database
    .prepare(
      `SELECT 1 AS present FROM seller_organizations WHERE id=? AND status='ACTIVE'`,
    )
    .bind(organizationId)
    .first<{ present: number }>();
  if (!activeOrganization) throw new PricingError('NOT_FOUND', 404);
}

function requireGlobalPolicyScope(scope: StaffDataScope): void {
  if (scope.type !== 'GLOBAL') throw new PricingError('FORBIDDEN', 403);
}

function requireManage(actor: AssignmentStaffAuthorization): void {
  if (
    (!actor.roles.has('seller_ops') && !actor.roles.has('owner')) ||
    !actor.permissions.has('SELLER_MANAGE')
  ) {
    throw new PricingError('FORBIDDEN', 403);
  }
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
      return '无权管理卖家本金汇率策略';
    case 'NOT_FOUND':
      return '资源不存在';
    case 'VERSION_CONFLICT':
      return '配置已发生变化，请刷新后重试';
    case 'SELLER_PRINCIPAL_RATE_NOT_FOUND':
      return '下单日缺少权威日汇率或生效策略';
    case 'PRICING_RULE_NOT_FOUND':
      return '汇率策略不存在';
    case 'PRICING_RULE_PENDING_CONFLICT':
      return '已有待处理的汇率策略变更';
    case 'PRICING_RULE_EFFECTIVE_TIME_CONFLICT':
      return '生效时间必须晚于当前时间';
    case 'VALIDATION_ERROR':
      return '请求参数不正确';
    default:
      return '服务暂时不可用，请稍后重试';
  }
}
