import {
  apiFailure,
  apiSuccess,
  FORMAL_ORDER_OPERATIONAL_EVENT_TYPES,
  REVIEW_VISIBILITY_STATUSES,
  type FileActor,
  type ReviewVisibilityStatus,
  type FormalOrderOperationalEventType,
  type SqlDatabase,
  type SqlStatement,
} from '@ygb/contracts';
import { chinaBusinessDate, hashCanonicalJson } from '@ygb/domain';
import type { Context, Hono } from 'hono';
import type { AppEnv } from '../app';
import { createAuditEventStatement } from '../foundation/audit';
import {
  acquireIdempotency,
  assertIdempotencyCompletionStatement,
  completeIdempotencyStatement,
  markIdempotencyFailed,
  type IdempotencyClaim,
} from '../foundation/idempotency';
import { FormalOrderPolicyError, requireFormalOrderAction } from '../formal-order-policy';
import type { FileAuthorizationResource, FileAuthorizationService } from '../files/authorization';
import { createExplicitAudienceFileLinkStatements } from '../files/explicit-audience-links';
import { requestIdFromContext } from '../http-auth/errors';
import { customerAuthOriginGuard } from '../middleware/origin-guard';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';
import {
  assertBuyerRefundProofFilesUnused,
  listBuyerRefundProofFiles,
  type BuyerRefundProofFileRow,
} from '../buyer-refunds/buyer-refund-records';

class IntegrityError extends Error {
  constructor(
    public code:
      | 'VALIDATION_ERROR'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'IDEMPOTENCY_CONFLICT'
      | 'REQUEST_IN_PROGRESS'
      | 'DEPENDENCY_UNAVAILABLE',
    public status: 400 | 403 | 404 | 409 | 503,
  ) {
    super(code);
  }
}
type ProofInput = { fileObjectId: string; expectedFileVersion: number };

export function registerOperatingIntegrityRoutes(app: Hono<AppEnv>): void {
  app.get('/api/staff/order-integrity/:id', wrap(readOrderIntegrity));
  app.post(
    '/api/staff/order-integrity/:id/events',
    customerAuthOriginGuard(),
    wrap(recordOrderEvent),
  );
  app.post(
    '/api/staff/order-integrity/:id/financial-adjustments',
    customerAuthOriginGuard(),
    wrap(recordFinancialAdjustment),
  );
  app.get('/api/staff/reviews/:id/visibility', wrap(readReviewVisibility));
  app.post(
    '/api/staff/reviews/:id/visibility',
    customerAuthOriginGuard(),
    wrap(recordReviewVisibility),
  );
  app.get('/api/staff/buyer-advance-principal/:formalOrderId', wrap(readAdvancePrincipal));
  app.post(
    '/api/staff/buyer-advance-principal/:formalOrderId/payments',
    customerAuthOriginGuard(),
    wrap(recordAdvancePayment),
  );
  app.post(
    '/api/staff/buyer-advance-principal/:formalOrderId/payments/:paymentId/reversals',
    customerAuthOriginGuard(),
    wrap(reverseAdvancePayment),
  );
}

async function readOrderIntegrity(context: Context<AppEnv>) {
  const actor = staff(context);
  const order = await orderRow(context.env.DB, id(context.req.param('id') ?? ''));
  await market(context.env.DB, actor, order.market);
  const canViewFinancialAdjustments = canViewOrderFinancialAdjustments(actor);
  const [events, adjustments, state] = await Promise.all([
    context.env.DB.prepare(
      `SELECT id AS event_id,formal_order_id,event_type,reason,actor_staff_id,created_at FROM formal_order_operational_events WHERE formal_order_id=? ORDER BY created_at,id`,
    )
      .bind(order.id)
      .all<any>(),
    canViewFinancialAdjustments
      ? context.env.DB.prepare(
          `SELECT id AS adjustment_id,formal_order_id,source_operational_event_id,adjustment_scope,CAST(amount_cny_fen AS TEXT) AS amount_cny_fen,reason,actor_staff_id,created_at FROM formal_order_financial_adjustments WHERE formal_order_id=? ORDER BY created_at,id`,
        )
          .bind(order.id)
          .all<any>()
      : Promise.resolve({ results: [] }),
    context.env.DB.prepare(
      `SELECT operational_state FROM formal_order_effective_operational_state WHERE formal_order_id=?`,
    )
      .bind(order.id)
      .first<{ operational_state: string }>(),
  ]);
  return ok(context, {
    order_integrity: {
      formal_order_id: order.id,
      canonical_marketplace_code: order.market,
      operational_state: state?.operational_state ?? 'NORMAL',
      events: events.results,
      adjustments: adjustments.results,
    },
  });
}

