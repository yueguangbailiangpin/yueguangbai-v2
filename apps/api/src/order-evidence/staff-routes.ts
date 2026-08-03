import {
  apiFailure,
  apiSuccess,
  STAFF_ORDER_EVIDENCE_LIST_STATUSES,
  type ApiErrorCode,
  type StaffDataScope,
  type StaffOrderEvidenceDetailDto,
  type StaffOrderEvidenceListItem,
} from '@ygb/contracts';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../app';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { requestOrderEvidenceChanges } from './review-order-evidence';
import {
  approveOrderEvidenceAtomically,
  AtomicOrderEvidenceApprovalError,
} from './approve-order-evidence';

const BODY_LIMIT_BYTES = 16 * 1024;
const CURSOR_MAX_LENGTH = 2048;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

interface OrderEvidenceDetailRow {
  submission_id: string;
  reservation_id: string;
  buyer_customer_id: string;
  buyer_customer_no: string | null;
  marketplace_code: 'JP';
  status: StaffOrderEvidenceDetailDto['status'];
  aggregate_version: number;
  current_version_no: number;
  evidence_version_id: string;
  amazon_order_number_raw: string;
  amazon_order_number_normalized: string;
  final_paid_jpy: number;
  buyer_note: string | null;
  public_change_reason: string | null;
  internal_review_note: string | null;
  submitted_at: number;
  updated_at: number;
  verified_at: number | null;
  withdrawn_at: number | null;
  verified_by_staff_id: string | null;
  reference_order_amount_jpy: number;
  price_difference_jpy: number;
  price_mismatch: number;
  instruction_id: string;
  instruction_version_id: string;
  buyer_self_pay_bps: number;
  buyer_self_pay_jpy: number;
  buyer_refundable_principal_jpy: number;
  reservation_status: string;
  reservation_version: number;
  screenshot_file_object_id: string;
  screenshot_file_version: number;
  screenshot_purpose: 'ORDER_EVIDENCE';
  screenshot_visibility: 'BUYER_VISIBLE';
  screenshot_file_status: string;
  screenshot_intent_status: string;
  screenshot_owner_actor_type: string;
  screenshot_owner_actor_id: string;
  screenshot_association_count: number;
  associated_file_object_id: string | null;
  eligible_screenshot_association_count: number;
  duplicate_signal_count: number;
  work_item_id: string | null;
  assigned_staff_id: string | null;
  fixed_assignment_id: string | null;
}

export function registerStaffOrderEvidenceRoutes(app: Hono<AppEnv>): void {
  app.get(
    '/api/staff/order-evidence',
    withStaffOrderEvidenceErrors(listStaffOrderEvidence),
  );
  app.get(
    '/api/staff/order-evidence/:id',
    withStaffOrderEvidenceErrors(getStaffOrderEvidence),
  );
  app.post(
    '/api/staff/order-evidence/:id/request-changes',
    withStaffOrderEvidenceErrors(requestChanges),
  );
  app.post(
    '/api/staff/order-evidence/:id/approve',
    withStaffOrderEvidenceErrors(approve),
  );
}

