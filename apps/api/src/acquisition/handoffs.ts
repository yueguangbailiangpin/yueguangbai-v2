import type { AcquisitionHandoffDto, AcquisitionLeadType, SqlDatabase } from '@ygb/contracts';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';
import { AcquisitionError } from './errors';

interface Row {
  id:string;
  lead_type:AcquisitionLeadType;
  marketplace_code:string;
  origin_channel_id:string;
  channel_label:string;
  display_name:string;
  contact_value:string|null;
  status:'HUMAN_HANDOFF';
  version:number;
  created_at:number;
  updated_at:number;
}

export async function listAcquisitionHandoffs(
  database:SqlDatabase,
  actor:AssignmentStaffAuthorization,
  leadType:AcquisitionLeadType,
):Promise<readonly AcquisitionHandoffDto[]>{
  const allowed=actor.roles.has('owner')
    ||(leadType==='BUYER'&&actor.roles.has('pre_sales'))
    ||(leadType==='SELLER'&&actor.roles.has('seller_ops'));
  if(!allowed)throw new AcquisitionError('FORBIDDEN',403);
  const markets=actor.roles.has('owner')?[]:await resolveStaffMarketplaceCodes(database,actor);
  if(!actor.roles.has('owner')&&markets.length===0)return[];
  const marketSql=markets.length?`AND prospect.marketplace_code IN (${markets.map(()=>'?').join(',')})`:'';
  const rows=await database.prepare(`
    SELECT prospect.id,prospect.lead_type,prospect.marketplace_code,
      prospect.origin_channel_id,profile.staff_label AS channel_label,
      prospect.display_name,prospect.contact_value,prospect.status,
      prospect.version,prospect.created_at,prospect.updated_at
    FROM acquisition_prospects prospect
    JOIN acquisition_channel_privacy_profiles profile
      ON profile.channel_id=prospect.origin_channel_id
    WHERE prospect.status='HUMAN_HANDOFF'
      AND prospect.lead_type=?
      AND profile.intake_wechat_label IS NOT NULL
      ${marketSql}
    ORDER BY prospect.discovered_at,prospect.id
  `).bind(leadType,...markets).all<Row>();
  return rows.results.map((row)=>({
    prospect_id:row.id,
    lead_type:row.lead_type,
    marketplace_code:row.marketplace_code,
    origin_channel_id:row.origin_channel_id,
    channel_label:row.channel_label,
    display_name:row.display_name,
    contact_value:row.contact_value,
    status:'HUMAN_HANDOFF',
    version:Number(row.version),
    created_at:Number(row.created_at),
    updated_at:Number(row.updated_at),
  }));
}
