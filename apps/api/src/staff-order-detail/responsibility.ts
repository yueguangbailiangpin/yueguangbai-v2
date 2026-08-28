import type {
  FormalOrderBusinessStage,
  FormalOrderExceptionState,
  FormalOrderNextAction,
  FormalOrderResponsibilityDto,
  FormalOrderResponsibleRole,
  FormalOrderResponsibleStaffProjection,
  FixedIntegerString,
  SqlDatabase,
} from '@ygb/contracts';
import type { AssignmentStaffAuthorization } from '../staff-assignment';

/**
 * Stage 7.5 batch 1: the authoritative order responsibility read model shared
 * by the cursor list and the unified order detail. Stage comes from the live
 * refund-ledger and payable-balance views; responsibility comes from the fixed
 * assignment tables; exceptions come from the operational event log. Nothing
 * here is stored on the order or derived by the client.
 */

const REFUND_SLA_MS = 72 * 60 * 60 * 1000;

export interface ResponsibilityFacts {
  refund_open: 0 | 1;
  settlement_open: 0 | 1;
  latest_event_type: string | null;
  latest_event_reason: string | null;
  refund_sla_anchor: number | null;
  settlement_due_at: number | null;
  refund_owner_staff_id: string | null;
  refund_owner_staff_name: string | null;
  seller_manager_staff_id: string | null;
  seller_manager_staff_name: string | null;
  owner_staff_id: string | null;
  owner_staff_name: string | null;
}

export interface ResponsibilityRow extends ResponsibilityFacts {
  formal_order_id: string;
  buyer_customer_id: string;
  seller_organization_id: string;
}

/**
 * Correlated select expressions embedding the authoritative responsibility
 * facts into a query whose FROM already aliases formal_orders as `o`.
 */
export function responsibilitySelects(alias = 'o'): string {
  return `
    EXISTS (
      SELECT 1 FROM buyer_refund_ledger_balances obligation
      WHERE obligation.formal_order_id=${alias}.id
        AND obligation.status IN ('DUE','PARTIALLY_PAID')
    ) AS refund_open,
    EXISTS (
      SELECT 1 FROM seller_payable_balances payable
      WHERE payable.formal_order_id=${alias}.id
        AND payable.outstanding_amount_cny_fen>0
    ) AS settlement_open,
    (
      SELECT event.event_type FROM formal_order_operational_events event
      WHERE event.formal_order_id=${alias}.id
      ORDER BY event.created_at DESC,event.id DESC LIMIT 1
    ) AS latest_event_type,
    (
      SELECT event.reason FROM formal_order_operational_events event
      WHERE event.formal_order_id=${alias}.id
      ORDER BY event.created_at DESC,event.id DESC LIMIT 1
    ) AS latest_event_reason,
    (
      SELECT MIN(obligation.created_at)
      FROM buyer_refund_ledger_balances obligation
      WHERE obligation.formal_order_id=${alias}.id
        AND obligation.status IN ('DUE','PARTIALLY_PAID')
    ) AS refund_sla_anchor,
    (
      SELECT MIN(payable.due_at) FROM seller_payable_balances payable
      WHERE payable.formal_order_id=${alias}.id
        AND payable.outstanding_amount_cny_fen>0
    ) AS settlement_due_at,
    (
      SELECT staff.id
      FROM buyer_staff_assignments assignment
      JOIN staff_users staff ON staff.id=assignment.staff_id
        AND staff.status='ACTIVE'
      WHERE assignment.buyer_customer_id=${alias}.buyer_customer_id
        AND assignment.duty_code='BUYER_REFUND_OWNER'
        AND assignment.status='ACTIVE'
      ORDER BY assignment.created_at,assignment.id LIMIT 1
    ) AS refund_owner_staff_id,
    (
      SELECT staff.display_name
      FROM buyer_staff_assignments assignment
      JOIN staff_users staff ON staff.id=assignment.staff_id
        AND staff.status='ACTIVE'
      WHERE assignment.buyer_customer_id=${alias}.buyer_customer_id
        AND assignment.duty_code='BUYER_REFUND_OWNER'
        AND assignment.status='ACTIVE'
      ORDER BY assignment.created_at,assignment.id LIMIT 1
    ) AS refund_owner_staff_name,
    (
      SELECT staff.id
      FROM seller_staff_assignments assignment
      JOIN staff_users staff ON staff.id=assignment.staff_id
        AND staff.status='ACTIVE'
      WHERE assignment.seller_organization_id=${alias}.seller_organization_id
        AND assignment.duty_code='SELLER_ACCOUNT_MANAGER'
        AND assignment.status='ACTIVE'
      ORDER BY assignment.created_at,assignment.id LIMIT 1
    ) AS seller_manager_staff_id,
    (
      SELECT staff.display_name
      FROM seller_staff_assignments assignment
      JOIN staff_users staff ON staff.id=assignment.staff_id
        AND staff.status='ACTIVE'
      WHERE assignment.seller_organization_id=${alias}.seller_organization_id
        AND assignment.duty_code='SELLER_ACCOUNT_MANAGER'
        AND assignment.status='ACTIVE'
      ORDER BY assignment.created_at,assignment.id LIMIT 1
    ) AS seller_manager_staff_name,
    (
      SELECT staff.id FROM staff_users staff
      JOIN staff_role_assignments role ON role.staff_id=staff.id
        AND role.status='ACTIVE' AND role.role_code='owner'
      WHERE staff.status='ACTIVE'
      ORDER BY staff.created_at,staff.id LIMIT 1
    ) AS owner_staff_id,
    (
      SELECT staff.display_name FROM staff_users staff
      JOIN staff_role_assignments role ON role.staff_id=staff.id
        AND role.status='ACTIVE' AND role.role_code='owner'
      WHERE staff.status='ACTIVE'
      ORDER BY staff.created_at,staff.id LIMIT 1
    ) AS owner_staff_name
  `;
}

