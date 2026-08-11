import {
  isStaffPermissionCode,
  type FileActor,
  type FileReadPrincipal,
  type SqlDatabase,
  type StaffPermissionCode,
} from '@ygb/contracts';
import { canonicalMarketplaceCode } from '@ygb/domain';
import { resolveSellerMemberStoreAccess } from '../catalog/seller-member-store-access';
import { resolveAssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';
import type { FileAuthorizationResource, FileAuthorizationService } from './authorization';
import { FileStorageError } from './file-error';
import { cleanFileIdentifier } from './file-records';

interface StaffGrantRow { staff_permission_code:string }
interface SellerScope { organizationId:string; storeId:string|null }

/**
 * Explicit file authorization follows the same live authority as business data:
 * role says what Staff may do, Marketplace says where, entity ownership says which
 * business object. TEAM/Department grants are legacy storage metadata only and no
 * longer expand or restrict the current Staff authority.
 */
export async function authorizeFileRead(
  database:SqlDatabase,
  legacyAuthorization:FileAuthorizationService,
  actor:FileActor,
  principal:FileReadPrincipal|undefined,
  resource:FileAuthorizationResource,
  now:number,
):Promise<void>{
  if((resource.linkAuthorizationMode??'LEGACY_VISIBILITY')==='LEGACY_VISIBILITY'){
    await legacyAuthorization.assertCanRead(actor,resource);return;
  }
  if(!principal||!resource.fileEntityLinkId)deny();
  await authorizeExplicitAudienceRead(database,principal,actor,resource,now);
}

export async function authorizeExplicitAudienceRead(
  database:SqlDatabase,
  principal:FileReadPrincipal,
  actor:FileActor,
  resource:FileAuthorizationResource,
  now=Date.now(),
):Promise<void>{
  if(!Number.isSafeInteger(now)||now<0||resource.linkAuthorizationMode!=='EXPLICIT_AUDIENCES'||!resource.fileEntityLinkId)deny();
  const linkId=cleanFileIdentifier(resource.fileEntityLinkId,120);
  if(principal.type==='BUYER_SESSION'){
    if(actor.type!=='BUYER_CUSTOMER'||resource.visibility!=='BUYER_VISIBLE')deny();
    if(!await activeBuyerGrantExists(database,linkId,principal,now))deny();
    return;
  }
  if(principal.type==='SELLER_SESSION'){
    if(actor.type!=='SELLER_MEMBER'||resource.visibility!=='SELLER_VISIBLE')deny();
    if(!await activeSellerGrantExists(database,linkId,principal,actor.id,resource,now))deny();
    return;
  }
  if(actor.type!=='STAFF'||actor.id!==principal.staffId)deny();
  await authorizeStaff(database,linkId,principal.staffId,resource,now);
}

async function activeBuyerGrantExists(
  database:SqlDatabase,linkId:string,
  principal:Extract<FileReadPrincipal,{type:'BUYER_SESSION'}>,now:number,
):Promise<boolean>{
  const row=await database.prepare(`SELECT 1 AS allowed
    FROM customer_login_accounts account
    JOIN customer_account_personas persona ON persona.account_id=account.id AND persona.persona_type='BUYER'
    JOIN buyer_customers buyer ON buyer.id=persona.buyer_customer_id AND buyer.identity_subject_id=account.identity_subject_id
    JOIN file_entity_audience_grants grant ON grant.file_entity_link_id=? AND grant.subject_type='BUYER' AND grant.buyer_customer_id=buyer.id
    JOIN file_entity_links link ON link.id=grant.file_entity_link_id
    WHERE account.id=? AND account.identity_subject_id=? AND account.status='ACTIVE' AND buyer.access_status='ACTIVE'
      AND link.authorization_mode='EXPLICIT_AUDIENCES' AND link.revoked_at IS NULL
      AND (link.expires_at IS NULL OR link.expires_at>?) AND grant.revoked_at IS NULL
      AND (grant.expires_at IS NULL OR grant.expires_at>?) LIMIT 1`)
    .bind(linkId,principal.accountId,principal.identitySubjectId,now,now).first<{allowed:number}>();
  return Number(row?.allowed)===1;
}

async function activeSellerGrantExists(
  database:SqlDatabase,linkId:string,
  principal:Extract<FileReadPrincipal,{type:'SELLER_SESSION'}>,actorMemberId:string,
  resource:FileAuthorizationResource,now:number,
):Promise<boolean>{
  const memberId=cleanFileIdentifier(actorMemberId,120);
  const persona=await database.prepare(`SELECT member.id,member.organization_id
    FROM customer_login_accounts account
    JOIN customer_account_personas persona ON persona.account_id=account.id AND persona.persona_type='SELLER_MEMBER'
    JOIN seller_organization_members member ON member.id=persona.seller_member_id AND member.identity_subject_id=account.identity_subject_id
    JOIN seller_organizations organization ON organization.id=member.organization_id
    WHERE account.id=? AND account.identity_subject_id=? AND member.id=?
      AND account.status='ACTIVE' AND member.status='ACTIVE' AND organization.status='ACTIVE'`)
    .bind(principal.accountId,principal.identitySubjectId,memberId).first<{id:string;organization_id:string}>();
  if(!persona)return false;
  const scope=await resolveSellerEntityScope(database,resource);
  if(!scope||scope.organizationId!==persona.organization_id)return false;
  const grant=await database.prepare(`SELECT 1 AS allowed FROM file_entity_audience_grants grant
    JOIN file_entity_links link ON link.id=grant.file_entity_link_id
    WHERE grant.file_entity_link_id=? AND grant.subject_type='SELLER_ORGANIZATION'
      AND grant.seller_organization_id=? AND grant.revoked_at IS NULL
      AND (grant.expires_at IS NULL OR grant.expires_at>?)
      AND link.authorization_mode='EXPLICIT_AUDIENCES' AND link.visibility='SELLER_VISIBLE'
      AND link.revoked_at IS NULL AND (link.expires_at IS NULL OR link.expires_at>?) LIMIT 1`)
    .bind(linkId,persona.organization_id,now,now).first<{allowed:number}>();
  if(Number(grant?.allowed)!==1)return false;
  const access=await resolveSellerMemberStoreAccess(database,memberId);
  if(!access||access.sellerOrganizationId!==persona.organization_id)return false;
  if(scope.storeId===null)return access.role==='OWNER';
  return access.allActiveStores||access.storeIds.includes(scope.storeId);
}

async function authorizeStaff(
  database:SqlDatabase,linkId:string,staffIdRaw:string,
  resource:FileAuthorizationResource,now:number,
):Promise<void>{
  const staffId=cleanFileIdentifier(staffIdRaw,120);
  const authorization=await resolveAssignmentStaffAuthorization(database,staffId);
  if(!authorization||authorization.staffStatus!=='ACTIVE')deny();
  const grants=await database.prepare(`SELECT grant.staff_permission_code
    FROM file_entity_audience_grants grant JOIN file_entity_links link ON link.id=grant.file_entity_link_id
    WHERE grant.file_entity_link_id=? AND grant.subject_type='STAFF_INTERNAL'
      AND grant.revoked_at IS NULL AND (grant.expires_at IS NULL OR grant.expires_at>?)
      AND link.authorization_mode='EXPLICIT_AUDIENCES' AND link.revoked_at IS NULL
      AND (link.expires_at IS NULL OR link.expires_at>?)`).bind(linkId,now,now).all<StaffGrantRow>();
  const permission=grants.results.find((row)=>isStaffPermissionCode(row.staff_permission_code)
    &&authorization.permissions.has(row.staff_permission_code as StaffPermissionCode));
  if(!permission)deny();
  if(authorization.roles.has('owner'))return;
  const market=await resolveResourceMarketplace(database,resource);
  if(!market)deny();
  const allowed=await resolveStaffMarketplaceCodes(database,authorization);
  if(!allowed.includes(market))deny();
}

async function resolveResourceMarketplace(database:SqlDatabase,resource:FileAuthorizationResource):Promise<string|null>{
  if(!resource.entityType||!resource.entityId)return null;
  const id=resource.entityId;
  let raw:string|null=null;
  if(resource.entityType==='ORDER'){
    raw=(await database.prepare(`SELECT COALESCE(canonical_marketplace_code,marketplace_code) AS market FROM formal_orders WHERE id=?`).bind(id).first<{market:string}>())?.market??null;
  }else if(resource.entityType==='ORDER_EVIDENCE_SUBMISSION'){
    raw=(await database.prepare(`SELECT COALESCE(formal_order.canonical_marketplace_code,submission.marketplace_code) AS market
      FROM order_evidence_submissions submission LEFT JOIN formal_orders formal_order ON formal_order.order_evidence_submission_id=submission.id
      WHERE submission.id=?`).bind(id).first<{market:string}>())?.market??null;
  }else if(resource.entityType==='REVIEW'){
    raw=(await database.prepare(`SELECT formal_order.canonical_marketplace_code AS market FROM review_cases review_case
      JOIN formal_orders formal_order ON formal_order.id=review_case.formal_order_id WHERE review_case.id=?`).bind(id).first<{market:string}>())?.market??null;
  }else if(resource.entityType==='BUYER_REFUND'){
    raw=(await database.prepare(`SELECT formal_order.canonical_marketplace_code AS market FROM buyer_refund_payment_entries payment
      JOIN buyer_refund_obligations obligation ON obligation.id=payment.obligation_id
      JOIN formal_orders formal_order ON formal_order.id=obligation.formal_order_id WHERE payment.id=?`).bind(id).first<{market:string}>())?.market??null;
  }else if(resource.entityType==='SELLER_SETTLEMENT'){
    raw=(await database.prepare(`SELECT organization.marketplace_code AS market FROM seller_payments payment
      JOIN seller_organizations organization ON organization.id=payment.seller_organization_id WHERE payment.id=?`).bind(id).first<{market:string}>())?.market??null;
  }else if(resource.entityType==='PRODUCT_APPLICATION'){
    raw=(await database.prepare(`SELECT organization.marketplace_code AS market FROM product_applications application
      JOIN seller_organizations organization ON organization.id=application.organization_id WHERE application.id=?`).bind(id).first<{market:string}>())?.market??null;
  }else if(resource.entityType==='PRODUCT_VERSION'){
    raw=(await database.prepare(`SELECT product.marketplace_code AS market FROM product_versions version
      JOIN products product ON product.id=version.product_id WHERE version.id=?`).bind(id).first<{market:string}>())?.market??null;
  }else if(resource.entityType==='ORDER_INSTRUCTION_VERSION'){
    raw=(await database.prepare(`SELECT formal_order.canonical_marketplace_code AS market FROM formal_orders formal_order
      WHERE formal_order.order_instruction_version_id=? LIMIT 1`).bind(id).first<{market:string}>())?.market??null;
  }
  if(!raw)return null;
  try{return canonicalMarketplaceCode(raw);}catch{return null;}
}

async function resolveSellerEntityScope(database:SqlDatabase,resource:FileAuthorizationResource):Promise<SellerScope|null>{
  if(!resource.entityType||!resource.entityId)return null;const id=resource.entityId;
  if(resource.entityType==='PRODUCT_APPLICATION')return database.prepare(`SELECT organization_id AS organizationId,store_id AS storeId FROM product_applications WHERE id=?`).bind(id).first<SellerScope>();
  if(resource.entityType==='PRODUCT_VERSION')return database.prepare(`SELECT product.organization_id AS organizationId,product.store_id AS storeId FROM product_versions version JOIN products product ON product.id=version.product_id WHERE version.id=?`).bind(id).first<SellerScope>();
  if(resource.entityType==='REVIEW')return database.prepare(`SELECT formal_order.seller_organization_id AS organizationId,formal_order.store_id AS storeId FROM review_cases review_case JOIN formal_orders formal_order ON formal_order.id=review_case.formal_order_id WHERE review_case.id=?`).bind(id).first<SellerScope>();
  if(resource.entityType==='ORDER')return database.prepare(`SELECT seller_organization_id AS organizationId,store_id AS storeId FROM formal_orders WHERE id=?`).bind(id).first<SellerScope>();
  if(resource.entityType==='ORDER_EVIDENCE_SUBMISSION')return database.prepare(`SELECT seller_organization_id AS organizationId,store_id AS storeId FROM formal_orders WHERE order_evidence_submission_id=?`).bind(id).first<SellerScope>();
  return null;
}
function deny():never{throw new FileStorageError('FORBIDDEN',403);}
