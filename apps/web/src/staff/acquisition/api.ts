import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { identityApiRequest } from '../../api/identity-request';
import { operationHeaders } from '../../api/idempotency';
import {
  acquisitionChannelSchema,
  acquisitionChannelsResponseSchema,
  acquisitionConsultationsResponseSchema,
  acquisitionFunnelResponseSchema,
  acquisitionHandoffSchema,
  acquisitionInternalChannelViewSchema,
  acquisitionLeadSchema,
  acquisitionLeadsPageSchema,
  acquisitionProspectDetailSchema,
  acquisitionProspectSchema,
  acquisitionProspectsPageSchema,
} from './runtime';

function read<T extends z.ZodType>(
  client: QueryClient,
  path: string,
  schema: T,
  signal?: AbortSignal,
) {
  return identityApiRequest('staff', client, {
    path,
    method: 'GET',
    schema,
    ...(signal ? { signal } : {}),
  });
}
function write<T extends z.ZodType>(
  client: QueryClient,
  path: string,
  body: unknown,
  schema: T,
  key: string,
) {
  return identityApiRequest('staff', client, {
    path,
    method: 'POST',
    schema,
    body,
    headers: operationHeaders({ key, body }),
  });
}

const channelMutation = z
  .object({ channel: acquisitionChannelSchema, replayed: z.boolean() })
  .strict();
const channelPrivacyMutation = z
  .object({ channel: acquisitionInternalChannelViewSchema, replayed: z.boolean() })
  .strict();
const prospectMutation = z
  .object({ prospect: acquisitionProspectSchema, replayed: z.boolean() })
  .strict();
const leadMutation = z.object({ lead: acquisitionLeadSchema, replayed: z.boolean() }).strict();
const handoffSchema = z.object({ items: z.array(acquisitionHandoffSchema) }).strict();
const channelStat = z
  .object({
    channel_id: z.string(),
    channel_name: z.string(),
    platform_name: z.string(),
    channel_status: z.enum(['ACTIVE', 'DISABLED']),
    lead_type: z.enum(['BUYER', 'SELLER', 'BOTH']),
    marketplace_code: z.string(),
    consultation_count: z.number().int().nonnegative().nullable(),
    consultation_data_complete: z.boolean(),
    consultation_days_recorded: z.number().int().nonnegative(),
    consultation_days_expected: z.number().int().nonnegative(),
    prospect_count: z.number().int().nonnegative(),
    codex_prospect_count: z.number().int().nonnegative(),
    lead_count: z.number().int().nonnegative(),
    registered_count: z.number().int().nonnegative(),
    reservation_submitted_count: z.number().int().nonnegative(),
    cooperation_count: z.number().int().nonnegative(),
    formal_order_count: z.number().int().nonnegative(),
    buyer_formal_order_count: z.number().int().nonnegative(),
    seller_formal_order_count: z.number().int().nonnegative(),
    buyer_projected_gross_profit_cny_fen: z.string().nullable(),
    buyer_completed_gross_profit_cny_fen: z.string().nullable(),
    seller_projected_gross_profit_cny_fen: z.string().nullable(),
    seller_completed_gross_profit_cny_fen: z.string().nullable(),
  })
  .strict();
const channelStatsSchema = z.object({ channels: z.array(channelStat) }).strict();
const consultationMutation = z
  .object({
    consultation: z
      .object({
        consultation_id: z.string(),
        channel_id: z.string(),
        lead_type: z.enum(['BUYER', 'SELLER']),
        business_date: z.string(),
        person_count: z.number().int().nonnegative(),
        version: z.number().int().positive(),
        updated_by_staff_id: z.string(),
        updated_at: z.number().int().nonnegative(),
      })
      .strict(),
    replayed: z.boolean(),
  })
  .strict();
const reportingConfig = z
  .object({
    precision_started_business_date: z.string().nullable(),
    activated_at: z.number().int().nonnegative().nullable(),
    activated_by_staff_id: z.string().nullable(),
    version: z.number().int().positive(),
    updated_at: z.number().int().nonnegative(),
  })
  .strict();
const reportingConfigEnvelope = z.object({ config: reportingConfig }).strict();
const sourceCorrectionCandidate = z
  .object({
    lead_id: z.string(),
    lead_type: z.enum(['BUYER', 'SELLER']),
    marketplace_code: z.string(),
    business_date: z.string(),
    display_name: z.string().nullable(),
    wechat_masked: z.string(),
    original_channel_id: z.string(),
    original_channel_name: z.string(),
    effective_channel_id: z.string(),
    effective_channel_name: z.string(),
    correction_count: z.number().int().nonnegative(),
  })
  .strict();
const correctionCandidatesEnvelope = z
  .object({ items: z.array(sourceCorrectionCandidate) })
  .strict();
