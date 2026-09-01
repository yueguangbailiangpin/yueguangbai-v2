import { apiFailure, apiSuccess, type SqlDatabase } from '@ygb/contracts';
import { hashCanonicalJson, parseIdempotencyKey, readBoundedJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import type { AppBindings, AppEnv } from '../app';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  IdempotencyError,
  markIdempotencyFailed,
  type IdempotencyClaim,
} from '../foundation/idempotency';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import {
  expectedOperationalAlertOutcome,
  OPERATIONAL_ALERT_CHALLENGE_TYPES,
  type OperationalAlertChallengeType,
  type OperationalAlertVerificationChallenge,
  type OperationalAlertVerificationReceipt,
} from './alert-sink-contract';
import {
  resolveOperationalAlertRuntimeConfiguration,
  type OperationalAlertRuntimeConfiguration,
} from './alert-runtime';

const BODY_LIMIT = 16 * 1024;
const MAX_ATTESTATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const CHALLENGE_LIFETIME_MS = 2 * 60 * 1000;
const MAX_RECEIPT_CLOCK_SKEW_MS = 5_000;
export const OPERATIONAL_ALERT_ATTESTATION_EVENT = 'OPERATIONAL_ALERT_SINK_ATTESTED';
export const OPERATIONAL_ALERT_ATTESTATION_AGGREGATE = 'OPERATIONAL_ALERT_ATTESTATION';

interface VerifiedReceiptSummary {
  receipt_id: string;
  challenge_id: string;
  challenge_type: OperationalAlertChallengeType;
  observed_outcome: 'DELIVERED' | 'FAILURE_PATH_VERIFIED' | 'RECOVERED';
  issued_at: number;
  expires_at: number;
  binding_fingerprint: string;
  sink_deployment_version: string;
}
export interface OperationalAlertAttestation {
  attestation_id: string;
  release_sha: string;
  sink_identity: string;
  sink_deployment_version: string;
  sink_config_fingerprint: string;
  verified_at: number;
  expires_at: number;
  evidence_reference: string;
  verified_by_staff_id: string;
  verified_receipts: readonly VerifiedReceiptSummary[];
}

class AlertAttestationError extends Error {
  constructor(
    public readonly code: 'VALIDATION_ERROR' | 'FORBIDDEN' | 'CONFLICT' | 'DEPENDENCY_UNAVAILABLE',
    public readonly status: 400 | 403 | 409 | 503,
  ) {
    super(code);
  }
}

export function registerOperationalAlertAttestationRoutes(app: Hono<AppEnv>): void {
  app.post(
    '/api/staff/production-readiness/operational-alert-attestations',
    customerAuthOriginGuard(),
    wrap(async (context) => {
      const actor = owner(context),
        body = await exactBody(context, ['expires_at', 'evidence_reference']);
      const expiresAt = integer(body['expires_at']),
        evidence = text(body['evidence_reference'], 8, 1000),
        startedAt = Date.now();
      if (
        expiresAt === null ||
        !evidence ||
        !validAttestationTiming(startedAt, expiresAt, startedAt)
      )
        validation();
      const runtime = await resolveOperationalAlertRuntimeConfiguration(context.env);
      if (!runtime) throw new AlertAttestationError('DEPENDENCY_UNAVAILABLE', 503);
      const payload = {
        release_sha: runtime.releaseSha,
        sink_identity: runtime.descriptor.props.sink_identity,
        sink_deployment_version: runtime.descriptor.props.sink_deployment_version,
        sink_config_fingerprint: runtime.fingerprint,
        expires_at: expiresAt,
        evidence_reference: evidence,
      };
      const idempotencyKey = idempotency(context),
        requestHash = await hashCanonicalJson({ action: 'ATTEST_OPERATIONAL_ALERT_SINK', payload });
      const aggregateId = `${runtime.releaseSha}:${runtime.fingerprint}`;
      const acquired = await acquireIdempotency<OperationalAlertAttestation>(context.env.DB, {
        actorType: 'STAFF',
        actorId: actor.staffId,
        idempotencyKey,
        requestHash,
        action: 'ATTEST_OPERATIONAL_ALERT_SINK',
        targetType: OPERATIONAL_ALERT_ATTESTATION_AGGREGATE,
        targetId: aggregateId,
      });
      if (acquired.kind === 'REPLAY') return success(context, acquired.response, 200);
      const claim = acquired.claim;
      try {
        const receipts = await verifyAllChallenges(runtime, startedAt);
        const verifiedAt = Date.now();
        if (!validAttestationTiming(verifiedAt, expiresAt, verifiedAt))
          throw new AlertAttestationError('CONFLICT', 409);
        const response: OperationalAlertAttestation = {
          attestation_id: crypto.randomUUID(),
          ...payload,
          verified_at: verifiedAt,
          verified_by_staff_id: actor.staffId,
          verified_receipts: receipts,
        };
        await context.env.DB.batch([
          createAuditEventStatement(context.env.DB, {
            id: response.attestation_id,
            aggregateType: OPERATIONAL_ALERT_ATTESTATION_AGGREGATE,
            aggregateId,
            eventType: OPERATIONAL_ALERT_ATTESTATION_EVENT,
            actor: { type: 'STAFF', id: actor.staffId, roles: [...actor.roles] },
            requestId: requestIdFromContext(context),
            idempotencyKey,
            nextState: response,
            reason: evidence,
            createdAt: verifiedAt,
          }),
          context.env.DB.prepare(
            `INSERT INTO transaction_assertions(assertion_value) SELECT CASE WHEN EXISTS(SELECT 1 FROM audit_events WHERE id=? AND event_type=? AND actor_type='STAFF') THEN 1 ELSE 0 END`,
          ).bind(response.attestation_id, OPERATIONAL_ALERT_ATTESTATION_EVENT),
          completeIdempotencyStatement(context.env.DB, claim, response, {
            now: verifiedAt,
            resultReferences: {
              attestation_id: response.attestation_id,
            },
          }),
          assertIdempotencyCompletionStatement(context.env.DB, claim),
        ]);
        return success(context, response, 201);
      } catch (error) {
        await fail(context.env.DB, claim, startedAt);
        throw error;
      }
    }),
  );
}