async function listStaffOrderEvidence(
  context: Context<AppEnv>,
): Promise<Response> {
  const actor = requireStaffAuthorization(context);
  requirePermission(actor, 'ORDER_VIEW');
  const scope = requireStaffDataScope(context);
  const query = parseListQuery(context);
  const scopeFilter = scopeSql(scope);
  const cursorFilter = query.cursor
    ? `AND (submission.submitted_at>? OR
      (submission.submitted_at=? AND submission.id>?))`
    : '';
  const statusFilter = query.status
    ? 'AND submission.status=?'
    : `AND submission.status IN (
      'PENDING_VERIFICATION','CHANGES_REQUESTED','VERIFIED'
    )`;
  const rows = await context.env.DB.prepare(`
    SELECT submission.id AS submission_id,
      submission.reservation_id,
      submission.buyer_customer_id,
      buyer.buyer_customer_no,
      submission.marketplace_code,
      submission.status,
      submission.version,
      submission.current_version_no,
      evidence.order_instruction_id AS instruction_id,
      evidence.order_instruction_version_id AS instruction_version_id,
      evidence.amazon_order_number_raw,
      evidence.amazon_order_number_normalized,
      evidence.reference_order_amount_jpy_snapshot
        AS reference_order_amount_jpy,
      evidence.final_paid_jpy,
      evidence.price_difference_jpy,
      evidence.price_mismatch,
      submission.resubmission_deadline_at,
      file.id AS screenshot_file_object_id,
      file.version AS screenshot_file_version,
      file.purpose AS screenshot_purpose,
      file.visibility AS screenshot_visibility,
      work.id AS work_item_id,
      work.assigned_staff_id,
      work.fixed_assignment_id,
      submission.submitted_at,
      submission.updated_at
    FROM order_evidence_submissions submission
    JOIN order_evidence_versions evidence
      ON evidence.submission_id=submission.id
      AND evidence.version_no=submission.current_version_no
    JOIN product_reservations reservation
      ON reservation.id=submission.reservation_id
    JOIN buyer_customers buyer ON buyer.id=submission.buyer_customer_id
    JOIN file_objects file ON file.id=evidence.evidence_file_object_id
    LEFT JOIN staff_work_items work
      ON work.work_type='ORDER_EVIDENCE_REVIEW'
      AND work.source_entity_type='ORDER_EVIDENCE'
      AND work.source_entity_id=submission.id
      AND work.status='OPEN'
    WHERE ${scopeFilter.sql}
      ${statusFilter}
      ${cursorFilter}
    ORDER BY submission.submitted_at, submission.id
    LIMIT ?
  `).bind(
    ...scopeFilter.args,
    ...(query.status ? [query.status] : []),
    ...(query.cursor
      ? [query.cursor.submittedAt, query.cursor.submittedAt, query.cursor.id]
      : []),
    query.limit + 1,
  ).all<{
    submission_id: string;
    reservation_id: string;
    buyer_customer_id: string;
    buyer_customer_no: string | null;
    marketplace_code: 'JP';
    status: StaffOrderEvidenceListItem['status'];
    version: number;
    current_version_no: number;
    instruction_id: string;
    instruction_version_id: string;
    amazon_order_number_raw: string;
    amazon_order_number_normalized: string;
    reference_order_amount_jpy: number;
    final_paid_jpy: number;
    price_difference_jpy: number;
    price_mismatch: number;
    resubmission_deadline_at: number | null;
    screenshot_file_object_id: string;
    screenshot_file_version: number;
    screenshot_purpose: 'ORDER_EVIDENCE';
    screenshot_visibility: 'BUYER_VISIBLE';
    work_item_id: string | null;
    assigned_staff_id: string | null;
    fixed_assignment_id: string | null;
    submitted_at: number;
    updated_at: number;
  }>();
  const hasMore = rows.results.length > query.limit;
  const visible = rows.results.slice(0, query.limit);
  const items: StaffOrderEvidenceListItem[] = visible.map((row) => ({
    submission_id: row.submission_id,
    buyer_customer_id: row.buyer_customer_id,
    reservation_id: row.reservation_id,
    instruction_id: row.instruction_id,
    instruction_version_id: row.instruction_version_id,
    marketplace: row.marketplace_code,
    amazon_order_number_raw: row.amazon_order_number_raw,
    amazon_order_number_normalized: row.amazon_order_number_normalized,
    status: row.status,
    version: Number(row.version),
    current_evidence_version_no: Number(row.current_version_no),
    reference_order_amount_jpy: String(row.reference_order_amount_jpy),
    final_paid_jpy: String(row.final_paid_jpy),
    price_difference_jpy: String(row.price_difference_jpy),
    price_mismatch: Number(row.price_mismatch) === 1,
    resubmission_deadline_at: row.resubmission_deadline_at === null
      ? null
      : Number(row.resubmission_deadline_at),
    submitted_at: Number(row.submitted_at),
    updated_at: Number(row.updated_at),
    buyer: {
      buyer_customer_id: row.buyer_customer_id,
      buyer_customer_no: row.buyer_customer_no,
    },
    screenshot: {
      file_object_id: row.screenshot_file_object_id,
      file_version: Number(row.screenshot_file_version),
      purpose: row.screenshot_purpose,
      visibility: row.screenshot_visibility,
    },
    workflow: {
      work_item_id: row.work_item_id,
      assigned_staff_id: row.assigned_staff_id,
      assigned_team_id: null,
      fixed_assignment_id: row.fixed_assignment_id,
    },
  }));
  const last = visible.at(-1);
  return success(context, {
    items,
    next_cursor: hasMore && last
      ? encodeCursor(Number(last.submitted_at), last.submission_id)
      : null,
  });
}

