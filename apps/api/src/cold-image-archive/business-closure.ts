import type { ArchiveComponentState, SqlDatabase } from '@ygb/contracts';
import { statementChangedOnce } from '@ygb/contracts';
import { archiveDueAt } from './time';

type Component = 'review' | 'buyer_refund' | 'seller_principal' | 'seller_service_fee';
interface Completion { state: ArchiveComponentState; completedAt: number; }

export async function recordOrderBusinessClosure(
  database: SqlDatabase,
  input: { formalOrderId: string; notApplicable?: readonly Component[]; now?: number },
): Promise<{ businessClosedAt: number; archiveDueAt: number }> {
  const now = input.now ?? Date.now();
  if (!safeId(input.formalOrderId) || !Number.isSafeInteger(now) || now < 0) {
    throw new Error('invalid_order_archive_closure');
  }
  const explicit = new Set(input.notApplicable ?? []);
  if (explicit.size !== (input.notApplicable ?? []).length
    || [...explicit].some((value) => !COMPONENTS.includes(value))) {
    throw new Error('invalid_order_archive_closure');
  }
  const existing = await database.prepare(`
    SELECT status,business_closed_at,archive_due_at
    FROM order_archive_closures WHERE formal_order_id=?
  `).bind(input.formalOrderId).first<{
    status: string; business_closed_at: number; archive_due_at: number;
  }>();
  if (existing?.status === 'CLOSED') {
    return { businessClosedAt: existing.business_closed_at, archiveDueAt: existing.archive_due_at };
  }
  if (existing) throw new Error('order_archive_closure_reopened');
  const order = await database.prepare('SELECT confirmed_at FROM formal_orders WHERE id=?')
    .bind(input.formalOrderId).first<{ confirmed_at: number }>();
  if (!order) throw new Error('order_archive_closure_not_found');

  const review = await reviewCompletion(database, input.formalOrderId, explicit.has('review'), now);
  const refund = await refundCompletion(database, input.formalOrderId, explicit.has('buyer_refund'), now);
  const principal = await payableCompletion(database, input.formalOrderId, 'SELLER_PRINCIPAL', explicit.has('seller_principal'), now);
  const fee = await payableCompletion(database, input.formalOrderId, 'SELLER_SERVICE_FEE', explicit.has('seller_service_fee'), now);
  const businessClosedAt = Math.max(order.confirmed_at, review.completedAt, refund.completedAt, principal.completedAt, fee.completedAt);
  const due = archiveDueAt(businessClosedAt);
  const result = await database.prepare(`
    INSERT INTO order_archive_closures(
      formal_order_id,review_state,buyer_refund_state,seller_principal_state,
      seller_service_fee_state,status,business_closed_at,archive_due_at,
      reopened_at,reason,version,created_at,updated_at
    ) VALUES(?,?,?,?,?,'CLOSED',?,?,NULL,NULL,1,?,?)
  `).bind(input.formalOrderId,review.state,refund.state,principal.state,fee.state,
    businessClosedAt,due,now,now).run();
  if (!statementChangedOnce(result)) throw new Error('order_archive_closure_conflict');
  return { businessClosedAt, archiveDueAt: due };
}

