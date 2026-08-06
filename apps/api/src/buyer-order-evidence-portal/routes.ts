import {
  apiSuccess,
  type BuyerOrderEvidenceFileReadIntentDto,
  type BuyerOrderEvidenceMutationDto,
  type CreateBuyerOrderEvidenceFileReadIntentRequest,
  type ResubmitBuyerOrderEvidenceRequest,
  type SubmitBuyerOrderEvidenceRequest,
  type WithdrawBuyerOrderEvidenceRequest,
} from '@ygb/contracts';
import {
  parseIdempotencyKey,
  readBoundedJson,
} from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { requireBuyerPortalContext } from '../buyer-portal/buyer-context';
import { createFileReadIntent } from '../files/file-read-service';
import { requestIdFromContext } from '../http-auth/errors';
import {
  customerSessionMiddleware,
  requireCustomerSessionFromContext,
} from '../middleware/customer-auth';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import { submitOrderEvidence } from '../order-evidence/submit-order-evidence';
import { withdrawOrderEvidence } from '../order-evidence/withdraw-order-evidence';
import {
  buyerOrderEvidencePortalFailure,
  BuyerOrderEvidencePortalError,
  normalizeBuyerOrderEvidencePortalError,
} from './errors';
import { buyerOrderEvidenceFileAuthorization } from './file-authorization';
import {
  decodeEligibleReservationCursor,
  decodeOrderEvidenceCursor,
  parseBuyerOrderEvidencePageLimit,
} from './pagination';
import {
  getBuyerOrderEvidence,
  listBuyerOrderEvidence,
  listEligibleOrderEvidenceReservations,
  requireBuyerOrderEvidenceReservationId,
  requireBuyerOrderEvidenceFileLink,
} from './read-model';

const SUBMIT_BODY_LIMIT_BYTES = 16 * 1024;
const WITHDRAW_BODY_LIMIT_BYTES = 2048;
const MAX_FILE_OBJECTS = 10;
const MAX_IDENTIFIER_LENGTH = 120;

export function registerBuyerOrderEvidencePortalRoutes(
  app: Hono<any>,
): void {
  const session = customerSessionMiddleware();

  app.get(
    '/api/buyer-portal/order-evidence/eligible-reservations',
    session,
    withBuyerOrderEvidenceErrors(listEligibleReservations),
  );
  app.post(
    '/api/buyer-portal/order-evidence',
    customerAuthOriginGuard(),
    session,
    withBuyerOrderEvidenceErrors(createOrderEvidence),
  );
  app.get(
    '/api/buyer-portal/order-evidence',
    session,
    withBuyerOrderEvidenceErrors(listOwnOrderEvidence),
  );
  app.get(
    '/api/buyer-portal/order-evidence/:id',
    session,
    withBuyerOrderEvidenceErrors(getOwnOrderEvidence),
  );
  app.post(
    '/api/buyer-portal/order-evidence/:id/resubmit',
    customerAuthOriginGuard(),
    session,
    withBuyerOrderEvidenceErrors(resubmitOrderEvidence),
  );
  app.post(
    '/api/buyer-portal/order-evidence/:id/withdraw',
    customerAuthOriginGuard(),
    session,
    withBuyerOrderEvidenceErrors(withdrawOwnOrderEvidence),
  );
  app.post(
    '/api/buyer-portal/order-evidence/:id/files/:fileLinkId/read-intent',
    customerAuthOriginGuard(),
    session,
    withBuyerOrderEvidenceErrors(createOrderEvidenceFileReadIntent),
  );
}

async function listEligibleReservations(
  context: Context<any>,
): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  const page = await listEligibleOrderEvidenceReservations(
    context.env.DB,
    buyer,
    {
      limit: parseBuyerOrderEvidencePageLimit(
        context.req.query('limit'),
      ),
      cursor: decodeEligibleReservationCursor(
        context.req.query('cursor'),
      ),
    },
  );
  return success(context, page);
}

async function createOrderEvidence(
  context: Context<any>,
): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  const body = parseSubmitBody(await readBoundedJson(
    context.req.raw,
    SUBMIT_BODY_LIMIT_BYTES,
  ));
  const result = await submitOrderEvidence(
    context.env.DB,
    {
      reservationId: body.reservation_id,
      expectedVersion: body.expected_version,
      marketplace: buyer.marketplaceCode,
      amazonOrderNumber: body.amazon_order_number,
      amazonOrderDate: body.amazon_order_date,
      finalPaidJpy: body.final_paid_jpy,
      evidenceFileObjectIds: body.file_object_ids,
      buyerNote: body.buyer_note ?? null,
    },
    {
      actor: buyer,
      idempotencyKey: requireIdempotencyKey(context),
      requestId: requestIdFromContext(context),
    },
  );
  const response: BuyerOrderEvidenceMutationDto = {
    order_evidence: await getBuyerOrderEvidence(
      context.env.DB,
      buyer,
      result.submission_id,
    ),
    replayed: result.replayed,
  };
  return success(context, response, result.replayed ? 200 : 201);
}

