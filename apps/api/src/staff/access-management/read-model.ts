import {
  STAFF_ROLE_DISPLAY_NAMES,
  isStaffRoleCode,
  type SqlDatabase,
  type StaffAccessBuyerRefundOwnerAssignmentDto,
  type StaffAccessEmployeeDto,
  type StaffAccessManagementOverviewDto,
  type StaffAccessSellerOrganizationAssignmentDto,
} from '@ygb/contracts';
import { RESERVATION_AUTO_APPROVE_SYSTEM_STAFF_ID } from '../../reservations/auto-approve';
import { StaffAccessManagementError } from './errors';

interface EmployeeRow {
  staff_id: string;
  display_name: string;
  status: string;
  version: number;
  role_code: string | null;
  active_role_count: number;
  email: string | null;
  last_login_at: number | null;
  marketplace_codes: string | null;
  marketplace_scopes: string | null;
  updated_at: number;
}
interface MarketplaceRow {
  code: string;
  display_name_zh: string;
  status: 'ACTIVE' | 'DISABLED';
}
interface SellerOrganizationAssignmentRow {
  seller_organization_id: string;
  seller_organization_name: string;
  marketplace_code: string;
  assignment_id: string | null;
  staff_id: string | null;
  staff_display_name: string | null;
  assignment_version: number | null;
}
interface BuyerRefundOwnerAssignmentRow {
  buyer_customer_id: string;
  buyer_display_name: string;
  marketplace_code: string;
  pre_sales_assignment_id: string | null;
  pre_sales_staff_id: string | null;
  pre_sales_staff_display_name: string | null;
  pre_sales_assignment_version: number | null;
  refund_assignment_id: string | null;
  refund_staff_id: string | null;
  refund_staff_display_name: string | null;
  refund_assignment_version: number | null;
}

export async function readStaffAccessManagementOverview(
  database: SqlDatabase,
): Promise<StaffAccessManagementOverviewDto> {
  const [employees, markets] = await Promise.all([
    // The reservation auto-approve system staff row is a bookkeeping
  // placeholder, not an employee — it has no identity and cannot log in.
  employeeQuery(
    database,
    'staff.id<>?',
    [RESERVATION_AUTO_APPROVE_SYSTEM_STAFF_ID],
  ).all<EmployeeRow>(),
    database
      .prepare(
        `SELECT code,display_name_zh,status FROM marketplace_registry ORDER BY
      CASE code WHEN 'AMAZON_JP' THEN 0 WHEN 'AMAZON_US' THEN 1 WHEN 'COUPANG_KR' THEN 2 ELSE 3 END,
      display_name_zh,code`,
      )
      .all<MarketplaceRow>(),
  ]);
  return Object.freeze({
    employees: Object.freeze(employees.results.map(projectEmployee)),
    available_marketplaces: Object.freeze(
      markets.results.map((row) =>
        Object.freeze({ code: row.code, display_name: row.display_name_zh, status: row.status }),
      ),
    ),
  });
}
export async function readStaffAccessEmployee(
  database: SqlDatabase,
  staffId: string,
): Promise<StaffAccessEmployeeDto> {
  const row = await employeeQuery(database, 'staff.id=?', [staffId]).first<EmployeeRow>();
  if (!row) throw new StaffAccessManagementError('NOT_FOUND', 404);
  return projectEmployee(row);
}
/**
 * The seller fixed-owner relationship is canonical in seller_staff_assignments.
 * Keep this read model separate from the staff list so a management screen can
 * show organization and person names without exposing operators to raw IDs.
 */
export async function readStaffSellerOrganizationAssignments(
  database: SqlDatabase,
): Promise<readonly StaffAccessSellerOrganizationAssignmentDto[]> {
  const result = await database
    .prepare(
      `SELECT organization.id AS seller_organization_id,
        organization.organization_name AS seller_organization_name,
        organization.marketplace_code,
        assignment.id AS assignment_id, assignment.staff_id,
        staff.display_name AS staff_display_name,
        assignment.version AS assignment_version
      FROM seller_organizations organization
      LEFT JOIN seller_staff_assignments assignment
        ON assignment.seller_organization_id=organization.id
        AND assignment.duty_code='SELLER_ACCOUNT_MANAGER'
        AND assignment.status='ACTIVE'
      LEFT JOIN staff_users staff ON staff.id=assignment.staff_id
      WHERE organization.status='ACTIVE'
      ORDER BY organization.organization_name,organization.id`,
    )
    .all<SellerOrganizationAssignmentRow>();
  return Object.freeze(result.results.map(projectSellerOrganizationAssignment));
}