export async function operationalAlertAttestationReady(
  database: SqlDatabase,
  bindings: AppBindings,
  now: number,
): Promise<boolean> {
  if (bindings.APP_ENVIRONMENT !== 'production') return true;
  const runtime = await resolveOperationalAlertRuntimeConfiguration(bindings);
  if (!runtime) return false;
  const row = await database
    .prepare(
      `SELECT next_state_json FROM audit_events WHERE aggregate_type=? AND event_type=? AND actor_type='STAFF' ORDER BY created_at DESC,id DESC LIMIT 1`,
    )
    .bind(OPERATIONAL_ALERT_ATTESTATION_AGGREGATE, OPERATIONAL_ALERT_ATTESTATION_EVENT)
    .first<{ next_state_json: string }>();
  if (!row) return false;
  try {
    const record = asRecord(JSON.parse(row.next_state_json));
    if (
      !record ||
      !exactKeys(record, [
        'attestation_id',
        'release_sha',
        'sink_identity',
        'sink_deployment_version',
        'sink_config_fingerprint',
        'verified_at',
        'expires_at',
        'evidence_reference',
        'verified_by_staff_id',
        'verified_receipts',
      ])
    )
      return false;
    const receipts = Array.isArray(record['verified_receipts']) ? record['verified_receipts'] : [];
    return (
      record['release_sha'] === runtime.releaseSha &&
      record['sink_identity'] === runtime.descriptor.props.sink_identity &&
      record['sink_deployment_version'] === runtime.descriptor.props.sink_deployment_version &&
      record['sink_config_fingerprint'] === runtime.fingerprint &&
      typeof record['verified_at'] === 'number' &&
      typeof record['expires_at'] === 'number' &&
      validAttestationTiming(record['verified_at'], record['expires_at'], now) &&
      verifiedStoredReceiptSet(receipts, runtime)
    );
  } catch {
    return false;
  }
}

