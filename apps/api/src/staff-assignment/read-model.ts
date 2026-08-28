import type {
  SqlDatabase,
  StaffAssignmentDto,
  StaffAssignmentDutyCode,
  StaffRoleCode,
  StaffWorkbenchSummaryDto,
  StaffWorkItemDto,
  StaffWorkItemPageDto,
  StaffWorkItemType,
} from '@ygb/contracts';
import { chinaBusinessDate } from '@ygb/domain';
import {
  businessPermissionForWorkItem,
  eligibilityPermissionForDuty,
  workItemNextAction,
  workItemPriority,
  workItemSlaDueAt,
} from '@ygb/domain';
import type { AssignmentStaffAuthorization } from './effective-authorization';
import { orderVisibilityForActor } from './data-scope';
import { StaffAssignmentError } from './errors';

const DUTIES: readonly StaffAssignmentDutyCode[] = [
  'SELLER_ACCOUNT_MANAGER',
  'BUYER_PRE_SALES_OWNER',
  'BUYER_REFUND_OWNER',
];
const WORK_TYPES: readonly StaffWorkItemType[] = [
  'PRODUCT_APPLICATION_REVIEW',
  'DEMAND_REVIEW',
  'RESERVATION_DECISION',
  'ORDER_INSTRUCTION_PUBLISH',
  'ORDER_EVIDENCE_REVIEW',
  'REVIEW_DECISION',
  'BUYER_REFUND_PROCESSING',
];

function representativeWorkType(dutyCode: StaffAssignmentDutyCode): StaffWorkItemType {
  switch (dutyCode) {
    case 'SELLER_ACCOUNT_MANAGER':
      return 'PRODUCT_APPLICATION_REVIEW';
    case 'BUYER_PRE_SALES_OWNER':
      return 'RESERVATION_DECISION';
    case 'BUYER_REFUND_OWNER':
      return 'REVIEW_DECISION';
  }
}

export async function listMyAssignments(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
): Promise<readonly StaffAssignmentDto[]> {
  const allowedDuties = DUTIES.filter(
    (duty) =>
      actor.permissions.has(eligibilityPermissionForDuty(duty)) &&
      actor.permissions.has(businessPermissionForWorkItem(representativeWorkType(duty))),
  );
  if (allowedDuties.length < 1) return [];
  const dutySql = placeholders(allowedDuties);
  const [buyer, seller] = await Promise.all([
    database
      .prepare(
        `SELECT id AS assignment_id,'BUYER_CUSTOMER' AS subject_type,buyer_customer_id AS subject_id,duty_code,staff_id,status,source,reason,version,created_at,revoked_at FROM buyer_staff_assignments WHERE staff_id=? AND status='ACTIVE' AND duty_code IN (${dutySql}) ORDER BY duty_code,buyer_customer_id`,
      )
      .bind(actor.staffId, ...allowedDuties)
      .all<StaffAssignmentDto>(),
    database
      .prepare(
        `SELECT id AS assignment_id,'SELLER_ORGANIZATION' AS subject_type,seller_organization_id AS subject_id,duty_code,staff_id,status,source,reason,version,created_at,revoked_at FROM seller_staff_assignments WHERE staff_id=? AND status='ACTIVE' AND duty_code IN (${dutySql}) ORDER BY seller_organization_id`,
      )
      .bind(actor.staffId, ...allowedDuties)
      .all<StaffAssignmentDto>(),
  ]);
  return [...buyer.results, ...seller.results];
}

