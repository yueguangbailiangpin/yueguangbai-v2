import type { AssignmentStaffAuthorization } from '../src/staff-assignment';
import { confirmFormalOrderForTest as confirmFormalOrder } from './confirm-formal-order-fixture';
import type { SqliteDatabase } from '@ygb/testkit';
import { bindPhase3GEvidenceFixture,seedPhase3GInstructionFixture } from './phase3g-test-fixtures';
import { sha256Hex } from '@ygb/domain';
import type { FilePurpose,FileVisibility } from '@ygb/contracts';
import { recordSellerPayment } from '../src/seller-settlements/record-payment';
import { allocateSellerPayment } from '../src/seller-settlements/allocation-commands';

export const COLD_ARCHIVE_CONFIRMED_AT=Date.UTC(2026,7,1,0,0,0);

export const coldArchiveOwner:AssignmentStaffAuthorization={
  staffId:'cold-archive-owner',displayName:'归档负责人',staffStatus:'ACTIVE',authorizationVersion:1,
  roles:new Set(['owner']),permissions:new Set(['ORDER_CONFIRM','SCHEDULED_OPERATIONS_RUN','SELLER_SETTLEMENT_RECORD']),
  memberTeamIds:[],leaderTeamIds:[],
};

export async function seedConfirmedColdArchiveOrder(db:SqliteDatabase,suffix:string,options:{
  buyerCustomerId?:string;
}={}):Promise<{
  formalOrderId:string;sellerOrganizationId:string;
}>{
  const sellerOrganizationId=`cold-seller-${suffix}`;
  const orderTail=String([...suffix].reduce((sum,value)=>sum+value.charCodeAt(0),0)).padStart(7,'0').slice(-7);
  const sellerSequence=9400+(Number(orderTail)%500);
  // Stage 6.6: buyers carry their final YYYYMMDD+B/C+digits number from
  // creation; the migration-seeded 'B' channel provides the numbering code.
  const buyerSequence=10000+(Number(orderTail)%90000);
  const existingBuyer=options.buyerCustomerId
    ? await db.prepare('SELECT buyer_customer_no FROM buyer_customers WHERE id=?')
      .bind(options.buyerCustomerId)
      .first<{buyer_customer_no:string}>()
    : null;
  if(options.buyerCustomerId&&!existingBuyer)throw new Error('cold_archive_buyer_missing');
  const buyerCustomerNo=existingBuyer?.buyer_customer_no??`20260801B${buyerSequence}`;
  const sellerMemberId=`cold-seller-member-${suffix}`;
  const buyerId=options.buyerCustomerId??`cold-buyer-${suffix}`;
  const reservationId=`cold-reservation-${suffix}`;
  const productId=`cold-product-${suffix}`;
  const productVersionId=`cold-product-version-${suffix}`;
  const submissionId=`cold-evidence-submission-${suffix}`;
  const evidenceVersionId=`cold-evidence-version-${suffix}`;
  const buyerSubjectSql=existingBuyer?'':`,('cold-buyer-subject-${suffix}','BUYER_CUSTOMER',1000)`;
  const buyerCustomerSql=existingBuyer?'':`
    INSERT INTO buyer_customers(id,identity_subject_id,marketplace_code,buyer_channel_id,buyer_customer_no,buyer_sequence,
      display_name,access_status,identity_review_status,version,created_at,updated_at,activated_at,disabled_at)
    VALUES('${buyerId}','cold-buyer-subject-${suffix}','AMAZON_JP','buyer-channel-wechat-b','${buyerCustomerNo}',${buyerSequence},
      '归档测试买家','ACTIVE','CLEAR',1,1000,1000,1000,NULL);
  `;
  db.exec(`
    INSERT OR IGNORE INTO staff_users(id,display_name,status,authorization_version,version,created_at,updated_at,disabled_at)
    VALUES('cold-archive-owner','归档负责人','ACTIVE',1,1,1000,1000,NULL);
    INSERT OR IGNORE INTO staff_role_assignments(staff_id,role_code,status,assigned_by_staff_id,assigned_at,revoked_at,created_at,updated_at)
    VALUES('cold-archive-owner','owner','ACTIVE',NULL,1000,NULL,1000,1000);
    INSERT INTO seller_organizations(id,marketplace_code,seller_code,origin_channel_id,current_channel_id,seller_sequence,
      organization_name,status,version,created_at,updated_at,activated_at,disabled_at,next_member_number)
    VALUES('${sellerOrganizationId}','AMAZON_JP','ido-mango-${sellerSequence}','seller-channel-ido-mango','seller-channel-ido-mango',${sellerSequence},
      '归档测试卖家','ACTIVE',1,1000,1000,1000,NULL,2);
    INSERT INTO customer_identity_subjects(id,subject_type,created_at) VALUES
      ('cold-seller-subject-${suffix}','SELLER_ORG_MEMBER',1000)${buyerSubjectSql};
    INSERT INTO seller_organization_members(id,identity_subject_id,organization_id,member_number,username_fallback,
      display_name,role,primary_owner,status,version,created_at,updated_at,activated_at,disabled_at)
    VALUES('${sellerMemberId}','cold-seller-subject-${suffix}','${sellerOrganizationId}',1,'cold-seller-${suffix}-1',
      '负责人','OWNER',1,'ACTIVE',1,1000,1000,1000,NULL);
    INSERT OR IGNORE INTO buyer_channels(id,code,name,status,next_sequence,version,created_at,updated_at,disabled_at)
    VALUES('buyer-channel-wechat-b','B','买家微信对接渠道 B','ACTIVE',1,1,1000,1000,NULL);
    ${buyerCustomerSql}
    INSERT INTO seller_stores(id,organization_id,marketplace_code,display_name,normalized_name,status,version,created_at,updated_at,disabled_at)
    VALUES('cold-store-${suffix}','${sellerOrganizationId}','AMAZON_JP','归档测试店铺','归档测试店铺','ACTIVE',1,1000,1000,NULL);
    INSERT INTO products(id,organization_id,store_id,marketplace_code,asin_display,asin_normalized,status,current_version_no,
      version,created_at,updated_at,disabled_at)
    VALUES('${productId}','${sellerOrganizationId}','cold-store-${suffix}','AMAZON_JP','B0COLD${orderTail.slice(-4)}',
      'B0COLD${orderTail.slice(-4)}','ACTIVE',1,1,1000,1000,NULL);
    INSERT INTO product_versions(id,product_id,version_no,product_name,search_keywords_json,product_url,buyer_visible_notes,
      internal_notes,created_by_staff_id,created_at,ordering_guide_expected_amount_jpy,color_spec_mode)
    VALUES('${productVersionId}','${productId}',1,'归档测试产品','[]',NULL,NULL,NULL,'cold-archive-owner',1000,1980,'MAIN_IMAGE_VARIANT');
    INSERT INTO demand_batches(id,organization_id,store_id,marketplace_code,product_id,product_version_no,submitted_by_member_id,
      task_type,target_quantity,buyer_visible_notes,seller_notes,open_at,reservation_deadline,order_deadline,status,review_reason,
      close_reason,reviewed_by_staff_id,closed_by_staff_id,version,submitted_at,updated_at,reviewed_at,published_at,withdrawn_at,
      closed_at,held_reservation_count,approved_reservation_count)
    VALUES('cold-demand-${suffix}','${sellerOrganizationId}','cold-store-${suffix}','AMAZON_JP','${productId}',1,'${sellerMemberId}',
      'IMAGE',1,NULL,NULL,2000,5000,20000,'PUBLISHED',NULL,NULL,'cold-archive-owner',NULL,2,1000,3000,3000,3000,NULL,NULL,0,1);
    INSERT INTO product_reservations(id,demand_batch_id,buyer_customer_id,organization_id,store_id,product_id,product_version_no,
      marketplace_code,status,precheck_snapshot_json,hold_expires_at,order_deadline_snapshot,version,submitted_at,updated_at,
      decided_by_staff_id,decision_reason,decided_at,cancelled_at,expired_at,reopened_count,buyer_self_pay_bps_snapshot,
      reference_order_amount_jpy_snapshot,estimated_self_pay_jpy_snapshot,estimated_refundable_principal_jpy_snapshot,
      buyer_self_pay_accepted_at,buyer_self_pay_accepted_demand_version)
    VALUES('${reservationId}','cold-demand-${suffix}','${buyerId}','${sellerOrganizationId}','cold-store-${suffix}','${productId}',1,
      'AMAZON_JP','APPROVED','{}',5000,20000,2,4000,6000,'cold-archive-owner',NULL,6000,NULL,NULL,0,0,1980,0,1980,4000,2);
  `);
  const instruction=await seedPhase3GInstructionFixture(db,{suffix:`cold-${suffix}`,reservationId,buyerCustomerId:buyerId,
    productId,productVersionId,staffId:'cold-archive-owner'});
  db.exec(`
    INSERT INTO order_evidence_submissions(id,reservation_id,buyer_customer_id,marketplace_code,status,current_version_no,
      version,public_change_reason,internal_review_note,submitted_at,updated_at,verified_by_staff_id,verified_at,withdrawn_at,
      consumed_at,created_at)
    VALUES('${submissionId}','${reservationId}','${buyerId}','AMAZON_JP','PENDING_VERIFICATION',1,1,NULL,NULL,7000,7000,NULL,NULL,NULL,NULL,7000);
    INSERT INTO order_evidence_versions(id,submission_id,reservation_id,buyer_customer_id,marketplace_code,version_no,
      amazon_order_number_raw,amazon_order_number_normalized,amazon_order_date,final_paid_jpy,submitted_by_buyer_id,buyer_note,
      order_instruction_id,order_instruction_version_id,instruction_deadline_snapshot,reference_order_amount_jpy_snapshot,
      buyer_self_pay_bps_snapshot,buyer_self_pay_jpy,buyer_refundable_principal_jpy,price_mismatch,price_difference_jpy,
      submitted_before_deadline,created_at)
    VALUES('${evidenceVersionId}','${submissionId}','${reservationId}','${buyerId}','AMAZON_JP',1,
      '123-1234567-${orderTail}','123-1234567-${orderTail}','2026-08-01',
      1980,'${buyerId}',NULL,'${instruction.instructionId}','${instruction.instructionVersionId}',${instruction.deadlineAt},
      1980,0,0,1980,0,0,1,7000);
    UPDATE order_evidence_submissions SET status='VERIFIED',version=2,verified_by_staff_id='cold-archive-owner',
      verified_at=8000,updated_at=8000 WHERE id='${submissionId}';
    INSERT INTO buyer_daily_currency_rate_versions(id,business_date,source_currency_code,quote_currency_code,version_no,
      rate_value,rate_scale,rounding_rule,effective_from,created_by_staff_id,created_at)
    SELECT 'cold-buyer-rate','2026-08-01','JPY','CNY',1,5500000,100000000,'HALF_UP',2000,'cold-archive-owner',2000
    WHERE NOT EXISTS(SELECT 1 FROM buyer_daily_currency_rate_versions WHERE business_date='2026-08-01' AND version_no=1);
    INSERT INTO seller_principal_rate_policy_versions(
      id,scope_type,seller_organization_id,source_currency_code,quote_currency_code,
      version_no,markup_rate_value,rate_scale,effective_from,created_by_staff_id,created_at)
    VALUES('cold-principal-policy-${suffix}','SELLER_ORGANIZATION','${sellerOrganizationId}',
      'JPY','CNY',1,500000,100000000,3000,'cold-archive-owner',2000);
    INSERT INTO seller_service_fee_rule_versions(id,seller_organization_id,marketplace_code,review_type,version_no,
      fee_amount_minor,fee_currency_code,fee_currency_exponent,effective_from,created_by_staff_id,created_at)
    VALUES('cold-service-fee-${suffix}','${sellerOrganizationId}','AMAZON_JP','IMAGE',1,2500,'CNY',2,3000,'cold-archive-owner',2000);
  `);
  await bindPhase3GEvidenceFixture(db,{suffix:`cold-${suffix}`,submissionId,evidenceVersionId,reservationId,
    buyerCustomerId:buyerId,evidenceFileObjectId:instruction.evidenceFileObjectId,
    amazonOrderNumber:`123-1234567-${orderTail}`});
  const order=await confirmFormalOrder(db,{orderEvidenceSubmissionId:submissionId,expectedVersion:2},{actor:{
    staffId:coldArchiveOwner.staffId,displayName:coldArchiveOwner.displayName,roles:['owner'],permissions:coldArchiveOwner.permissions},
    idempotencyKey:`cold-confirm-${suffix}`,now:COLD_ARCHIVE_CONFIRMED_AT});
  return {formalOrderId:order.formal_order_id,sellerOrganizationId};
}

