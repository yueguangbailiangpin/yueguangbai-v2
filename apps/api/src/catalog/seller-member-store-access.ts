import type { SellerMemberRole,SqlDatabase } from '@ygb/contracts';
import { canWriteSellerOperations } from '@ygb/domain';

interface SellerMemberAccessRow {
  member_id:string;organization_id:string;member_role:SellerMemberRole;member_status:string;organization_status:string;
}
interface StoreIdRow { store_id:string }
export interface SellerMemberStoreAccess {
  memberId:string;sellerOrganizationId:string;role:SellerMemberRole;allActiveStores:boolean;storeIds:readonly string[];canManageProducts:boolean;
}

/**
 * D-056 §4.4: every ACTIVE member of a seller organization sees all ACTIVE
 * stores of the organization. Store grant/scope tables are retired, so the
 * storeIds projection is role-independent and only membership status gates
 * access. Member management/settings remain OWNER-only; the existing
 * operational-write capability is resolved by the shared Seller policy.
 */
export async function resolveSellerMemberStoreAccess(database:SqlDatabase,memberId:string):Promise<SellerMemberStoreAccess|null>{
  const member=await database.prepare(`SELECT member.id AS member_id,member.organization_id,member.role AS member_role,
      member.status AS member_status,organization.status AS organization_status
    FROM seller_organization_members member JOIN seller_organizations organization ON organization.id=member.organization_id
    WHERE member.id=?`).bind(memberId).first<SellerMemberAccessRow>();
  if(!member||member.member_status!=='ACTIVE'||member.organization_status!=='ACTIVE')return null;
  const stores=await database.prepare(`SELECT id AS store_id FROM seller_stores WHERE organization_id=? AND status='ACTIVE' ORDER BY id`).bind(member.organization_id).all<StoreIdRow>();
  return Object.freeze({
    memberId:member.member_id,sellerOrganizationId:member.organization_id,role:member.member_role,allActiveStores:true,
    storeIds:Object.freeze(stores.results.map((row)=>row.store_id)),
    canManageProducts:canWriteSellerOperations(member.member_role),
  });
}
