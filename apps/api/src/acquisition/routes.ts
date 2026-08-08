import {
  apiFailure,
  apiSuccess,
  isAcquisitionChannelType,
  isAcquisitionLeadType,
  isAcquisitionRetentionHold,
  type ApiErrorCode,
} from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import { IdempotencyError } from '../foundation/idempotency';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  createAcquisitionAssignment,
  createAcquisitionChannel,
  disableAcquisitionChannel,
  listAcquisitionAssignments,
  listAcquisitionChannels,
  listAcquisitionConsultations,
  listAcquisitionConsultationHistory,
  recordAcquisitionConsultation,
  revokeAcquisitionAssignment,
} from './admin';
import { type AcquisitionCommandContext } from './command';
import { AcquisitionError, validation } from './errors';
import { readAcquisitionFunnel } from './funnel';
import {
  createAcquisitionLead,
  followUpAcquisitionLead,
  invalidateAcquisitionLead,
  listAcquisitionLeads,
  readAcquisitionLead,
  setAcquisitionRetentionHold,
  transferAcquisitionLead,
} from './leads';
import { requireAcquisitionSecret } from './privacy';

const BODY_LIMIT = 32 * 1024;

export function registerAcquisitionRoutes(app: Hono<any>): void {
  app.get('/api/staff/acquisition/channels', withErrors(async (context) => success(context, {
    channels: await listAcquisitionChannels(context.env.DB, actor(context)),
  })));
  app.post('/api/staff/acquisition/channels', customerAuthOriginGuard(), withErrors(async (context) => {
    const body = await exactBody(context, ['code','channel_type','display_name']);
    if (typeof body['code'] !== 'string' || !isAcquisitionChannelType(body['channel_type'])
      || typeof body['display_name'] !== 'string') validation();
    const result = await createAcquisitionChannel(context.env.DB, {
      code: body['code'], channelType: body['channel_type'], displayName: body['display_name'],
    }, command(context));
    return context.json(apiSuccess(result, requestIdFromContext(context)), 201);
  }));
  app.post('/api/staff/acquisition/channels/:id/disable', customerAuthOriginGuard(), withErrors(async (context) => {
    const body = await exactBody(context, ['expected_version','reason']);
    if (!Number.isSafeInteger(body['expected_version']) || typeof body['reason'] !== 'string') validation();
    return success(context, await disableAcquisitionChannel(context.env.DB, {
      channelId: paramId(context), expectedVersion: Number(body['expected_version']),
      reason: body['reason'],
    }, command(context)));
  }));

  app.get('/api/staff/acquisition/channel-assignments', withErrors(async (context) => success(context, {
    assignments: await listAcquisitionAssignments(context.env.DB, actor(context)),
  })));
  app.post('/api/staff/acquisition/channel-assignments', customerAuthOriginGuard(), withErrors(async (context) => {
    const body = await exactBody(context, [
      'staff_id','lead_type','channel_id','effective_from','effective_until',
    ]);
    if (typeof body['staff_id'] !== 'string' || !isAcquisitionLeadType(body['lead_type'])
      || typeof body['channel_id'] !== 'string'
      || !Number.isSafeInteger(body['effective_from'])
      || !(body['effective_until'] === null || Number.isSafeInteger(body['effective_until']))) validation();
    const result = await createAcquisitionAssignment(context.env.DB, {
      staffId: body['staff_id'], leadType: body['lead_type'], channelId: body['channel_id'],
      effectiveFrom: Number(body['effective_from']),
      effectiveUntil: body['effective_until'] === null ? null : Number(body['effective_until']),
    }, command(context));
    return context.json(apiSuccess(result, requestIdFromContext(context)), 201);
  }));
  app.post('/api/staff/acquisition/channel-assignments/:id/revoke', customerAuthOriginGuard(), withErrors(async (context) => {
    const body = await exactBody(context, ['expected_version','reason']);
    if (!Number.isSafeInteger(body['expected_version']) || typeof body['reason'] !== 'string') validation();
    return success(context, await revokeAcquisitionAssignment(context.env.DB, {
      assignmentId: paramId(context), expectedVersion: Number(body['expected_version']),
      reason: body['reason'],
    }, command(context)));
  }));

  app.get('/api/staff/acquisition/consultations', withErrors(async (context) => {
    exactQuery(context, ['from_date','to_date']);
    const from = context.req.query('from_date'); const to = context.req.query('to_date');
    if (!from || !to) validation();
    return success(context, { consultations: await listAcquisitionConsultations(
      context.env.DB, actor(context), from, to,
    ) });
  }));
  app.get('/api/staff/acquisition/consultations/:id/history', withErrors(async (context) => success(context, {
    history: await listAcquisitionConsultationHistory(
      context.env.DB, actor(context), paramId(context),
    ),
  })));
  app.post('/api/staff/acquisition/consultations', customerAuthOriginGuard(), withErrors(async (context) => {
    const body = await exactBody(context, [
      'channel_id','business_date','person_count','expected_version','reason',
    ]);
    if (typeof body['channel_id'] !== 'string' || typeof body['business_date'] !== 'string'
      || !Number.isSafeInteger(body['person_count'])
      || !Number.isSafeInteger(body['expected_version'])
      || typeof body['reason'] !== 'string') validation();
    return success(context, await recordAcquisitionConsultation(context.env.DB, {
      channelId: body['channel_id'], businessDate: body['business_date'],
      personCount: Number(body['person_count']), expectedVersion: Number(body['expected_version']),
      reason: body['reason'],
    }, command(context)));
  }));

  app.get('/api/staff/acquisition/leads', withErrors(async (context) => {
    exactQuery(context, ['lead_type','cursor','limit']);
    const rawType = context.req.query('lead_type') ?? null;
    if (rawType !== null && !isAcquisitionLeadType(rawType)) validation();
    const rawLimit = context.req.query('limit');
    const limit = rawLimit === undefined ? 25 : Number(rawLimit);
    return success(context, await listAcquisitionLeads(context.env.DB, actor(context), {
      leadType: rawType, cursor: context.req.query('cursor') ?? null, limit,
    }));
  }));
  app.get('/api/staff/acquisition/leads/:id', withErrors(async (context) => success(context, {
    lead: await readAcquisitionLead(context.env.DB, actor(context), paramId(context)),
  })));
  app.post('/api/staff/acquisition/leads', customerAuthOriginGuard(), withErrors(async (context) => {
    const body = await exactBody(context, ['lead_type','wechat_id','display_name','note']);
    if (!isAcquisitionLeadType(body['lead_type']) || typeof body['wechat_id'] !== 'string'
      || !(body['display_name'] === null || typeof body['display_name'] === 'string')
      || !(body['note'] === null || typeof body['note'] === 'string')) validation();
    const result = await createAcquisitionLead(context.env.DB, {
      leadType: body['lead_type'], wechatId: body['wechat_id'],
      displayName: body['display_name'], note: body['note'],
    }, command(context), requireAcquisitionSecret(context.env.CUSTOMER_SECURITY_TOKEN_SECRET));
    return context.json(apiSuccess(result, requestIdFromContext(context)), 201);
  }));
  app.post('/api/staff/acquisition/leads/:id/follow-ups', customerAuthOriginGuard(), withErrors(async (context) => {
    const body = await exactBody(context, ['expected_version','note']);
    if (!Number.isSafeInteger(body['expected_version'])
      || !(body['note'] === null || typeof body['note'] === 'string')) validation();
    return success(context, await followUpAcquisitionLead(context.env.DB, {
      leadId: paramId(context), expectedVersion: Number(body['expected_version']),
      note: body['note'],
    }, command(context)));
  }));
  app.post('/api/staff/acquisition/leads/:id/invalidate', customerAuthOriginGuard(), withErrors(async (context) => {
    const body = await exactBody(context, ['expected_version','reason']);
    if (!Number.isSafeInteger(body['expected_version']) || typeof body['reason'] !== 'string') validation();
    return success(context, await invalidateAcquisitionLead(context.env.DB, {
      leadId: paramId(context), expectedVersion: Number(body['expected_version']),
      reason: body['reason'],
    }, command(context)));
  }));
  app.post('/api/staff/acquisition/leads/:id/transfer', customerAuthOriginGuard(), withErrors(async (context) => {
    const body = await exactBody(context, ['expected_version','new_owner_staff_id','reason']);
    if (!Number.isSafeInteger(body['expected_version'])
      || typeof body['new_owner_staff_id'] !== 'string' || typeof body['reason'] !== 'string') validation();
    return success(context, await transferAcquisitionLead(context.env.DB, {
      leadId: paramId(context), expectedVersion: Number(body['expected_version']),
      newOwnerStaffId: body['new_owner_staff_id'], reason: body['reason'],
    }, command(context)));
  }));
  app.post('/api/staff/acquisition/leads/:id/retention-hold', customerAuthOriginGuard(), withErrors(async (context) => {
    const body = await exactBody(context, ['expected_version','hold_reason','reason']);
    if (!Number.isSafeInteger(body['expected_version'])
      || !(body['hold_reason'] === null || isAcquisitionRetentionHold(body['hold_reason']))
      || typeof body['reason'] !== 'string') validation();
    return success(context, await setAcquisitionRetentionHold(context.env.DB, {
      leadId: paramId(context), expectedVersion: Number(body['expected_version']),
      holdReason: body['hold_reason'], reason: body['reason'],
    }, command(context)));
  }));

  app.get('/api/staff/acquisition/funnel', withErrors(async (context) => {
    exactQuery(context, ['from_date','to_date']);
    const from = context.req.query('from_date'); const to = context.req.query('to_date');
    if (!from || !to) validation();
    return success(context, { funnel: await readAcquisitionFunnel(
      context.env.DB, actor(context), { fromDate: from, toDate: to },
    ) });
  }));
}

