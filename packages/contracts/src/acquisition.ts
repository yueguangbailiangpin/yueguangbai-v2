export const ACQUISITION_CHANNEL_TYPES = [
  'XIAOHONGSHU', 'PRIVATE_WECHAT', 'REFERRAL', 'OTHER',
] as const;
export type AcquisitionChannelType = typeof ACQUISITION_CHANNEL_TYPES[number];

export const ACQUISITION_LEAD_TYPES = ['BUYER', 'SELLER'] as const;
export type AcquisitionLeadType = typeof ACQUISITION_LEAD_TYPES[number];

export const ACQUISITION_HTTP_PATHS = Object.freeze({
  channels: '/api/staff/acquisition/channels',
  assignments: '/api/staff/acquisition/channel-assignments',
  consultations: '/api/staff/acquisition/consultations',
  leads: '/api/staff/acquisition/leads',
  funnel: '/api/staff/acquisition/funnel',
} as const);

export interface CreateAcquisitionChannelCommand {
  code: string;
  channel_type: AcquisitionChannelType;
  display_name: string;
}

export interface DisableAcquisitionChannelCommand {
  expected_version: number;
  reason: string;
}

export interface CreateAcquisitionChannelAssignmentCommand {
  staff_id: string;
  lead_type: AcquisitionLeadType;
  channel_id: string;
  effective_from: number;
  effective_until: number | null;
}

export interface RevokeAcquisitionChannelAssignmentCommand {
  expected_version: number;
  reason: string;
}

export interface RecordAcquisitionConsultationCommand {
  channel_id: string;
  business_date: string;
  person_count: number;
  expected_version: number;
  reason: string;
}

export interface CreateAcquisitionLeadCommand {
  lead_type: AcquisitionLeadType;
  wechat_id: string;
  display_name: string | null;
  note: string | null;
}

export interface FollowUpAcquisitionLeadCommand {
  expected_version: number;
  note: string | null;
}

export interface InvalidateAcquisitionLeadCommand {
  expected_version: number;
  reason: string;
}

export interface TransferAcquisitionLeadCommand {
  expected_version: number;
  new_owner_staff_id: string;
  reason: string;
}

export interface SetAcquisitionRetentionHoldCommand {
  expected_version: number;
  hold_reason: 'SECURITY' | 'DISPUTE' | 'LEGAL' | null;
  reason: string;
}

export interface AcquisitionChannelDto {
  channel_id: string;
  code: string;
  channel_type: AcquisitionChannelType;
  display_name: string;
  status: 'ACTIVE' | 'DISABLED';
  version: number;
  created_at: number;
  updated_at: number;
}

export interface AcquisitionChannelAssignmentDto {
  assignment_id: string;
  staff_id: string;
  lead_type: AcquisitionLeadType;
  channel_id: string;
  channel_name: string;
  effective_from: number;
  effective_until: number | null;
  status: 'ACTIVE' | 'REVOKED';
  version: number;
}

export interface AcquisitionDailyConsultationDto {
  consultation_id: string;
  channel_id: string;
  lead_type: AcquisitionLeadType;
  business_date: string;
  person_count: number;
  version: number;
  updated_by_staff_id: string;
  updated_at: number;
}

export interface AcquisitionConsultationEventDto {
  event_id: string;
  event_type: 'RECORDED'|'CORRECTED';
  previous_count: number|null;
  next_count: number;
  previous_version: number|null;
  next_version: number;
  actor_staff_id: string;
  reason: string;
  created_at: number;
}

export interface AcquisitionLeadDto {
  lead_id: string;
  lead_type: AcquisitionLeadType;
  wechat_masked: string;
  display_name: string | null;
  note: string | null;
  origin_channel_id: string;
  origin_channel_name: string;
  origin_staff_id: string;
  current_owner_staff_id: string;
  status: 'ACTIVE' | 'INVALIDATED' | 'ANONYMIZED';
  version: number;
  created_business_date: string;
  latest_followup_at: number;
  retention_due_at: number;
  retention_hold_reason: 'SECURITY' | 'DISPUTE' | 'LEGAL' | null;
  registered: boolean;
  reservation_submitted: boolean;
  no_participation: boolean;
  formal_order_count: number;
  seller_cooperation: boolean;
  created_at: number;
  updated_at: number;
}

export interface AcquisitionFunnelDto {
  from_date: string;
  to_date: string;
  data_as_of: number;
  buyer: {
    consultation_count: number;
    wechat_added_count: number;
    registered_count: number;
    reservation_submitted_count: number;
    no_participation_count: number;
    formal_order_count: number;
    projected_gross_profit_cny_fen: string | null;
    completed_gross_profit_cny_fen: string | null;
  } | null;
  seller: {
    consultation_count: number;
    wechat_added_count: number;
    cooperation_count: number;
  } | null;
}

export interface AcquisitionPage<T> {
  items: readonly T[];
  next_cursor: string | null;
}

export function isAcquisitionChannelType(value: unknown): value is AcquisitionChannelType {
  return published(value, ACQUISITION_CHANNEL_TYPES);
}

export function isAcquisitionLeadType(value: unknown): value is AcquisitionLeadType {
  return published(value, ACQUISITION_LEAD_TYPES);
}

export function isAcquisitionRetentionHold(value: unknown): value is 'SECURITY'|'DISPUTE'|'LEGAL' {
  return published(value, ['SECURITY','DISPUTE','LEGAL'] as const);
}

function published<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}
