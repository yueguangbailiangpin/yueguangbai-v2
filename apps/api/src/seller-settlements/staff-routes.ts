import {
  apiFailure,
  apiSuccess,
  type ApiErrorCode,
} from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  allocateSellerPayment,
  reallocateSellerAllocation,
  reverseSellerAllocation,
} from './allocation-commands';
import {
  correctSellerPaymentPaidAt,
  reverseSellerPayment,
} from './payment-commands';
import {
  getSellerPayable,
  getSellerPayment,
  listSellerPayables,
  listSellerPayments,
  readSellerSettlementSummary,
  staffScope,
} from './read-model';
import {
  listSellerPayableReconciliationConflicts,
  reconcileSellerPayables,
} from './reconciliation';
import { recordSellerPayment } from './record-payment';
import { requirePaymentBalance } from './records';
import {
  authorizeSellerSettlement,
  cleanSettlementIdentifier,
  normalizeSettlementError,
  SellerSettlementError,
} from './shared';

const BODY_LIMIT = 24 * 1024;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export function registerStaffSellerSettlementRoutes(app: Hono<any>): void {
  app.get('/api/staff/seller-settlements/:organizationId/summary', withErrors(summary));
  app.get('/api/staff/seller-settlements/:organizationId/payables', withErrors(payables));
  app.get('/api/staff/seller-settlements/:organizationId/payables/:payableId', withErrors(payable));
  app.get('/api/staff/seller-settlements/:organizationId/payments', withErrors(payments));
  app.get('/api/staff/seller-settlements/:organizationId/payments/:paymentId', withErrors(payment));
  app.post('/api/staff/seller-settlements/:organizationId/payments', withErrors(recordPayment));
  app.patch('/api/staff/seller-payments/:paymentId/paid-at', withErrors(correctPaidAt));
  app.post('/api/staff/seller-payments/:paymentId/allocations', withErrors(allocate));
  app.post('/api/staff/seller-allocations/:allocationId/reverse', withErrors(reverseAllocation));
  app.post('/api/staff/seller-allocations/:allocationId/reallocate', withErrors(reallocate));
  app.post('/api/staff/seller-payments/:paymentId/reverse', withErrors(reversePayment));
  app.post('/api/staff/seller-settlements/:organizationId/reconciliation', withErrors(runReconciliation));
  app.get('/api/staff/seller-settlements/:organizationId/reconciliation/conflicts', withErrors(conflicts));
}

async function summary(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const organizationId = organization(context);
  await authorizeSellerSettlement(context.env.DB, actor, organizationId, { viewOnly: true });
  return success(context, {
    settlement: await readSellerSettlementSummary(
      context.env.DB,
      staffScope(organizationId),
    ),
  });
}

async function payables(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const organizationId = organization(context);
  await authorizeSellerSettlement(context.env.DB, actor, organizationId, { viewOnly: true });
  return success(context, await listSellerPayables(
    context.env.DB,
    staffScope(organizationId),
    pagination(context),
  ));
}

async function payable(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const organizationId = organization(context);
  await authorizeSellerSettlement(context.env.DB, actor, organizationId, { viewOnly: true });
  return success(context, {
    payable: await getSellerPayable(
      context.env.DB,
      staffScope(organizationId),
      cleanSettlementIdentifier(context.req.param('payableId')),
    ),
  });
}

async function payments(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const organizationId = organization(context);
  await authorizeSellerSettlement(context.env.DB, actor, organizationId, { viewOnly: true });
  return success(context, await listSellerPayments(
    context.env.DB,
    staffScope(organizationId),
    pagination(context),
  ));
}

async function payment(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const organizationId = organization(context);
  await authorizeSellerSettlement(context.env.DB, actor, organizationId, { viewOnly: true });
  return success(context, {
    payment: await getSellerPayment(
      context.env.DB,
      staffScope(organizationId),
      cleanSettlementIdentifier(context.req.param('paymentId')),
    ),
  });
}

