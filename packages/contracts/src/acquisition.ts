export const ACQUISITION_CHANNEL_TYPES = [
  'XIAOHONGSHU','PRIVATE_WECHAT','REFERRAL','OTHER',
] as const;
export type AcquisitionChannelType = typeof ACQUISITION_CHANNEL_TYPES[number];
export const ACQUISITION_LEAD_TYPES = ['BUYER','SELLER'] as const;
export type AcquisitionLeadType = typeof ACQUISITION_LEAD_TYPES[number];
export const ACQUISITION_CHANNEL_AUDIENCES = ['BUYER','SELLER','BOTH'] as const;
export type AcquisitionChannelAudience = typeof ACQUISITION_CHANNEL_AUDIENCES[number];
export const ACQUISITION_PROSPECT_STATUSES = [
  'NEW','RESEARCHING','QUALIFIED','READY_CONTACT','CONTACTED','HUMAN_HANDOFF','CONVERTED','LOST',
] as const;
export type AcquisitionProspectStatus = typeof ACQUISITION_PROSPECT_STATUSES[number];

export const ACQUISITION_HTTP_PATHS = Object.freeze({
  channels:'/api/staff/acquisition/channels',
  assignments:'/api/staff/acquisition/channel-assignments',
  consultations:'/api/staff/acquisition/consultations',
  prospects:'/api/staff/acquisition/prospects',
  leads:'/api/staff/acquisition/leads',
} as const);

export interface CreateAcquisitionChannelCommand {
  code:string;
  platform_name:string;
  lead_type:AcquisitionChannelAudience;
  marketplace_code:string;
  display_name:string;
}
export interface DisableAcquisitionChannelCommand { expected_version:number; reason:string }
export interface UpdateAcquisitionChannelPrivacyProfileCommand {
  expected_version:number;
  staff_label:string;
  intake_wechat_label:string;
}
export interface CreateAcquisitionChannelAssignmentCommand {
  staff_id:string; lead_type:AcquisitionLeadType; channel_id:string;
  effective_from:number; effective_until:number|null;
}
export interface RevokeAcquisitionChannelAssignmentCommand { expected_version:number; reason:string }
export interface RecordAcquisitionConsultationCommand {
  channel_id:string; business_date:string; person_count:number; expected_version:number; reason:string;
}
export interface CreateAcquisitionLeadCommand {
  lead_type:AcquisitionLeadType;
  marketplace_code:string;
  channel_id:string;
  prospect_id:string|null;
  wechat_id:string;
  display_name:string|null;
  note:string|null;
}
export interface FollowUpAcquisitionLeadCommand { expected_version:number; note:string|null }
export interface InvalidateAcquisitionLeadCommand { expected_version:number; reason:string }
export interface TransferAcquisitionLeadCommand { expected_version:number; new_owner_staff_id:string; reason:string }
export interface SetAcquisitionRetentionHoldCommand { expected_version:number; hold_reason:'SECURITY'|'DISPUTE'|'LEGAL'|null; reason:string }

/** Internal acquisition source record. Never return this shape to pre_sales/seller_ops. */
export interface AcquisitionChannelDto {
  channel_id:string; code:string;
  channel_type:AcquisitionChannelType;
  platform_name:string;
  lead_type:AcquisitionChannelAudience;
  marketplace_code:string;
  display_name:string;
  status:'ACTIVE'|'DISABLED'; version:number; created_at:number; updated_at:number;
}

/** Owner/acquisition view: real source + anonymous Staff label + receiving WeChat mapping. */
export interface AcquisitionInternalChannelViewDto extends AcquisitionChannelDto {
  visibility:'INTERNAL';
  staff_label:string;
  intake_wechat_label:string|null;
  profile_version:number;
}

/** Ordinary customer-intake Staff view. Real platform/source is deliberately absent. */
export interface AcquisitionStaffChannelViewDto {
  visibility:'STAFF';
  channel_id:string;
  staff_label:string;
  lead_type:AcquisitionChannelAudience;
  marketplace_code:string;
  status:'ACTIVE'|'DISABLED';
  version:number;
}
export type AcquisitionVisibleChannelDto =
  | AcquisitionInternalChannelViewDto
  | AcquisitionStaffChannelViewDto;