async function getStaffOrderEvidence(
  context: Context<AppEnv>,
): Promise<Response> {
  const actor = requireStaffAuthorization(context);
  requirePermission(actor, 'ORDER_VIEW');
  const detail = await readDetail(
    context,
    requireRouteIdentifier(context),
    requireStaffDataScope(context),
  );
  return success(context, { order_evidence: detail });
}

async function requestChanges(context: Context<AppEnv>): Promise<Response> {
  const actor = requireStaffAuthorization(context);
  requirePermission(actor, 'ORDER_CONFIRM');
  const submissionId = requireRouteIdentifier(context);
  await assertScopeVisibility(
    context,
    submissionId,
    requireStaffDataScope(context),
  );
  const body = await readExactJson(context, new Set([
    'expected_version',
    'public_reason',
    'internal_note',
  ]), new Set(['expected_version', 'public_reason']));
  const result = await requestOrderEvidenceChanges(
    context.env.DB,
    {
      submissionId,
      expectedVersion: positiveVersion(body['expected_version']),
      publicReason: requiredText(body['public_reason'], 2000),
      internalNote: optionalText(body['internal_note'], 4000),
    },
    {
      actor: toOrderEvidenceActor(actor),
      idempotencyKey: requireIdempotencyKey(context),
      requestId: requestId(context),
    },
  );
  return success(context, result);
}

async function approve(context: Context<AppEnv>): Promise<Response> {
  const actor = requireStaffAuthorization(context);
  requirePermission(actor, 'ORDER_CONFIRM');
  const submissionId = requireRouteIdentifier(context);
  await assertScopeVisibility(
    context,
    submissionId,
    requireStaffDataScope(context),
  );
  const body = await readExactJson(context, new Set([
    'expected_version',
    'internal_note',
    'price_mismatch_acknowledged',
    'price_mismatch_reason',
  ]), new Set(['expected_version']));
  const acknowledged = Object.hasOwn(body, 'price_mismatch_acknowledged')
    ? booleanValue(body['price_mismatch_acknowledged'])
    : undefined;
  const result = await approveOrderEvidenceAtomically(
    context.env.DB,
    {
      submissionId,
      expectedVersion: positiveVersion(body['expected_version']),
      internalNote: optionalText(body['internal_note'], 4000),
      ...(acknowledged === undefined
        ? {}
        : { priceMismatchAcknowledged: acknowledged }),
      priceMismatchReason: optionalText(body['price_mismatch_reason'], 2000),
    },
    {
      actor: toFormalOrderActor(actor),
      idempotencyKey: requireIdempotencyKey(context),
      requestId: requestId(context),
    },
  );
  return success(context, result.approval);
}