export async function seedColdArchiveFile(db:SqliteDatabase,input:{suffix:string;formalOrderId?:string;
  bytes:Uint8Array<ArrayBuffer>;purpose?:FilePurpose;visibility?:FileVisibility}):Promise<{fileId:string;objectKey:string;version:number;sha256:string}>{
  const purpose=input.purpose??'ORDER_EVIDENCE';const visibility=input.visibility??'INTERNAL_ONLY';
  const fileId=`cold-file-${input.suffix}`;const intentId=`cold-intent-${input.suffix}`;
  const objectKey=`files/v1/2026/08/order-evidence/${input.suffix.replace(/[^a-z0-9-]/giu,'-').padEnd(40,'x')}`;
  const sha256=await sha256Hex(input.bytes);
  await db.prepare(`INSERT INTO file_upload_intents(id,owner_actor_type,owner_actor_id,purpose,visibility,status,
    requested_file_count,manifest_hash,version,expires_at,failure_code,created_at,updated_at,completed_at)
    VALUES(?,'STAFF','cold-archive-owner',?,?,'ISSUED',1,?,1,9999999999999,NULL,1000,1000,NULL)`)
    .bind(intentId,purpose,visibility,'a'.repeat(64)).run();
  await db.prepare(`INSERT INTO file_objects(id,upload_intent_id,slot_no,purpose,visibility,object_key,client_file_name,
    extension,declared_mime,expected_byte_size,status,upload_token_hash,upload_expires_at,uploaded_byte_size,detected_mime,
    uploaded_sha256,failure_code,delete_attempt_count,next_delete_at,version,created_at,updated_at,uploaded_at,verified_at,deleted_at)
    VALUES(?,?,1,?,?,?,'evidence.png','png','image/png',?,'RESERVED',?,9999999999999,NULL,NULL,NULL,NULL,0,NULL,1,1000,1000,NULL,NULL,NULL)`)
    .bind(fileId,intentId,purpose,visibility,objectKey,input.bytes.byteLength,'b'.repeat(64)).run();
  await db.prepare(`UPDATE file_upload_intents SET status='VERIFIED',version=2,updated_at=1002,completed_at=1002 WHERE id=?`)
    .bind(intentId).run();
  await db.prepare(`UPDATE file_objects SET status='VERIFIED',uploaded_byte_size=?,detected_mime='image/png',uploaded_sha256=?,
    version=2,updated_at=1002,uploaded_at=1001,verified_at=1002 WHERE id=?`).bind(input.bytes.byteLength,sha256,fileId).run();
  if(input.formalOrderId)await db.prepare(`INSERT INTO file_entity_links(id,file_object_id,entity_type,entity_id,purpose,visibility,
      linked_by_actor_type,linked_by_actor_id,created_at,authorization_mode,expires_at,revoked_at)
      VALUES(?,?,'ORDER',?,?,?,'STAFF','cold-archive-owner',1003,'LEGACY_VISIBILITY',NULL,NULL)`)
      .bind(`cold-link-${input.suffix}`,fileId,input.formalOrderId,purpose,visibility).run();
  return {fileId,objectKey,version:2,sha256};
}

