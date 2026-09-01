import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe,expect,it } from 'vitest';

const root=path.resolve(import.meta.dirname,'../../../..');
const read=(file:string)=>readFileSync(path.join(root,file),'utf8');

describe('customer persona privilege activation security',()=>{
  it('bumps session version atomically and refreshes only the current invitation response cookie',()=>{
    // Privilege guard triggers re-anchored on the stage 3 clean baseline.
const migration=read('migrations/0002_staff_identity_permissions.sql')+read('migrations/0003_customer_master_data.sql');
    expect(migration).toContain('trg_customer_persona_privilege_session_bump');
    expect(migration).toContain('session_version=session_version+1');
    const middleware=read('apps/api/src/seller-portal/member-privilege-session-rotation.ts');
    expect(middleware).toContain("install(app,'/api/buyer-auth/register')");
    expect(middleware).toContain("install(app,'/api/seller-auth/register')");
    expect(middleware).toContain("install(app,'/api/seller-auth/member-register')");
    expect(middleware).toContain('SELECT id,identity_subject_id,session_version');
    expect(middleware).toContain('writeCustomerSessionCookie');
    expect(middleware).not.toContain('SET session_version=session_version+1');
    const app=read('apps/api/src/app.ts');
    expect(app).toContain('installSellerMemberPrivilegeSessionRotation(app)');
  });
});