async function readDetail(
  context: Context<AppEnv>,
  submissionId: string,
  scope: StaffDataScope,
): Promise<StaffOrderEvidenceDetailDto> {
  const filter = scopeSql(scope);
  const row = await context.env.DB.prepare(`
    SELECT submission.id AS submission_id,
      submission.reservation_id,
      submission.buyer_customer_id,
      buyer.buyer_customer_no,
      submission.marketplace_code,
      submission.status,
      submission.version AS aggregate_version,
      submission.current_version_no,
      evidence.id AS evidence_version_id,
      evidence.amazon_order_number_raw,
      evidence.amazon_order_number_normalized,
      evidence.final_paid_jpy,
      evidence.buyer_note,
      submission.public_change_reason,
      submission.internal_review_note,
      submission.submitted_at,
      submission.updated_at,
      submission.verified_at,
      submission.withdrawn_at,
      submission.verified_by_staff_id,
      evidence.reference_order_amount_jpy_snapshot
        AS reference_order_amount_jpy,
      evidence.price_difference_jpy,
      evidence.price_mismatch,
      evidence.order_instruction_id AS instruction_id,
      evidence.order_instruction_version_id AS instruction_version_id,
      evidence.buyer_self_pay_bps_snapshot AS buyer_self_pay_bps,
      evidence.buyer_self_pay_jpy,
      evidence.buyer_refundable_principal_jpy,
      reservation.status AS reservation_status,
      reservation.version AS reservation_version,
      file.id AS screenshot_file_object_id,
      file.version AS screenshot_file_version,
      file.purpose AS screenshot_purpose,
      file.visibility AS screenshot_visibility,
      file.status AS screenshot_file_status,
      intent.status AS screenshot_intent_status,
      intent.owner_actor_type AS screenshot_owner_actor_type,
      intent.owner_actor_id AS screenshot_owner_actor_id,
      (SELECT COUNT(*) FROM order_evidence_version_files version_file
        WHERE version_file.version_id=evidence.id)
        AS screenshot_association_count,
      (SELECT MAX(version_file.file_object_id)
        FROM order_evidence_version_files version_file
        WHERE version_file.version_id=evidence.id)
        AS associated_file_object_id,
      (SELECT COUNT(*)
        FROM order_evidence_version_files version_file
        JOIN file_objects associated_file
          ON associated_file.id=version_file.file_object_id
        JOIN file_upload_intents associated_intent
          ON associated_intent.id=associated_file.upload_intent_id
        JOIN file_entity_links link
          ON link.id=version_file.file_entity_link_id
        WHERE version_file.version_id=evidence.id
          AND version_file.submission_id=submission.id
          AND version_file.reservation_id=submission.reservation_id
          AND version_file.buyer_customer_id=submission.buyer_customer_id
          AND version_file.visibility='BUYER_VISIBLE'
          AND associated_file.id=evidence.evidence_file_object_id
          AND associated_file.status='VERIFIED'
          AND associated_file.purpose='ORDER_EVIDENCE'
          AND associated_file.visibility='BUYER_VISIBLE'
          AND associated_intent.status='VERIFIED'
          AND associated_intent.owner_actor_type='BUYER_CUSTOMER'
          AND associated_intent.owner_actor_id=submission.buyer_customer_id
          AND associated_intent.purpose='ORDER_EVIDENCE'
          AND associated_intent.visibility='BUYER_VISIBLE'
          AND link.file_object_id=associated_file.id
          AND link.entity_type='ORDER'
          AND link.entity_id=evidence.id
          AND link.purpose='ORDER_EVIDENCE'
          AND link.visibility='BUYER_VISIBLE'
          AND link.revoked_at IS NULL
          AND (link.expires_at IS NULL OR link.expires_at>?))
        AS eligible_screenshot_association_count,
      (SELECT COUNT(*) FROM formal_order_number_conflicts conflict
        WHERE conflict.marketplace_code=submission.marketplace_code
          AND conflict.amazon_order_number_normalized=
            evidence.amazon_order_number_normalized
          AND conflict.status='OPEN') AS duplicate_signal_count,
      (SELECT work.id FROM staff_work_items work
        WHERE work.work_type='ORDER_EVIDENCE_REVIEW'
          AND work.source_entity_type='ORDER_EVIDENCE'
          AND work.source_entity_id=submission.id
        ORDER BY work.created_at DESC, work.id DESC LIMIT 1) AS work_item_id,
      (SELECT work.assigned_staff_id FROM staff_work_items work
        WHERE work.work_type='ORDER_EVIDENCE_REVIEW'
          AND work.source_entity_type='ORDER_EVIDENCE'
          AND work.source_entity_id=submission.id
        ORDER BY work.created_at DESC, work.id DESC LIMIT 1)
        AS assigned_staff_id,
      (SELECT work.fixed_assignment_id FROM staff_work_items work
        WHERE work.work_type='ORDER_EVIDENCE_REVIEW'
          AND work.source_entity_type='ORDER_EVIDENCE'
          AND work.source_entity_id=submission.id
        ORDER BY work.created_at DESC, work.id DESC LIMIT 1)
        AS fixed_assignment_id
    FROM order_evidence_submissions submission
    JOIN order_evidence_versions evidence
      ON evidence.submission_id=submission.id
      AND evidence.version_no=submission.current_version_no
    JOIN product_reservations reservation
      ON reservation.id=submission.reservation_id
    JOIN buyer_customers buyer ON buyer.id=submission.buyer_customer_id
    JOIN file_objects file ON file.id=evidence.evidence_file_object_id
    JOIN file_upload_intents intent ON intent.id=file.upload_intent_id
    WHERE submission.id=? AND ${filter.sql}
    LIMIT 1
  `).bind(Date.now(), submissionId, ...filter.args).first<OrderEvidenceDetailRow>();
  if (!row) throw new StaffOrderEvidenceHttpError('NOT_FOUND', 404);
  if (Number(row.screenshot_association_count) !== 1
    || Number(row.eligible_screenshot_association_count) !== 1
    || row.associated_file_object_id !== row.screenshot_file_object_id
    || row.screenshot_file_status !== 'VERIFIED'
    || row.screenshot_intent_status !== 'VERIFIED'
    || row.screenshot_owner_actor_type !== 'BUYER_CUSTOMER'
    || row.screenshot_owner_actor_id !== row.buyer_customer_id) {
    throw new StaffOrderEvidenceHttpError('STATE_CONFLICT', 409);
  }
  if (row.screenshot_purpose !== 'ORDER_EVIDENCE'
    || row.screenshot_visibility !== 'BUYER_VISIBLE'
    || Number(row.screenshot_file_version) < 1
    || Number(row.reference_order_amount_jpy) < 0
    || Number(row.final_paid_jpy) < 0
    || Number(row.price_difference_jpy)
      !== Number(row.final_paid_jpy) - Number(row.reference_order_amount_jpy)) {
    throw new StaffOrderEvidenceHttpError('DEPENDENCY_UNAVAILABLE', 503);
  }
  const history = await context.env.DB.prepare(`
    SELECT id AS evidence_version_id, version_no, final_paid_jpy,
      created_at AS submitted_at
    FROM order_evidence_versions
    WHERE submission_id=?
    ORDER BY version_no, id
  `).bind(submissionId).all<{
    evidence_version_id: string;
    version_no: number;
    final_paid_jpy: number;
    submitted_at: number;
  }>();
  return {
    submission_id: row.submission_id,
    reservation_id: row.reservation_id,
    marketplace: row.marketplace_code,
    status: row.status,
    version: Number(row.aggregate_version),
    evidence_version_no: Number(row.current_version_no),
    amazon_order_number_raw: row.amazon_order_number_raw,
    amazon_order_number_normalized: row.amazon_order_number_normalized,
    final_paid_jpy: String(row.final_paid_jpy),
    buyer_note: row.buyer_note,
    public_change_reason: row.public_change_reason,
    submitted_at: Number(row.submitted_at),
    updated_at: Number(row.updated_at),
    verified_at: row.verified_at === null ? null : Number(row.verified_at),
    withdrawn_at: row.withdrawn_at === null ? null : Number(row.withdrawn_at),
    buyer_customer_id: row.buyer_customer_id,
    internal_review_note: row.internal_review_note,
    verified_by_staff_id: row.verified_by_staff_id,
    duplicate_signal_count: Number(row.duplicate_signal_count),
    reference_order_amount_jpy: String(row.reference_order_amount_jpy),
    price_difference_jpy: String(row.price_difference_jpy),
    price_mismatch: Number(row.price_mismatch) === 1,
    screenshot: {
      file_object_id: row.screenshot_file_object_id,
      file_version: Number(row.screenshot_file_version),
      purpose: 'ORDER_EVIDENCE',
      visibility: 'BUYER_VISIBLE',
    },
    instruction: {
      instruction_id: row.instruction_id,
      instruction_version_id: row.instruction_version_id,
      buyer_self_pay_bps: Number(row.buyer_self_pay_bps),
      buyer_self_pay_jpy: String(row.buyer_self_pay_jpy),
      buyer_refundable_principal_jpy:
        String(row.buyer_refundable_principal_jpy),
    },
    reservation: {
      reservation_id: row.reservation_id,
      status: row.reservation_status,
      version: Number(row.reservation_version),
    },
    version_history: history.results.map((version) => ({
      evidence_version_id: version.evidence_version_id,
      version_no: Number(version.version_no),
      final_paid_jpy: String(version.final_paid_jpy),
      submitted_at: Number(version.submitted_at),
    })),
    workflow: {
      work_item_id: row.work_item_id,
      assigned_staff_id: row.assigned_staff_id,
      assigned_team_id: null,
      fixed_assignment_id: row.fixed_assignment_id,
    },
    buyer: {
      buyer_customer_id: row.buyer_customer_id,
      buyer_customer_no: row.buyer_customer_no,
    },
  };
}