export async function listVisibleWorkItems(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  options: {
    limit?: number;
    status?: 'OPEN' | 'COMPLETED' | 'CANCELLED';
    workType?: StaffWorkItemType | null;
    cursor?: { createdAt: number; id: string } | null;
  } = {},
): Promise<StaffWorkItemPageDto> {
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new StaffAssignmentError('VALIDATION_ERROR', 400);
  const allowedWorkTypes = visibleWorkTypes(actor);
  const requested =
    options.workType == null
      ? allowedWorkTypes
      : allowedWorkTypes.filter((value) => value === options.workType);
  if (requested.length < 1) return { work_items: [], next_cursor: null };
  const global = actor.roles.has('owner');
  const markets = global ? [] : await primaryMarketplaceCodes(database, actor.staffId);
  if (!global && markets.length < 1) return { work_items: [], next_cursor: null };
  const marketSql = global ? '1=1' : `marketplace_code IN (${placeholders(markets)})`;
  const hideSettled =
    options.status === 'COMPLETED' || options.status === 'CANCELLED'
      ? '1=1'
      : refundStillNeedsWorkSql('staff_work_items');
  const rows = await database
    .prepare(
      `
    SELECT id AS work_item_id,work_type,source_entity_type,source_entity_id,
      buyer_customer_id,seller_organization_id,store_id,duty_code,
      fixed_assignment_id,assigned_staff_id,status,version,created_at,updated_at,
      completed_at,cancelled_at,
      (SELECT staff.display_name FROM staff_users staff
        WHERE staff.id=staff_work_items.assigned_staff_id) AS responsible_staff_name,
      (SELECT obligation.created_at FROM buyer_refund_obligations obligation
        WHERE obligation.id=staff_work_items.source_entity_id
           OR obligation.formal_order_id=staff_work_items.source_entity_id
        LIMIT 1) AS refund_anchor
    FROM staff_work_items
    WHERE status=? AND work_type IN (${placeholders(requested)})
      AND ${marketSql}
      AND ${hideSettled}
      ${options.cursor ? 'AND (created_at>? OR (created_at=? AND id>?))' : ''}
    ORDER BY created_at,id LIMIT ?
  `,
    )
    .bind(
      options.status ?? 'OPEN',
      ...requested,
      ...(global ? [] : markets),
      ...(options.cursor
        ? [options.cursor.createdAt, options.cursor.createdAt, options.cursor.id]
        : []),
      limit + 1,
    )
    .all<WorkItemRow>();
  const hasMore = rows.results.length > limit;
  const items = rows.results.slice(0, limit).map((row) => projectWorkItem(row));
  const last = items.at(-1);
  return {
    work_items: items,
    next_cursor:
      hasMore && last
        ? JSON.stringify({ createdAt: Number(last.created_at), id: last.work_item_id })
        : null,
  };
}

export async function getVisibleWorkItem(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  workItemId: string,
): Promise<StaffWorkItemDto> {
  const allowed = visibleWorkTypes(actor);
  if (allowed.length < 1) throw new StaffAssignmentError('NOT_FOUND', 404);
  const global = actor.roles.has('owner');
  const markets = global ? [] : await primaryMarketplaceCodes(database, actor.staffId);
  if (!global && markets.length < 1) throw new StaffAssignmentError('NOT_FOUND', 404);
  const marketSql = global ? '1=1' : `marketplace_code IN (${placeholders(markets)})`;
  const row = await database
    .prepare(
      `SELECT id AS work_item_id,work_type,source_entity_type,source_entity_id,
    buyer_customer_id,seller_organization_id,store_id,duty_code,fixed_assignment_id,
    assigned_staff_id,status,version,created_at,updated_at,completed_at,cancelled_at,
    (SELECT staff.display_name FROM staff_users staff
      WHERE staff.id=staff_work_items.assigned_staff_id) AS responsible_staff_name,
    (SELECT obligation.created_at FROM buyer_refund_obligations obligation
      WHERE obligation.id=staff_work_items.source_entity_id
         OR obligation.formal_order_id=staff_work_items.source_entity_id
      LIMIT 1) AS refund_anchor
    FROM staff_work_items WHERE id=? AND work_type IN (${placeholders(allowed)}) AND ${marketSql}
      AND (status<>'OPEN' OR ${refundStillNeedsWorkSql('staff_work_items')})`,
    )
    .bind(workItemId, ...allowed, ...(global ? [] : markets))
    .first<WorkItemRow>();
  if (!row) throw new StaffAssignmentError('NOT_FOUND', 404);
  return projectWorkItem(row);
}