async function recordPayment(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const organizationId = organization(context);
  const body = await bodyRecord(context);
  exactKeys(body, ['amount_cny_fen', 'paid_at', 'proof_file']);
  const proof = record(body['proof_file']);
  exactKeys(proof, ['file_object_id', 'expected_file_version']);
  const result = await recordSellerPayment(context.env.DB, {
    sellerOrganizationId: organizationId,
    amountCnyFen: integerString(body['amount_cny_fen']),
    paidAt: integer(body['paid_at']),
    proofFile: {
      fileObjectId: string(body['proof_file'] && proof['file_object_id']),
      expectedFileVersion: integer(proof['expected_file_version']),
    },
  }, command(context, actor));
  return success(context, {
    payment: await getSellerPayment(
      context.env.DB,
      staffScope(organizationId),
      result.paymentId,
    ),
    replayed: result.replayed,
  }, result.replayed ? 200 : 201);
}

async function correctPaidAt(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const body = await bodyRecord(context);
  exactKeys(body, ['expected_version', 'paid_at', 'reason']);
  const result = await correctSellerPaymentPaidAt(context.env.DB, {
    paymentId: cleanSettlementIdentifier(context.req.param('paymentId')),
    expectedVersion: integer(body['expected_version']),
    paidAt: integer(body['paid_at']),
    reason: string(body['reason']),
  }, command(context, actor));
  return paymentMutation(context, result.paymentId, result.replayed);
}

async function allocate(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const body = await bodyRecord(context);
  exactKeys(body, ['payable_id', 'amount_cny_fen', 'expected_payment_version']);
  const result = await allocateSellerPayment(context.env.DB, {
    paymentId: cleanSettlementIdentifier(context.req.param('paymentId')),
    payableId: string(body['payable_id']),
    amountCnyFen: integerString(body['amount_cny_fen']),
    expectedPaymentVersion: integer(body['expected_payment_version']),
  }, command(context, actor));
  return paymentMutation(context, result.paymentId, result.replayed, 201);
}

async function reverseAllocation(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const body = await bodyRecord(context);
  exactKeys(body, ['amount_cny_fen', 'reason', 'expected_payment_version']);
  const result = await reverseSellerAllocation(context.env.DB, {
    allocationId: cleanSettlementIdentifier(context.req.param('allocationId')),
    amountCnyFen: integerString(body['amount_cny_fen']),
    reason: string(body['reason']),
    expectedPaymentVersion: integer(body['expected_payment_version']),
  }, command(context, actor));
  return paymentMutation(context, result.paymentId, result.replayed, 201);
}

async function reallocate(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const body = await bodyRecord(context);
  exactKeys(body, [
    'target_payable_id', 'amount_cny_fen', 'reason', 'expected_payment_version',
  ]);
  const result = await reallocateSellerAllocation(context.env.DB, {
    allocationId: cleanSettlementIdentifier(context.req.param('allocationId')),
    targetPayableId: string(body['target_payable_id']),
    amountCnyFen: integerString(body['amount_cny_fen']),
    reason: string(body['reason']),
    expectedPaymentVersion: integer(body['expected_payment_version']),
  }, command(context, actor));
  return paymentMutation(context, result.paymentId, result.replayed, 201);
}

async function reversePayment(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const body = await bodyRecord(context);
  exactKeys(body, ['expected_version', 'reason']);
  const result = await reverseSellerPayment(context.env.DB, {
    paymentId: cleanSettlementIdentifier(context.req.param('paymentId')),
    expectedVersion: integer(body['expected_version']),
    reason: string(body['reason']),
  }, command(context, actor));
  return paymentMutation(context, result.paymentId, result.replayed, 201);
}

async function runReconciliation(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const body = await bodyRecord(context);
  allowedKeys(body, ['cursor', 'limit']);
  const result = await reconcileSellerPayables(context.env.DB, {
    sellerOrganizationId: organization(context),
    cursor: body['cursor'] === undefined ? null : nullableString(body['cursor']),
    limit: body['limit'] === undefined ? undefined : integer(body['limit']),
  }, command(context, actor));
  return success(context, { reconciliation: result });
}