export async function settleColdArchivePrincipal(db:SqliteDatabase,input:{suffix:string;formalOrderId:string;
  sellerOrganizationId:string;proofBytes:Uint8Array<ArrayBuffer>}):Promise<{completedAt:number;fileId:string;objectKey:string;sha256:string;version:number}>{
  const payable=await db.prepare(`SELECT payable_id,amount_cny_fen FROM seller_payable_balances
    WHERE formal_order_id=? AND payable_type='SELLER_PRINCIPAL'`).bind(input.formalOrderId)
    .first<{payable_id:string;amount_cny_fen:number}>();
  if(!payable)throw new Error('cold_archive_principal_missing');
  const proof=await seedColdArchiveFile(db,{suffix:`proof-${input.suffix}`,
    bytes:input.proofBytes,purpose:'SELLER_SETTLEMENT_PROOF'});
  const payment=await recordSellerPayment(db,{sellerOrganizationId:input.sellerOrganizationId,
    amountCnyFen:String(payable.amount_cny_fen),paidAt:COLD_ARCHIVE_CONFIRMED_AT+10_000,
    proofFile:{fileObjectId:proof.fileId,expectedFileVersion:proof.version}},{actor:coldArchiveOwner,
      idempotencyKey:`cold-payment-${input.suffix}`,now:COLD_ARCHIVE_CONFIRMED_AT+10_000});
  await allocateSellerPayment(db,{paymentId:payment.paymentId,payableId:payable.payable_id,
    amountCnyFen:String(payable.amount_cny_fen),expectedPaymentVersion:1},{actor:coldArchiveOwner,
      idempotencyKey:`cold-allocation-${input.suffix}`,now:COLD_ARCHIVE_CONFIRMED_AT+20_000});
  return {completedAt:COLD_ARCHIVE_CONFIRMED_AT+20_000,...proof};
}