interface WorkItemRow {
  work_item_id: string;
  work_type: StaffWorkItemType;
  source_entity_type: string;
  source_entity_id: string;
  buyer_customer_id: string | null;
  seller_organization_id: string | null;
  store_id: string | null;
  duty_code: StaffAssignmentDutyCode;
  fixed_assignment_id: string;
  assigned_staff_id: string;
  status: StaffWorkItemDto['status'];
  version: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  cancelled_at: number | null;
  responsible_staff_name: string | null;
  refund_anchor: number | null;
}

/** Stage 7.5 batch 1: derive the authoritative SLA metadata for one row. */
function projectWorkItem(row: WorkItemRow): StaffWorkItemDto {
  const now = Date.now();
  const slaDueAt = workItemSlaDueAt(
    row.work_type,
    Number(row.created_at),
    row.refund_anchor === null ? null : Number(row.refund_anchor),
  );
  return {
    ...row,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
    sla_due_at: slaDueAt,
    is_overdue: slaDueAt < now,
    overdue_since: slaDueAt < now ? slaDueAt : null,
    next_action: workItemNextAction(row.work_type),
    responsible_role: responsibleRoleForDuty(row.duty_code),
    responsible_staff_name: row.responsible_staff_name,
    priority: workItemPriority(slaDueAt, chinaBusinessDate, now),
  };
}

function responsibleRoleForDuty(
  duty: StaffAssignmentDutyCode,
): StaffRoleCode {
  switch (duty) {
    case 'SELLER_ACCOUNT_MANAGER':
      return 'seller_ops';
    case 'BUYER_PRE_SALES_OWNER':
      return 'pre_sales';
    case 'BUYER_REFUND_OWNER':
      return 'buyer_refund';
  }
}

/**
 * Stage 7.5 batch 1: authoritative workbench metrics. SLA counting reuses the
 * exact same domain rules as the projected DTOs. The refund amount is visible
 * only to the owner and buyer_refund roles; it sums the outstanding balance of
 * unsettled obligations whose SLA deadline (created_at + refund SLA) falls on
 * the current China business day.
 */
