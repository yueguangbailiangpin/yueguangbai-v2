import {
  apiFailure,
  apiSuccess,
  isAcquisitionChannelAudience,
  isAcquisitionLeadType,
  isAcquisitionProspectStatus,
  isAcquisitionRetentionHold,
  type ApiErrorCode,
} from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../app';
import { IdempotencyError } from '../foundation/idempotency';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  createAcquisitionAssignment,
  createAcquisitionChannel,
  disableAcquisitionChannel,
  listAcquisitionAssignments,
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
import {
  createAcquisitionProspect,
  listAcquisitionProspects,
  readAcquisitionProspect,
  updateAcquisitionProspect,
} from './prospects';
import { requireAcquisitionSecret } from './privacy';

const BODY_LIMIT = 32 * 1024;

export function registerAcquisitionRoutes(app: Hono<AppEnv>): void {
  app.post(
    '/api/staff/acquisition/channels',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const body = await exactBody(context, [
        'code',
        'platform_name',
        'lead_type',
        'marketplace_code',
        'display_name',
      ]);
      if (
        typeof body['code'] !== 'string' ||
        typeof body['platform_name'] !== 'string' ||
        !isAcquisitionChannelAudience(body['lead_type']) ||
        typeof body['marketplace_code'] !== 'string' ||
        typeof body['display_name'] !== 'string'
      )
        validation();
      const result = await createAcquisitionChannel(
        context.env.DB,
        {
          code: body['code'],
          platformName: body['platform_name'],
          leadType: body['lead_type'],
          marketplaceCode: body['marketplace_code'],
          displayName: body['display_name'],
        },
        command(context),
      );
      return context.json(apiSuccess(result, requestIdFromContext(context)), 201);
    }),
  );
  app.post(
    '/api/staff/acquisition/channels/:id/disable',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const body = await exactBody(context, ['expected_version', 'reason']);
      if (!Number.isSafeInteger(body['expected_version']) || typeof body['reason'] !== 'string')
        validation();
      return success(
        context,
        await disableAcquisitionChannel(
          context.env.DB,
          {
            channelId: paramId(context),
            expectedVersion: Number(body['expected_version']),
            reason: body['reason'],
          },
          command(context),
        ),
      );
    }),
  );

  // Legacy channel assignment endpoints remain available to Owner for migration
  // compatibility, but new Lead creation no longer depends on them.
  app.get(
    '/api/staff/acquisition/channel-assignments',
    withErrors(async (context) =>
      success(context, {
        assignments: await listAcquisitionAssignments(context.env.DB, actor(context)),
      }),
    ),
  );
  app.post(
    '/api/staff/acquisition/channel-assignments',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const body = await exactBody(context, [
        'staff_id',
        'lead_type',
        'channel_id',
        'effective_from',
        'effective_until',
      ]);
      if (
        typeof body['staff_id'] !== 'string' ||
        !isAcquisitionLeadType(body['lead_type']) ||
        typeof body['channel_id'] !== 'string' ||
        !Number.isSafeInteger(body['effective_from']) ||
        !(body['effective_until'] === null || Number.isSafeInteger(body['effective_until']))
      )
        validation();
      return context.json(
        apiSuccess(
          await createAcquisitionAssignment(
            context.env.DB,
            {
              staffId: body['staff_id'],
              leadType: body['lead_type'],
              channelId: body['channel_id'],
              effectiveFrom: Number(body['effective_from']),
              effectiveUntil:
                body['effective_until'] === null ? null : Number(body['effective_until']),
            },
            command(context),
          ),
          requestIdFromContext(context),
        ),
        201,
      );
    }),
  );
  app.post(
    '/api/staff/acquisition/channel-assignments/:id/revoke',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const body = await exactBody(context, ['expected_version', 'reason']);
      if (!Number.isSafeInteger(body['expected_version']) || typeof body['reason'] !== 'string')
        validation();
      return success(
        context,
        await revokeAcquisitionAssignment(
          context.env.DB,
          {
            assignmentId: paramId(context),
            expectedVersion: Number(body['expected_version']),
            reason: body['reason'],
          },
          command(context),
        ),
      );
    }),
  );

  app.get(
    '/api/staff/acquisition/consultations',
    withErrors(async (context) => {
      exactQuery(context, ['from_date', 'to_date']);
      const from = context.req.query('from_date'),
        to = context.req.query('to_date');
      if (!from || !to) validation();
      return success(context, {
        consultations: await listAcquisitionConsultations(context.env.DB, actor(context), from, to),
      });
    }),
  );
  app.get(
    '/api/staff/acquisition/consultations/:id/history',
    withErrors(async (context) =>
      success(context, {
        history: await listAcquisitionConsultationHistory(
          context.env.DB,
          actor(context),
          paramId(context),
        ),
      }),
    ),
  );
  app.post(
    '/api/staff/acquisition/consultations',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const body = await exactBody(context, [
        'channel_id',
        'business_date',
        'person_count',
        'expected_version',
        'reason',
      ]);
      if (
        typeof body['channel_id'] !== 'string' ||
        typeof body['business_date'] !== 'string' ||
        !Number.isSafeInteger(body['person_count']) ||
        !Number.isSafeInteger(body['expected_version']) ||
        typeof body['reason'] !== 'string'
      )
        validation();
      return success(
        context,
        await recordAcquisitionConsultation(
          context.env.DB,
          {
            channelId: body['channel_id'],
            businessDate: body['business_date'],
            personCount: Number(body['person_count']),
            expectedVersion: Number(body['expected_version']),
            reason: body['reason'],
          },
          command(context),
        ),
      );
    }),
  );

  app.get(
    '/api/staff/acquisition/prospects',
    withErrors(async (context) => {
      exactQuery(context, ['lead_type', 'status', 'cursor', 'limit']);
      const rawType = context.req.query('lead_type') ?? null,
        rawStatus = context.req.query('status') ?? null;
      if (rawType !== null && !isAcquisitionLeadType(rawType)) validation();
      if (rawStatus !== null && !isAcquisitionProspectStatus(rawStatus)) validation();
      const rawLimit = context.req.query('limit');
      const limit = rawLimit === undefined ? 25 : Number(rawLimit);
      return success(
        context,
        await listAcquisitionProspects(context.env.DB, actor(context), {
          leadType: rawType,
          status: rawStatus,
          cursor: context.req.query('cursor') ?? null,
          limit,
        }),
      );
    }),
  );
  app.get(
    '/api/staff/acquisition/prospects/:id',
    withErrors(async (context) =>
      success(context, {
        prospect: await readAcquisitionProspect(context.env.DB, actor(context), paramId(context)),
      }),
    ),
  );
  app.post(
    '/api/staff/acquisition/prospects',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const body = await exactBody(context, [
        'lead_type',
        'marketplace_code',
        'channel_id',
        'display_name',
        'contact_value',
        'source_url',
        'origin_mode',
        'note',
        'ai_score',
      ]);
      if (
        !isAcquisitionLeadType(body['lead_type']) ||
        typeof body['marketplace_code'] !== 'string' ||
        typeof body['channel_id'] !== 'string' ||
        typeof body['display_name'] !== 'string' ||
        !(body['contact_value'] === null || typeof body['contact_value'] === 'string') ||
        !(body['source_url'] === null || typeof body['source_url'] === 'string') ||
        (body['origin_mode'] !== 'HUMAN' && body['origin_mode'] !== 'CODEX') ||
        !(body['note'] === null || typeof body['note'] === 'string') ||
        !(body['ai_score'] === null || Number.isSafeInteger(body['ai_score']))
      )
        validation();
      return context.json(
        apiSuccess(
          await createAcquisitionProspect(
            context.env.DB,
            {
              leadType: body['lead_type'],
              marketplaceCode: body['marketplace_code'],
              channelId: body['channel_id'],
              displayName: body['display_name'],
              contactValue: body['contact_value'],
              sourceUrl: body['source_url'],
              originMode: body['origin_mode'],
              note: body['note'],
              aiScore: body['ai_score'] === null ? null : Number(body['ai_score']),
            },
            command(context),
          ),
          requestIdFromContext(context),
        ),
        201,
      );
    }),
  );
  app.post(
    '/api/staff/acquisition/prospects/:id/update',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const body = await exactBody(context, ['expected_version', 'status', 'ai_score', 'note']);
      if (
        !Number.isSafeInteger(body['expected_version']) ||
        !isAcquisitionProspectStatus(body['status']) ||
        !(body['ai_score'] === null || Number.isSafeInteger(body['ai_score'])) ||
        !(body['note'] === null || typeof body['note'] === 'string')
      )
        validation();
      return success(
        context,
        await updateAcquisitionProspect(
          context.env.DB,
          paramId(context),
          {
            expectedVersion: Number(body['expected_version']),
            status: body['status'],
            aiScore: body['ai_score'] === null ? null : Number(body['ai_score']),
            note: body['note'],
          },
          command(context),
        ),
      );
    }),
  );

  app.get(
    '/api/staff/acquisition/leads',
    withErrors(async (context) => {
      exactQuery(context, ['lead_type', 'cursor', 'limit']);
      const rawType = context.req.query('lead_type') ?? null;
      if (rawType !== null && !isAcquisitionLeadType(rawType)) validation();
      const rawLimit = context.req.query('limit');
      const limit = rawLimit === undefined ? 25 : Number(rawLimit);
      return success(
        context,
        await listAcquisitionLeads(
          context.env.DB,
          actor(context),
          { leadType: rawType, cursor: context.req.query('cursor') ?? null, limit },
          requireAcquisitionSecret(context.env.CUSTOMER_SECURITY_TOKEN_SECRET),
        ),
      );
    }),
  );
  app.get(
    '/api/staff/acquisition/leads/:id',
    withErrors(async (context) =>
      success(context, {
        lead: await readAcquisitionLead(
          context.env.DB,
          actor(context),
          paramId(context),
          requireAcquisitionSecret(context.env.CUSTOMER_SECURITY_TOKEN_SECRET),
        ),
      }),
    ),
  );
  app.post(
    '/api/staff/acquisition/leads',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const body = await exactBody(context, [
        'lead_type',
        'marketplace_code',
        'channel_id',
        'prospect_id',
        'wechat_id',
        'display_name',
        'note',
      ]);
      if (
        !isAcquisitionLeadType(body['lead_type']) ||
        typeof body['marketplace_code'] !== 'string' ||
        typeof body['channel_id'] !== 'string' ||
        !(body['prospect_id'] === null || typeof body['prospect_id'] === 'string') ||
        typeof body['wechat_id'] !== 'string' ||
        !(body['display_name'] === null || typeof body['display_name'] === 'string') ||
        !(body['note'] === null || typeof body['note'] === 'string')
      )
        validation();
      return context.json(
        apiSuccess(
          await createAcquisitionLead(
            context.env.DB,
            {
              leadType: body['lead_type'],
              marketplaceCode: body['marketplace_code'],
              channelId: body['channel_id'],
              prospectId: body['prospect_id'],
              wechatId: body['wechat_id'],
              displayName: body['display_name'],
              note: body['note'],
            },
            command(context),
            requireAcquisitionSecret(context.env.CUSTOMER_SECURITY_TOKEN_SECRET),
          ),
          requestIdFromContext(context),
        ),
        201,
      );
    }),
  );
  app.post(
    '/api/staff/acquisition/leads/:id/follow-ups',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const body = await exactBody(context, ['expected_version', 'note']);
      if (
        !Number.isSafeInteger(body['expected_version']) ||
        !(body['note'] === null || typeof body['note'] === 'string')
      )
        validation();
      return success(
        context,
        await followUpAcquisitionLead(
          context.env.DB,
          {
            leadId: paramId(context),
            expectedVersion: Number(body['expected_version']),
            note: body['note'],
          },
          command(context),
          requireAcquisitionSecret(context.env.CUSTOMER_SECURITY_TOKEN_SECRET),
        ),
      );
    }),
  );
  app.post(
    '/api/staff/acquisition/leads/:id/invalidate',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const body = await exactBody(context, ['expected_version', 'reason']);
      if (!Number.isSafeInteger(body['expected_version']) || typeof body['reason'] !== 'string')
        validation();
      return success(
        context,
        await invalidateAcquisitionLead(
          context.env.DB,
          {
            leadId: paramId(context),
            expectedVersion: Number(body['expected_version']),
            reason: body['reason'],
          },
          command(context),
          requireAcquisitionSecret(context.env.CUSTOMER_SECURITY_TOKEN_SECRET),
        ),
      );
    }),
  );
  app.post(
    '/api/staff/acquisition/leads/:id/transfer',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const body = await exactBody(context, ['expected_version', 'new_owner_staff_id', 'reason']);
      if (
        !Number.isSafeInteger(body['expected_version']) ||
        typeof body['new_owner_staff_id'] !== 'string' ||
        typeof body['reason'] !== 'string'
      )
        validation();
      return success(
        context,
        await transferAcquisitionLead(
          context.env.DB,
          {
            leadId: paramId(context),
            expectedVersion: Number(body['expected_version']),
            newOwnerStaffId: body['new_owner_staff_id'],
            reason: body['reason'],
          },
          command(context),
          requireAcquisitionSecret(context.env.CUSTOMER_SECURITY_TOKEN_SECRET),
        ),
      );
    }),
  );
  app.post(
    '/api/staff/acquisition/leads/:id/retention-hold',
    customerAuthOriginGuard(),
    withErrors(async (context) => {
      const body = await exactBody(context, ['expected_version', 'hold_reason', 'reason']);
      if (
        !Number.isSafeInteger(body['expected_version']) ||
        !(body['hold_reason'] === null || isAcquisitionRetentionHold(body['hold_reason'])) ||
        typeof body['reason'] !== 'string'
      )
        validation();
      return success(
        context,
        await setAcquisitionRetentionHold(
          context.env.DB,
          {
            leadId: paramId(context),
            expectedVersion: Number(body['expected_version']),
            holdReason: body['hold_reason'],
            reason: body['reason'],
          },
          command(context),
          requireAcquisitionSecret(context.env.CUSTOMER_SECURITY_TOKEN_SECRET),
        ),
      );
    }),
  );

  app.get(
    '/api/staff/acquisition/funnel',
    withErrors(async (context) => {
      exactQuery(context, ['from_date', 'to_date']);
      const from = context.req.query('from_date'),
        to = context.req.query('to_date');
      if (!from || !to) validation();
      return success(context, {
        funnel: await readAcquisitionFunnel(context.env.DB, actor(context), {
          fromDate: from,
          toDate: to,
        }),
      });
    }),
  );
}

