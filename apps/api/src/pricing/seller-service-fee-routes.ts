import {
  apiFailure,
  apiSuccess,
  isPricingReviewType,
  type SqlDatabase,
  type StaffDataScope,
} from '@ygb/contracts';
import type { Context, Hono } from 'hono';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { scopeAllowsSellerOrganization } from '../staff-assignment/data-scope';
import { PricingError, parseAsOfParameter } from './pricing-shared';
import {
  confirmSellerServiceFee,
  readSellerServiceFeeOverview,
  rejectSellerServiceFee,
  submitSellerServiceFee,
} from './seller-service-fees';

const BODY_LIMIT = 16 * 1024;

export function registerSellerServiceFeeRoutes(app: Hono<any>): void {
  app.get('/api/staff/seller-service-fees', withErrors(read));
  app.post('/api/staff/seller-service-fees/submit', withErrors(submit));
  app.post('/api/staff/seller-service-fees/:id/confirm', withErrors(confirm));
  app.post('/api/staff/seller-service-fees/:id/reject', withErrors(reject));
}

async function read(context: Context<any>): Promise<Response> {
  const actor = staffActor(context);
  const scope = staffDataScope(context);
  requireManage(actor);
  const parameters = new URL(context.req.url).searchParams;
  if (
    parameters.getAll('seller_organization_id').length !== 1 ||
    parameters.getAll('as_of').length > 1
  ) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  const organizationId = parameters.get('seller_organization_id')!;
  const asOf = parseAsOfParameter(parameters.get('as_of'));
  if (organizationId.length < 1 || organizationId.length > 120) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  await requireReadableOrganization(context.env.DB, scope, organizationId);
  context.header('Cache-Control', 'no-store');
  return context.json(
    apiSuccess(
      {
        seller_organization_id: organizationId,
        fees: await readSellerServiceFeeOverview(context.env.DB, {
          sellerOrganizationId: organizationId,
          at: asOf,
        }),
      },
      requestId(context),
    ),
  );
}

async function submit(context: Context<any>): Promise<Response> {
  const actor = staffActor(context);
  const dataScope = staffDataScope(context);
  requireManage(actor);
  const body = await bodyRecord(context);
  exactKeys(body, [
    'seller_organization_id',
    'review_type',
    'fee_cny_fen',
    'effective_from',
    'expected_version',
  ]);
  if (
    typeof body['seller_organization_id'] !== 'string' ||
    !isPricingReviewType(body['review_type']) ||
    typeof body['fee_cny_fen'] !== 'string' ||
    !/^(0|[1-9][0-9]*)$/u.test(body['fee_cny_fen']) ||
    typeof body['effective_from'] !== 'number' ||
    typeof body['expected_version'] !== 'number'
  ) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  await requireWritableOrganization(
    context.env.DB,
    dataScope,
    actor,
    body['seller_organization_id'],
  );
  const result = await submitSellerServiceFee(
    context.env.DB,
    {
      sellerOrganizationId: body['seller_organization_id'],
      reviewType: body['review_type'],
      feeCnyFen: body['fee_cny_fen'],
      effectiveFrom: body['effective_from'],
      expectedVersion: body['expected_version'],
    },
    command(context, actor),
  );
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess({ fee: result }, requestId(context)));
}

async function confirm(context: Context<any>): Promise<Response> {
  const actor = staffActor(context);
  requireConfirm(actor);
  const body = await bodyRecord(context);
  exactKeys(body, ['expected_version']);
  if (typeof body['expected_version'] !== 'number') {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  const result = await confirmSellerServiceFee(
    context.env.DB,
    {
      feeVersionId: requiredId(context.req.param('id')),
      expectedVersion: body['expected_version'],
    },
    command(context, actor),
  );
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess({ fee: result }, requestId(context)));
}

async function reject(context: Context<any>): Promise<Response> {
  const actor = staffActor(context);
  requireConfirm(actor);
  const body = await bodyRecord(context);
  exactKeys(body, ['expected_version', 'rejection_reason']);
  if (
    typeof body['expected_version'] !== 'number' ||
    typeof body['rejection_reason'] !== 'string' ||
    body['rejection_reason'].length < 1 ||
    body['rejection_reason'].length > 1000
  ) {
    throw new PricingError('VALIDATION_ERROR', 400);
  }
  const result = await rejectSellerServiceFee(
    context.env.DB,
    {
      feeVersionId: requiredId(context.req.param('id')),
      expectedVersion: body['expected_version'],
      rejectionReason: body['rejection_reason'],
    },
    command(context, actor),
  );
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess({ fee: result }, requestId(context)));
}

async function requireReadableOrganization(
  database: SqlDatabase,
  scope: StaffDataScope,
  organizationId: string,
): Promise<void> {
  if (!scopeAllowsSellerOrganization(scope, organizationId)) {
    throw new PricingError('NOT_FOUND', 404);
  }
  const activeOrganization = await database
    .prepare(`SELECT 1 AS present FROM seller_organizations WHERE id=? AND status='ACTIVE'`)
    .bind(organizationId)
    .first<{ present: number }>();
  if (!activeOrganization) throw new PricingError('NOT_FOUND', 404);
}

async function requireWritableOrganization(
  database: SqlDatabase,
  scope: StaffDataScope,
  actor: AssignmentStaffAuthorization,
  organizationId: string,
): Promise<void> {
  await requireReadableOrganization(database, scope, organizationId);
  // Same authority model as seller principal markup: Owner may configure any
  // organization, seller_ops only an organization assigned to them as the
  // canonical SELLER_ACCOUNT_MANAGER. Marketplace scope alone is not enough.
  if (actor.roles.has('owner')) return;
  if (!actor.roles.has('seller_ops') || !actor.permissions.has('SELLER_MANAGE')) {
    throw new PricingError('FORBIDDEN', 403);
  }
  const assignment = await database
    .prepare(
      `
      SELECT 1 AS present FROM seller_staff_assignments
      WHERE seller_organization_id=? AND staff_id=?
        AND duty_code='SELLER_ACCOUNT_MANAGER' AND status='ACTIVE'
    `,
    )
    .bind(organizationId, actor.staffId)
    .first<{ present: number }>();
  if (!assignment) throw new PricingError('FORBIDDEN', 403);
}

function requireManage(actor: AssignmentStaffAuthorization): void {
  if (
    (!actor.roles.has('seller_ops') && !actor.roles.has('owner')) ||
    !actor.permissions.has('SELLER_MANAGE')
  ) {
    throw new PricingError('FORBIDDEN', 403);
  }
}

function requireConfirm(actor: AssignmentStaffAuthorization): void {
  if (!actor.roles.has('owner') || !actor.permissions.has('FINANCIAL_CORRECT')) {
    throw new PricingError('FORBIDDEN', 403);
  }
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
      return '无权管理卖家服务费';
    case 'NOT_FOUND':
      return '资源不存在';
    case 'VERSION_CONFLICT':
      return '配置已发生变化，请刷新后重试';
    case 'PRICING_RULE_NOT_FOUND':
      return '服务费配置不存在';
    case 'PRICING_RULE_PENDING_CONFLICT':
      return '已有待处理的服务费变更';
    case 'PRICING_RULE_EFFECTIVE_TIME_CONFLICT':
      return '生效时间必须晚于当前时间';
    case 'VALIDATION_ERROR':
      return '请求参数不正确';
    default:
      return '服务暂时不可用，请稍后重试';
  }
}
