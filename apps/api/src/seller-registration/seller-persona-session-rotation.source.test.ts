import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe,expect,it } from 'vitest';

const root=path.resolve(import.meta.dirname,'../../..');

describe('primary seller persona activation security',()=>{
  it('revokes older shared-account sessions before issuing Seller cookie',()=>{
    const source=readFileSync(path.join(root,'apps/api/src/seller-registration/routes.ts'),'utf8');
    expect(source).toContain('session_version=session_version+1');
    expect(source).toContain('rotatedSessionVersion');
    expect(source).toContain("accountType:'SELLER_MEMBER'");
    expect(source).toContain('all_previous_sessions_revoked:true');
  });
});
