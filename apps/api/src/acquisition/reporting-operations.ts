import type { SqlDatabase } from '@ygb/contracts';
import { parseChinaBusinessDate } from '@ygb/domain';
import { createAuditEventStatement } from '../foundation/audit';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';
import { AcquisitionError } from './errors';
import { requireAcquisitionOperator } from './authorization';

export async function readReportingPrecisionConfig(database:SqlDatabase,actor:AssignmentStaffAuthorization){
  requireOwner(actor);
  const row=await database.prepare(`SELECT precision_started_business_date,activated_at,activated_by_staff_id,version,updated_at
    FROM acquisition_reporting_config WHERE singleton_id=1`).first<any>();
  if(!row)throw new AcquisitionError('DEPENDENCY_UNAVAILABLE',503);
  return Object.freeze({
    precision_started_business_date:row.precision_started_business_date as string|null,
    activated_at:row.activated_at===null?null:Number(row.activated_at),
    activated_by_staff_id:row.activated_by_staff_id as string|null,
    version:Number(row.version),updated_at:Number(row.updated_at),
  });
}

export async function activateReportingPrecisionBoundary(
  database:SqlDatabase,
  actor:AssignmentStaffAuthorization,
  input:{businessDate:string;expectedVersion:number},
){
  requireOwner(actor);
  let businessDate:string;
  try{businessDate=parseChinaBusinessDate(input.businessDate);}catch{throw new AcquisitionError('VALIDATION_ERROR',400);}
  if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1)throw new AcquisitionError('VALIDATION_ERROR',400);
  const current=await readReportingPrecisionConfig(database,actor);
  if(current.precision_started_business_date!==null){
    if(current.precision_started_business_date===businessDate)return current;
    throw new AcquisitionError('STATE_CONFLICT',409);
  }
  if(current.version!==input.expectedVersion)throw new AcquisitionError('VERSION_CONFLICT',409);
  const now=Date.now();
  await database.batch([
    database.prepare(`UPDATE acquisition_reporting_config
      SET precision_started_business_date=?,activated_at=?,activated_by_staff_id=?,version=version+1,updated_at=?
      WHERE singleton_id=1 AND version=? AND precision_started_business_date IS NULL`)
      .bind(businessDate,now,actor.staffId,now,input.expectedVersion),
    database.prepare(`INSERT OR IGNORE INTO acquisition_historical_source_exemptions(
      id,subject_type,subject_id,marketplace_code,reason,declared_at,declared_by_staff_id
    ) SELECT 'hist-buyer-'||lower(hex(randomblob(16))),'BUYER_CUSTOMER',buyer.id,
      COALESCE(assignment.marketplace_code,'AMAZON_JP'),'PRE_PRECISION_EXISTING_CUSTOMER',?,?
      FROM buyer_customers buyer
      LEFT JOIN buyer_marketplace_assignments assignment ON assignment.buyer_customer_id=buyer.id`)
      .bind(now,actor.staffId),
    database.prepare(`INSERT OR IGNORE INTO acquisition_historical_source_exemptions(
      id,subject_type,subject_id,marketplace_code,reason,declared_at,declared_by_staff_id
    ) SELECT 'hist-seller-'||lower(hex(randomblob(16))),'SELLER_ORGANIZATION',organization.id,
      CASE organization.marketplace_code WHEN 'JP' THEN 'AMAZON_JP' ELSE organization.marketplace_code END,
      'PRE_PRECISION_EXISTING_CUSTOMER',?,?
      FROM seller_organizations organization`)
      .bind(now,actor.staffId),
    createAuditEventStatement(database,{
      id:crypto.randomUUID(),aggregateType:'ACQUISITION_REPORTING',aggregateId:'precision-boundary',
      eventType:'ACQUISITION_REPORTING_PRECISION_ACTIVATED',
      actor:{type:'STAFF',id:actor.staffId,roles:[...actor.roles]},requestId:null,idempotencyKey:null,
      previousState:{precision_started_business_date:null,version:current.version},
      nextState:{precision_started_business_date:businessDate,version:current.version+1},createdAt:now,
    }),
    database.prepare(`INSERT INTO transaction_assertions(assertion_value)
      SELECT CASE WHEN EXISTS(
        SELECT 1 FROM acquisition_reporting_config
        WHERE singleton_id=1 AND precision_started_business_date=? AND version=?
      ) THEN 1 ELSE 0 END`).bind(businessDate,current.version+1),
  ]);
  return readReportingPrecisionConfig(database,actor);
}