export async function readWorkbenchSummary(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  now = Date.now(),
): Promise<StaffWorkbenchSummaryDto> {
  const allowed = visibleWorkTypes(actor);
  const global = actor.roles.has('owner');
  const markets = global ? [] : await primaryMarketplaceCodes(database, actor.staffId);
  const canSeeItems = allowed.length > 0 && (global || markets.length > 0);
  const marketSql = global
    ? '1=1'
    : markets.length > 0
      ? `work.marketplace_code IN (${placeholders(markets)})`
      : '1=0';
  const typeSql = allowed.length > 0
    ? `work.work_type IN (${placeholders(allowed)})`
    : '1=0';

  let openCount = 0;
  let dueTodayCount = 0;
  let overdueCount = 0;
  const today = chinaBusinessDate(now);
  if (canSeeItems) {
    const rows = await database
      .prepare(
        `SELECT work.work_type, work.created_at,
          (SELECT obligation.created_at FROM buyer_refund_obligations obligation
            WHERE obligation.id=work.source_entity_id
               OR obligation.formal_order_id=work.source_entity_id
            LIMIT 1) AS refund_anchor
        FROM staff_work_items work
        WHERE work.status='OPEN' AND ${typeSql} AND ${marketSql}
          AND ${refundStillNeedsWorkSql('work')}`,
      )
      .bind(
        ...allowed,
        ...(global ? [] : markets),
      )
      .all<{ work_type: StaffWorkItemType; created_at: number; refund_anchor: number | null }>();
    for (const row of rows.results) {
      openCount += 1;
      const slaDueAt = workItemSlaDueAt(
        row.work_type,
        Number(row.created_at),
        row.refund_anchor === null ? null : Number(row.refund_anchor),
      );
      if (slaDueAt < now) overdueCount += 1;
      else if (chinaBusinessDate(slaDueAt) === today) dueTodayCount += 1;
    }
  }

  // Exception order count over the caller's fixed-assignment order visibility.
  const visibility = await orderVisibilityForActor(database, actor, 'o');
  const exceptionRow = await database
    .prepare(
      `SELECT COUNT(*) AS count FROM formal_orders o
      WHERE ${visibility.sql} AND COALESCE((
        SELECT event.event_type FROM formal_order_operational_events event
        WHERE event.formal_order_id=o.id
        ORDER BY event.created_at DESC,event.id DESC LIMIT 1
      ),'') NOT IN ('','RESOLVED')`,
    )
    .bind(...visibility.params)
    .first<{ count: number }>();

  // Refund amount due today: owner and buyer_refund only.
  const canSeeRefundAmount =
    actor.roles.has('owner') || actor.roles.has('buyer_refund');
  let refundDueToday: string | null = null;
  if (canSeeRefundAmount) {
    const refundVisibility = actor.roles.has('owner')
      ? { sql: '1=1', params: [] as unknown[] }
      : {
        sql: `obligation.buyer_customer_id IN (
          SELECT assignment.buyer_customer_id FROM buyer_staff_assignments assignment
          WHERE assignment.staff_id=? AND assignment.duty_code='BUYER_REFUND_OWNER'
            AND assignment.status='ACTIVE'
        )`,
        params: [actor.staffId] as unknown[],
      };
    const refundRow = await database
      .prepare(
        `SELECT CAST(COALESCE(SUM(
            obligation.due_amount_cny_fen - ledger.net_paid_cny_fen
          ),0) AS TEXT) AS amount
        FROM buyer_refund_obligations obligation
        JOIN buyer_refund_ledger_balances ledger
          ON ledger.obligation_id=obligation.id
        WHERE ledger.status IN ('DUE','PARTIALLY_PAID')
          AND ${refundVisibility.sql}
          AND strftime('%Y-%m-%d',(obligation.created_at+259200000)/1000,'unixepoch','+8 hours')=?`,
      )
      .bind(...refundVisibility.params, today)
      .first<{ amount: string }>();
    refundDueToday = refundRow?.amount ?? '0';
  }

  const recentPage = await listVisibleWorkItems(database, actor, { limit: 5 });

  return {
    open_count: openCount,
    due_today_count: dueTodayCount,
    overdue_count: overdueCount,
    exception_order_count: Number(exceptionRow?.count ?? 0),
    refund_due_today_cny_fen: refundDueToday,
    recent: recentPage.work_items,
  };
}

function refundStillNeedsWorkSql(alias: string) {
  return `(
  ${alias}.work_type<>'BUYER_REFUND_PROCESSING'
  OR NOT EXISTS(
    SELECT 1 FROM buyer_refund_obligations obligation
    WHERE (obligation.id=${alias}.source_entity_id OR obligation.formal_order_id=${alias}.source_entity_id)
      AND COALESCE((SELECT SUM(CASE entry.entry_type WHEN 'PAYMENT' THEN entry.amount_cny_fen ELSE -entry.amount_cny_fen END)
        FROM buyer_refund_payment_entries entry WHERE entry.obligation_id=obligation.id),0)>=obligation.due_amount_cny_fen
  )
)`;
}
async function primaryMarketplaceCodes(database: SqlDatabase, staffId: string): Promise<string[]> {
  const rows = await database
    .prepare(
      `SELECT scope.marketplace_code
    FROM staff_marketplace_scopes scope
    JOIN staff_users staff ON staff.id=scope.staff_id AND staff.status='ACTIVE'
    WHERE scope.staff_id=? AND scope.status='ACTIVE' AND scope.scope_kind='PRIMARY'
    ORDER BY scope.marketplace_code`,
    )
    .bind(staffId)
    .all<{ marketplace_code: string }>();
  return rows.results.map((row) => row.marketplace_code);
}
function visibleWorkTypes(actor: AssignmentStaffAuthorization): StaffWorkItemType[] {
  return WORK_TYPES.filter((workType) =>
    actor.permissions.has(businessPermissionForWorkItem(workType)),
  );
}
function placeholders(values: readonly unknown[]): string {
  return values.length > 0 ? values.map(() => '?').join(', ') : "''";
}
