import type {
  SqlDatabase,
  StaffAssignmentDto,
  StaffAssignmentDutyCode,
  StaffWorkItemDto,
  StaffWorkItemPageDto,
  StaffWorkItemType,
} from '@ygb/contracts';
import { businessPermissionForWorkItem, eligibilityPermissionForDuty } from '@ygb/domain';
import type { AssignmentStaffAuthorization } from './effective-authorization';
import { StaffAssignmentError } from './errors';
import { representativeWorkType } from './reassignment-service';

const DUTIES: readonly StaffAssignmentDutyCode[] = [
  'SELLER_ACCOUNT_MANAGER','BUYER_PRE_SALES_OWNER','BUYER_AFTER_SALES_OWNER','BUYER_REFUND_OWNER',
];
const WORK_TYPES: readonly StaffWorkItemType[] = [
  'PRODUCT_APPLICATION_REVIEW','DEMAND_REVIEW','RESERVATION_DECISION',
  'ORDER_INSTRUCTION_PUBLISH','ORDER_EVIDENCE_REVIEW','REVIEW_DECISION','BUYER_REFUND_PROCESSING',
];

export async function listMyAssignments(database: SqlDatabase, actor: AssignmentStaffAuthorization): Promise<readonly StaffAssignmentDto[]> {
  const allowedDuties = DUTIES.filter((duty) => actor.permissions.has(eligibilityPermissionForDuty(duty))
    && actor.permissions.has(businessPermissionForWorkItem(representativeWorkType(duty))));
  if (allowedDuties.length < 1) return [];
  const dutySql = placeholders(allowedDuties);
  const [buyer, seller] = await Promise.all([
    database.prepare(`SELECT id AS assignment_id,'BUYER_CUSTOMER' AS subject_type,buyer_customer_id AS subject_id,duty_code,staff_id,status,source,reason,version,created_at,revoked_at FROM buyer_staff_assignments WHERE staff_id=? AND status='ACTIVE' AND duty_code IN (${dutySql}) ORDER BY duty_code,buyer_customer_id`).bind(actor.staffId,...allowedDuties).all<StaffAssignmentDto>(),
    database.prepare(`SELECT id AS assignment_id,'SELLER_ORGANIZATION' AS subject_type,seller_organization_id AS subject_id,duty_code,staff_id,status,source,reason,version,created_at,revoked_at FROM seller_staff_assignments WHERE staff_id=? AND status='ACTIVE' AND duty_code IN (${dutySql}) ORDER BY seller_organization_id`).bind(actor.staffId,...allowedDuties).all<StaffAssignmentDto>(),
  ]);
  return [...buyer.results,...seller.results];
}

export async function listVisibleWorkItems(
  database: SqlDatabase,
  actor: AssignmentStaffAuthorization,
  options: { limit?: number; status?: 'OPEN'|'COMPLETED'|'CANCELLED'; workType?: StaffWorkItemType|null; cursor?: { createdAt:number; id:string }|null } = {},
): Promise<StaffWorkItemPageDto> {
  const limit=options.limit??50;
  if(!Number.isSafeInteger(limit)||limit<1||limit>100) throw new StaffAssignmentError('VALIDATION_ERROR',400);
  const allowedWorkTypes=visibleWorkTypes(actor);
  const requested=options.workType==null?allowedWorkTypes:allowedWorkTypes.filter((value)=>value===options.workType);
  if(requested.length<1)return {work_items:[],next_cursor:null};
  const global=actor.roles.has('owner');
  const markets=global?[]:await primaryMarketplaceCodes(database,actor.staffId);
  // SUPPORT staff retain customer/product visibility through normal Marketplace
  // scope, but the open operational queue belongs to the current PRIMARY only.
  if(!global&&markets.length<1)return {work_items:[],next_cursor:null};
  const marketSql=global?'1=1':`marketplace_code IN (${placeholders(markets)})`;
  const rows=await database.prepare(`
    SELECT id AS work_item_id,work_type,source_entity_type,source_entity_id,
      buyer_customer_id,seller_organization_id,store_id,duty_code,
      fixed_assignment_id,assigned_staff_id,status,version,created_at,updated_at,
      completed_at,cancelled_at
    FROM staff_work_items
    WHERE status=? AND work_type IN (${placeholders(requested)})
      AND ${marketSql}
      ${options.cursor?'AND (created_at>? OR (created_at=? AND id>?))':''}
    ORDER BY created_at,id LIMIT ?
  `).bind(
    options.status??'OPEN',...requested,...(global?[]:markets),
    ...(options.cursor?[options.cursor.createdAt,options.cursor.createdAt,options.cursor.id]:[]),limit+1,
  ).all<StaffWorkItemDto>();
  const hasMore=rows.results.length>limit; const items=rows.results.slice(0,limit); const last=items.at(-1);
  return {work_items:items,next_cursor:hasMore&&last?JSON.stringify({createdAt:Number(last.created_at),id:last.work_item_id}):null};
}

export async function getVisibleWorkItem(database:SqlDatabase,actor:AssignmentStaffAuthorization,workItemId:string):Promise<StaffWorkItemDto>{
  const allowed=visibleWorkTypes(actor); if(allowed.length<1)throw new StaffAssignmentError('NOT_FOUND',404);
  const global=actor.roles.has('owner');
  const markets=global?[]:await primaryMarketplaceCodes(database,actor.staffId);
  if(!global&&markets.length<1)throw new StaffAssignmentError('NOT_FOUND',404);
  const marketSql=global?'1=1':`marketplace_code IN (${placeholders(markets)})`;
  const row=await database.prepare(`SELECT id AS work_item_id,work_type,source_entity_type,source_entity_id,
    buyer_customer_id,seller_organization_id,store_id,duty_code,fixed_assignment_id,
    assigned_staff_id,status,version,created_at,updated_at,completed_at,cancelled_at
    FROM staff_work_items WHERE id=? AND work_type IN (${placeholders(allowed)}) AND ${marketSql}`)
    .bind(workItemId,...allowed,...(global?[]:markets)).first<StaffWorkItemDto>();
  if(!row)throw new StaffAssignmentError('NOT_FOUND',404); return row;
}

async function primaryMarketplaceCodes(database:SqlDatabase,staffId:string):Promise<string[]>{
  const rows=await database.prepare(`SELECT scope.marketplace_code
    FROM staff_marketplace_scopes scope
    JOIN staff_users staff ON staff.id=scope.staff_id AND staff.status='ACTIVE'
    WHERE scope.staff_id=? AND scope.status='ACTIVE' AND scope.scope_kind='PRIMARY'
    ORDER BY scope.marketplace_code`).bind(staffId).all<{marketplace_code:string}>();
  return rows.results.map((row)=>row.marketplace_code);
}
function visibleWorkTypes(actor:AssignmentStaffAuthorization):StaffWorkItemType[]{
  return WORK_TYPES.filter((workType)=>actor.permissions.has(businessPermissionForWorkItem(workType)));
}
function placeholders(values:readonly unknown[]):string{return values.length>0?values.map(()=>'?').join(', '):"''";}