export async function listSourceCorrectionCandidates(
  database:SqlDatabase,
  actor:AssignmentStaffAuthorization,
  limit=100,
){
  requireAcquisitionOperator(actor);
  if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw new AcquisitionError('VALIDATION_ERROR',400);
  const markets=actor.roles.has('owner')?[]:await resolveStaffMarketplaceCodes(database,actor);
  if(!actor.roles.has('owner')&&markets.length===0)return Object.freeze([]);
  const where=markets.length?`WHERE fact.marketplace_code IN (${markets.map(()=>'?').join(',')})`:'';
  const rows=await database.prepare(`SELECT fact.lead_id,lead.lead_type,fact.marketplace_code,fact.business_date,
      lead.display_name,lead.wechat_masked,fact.original_channel_id,
      original.display_name AS original_channel_name,
      COALESCE((SELECT correction.new_channel_id FROM acquisition_lead_source_corrections correction
        WHERE correction.lead_id=fact.lead_id ORDER BY correction.corrected_at DESC,correction.id DESC LIMIT 1),
        fact.original_channel_id) AS effective_channel_id,
      COALESCE((SELECT channel.display_name FROM acquisition_lead_source_corrections correction
        JOIN acquisition_channels channel ON channel.id=correction.new_channel_id
        WHERE correction.lead_id=fact.lead_id ORDER BY correction.corrected_at DESC,correction.id DESC LIMIT 1),
        original.display_name) AS effective_channel_name,
      (SELECT COUNT(*) FROM acquisition_lead_source_corrections correction WHERE correction.lead_id=fact.lead_id) AS correction_count
    FROM acquisition_customer_intake_facts fact
    JOIN acquisition_leads lead ON lead.id=fact.lead_id
    JOIN acquisition_channels original ON original.id=fact.original_channel_id
    ${where}
    ORDER BY fact.recorded_at DESC,fact.lead_id DESC LIMIT ?`)
    .bind(...markets,limit).all<any>();
  return Object.freeze(rows.results.map((row)=>Object.freeze({
    lead_id:String(row.lead_id),lead_type:row.lead_type as 'BUYER'|'SELLER',marketplace_code:String(row.marketplace_code),
    business_date:String(row.business_date),display_name:row.display_name===null?null:String(row.display_name),
    wechat_masked:String(row.wechat_masked),original_channel_id:String(row.original_channel_id),
    original_channel_name:String(row.original_channel_name),effective_channel_id:String(row.effective_channel_id),
    effective_channel_name:String(row.effective_channel_name),correction_count:Number(row.correction_count),
  }))));
}

export async function correctLeadSource(
  database:SqlDatabase,
  actor:AssignmentStaffAuthorization,
  input:{leadId:string;newChannelId:string;reason:string},
){
  requireAcquisitionOperator(actor);
  const reason=input.reason.normalize('NFKC').trim();
  if(reason.length<3||reason.length>1000)throw new AcquisitionError('VALIDATION_ERROR',400);
  const lead=await database.prepare(`SELECT lead.id,lead.lead_type,lead.marketplace_code,fact.original_channel_id
    FROM acquisition_leads lead JOIN acquisition_customer_intake_facts fact ON fact.lead_id=lead.id
    WHERE lead.id=?`).bind(clean(input.leadId)).first<any>();
  if(!lead)throw new AcquisitionError('NOT_FOUND',404);
  await requireMarket(database,actor,String(lead.marketplace_code));
  const channel=await database.prepare(`SELECT id,lead_type,marketplace_code,display_name,status
    FROM acquisition_channels WHERE id=?`).bind(clean(input.newChannelId)).first<any>();
  if(!channel||String(channel.marketplace_code)!==String(lead.marketplace_code)
    ||!(channel.lead_type===lead.lead_type||channel.lead_type==='BOTH'))throw new AcquisitionError('VALIDATION_ERROR',400);
  const current=await effectiveChannel(database,String(lead.id),String(lead.original_channel_id));
  if(current===String(channel.id))throw new AcquisitionError('STATE_CONFLICT',409);
  const now=Date.now();const correctionId=crypto.randomUUID();
  await database.batch([
    database.prepare(`INSERT INTO acquisition_lead_source_corrections(
      id,lead_id,previous_channel_id,new_channel_id,reason,corrected_by_staff_id,corrected_at
    ) VALUES(?,?,?,?,?,?,?)`).bind(correctionId,lead.id,current,channel.id,reason,actor.staffId,now),
    createAuditEventStatement(database,{
      id:crypto.randomUUID(),aggregateType:'ACQUISITION_LEAD',aggregateId:String(lead.id),
      eventType:'ACQUISITION_SOURCE_CORRECTED',actor:{type:'STAFF',id:actor.staffId,roles:[...actor.roles]},
      requestId:null,idempotencyKey:null,previousState:{channel_id:current},
      nextState:{channel_id:String(channel.id),channel_name:String(channel.display_name)},reason,createdAt:now,
    }),
  ]);
  return Object.freeze({correction_id:correctionId,lead_id:String(lead.id),previous_channel_id:current,
    new_channel_id:String(channel.id),new_channel_name:String(channel.display_name),reason,corrected_at:now});
}

async function effectiveChannel(database:SqlDatabase,leadId:string,original:string):Promise<string>{
  const row=await database.prepare(`SELECT new_channel_id FROM acquisition_lead_source_corrections
    WHERE lead_id=? ORDER BY corrected_at DESC,id DESC LIMIT 1`).bind(leadId).first<{new_channel_id:string}>();
  return row?.new_channel_id??original;
}
async function requireMarket(database:SqlDatabase,actor:AssignmentStaffAuthorization,market:string){
  if(actor.roles.has('owner'))return;const markets=await resolveStaffMarketplaceCodes(database,actor);
  if(!markets.includes(market))throw new AcquisitionError('FORBIDDEN',403);
}
function requireOwner(actor:AssignmentStaffAuthorization){
  if(!actor.roles.has('owner')||!actor.permissions.has('ACQUISITION_ADMIN'))throw new AcquisitionError('FORBIDDEN',403);
}
function clean(value:string){const v=value.normalize('NFKC').trim();if(v.length<1||v.length>200||/[\u0000-\u001f\u007f]/u.test(v))throw new AcquisitionError('VALIDATION_ERROR',400);return v;}