export function canViewOrderFinancialAdjustments(
  actor: Pick<AssignmentStaffAuthorization, 'roles' | 'permissions'>,
): boolean {
  return actor.roles.has('owner') && actor.permissions.has('FINANCIAL_VIEW');
}

async function recordOrderEvent(context: Context<AppEnv>) {
  const actor = staff(context);
  if (!actor.roles.has('owner') && !actor.roles.has('seller_ops')) forbidden();
  const order = await orderRow(context.env.DB, id(context.req.param('id') ?? ''));
  await market(context.env.DB, actor, order.market);
  const body = await json(context, ['event_type', 'reason']);
  const type = body['event_type'];
  if (
    typeof type !== 'string' ||
    !FORMAL_ORDER_OPERATIONAL_EVENT_TYPES.includes(type as FormalOrderOperationalEventType)
  )
    validation();
  const reason = text(body['reason'], 3, 2000);
  const now = Date.now();
  const acquired = await command(
    context,
    actor,
    'RECORD_FORMAL_ORDER_OPERATIONAL_EVENT',
    'FORMAL_ORDER',
    order.id,
    { event_type: type, reason },
    now,
  );
  if (acquired.kind === 'REPLAY') return ok(context, acquired.response, 201);
  const eventId = crypto.randomUUID();
  const response = {
    event: {
      event_id: eventId,
      formal_order_id: order.id,
      event_type: type,
      reason,
      actor_staff_id: actor.staffId,
      created_at: now,
    },
  };
  await commit(
    context,
    acquired.claim,
    'ORDER_EVENT_FAILED',
    [
      context.env.DB.prepare(
        `INSERT INTO formal_order_operational_events(id,formal_order_id,event_type,reason,actor_staff_id,created_at) VALUES(?,?,?,?,?,?)`,
      ).bind(eventId, order.id, type, reason, actor.staffId, now),
      createAuditEventStatement(context.env.DB, {
        id: crypto.randomUUID(),
        aggregateType: 'FORMAL_ORDER',
        aggregateId: order.id,
        eventType: `FORMAL_ORDER_${type}`,
        actor: { type: 'STAFF', id: actor.staffId, roles: [...actor.roles] },
        requestId: requestIdFromContext(context),
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: { operational_event_id: eventId, event_type: type, reason },
        createdAt: now,
      }),
      completeIdempotencyStatement(context.env.DB, acquired.claim, response, {
        resultReferences: { event_id: eventId },
        now,
      }),
      assertIdempotencyCompletionStatement(context.env.DB, acquired.claim),
    ],
    now,
  );
  return ok(context, response, 201);
}

async function recordFinancialAdjustment(context: Context<AppEnv>) {
  const actor = staff(context);
  if (!actor.roles.has('owner') || !actor.permissions.has('FINANCIAL_CORRECT')) forbidden();
  const order = await orderRow(context.env.DB, id(context.req.param('id') ?? ''));
  const body = await json(context, [
    'adjustment_scope',
    'amount_cny_fen',
    'reason',
    'source_operational_event_id',
  ]);
  const scope = body['adjustment_scope'];
  if (scope !== 'PROJECTED_GROSS_PROFIT' && scope !== 'COMPLETED_GROSS_PROFIT') validation();
  const amount = signedMoney(body['amount_cny_fen']);
  const reason = text(body['reason'], 3, 2000);
  const source = body['source_operational_event_id'];
  if (!(source === null || typeof source === 'string')) validation();
  if (typeof source === 'string') {
    const found = await context.env.DB.prepare(
      `SELECT 1 AS present FROM formal_order_operational_events WHERE id=? AND formal_order_id=?`,
    )
      .bind(source, order.id)
      .first();
    if (!found) validation();
  }
  const now = Date.now();
  const acquired = await command(
    context,
    actor,
    'RECORD_FORMAL_ORDER_PROFIT_ADJUSTMENT',
    'FORMAL_ORDER',
    order.id,
    {
      adjustment_scope: scope,
      amount_cny_fen: amount,
      reason,
      source_operational_event_id: source,
    },
    now,
  );
  if (acquired.kind === 'REPLAY') return ok(context, acquired.response, 201);
  const adjustmentId = crypto.randomUUID();
  const response = {
    adjustment: {
      adjustment_id: adjustmentId,
      formal_order_id: order.id,
      source_operational_event_id: source,
      adjustment_scope: scope,
      amount_cny_fen: String(amount),
      reason,
      actor_staff_id: actor.staffId,
      created_at: now,
    },
  };
  await commit(
    context,
    acquired.claim,
    'PROFIT_ADJUSTMENT_FAILED',
    [
      context.env.DB.prepare(
        `INSERT INTO formal_order_financial_adjustments(id,formal_order_id,source_operational_event_id,adjustment_scope,amount_cny_fen,reason,actor_staff_id,created_at) VALUES(?,?,?,?,?,?,?,?)`,
      ).bind(adjustmentId, order.id, source, scope, amount, reason, actor.staffId, now),
      createAuditEventStatement(context.env.DB, {
        id: crypto.randomUUID(),
        aggregateType: 'FORMAL_ORDER_FINANCIAL_ADJUSTMENT',
        aggregateId: adjustmentId,
        eventType: 'FORMAL_ORDER_FINANCIAL_ADJUSTMENT_RECORDED',
        actor: { type: 'STAFF', id: actor.staffId, roles: [...actor.roles] },
        requestId: requestIdFromContext(context),
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: {
          formal_order_id: order.id,
          adjustment_scope: scope,
          amount_cny_fen: String(amount),
          reason,
          source_operational_event_id: source,
        },
        createdAt: now,
      }),
      completeIdempotencyStatement(context.env.DB, acquired.claim, response, {
        resultReferences: { adjustment_id: adjustmentId },
        now,
      }),
      assertIdempotencyCompletionStatement(context.env.DB, acquired.claim),
    ],
    now,
  );
  return ok(context, response, 201);
}