const sourceCorrectionEnvelope = z
  .object({
    correction: z
      .object({
        correction_id: z.string(),
        lead_id: z.string(),
        previous_channel_id: z.string(),
        new_channel_id: z.string(),
        new_channel_name: z.string(),
        reason: z.string(),
        corrected_at: z.number().int().nonnegative(),
        correction_sequence: z.number().int().positive(),
      })
      .strict(),
    replayed: z.boolean(),
  })
  .strict();

export type AcquisitionChannelStat = z.output<typeof channelStat>;
export type SourceCorrectionCandidate = z.output<typeof sourceCorrectionCandidate>;

export const acquisitionApi = Object.freeze({
  channels: (client: QueryClient, signal?: AbortSignal) =>
    read(client, '/api/staff/acquisition/channels', acquisitionChannelsResponseSchema, signal),
  createChannel: (client: QueryClient, body: unknown, key: string) =>
    write(client, '/api/staff/acquisition/channels', body, channelMutation, key),
  disableChannel: (client: QueryClient, id: string, body: unknown, key: string) =>
    write(
      client,
      `/api/staff/acquisition/channels/${encodeURIComponent(id)}/disable`,
      body,
      channelMutation,
      key,
    ),
  updateChannelPrivacy: (client: QueryClient, id: string, body: unknown, key: string) =>
    write(
      client,
      `/api/staff/acquisition/channels/${encodeURIComponent(id)}/privacy-profile`,
      body,
      channelPrivacyMutation,
      key,
    ),
  channelStats: (client: QueryClient, from: string, to: string, signal?: AbortSignal) =>
    read(
      client,
      `/api/staff/acquisition/channel-stats?from_date=${encodeURIComponent(from)}&to_date=${encodeURIComponent(to)}`,
      channelStatsSchema,
      signal,
    ),
  prospects: (
    client: QueryClient,
    input: { leadType: string | null; status: string | null; cursor: string | null },
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams({ limit: '50' });
    if (input.leadType) query.set('lead_type', input.leadType);
    if (input.status) query.set('status', input.status);
    if (input.cursor) query.set('cursor', input.cursor);
    return read(
      client,
      `/api/staff/acquisition/prospects?${query}`,
      acquisitionProspectsPageSchema,
      signal,
    );
  },
  handoffs: (client: QueryClient, leadType: 'BUYER' | 'SELLER', signal?: AbortSignal) =>
    read(client, `/api/staff/acquisition/handoffs?lead_type=${leadType}`, handoffSchema, signal),
  prospect: (client: QueryClient, id: string, signal?: AbortSignal) =>
    read(
      client,
      `/api/staff/acquisition/prospects/${encodeURIComponent(id)}`,
      acquisitionProspectDetailSchema,
      signal,
    ),
  createProspect: (client: QueryClient, body: unknown, key: string) =>
    write(client, '/api/staff/acquisition/prospects', body, prospectMutation, key),
  updateProspect: (client: QueryClient, id: string, body: unknown, key: string) =>
    write(
      client,
      `/api/staff/acquisition/prospects/${encodeURIComponent(id)}/update`,
      body,
      prospectMutation,
      key,
    ),
  leads: (client: QueryClient, leadType: 'BUYER' | 'SELLER', signal?: AbortSignal) =>
    read(
      client,
      `/api/staff/acquisition/leads?lead_type=${leadType}&limit=100`,
      acquisitionLeadsPageSchema,
      signal,
    ),
  createLead: (client: QueryClient, body: unknown, key: string) =>
    write(client, '/api/staff/acquisition/leads', body, leadMutation, key),
  consultations: (client: QueryClient, from: string, to: string, signal?: AbortSignal) =>
    read(
      client,
      `/api/staff/acquisition/consultations?from_date=${encodeURIComponent(from)}&to_date=${encodeURIComponent(to)}`,
      acquisitionConsultationsResponseSchema,
      signal,
    ),
  recordConsultation: (client: QueryClient, body: unknown, key: string) =>
    write(client, '/api/staff/acquisition/consultations', body, consultationMutation, key),
  funnel: (client: QueryClient, from: string, to: string, signal?: AbortSignal) =>
    read(
      client,
      `/api/staff/acquisition/funnel?from_date=${encodeURIComponent(from)}&to_date=${encodeURIComponent(to)}`,
      acquisitionFunnelResponseSchema,
      signal,
    ),
  reportingConfig: (client: QueryClient, signal?: AbortSignal) =>
    read(client, '/api/staff/acquisition/reporting-config', reportingConfigEnvelope, signal),
  activateReportingConfig: (client: QueryClient, body: unknown, key: string) =>
    write(
      client,
      '/api/staff/acquisition/reporting-config/activate',
      body,
      reportingConfigEnvelope,
      key,
    ),
  sourceCorrectionCandidates: (client: QueryClient, signal?: AbortSignal) =>
    read(
      client,
      '/api/staff/acquisition/source-corrections/candidates?limit=100',
      correctionCandidatesEnvelope,
      signal,
    ),
  correctSource: (client: QueryClient, body: unknown, key: string) =>
    write(client, '/api/staff/acquisition/source-corrections', body, sourceCorrectionEnvelope, key),
});
