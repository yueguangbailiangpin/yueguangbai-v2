import type { ConfirmFormalOrderResult, SqlDatabase } from '@ygb/contracts';
import {
  approveOrderEvidenceAtomically,
  AtomicOrderEvidenceApprovalError,
} from '../src/order-evidence/approve-order-evidence';
import {
  FormalOrderError,
  requireFormalOrderConfirmationPermission,
  type FormalOrderStaffActor,
} from '../src/formal-order-shared/formal-order-shared';

/**
 * Test-only adapter that exercises the sole runtime confirmation authority.
 * It upgrades historical fixtures from VERIFIED to the canonical pending-review
 * entry state and supplies a real D1 work item; it never reimplements order
 * creation or financial calculations.
 */
export async function confirmFormalOrderForTest(
  database: SqlDatabase,
  input: {
    orderEvidenceSubmissionId: string;
    expectedVersion: number;
  },
  command: {
    actor: FormalOrderStaffActor;
    idempotencyKey: string;
    requestId?: string | null;
    now?: number;
  },
): Promise<ConfirmFormalOrderResult> {
  requireFormalOrderConfirmationPermission(command.actor);
  await prepareCanonicalApprovalFixture(database, {
    submissionId: input.orderEvidenceSubmissionId,
    staffId: command.actor.staffId,
    roles: command.actor.roles,
    now: command.now ?? Date.now(),
  });
  const mismatch = await database.prepare(`
    SELECT evidence.price_mismatch,evidence.price_difference_jpy
    FROM order_evidence_submissions submission
    JOIN order_evidence_versions evidence
      ON evidence.submission_id=submission.id
      AND evidence.version_no=submission.current_version_no
    WHERE submission.id=?
  `).bind(input.orderEvidenceSubmissionId).first<{
    price_mismatch: number;
    price_difference_jpy: number;
  }>();
  try {
    const result = await approveOrderEvidenceAtomically(
      database,
      {
        submissionId: input.orderEvidenceSubmissionId,
        expectedVersion: input.expectedVersion,
        ...(Number(mismatch?.price_mismatch ?? 0) === 1
          ? {
              priceMismatchAcknowledged: true,
              priceMismatchReason:
                `test fixture acknowledges ${mismatch?.price_difference_jpy}`,
            }
          : {}),
      },
      {
        actor: command.actor,
        idempotencyKey: command.idempotencyKey,
        ...(command.requestId === undefined
          ? {}
          : { requestId: command.requestId }),
        ...(command.now === undefined ? {} : { now: command.now }),
      },
    );
    return result.formalOrder;
  } catch (error) {
    if (error instanceof AtomicOrderEvidenceApprovalError) {
      throw legacyTestError(error);
    }
    throw error;
  }
}

