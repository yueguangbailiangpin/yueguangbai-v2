import { describe, expect, it } from 'vitest';
import type { SqlDatabase } from '@ygb/contracts';
import { recordSellerPayment } from './record-payment';
import {
  cleanPositiveCnyFen,
  cleanSettlementReason,
  cleanSettlementTimestamp,
  SellerSettlementError,
} from './shared';

describe('Wave 11 seller payment command validation', () => {
  it('accepts only positive safe CNY fen integer strings', () => {
    expect(cleanPositiveCnyFen('1')).toBe(1);
    expect(cleanPositiveCnyFen(String(Number.MAX_SAFE_INTEGER)))
      .toBe(Number.MAX_SAFE_INTEGER);
    for (const value of ['0', '-1', '1.5', '01', '9007199254740992']) {
      expect(() => cleanPositiveCnyFen(value))
        .toThrow(SellerSettlementError);
    }
  });

  it('requires non-empty bounded correction reasons', () => {
    expect(cleanSettlementReason('  修正付款日期  ')).toBe('修正付款日期');
    expect(() => cleanSettlementReason('   ')).toThrow(SellerSettlementError);
    expect(() => cleanSettlementReason('a'.repeat(2001)))
      .toThrow(SellerSettlementError);
  });

  it('rejects negative and unsafe timestamps', () => {
    expect(cleanSettlementTimestamp(0)).toBe(0);
    expect(() => cleanSettlementTimestamp(-1)).toThrow(SellerSettlementError);
    expect(() => cleanSettlementTimestamp(1.1)).toThrow(SellerSettlementError);
  });

  it('rejects zero and negative payment amounts before database access', async () => {
    const database = {} as SqlDatabase;
    const actor = {
      staffId: 'staff-1',
      displayName: '财务员工',
      staffStatus: 'ACTIVE' as const,
      authorizationVersion: 1,
      roles: new Set(['owner'] as const),
      permissions: new Set([
        'SELLER_SETTLEMENT_VIEW',
        'SELLER_SETTLEMENT_RECORD',
        'FINANCIAL_CORRECT',
      ] as const),
      deniedPermissions: new Set(),
      memberTeamIds: new Set<string>(),
      leaderTeamIds: new Set<string>(),
      isOwner: true,
    };
    for (const amount of ['0', '-1']) {
      await expect(recordSellerPayment(database, {
        sellerOrganizationId: 'seller-1',
        amountCnyFen: amount,
        paidAt: 1,
        proofFile: {
          fileObjectId: 'proof-1',
          expectedFileVersion: 1,
        },
      }, {
        actor: actor as never,
        idempotencyKey: 'payment-validation-key',
        now: 2,
      })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  });
});