async function assertScopeVisibility(
  context: Context<AppEnv>,
  submissionId: string,
  scope: StaffDataScope,
): Promise<void> {
  const filter = scopeSql(scope);
  const row = await context.env.DB.prepare(`
    SELECT 1 AS visible
    FROM order_evidence_submissions submission
    JOIN product_reservations reservation
      ON reservation.id=submission.reservation_id
    WHERE submission.id=? AND ${filter.sql}
    LIMIT 1
  `).bind(submissionId, ...filter.args).first<{ visible: number }>();
  if (!row) throw new StaffOrderEvidenceHttpError('NOT_FOUND', 404);
}

function scopeSql(scope: StaffDataScope): {
  sql: string;
  args: readonly string[];
} {
  if (scope.type === 'GLOBAL') return { sql: '1=1', args: [] };
  const clauses: string[] = [];
  const args: string[] = [];
  if (scope.buyerCustomerIds.length > 0) {
    clauses.push(
      `submission.buyer_customer_id IN (${placeholders(scope.buyerCustomerIds)})`,
    );
    args.push(...scope.buyerCustomerIds);
  }
  if (scope.sellerOrganizationIds.length > 0) {
    clauses.push(
      `reservation.organization_id IN (${placeholders(scope.sellerOrganizationIds)})`,
    );
    args.push(...scope.sellerOrganizationIds);
  }
  return clauses.length > 0
    ? { sql: `(${clauses.join(' OR ')})`, args }
    : { sql: '0=1', args: [] };
}