export function stageOf(row: Pick<ResponsibilityFacts, 'refund_open' | 'settlement_open'>): FormalOrderBusinessStage {
  if (row.refund_open === 1) return 'BUYER_REFUND';
  if (row.settlement_open === 1) return 'SELLER_SETTLEMENT';
  return 'COMPLETED';
}

export function exceptionStateOf(
  row: Pick<ResponsibilityFacts, 'latest_event_type'>,
): FormalOrderExceptionState {
  return row.latest_event_type !== null && row.latest_event_type !== 'RESOLVED'
    ? 'OPEN'
    : 'NONE';
}

export function buildResponsibility(
  row: ResponsibilityFacts,
  actor: AssignmentStaffAuthorization,
  now: number,
): FormalOrderResponsibilityDto {
  const stage = stageOf(row);
  const exceptionState = exceptionStateOf(row);
  const staffForStage = (
    stage === 'BUYER_REFUND'
      ? {
        staff_id: row.refund_owner_staff_id,
        display_name: row.refund_owner_staff_name,
        role: 'buyer_refund' as const,
      }
      : stage === 'SELLER_SETTLEMENT'
        ? {
          staff_id: row.seller_manager_staff_id,
          display_name: row.seller_manager_staff_name,
          role: 'seller_ops' as const,
        }
        : {
          staff_id: row.owner_staff_id,
          display_name: row.owner_staff_name,
          role: 'owner' as const,
        }
  );
  const responsibleStaff: FormalOrderResponsibleStaffProjection | null =
    staffForStage.staff_id === null || staffForStage.display_name === null
      ? null
      : Object.freeze({
        staff_id: staffForStage.staff_id,
        display_name: staffForStage.display_name,
      });
  const dueAt = stage === 'BUYER_REFUND'
    ? row.refund_sla_anchor === null
      ? null
      : Number(row.refund_sla_anchor) + REFUND_SLA_MS
    : stage === 'SELLER_SETTLEMENT'
      ? row.settlement_due_at === null ? null : Number(row.settlement_due_at)
      : null;
  const nextAction: FormalOrderNextAction = exceptionState === 'OPEN'
    ? 'RESOLVE_EXCEPTION'
    : responsibleStaff === null
      ? 'ASSIGN_RESPONSIBLE_STAFF'
      : stage === 'BUYER_REFUND'
        ? 'PROCESS_BUYER_REFUND'
        : stage === 'SELLER_SETTLEMENT'
          ? 'FOLLOW_SELLER_SETTLEMENT'
          : 'REVIEW_COMPLETED_ORDER';
  return Object.freeze({
    stage,
    responsible_role: staffForStage.role satisfies FormalOrderResponsibleRole,
    responsible_staff: responsibleStaff,
    next_action: nextAction,
    next_action_due_at: dueAt,
    is_overdue: dueAt !== null && dueAt < now,
    overdue_since: dueAt !== null && dueAt < now ? dueAt : null,
    exception_state: exceptionState,
    exception_reason: exceptionState === 'OPEN'
      ? row.latest_event_reason
      : null,
    available_actions: availableActionsFor(actor, stage),
  });
}

function availableActionsFor(
  actor: AssignmentStaffAuthorization,
  _stage: FormalOrderBusinessStage,
): readonly string[] {
  const isOwner = actor.roles.has('owner');
  const actions: string[] = [];
  if (actor.permissions.has('BUYER_REFUND_RECORD')) actions.push('record_refund_payment');
  if (actor.permissions.has('SELLER_SETTLEMENT_RECORD')) actions.push('record_seller_payment');
  if (actor.permissions.has('ORDER_CONFIRM')) actions.push('upload_communication_screenshot');
  if (isOwner || actor.roles.has('seller_ops')) actions.push('record_operational_event');
  if (isOwner && actor.permissions.has('FINANCIAL_CORRECT')) actions.push('financial_adjustment');
  return Object.freeze(actions);
}

/** Load the responsibility facts for a single order (detail endpoint). */
export async function readResponsibilityRow(
  database: SqlDatabase,
  orderId: string,
): Promise<ResponsibilityRow | null> {
  return await database
    .prepare(
      `SELECT o.id AS formal_order_id, o.buyer_customer_id, o.seller_organization_id,
        ${responsibilitySelects('o')}
      FROM formal_orders o WHERE o.id=?`,
    )
    .bind(orderId)
    .first<ResponsibilityRow>();
}

export function fixedAmountOrNull(
  value: number | string | null | undefined,
): FixedIntegerString | null {
  if (value === null || value === undefined) return null;
  const serialized = String(value);
  return /^(0|[1-9][0-9]*)$/u.test(serialized) ? serialized : null;
}
