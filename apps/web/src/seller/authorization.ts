import type { SellerMemberRole } from '@ygb/contracts';

export function canViewSellerFinancials(role:SellerMemberRole|undefined):boolean{
  return role==='OWNER'||role==='FINANCE';
}