function parseListQuery(context: Context<AppEnv>): {
  limit: number;
  status?: typeof STAFF_ORDER_EVIDENCE_LIST_STATUSES[number];
  cursor?: { submittedAt: number; id: string };
} {
  const parameters = new URL(context.req.url).searchParams;
  const allowed = new Set(['limit', 'status', 'cursor']);
  for (const key of parameters.keys()) {
    if (!allowed.has(key) || parameters.getAll(key).length !== 1) {
      throw new StaffOrderEvidenceHttpError('VALIDATION_ERROR', 400);
    }
  }
  const limitRaw = parameters.get('limit');
  const limit = limitRaw === null
    ? DEFAULT_LIMIT
    : parseCanonicalLimit(limitRaw);
  const statusRaw = parameters.get('status');
  const status = statusRaw === null
    ? undefined
    : STAFF_ORDER_EVIDENCE_LIST_STATUSES.includes(
        statusRaw as typeof STAFF_ORDER_EVIDENCE_LIST_STATUSES[number],
      )
      ? statusRaw as typeof STAFF_ORDER_EVIDENCE_LIST_STATUSES[number]
      : validationError();
  const cursorRaw = parameters.get('cursor');
  return {
    limit,
    ...(status === undefined ? {} : { status }),
    ...(cursorRaw === null ? {} : { cursor: decodeCursor(cursorRaw) }),
  };
}

