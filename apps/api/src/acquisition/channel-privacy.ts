import type {
  AcquisitionChannelAudience,
  AcquisitionInternalChannelViewDto,
  AcquisitionStaffChannelViewDto,
  AcquisitionVisibleChannelDto,
  SqlDatabase,
} from '@ygb/contracts';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';
import { createAuditEventStatement } from '../foundation/audit';
import { requireAcquisitionAdmin } from './authorization';
import {
  acquireAcquisitionCommand,
  failAcquisitionCommand,
  finishAcquisitionCommand,
  type AcquisitionCommandContext,
} from './command';
import { AcquisitionError, validation } from './errors';

interface ChannelViewRow {
  channel_id:string;
  code:string;
  channel_type:'XIAOHONGSHU'|'PRIVATE_WECHAT'|'REFERRAL'|'OTHER';
  platform_name:string;
  lead_type:AcquisitionChannelAudience;
  marketplace_code:string;
  display_name:string;
  status:'ACTIVE'|'DISABLED';
  channel_version:number;
  created_at:number;
  updated_at:number;
  staff_label:string;
  intake_wechat_label:string|null;
  profile_version:number;
}

export async function listAcquisitionVisibleChannels(
  database:SqlDatabase,
  actor:AssignmentStaffAuthorization,
):Promise<readonly AcquisitionVisibleChannelDto[]>{
  if(actor.roles.has('buyer_refund'))throw new AcquisitionError('FORBIDDEN',403);
  const internal=actor.roles.has('owner');
  const markets=actor.roles.has('owner')?[]:await resolveStaffMarketplaceCodes(database,actor);
  if(!actor.roles.has('owner')&&markets.length===0)return[];
  const audience=actor.roles.has('pre_sales')?'BUYER':actor.roles.has('seller_ops')?'SELLER':null;
  const conditions:string[]=[];const bindings:unknown[]=[];
  if(markets.length){conditions.push(`channel.marketplace_code IN (${markets.map(()=>'?').join(',')})`);bindings.push(...markets);}
  // Historical BOTH channels remain internal reporting rows only. Ordinary
  // intake staff never see them, avoiding duplicate anonymous labels.
  if(audience){conditions.push(`channel.lead_type=?`);bindings.push(audience);}
  if(!internal){
    conditions.push(`channel.status='ACTIVE'`);
    conditions.push(`profile.intake_wechat_label IS NOT NULL`);
  }
  const where=conditions.length?`WHERE ${conditions.join(' AND ')}`:'';
  const rows=await database.prepare(`
    SELECT
      channel.id AS channel_id,channel.code,channel.channel_type,
      channel.platform_name,channel.lead_type,channel.marketplace_code,
      channel.display_name,channel.status,channel.version AS channel_version,
      channel.created_at,channel.updated_at,
      profile.staff_label,profile.intake_wechat_label,
      profile.version AS profile_version
    FROM acquisition_channels channel
    JOIN acquisition_channel_privacy_profiles profile
      ON profile.channel_id=channel.id
    ${where}
    ORDER BY channel.status,channel.marketplace_code,channel.lead_type,
      profile.staff_label,channel.id
  `).bind(...bindings).all<ChannelViewRow>();
  return rows.results.map((row)=>internal?toInternal(row):toStaff(row));
}