export interface AcquisitionChannelAssignmentDto {
  assignment_id:string; staff_id:string; lead_type:AcquisitionLeadType;
  channel_id:string; channel_name:string; effective_from:number; effective_until:number|null;
  status:'ACTIVE'|'REVOKED'; version:number;
}
export interface AcquisitionDailyConsultationDto {
  consultation_id:string; channel_id:string; lead_type:AcquisitionLeadType;
  business_date:string; person_count:number; version:number; updated_by_staff_id:string; updated_at:number;
}
export interface AcquisitionConsultationEventDto {
  event_id:string; event_type:'RECORDED'|'CORRECTED'; previous_count:number|null; next_count:number;
  previous_version:number|null; next_version:number; actor_staff_id:string; reason:string; created_at:number;
}

/** Full Prospect is restricted to Owner/acquisition Staff. */
export interface AcquisitionProspectDto {
  prospect_id:string;
  lead_type:AcquisitionLeadType;
  marketplace_code:string;
  origin_channel_id:string;
  origin_channel_name:string;
  display_name:string;
  contact_value:string|null;
  source_url:string|null;
  status:AcquisitionProspectStatus;
  note:string|null;
  discovered_at:number;
  converted_lead_id:string|null;
  version:number;
  created_at:number;
  updated_at:number;
}

export interface CreateAcquisitionProspectCommand {
  lead_type:AcquisitionLeadType; marketplace_code:string; channel_id:string;
  display_name:string; contact_value:string|null; source_url:string|null;
  note:string|null;
}
export interface UpdateAcquisitionProspectCommand {
  expected_version:number; status:AcquisitionProspectStatus; note:string|null;
}

/**
 * Formal Lead projection used by ordinary customer-intake Staff.
 * The real platform, source URL, Codex/Human discovery mode, Prospect ID and
 * source Staff ID intentionally never leave the API in this DTO.
 */
export interface AcquisitionLeadDto {
  lead_id:string;
  lead_type:AcquisitionLeadType;
  marketplace_code:string;
  wechat_masked:string;
  display_name:string|null;
  note:string|null;
  origin_channel_id:string;
  channel_label:string;
  current_owner_staff_id:string;
  status:'ACTIVE'|'INVALIDATED'|'ANONYMIZED';
  version:number;
  created_business_date:string;
  latest_followup_at:number;
  retention_due_at:number;
  retention_hold_reason:'SECURITY'|'DISPUTE'|'LEGAL'|null;
  registered:boolean;
  reservation_submitted:boolean;
  no_participation:boolean;
  formal_order_count:number;
  seller_cooperation:boolean;
  created_at:number;
  updated_at:number;
}

export interface AcquisitionFunnelDto {
  from_date:string; to_date:string; data_as_of:number;
  buyer:{ consultation_count:number; wechat_added_count:number; registered_count:number;
    reservation_submitted_count:number; no_participation_count:number; formal_order_count:number;
    projected_gross_profit_cny_fen:string|null; completed_gross_profit_cny_fen:string|null }|null;
  seller:{ consultation_count:number; wechat_added_count:number; cooperation_count:number }|null;
}
export interface AcquisitionPage<T>{items:readonly T[];next_cursor:string|null}

export function isAcquisitionChannelType(value:unknown):value is AcquisitionChannelType{return published(value,ACQUISITION_CHANNEL_TYPES);}
export function isAcquisitionLeadType(value:unknown):value is AcquisitionLeadType{return published(value,ACQUISITION_LEAD_TYPES);}
export function isAcquisitionChannelAudience(value:unknown):value is AcquisitionChannelAudience{return published(value,ACQUISITION_CHANNEL_AUDIENCES);}
export function isAcquisitionProspectStatus(value:unknown):value is AcquisitionProspectStatus{return published(value,ACQUISITION_PROSPECT_STATUSES);}
export function isAcquisitionRetentionHold(value:unknown):value is 'SECURITY'|'DISPUTE'|'LEGAL'{return published(value,['SECURITY','DISPUTE','LEGAL'] as const);}
function published<T extends string>(value:unknown,values:readonly T[]):value is T{return typeof value==='string'&&(values as readonly string[]).includes(value);}