async function prepareCanonicalApprovalFixture(
  database: SqlDatabase,
  input: {
    submissionId: string;
    staffId: string;
    roles: readonly string[];
    now: number;
  },
): Promise<void> {
  const source = await database.prepare(`
    SELECT submission.status,submission.buyer_customer_id,
      reservation.organization_id AS seller_organization_id,
      reservation.store_id
    FROM order_evidence_submissions submission
    JOIN product_reservations reservation
      ON reservation.id=submission.reservation_id
    WHERE submission.id=?
  `).bind(input.submissionId).first<{
    status: string;
    buyer_customer_id: string;
    seller_organization_id: string;
    store_id: string;
  }>();
  if (!source) return;

  const role = input.roles.includes('owner') ? 'owner' : 'pre_sales';
  const roleAssignment = await database.prepare(`
    SELECT 1 AS present FROM staff_role_assignments
    WHERE staff_id=? AND status='ACTIVE'
  `).bind(input.staffId).first();
  if (!roleAssignment) {
    await database.prepare(`
      INSERT INTO staff_role_assignments (
        id,staff_id,role_code,status,assigned_by_staff_id,assigned_at,
        revoked_at,revoked_by_staff_id,revoked_reason,created_at,updated_at
      ) VALUES (?, ?, ?, 'ACTIVE', NULL, ?, NULL, NULL, NULL, ?, ?)
    `).bind(
      `test-confirm-role:${input.staffId}`,
      input.staffId,
      role,
      input.now,
      input.now,
      input.now,
    ).run();
  }
  if (role === 'pre_sales') {
    const marketplaceScope = await database.prepare(`
      SELECT 1 AS present FROM staff_marketplace_scopes
      WHERE staff_id=? AND marketplace_code='AMAZON_JP' AND status='ACTIVE'
    `).bind(input.staffId).first();
    if (!marketplaceScope) {
      await database.prepare(`
        INSERT INTO staff_marketplace_scopes (
          id,staff_id,role_code,marketplace_code,status,assigned_by_staff_id,
          assigned_at,revoked_at,reason,created_at,updated_at,scope_kind
        ) VALUES (?,?,'pre_sales','AMAZON_JP','ACTIVE',NULL,?,NULL,
          'canonical confirmation test fixture',?,?,'PRIMARY')
      `).bind(
        `test-confirm-scope:${input.staffId}`,
        input.staffId,
        input.now,
        input.now,
        input.now,
      ).run();
    }
  }

  if (source.status === 'VERIFIED') {
    await database.prepare(`
      UPDATE order_evidence_submissions
      SET status='PENDING_VERIFICATION',verified_by_staff_id=NULL,
        verified_at=NULL,updated_at=MAX(updated_at,?)
      WHERE id=? AND status='VERIFIED'
    `).bind(input.now, input.submissionId).run();
  }

  const existing = await database.prepare(`
    SELECT id,staff_id FROM buyer_staff_assignments
    WHERE buyer_customer_id=? AND duty_code='BUYER_PRE_SALES_OWNER'
      AND status='ACTIVE'
  `).bind(source.buyer_customer_id).first<{
    id: string;
    staff_id: string;
  }>();
  const assignmentId = existing?.id
    ?? `test-confirm-assignment:${input.submissionId}`;
  const assignedStaffId = existing?.staff_id ?? input.staffId;
  if (!existing) {
    await database.prepare(`
      INSERT INTO buyer_staff_assignments (
        id,buyer_customer_id,duty_code,staff_id,status,source,
        assigned_by_actor_type,assigned_by_actor_id,reason,version,
        created_at,updated_at,revoked_at
      ) VALUES (?,?,'BUYER_PRE_SALES_OWNER',?,'ACTIVE','AUTO_INITIAL',
        'SYSTEM',NULL,'canonical confirmation test fixture',1,?,?,NULL)
    `).bind(
      assignmentId,
      source.buyer_customer_id,
      assignedStaffId,
      input.now,
      input.now,
    ).run();
  }
  const workItem = await database.prepare(`
    SELECT 1 AS present FROM staff_work_items
    WHERE source_entity_type='ORDER_EVIDENCE' AND source_entity_id=?
      AND work_type='ORDER_EVIDENCE_REVIEW'
  `).bind(input.submissionId).first();
  if (!workItem) {
    await database.prepare(`
      INSERT INTO staff_work_items (
        id,work_type,source_entity_type,source_entity_id,buyer_customer_id,
        seller_organization_id,store_id,duty_code,fixed_assignment_type,
        fixed_assignment_id,assigned_staff_id,status,version,created_at,
        updated_at,completed_at,cancelled_at
      ) VALUES (
        ?,'ORDER_EVIDENCE_REVIEW','ORDER_EVIDENCE',?,?,?, ?,
        'BUYER_PRE_SALES_OWNER','BUYER',?,?,'OPEN',1,?,?,NULL,NULL
      )
    `).bind(
      `test-confirm-work-item:${input.submissionId}`,
      input.submissionId,
      source.buyer_customer_id,
      source.seller_organization_id,
      source.store_id,
      assignmentId,
      assignedStaffId,
      input.now,
      input.now,
    ).run();
  }
}

function legacyTestError(
  error: AtomicOrderEvidenceApprovalError,
): FormalOrderError {
  if (error.code === 'NOT_FOUND') {
    return new FormalOrderError('ORDER_EVIDENCE_NOT_FOUND', 404);
  }
  if (error.code === 'STATE_CONFLICT') {
    return new FormalOrderError('ORDER_EVIDENCE_STATE_CONFLICT', 409);
  }
  if (error.code === 'PRICE_MISMATCH') {
    return new FormalOrderError('FORMAL_ORDER_STATE_CONFLICT', 409);
  }
  return new FormalOrderError(error.code, error.status);
}