async function verifyAllChallenges(
  runtime: OperationalAlertRuntimeConfiguration,
  issuedAt: number,
): Promise<readonly VerifiedReceiptSummary[]> {
  const receipts: VerifiedReceiptSummary[] = [];
  const receiptIds = new Set<string>();
  for (const challengeType of OPERATIONAL_ALERT_CHALLENGE_TYPES) {
    const challenge = challengeFor(runtime, challengeType, issuedAt);
    let raw: unknown;
    try {
      raw = await runtime.sink.verifyOperationalAlertChallenge(challenge);
    } catch {
      throw new AlertAttestationError('DEPENDENCY_UNAVAILABLE', 503);
    }
    const receipt = validateReceipt(raw, challenge, runtime, Date.now());
    if (receiptIds.has(receipt.receipt_id))
      throw new AlertAttestationError('DEPENDENCY_UNAVAILABLE', 503);
    receiptIds.add(receipt.receipt_id);
    receipts.push({
      receipt_id: receipt.receipt_id,
      challenge_id: receipt.challenge_id,
      challenge_type: receipt.challenge_type,
      observed_outcome: receipt.observed_outcome,
      issued_at: receipt.issued_at,
      expires_at: receipt.expires_at,
      binding_fingerprint: receipt.binding_fingerprint,
      sink_deployment_version: receipt.sink_deployment_version,
    });
  }
  return Object.freeze(receipts);
}
function challengeFor(
  runtime: OperationalAlertRuntimeConfiguration,
  type: OperationalAlertChallengeType,
  issuedAt: number,
): OperationalAlertVerificationChallenge {
  return {
    protocol_version: 'moonwhite-operational-alert-verification-v1',
    challenge_id: crypto.randomUUID(),
    challenge_type: type,
    nonce: randomNonce(),
    release_sha: runtime.releaseSha,
    binding_fingerprint: runtime.fingerprint,
    sink_identity: runtime.descriptor.props.sink_identity,
    sink_deployment_version: runtime.descriptor.props.sink_deployment_version,
    issued_at: issuedAt,
    expires_at: issuedAt + CHALLENGE_LIFETIME_MS,
    simulation_mode: 'SAFE_NO_PRODUCTION_DISRUPTION',
  };
}
function validateReceipt(
  value: unknown,
  challenge: OperationalAlertVerificationChallenge,
  runtime: OperationalAlertRuntimeConfiguration,
  now: number,
): OperationalAlertVerificationReceipt {
  const receipt = asRecord(value);
  if (
    !receipt ||
    !exactKeys(receipt, [
      'protocol_version',
      'receipt_id',
      'challenge_id',
      'challenge_type',
      'nonce',
      'release_sha',
      'binding_fingerprint',
      'sink_identity',
      'sink_deployment_version',
      'observed_outcome',
      'issued_at',
      'expires_at',
    ])
  )
    dependency();
  const issuedAt = integer(receipt['issued_at']),
    expiresAt = integer(receipt['expires_at']),
    receiptId = safeId(receipt['receipt_id']);
  if (
    !receiptId ||
    issuedAt === null ||
    expiresAt === null ||
    receipt['protocol_version'] !== 'moonwhite-operational-alert-verification-v1' ||
    receipt['challenge_id'] !== challenge.challenge_id ||
    receipt['challenge_type'] !== challenge.challenge_type ||
    receipt['nonce'] !== challenge.nonce ||
    receipt['release_sha'] !== runtime.releaseSha ||
    receipt['binding_fingerprint'] !== runtime.fingerprint ||
    receipt['sink_identity'] !== runtime.descriptor.props.sink_identity ||
    receipt['sink_deployment_version'] !== runtime.descriptor.props.sink_deployment_version ||
    receipt['observed_outcome'] !== expectedOperationalAlertOutcome(challenge.challenge_type) ||
    issuedAt < challenge.issued_at - MAX_RECEIPT_CLOCK_SKEW_MS ||
    issuedAt > now + MAX_RECEIPT_CLOCK_SKEW_MS ||
    expiresAt <= now ||
    expiresAt > challenge.expires_at ||
    expiresAt <= issuedAt
  )
    dependency();
  return {
    protocol_version: 'moonwhite-operational-alert-verification-v1',
    receipt_id: receiptId,
    challenge_id: challenge.challenge_id,
    challenge_type: challenge.challenge_type,
    nonce: challenge.nonce,
    release_sha: runtime.releaseSha,
    binding_fingerprint: runtime.fingerprint,
    sink_identity: runtime.descriptor.props.sink_identity,
    sink_deployment_version: runtime.descriptor.props.sink_deployment_version,
    observed_outcome: expectedOperationalAlertOutcome(challenge.challenge_type),
    issued_at: issuedAt,
    expires_at: expiresAt,
  };
}
function verifiedStoredReceiptSet(
  value: unknown[],
  runtime: OperationalAlertRuntimeConfiguration,
): boolean {
  if (value.length !== 3) return false;
  const types = new Set<string>(),
    ids = new Set<string>();
  for (const item of value) {
    const row = asRecord(item);
    if (
      !row ||
      !exactKeys(row, [
        'receipt_id',
        'challenge_id',
        'challenge_type',
        'observed_outcome',
        'issued_at',
        'expires_at',
        'binding_fingerprint',
        'sink_deployment_version',
      ])
    )
      return false;
    const receiptId = safeId(row['receipt_id']),
      challengeId = safeId(row['challenge_id']),
      type = row['challenge_type'];
    if (
      !receiptId ||
      !challengeId ||
      typeof type !== 'string' ||
      !OPERATIONAL_ALERT_CHALLENGE_TYPES.includes(type as OperationalAlertChallengeType) ||
      row['observed_outcome'] !==
        expectedOperationalAlertOutcome(type as OperationalAlertChallengeType) ||
      integer(row['issued_at']) === null ||
      integer(row['expires_at']) === null ||
      row['binding_fingerprint'] !== runtime.fingerprint ||
      row['sink_deployment_version'] !== runtime.descriptor.props.sink_deployment_version ||
      ids.has(receiptId) ||
      types.has(type)
    )
      return false;
    ids.add(receiptId);
    types.add(type);
  }
  return true;
}
function validAttestationTiming(verifiedAt: number, expiresAt: number, now: number): boolean {
  return (
    Number.isSafeInteger(verifiedAt) &&
    Number.isSafeInteger(expiresAt) &&
    verifiedAt <= now + MAX_RECEIPT_CLOCK_SKEW_MS &&
    expiresAt > now &&
    expiresAt > verifiedAt &&
    expiresAt - verifiedAt <= MAX_ATTESTATION_LIFETIME_MS
  );
}
function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
function safeId(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= 200 &&
    /^[A-Za-z0-9._:/@-]+$/u.test(value)
    ? value
    : null;
}
function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function text(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim();
  return normalized.length >= min &&
    normalized.length <= max &&
    !/[\u0000-\u001f\u007f]/u.test(normalized)
    ? normalized
    : null;
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(),
    expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function owner(context: Context<AppEnv>): AssignmentStaffAuthorization {
  const actor = context.get('staffAuthorization') as AssignmentStaffAuthorization | undefined;
  if (
    !actor ||
    actor.staffStatus !== 'ACTIVE' ||
    !actor.roles.has('owner') ||
    !actor.permissions.has('AUDIT_VIEW')
  )
    throw new AlertAttestationError('FORBIDDEN', 403);
  return actor;
}
function idempotency(context: Context<AppEnv>): string {
  try {
    const value = parseIdempotencyKey(context.req.header('Idempotency-Key'));
    if (value) return value;
  } catch {}
  validation();
}
async function exactBody(
  context: Context<AppEnv>,
  keys: readonly string[],
): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await readBoundedJson(context.req.raw, BODY_LIMIT);
  } catch {
    validation();
  }
  const body = asRecord(value);
  if (!body || !exactKeys(body, keys)) validation();
  return body;
}
function validation(): never {
  throw new AlertAttestationError('VALIDATION_ERROR', 400);
}
function dependency(): never {
  throw new AlertAttestationError('DEPENDENCY_UNAVAILABLE', 503);
}
async function fail(database: SqlDatabase, claim: IdempotencyClaim, now: number): Promise<void> {
  await markIdempotencyFailed(database, claim, 'OPERATIONAL_ALERT_ATTESTATION_FAILED', now).catch(
    () => false,
  );
}
function success(context: Context<AppEnv>, data: unknown, status: 200 | 201) {
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(data, requestIdFromContext(context)), status);
}
function wrap(handler: (context: Context<AppEnv>) => Promise<Response>) {
  return async (context: Context<AppEnv>) => {
    try {
      return await handler(context);
    } catch (error) {
      const e =
        error instanceof AlertAttestationError || error instanceof IdempotencyError
          ? error
          : new AlertAttestationError('DEPENDENCY_UNAVAILABLE', 503);
      const message =
        e.code === 'FORBIDDEN'
          ? '只有总管理员可以登记告警演练证明'
          : e.code === 'CONFLICT'
            ? '告警演练证明与当前 release、sink 配置或有效期不匹配'
            : e.code === 'IDEMPOTENCY_CONFLICT'
              ? '幂等键已用于其他请求'
              : e.code === 'REQUEST_IN_PROGRESS'
                ? '相同请求正在处理中'
                : e.code === 'VALIDATION_ERROR'
                  ? '告警演练证明内容不正确'
                  : '告警演练证明服务暂时不可用';
      return context.json(apiFailure(e.code, message, requestIdFromContext(context)), e.status);
    }
  };
}