async function listOwnOrderEvidence(
  context: Context<any>,
): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  const page = await listBuyerOrderEvidence(
    context.env.DB,
    buyer,
    {
      limit: parseBuyerOrderEvidencePageLimit(
        context.req.query('limit'),
      ),
      cursor: decodeOrderEvidenceCursor(
        context.req.query('cursor'),
      ),
    },
  );
  return success(context, page);
}

async function getOwnOrderEvidence(
  context: Context<any>,
): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  const orderEvidence = await getBuyerOrderEvidence(
    context.env.DB,
    buyer,
    requireRouteId(context),
  );
  return success(context, { order_evidence: orderEvidence });
}

async function resubmitOrderEvidence(
  context: Context<any>,
): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  const submissionId = requireRouteId(context);
  const body = parseResubmitBody(await readBoundedJson(
    context.req.raw,
    SUBMIT_BODY_LIMIT_BYTES,
  ));
  const reservationId = await requireBuyerOrderEvidenceReservationId(
    context.env.DB,
    buyer,
    submissionId,
  );
  const result = await submitOrderEvidence(
    context.env.DB,
    {
      reservationId,
      expectedVersion: body.expected_version,
      marketplace: buyer.marketplaceCode,
      amazonOrderNumber: body.amazon_order_number,
      amazonOrderDate: body.amazon_order_date,
      finalPaidJpy: body.final_paid_jpy,
      evidenceFileObjectIds: body.file_object_ids,
      buyerNote: body.buyer_note ?? null,
    },
    {
      actor: buyer,
      idempotencyKey: requireIdempotencyKey(context),
      requestId: requestIdFromContext(context),
    },
  );
  const response: BuyerOrderEvidenceMutationDto = {
    order_evidence: await getBuyerOrderEvidence(
      context.env.DB,
      buyer,
      result.submission_id,
    ),
    replayed: result.replayed,
  };
  return success(context, response);
}

async function withdrawOwnOrderEvidence(
  context: Context<any>,
): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  const submissionId = requireRouteId(context);
  const body = parseWithdrawBody(await readBoundedJson(
    context.req.raw,
    WITHDRAW_BODY_LIMIT_BYTES,
  ));
  const result = await withdrawOrderEvidence(
    context.env.DB,
    {
      submissionId,
      expectedVersion: body.expected_version,
    },
    {
      actor: buyer,
      idempotencyKey: requireIdempotencyKey(context),
      requestId: requestIdFromContext(context),
    },
  );
  const response: BuyerOrderEvidenceMutationDto = {
    order_evidence: await getBuyerOrderEvidence(
      context.env.DB,
      buyer,
      result.submission_id,
    ),
    replayed: result.replayed,
  };
  return success(context, response);
}

async function createOrderEvidenceFileReadIntent(
  context: Context<any>,
): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  const session = requireCustomerSessionFromContext(context);
  const source = await requireBuyerOrderEvidenceFileLink(
    context.env.DB,
    buyer,
    requireRouteId(context),
    requireFileLinkRouteId(context),
  );
  const body = parseReadIntentBody(await readBoundedJson(
    context.req.raw,
    WITHDRAW_BODY_LIMIT_BYTES,
  ));
  if (source.fileVersion !== body.expected_file_version) {
    throw new BuyerOrderEvidencePortalError('VERSION_CONFLICT', 409);
  }
  const result = await createFileReadIntent(
    context.env.DB,
    buyerOrderEvidenceFileAuthorization,
    {
      fileObjectId: source.fileObjectId,
      fileEntityLinkId: source.fileEntityLinkId,
      expectedFileVersion: body.expected_file_version,
    },
    {
      actor: {
        type: 'BUYER_CUSTOMER',
        id: buyer.buyerCustomerId,
        roles: [],
      },
      principal: {
        type: 'BUYER_SESSION',
        accountId: session.accountId,
        identitySubjectId: session.identitySubjectId,
      },
      idempotencyKey: requireIdempotencyKey(context),
      requestId: requestIdFromContext(context),
    },
  );
  const response: BuyerOrderEvidenceFileReadIntentDto = {
    read_intent_id: result.readIntentId,
    file_object_id: result.fileObjectId,
    access_token: result.accessToken,
    access_token_available: result.accessTokenAvailable,
    expires_at: result.expiresAt,
    replayed: result.replayed,
  };
  return success(context, response, result.replayed ? 200 : 201);
}