export async function updateAcquisitionChannelPrivacyProfile(
  database:SqlDatabase,
  input:{channelId:string;expectedVersion:number;intakeWechatLabel:string},
  command:AcquisitionCommandContext,
):Promise<{channel:AcquisitionInternalChannelViewDto;replayed:boolean}>{
  requireAcquisitionAdmin(command.actor);
  const channelId=identifier(input.channelId);
  if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1)validation();
  const intakeWechatLabel=text(input.intakeWechatLabel,100);
  const before=await readInternalChannel(database,channelId);
  if(!before)throw new AcquisitionError('NOT_FOUND',404);
  if(before.profile_version!==input.expectedVersion)throw new AcquisitionError('VERSION_CONFLICT',409);
  const acquired=await acquireAcquisitionCommand<{channel_id:string}>(
    database,command,'UPDATE_ACQUISITION_CHANNEL_PRIVACY_PROFILE',
    'ACQUISITION_CHANNEL',channelId,{
      expected_version:input.expectedVersion,
      intake_wechat_label:intakeWechatLabel,
    },
  );
  if(acquired.acquired.kind==='REPLAY'){
    const replayed=await readInternalChannel(database,channelId);
    if(!replayed)throw new AcquisitionError('NOT_FOUND',404);
    return{channel:replayed,replayed:true};
  }
  try{
    await database.batch([
      database.prepare(`
        UPDATE acquisition_channel_privacy_profiles
        SET intake_wechat_label=?,version=version+1,
          updated_by_staff_id=?,updated_at=?
        WHERE channel_id=? AND version=?
      `).bind(
        intakeWechatLabel,command.actor.staffId,acquired.now,
        channelId,input.expectedVersion,
      ),
      createAuditEventStatement(database,{
        id:crypto.randomUUID(),aggregateType:'ACQUISITION_CHANNEL',aggregateId:channelId,
        eventType:'ACQUISITION_CHANNEL_PRIVACY_PROFILE_UPDATED',
        actor:{type:'STAFF',id:command.actor.staffId,roles:[...command.actor.roles]},
        requestId:command.requestId,idempotencyKey:command.idempotencyKey,
        previousState:{staff_label:before.staff_label,intake_wechat_label:before.intake_wechat_label,profile_version:before.profile_version},
        nextState:{staff_label:before.staff_label,intake_wechat_label:intakeWechatLabel,profile_version:input.expectedVersion+1},
        createdAt:acquired.now,
      }),
      ...finishAcquisitionCommand(database,acquired.acquired.claim,{channel_id:channelId},acquired.now,{channel_id:channelId}),
      database.prepare(`INSERT INTO transaction_assertions(assertion_value)
        SELECT CASE WHEN EXISTS(
          SELECT 1 FROM acquisition_channel_privacy_profiles
          WHERE channel_id=? AND staff_label=? AND intake_wechat_label=? AND version=?
        ) THEN 1 ELSE 0 END`).bind(channelId,before.staff_label,intakeWechatLabel,input.expectedVersion+1),
    ]);
  }catch(error){
    await failAcquisitionCommand(database,acquired.acquired.claim,acquired.now);
    if(String(error).includes('UNIQUE'))throw new AcquisitionError('CONFLICT',409);
    throw new AcquisitionError('VERSION_CONFLICT',409);
  }
  const channel=await readInternalChannel(database,channelId);
  if(!channel)throw new AcquisitionError('NOT_FOUND',404);
  return{channel,replayed:false};
}

async function readInternalChannel(
  database:SqlDatabase,
  channelId:string,
):Promise<AcquisitionInternalChannelViewDto|null>{
  const row=await database.prepare(`
    SELECT channel.id AS channel_id,channel.code,channel.channel_type,
      channel.platform_name,channel.lead_type,channel.marketplace_code,
      channel.display_name,channel.status,channel.version AS channel_version,
      channel.created_at,channel.updated_at,
      profile.staff_label,profile.intake_wechat_label,
      profile.version AS profile_version
    FROM acquisition_channels channel
    JOIN acquisition_channel_privacy_profiles profile
      ON profile.channel_id=channel.id
    WHERE channel.id=?
  `).bind(channelId).first<ChannelViewRow>();
  return row?toInternal(row):null;
}

function toInternal(row:ChannelViewRow):AcquisitionInternalChannelViewDto{
  return{
    visibility:'INTERNAL',channel_id:row.channel_id,code:row.code,
    channel_type:row.channel_type,platform_name:row.platform_name,
    lead_type:row.lead_type,marketplace_code:row.marketplace_code,
    display_name:row.display_name,status:row.status,version:Number(row.channel_version),
    created_at:Number(row.created_at),updated_at:Number(row.updated_at),
    staff_label:row.staff_label,intake_wechat_label:row.intake_wechat_label,
    profile_version:Number(row.profile_version),
  };
}
function toStaff(row:ChannelViewRow):AcquisitionStaffChannelViewDto{
  return{
    visibility:'STAFF',channel_id:row.channel_id,staff_label:row.staff_label,
    lead_type:row.lead_type,marketplace_code:row.marketplace_code,
    status:row.status,version:Number(row.channel_version),
  };
}
function identifier(value:string):string{
  if(typeof value!=='string'||value.length<1||value.length>200||/[\u0000-\u001f\u007f]/u.test(value))validation();
  return value;
}
function text(value:string,maximum:number):string{
  const normalized=value.normalize('NFKC').trim();
  if(normalized.length<1||normalized.length>maximum||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized))validation();
  return normalized;
}