async function readReviewVisibility(context: Context<AppEnv>) {
  const actor = staff(context);
  const review = await reviewRow(context.env.DB, id(context.req.param('id') ?? ''));
  await market(context.env.DB, actor, review.market);
  const rows = await context.env.DB.prepare(
    `SELECT id AS observation_id,review_case_id,formal_order_id,visibility_status,note,observed_at,actor_staff_id,created_at FROM review_visibility_observations WHERE review_case_id=? ORDER BY observed_at,id`,
  )
    .bind(review.id)
    .all<any>();
  return ok(context, { observations: rows.results });
}

async function recordReviewVisibility(context: Context<AppEnv>) {
  const actor = staff(context);
  if (!actor.roles.has('owner') && !actor.roles.has('pre_sales')) forbidden();
  const review = await reviewRow(context.env.DB, id(context.req.param('id') ?? ''));
  await market(context.env.DB, actor, review.market);
  const body = await json(context, ['visibility_status', 'note', 'observed_at']);
  const status = body['visibility_status'];
  if (
    typeof status !== 'string' ||
    !REVIEW_VISIBILITY_STATUSES.includes(status as ReviewVisibilityStatus)
  )
    validation();
  const note = optionalText(body['note'], 2000);
  const observed = timestamp(body['observed_at']);
  const now = Date.now();
  const acquired = await command(
    context,
    actor,
    'RECORD_REVIEW_VISIBILITY',
    'REVIEW_CASE',
    review.id,
    { visibility_status: status, note, observed_at: observed },
    now,
  );
  if (acquired.kind === 'REPLAY') return ok(context, acquired.response, 201);
  const observationId = crypto.randomUUID();
  const response = {
    observation: {
      observation_id: observationId,
      review_case_id: review.id,
      formal_order_id: review.formalOrderId,
      visibility_status: status,
      note,
      observed_at: observed,
      actor_staff_id: actor.staffId,
      created_at: now,
    },
  };
  await commit(
    context,
    acquired.claim,
    'REVIEW_VISIBILITY_FAILED',
    [
      context.env.DB.prepare(
        `INSERT INTO review_visibility_observations(id,review_case_id,formal_order_id,visibility_status,note,observed_at,actor_staff_id,created_at) VALUES(?,?,?,?,?,?,?,?)`,
      ).bind(
        observationId,
        review.id,
        review.formalOrderId,
        status,
        note,
        observed,
        actor.staffId,
        now,
      ),
      createAuditEventStatement(context.env.DB, {
        id: crypto.randomUUID(),
        aggregateType: 'REVIEW_CASE',
        aggregateId: review.id,
        eventType: 'REVIEW_VISIBILITY_OBSERVED',
        actor: { type: 'STAFF', id: actor.staffId, roles: [...actor.roles] },
        requestId: requestIdFromContext(context),
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: { visibility_status: status, note, observed_at: observed },
        createdAt: now,
      }),
      completeIdempotencyStatement(context.env.DB, acquired.claim, response, {
        resultReferences: { observation_id: observationId },
        now,
      }),
      assertIdempotencyCompletionStatement(context.env.DB, acquired.claim),
    ],
    now,
  );
  return ok(context, response, 201);
}