function encodeCursor(submittedAt: number, id: string): string {
  const json = JSON.stringify({ v: 1, submitted_at: submittedAt, id });
  return encodeBase64Url(new TextEncoder().encode(json));
}

function decodeCursor(raw: string): { submittedAt: number; id: string } {
  if (raw.length < 1 || raw.length > CURSOR_MAX_LENGTH
    || !/^[A-Za-z0-9_-]+$/u.test(raw)) {
    return validationError();
  }
  try {
    const value = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(raw)),
    ) as Record<string, unknown>;
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'id,submitted_at,v'
      || value['v'] !== 1
      || !Number.isSafeInteger(value['submitted_at'])
      || Number(value['submitted_at']) < 0) {
      return validationError();
    }
    return {
      submittedAt: Number(value['submitted_at']),
      id: requiredText(value['id'], 120),
    };
  } catch {
    return validationError();
  }
}

async function readExactJson(
  context: Context<AppEnv>,
  allowedKeys: ReadonlySet<string>,
  requiredKeys: ReadonlySet<string>,
): Promise<Record<string, unknown>> {
  const contentType = context.req.header('Content-Type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    return validationError();
  }
  const length = context.req.header('Content-Length');
  if (length && (!/^\d+$/u.test(length) || Number(length) > BODY_LIMIT_BYTES)) {
    return validationError();
  }
  const text = await context.req.text();
  if (new TextEncoder().encode(text).byteLength > BODY_LIMIT_BYTES) {
    return validationError();
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return validationError();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return validationError();
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) return validationError();
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(record, key)) return validationError();
  }
  return record;
}

function requireStaffAuthorization(
  context: Context<AppEnv>,
): AssignmentStaffAuthorization {
  const value = context.get('staffAuthorization') as
    | AssignmentStaffAuthorization
    | undefined;
  if (!value) throw new StaffOrderEvidenceHttpError('UNAUTHENTICATED', 401);
  return value;
}

function requireStaffDataScope(context: Context<AppEnv>): StaffDataScope {
  const value = context.get('staffDataScope') as StaffDataScope | undefined;
  if (!value) throw new StaffOrderEvidenceHttpError('UNAUTHENTICATED', 401);
  return value;
}

function requirePermission(
  actor: AssignmentStaffAuthorization,
  permission: 'ORDER_VIEW' | 'ORDER_CONFIRM',
): void {
  if (!actor.permissions.has(permission)) {
    throw new StaffOrderEvidenceHttpError('FORBIDDEN', 403);
  }
}

function toOrderEvidenceActor(actor: AssignmentStaffAuthorization) {
  return {
    staffId: actor.staffId,
    displayName: actor.displayName,
    roles: [...actor.roles],
    permissions: actor.permissions,
  } as const;
}

function toFormalOrderActor(actor: AssignmentStaffAuthorization) {
  return toOrderEvidenceActor(actor);
}