export async function reopenOrderBusinessClosure(
  database: SqlDatabase,
  input: { formalOrderId: string; expectedVersion: number; reason: string; now?: number },
): Promise<void> {
  const now = input.now ?? Date.now();
  if (!safeId(input.formalOrderId) || !Number.isSafeInteger(input.expectedVersion)
    || input.expectedVersion < 1 || input.reason.trim().length < 1 || input.reason.length > 2000
    || !Number.isSafeInteger(now) || now < 0) throw new Error('invalid_order_archive_reopen');
  const result = await database.prepare(`
    UPDATE order_archive_closures
    SET status='REOPENED',reopened_at=?,reason=?,version=version+1,updated_at=?
    WHERE formal_order_id=? AND status='CLOSED' AND version=?
      AND NOT EXISTS (
        SELECT 1 FROM file_drive_archives archive
        JOIN file_entity_links link ON link.file_object_id=archive.file_object_id
        WHERE archive.status='DRIVE_ARCHIVED' AND (
          (link.entity_type='ORDER' AND link.entity_id=?)
          OR (link.entity_type='REVIEW' AND EXISTS (
            SELECT 1 FROM review_cases review
            WHERE review.id=link.entity_id AND review.formal_order_id=?
          ))
          OR (link.entity_type='BUYER_REFUND' AND EXISTS (
            SELECT 1 FROM buyer_refund_obligations refund
            WHERE refund.id=link.entity_id AND refund.formal_order_id=?
          ))
        )
      )
  `).bind(now,input.reason.trim(),now,input.formalOrderId,input.expectedVersion,
    input.formalOrderId,input.formalOrderId,input.formalOrderId).run();
  if (!statementChangedOnce(result)) throw new Error('order_archive_reopen_conflict');
}

async function reviewCompletion(database: SqlDatabase, orderId: string, notApplicable: boolean, now: number): Promise<Completion> {
  const row = await database.prepare('SELECT status,decided_at,created_at FROM review_cases WHERE formal_order_id=?')
    .bind(orderId).first<{status:string;decided_at:number|null;created_at:number}>();
  if (!row) return explicitNotApplicable(notApplicable, now);
  if (notApplicable || row.status !== 'APPROVED' || row.decided_at === null) throw new Error('order_archive_review_incomplete');
  return {state:'COMPLETED',completedAt:row.decided_at};
}

async function refundCompletion(database: SqlDatabase, orderId: string, notApplicable: boolean, now: number): Promise<Completion> {
  const row = await database.prepare(`
    SELECT balance.status,balance.created_at,
      COALESCE((SELECT MAX(entry.created_at) FROM buyer_refund_payment_entries entry
        WHERE entry.obligation_id=balance.obligation_id),balance.created_at) AS completed_at
    FROM buyer_refund_ledger_balances balance WHERE balance.formal_order_id=?
  `).bind(orderId).first<{status:string;created_at:number;completed_at:number}>();
  if (!row) return explicitNotApplicable(notApplicable, now);
  if (notApplicable || row.status !== 'PAID') throw new Error('order_archive_buyer_refund_incomplete');
  return {state:'COMPLETED',completedAt:row.completed_at};
}

async function payableCompletion(database: SqlDatabase, orderId: string, type: 'SELLER_PRINCIPAL'|'SELLER_SERVICE_FEE', notApplicable: boolean, now: number): Promise<Completion> {
  const row = await database.prepare(`
    SELECT balance.derived_status,balance.created_at,
      COALESCE((SELECT MAX(allocation.created_at) FROM seller_payment_allocations allocation
        WHERE allocation.payable_id=balance.payable_id),balance.created_at) AS completed_at
    FROM seller_payable_balances balance
    WHERE balance.formal_order_id=? AND balance.payable_type=?
  `).bind(orderId,type).first<{derived_status:string;created_at:number;completed_at:number}>();
  if (!row) return explicitNotApplicable(notApplicable, now);
  if (notApplicable || row.derived_status !== 'PAID') throw new Error(`order_archive_${type.toLowerCase()}_incomplete`);
  return {state:'COMPLETED',completedAt:row.completed_at};
}

function explicitNotApplicable(explicit: boolean, now: number): Completion {
  if (!explicit) throw new Error('order_archive_component_not_explicitly_applicable');
  return {state:'NOT_APPLICABLE',completedAt:now};
}
const COMPONENTS: readonly Component[] = ['review','buyer_refund','seller_principal','seller_service_fee'];
function safeId(value:string):boolean { return value.length>=1 && value.length<=200 && !/[\u0000-\u001f\u007f]/u.test(value); }