async function readAdvancePrincipal(context: Context<AppEnv>) {
  const actor = staff(context);
  if (!actor.roles.has('owner') && !actor.roles.has('buyer_refund')) forbidden();
  const order = await orderRow(context.env.DB, id(context.req.param('formalOrderId') ?? ''));
  await market(context.env.DB, actor, order.market);
  const rows = await context.env.DB.prepare(
    `SELECT entry.id AS entry_id,entry.formal_order_id,entry.buyer_customer_id,entry.entry_type,entry.original_payment_entry_id,CAST(entry.amount_cny_fen AS TEXT) AS amount_cny_fen,entry.paid_at,entry.reversed_at,entry.china_business_date,entry.payment_channel,entry.note,entry.actor_staff_id,entry.created_at,
      (SELECT COUNT(*) FROM buyer_advance_principal_entry_files proof WHERE proof.advance_payment_entry_id=entry.id) AS proof_count
    FROM buyer_advance_principal_entries entry WHERE entry.formal_order_id=? ORDER BY entry.created_at,entry.id`,
  )
    .bind(order.id)
    .all<any>();
  return ok(context, { entries: rows.results });
}

async function recordAdvancePayment(context: Context<AppEnv>) {
  const actor = staff(context);
  if (!actor.roles.has('owner') && !actor.roles.has('buyer_refund')) forbidden();
  const order = await orderRow(context.env.DB, id(context.req.param('formalOrderId') ?? ''));
  await market(context.env.DB, actor, order.market);
  await requireAdvanceAction(context.env.DB, order.id);
  const obligation = await context.env.DB.prepare(
    `SELECT 1 AS present FROM buyer_refund_obligations WHERE formal_order_id=? LIMIT 1`,
  )
    .bind(order.id)
    .first();
  if (obligation) throw new IntegrityError('CONFLICT', 409);
  const body = await json(context, ['paid_at', 'payment_channel', 'note', 'proof_files']);
  const now = Date.now();
  const paid = cleanOperatingPaymentTimestamp(body['paid_at'], now);
  const channel = paymentChannel(body['payment_channel']);
  const note = optionalText(body['note'], 2000);
  const proofs = parseProofFiles(body['proof_files']);
  const amount = await authoritativeAdvanceAmount(context.env.DB, order.id);
  const outstanding = await context.env.DB.prepare(
    `SELECT 1 AS present FROM buyer_advance_principal_entries payment WHERE payment.formal_order_id=? AND payment.entry_type='PAYMENT' AND payment.amount_cny_fen>COALESCE((SELECT SUM(reversal.amount_cny_fen) FROM buyer_advance_principal_entries reversal WHERE reversal.entry_type='REVERSAL' AND reversal.original_payment_entry_id=payment.id),0) LIMIT 1`,
  )
    .bind(order.id)
    .first();
  if (outstanding) throw new IntegrityError('CONFLICT', 409);
  const acquired = await command(
    context,
    actor,
    'RECORD_BUYER_ADVANCE_PRINCIPAL',
    'FORMAL_ORDER',
    order.id,
    { amount_cny_fen: amount, paid_at: paid, payment_channel: channel, note, proof_files: proofs },
    now,
  );
  if (acquired.kind === 'REPLAY') return ok(context, acquired.response, 201);
  try {
    const rows = await listBuyerRefundProofFiles(
      context.env.DB,
      proofs.map((proof) => proof.fileObjectId),
    );
    validateProofRows(rows, proofs, actor.staffId);
    await assertBuyerRefundProofFilesUnused(
      context.env.DB,
      proofs.map((proof) => proof.fileObjectId),
    );
    const already = await context.env.DB.prepare(
      `SELECT 1 AS present FROM buyer_advance_principal_entry_files WHERE file_object_id IN (${proofs.map(() => '?').join(',')}) LIMIT 1`,
    )
      .bind(...proofs.map((proof) => proof.fileObjectId))
      .first();
    if (already) throw new IntegrityError('CONFLICT', 409);
    const entryId = crypto.randomUUID();
    const fileActor: FileActor = { type: 'STAFF', id: actor.staffId, roles: [...actor.roles] };
    const prepared: {
      fileObjectId: string;
      linkId: string;
      rowId: string;
      statements: readonly SqlStatement[];
    }[] = [];
    for (const proof of proofs) {
      const link = await createExplicitAudienceFileLinkStatements(
        context.env.DB,
        new AdvanceProofAuthorization(actor),
        {
          fileObjectId: proof.fileObjectId,
          expectedFileVersion: proof.expectedFileVersion,
          entityType: 'BUYER_REFUND',
          entityId: entryId,
          grants: [
            {
              subjectType: 'STAFF_INTERNAL',
              permissionCode: 'BUYER_REFUND_VIEW',
              scope: { type: 'GLOBAL' },
            },
          ],
        },
        {
          actor: fileActor,
          idempotencyKey: acquired.claim.idempotencyKey,
          requestId: requestIdFromContext(context),
          now,
        },
      );
      prepared.push({
        fileObjectId: proof.fileObjectId,
        linkId: link.result.linkId,
        rowId: crypto.randomUUID(),
        statements: link.statements,
      });
    }
    const response = {
      entry: {
        entry_id: entryId,
        formal_order_id: order.id,
        buyer_customer_id: order.buyerCustomerId,
        entry_type: 'PAYMENT' as const,
        original_payment_entry_id: null,
        amount_cny_fen: String(amount),
        paid_at: paid,
        reversed_at: null,
        china_business_date: chinaBusinessDate(paid),
        payment_channel: channel,
        note,
        actor_staff_id: actor.staffId,
        created_at: now,
      },
    };
    const statements: SqlStatement[] = [
      context.env.DB.prepare(
        `INSERT INTO buyer_advance_principal_entries(id,formal_order_id,buyer_customer_id,entry_type,original_payment_entry_id,amount_cny_fen,paid_at,reversed_at,china_business_date,payment_channel,note,actor_staff_id,created_at) VALUES(?,?,?,'PAYMENT',NULL,?,?,NULL,?,?,?,?,?)`,
      ).bind(
        entryId,
        order.id,
        order.buyerCustomerId,
        amount,
        paid,
        chinaBusinessDate(paid),
        channel,
        note,
        actor.staffId,
        now,
      ),
    ];
    for (const proof of prepared)
      statements.push(
        ...proof.statements,
        context.env.DB.prepare(
          `INSERT INTO buyer_advance_principal_entry_files(id,advance_payment_entry_id,file_object_id,file_entity_link_id,created_at) VALUES(?,?,?,?,?)`,
        ).bind(proof.rowId, entryId, proof.fileObjectId, proof.linkId, now),
      );
    statements.push(
      createAuditEventStatement(context.env.DB, {
        id: crypto.randomUUID(),
        aggregateType: 'BUYER_ADVANCE_PRINCIPAL',
        aggregateId: entryId,
        eventType: 'BUYER_ADVANCE_PRINCIPAL_PAID',
        actor: { type: 'STAFF', id: actor.staffId, roles: [...actor.roles] },
        requestId: requestIdFromContext(context),
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: {
          formal_order_id: order.id,
          amount_cny_fen: String(amount),
          paid_at: paid,
          payment_channel: channel,
          proof_file_count: prepared.length,
        },
        createdAt: now,
      }),
      completeIdempotencyStatement(context.env.DB, acquired.claim, response, {
        resultReferences: {
          entry_id: entryId,
          proof_file_ids: prepared.map((proof) => proof.fileObjectId),
        },
        now,
      }),
      assertIdempotencyCompletionStatement(context.env.DB, acquired.claim),
    );
    await context.env.DB.batch(statements);
    return ok(context, response, 201);
  } catch (error) {
    await markIdempotencyFailed(
      context.env.DB,
      acquired.claim,
      'ADVANCE_PRINCIPAL_PAYMENT_FAILED',
      now,
    ).catch(() => false);
    throw normalizeIntegrityError(error);
  }
}

