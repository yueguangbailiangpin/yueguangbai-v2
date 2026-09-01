import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe,expect,it } from 'vitest';

const root=path.resolve(import.meta.dirname,'../../../..');
const read=(file:string)=>readFileSync(path.join(root,file),'utf8');

describe('primary seller persona activation security',()=>{
  it('uses the same atomic persona session bump as seller team members',()=>{
    const service=read('apps/api/src/seller-registration/service.ts');
    expect(service).toContain("persona_type,buyer_customer_id,seller_member_id");
    // Privilege guard triggers re-anchored on the stage 3 clean baseline.
const migration=read('migrations/0002_staff_identity_permissions.sql')+read('migrations/0003_customer_master_data.sql');
    expect(migration).toContain('trg_customer_persona_privilege_session_bump');
    expect(migration).toContain('session_version=session_version+1');
    const refresh=read('apps/api/src/seller-portal/member-privilege-session-rotation.ts');
    expect(refresh).toContain("install(app,'/api/seller-auth/register')");
    expect(refresh).toContain("accountType=path==='/api/buyer-auth/register'?'BUYER' as const:'SELLER_MEMBER' as const");
  });
});