export async function readStaffSellerOrganizationAssignment(
  database: SqlDatabase,
  sellerOrganizationId: string,
): Promise<StaffAccessSellerOrganizationAssignmentDto> {
  const row = await database
    .prepare(
      `SELECT organization.id AS seller_organization_id,
        organization.organization_name AS seller_organization_name,
        organization.marketplace_code,
        assignment.id AS assignment_id, assignment.staff_id,
        staff.display_name AS staff_display_name,
        assignment.version AS assignment_version
      FROM seller_organizations organization
      LEFT JOIN seller_staff_assignments assignment
        ON assignment.seller_organization_id=organization.id
        AND assignment.duty_code='SELLER_ACCOUNT_MANAGER'
        AND assignment.status='ACTIVE'
      LEFT JOIN staff_users staff ON staff.id=assignment.staff_id
      WHERE organization.id=? AND organization.status='ACTIVE'`,
    )
    .bind(sellerOrganizationId)
    .first<SellerOrganizationAssignmentRow>();
  if (!row) throw new StaffAccessManagementError('NOT_FOUND', 404);
  return projectSellerOrganizationAssignment(row);
}

const BUYER_REFUND_OWNER_ASSIGNMENT_QUERY = `SELECT buyer.id AS buyer_customer_id,
  buyer.display_name AS buyer_display_name,
  buyer.marketplace_code,
  pre_sales.id AS pre_sales_assignment_id, pre_sales.staff_id AS pre_sales_staff_id,
  pre_sales_staff.display_name AS pre_sales_staff_display_name,
  pre_sales.version AS pre_sales_assignment_version,
  refund.id AS refund_assignment_id, refund.staff_id AS refund_staff_id,
  refund_staff.display_name AS refund_staff_display_name,
  refund.version AS refund_assignment_version
FROM buyer_customers buyer
LEFT JOIN buyer_staff_assignments pre_sales
  ON pre_sales.buyer_customer_id=buyer.id
  AND pre_sales.duty_code='BUYER_PRE_SALES_OWNER'
  AND pre_sales.status='ACTIVE'
LEFT JOIN staff_users pre_sales_staff ON pre_sales_staff.id=pre_sales.staff_id
LEFT JOIN buyer_staff_assignments refund
  ON refund.buyer_customer_id=buyer.id
  AND refund.duty_code='BUYER_REFUND_OWNER'
  AND refund.status='ACTIVE'
LEFT JOIN staff_users refund_staff ON refund_staff.id=refund.staff_id`;

/**
 * The buyer fixed refund-owner relationship is canonical in
 * buyer_staff_assignments (BUYER_REFUND_OWNER duty). Buyers without an owner
 * are surfaced with refund_owner=null so an operator can see exactly which
 * fail-closed subjects still need a binding.
 */
export async function readStaffBuyerRefundOwnerAssignments(
  database: SqlDatabase,
): Promise<readonly StaffAccessBuyerRefundOwnerAssignmentDto[]> {
  const result = await database
    .prepare(
      `${BUYER_REFUND_OWNER_ASSIGNMENT_QUERY}
      ORDER BY buyer.display_name,buyer.id LIMIT 500`,
    )
    .all<BuyerRefundOwnerAssignmentRow>();
  return Object.freeze(result.results.map(projectBuyerRefundOwnerAssignment));
}

export async function readStaffBuyerRefundOwnerAssignment(
  database: SqlDatabase,
  buyerCustomerId: string,
): Promise<StaffAccessBuyerRefundOwnerAssignmentDto> {
  const row = await database
    .prepare(`${BUYER_REFUND_OWNER_ASSIGNMENT_QUERY} WHERE buyer.id=?`)
    .bind(buyerCustomerId)
    .first<BuyerRefundOwnerAssignmentRow>();
  if (!row) throw new StaffAccessManagementError('NOT_FOUND', 404);
  return projectBuyerRefundOwnerAssignment(row);
}