async function reverseAdvancePayment(context: Context<AppEnv>) {
  const actor = staff(context);
  if (!actor.roles.has('owner') && !actor.roles.has('buyer_refund')) forbidden();
  const order = await orderRow(context.env.DB, id(context.req.param('formalOrderId') ?? ''));
  await market(context.env.DB, actor, order.market);
  const paymentId = id(context.req.param('paymentId') ?? '');
  const original = await context.env.DB.prepare(
    `SELECT id,amount_cny_fen,payment_channel FROM buyer_advance_principal_entries WHERE id=? AND formal_order_id=? AND entry_type='PAYMENT'`,
  )
    .bind(paymentId, order.id)
    .first<{ id: string; amount_cny_fen: number; payment_channel: string }>();
  if (!original) throw new IntegrityError('NOT_FOUND', 404);
  const settled = await context.env.DB.prepare(
    `SELECT 1 AS present FROM buyer_advance_principal_settlements WHERE advance_payment_entry_id=?`,
  )
    .bind(paymentId)
    .first();
  if (settled) throw new IntegrityError('CONFLICT', 409);
  const body = await json(context, ['reason']);
  const amount = Number(original.amount_cny_fen);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new IntegrityError('CONFLICT', 409);
  const reason = text(body['reason'], 3, 2000);
  const prior = await context.env.DB.prepare(
    `SELECT 1 AS present FROM buyer_advance_principal_entries WHERE entry_type='REVERSAL' AND original_payment_entry_id=? LIMIT 1`,
  )
    .bind(paymentId)
    .first();
  if (prior) throw new IntegrityError('CONFLICT', 409);
  const now = Date.now();
  const acquired = await command(
    context,
    actor,
    'REVERSE_BUYER_ADVANCE_PRINCIPAL',
    'BUYER_ADVANCE_PRINCIPAL',
    paymentId,
    { amount_cny_fen: amount, reason },
    now,
  );
  if (acquired.kind === 'REPLAY') return ok(context, acquired.response, 201);
  const entryId = crypto.randomUUID();
  const response = {
    reversal: {
      entry_id: entryId,
      original_payment_entry_id: paymentId,
      amount_cny_fen: String(amount),
      reversed_at: now,
      reason,
    },
  };
  await commit(
    context,
    acquired.claim,
    'ADVANCE_PRINCIPAL_REVERSAL_FAILED',
    [
      context.env.DB.prepare(
        `INSERT INTO buyer_advance_principal_entries(id,formal_order_id,buyer_customer_id,entry_type,original_payment_entry_id,amount_cny_fen,paid_at,reversed_at,china_business_date,payment_channel,note,actor_staff_id,created_at) VALUES(?,?,?,'REVERSAL',?,?,NULL,?,?,?,?,?,?)`,
      ).bind(
        entryId,
        order.id,
        order.buyerCustomerId,
        paymentId,
        amount,
        now,
        chinaBusinessDate(now),
        original.payment_channel,
        reason,
        actor.staffId,
        now,
      ),
      createAuditEventStatement(context.env.DB, {
        id: crypto.randomUUID(),
        aggregateType: 'BUYER_ADVANCE_PRINCIPAL',
        aggregateId: entryId,
        eventType: 'BUYER_ADVANCE_PRINCIPAL_REVERSED',
        actor: { type: 'STAFF', id: actor.staffId, roles: [...actor.roles] },
        requestId: requestIdFromContext(context),
        idempotencyKey: acquired.claim.idempotencyKey,
        nextState: { original_payment_entry_id: paymentId, amount_cny_fen: String(amount), reason },
        createdAt: now,
      }),
      completeIdempotencyStatement(context.env.DB, acquired.claim, response, {
        resultReferences: { reversal_entry_id: entryId },
        now,
      }),
      assertIdempotencyCompletionStatement(context.env.DB, acquired.claim),
    ],
    now,
  );
  return ok(context, response, 201);
}

