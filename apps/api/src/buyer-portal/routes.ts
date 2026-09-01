import {
  apiSuccess,
  type BuyerPortalReservationMutationDto,
} from '@ygb/contracts';
import {
  parseIdempotencyKey,
  readBoundedJson,
} from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { requestIdFromContext } from '../http-auth/errors';
import { customerSessionMiddleware } from '../middleware/customer-auth';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import { cancelReservation } from '../reservations/cancel-reservation';
import { submitReservation } from '../reservations/submit-reservation';
import { readReservationAutoApproveConfig } from '../reservations/auto-approve';
import {
  requireBuyerPortalContext,
  toBuyerPortalMeDto,
} from './buyer-context';
import {
  BuyerPortalError,
  buyerPortalFailure,
  normalizeBuyerPortalError,
} from './errors';
import {
  decodeDemandCursor,
  decodeReservationCursor,
  parsePageLimit,
} from './pagination';
import {
  parseBuyerRefundAccountInput,
  updateBuyerRefundAccount,
} from './update-refund-account';
import {
  getBuyerPortalDemand,
  getBuyerPortalReservation,
  listBuyerPortalDemands,
  listBuyerPortalReservations,
} from './read-model';

const CREATE_BODY_LIMIT_BYTES = 1024;
const CANCEL_BODY_LIMIT_BYTES = 2048;
const REFUND_ACCOUNT_BODY_LIMIT_BYTES = 1024;

export function registerBuyerPortalRoutes(
  app: Hono<any>,
): void {
  const session = customerSessionMiddleware();

  app.get(
    '/api/buyer-portal/me',
    session,
    withBuyerPortalErrors(me),
  );
  app.patch(
    '/api/buyer-portal/me/refund-account',
    customerAuthOriginGuard(),
    session,
    withBuyerPortalErrors(updateRefundAccount),
  );
  app.get(
    '/api/buyer-portal/demands',
    session,
    withBuyerPortalErrors(listDemands),
  );
  app.get(
    '/api/buyer-portal/demands/:id',
    session,
    withBuyerPortalErrors(getDemand),
  );
  app.post(
    '/api/buyer-portal/demands/:id/reservations',
    customerAuthOriginGuard(),
    session,
    withBuyerPortalErrors(createReservation),
  );
  app.get(
    '/api/buyer-portal/reservations',
    session,
    withBuyerPortalErrors(listReservations),
  );
  app.get(
    '/api/buyer-portal/reservations/:id',
    session,
    withBuyerPortalErrors(getReservation),
  );
  app.post(
    '/api/buyer-portal/reservations/:id/cancel',
    customerAuthOriginGuard(),
    session,
    withBuyerPortalErrors(cancelOwnReservation),
  );
}

async function me(context: Context<any>): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  return success(context, toBuyerPortalMeDto(buyer));
}

async function updateRefundAccount(
  context: Context<any>,
): Promise<Response> {
  const body = await readBoundedJson(
    context.req.raw,
    REFUND_ACCOUNT_BODY_LIMIT_BYTES,
  );
  const input = parseBuyerRefundAccountInput(body);
  const buyer = await requireBuyerPortalContext(context);
  await updateBuyerRefundAccount(
    context.env.DB,
    buyer.buyerCustomerId,
    input,
    Date.now(),
  );
  const updated = await requireBuyerPortalContext(context);
  return success(context, toBuyerPortalMeDto(updated));
}

async function listDemands(
  context: Context<any>,
): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  const page = await listBuyerPortalDemands(
    context.env.DB,
    buyer,
    {
      now: Date.now(),
      limit: parsePageLimit(context.req.query('limit')),
      cursor: decodeDemandCursor(
        context.req.query('cursor'),
      ),
    },
  );
  return success(context, page);
}

async function getDemand(
  context: Context<any>,
): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  const demandId = requireRouteId(context);
  const demand = await getBuyerPortalDemand(
    context.env.DB,
    buyer,
    demandId,
    Date.now(),
  );
  return success(context, { demand });
}

