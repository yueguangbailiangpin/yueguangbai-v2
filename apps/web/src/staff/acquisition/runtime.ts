import { z } from 'zod';

const epoch=z.number().int().nonnegative();
export const acquisitionLeadTypeSchema=z.enum(['BUYER','SELLER']);
export const acquisitionProspectStatusSchema=z.enum(['NEW','RESEARCHING','QUALIFIED','READY_CONTACT','CONTACTED','HUMAN_HANDOFF','CONVERTED','LOST']);
export const acquisitionChannelSchema=z.object({
  channel_id:z.string(),code:z.string(),channel_type:z.enum(['XIAOHONGSHU','PRIVATE_WECHAT','REFERRAL','OTHER']),
  platform_name:z.string(),lead_type:z.enum(['BUYER','SELLER','BOTH']),marketplace_code:z.string(),display_name:z.string(),
  status:z.enum(['ACTIVE','DISABLED']),version:z.number().int().positive(),created_at:epoch,updated_at:epoch,
}).strict();
export const acquisitionChannelsResponseSchema=z.object({channels:z.array(acquisitionChannelSchema)}).strict();
export const acquisitionProspectSchema=z.object({
  prospect_id:z.string(),lead_type:acquisitionLeadTypeSchema,marketplace_code:z.string(),origin_channel_id:z.string(),origin_channel_name:z.string(),
  display_name:z.string(),contact_value:z.string().nullable(),source_url:z.string().nullable(),origin_mode:z.enum(['HUMAN','CODEX']),
  status:acquisitionProspectStatusSchema,ai_score:z.number().int().min(0).max(100).nullable(),note:z.string().nullable(),
  discovered_at:epoch,converted_lead_id:z.string().nullable(),version:z.number().int().positive(),created_at:epoch,updated_at:epoch,
}).strict();
export const acquisitionProspectSignalSchema=z.object({
  signal_id:z.string(),prospect_id:z.string(),signal_type:z.string(),signal_content:z.string(),source_url:z.string().nullable(),
  confidence:z.enum(['LOW','MEDIUM','HIGH','CONFIRMED']),created_by_actor_type:z.enum(['STAFF','CODEX']),created_by_actor_id:z.string(),created_at:epoch,
}).strict();
export const acquisitionProspectsPageSchema=z.object({items:z.array(acquisitionProspectSchema),next_cursor:z.string().nullable()}).strict();
export const acquisitionProspectDetailSchema=z.object({prospect:acquisitionProspectSchema,signals:z.array(acquisitionProspectSignalSchema)}).strict();
export const acquisitionLeadSchema=z.object({
  lead_id:z.string(),lead_type:acquisitionLeadTypeSchema,marketplace_code:z.string(),wechat_masked:z.string(),display_name:z.string().nullable(),note:z.string().nullable(),
  prospect_id:z.string().nullable(),origin_mode:z.enum(['HUMAN','CODEX']),origin_source_url:z.string().nullable(),origin_channel_id:z.string(),origin_channel_name:z.string(),
  origin_staff_id:z.string(),current_owner_staff_id:z.string(),status:z.enum(['ACTIVE','INVALIDATED','ANONYMIZED']),version:z.number().int().positive(),
  created_business_date:z.string(),latest_followup_at:epoch,retention_due_at:epoch,retention_hold_reason:z.enum(['SECURITY','DISPUTE','LEGAL']).nullable(),
  registered:z.boolean(),reservation_submitted:z.boolean(),no_participation:z.boolean(),formal_order_count:z.number().int().nonnegative(),seller_cooperation:z.boolean(),
  created_at:epoch,updated_at:epoch,
}).strict();
export const acquisitionLeadsPageSchema=z.object({items:z.array(acquisitionLeadSchema),next_cursor:z.string().nullable()}).strict();
export const acquisitionDailyConsultationSchema=z.object({consultation_id:z.string(),channel_id:z.string(),lead_type:acquisitionLeadTypeSchema,business_date:z.string(),person_count:z.number().int().nonnegative(),version:z.number().int().positive(),updated_by_staff_id:z.string(),updated_at:epoch}).strict();
export const acquisitionConsultationsResponseSchema=z.object({consultations:z.array(acquisitionDailyConsultationSchema)}).strict();
export const acquisitionFunnelSchema=z.object({
  from_date:z.string(),to_date:z.string(),data_as_of:epoch,
  buyer:z.object({consultation_count:z.number().int().nonnegative(),wechat_added_count:z.number().int().nonnegative(),registered_count:z.number().int().nonnegative(),reservation_submitted_count:z.number().int().nonnegative(),no_participation_count:z.number().int().nonnegative(),formal_order_count:z.number().int().nonnegative(),projected_gross_profit_cny_fen:z.string().nullable(),completed_gross_profit_cny_fen:z.string().nullable()}).strict().nullable(),
  seller:z.object({consultation_count:z.number().int().nonnegative(),wechat_added_count:z.number().int().nonnegative(),cooperation_count:z.number().int().nonnegative()}).strict().nullable(),
}).strict();
export const acquisitionFunnelResponseSchema=z.object({funnel:acquisitionFunnelSchema}).strict();

export type AcquisitionChannel=z.output<typeof acquisitionChannelSchema>;
export type AcquisitionProspect=z.output<typeof acquisitionProspectSchema>;
export type AcquisitionProspectSignal=z.output<typeof acquisitionProspectSignalSchema>;
export type AcquisitionLead=z.output<typeof acquisitionLeadSchema>;