function employeeQuery(database: SqlDatabase, where: string, bindings: unknown[]) {
  return database
    .prepare(
      `SELECT staff.id AS staff_id,staff.display_name,staff.status,staff.version,staff.updated_at,
      (SELECT role.role_code FROM staff_role_assignments role WHERE role.staff_id=staff.id AND role.status='ACTIVE' ORDER BY role.role_code LIMIT 1) AS role_code,
      (SELECT COUNT(*) FROM staff_role_assignments role WHERE role.staff_id=staff.id AND role.status='ACTIVE') AS active_role_count,
      (SELECT identity.normalized_email FROM staff_email_identities identity WHERE identity.staff_id=staff.id AND identity.status='ACTIVE' LIMIT 1) AS email,
      (SELECT identity.last_login_at FROM staff_email_identities identity WHERE identity.staff_id=staff.id AND identity.status='ACTIVE' LIMIT 1) AS last_login_at,
      (SELECT group_concat(scope.marketplace_code,',') FROM staff_marketplace_scopes scope WHERE scope.staff_id=staff.id AND scope.status='ACTIVE') AS marketplace_codes,
      (SELECT group_concat(scope.marketplace_code||':'||scope.scope_kind,',') FROM staff_marketplace_scopes scope WHERE scope.staff_id=staff.id AND scope.status='ACTIVE') AS marketplace_scopes
    FROM staff_users staff WHERE ${where}
    ORDER BY CASE staff.status WHEN 'ACTIVE' THEN 0 ELSE 1 END,staff.display_name,staff.id LIMIT 200`,
    )
    .bind(...bindings);
}
function projectEmployee(row: EmployeeRow): StaffAccessEmployeeDto {
  if (
    (row.status !== 'ACTIVE' && row.status !== 'DISABLED') ||
    Number(row.active_role_count) !== 1 ||
    !isStaffRoleCode(row.role_code)
  )
    throw new StaffAccessManagementError('DEPENDENCY_UNAVAILABLE', 503);
  const markets = (row.marketplace_codes ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
  const scopes = (row.marketplace_scopes ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const [code, kind] = value.split(':');
      if (!code || (kind !== 'PRIMARY' && kind !== 'SUPPORT'))
        throw new StaffAccessManagementError('DEPENDENCY_UNAVAILABLE', 503);
      return Object.freeze({ code, scope_kind: kind });
    })
    .sort((a, b) => a.code.localeCompare(b.code));
  return Object.freeze({
    staff_id: row.staff_id,
    display_name: row.display_name,
    email: row.email,
    status: row.status,
    version: Number(row.version),
    role: Object.freeze({
      code: row.role_code,
      display_name: STAFF_ROLE_DISPLAY_NAMES[row.role_code],
    }),
    marketplace_codes: Object.freeze(row.role_code === 'owner' ? [] : markets),
    marketplace_scopes: Object.freeze(row.role_code === 'owner' ? [] : scopes),
    last_login_at: row.last_login_at === null ? null : Number(row.last_login_at),
    updated_at: Number(row.updated_at),
  });
}

function projectSellerOrganizationAssignment(
  row: SellerOrganizationAssignmentRow,
): StaffAccessSellerOrganizationAssignmentDto {
  const hasManager =
    row.assignment_id !== null ||
    row.staff_id !== null ||
    row.staff_display_name !== null ||
    row.assignment_version !== null;
  if (
    hasManager &&
    (!row.assignment_id ||
      !row.staff_id ||
      !row.staff_display_name ||
      row.assignment_version === null)
  )
    throw new StaffAccessManagementError('DEPENDENCY_UNAVAILABLE', 503);
  return Object.freeze({
    seller_organization_id: row.seller_organization_id,
    seller_organization_name: row.seller_organization_name,
    marketplace_code: row.marketplace_code,
    manager:
      row.assignment_id && row.staff_id && row.staff_display_name && row.assignment_version !== null
        ? Object.freeze({
            assignment_id: row.assignment_id,
            staff_id: row.staff_id,
            staff_display_name: row.staff_display_name,
            version: Number(row.assignment_version),
          })
        : null,
  });
}

function projectBuyerRefundOwnerAssignment(
  row: BuyerRefundOwnerAssignmentRow,
): StaffAccessBuyerRefundOwnerAssignmentDto {
  return Object.freeze({
    buyer_customer_id: row.buyer_customer_id,
    buyer_display_name: row.buyer_display_name,
    marketplace_code: row.marketplace_code,
    pre_sales_owner: projectFixedOwner(
      row.pre_sales_assignment_id,
      row.pre_sales_staff_id,
      row.pre_sales_staff_display_name,
      row.pre_sales_assignment_version,
    ),
    refund_owner: projectFixedOwner(
      row.refund_assignment_id,
      row.refund_staff_id,
      row.refund_staff_display_name,
      row.refund_assignment_version,
    ),
  });
}

function projectFixedOwner(
  assignmentId: string | null,
  staffId: string | null,
  staffDisplayName: string | null,
  version: number | null,
) {
  const present =
    assignmentId !== null || staffId !== null
    || staffDisplayName !== null || version !== null;
  if (present && (!assignmentId || !staffId || !staffDisplayName || version === null)) {
    throw new StaffAccessManagementError('DEPENDENCY_UNAVAILABLE', 503);
  }
  return assignmentId && staffId && staffDisplayName && version !== null
    ? Object.freeze({
        assignment_id: assignmentId,
        staff_id: staffId,
        staff_display_name: staffDisplayName,
        version: Number(version),
      })
    : null;
}
