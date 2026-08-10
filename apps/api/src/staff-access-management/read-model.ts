import {
  STAFF_ROLE_DISPLAY_NAMES,
  isStaffRoleCode,
  type SqlDatabase,
  type StaffAccessEmployeeDto,
  type StaffAccessManagementOverviewDto,
} from '@ygb/contracts';
import { StaffAccessManagementError } from './errors';

interface EmployeeRow {
  staff_id:string; display_name:string; status:string; version:number;
  role_code:string|null; active_role_count:number; email:string|null;
  last_login_at:number|null; marketplace_codes:string|null; updated_at:number;
}
interface MarketplaceRow { code:string; display_name_zh:string; status:'ACTIVE'|'DISABLED' }

export async function readStaffAccessManagementOverview(
  database:SqlDatabase,
):Promise<StaffAccessManagementOverviewDto>{
  const [employees,markets]=await Promise.all([
    employeeQuery(database,'1=1',[]).all<EmployeeRow>(),
    database.prepare(`SELECT code,display_name_zh,status FROM marketplace_registry ORDER BY
      CASE code WHEN 'AMAZON_JP' THEN 0 WHEN 'AMAZON_US' THEN 1 WHEN 'COUPANG_KR' THEN 2 ELSE 3 END,
      display_name_zh,code`).all<MarketplaceRow>(),
  ]);
  return Object.freeze({
    employees:Object.freeze(employees.results.map(projectEmployee)),
    available_marketplaces:Object.freeze(markets.results.map((row)=>Object.freeze({
      code:row.code,display_name:row.display_name_zh,status:row.status,
    }))),
  });
}

export async function readStaffAccessEmployee(database:SqlDatabase,staffId:string):Promise<StaffAccessEmployeeDto>{
  const row=await employeeQuery(database,'staff.id=?',[staffId]).first<EmployeeRow>();
  if(!row)throw new StaffAccessManagementError('NOT_FOUND',404);
  return projectEmployee(row);
}

function employeeQuery(database:SqlDatabase,where:string,bindings:unknown[]){
  return database.prepare(`
    SELECT staff.id AS staff_id,staff.display_name,staff.status,staff.version,staff.updated_at,
      (SELECT role.role_code FROM staff_role_assignments role
        WHERE role.staff_id=staff.id AND role.status='ACTIVE' ORDER BY role.role_code LIMIT 1) AS role_code,
      (SELECT COUNT(*) FROM staff_role_assignments role
        WHERE role.staff_id=staff.id AND role.status='ACTIVE') AS active_role_count,
      (SELECT identity.normalized_email FROM staff_email_identities identity
        WHERE identity.staff_id=staff.id AND identity.status='ACTIVE' LIMIT 1) AS email,
      (SELECT identity.last_login_at FROM staff_email_identities identity
        WHERE identity.staff_id=staff.id AND identity.status='ACTIVE' LIMIT 1) AS last_login_at,
      (SELECT group_concat(scope.marketplace_code,',') FROM staff_marketplace_scopes scope
        WHERE scope.staff_id=staff.id AND scope.status='ACTIVE') AS marketplace_codes
    FROM staff_users staff WHERE ${where}
    ORDER BY CASE staff.status WHEN 'ACTIVE' THEN 0 ELSE 1 END,staff.display_name,staff.id
    LIMIT 200
  `).bind(...bindings);
}

function projectEmployee(row:EmployeeRow):StaffAccessEmployeeDto{
  if((row.status!=='ACTIVE'&&row.status!=='DISABLED')
    ||Number(row.active_role_count)!==1||!isStaffRoleCode(row.role_code)){
    throw new StaffAccessManagementError('DEPENDENCY_UNAVAILABLE',503);
  }
  const markets=(row.marketplace_codes??'').split(',').map((value)=>value.trim()).filter(Boolean).sort();
  return Object.freeze({
    staff_id:row.staff_id,display_name:row.display_name,email:row.email,
    status:row.status,version:Number(row.version),
    role:Object.freeze({code:row.role_code,display_name:STAFF_ROLE_DISPLAY_NAMES[row.role_code]}),
    marketplace_codes:Object.freeze(row.role_code==='owner'?[]:markets),
    last_login_at:row.last_login_at===null?null:Number(row.last_login_at),
    updated_at:Number(row.updated_at),
  });
}
