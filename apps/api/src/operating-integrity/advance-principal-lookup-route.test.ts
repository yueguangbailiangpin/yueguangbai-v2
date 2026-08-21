import { describe, expect, it } from 'vitest';
import type { StaffRoleCode } from '@ygb/contracts';
import { advancePrincipalFinancialsForActor } from './advance-principal-lookup-route';

function actor(role: StaffRoleCode) {
  return { roles: new Set<StaffRoleCode>([role]) };
}

describe('advance principal lookup financial projection', () => {
  const value = {
    has_refund_obligation: 1,
    advance_full_amount_cny_fen: '48840',
    advance_net_cny_fen: '20000',
    active_advance_payment_id: 'advance-payment-1',
  };

  it('returns refund financial facts only to owner and buyer refund roles', () => {
    expect(advancePrincipalFinancialsForActor(actor('owner'), value)).toEqual({
      has_refund_obligation: true,
      advance_full_amount_cny_fen: '48840',
      advance_net_cny_fen: '20000',
      active_advance_payment_id: 'advance-payment-1',
    });
    expect(advancePrincipalFinancialsForActor(actor('buyer_refund'), value)).toEqual({
      has_refund_obligation: true,
      advance_full_amount_cny_fen: '48840',
      advance_net_cny_fen: '20000',
      active_advance_payment_id: 'advance-payment-1',
    });
  });

  it('redacts refund financial facts from pre-sales and seller operations', () => {
    expect(advancePrincipalFinancialsForActor(actor('pre_sales'), value)).toEqual({
      has_refund_obligation: null,
      advance_full_amount_cny_fen: null,
      advance_net_cny_fen: null,
      active_advance_payment_id: null,
    });
    expect(advancePrincipalFinancialsForActor(actor('seller_ops'), value)).toEqual({
      has_refund_obligation: null,
      advance_full_amount_cny_fen: null,
      advance_net_cny_fen: null,
      active_advance_payment_id: null,
    });
  });
});
