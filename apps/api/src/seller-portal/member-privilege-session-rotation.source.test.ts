import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe,expect,it } from 'vitest';

const root=path.resolve(import.meta.dirname,'../../..');
const read=(file:string)=>readFileSync(path.join(root,file),'utf8');

describe('seller member privilege activation security',()=>{
  it('rotates the shared account session version and replaces the current cookie',()=>{
    const middleware=read('apps/api/src/seller-portal/member-privilege-session-rotation.ts');
    expect(middleware).toContain("app.use('/api/seller-auth/member-register'");
    expect(middleware).toContain('session_version=session_version+1');
    expect(middleware).toContain("accountType:'SELLER_MEMBER'");
    expect(middleware).toContain('writeCustomerSessionCookie');
    expect(middleware).toContain('all_previous_sessions_revoked:true');
    const app=read('apps/api/src/app.ts');
    expect(app).toContain('installSellerMemberPrivilegeSessionRotation(app)');
  });
});
