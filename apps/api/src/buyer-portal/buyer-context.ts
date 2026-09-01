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
  refund_account_name: string | null;
  refund_account_identifier: string | null;
}

export interface BuyerPortalContext
  extends BuyerDemandContext,
    BuyerReservationActor {
  customerNumber: string | null;
  displayName: string;
  refundAccountName: string | null;
  refundAccountIdentifier: string | null;
  preSalesOwnerDisplayName?: string | null;
  refundOwnerDisplayName?: string | null;
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

  const owners = await loadOwnerDisplayNames(
    context.env.DB,
    buyer.buyer_customer_id,
  );
  return {
    buyerCustomerId: buyer.buyer_customer_id,
    marketplaceCode: buyer.marketplace_code,
    accessStatus: buyer.access_status,
    identityReviewStatus: buyer.identity_review_status,
    customerNumber: buyer.buyer_customer_no,
    displayName: buyer.display_name,
    refundAccountName: buyer.refund_account_name,
    refundAccountIdentifier: buyer.refund_account_identifier,
    preSalesOwnerDisplayName: owners.preSalesOwnerDisplayName,
    refundOwnerDisplayName: owners.refundOwnerDisplayName,
    sessionExpiresAt: session.expiresAt,
  };
}

export function toBuyerPortalMeDto(
  buyer: BuyerPortalContext,
): BuyerPortalMeDto {
  return {
    assigned_contacts: {
      pre_sales_owner_display_name: buyer.preSalesOwnerDisplayName ?? null,
      refund_owner_display_name: buyer.refundOwnerDisplayName ?? null,
    },
    buyer: {
      display_name: buyer.displayName,
      marketplace_code: buyer.marketplaceCode,
      identity_review_status: buyer.identityReviewStatus,
      customer_number: buyer.customerNumber,
      refund_account_name: buyer.refundAccountName,
      refund_account_identifier: buyer.refundAccountIdentifier,
    },
  };
}

async function loadOwnerDisplayNames(
  database: SqlDatabase,
  buyerCustomerId: string,
): Promise<{ preSalesOwnerDisplayName: string | null; refundOwnerDisplayName: string | null }> {
  const rows = await database.prepare(`
    SELECT assignment.duty_code, staff.display_name
    FROM buyer_staff_assignments assignment
    JOIN staff_users staff ON staff.id=assignment.staff_id AND staff.status='ACTIVE'
    WHERE assignment.buyer_customer_id=? AND assignment.status='ACTIVE'
      AND assignment.duty_code IN ('BUYER_PRE_SALES_OWNER','BUYER_REFUND_OWNER')
  `).bind(buyerCustomerId)
    .all<{ duty_code: string; display_name: string }>();
  let preSalesOwnerDisplayName: string | null = null;
  let refundOwnerDisplayName: string | null = null;
  for (const row of rows.results) {
    if (row.duty_code === 'BUYER_PRE_SALES_OWNER') {
      preSalesOwnerDisplayName ??= row.display_name;
    } else if (row.duty_code === 'BUYER_REFUND_OWNER') {
      refundOwnerDisplayName ??= row.display_name;
    }
  }
  return { preSalesOwnerDisplayName, refundOwnerDisplayName };
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
        WHEN 'AMAZON_JP' THEN 'AMAZON_JP'
        ELSE assignment.marketplace_code
      END AS marketplace_code,
      access_status,
      identity_review_status,
      refund_account_name,
      refund_account_identifier
    FROM buyer_customers buyer
    JOIN buyer_marketplace_assignments assignment
      ON assignment.buyer_customer_id=buyer.id
    WHERE buyer.identity_subject_id=?
    LIMIT 1
  `).bind(identitySubjectId).first<BuyerContextRow>();
}
