import type { AcquisitionLeadType, AcquisitionProspectDto, SqlDatabase } from '@ygb/contracts';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';
import { AcquisitionError } from './errors';

interface Row {
  id:string;lead_type:AcquisitionLeadType;marketplace_code:string;origin_channel_id:string;origin_channel_name:string;
  display_name:string;contact_value:string|null;source_url:string|null;origin_mode:'HUMAN'|'CODEX';
  status:'HUMAN_HANDOFF';ai_score:number|null;note:string|null;discovered_at:number;converted_lead_id:null;
  version:number;created_at:number;updated_at:number;
}

export async function listAcquisitionHandoffs(
  database:SqlDatabase,
  actor:AssignmentStaffAuthorization,
  leadType:AcquisitionLeadType,
):Promise<readonly AcquisitionProspectDto[]>{
  const allowed=actor.roles.has('owner')
    ||(leadType==='BUYER'&&actor.roles.has('pre_sales'))
    ||(leadType==='SELLER'&&actor.roles.has('seller_ops'));
  if(!allowed)throw new AcquisitionError('FORBIDDEN',403);
  const markets=actor.roles.has('owner')?[]:await resolveStaffMarketplaceCodes(database,actor);
  if(!actor.roles.has('owner')&&markets.length===0)return[];
  const marketSql=markets.length?`AND prospect.marketplace_code IN (${markets.map(()=>'?').join(',')})`:'';
  const rows=await database.prepare(`SELECT prospect.id,prospect.lead_type,prospect.marketplace_code,
    prospect.origin_channel_id,channel.display_name AS origin_channel_name,prospect.display_name,
    prospect.contact_value,prospect.source_url,prospect.origin_mode,prospect.status,prospect.ai_score,
    prospect.note,prospect.discovered_at,prospect.converted_lead_id,prospect.version,
    prospect.created_at,prospect.updated_at
    FROM acquisition_prospects prospect JOIN acquisition_channels channel ON channel.id=prospect.origin_channel_id
    WHERE prospect.status='HUMAN_HANDOFF' AND prospect.lead_type=? ${marketSql}
    ORDER BY prospect.discovered_at,prospect.id`).bind(leadType,...markets).all<Row>();
  return rows.results.map((row)=>({prospect_id:row.id,lead_type:row.lead_type,marketplace_code:row.marketplace_code,
    origin_channel_id:row.origin_channel_id,origin_channel_name:row.origin_channel_name,display_name:row.display_name,
    contact_value:row.contact_value,source_url:row.source_url,origin_mode:row.origin_mode,status:row.status,
    ai_score:row.ai_score===null?null:Number(row.ai_score),note:row.note,discovered_at:Number(row.discovered_at),
    converted_lead_id:null,version:Number(row.version),created_at:Number(row.created_at),updated_at:Number(row.updated_at)}));
}
