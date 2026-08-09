import {
  STAFF_ROLE_DISPLAY_NAMES,
  isStaffRoleCode,
  type SqlDatabase,
  type StaffAccessEmployeeDto,
  type StaffAccessManagementOverviewDto,
  type StaffAccessTeamOptionDto,
  type StaffBindingInvitationDto,
} from '@ygb/contracts';
import { StaffAccessManagementError } from './errors';

interface EmployeeRow {
  staff_id: string;
  display_name: string;
  status: string;
  version: number;
  role_code: string | null;
  active_role_count: number;
  active_identity_count: number;
  identity_count: number;
  verified_at: number | null;
  updated_at: number;
}

interface InvitationRow {
  invitation_id: string;
  display_name: string;
  role_code: string;
  team_id: string | null;
  team_name: string | null;
  department_name: string | null;
  status: string;
  version: number;
  issued_at: number;
  expires_at: number;
  consumed_at: number | null;
  cancelled_at: number | null;
}

interface TeamRow {
  team_id: string;
  team_name: string;
  department_name: string;
}

export async function readStaffAccessManagementOverview(
  database: SqlDatabase,
  now = Date.now(),
): Promise<StaffAccessManagementOverviewDto> {
  const [employees, invitations, teams] = await Promise.all([
    database.prepare(`
      SELECT staff.id AS staff_id,staff.display_name,staff.status,
        staff.version,staff.updated_at,
        (SELECT role.role_code FROM staff_role_assignments role
          WHERE role.staff_id=staff.id AND role.status='ACTIVE'
          ORDER BY role.role_code LIMIT 1) AS role_code,
        (SELECT COUNT(*) FROM staff_role_assignments role
          WHERE role.staff_id=staff.id AND role.status='ACTIVE')
          AS active_role_count,
        (SELECT COUNT(*) FROM feishu_staff_identities identity
          WHERE identity.staff_id=staff.id AND identity.status='ACTIVE')
          AS active_identity_count,
        (SELECT COUNT(*) FROM feishu_staff_identities identity
          WHERE identity.staff_id=staff.id) AS identity_count,
        (SELECT MAX(identity.verified_at) FROM feishu_staff_identities identity
          WHERE identity.staff_id=staff.id AND identity.status='ACTIVE')
          AS verified_at
      FROM staff_users staff
      ORDER BY CASE staff.status WHEN 'ACTIVE' THEN 0 ELSE 1 END,
        staff.display_name,staff.id
      LIMIT 200
    `).all<EmployeeRow>(),
    database.prepare(`
      SELECT invitation.id AS invitation_id,invitation.display_name,
        invitation.role_code,invitation.team_id,team.name AS team_name,
        department.name AS department_name,invitation.status,invitation.version,
        invitation.created_at AS issued_at,invitation.expires_at,
        invitation.consumed_at,invitation.cancelled_at
      FROM staff_binding_invitations invitation
      LEFT JOIN staff_teams team ON team.id=invitation.team_id
      LEFT JOIN staff_departments department ON department.id=team.department_id
      WHERE invitation.status='ISSUED' AND invitation.expires_at>?
      ORDER BY CASE invitation.status WHEN 'ISSUED' THEN 0 ELSE 1 END,
        invitation.created_at DESC,invitation.id DESC
      LIMIT 200
    `).bind(now).all<InvitationRow>(),
    database.prepare(`
      SELECT team.id AS team_id,team.name AS team_name,
        department.name AS department_name
      FROM staff_teams team
      JOIN staff_departments department ON department.id=team.department_id
      WHERE team.status='ACTIVE' AND department.status='ACTIVE'
      ORDER BY department.name,team.name,team.id
      LIMIT 200
    `).all<TeamRow>(),
  ]);
  return Object.freeze({
    employees: Object.freeze(employees.results.map(projectEmployee)),
    invitations: Object.freeze(invitations.results.map((row) =>
      projectInvitation(row, now))),
    available_teams: Object.freeze(teams.results.map(projectTeam)),
  });
}

