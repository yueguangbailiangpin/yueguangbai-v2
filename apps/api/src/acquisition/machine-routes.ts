import { apiFailure, apiSuccess, isAcquisitionLeadType } from '@ygb/contracts';
import { parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Hono } from 'hono';
import { IdempotencyError } from '../foundation/idempotency';
import { AcquisitionError, validation } from './errors';
import {
  authenticateAcquisitionMachine,
  requireMachineScope,
  type AcquisitionMachineIdentity,
} from './machine-credentials';
import {
  addMachineProspectSignal,
  createMachineProspect,
  updateMachineProspectAnalysis,
} from './prospects';
import type { AcquisitionMachineCommandContext } from './command';

const BODY_LIMIT = 32 * 1024;
const MACHINE_STATUSES = new Set(['NEW', 'RESEARCHING', 'QUALIFIED', 'READY_CONTACT']);

export function registerAcquisitionMachineRoutes(app: Hono<any>): void {
  app.post(
    '/api/acquisition-machine/prospects',
    wrap(async (context) => {
      const machine = await authenticateAcquisitionMachine(context.env.DB, context.req.raw);
      const command = machineCommand(context, machine),
        body = await bodyObject(context.req.raw);
      exact(body, [
        'lead_type',
        'marketplace_code',
        'channel_id',
        'display_name',
        'contact_value',
        'source_url',
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
        !(body['note'] === null || typeof body['note'] === 'string') ||
        !(body['ai_score'] === null || Number.isSafeInteger(body['ai_score']))
      )
        validation();
      requireMachineScope(machine, body['marketplace_code'], body['channel_id']);
      const result = await createMachineProspect(
        context.env.DB,
        {
          leadType: body['lead_type'],
          marketplaceCode: body['marketplace_code'],
          channelId: body['channel_id'],
          displayName: body['display_name'],
          contactValue: body['contact_value'],
          sourceUrl: body['source_url'],
          note: body['note'],
          aiScore: body['ai_score'] === null ? null : Number(body['ai_score']),
        },
        command,
      );
      return context.json(apiSuccess(result, requestId(context)), 201, {
        'Cache-Control': 'no-store',
      });
    }),
  );

  app.post(
    '/api/acquisition-machine/prospects/:id/signals',
    wrap(async (context) => {
      const machine = await authenticateAcquisitionMachine(context.env.DB, context.req.raw);
      const prospectId = required(context.req.param('id'));
      const command = machineCommand(context, machine);
      const body = await bodyObject(context.req.raw);
      exact(body, ['signal_type', 'signal_content', 'source_url', 'confidence']);
      if (
        typeof body['signal_type'] !== 'string' ||
        typeof body['signal_content'] !== 'string' ||
        !(body['source_url'] === null || typeof body['source_url'] === 'string') ||
        !['LOW', 'MEDIUM', 'HIGH', 'CONFIRMED'].includes(String(body['confidence']))
      )
        validation();
      const result = await addMachineProspectSignal(
        context.env.DB,
        prospectId,
        {
          signalType: body['signal_type'],
          signalContent: body['signal_content'],
          sourceUrl: body['source_url'],
          confidence: body['confidence'] as 'LOW' | 'MEDIUM' | 'HIGH' | 'CONFIRMED',
        },
        command,
      );
      return context.json(apiSuccess(result, requestId(context)), 201, {
        'Cache-Control': 'no-store',
      });
    }),
  );

  app.post(
    '/api/acquisition-machine/prospects/:id/analysis',
    wrap(async (context) => {
      const machine = await authenticateAcquisitionMachine(context.env.DB, context.req.raw);
      const id = required(context.req.param('id'));
      const command = machineCommand(context, machine);
      const body = await bodyObject(context.req.raw);
      exact(body, ['expected_version', 'status', 'ai_score', 'note']);
      if (
        !Number.isSafeInteger(body['expected_version']) ||
        typeof body['status'] !== 'string' ||
        !MACHINE_STATUSES.has(body['status']) ||
        !(body['ai_score'] === null || Number.isSafeInteger(body['ai_score'])) ||
        !(body['note'] === null || typeof body['note'] === 'string')
      )
        validation();
      const result = await updateMachineProspectAnalysis(
        context.env.DB,
        id,
        {
          expectedVersion: Number(body['expected_version']),
          status: body['status'] as 'NEW' | 'RESEARCHING' | 'QUALIFIED' | 'READY_CONTACT',
          aiScore: body['ai_score'] === null ? null : Number(body['ai_score']),
          note: body['note'],
        },
        command,
      );
      return context.json(apiSuccess(result, requestId(context)), 200, {
        'Cache-Control': 'no-store',
      });
    }),
  );
}

function machineCommand(
  context: any,
  machine: AcquisitionMachineIdentity,
): AcquisitionMachineCommandContext {
  let key;
  try {
    key = parseIdempotencyKey(context.req.header('Idempotency-Key'));
  } catch {
    validation();
  }
  if (!key) validation();
  return {
    machineId: machine.machineId,
    marketplaceCodes: machine.marketplaceCodes,
    channelIds: machine.channelIds,
    idempotencyKey: key,
    requestId: requestId(context),
  };
}
async function bodyObject(request: Request) {
  const value = await readBoundedJson(request, BODY_LIMIT);
  if (!value) validation();
  return value;
}
function exact(record: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(record).sort(),
    expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    validation();
}
function required(value: string) {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 200 || /[\u0000-\u001f\u007f]/u.test(normalized))
    validation();
  return normalized;
}
function requestId(context: { get: (key: string) => unknown }) {
  return String(context.get('requestId') ?? crypto.randomUUID());
}
function wrap(handler: (context: any) => Promise<Response>) {
  return async (context: any) => {
    try {
      return await handler(context);
    } catch (error) {
      const e =
        error instanceof AcquisitionError
          ? error
          : error instanceof IdempotencyError
            ? error
            : new AcquisitionError('DEPENDENCY_UNAVAILABLE', 503);
      return context.json(
        apiFailure(
          e.code,
          e.code === 'UNAUTHENTICATED'
            ? '机器密钥无效或已停用'
            : e.code === 'RATE_LIMITED'
              ? '机器请求过于频繁'
              : e.code === 'FORBIDDEN'
                ? '该机器没有这个站点或渠道权限'
                : e.code === 'NOT_FOUND'
                  ? '潜在线索不存在'
                  : e.code === 'VERSION_CONFLICT'
                    ? '潜在线索已更新，请重新读取'
                    : e.code === 'VALIDATION_ERROR'
                      ? '请求内容不正确'
                      : '获客机器接口暂时不可用',
          requestId(context),
        ),
        e.status,
      );
    }
  };
}
