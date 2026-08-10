import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { identityApiRequest } from '../../api/identity-request';
import { operationHeaders } from '../../api/idempotency';
import {
  acquisitionChannelSchema,
  acquisitionChannelsResponseSchema,
  acquisitionConsultationsResponseSchema,
  acquisitionFunnelResponseSchema,
  acquisitionLeadSchema,
  acquisitionLeadsPageSchema,
  acquisitionProspectDetailSchema,
  acquisitionProspectSchema,
  acquisitionProspectsPageSchema,
  acquisitionProspectSignalSchema,
} from './runtime';

function read<T extends z.ZodType>(client:QueryClient,path:string,schema:T,signal?:AbortSignal){return identityApiRequest('staff',client,{path,method:'GET',schema,...(signal?{signal}:{})});}
function write<T extends z.ZodType>(client:QueryClient,path:string,body:unknown,schema:T,key:string){return identityApiRequest('staff',client,{path,method:'POST',schema,body,headers:operationHeaders({key,body})});}

const channelMutation=z.object({channel:acquisitionChannelSchema,replayed:z.boolean()}).strict();
const prospectMutation=z.object({prospect:acquisitionProspectSchema,replayed:z.boolean()}).strict();
const signalMutation=z.object({signal:acquisitionProspectSignalSchema,replayed:z.boolean()}).strict();
const leadMutation=z.object({lead:acquisitionLeadSchema,replayed:z.boolean()}).strict();
const handoffSchema=z.object({items:z.array(acquisitionProspectSchema)}).strict();
const consultationMutation=z.object({consultation:z.object({
  consultation_id:z.string(),channel_id:z.string(),lead_type:z.enum(['BUYER','SELLER']),business_date:z.string(),
  person_count:z.number().int().nonnegative(),version:z.number().int().positive(),updated_by_staff_id:z.string(),updated_at:z.number().int().nonnegative(),
}).strict(),replayed:z.boolean()}).strict();

export const acquisitionApi=Object.freeze({
  channels:(client:QueryClient,signal?:AbortSignal)=>read(client,'/api/staff/acquisition/channels',acquisitionChannelsResponseSchema,signal),
  createChannel:(client:QueryClient,body:unknown,key:string)=>write(client,'/api/staff/acquisition/channels',body,channelMutation,key),
  disableChannel:(client:QueryClient,id:string,body:unknown,key:string)=>write(client,`/api/staff/acquisition/channels/${encodeURIComponent(id)}/disable`,body,channelMutation,key),
  prospects:(client:QueryClient,input:{leadType:string|null;status:string|null;cursor:string|null},signal?:AbortSignal)=>{
    const query=new URLSearchParams({limit:'50'});if(input.leadType)query.set('lead_type',input.leadType);if(input.status)query.set('status',input.status);if(input.cursor)query.set('cursor',input.cursor);
    return read(client,`/api/staff/acquisition/prospects?${query}`,acquisitionProspectsPageSchema,signal);
  },
  handoffs:(client:QueryClient,leadType:'BUYER'|'SELLER',signal?:AbortSignal)=>read(client,`/api/staff/acquisition/handoffs?lead_type=${leadType}`,handoffSchema,signal),
  prospect:(client:QueryClient,id:string,signal?:AbortSignal)=>read(client,`/api/staff/acquisition/prospects/${encodeURIComponent(id)}`,acquisitionProspectDetailSchema,signal),
  createProspect:(client:QueryClient,body:unknown,key:string)=>write(client,'/api/staff/acquisition/prospects',body,prospectMutation,key),
  updateProspect:(client:QueryClient,id:string,body:unknown,key:string)=>write(client,`/api/staff/acquisition/prospects/${encodeURIComponent(id)}/update`,body,prospectMutation,key),
  addProspectSignal:(client:QueryClient,id:string,body:unknown,key:string)=>write(client,`/api/staff/acquisition/prospects/${encodeURIComponent(id)}/signals`,body,signalMutation,key),
  leads:(client:QueryClient,leadType:'BUYER'|'SELLER',signal?:AbortSignal)=>read(client,`/api/staff/acquisition/leads?lead_type=${leadType}&limit=100`,acquisitionLeadsPageSchema,signal),
  createLead:(client:QueryClient,body:unknown,key:string)=>write(client,'/api/staff/acquisition/leads',body,leadMutation,key),
  consultations:(client:QueryClient,from:string,to:string,signal?:AbortSignal)=>read(client,`/api/staff/acquisition/consultations?from_date=${encodeURIComponent(from)}&to_date=${encodeURIComponent(to)}`,acquisitionConsultationsResponseSchema,signal),
  recordConsultation:(client:QueryClient,body:unknown,key:string)=>write(client,'/api/staff/acquisition/consultations',body,consultationMutation,key),
  funnel:(client:QueryClient,from:string,to:string,signal?:AbortSignal)=>read(client,`/api/staff/acquisition/funnel?from_date=${encodeURIComponent(from)}&to_date=${encodeURIComponent(to)}`,acquisitionFunnelResponseSchema,signal),
});