function withStaffOrderEvidenceErrors(
  handler: (context: Context<AppEnv>) => Promise<Response>,
) {
  return async (context: Context<AppEnv>): Promise<Response> => {
    try {
      return await handler(context);
    } catch (error) {
      const normalized = normalizeHttpError(error);
      context.header('Cache-Control', 'no-store');
      return context.json(
        apiFailure(
          normalized.code,
          normalized.code,
          requestId(context),
        ),
        normalized.status,
      );
    }
  };
}

class StaffOrderEvidenceHttpError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: 400 | 401 | 403 | 404 | 409 | 503,
  ) {
    super(code);
  }
}

function normalizeHttpError(error: unknown): StaffOrderEvidenceHttpError {
  if (error instanceof StaffOrderEvidenceHttpError) return error;
  if (error instanceof AtomicOrderEvidenceApprovalError) {
    return new StaffOrderEvidenceHttpError(error.code, error.status);
  }
  const record = error as { code?: unknown; status?: unknown };
  const code = typeof record?.code === 'string' ? record.code : '';
  if (code === 'VALIDATION_ERROR') return new StaffOrderEvidenceHttpError(code, 400);
  if (code === 'FORBIDDEN') return new StaffOrderEvidenceHttpError(code, 403);
  if (code === 'VERSION_CONFLICT') return new StaffOrderEvidenceHttpError(code, 409);
  if (code === 'IDEMPOTENCY_CONFLICT') return new StaffOrderEvidenceHttpError(code, 409);
  if (code === 'REQUEST_IN_PROGRESS') return new StaffOrderEvidenceHttpError(code, 409);
  if (code === 'ORDER_EVIDENCE_NOT_FOUND') {
    return new StaffOrderEvidenceHttpError('NOT_FOUND', 404);
  }
  if (code === 'ORDER_EVIDENCE_STATE_CONFLICT'
    || code === 'ORDER_EVIDENCE_FILE_CONFLICT'
    || code === 'ORDER_NUMBER_ALREADY_CLAIMED'
    || code === 'ORDER_NUMBER_CONFLICT_REQUIRES_REVIEW'
    || code === 'FORMAL_ORDER_ALREADY_EXISTS'
    || code === 'FORMAL_ORDER_STATE_CONFLICT') {
    return new StaffOrderEvidenceHttpError('STATE_CONFLICT', 409);
  }
  return new StaffOrderEvidenceHttpError('DEPENDENCY_UNAVAILABLE', 503);
}

function parseCanonicalLimit(raw: string): number {
  if (!/^(?:[1-9]|[1-9]\d|100)$/u.test(raw)) return validationError();
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIMIT) {
    return validationError();
  }
  return value;
}

function positiveVersion(value: unknown): number {
  if (typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 1) {
    return validationError();
  }
  return value;
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== 'boolean') return validationError();
  return value;
}

function optionalText(value: unknown, maximum: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return validationError();
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    return validationError();
  }
  return normalized;
}

function requiredText(value: unknown, maximum: number): string {
  const normalized = optionalText(value, maximum);
  if (normalized === null) return validationError();
  return normalized;
}

function requireRouteIdentifier(context: Context<AppEnv>): string {
  return requiredText(context.req.param('id'), 120);
}

function requireIdempotencyKey(context: Context<AppEnv>): string {
  const value = context.req.header('Idempotency-Key')?.trim() ?? '';
  if (value.length < 8 || value.length > 128
    || value.includes(',')
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    return validationError();
  }
  return value;
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function requestId(context: Context<AppEnv>): string {
  return String(context.get('requestId') ?? crypto.randomUUID());
}

function validationError(): never {
  throw new StaffOrderEvidenceHttpError('VALIDATION_ERROR', 400);
}

function success<T>(context: Context<AppEnv>, data: T): Response {
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(data, requestId(context)));
}
