import {
  apiFailure,
  apiSuccess,
  type ApiErrorCode,
} from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { DenyAllFileAuthorizationService } from '../files/authorization';
import { createFileReadIntent } from '../files/file-read-service';
import { requestIdFromContext } from '../http-auth/errors';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { requirePaymentProof } from './records';
import {
  authorizeSellerSettlement,
  cleanSettlementIdentifier,
  normalizeSettlementError,
  SellerSettlementError,
} from './shared';

const BODY_LIMIT = 2048;
const denyLegacyFileRead = new DenyAllFileAuthorizationService();

export function registerStaffSellerSettlementProofRoutes(app: Hono<any>): void {
  app.post(
    '/api/staff/seller-payments/:paymentId/proof/read-intent',
    withErrors(createProofReadIntent),
  );
}

async function createProofReadIntent(context: Context<any>): Promise<Response> {
  const actor = authorization(context);
  const paymentId = cleanSettlementIdentifier(context.req.param('paymentId'));
  const rawBody = await readBoundedJson(context.req.raw, BODY_LIMIT);
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  const body = rawBody as Record<string, unknown>;
  if (Object.keys(body).length !== 1
    || !Object.hasOwn(body, 'expected_file_version')
    || !Number.isSafeInteger(body['expected_file_version'])
    || Number(body['expected_file_version']) < 1) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  const proof = await requirePaymentProof(context.env.DB, paymentId);
  // Defense in depth for the dedicated route. The common file authorization
  // layer repeats the current Seller Organization scope check when the read
  // intent is created and again when it is consumed.
  await authorizeSellerSettlement(
    context.env.DB,
    actor,
    proof.seller_organization_id,
    { viewOnly: true },
  );
  if (proof.file_version !== Number(body['expected_file_version'])) {
    throw new SellerSettlementError('VERSION_CONFLICT', 409);
  }
  const idempotencyKey = parseIdempotencyKey(
    context.req.header('Idempotency-Key'),
  );
  if (!idempotencyKey) {
    throw new SellerSettlementError('VALIDATION_ERROR', 400);
  }
  const result = await createFileReadIntent(
    context.env.DB,
    denyLegacyFileRead,
    {
      fileObjectId: proof.file_object_id,
      fileEntityLinkId: proof.file_entity_link_id,
      expectedFileVersion: proof.file_version,
    },
    {
      actor: {
        type: 'STAFF',
        id: actor.staffId,
        roles: Object.freeze([...actor.roles]),
      },
      principal: {
        type: 'STAFF_SESSION',
        staffId: actor.staffId,
      },
      idempotencyKey,
      requestId: requestIdFromContext(context),
    },
  );
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess({
    read_intent_id: result.readIntentId,
    file_object_id: result.fileObjectId,
    access_token: result.accessToken,
    access_token_available: result.accessTokenAvailable,
    expires_at: result.expiresAt,
    replayed: result.replayed,
  }, requestIdFromContext(context)), result.replayed ? 200 : 201);
}

function authorization(context: Context<any>): AssignmentStaffAuthorization {
  const value = context.get('staffAuthorization') as
    | AssignmentStaffAuthorization
    | null
    | undefined;
  if (!value) throw new SellerSettlementError('UNAUTHENTICATED', 401);
  return value;
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
  if (code === 'FORBIDDEN' || code === 'NOT_FOUND') return '付款证明不存在';
  if (code === 'VERSION_CONFLICT') return '付款证明已发生变化';
  if (code === 'VALIDATION_ERROR') return '请求参数不正确';
  return '当前无法读取付款证明';
}