function actor(context: Context<any>): AssignmentStaffAuthorization {
  const value = context.get('staffAuthorization') as AssignmentStaffAuthorization|undefined;
  if (!value || value.staffStatus !== 'ACTIVE') throw new AcquisitionError('UNAUTHENTICATED', 401);
  return value;
}
function paramId(context: Context<any>): string {
  const value = context.req.param('id');
  if (!value) validation();
  return value;
}
function command(context: Context<any>): AcquisitionCommandContext {
  let key;
  try { key = parseIdempotencyKey(context.req.header('Idempotency-Key')); }
  catch { validation(); }
  if (!key) validation();
  return { actor: actor(context), idempotencyKey: key,
    requestId: requestIdFromContext(context) };
}
async function exactBody(context: Context<any>, keys: readonly string[]) {
  const value = await readBoundedJson(context.req.raw, BODY_LIMIT);
  if (!value || typeof value !== 'object' || Array.isArray(value)) validation();
  const record = value as Record<string,unknown>;
  if (Object.keys(record).length !== keys.length
    || keys.some((key) => !Object.hasOwn(record,key))) validation();
  return record;
}
function exactQuery(context: Context<any>, keys: readonly string[]): void {
  const url = new URL(context.req.url);
  if ([...url.searchParams.keys()].some((key) => !keys.includes(key))) validation();
}
function success(context: Context<any>, data: unknown): Response {
  return context.json(apiSuccess(data, requestIdFromContext(context)));
}
function withErrors(handler: (context: Context<any>) => Promise<Response>) {
  return async (context: Context<any>): Promise<Response> => {
    try { return await handler(context); }
    catch (error) {
      const normalized = normalize(error);
      return context.json(apiFailure(normalized.code, message(normalized.code),
        requestIdFromContext(context)), normalized.status);
    }
  };
}
function normalize(error: unknown): { code: ApiErrorCode; status: 400|401|403|404|409|503 } {
  if (error instanceof AcquisitionError) return error;
  if (error instanceof IdempotencyError) return error;
  return { code: 'DEPENDENCY_UNAVAILABLE', status: 503 };
}
function message(code: ApiErrorCode): string {
  if (code === 'UNAUTHENTICATED') return '员工会话无效';
  if (code === 'FORBIDDEN') return '当前角色或个人权限不允许此操作';
  if (code === 'NOT_FOUND') return '记录不存在或不在当前数据范围';
  if (code === 'CHANNEL_CONFIGURATION_MISSING') return '当前没有生效的获客渠道配置';
  if (code === 'CHANNEL_CONFIGURATION_AMBIGUOUS') return '当前获客渠道配置存在冲突';
  if (code === 'DUPLICATE_LEAD') return '该微信身份已有同类型有效线索';
  if (code === 'VERSION_CONFLICT') return '记录已更新，请刷新后重试';
  if (code === 'IDEMPOTENCY_CONFLICT') return '幂等键已用于其他请求';
  if (code === 'REQUEST_IN_PROGRESS') return '相同请求正在处理中';
  if (code === 'VALIDATION_ERROR') return '请求内容不正确';
  return '获客服务暂时不可用';
}