function parseSubmitBody(
  value: unknown,
): SubmitBuyerOrderEvidenceRequest {
  const body = requireRecord(value);
  requireAllowedKeys(body, [
    'reservation_id',
    'expected_version',
    'amazon_order_number',
    'amazon_order_date',
    'final_paid_jpy',
    'file_object_ids',
    'buyer_note',
  ], [
    'reservation_id',
    'expected_version',
    'amazon_order_number',
    'amazon_order_date',
    'final_paid_jpy',
    'file_object_ids',
  ]);
  if (body['expected_version'] !== 0) {
    validationError();
  }
  return {
    reservation_id: identifier(body['reservation_id']),
    expected_version: 0,
    amazon_order_number: orderNumber(body['amazon_order_number']),
    amazon_order_date: dateOnly(body['amazon_order_date']),
    final_paid_jpy: finalPaidJpy(body['final_paid_jpy']),
    file_object_ids: fileObjectIds(body['file_object_ids']),
    ...(Object.hasOwn(body, 'buyer_note')
      ? { buyer_note: optionalText(body['buyer_note']) }
      : {}),
  };
}

function parseResubmitBody(
  value: unknown,
): ResubmitBuyerOrderEvidenceRequest {
  const body = requireRecord(value);
  requireAllowedKeys(body, [
    'expected_version',
    'amazon_order_number',
    'amazon_order_date',
    'final_paid_jpy',
    'file_object_ids',
    'buyer_note',
  ], [
    'expected_version',
    'amazon_order_number',
    'amazon_order_date',
    'final_paid_jpy',
    'file_object_ids',
  ]);
  return {
    expected_version: positiveVersion(body['expected_version']),
    amazon_order_number: orderNumber(body['amazon_order_number']),
    amazon_order_date: dateOnly(body['amazon_order_date']),
    final_paid_jpy: finalPaidJpy(body['final_paid_jpy']),
    file_object_ids: fileObjectIds(body['file_object_ids']),
    ...(Object.hasOwn(body, 'buyer_note')
      ? { buyer_note: optionalText(body['buyer_note']) }
      : {}),
  };
}

function parseWithdrawBody(
  value: unknown,
): WithdrawBuyerOrderEvidenceRequest {
  const body = requireRecord(value);
  requireAllowedKeys(
    body,
    ['expected_version'],
    ['expected_version'],
  );
  return {
    expected_version: positiveVersion(body['expected_version']),
  };
}

function parseReadIntentBody(
  value: unknown,
): CreateBuyerOrderEvidenceFileReadIntentRequest {
  const body = requireRecord(value);
  requireAllowedKeys(
    body,
    ['expected_file_version'],
    ['expected_file_version'],
  );
  return {
    expected_file_version: positiveVersion(
      body['expected_file_version'],
    ),
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value
    || typeof value !== 'object'
    || Array.isArray(value)) {
    return validationError();
  }
  return value as Record<string, unknown>;
}

function requireAllowedKeys(
  body: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(body).some((key) => !allowedSet.has(key))
    || required.some((key) => !Object.hasOwn(body, key))) {
    validationError();
  }
}

function identifier(value: unknown): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > MAX_IDENTIFIER_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    return validationError();
  }
  return value;
}

function orderNumber(value: unknown): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > 100) {
    return validationError();
  }
  return value;
}

function dateOnly(value: unknown): string {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return validationError();
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month! - 1
    || date.getUTCDate() !== day) {
    return validationError();
  }
  return value;
}

function finalPaidJpy(value: unknown): number {
  if (!Number.isSafeInteger(value)
    || Number(value) < 0
    || Number(value) > Number.MAX_SAFE_INTEGER) {
    return validationError();
  }
  return Number(value);
}

function positiveVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    return validationError();
  }
  return Number(value);
}

function fileObjectIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)
    || value.length < 1
    || value.length > MAX_FILE_OBJECTS) {
    return validationError();
  }
  const ids = value.map(identifier);
  if (new Set(ids).size !== ids.length) {
    return validationError();
  }
  return Object.freeze(ids);
}

function optionalText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 2000) {
    return validationError();
  }
  return value;
}

function requireRouteId(context: Context<any>): string {
  const value = context.req.param('id');
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > MAX_IDENTIFIER_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new BuyerOrderEvidencePortalError('NOT_FOUND', 404);
  }
  return value;
}

function requireFileLinkRouteId(context: Context<any>): string {
  const value = context.req.param('fileLinkId');
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > MAX_IDENTIFIER_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new BuyerOrderEvidencePortalError('NOT_FOUND', 404);
  }
  return value;
}

function requireIdempotencyKey(context: Context<any>): string {
  const value = parseIdempotencyKey(
    context.req.header('Idempotency-Key'),
  );
  if (!value) return validationError();
  return value;
}

function validationError(): never {
  throw new BuyerOrderEvidencePortalError(
    'VALIDATION_ERROR',
    400,
  );
}

function withBuyerOrderEvidenceErrors(
  handler: (context: Context<any>) => Promise<Response>,
) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      return buyerOrderEvidencePortalFailure(
        context,
        normalizeBuyerOrderEvidencePortalError(error),
      );
    }
  };
}

function success<T>(
  context: Context<any>,
  data: T,
  status: 200 | 201 = 200,
): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(
    apiSuccess(data, requestIdFromContext(context)),
    status,
  );
}
