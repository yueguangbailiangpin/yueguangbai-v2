import type {
  FileActor,
  FilePurpose,
  FileReadPrincipal,
  FileVisibility,
  StaffDataScope,
  StaffPermissionCode,
  SqlDatabase,
} from '@ygb/contracts';
import {
  scopeAllowsBuyer,
  scopeAllowsSellerOrganization,
  type AssignmentStaffAuthorization,
} from '../staff-assignment';
import type { FileAuthorizationResource,FileAuthorizationService } from './authorization';
import { FileStorageError } from './file-error';

export class RouteBoundFileAuthorizationService implements FileAuthorizationService {
  constructor(
    private readonly database:SqlDatabase,
    private readonly actor:FileActor,
    private readonly allowedUploads:ReadonlyMap<FilePurpose,FileVisibility>,
    private readonly principal?:FileReadPrincipal,
    private readonly staffAuthorization?:AssignmentStaffAuthorization,
    private readonly staffDataScope?:StaffDataScope,
  ){}

  assertCanCreateUpload(actor:FileActor,input:{purpose:FilePurpose;visibility:FileVisibility}):void{
    this.assertActor(actor);if(this.allowedUploads.get(input.purpose)!==input.visibility)deny();this.assertStaffUploadPermission(input.purpose);
  }
  assertCanUpload(actor:FileActor,resource:FileAuthorizationResource):void{this.assertOwnedUpload(actor,resource);}
  assertCanCompleteUpload(actor:FileActor,resource:FileAuthorizationResource):void{this.assertOwnedUpload(actor,resource);}
  assertCanLink():never{deny();}
  async assertCanRead(actor:FileActor,resource:FileAuthorizationResource):Promise<void>{
    this.assertActor(actor);
    if(resource.linkRevokedAt!==null||(resource.linkExpiresAt!==undefined&&resource.linkExpiresAt!==null&&resource.linkExpiresAt<=Date.now()))deny();
    if(resource.ownerActorType===actor.type&&resource.ownerActorId===actor.id)return;
    if(actor.type!=='STAFF'||!this.staffAuthorization||!this.staffDataScope||this.principal?.type!=='STAFF_SESSION'||this.principal.staffId!==actor.id)deny();
    if(!this.staffAuthorization.permissions.has(readPermissionForPurpose(resource.purpose)))deny();
    await this.assertStaffEntityScope(resource);
  }
  private assertActor(actor:FileActor):void{if(actor.type!==this.actor.type||actor.id!==this.actor.id)deny();}
  private assertOwnedUpload(actor:FileActor,resource:FileAuthorizationResource):void{
    this.assertActor(actor);if(resource.ownerActorType!==actor.type||resource.ownerActorId!==actor.id||this.allowedUploads.get(resource.purpose)!==resource.visibility)deny();this.assertStaffUploadPermission(resource.purpose);
  }
  private assertStaffUploadPermission(purpose:FilePurpose):void{if(this.actor.type!=='STAFF')return;if(!this.staffAuthorization?.permissions.has(writePermissionForPurpose(purpose)))deny();}
  private async assertStaffEntityScope(resource:FileAuthorizationResource):Promise<void>{
    if(!resource.entityType||!resource.entityId||!this.staffDataScope)concealNotFound();if(this.staffDataScope.type==='GLOBAL')return;
    const authority=await resolveEntityAuthority(this.database,resource.entityType,resource.entityId);
    if(authority.buyerCustomerId&&scopeAllowsBuyer(this.staffDataScope,authority.buyerCustomerId))return;
    if(authority.sellerOrganizationId&&scopeAllowsSellerOrganization(this.staffDataScope,authority.sellerOrganizationId))return;
    concealNotFound();
  }
}

function readPermissionForPurpose(purpose:FilePurpose):StaffPermissionCode{switch(purpose){
  case 'ORDER_EVIDENCE':case 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION':case 'ORDER_INSTRUCTION_KEYWORD_IMAGE':return 'ORDER_VIEW';
  case 'REVIEW_EVIDENCE':return 'REVIEW_VIEW';case 'PRODUCT_APPLICATION_IMAGE':case 'PRODUCT_IMAGE':return 'PRODUCT_VIEW';
  case 'BUYER_REFUND_PROOF':return 'BUYER_REFUND_VIEW';case 'SELLER_SETTLEMENT_PROOF':return 'SELLER_SETTLEMENT_VIEW';default:return 'AUDIT_VIEW';
}}
function writePermissionForPurpose(purpose:FilePurpose):StaffPermissionCode{switch(purpose){
  case 'ORDER_EVIDENCE_INTERNAL_COMMUNICATION':return 'ORDER_CONFIRM';case 'BUYER_REFUND_PROOF':return 'BUYER_REFUND_RECORD';case 'SELLER_SETTLEMENT_PROOF':return 'SELLER_SETTLEMENT_RECORD';default:return readPermissionForPurpose(purpose);
}}