async function conflicts(context: Context<any>): Promise<Response> {
  const actor = requireAuthorization(context);
  const organizationId = organization(context);
  await authorizeSellerSettlement(context.env.DB, actor, organizationId, { viewOnly: true });
  const url = new URL(context.req.url);
  const after = url.searchParams.get('after');
  const limit = url.searchParams.get('limit');
  return success(context, {
    conflicts: await listSellerPayableReconciliationConflicts(
      context.env.DB,
      organizationId,
      {
        after: after === null ? undefined : integer(Number(after)),
        limit: limit === null ? undefined : integer(Number(limit)),
      },
    ),
  });
}

async function paymentMutation(
  context: Context<any>,
  paymentId: string,
  replayed: boolean,
  createdStatus: 200 | 201 = 200,
): Promise<Response> {
  const row = await requirePaymentBalance(context.env.DB, paymentId);
  return success(context, {
    payment: await getSellerPayment(
      context.env.DB,
      staffScope(row.seller_organization_id),
      paymentId,
    ),
    replayed,
  }, replayed ? 200 : createdStatus);
}

function requireAuthorization(context: Context<any>): AssignmentStaffAuthorization {
  const authorization = context.get('staffAuthorization') as
    | AssignmentStaffAuthorization
    | null
    | undefined;
  if (!authorization) {
    throw new SellerSettlementError('UNAUTHENTICATED', 401);
  }
  return authorization;
}

function command(context: Context<any>, actor: AssignmentStaffAuthorization) {
  const key = parseIdempotencyKey(context.req.header('Idempotency-Key'));
  if (!key) throw new SellerSettlementError('VALIDATION_ERROR', 400);
  return {
    actor,
    idempotencyKey: key,
    requestId: requestIdFromContext(context),
  };
}

function organization(context: Context<any>): string {
  return cleanSettlementIdentifier(context.req.param('organizationId'));
}

function pagination(context: Context<any>): { limit: number; cursor: string | null } {
  const url = new URL(context.req.url);
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) validation();
  const cursor = url.searchParams.get('cursor');
  if (cursor !== null && (cursor.length < 1 || cursor.length > 1000)) validation();
  return { limit, cursor };
}

async function bodyRecord(context: Context<any>): Promise<Record<string, unknown>> {
  return record(await readBoundedJson(context.req.raw, BODY_LIMIT));
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) validation();
  return value as Record<string, unknown>;
}

function exactKeys(body: Record<string, unknown>, keys: readonly string[]): void {
  allowedKeys(body, keys);
  if (keys.some((key) => !Object.hasOwn(body, key))) validation();
}

function allowedKeys(body: Record<string, unknown>, keys: readonly string[]): void {
  const allowed = new Set(keys);
  if (Object.keys(body).some((key) => !allowed.has(key))) validation();
}

function string(value: unknown): string {
  if (typeof value !== 'string') validation();
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return string(value);
}

function integerString(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(value)) validation();
  return value;
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) validation();
  return Number(value);
}

function validation(): never {
  throw new SellerSettlementError('VALIDATION_ERROR', 400);
}

function withErrors(handler: (context: Context<any>) => Promise<Response>) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      const normalized = normalizeSettlementError(error);
      const code = normalized.code as ApiErrorCode;
      return context.json(apiFailure(
        code,
        publicMessage(code),
        requestIdFromContext(context),
      ), normalized.status);
    }
  };
}

function publicMessage(code: ApiErrorCode): string {
  if (code === 'UNAUTHENTICATED') return '员工会话无效';
  if (code === 'FORBIDDEN') return '无权执行该操作';
  if (code === 'NOT_FOUND') return '资源不存在';
  if (code === 'VALIDATION_ERROR') return '请求参数不正确';
  if (code === 'VERSION_CONFLICT') return '数据已发生变化，请刷新后重试';
  if (code === 'IDEMPOTENCY_CONFLICT') return '幂等键与原请求不一致';
  return '当前结算状态无法执行该操作';
}

function success(
  context: Context<any>,
  data: unknown,
  status: 200 | 201 = 200,
): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(data, requestIdFromContext(context)), status);
}