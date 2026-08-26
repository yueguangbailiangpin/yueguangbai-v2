import { apiFailure, apiSuccess } from '@ygb/contracts';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../app';
import { createAuditEventStatement } from '../foundation/audit';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { parseExactGitCommitSha } from '@ygb/domain';

const TARGET_SCHEMA = 27;
class RecoveryAttestationError extends Error {
  constructor(
    public code: 'VALIDATION_ERROR' | 'FORBIDDEN' | 'CONFLICT' | 'DEPENDENCY_UNAVAILABLE',
    public status: 400 | 403 | 409 | 503,
  ) {
    super(code);
  }
}

export function registerProductionRecoveryAttestationRoutes(app: Hono<AppEnv>): void {
  app.get(
    '/api/staff/production-readiness/recovery-attestations/latest',
    wrap(async (context) => {
      owner(context);
      const row = await context.env.DB.prepare(
        `SELECT id,release_sha,schema_version,d1_manifest_sha256,r2_manifest_sha256,restored_database_integrity_ok,restored_foreign_keys_ok,r2_sample_readback_ok,verified_at,verified_by_staff_id,evidence_note FROM production_recovery_attestations ORDER BY schema_version DESC,verified_at DESC,id DESC LIMIT 1`,
      ).first<any>();
      return success(context, { attestation: row ? project(row) : null });
    }),
  );
  app.post(
    '/api/staff/production-readiness/recovery-attestations',
    customerAuthOriginGuard(),
    wrap(async (context) => {
      const actor = owner(context);
      const body = await exact(context, [
        'release_sha',
        'schema_version',
        'd1_manifest_sha256',
        'r2_manifest_sha256',
        'restored_database_integrity_ok',
        'restored_foreign_keys_ok',
        'r2_sample_readback_ok',
        'evidence_note',
      ]);
      const releaseSha = parseExactGitCommitSha(body['release_sha']),
        schemaVersion = integer(body['schema_version']),
        d1 = sha(body['d1_manifest_sha256'], 64, 64),
        r2 = sha(body['r2_manifest_sha256'], 64, 64),
        note = text(body['evidence_note'], 8, 2000);
      if (!releaseSha) validation();
      if (
        body['restored_database_integrity_ok'] !== true ||
        body['restored_foreign_keys_ok'] !== true ||
        body['r2_sample_readback_ok'] !== true ||
        schemaVersion !== TARGET_SCHEMA
      )
        validation();
      const runningRelease = parseExactGitCommitSha(context.env.APP_RELEASE_SHA);
      if (runningRelease === null || releaseSha !== runningRelease)
        throw new RecoveryAttestationError('CONFLICT', 409);
      const state = await context.env.DB.prepare(
        `SELECT schema_version FROM app_schema_state WHERE singleton_id=1`,
      ).first<{ schema_version: number }>();
      if (Number(state?.schema_version) !== TARGET_SCHEMA)
        throw new RecoveryAttestationError('CONFLICT', 409);
      const duplicate = await context.env.DB.prepare(
        `SELECT id FROM production_recovery_attestations WHERE release_sha=? AND schema_version=? AND d1_manifest_sha256=? AND r2_manifest_sha256=? LIMIT 1`,
      )
        .bind(releaseSha, schemaVersion, d1, r2)
        .first();
      if (duplicate) throw new RecoveryAttestationError('CONFLICT', 409);
      const now = Date.now(),
        id = crypto.randomUUID();
      await context.env.DB.batch([
        context.env.DB.prepare(
          `INSERT INTO production_recovery_attestations(id,release_sha,schema_version,d1_manifest_sha256,r2_manifest_sha256,restored_database_integrity_ok,restored_foreign_keys_ok,r2_sample_readback_ok,verified_at,verified_by_staff_id,evidence_note) VALUES(?,?,?,?,?,1,1,1,?,?,?)`,
        ).bind(id, releaseSha, schemaVersion, d1, r2, now, actor.staffId, note),
        createAuditEventStatement(context.env.DB, {
          id: crypto.randomUUID(),
          aggregateType: 'PRODUCTION_RECOVERY_ATTESTATION',
          aggregateId: id,
          eventType: 'PRODUCTION_RECOVERY_ATTESTED',
          actor: { type: 'STAFF', id: actor.staffId, roles: [...actor.roles] },
          requestId: requestIdFromContext(context),
          nextState: {
            release_sha: releaseSha,
            schema_version: schemaVersion,
            d1_manifest_sha256: d1,
            r2_manifest_sha256: r2,
            restored_database_integrity_ok: true,
            restored_foreign_keys_ok: true,
            r2_sample_readback_ok: true,
          },
          reason: note,
          createdAt: now,
        }),
      ]);
      return success(
        context,
        {
          attestation: {
            attestation_id: id,
            release_sha: releaseSha,
            schema_version: schemaVersion,
            d1_manifest_sha256: d1,
            r2_manifest_sha256: r2,
            restored_database_integrity_ok: true,
            restored_foreign_keys_ok: true,
            r2_sample_readback_ok: true,
            verified_at: now,
            verified_by_staff_id: actor.staffId,
            evidence_note: note,
          },
        },
        201,
      );
    }),
  );
}
function project(row: any) {
  return {
    attestation_id: String(row.id),
    release_sha: String(row.release_sha),
    schema_version: Number(row.schema_version),
    d1_manifest_sha256: String(row.d1_manifest_sha256),
    r2_manifest_sha256: String(row.r2_manifest_sha256),
    restored_database_integrity_ok: Number(row.restored_database_integrity_ok) === 1,
    restored_foreign_keys_ok: Number(row.restored_foreign_keys_ok) === 1,
    r2_sample_readback_ok: Number(row.r2_sample_readback_ok) === 1,
    verified_at: Number(row.verified_at),
    verified_by_staff_id:
      row.verified_by_staff_id === null ? null : String(row.verified_by_staff_id),
    evidence_note: String(row.evidence_note),
  };
}
function owner(context: Context<AppEnv>) {
  const actor = context.get('staffAuthorization') as AssignmentStaffAuthorization | undefined;
  if (
    !actor ||
    actor.staffStatus !== 'ACTIVE' ||
    !actor.roles.has('owner') ||
    !actor.permissions.has('AUDIT_VIEW')
  )
    throw new RecoveryAttestationError('FORBIDDEN', 403);
  return actor;
}
async function exact(context: Context<AppEnv>, keys: string[]) {
  let value: unknown;
  try {
    value = await context.req.json();
  } catch {
    validation();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) validation();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== keys.length || keys.some((key) => !Object.hasOwn(body, key)))
    validation();
  return body;
}
function sha(value: unknown, min: number, max: number) {
  if (typeof value !== 'string') validation();
  const normalized = value.trim().toLowerCase();
  if (normalized.length < min || normalized.length > max || !/^[0-9a-f]+$/u.test(normalized))
    validation();
  return normalized;
}
function integer(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) validation();
  return value;
}
function text(value: unknown, min: number, max: number) {
  if (typeof value !== 'string') validation();
  const normalized = value.normalize('NFKC').trim();
  if (
    normalized.length < min ||
    normalized.length > max ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  )
    validation();
  return normalized;
}
function validation(): never {
  throw new RecoveryAttestationError('VALIDATION_ERROR', 400);
}
function success(context: Context<AppEnv>, data: unknown, status = 200) {
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(data, requestIdFromContext(context)), status as 200 | 201);
}
function wrap(handler: (context: Context<AppEnv>) => Promise<Response>) {
  return async (context: Context<AppEnv>) => {
    try {
      return await handler(context);
    } catch (error) {
      const e =
        error instanceof RecoveryAttestationError
          ? error
          : new RecoveryAttestationError('DEPENDENCY_UNAVAILABLE', 503);
      return context.json(
        apiFailure(
          e.code,
          e.code === 'FORBIDDEN'
            ? '只有总管理员可以登记生产恢复证明'
            : e.code === 'CONFLICT'
              ? '恢复证明必须对应当前 Schema 和当前部署版本，且不能重复登记'
              : e.code === 'VALIDATION_ERROR'
                ? '恢复证明内容不正确'
                : '生产恢复证明服务暂时不可用',
          requestIdFromContext(context),
        ),
        e.status,
      );
    }
  };
}