export async function readStaffAccessEmployee(
  database: SqlDatabase,
  staffId: string,
): Promise<StaffAccessEmployeeDto> {
  const result = await database.prepare(`
    SELECT staff.id AS staff_id,staff.display_name,staff.status,
      staff.version,staff.updated_at,
      (SELECT role.role_code FROM staff_role_assignments role
        WHERE role.staff_id=staff.id AND role.status='ACTIVE'
        ORDER BY role.role_code LIMIT 1) AS role_code,
      (SELECT COUNT(*) FROM staff_role_assignments role
        WHERE role.staff_id=staff.id AND role.status='ACTIVE')
        AS active_role_count,
      (SELECT COUNT(*) FROM feishu_staff_identities identity
        WHERE identity.staff_id=staff.id AND identity.status='ACTIVE')
        AS active_identity_count,
      (SELECT COUNT(*) FROM feishu_staff_identities identity
        WHERE identity.staff_id=staff.id) AS identity_count,
      (SELECT MAX(identity.verified_at) FROM feishu_staff_identities identity
        WHERE identity.staff_id=staff.id AND identity.status='ACTIVE')
        AS verified_at
    FROM staff_users staff WHERE staff.id=?
  `).bind(staffId).first<EmployeeRow>();
  if (!result) throw new StaffAccessManagementError('NOT_FOUND', 404);
  return projectEmployee(result);
}

function projectEmployee(row: EmployeeRow): StaffAccessEmployeeDto {
  if ((row.status !== 'ACTIVE' && row.status !== 'DISABLED')
    || Number(row.active_role_count) !== 1
    || !isStaffRoleCode(row.role_code)
    || Number(row.active_identity_count) > 1) {
    throw new StaffAccessManagementError('DEPENDENCY_UNAVAILABLE', 503);
  }
  const bindingStatus = Number(row.active_identity_count) === 1
    ? 'ACTIVE' as const
    : Number(row.identity_count) > 0 ? 'REVOKED' as const : 'MISSING' as const;
  return Object.freeze({
    staff_id: row.staff_id,
    display_name: row.display_name,
    status: row.status,
    version: Number(row.version),
    role: Object.freeze({
      code: row.role_code,
      display_name: STAFF_ROLE_DISPLAY_NAMES[row.role_code],
    }),
    feishu_binding: Object.freeze({
      status: bindingStatus,
      verified_at: bindingStatus === 'ACTIVE'
        ? Number(row.verified_at)
        : null,
    }),
    updated_at: Number(row.updated_at),
  });
}

function projectTeam(row: TeamRow): StaffAccessTeamOptionDto {
  if (!row.team_id || !row.team_name || !row.department_name) {
    throw new StaffAccessManagementError('DEPENDENCY_UNAVAILABLE', 503);
  }
  return Object.freeze({
    team_id: row.team_id,
    team_name: row.team_name,
    department_name: row.department_name,
  });
}

function projectInvitation(
  row: InvitationRow,
  now: number,
): StaffBindingInvitationDto {
  if (!isStaffRoleCode(row.role_code)
    || !['ISSUED', 'CONSUMED', 'CANCELLED', 'EXPIRED'].includes(row.status)) {
    throw new StaffAccessManagementError('DEPENDENCY_UNAVAILABLE', 503);
  }
  const status = row.status === 'ISSUED' && Number(row.expires_at) <= now
    ? 'EXPIRED' as const
    : row.status as StaffBindingInvitationDto['status'];
  return Object.freeze({
    invitation_id: row.invitation_id,
    display_name: row.display_name,
    role: Object.freeze({
      code: row.role_code,
      display_name: STAFF_ROLE_DISPLAY_NAMES[row.role_code],
    }),
    team: row.team_id === null
      ? null
      : projectTeam({
          team_id: row.team_id,
          team_name: row.team_name ?? '',
          department_name: row.department_name ?? '',
        }),
    status,
    version: Number(row.version),
    issued_at: Number(row.issued_at),
    expires_at: Number(row.expires_at),
    consumed_at: row.consumed_at === null ? null : Number(row.consumed_at),
    cancelled_at: row.cancelled_at === null ? null : Number(row.cancelled_at),
  });
}
