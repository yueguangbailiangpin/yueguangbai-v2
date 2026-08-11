import type { SqlDatabase } from '@ygb/contracts';
import type { AssignmentStaffAuthorization } from '../staff-assignment';
import { resolveStaffMarketplaceCodes } from '../staff-assignment/data-scope';
import { SellerRegistrationError } from './service';

interface Row{
  id:string;wechat_display:string;marketplace_code:string;seller_organization_id:string;seller_member_id:string|null;
  onboarding_kind:'NEW_CUSTOMER'|'HISTORICAL_ACCOUNT_ONLY';issued_by_staff_id:string;
  status:'ACTIVE'|'CONSUMED'|'REVOKED'|'EXPIRED';version:number;issued_at:number;expires_at:number;consumed_at:number|null;revoked_at:number|null;
}

export async function readCurrentSellerInvitation(
  database:SqlDatabase,
  actor:AssignmentStaffAuthorization,
  input:{sellerOrganizationId:string|null;leadId:string|null},
  now=Date.now(),
){
  if(!actor.roles.has('owner')&&!actor.roles.has('seller_ops'))throw new SellerRegistrationError('FORBIDDEN',403);
  const hasOrg=Boolean(input.sellerOrganizationId?.trim()),hasLead=Boolean(input.leadId?.trim());
  if(hasOrg===hasLead)throw new SellerRegistrationError('VALIDATION_ERROR',400);
  const clause=hasOrg?'invitation.seller_organization_id=?':'invitation.acquisition_lead_id=?';
  const value=(hasOrg?input.sellerOrganizationId:input.leadId)!.normalize('NFKC').trim();
  const row=await database.prepare(`SELECT invitation.id,invitation.wechat_display,invitation.marketplace_code,
      invitation.seller_organization_id,invitation.seller_member_id,invitation.onboarding_kind,
      invitation.issued_by_staff_id,invitation.status,invitation.version,invitation.issued_at,
      invitation.expires_at,invitation.consumed_at,invitation.revoked_at
    FROM customer_seller_invitations invitation
    WHERE ${clause}
    ORDER BY invitation.issued_at DESC,invitation.id DESC LIMIT 1`).bind(value).first<Row>();
  if(!row)return null;
  if(!actor.roles.has('owner')){
    const markets=await resolveStaffMarketplaceCodes(database,actor);
    if(!markets.includes(row.marketplace_code))throw new SellerRegistrationError('NOT_FOUND',404);
  }
  const status=row.status==='ACTIVE'&&row.expires_at<=now?'EXPIRED':row.status;
  return Object.freeze({
    invitation_id:row.id,wechat_id:row.wechat_display,marketplace_code:row.marketplace_code,
    seller_organization_id:row.seller_organization_id,seller_member_id:row.seller_member_id,
    onboarding_kind:row.onboarding_kind,issued_by_staff_id:row.issued_by_staff_id,
    status,version:Number(row.version),issued_at:Number(row.issued_at),expires_at:Number(row.expires_at),
    consumed_at:row.consumed_at===null?null:Number(row.consumed_at),revoked_at:row.revoked_at===null?null:Number(row.revoked_at),
    registration_link_recoverable:false as const,
  });
}
