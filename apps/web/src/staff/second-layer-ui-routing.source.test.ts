import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe,expect,it } from 'vitest';

const root=path.resolve(import.meta.dirname,'../../..');
const read=(file:string)=>readFileSync(path.join(root,file),'utf8');

describe('second layer active UI routing',()=>{
  it('routes extensionless SellerPages imports through the marketplace-local implementation',()=>{
    const entry=read('apps/web/src/seller/pages/SellerPages.ts');
    expect(entry).toContain("from './SellerPagesMarketplace'");
    const implementation=read('apps/web/src/seller/pages/SellerPagesMarketplace.tsx');
    expect(implementation).toContain("timeZone:'Asia/Tokyo'");
    expect(implementation).toContain('（日本时间）');
    expect(implementation).not.toContain("timeZone:'Asia/Shanghai'");
  });

  it('routes integrity tools through the ledger-safe implementation',()=>{
    const entry=read('apps/web/src/staff/StaffOperatingIntegrityTools.ts');
    expect(entry).toContain("from './StaffOperatingIntegrityToolsV2'");
    const implementation=read('apps/web/src/staff/StaffOperatingIntegrityToolsV2.tsx');
    expect(implementation).toContain('PROJECTED_GROSS_PROFIT');
    expect(implementation).toContain('COMPLETED_GROSS_PROFIT');
    expect(implementation).not.toContain('<option value="SELLER_PRINCIPAL_DUE">');
    expect(implementation).not.toContain('<option value="SELLER_SERVICE_FEE_DUE">');
    expect(implementation).not.toContain('<option value="BUYER_REFUND_DUE">');
  });
});