async function createReservation(
  context: Context<any>,
): Promise<Response> {
  const body = await readBoundedJson(
    context.req.raw,
    CREATE_BODY_LIMIT_BYTES,
  );
  const acceptance = parseReservationAcceptance(body);
  const buyer = await requireBuyerPortalContext(context);
  const demandBatchId = requireRouteId(context);
  const idempotencyKey = requireIdempotencyKey(context);
  const result = await submitReservation(
    context.env.DB,
    {
      demandBatchId,
      expectedDemandVersion: acceptance.expectedDemandVersion,
      acceptedBuyerSelfPayBps: acceptance.acceptedBuyerSelfPayBps,
    },
    {
      actor: buyer,
      idempotencyKey,
      requestId: requestIdFromContext(context),
      autoApprove: readReservationAutoApproveConfig(
        context.env as Record<string, unknown>,
      ),
    },
  );
  const reservation = await getBuyerPortalReservation(
    context.env.DB,
    buyer,
    result.reservation_id,
  );
  const response: BuyerPortalReservationMutationDto = {
    reservation,
    replayed: result.replayed,
  };
  context.header('Cache-Control', 'no-store');
  return context.json(
    apiSuccess(response, requestIdFromContext(context)),
    result.replayed ? 200 : 201,
  );
}

async function listReservations(
  context: Context<any>,
): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  const page = await listBuyerPortalReservations(
    context.env.DB,
    buyer,
    {
      limit: parsePageLimit(context.req.query('limit')),
      cursor: decodeReservationCursor(
        context.req.query('cursor'),
      ),
    },
  );
  return success(context, page);
}

async function getReservation(
  context: Context<any>,
): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  const reservationId = requireRouteId(context);
  const reservation = await getBuyerPortalReservation(
    context.env.DB,
    buyer,
    reservationId,
  );
  return success(context, { reservation });
}

async function cancelOwnReservation(
  context: Context<any>,
): Promise<Response> {
  const buyer = await requireBuyerPortalContext(context);
  const reservationId = requireRouteId(context);
  const body = await readBoundedJson(
    context.req.raw,
    CANCEL_BODY_LIMIT_BYTES,
  );
  if (!body
    || Object.keys(body).length !== 1
    || !Object.hasOwn(body, 'expected_version')
    || !Number.isSafeInteger(body['expected_version'])
    || Number(body['expected_version']) < 1) {
    throw new BuyerPortalError('VALIDATION_ERROR', 400);
  }

  const result = await cancelReservation(
    context.env.DB,
    {
      reservationId,
      expectedVersion: Number(body['expected_version']),
    },
    {
      actor: buyer,
      idempotencyKey: requireIdempotencyKey(context),
      requestId: requestIdFromContext(context),
    },
  );
  const reservation = await getBuyerPortalReservation(
    context.env.DB,
    buyer,
    result.reservation_id,
  );
  const response: BuyerPortalReservationMutationDto = {
    reservation,
    replayed: result.replayed,
  };
  return success(context, response);
}

function parseReservationAcceptance(value: unknown): {
  expectedDemandVersion: number;
  acceptedBuyerSelfPayBps: number;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BuyerPortalError('VALIDATION_ERROR', 400);
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 2
    || !Number.isSafeInteger(body['expected_demand_version'])
    || Number(body['expected_demand_version']) < 1
    || !Number.isSafeInteger(body['accepted_buyer_self_pay_bps'])
    || Number(body['accepted_buyer_self_pay_bps']) < 0
    || Number(body['accepted_buyer_self_pay_bps']) > 10_000) {
    throw new BuyerPortalError('VALIDATION_ERROR', 400);
  }
  return {
    expectedDemandVersion: Number(body['expected_demand_version']),
    acceptedBuyerSelfPayBps: Number(body['accepted_buyer_self_pay_bps']),
  };
}

function requireRouteId(
  context: Context<any>,
): string {
  const value = context.req.param('id');
  if (typeof value !== 'string' || value.length === 0) {
    throw new BuyerPortalError('NOT_FOUND', 404);
  }
  return value;
}

function requireIdempotencyKey(
  context: Context<any>,
): string {
  const value = parseIdempotencyKey(
    context.req.header('Idempotency-Key'),
  );
  if (!value) {
    throw new BuyerPortalError('VALIDATION_ERROR', 400);
  }
  return value;
}

function withBuyerPortalErrors(
  handler: (context: Context<any>) => Promise<Response>,
) {
  return async (context: Context<any>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      return buyerPortalFailure(
        context,
        normalizeBuyerPortalError(error),
      );
    }
  };
}

function success<T>(
  context: Context<any>,
  data: T,
): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(
    apiSuccess(data, requestIdFromContext(context)),
  );
}
