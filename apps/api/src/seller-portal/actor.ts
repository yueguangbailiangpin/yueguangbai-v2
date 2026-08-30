import type { SellerMemberRole, SellerPortalMeDto, SqlDatabase } from '@ygb/contracts';
import { canWriteSellerOperations } from '@ygb/domain';
import type { Context } from 'hono';
import { resolveSellerMemberStoreAccess } from '../catalog/seller-member-store-access';
import { requireCustomerSessionFromContext } from '../middleware/customer-auth';
import { SellerPortalError } from './errors';

interface SellerMemberRow {
  member_id: string;
  organization_id: string;
  display_name: string;
  role: SellerMemberRole;
  primary_owner: number;
  member_status: string;
  seller_code: string;
  organization_name: string;
  marketplace_code: 'AMAZON_JP';
  organization_status: string;
  settlement_account_name: string | null;
  settlement_account_identifier: string | null;
}
export interface SellerPortalActor {
  accountId: string;
  identitySubjectId: string;
  memberId: string;
  sellerOrganizationId: string;
  role: SellerMemberRole;
  storeIds: readonly string[];
  allActiveStores: boolean;
  canManageProducts: boolean;
  me: SellerPortalMeDto;
}

export async function resolveSellerPortalActor(context: Context<any>): Promise<SellerPortalActor> {
  const session = requireCustomerSessionFromContext(context);
  if (session.accountType !== 'SELLER_MEMBER') throw new SellerPortalError('FORBIDDEN', 403);
  const row = await requireSellerMemberByIdentity(context.env.DB, session.identitySubjectId);
  const access = await resolveSellerMemberStoreAccess(context.env.DB, row.member_id);
  if (!access || access.sellerOrganizationId !== row.organization_id || access.role !== row.role)
    throw new SellerPortalError('SESSION_INVALID', 401);
  const canWrite = access.canManageProducts
    && canWriteSellerOperations(access.role);
  const me: SellerPortalMeDto = Object.freeze({
    account_id: session.accountId,
    member: Object.freeze({
      id: row.member_id,
      display_name: row.display_name,
      role: row.role,
      primary_owner: Number(row.primary_owner) === 1,
    }),
    organization: Object.freeze({
      id: row.organization_id,
      seller_code: row.seller_code,
      name: row.organization_name,
      marketplace_code: row.marketplace_code,
      status: 'ACTIVE' as const,
      settlement_account_name: row.settlement_account_name,
      settlement_account_identifier: row.settlement_account_identifier,
    }),
    access: Object.freeze({
      read_scope: access.allActiveStores ? ('ORGANIZATION' as const) : ('ASSIGNED_STORES' as const),
      store_ids: Object.freeze([...access.storeIds]),
      can_submit_product_applications: canWrite,
      can_submit_demand_batches: canWrite,
    }),
  });
  return Object.freeze({
    accountId: session.accountId,
    identitySubjectId: session.identitySubjectId,
    memberId: access.memberId,
    sellerOrganizationId: access.sellerOrganizationId,
    role: access.role,
    storeIds: access.storeIds,
    allActiveStores: access.allActiveStores,
    canManageProducts: access.canManageProducts,
    me,
  });
}

export function requireSellerPortalWriteRole(actor: SellerPortalActor): void {
  if (!actor.canManageProducts || !canWriteSellerOperations(actor.role))
    throw new SellerPortalError('FORBIDDEN', 403);
}

async function requireSellerMemberByIdentity(
  database: SqlDatabase,
  identitySubjectId: string,
): Promise<SellerMemberRow> {
  const rows = await database
    .prepare(
      `SELECT member.id AS member_id,member.organization_id,member.display_name,member.role,member.primary_owner,
      member.status AS member_status,organization.seller_code,organization.organization_name,organization.marketplace_code,organization.status AS organization_status,
      organization.settlement_account_name,organization.settlement_account_identifier
    FROM seller_organization_members member JOIN seller_organizations organization ON organization.id=member.organization_id
    WHERE member.identity_subject_id=? AND member.status='ACTIVE' AND organization.status='ACTIVE'
    ORDER BY member.organization_id,member.id LIMIT 2`,
    )
    .bind(identitySubjectId)
    .all<SellerMemberRow>();
  // Current Seller Portal does not yet expose an organization selector. Never
  // pick a random organization if a future multi-market identity has >1 active
  // membership; fail closed until the explicit selector is implemented.
  if (rows.results.length !== 1) throw new SellerPortalError('SESSION_INVALID', 401);
  return rows.results[0]!;
}