async function resolveEntityAuthority(database:SqlDatabase,entityType:string,entityId:string):Promise<{buyerCustomerId:string|null;sellerOrganizationId:string|null}>{
  switch(entityType){
    case 'ORDER':return authority(await database.prepare(`SELECT buyer_customer_id,seller_organization_id FROM formal_orders WHERE id=?
      UNION ALL SELECT submission.buyer_customer_id,reservation.organization_id AS seller_organization_id FROM order_evidence_versions version
      JOIN order_evidence_submissions submission ON submission.id=version.submission_id JOIN product_reservations reservation ON reservation.id=submission.reservation_id
      WHERE version.id=? LIMIT 1`).bind(entityId,entityId).first<AuthorityRow>());
    case 'ORDER_EVIDENCE_SUBMISSION':return authority(await database.prepare(`SELECT submission.buyer_customer_id,reservation.organization_id AS seller_organization_id FROM order_evidence_submissions submission JOIN product_reservations reservation ON reservation.id=submission.reservation_id WHERE submission.id=?`).bind(entityId).first<AuthorityRow>());
    case 'ORDER_INSTRUCTION_VERSION':return authority(await database.prepare(`SELECT instruction.buyer_customer_id,reservation.organization_id AS seller_organization_id FROM order_instruction_versions version JOIN order_instructions instruction ON instruction.id=version.instruction_id JOIN product_reservations reservation ON reservation.id=instruction.reservation_id WHERE version.id=?`).bind(entityId).first<AuthorityRow>());
    case 'REVIEW':return authority(await database.prepare(`SELECT review.buyer_customer_id,formal_order.seller_organization_id FROM review_cases review JOIN formal_orders formal_order ON formal_order.id=review.formal_order_id WHERE review.id=?`).bind(entityId).first<AuthorityRow>());
    case 'BUYER_REFUND':return authority(await database.prepare(`
      SELECT obligation.buyer_customer_id,formal_order.seller_organization_id
      FROM buyer_refund_obligations obligation JOIN formal_orders formal_order ON formal_order.id=obligation.formal_order_id WHERE obligation.id=?
      UNION ALL
      SELECT obligation.buyer_customer_id,formal_order.seller_organization_id
      FROM buyer_refund_payment_entries payment JOIN buyer_refund_obligations obligation ON obligation.id=payment.obligation_id JOIN formal_orders formal_order ON formal_order.id=obligation.formal_order_id WHERE payment.id=?
      UNION ALL
      SELECT advance.buyer_customer_id,formal_order.seller_organization_id
      FROM buyer_advance_principal_entries advance JOIN formal_orders formal_order ON formal_order.id=advance.formal_order_id WHERE advance.id=?
      LIMIT 1`).bind(entityId,entityId,entityId).first<AuthorityRow>());
    case 'SELLER_SETTLEMENT':return authority(await database.prepare(`SELECT NULL AS buyer_customer_id,seller_organization_id FROM seller_payments WHERE id=? UNION ALL SELECT NULL AS buyer_customer_id,seller_organization_id FROM seller_payables WHERE id=? LIMIT 1`).bind(entityId,entityId).first<AuthorityRow>());
    case 'PRODUCT_APPLICATION':return authority(await database.prepare(`SELECT NULL AS buyer_customer_id,seller_organization_id FROM product_applications WHERE id=?`).bind(entityId).first<AuthorityRow>());
    default:return{buyerCustomerId:null,sellerOrganizationId:null};
  }
}
interface AuthorityRow{buyer_customer_id:string|null;seller_organization_id:string|null}
function authority(row:AuthorityRow|null){return{buyerCustomerId:row?.buyer_customer_id??null,sellerOrganizationId:row?.seller_organization_id??null};}
function deny():never{throw new FileStorageError('FORBIDDEN',403)}
function concealNotFound():never{throw new FileStorageError('NOT_FOUND',404)}
