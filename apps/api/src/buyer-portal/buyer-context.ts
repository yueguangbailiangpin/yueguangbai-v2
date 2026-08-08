import type {
  BuyerPortalMeDto,
  MarketplaceCode,
  SqlDatabase,
} from '@ygb/contracts';
import type { Context } from 'hono';
import type { BuyerDemandContext } from '../demand-batches/demand-shared';
import { requireCustomerSessionFromContext } from '../middleware/customer-auth';
import type { BuyerReservationActor } from '../reservations/reservation-shared';
import { BuyerPortalError } from './errors';

interface BuyerContextRow {
  buyer_customer_id: string;
  buyer_customer_no: string | null;
  display_name: string;
  marketplace_code: MarketplaceCode;
  access_status: 'ACTIVE' | 'DISABLED';
  identity_review_status: 'CLEAR' | 'REVIEW_REQUIRED';
}

export interface BuyerPortalContext
  extends BuyerDemandContext,
    BuyerReservationActor {
  customerNumber: string | null;
  displayName: string;
  sessionExpiresAt: number;
}

export async function requireBuyerPortalContext(
  context: Context<any>,
): Promise<BuyerPortalContext> {
  const session = requireCustomerSessionFromContext(context);
  if (session.accountType !== 'BUYER') {
    throw new BuyerPortalError('FORBIDDEN', 403);
  }

  const buyer = await loadBuyerContext(
    context.env.DB,
    session.identitySubjectId,
  );
  if (!buyer || buyer.access_status !== 'ACTIVE') {
    throw new BuyerPortalError('SESSION_INVALID', 401);
  }

  return {
    buyerCustomerId: buyer.buyer_customer_id,
    marketplaceCode: buyer.marketplace_code,
    accessStatus: buyer.access_status,
    identityReviewStatus: buyer.identity_review_status,
    customerNumber: buyer.buyer_customer_no,
    displayName: buyer.display_name,
    sessionExpiresAt: session.expiresAt,
  };
}

export function toBuyerPortalMeDto(
  buyer: BuyerPortalContext,
): BuyerPortalMeDto {
  return {
    buyer: {
      display_name: buyer.displayName,
      marketplace_code: buyer.marketplaceCode,
      identity_review_status: buyer.identityReviewStatus,
    },
  };
}

async function loadBuyerContext(
  database: SqlDatabase,
  identitySubjectId: string,
): Promise<BuyerContextRow | null> {
  return database.prepare(`
    SELECT
      id AS buyer_customer_id,
      buyer_customer_no,
      display_name,
      CASE assignment.marketplace_code
        WHEN 'AMAZON_JP' THEN 'JP'
        ELSE assignment.marketplace_code
      END AS marketplace_code,
      access_status,
      identity_review_status
    FROM buyer_customers buyer
    JOIN buyer_marketplace_assignments assignment
      ON assignment.buyer_customer_id=buyer.id
    WHERE buyer.identity_subject_id=?
    LIMIT 1
  `).bind(identitySubjectId).first<BuyerContextRow>();
}
