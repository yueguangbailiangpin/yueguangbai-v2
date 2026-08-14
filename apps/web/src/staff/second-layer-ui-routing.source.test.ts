import { existsSync,readFileSync } from 'node:fs';
import path from 'node:path';
import { describe,expect,it } from 'vitest';

const root=path.resolve(import.meta.dirname,'../../../..');
const read=(file:string)=>readFileSync(path.join(root,file),'utf8');

describe('second layer active UI routing',()=>{
  it('keeps the mature Seller portal directly active while presenting JP-local time',()=>{
    const seller=read('apps/web/src/seller/pages/SellerPages.tsx');
    expect(seller).toContain("timeZone: 'Asia/Tokyo'");
    expect(seller).toContain('（日本时间）');
    expect(seller).toContain('withdrawApplication');
    expect(seller).toContain('withdrawDemand');
    expect(seller).toContain('SellerOrderChatScreenshotReadIntentAdapter');
    expect(seller).toContain('sellerQueryKeys.payablesPage');
    expect(seller).not.toContain("timeZone: 'Asia/Shanghai'");
    expect(existsSync(path.join(root,'apps/web/src/seller/pages/SellerPages.ts'))).toBe(false);
    expect(existsSync(path.join(root,'apps/apps'))).toBe(false);
  });

  it('uses the direct ledger-safe Staff integrity tool with advance payment proof',()=>{
    const implementation=read('apps/web/src/staff/StaffOperatingIntegrityTools.tsx');
    expect(implementation).toContain('PROJECTED_GROSS_PROFIT');
    expect(implementation).toContain('COMPLETED_GROSS_PROFIT');
    expect(implementation).toContain("uploader.start('staffBuyerRefundProof'");
    expect(implementation).toContain('proof_files');
    expect(implementation).toContain('本次全额付款');
    expect(implementation).toContain('整笔冲正提前返本金');
    expect(implementation).not.toContain('name="amount_cny_fen"');
    expect(implementation).not.toContain('<option value="SELLER_PRINCIPAL_DUE">');
    expect(implementation).not.toContain('<option value="SELLER_SERVICE_FEE_DUE">');
    expect(implementation).not.toContain('<option value="BUYER_REFUND_DUE">');
    expect(existsSync(path.join(root,'apps/web/src/staff/StaffOperatingIntegrityTools.ts'))).toBe(false);
  });
});