function actor(context: Context<AppEnv>): AssignmentStaffAuthorization {
  const value = context.get('staffAuthorization') as AssignmentStaffAuthorization | undefined;
  if (!value || value.staffStatus !== 'ACTIVE') throw new AcquisitionError('UNAUTHENTICATED', 401);
  return value;
}
function paramId(context: Context<AppEnv>): string {
  const value = context.req.param('id');
  if (!value) validation();
  return value;
}
function command(context: Context<AppEnv>): AcquisitionCommandContext {
  let key;
  try {
    key = parseIdempotencyKey(context.req.header('Idempotency-Key'));
  } catch {
    validation();
  }
  if (!key) validation();
  return { actor: actor(context), idempotencyKey: key, requestId: requestIdFromContext(context) };
}
async function exactBody(context: Context<AppEnv>, keys: readonly string[]) {
  const value = await readBoundedJson(context.req.raw, BODY_LIMIT);
  if (!value || typeof value !== 'object' || Array.isArray(value)) validation();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key)))
    validation();
  return record;
}
function exactQuery(context: Context<AppEnv>, keys: readonly string[]): void {
  const url = new URL(context.req.url);
  if ([...url.searchParams.keys()].some((key) => !keys.includes(key))) validation();
}
function success(context: Context<AppEnv>, data: unknown): Response {
  return context.json(apiSuccess(data, requestIdFromContext(context)));
}
function withErrors(handler: (context: Context<AppEnv>) => Promise<Response>) {
  return async (context: Context<AppEnv>) => {
    try {
      return await handler(context);
    } catch (error) {
      const normalized = normalize(error);
      return context.json(
        apiFailure(normalized.code, message(normalized.code), requestIdFromContext(context)),
        normalized.status,
      );
    }
  };
}
function normalize(error: unknown): {
  code: ApiErrorCode;
  status: 400 | 401 | 403 | 404 | 409 | 429 | 503;
} {
  if (error instanceof AcquisitionError) return error;
  if (error instanceof IdempotencyError) return error;
  return { code: 'DEPENDENCY_UNAVAILABLE', status: 503 };
}
function message(code: ApiErrorCode): string {
  if (code === 'UNAUTHENTICATED') return '员工会话无效';
  if (code === 'FORBIDDEN') return '当前岗位或负责站点不允许此操作';
  if (code === 'NOT_FOUND') return '记录不存在或不在当前站点范围';
  if (code === 'CHANNEL_CONFIGURATION_MISSING') return '当前没有可用获客渠道';
  if (code === 'CHANNEL_CONFIGURATION_AMBIGUOUS') return '获客渠道配置存在冲突';
  if (code === 'DUPLICATE_LEAD') return '该微信身份已有同类型有效线索';
  if (code === 'VERSION_CONFLICT') return '记录已更新，请刷新后重试';
  if (code === 'IDEMPOTENCY_CONFLICT') return '幂等键已用于其他请求';
  if (code === 'REQUEST_IN_PROGRESS') return '相同请求正在处理中';
  if (code === 'VALIDATION_ERROR') return '请求内容不正确';
  return '获客服务暂时不可用';
}