class AdvanceProofAuthorization implements FileAuthorizationService {
  constructor(private readonly actor: AssignmentStaffAuthorization) {}
  assertCanLink(fileActor: FileActor, resource: FileAuthorizationResource): void {
    if (
      fileActor.type !== 'STAFF' ||
      fileActor.id !== this.actor.staffId ||
      !this.actor.permissions.has('BUYER_REFUND_RECORD') ||
      resource.ownerActorType !== 'STAFF' ||
      resource.ownerActorId !== this.actor.staffId ||
      resource.purpose !== 'BUYER_REFUND_PROOF' ||
      resource.visibility !== 'INTERNAL_ONLY' ||
      resource.entityType !== 'BUYER_REFUND'
    )
      throw new IntegrityError('CONFLICT', 409);
  }
  assertCanCreateUpload(): never {
    throw new IntegrityError('FORBIDDEN', 403);
  }
  assertCanUpload(): never {
    throw new IntegrityError('FORBIDDEN', 403);
  }
  assertCanCompleteUpload(): never {
    throw new IntegrityError('FORBIDDEN', 403);
  }
  assertCanRead(): never {
    throw new IntegrityError('FORBIDDEN', 403);
  }
}

async function requireAdvanceAction(database: SqlDatabase, formalOrderId: string): Promise<void> {
  try {
    await requireFormalOrderAction(database, formalOrderId, 'RECORD_ADVANCE_PRINCIPAL');
  } catch (error) {
    if (error instanceof FormalOrderPolicyError) {
      if (error.code === 'FORMAL_ORDER_NOT_FOUND') throw new IntegrityError('NOT_FOUND', 404);
      throw new IntegrityError('CONFLICT', 409);
    }
    throw error;
  }
}
async function command(
  context: Context<AppEnv>,
  actor: AssignmentStaffAuthorization,
  action: string,
  targetType: string,
  targetId: string,
  payload: unknown,
  now: number,
) {
  try {
    return await acquireIdempotency<any>(
      context.env.DB,
      {
        actorType: 'STAFF',
        actorId: actor.staffId,
        action,
        targetType,
        targetId,
        idempotencyKey: idempotencyKey(context),
        requestHash: await hashCanonicalJson({
          action,
          target_type: targetType,
          target_id: targetId,
          payload,
        }),
      },
      { now },
    );
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = String((error as { code: unknown }).code);
      if (code === 'IDEMPOTENCY_CONFLICT') throw new IntegrityError('IDEMPOTENCY_CONFLICT', 409);
      if (code === 'REQUEST_IN_PROGRESS') throw new IntegrityError('REQUEST_IN_PROGRESS', 409);
      if (code === 'VALIDATION_ERROR') validation();
    }
    throw new IntegrityError('DEPENDENCY_UNAVAILABLE', 503);
  }
}
async function commit(
  context: Context<AppEnv>,
  claim: IdempotencyClaim,
  failureCode: string,
  statements: readonly SqlStatement[],
  now: number,
) {
  try {
    await context.env.DB.batch(statements);
  } catch (error) {
    await markIdempotencyFailed(context.env.DB, claim, failureCode, now).catch(() => false);
    throw normalizeIntegrityError(error);
  }
}
function validateProofRows(
  rows: readonly BuyerRefundProofFileRow[],
  proofs: readonly ProofInput[],
  staffId: string,
) {
  if (rows.length !== proofs.length) throw new IntegrityError('CONFLICT', 409);
  const map = new Map(rows.map((row) => [row.id, row]));
  for (const proof of proofs) {
    const row = map.get(proof.fileObjectId);
    if (
      !row ||
      row.status !== 'VERIFIED' ||
      row.intent_status !== 'VERIFIED' ||
      row.purpose !== 'BUYER_REFUND_PROOF' ||
      row.intent_purpose !== 'BUYER_REFUND_PROOF' ||
      row.visibility !== 'INTERNAL_ONLY' ||
      row.intent_visibility !== 'INTERNAL_ONLY' ||
      row.owner_actor_type !== 'STAFF' ||
      row.owner_actor_id !== staffId ||
      Number(row.version) !== proof.expectedFileVersion
    )
      throw new IntegrityError('CONFLICT', 409);
  }
}
function parseProofFiles(value: unknown): ProofInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) validation();
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) validation();
    const record = item as Record<string, unknown>;
    if (Object.keys(record).sort().join(',') !== 'expected_file_version,file_object_id')
      validation();
    const fileObjectId = id(String(record['file_object_id'] ?? ''));
    const expectedFileVersion = record['expected_file_version'];
    if (
      typeof expectedFileVersion !== 'number' ||
      !Number.isSafeInteger(expectedFileVersion) ||
      expectedFileVersion < 1 ||
      seen.has(fileObjectId)
    )
      validation();
    seen.add(fileObjectId);
    return { fileObjectId, expectedFileVersion };
  });
}
async function orderRow(database: SqlDatabase, orderId: string) {
  const row = await database
    .prepare(
      `SELECT id,buyer_customer_id,canonical_marketplace_code AS market FROM formal_orders WHERE id=?`,
    )
    .bind(orderId)
    .first<{ id: string; buyer_customer_id: string; market: string }>();
  if (!row) throw new IntegrityError('NOT_FOUND', 404);
  return { id: row.id, buyerCustomerId: row.buyer_customer_id, market: row.market };
}
export async function authoritativeAdvanceAmount(
  database: SqlDatabase,
  formalOrderId: string,
): Promise<number> {
  const row = await database
    .prepare(
      `SELECT buyer_expected_principal_cny_fen AS amount FROM formal_order_financial_snapshots WHERE formal_order_id=?`,
    )
    .bind(formalOrderId)
    .first<{ amount: number }>();
  const amount = Number(row?.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new IntegrityError('CONFLICT', 409);
  return amount;
}
async function reviewRow(database: SqlDatabase, reviewId: string) {
  const row = await database
    .prepare(
      `SELECT review_case.id,review_case.formal_order_id,formal_order.canonical_marketplace_code AS market FROM review_cases review_case JOIN formal_orders formal_order ON formal_order.id=review_case.formal_order_id WHERE review_case.id=?`,
    )
    .bind(reviewId)
    .first<{ id: string; formal_order_id: string; market: string }>();
  if (!row) throw new IntegrityError('NOT_FOUND', 404);
  return { id: row.id, formalOrderId: row.formal_order_id, market: row.market };
}
async function market(database: SqlDatabase, actor: AssignmentStaffAuthorization, code: string) {
  if (actor.roles.has('owner')) return;
  const allowed = await resolveStaffMarketplaceCodes(database, actor);
  if (!allowed.includes(code)) throw new IntegrityError('NOT_FOUND', 404);
}
function staff(context: Context<AppEnv>) {
  const actor = context.get('staffAuthorization') as AssignmentStaffAuthorization | undefined;
  if (!actor || actor.staffStatus !== 'ACTIVE') forbidden();
  return actor;
}
async function json(context: Context<AppEnv>, keys: string[]) {
  let body: unknown;
  try {
    body = await context.req.json();
  } catch {
    validation();
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) validation();
  const record = body as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key)))
    validation();
  return record;
}
function id(value: string) {
  const v = value.normalize('NFKC').trim();
  if (v.length < 1 || v.length > 200 || /[\u0000-\u001f\u007f]/u.test(v)) validation();
  return v;
}
function text(value: unknown, min: number, max: number) {
  if (typeof value !== 'string') validation();
  const v = value.normalize('NFKC').trim();
  if (v.length < min || v.length > max || /[\u0000-\u001f\u007f]/u.test(v)) validation();
  return v;
}
function optionalText(value: unknown, max: number) {
  if (value === null) return null;
  if (typeof value !== 'string') validation();
  const v = value.normalize('NFKC').trim();
  if (!v) return null;
  if (v.length > max) validation();
  return v;
}
function timestamp(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) validation();
  return value;
}
export function cleanOperatingPaymentTimestamp(value: unknown, now: number) {
  const parsed = timestamp(value);
  if (!Number.isSafeInteger(now) || now < 0 || parsed > now) validation();
  return parsed;
}
function signedMoney(value: unknown) {
  const number =
    typeof value === 'string' && /^-?[1-9][0-9]*$/u.test(value) ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number === 0) validation();
  return number;
}
function paymentChannel(value: unknown) {
  if (
    typeof value !== 'string' ||
    !['WECHAT', 'ALIPAY', 'BANK_TRANSFER', 'OTHER_MANUAL'].includes(value)
  )
    validation();
  return value;
}
function idempotencyKey(context: Context<AppEnv>) {
  const key = context.req.header('Idempotency-Key')?.trim() ?? '';
  if (key.length < 8 || key.length > 128 || key.includes(',') || /[\u0000-\u001f\u007f]/u.test(key))
    validation();
  return key;
}
function normalizeIntegrityError(error: unknown) {
  return error instanceof IntegrityError
    ? error
    : new IntegrityError('DEPENDENCY_UNAVAILABLE', 503);
}
function publicMessage(code: IntegrityError['code']): string {
  switch (code) {
    case 'FORBIDDEN':
      return '当前岗位无权执行该操作';
    case 'NOT_FOUND':
      return '没有找到对应业务记录';
    case 'CONFLICT':
      return '当前业务状态或凭证状态不允许该操作';
    case 'IDEMPOTENCY_CONFLICT':
      return '同一个操作编号对应了不同请求，请重新操作';
    case 'REQUEST_IN_PROGRESS':
      return '该操作正在处理中，请稍后刷新';
    case 'VALIDATION_ERROR':
      return '提交内容不正确';
    default:
      return '服务暂时不可用';
  }
}
function validation(): never {
  throw new IntegrityError('VALIDATION_ERROR', 400);
}
function forbidden(): never {
  throw new IntegrityError('FORBIDDEN', 403);
}
function ok(context: Context<AppEnv>, data: unknown, status = 200) {
  context.header('Cache-Control', 'no-store');
  return context.json(apiSuccess(data, requestIdFromContext(context)), status as 200 | 201);
}
function wrap(handler: (context: Context<AppEnv>) => Promise<Response>) {
  return async (context: Context<AppEnv>) => {
    try {
      return await handler(context);
    } catch (error) {
      const e = normalizeIntegrityError(error);
      return context.json(
        apiFailure(e.code, publicMessage(e.code), requestIdFromContext(context)),
        e.status,
      );
    }
  };
}
