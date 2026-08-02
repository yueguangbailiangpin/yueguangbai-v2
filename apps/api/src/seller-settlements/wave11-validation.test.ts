import { describe, expect, it } from 'vitest';
import type { FileActor, SqlDatabase } from '@ygb/contracts';
import type { FileAuthorizationResource } from '../files/authorization';
import {
  recordSellerPayment,
  validateSellerSettlementProofFile,
} from './record-payment';
import type { SellerSettlementProofFileRow } from './records';
import {
  cleanPositiveCnyFen,
  cleanSettlementReason,
  cleanSettlementTimestamp,
  sellerSettlementFileAuthorization,
  SellerSettlementError,
} from './shared';

const staffActor: FileActor = Object.freeze({
  type: 'STAFF',
  id: 'staff-1',
  roles: Object.freeze(['seller_ops']),
});

function proofResource(
  ownerActorType: string,
  ownerActorId: string,
  purpose: FileAuthorizationResource['purpose'] = 'SELLER_SETTLEMENT_PROOF',
): FileAuthorizationResource {
  return {
    uploadIntentId: 'intent-1',
    fileObjectId: 'proof-1',
    ownerActorType,
    ownerActorId,
    purpose,
    visibility: 'INTERNAL_ONLY',
    entityType: 'SELLER_SETTLEMENT',
    entityId: 'payment-1',
  };
}

function proofFile(
  ownerActorType: string,
  ownerActorId: string,
  overrides: Partial<SellerSettlementProofFileRow> = {},
): SellerSettlementProofFileRow {
  return {
    id: 'proof-1',
    upload_intent_id: 'intent-1',
    status: 'VERIFIED',
    version: 1,
    purpose: 'SELLER_SETTLEMENT_PROOF',
    visibility: 'INTERNAL_ONLY',
    detected_mime: 'image/png',
    declared_mime: 'image/png',
    intent_status: 'VERIFIED',
    intent_purpose: 'SELLER_SETTLEMENT_PROOF',
    intent_visibility: 'INTERNAL_ONLY',
    owner_actor_type: ownerActorType,
    owner_actor_id: ownerActorId,
    ...overrides,
  };
}

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

  it('accepts the current Staff-owned VERIFIED proof for payment recording', () => {
    expect(() => validateSellerSettlementProofFile(
      proofFile('STAFF', 'staff-1'),
      1,
      'staff-1',
    )).not.toThrow();
  });

  it('accepts a trusted persisted SYSTEM-owned VERIFIED proof', () => {
    expect(() => validateSellerSettlementProofFile(
      proofFile('SYSTEM', 'trusted-settlement-importer'),
      1,
      'staff-1',
    )).not.toThrow();
  });

  it('rejects other Staff, Buyer, Seller, wrong purpose and unverified proofs', () => {
    for (const file of [
      proofFile('STAFF', 'staff-2'),
      proofFile('BUYER_CUSTOMER', 'buyer-1'),
      proofFile('SELLER_MEMBER', 'seller-member-1'),
      proofFile('STAFF', 'staff-1', { purpose: 'SUPPORT_ATTACHMENT' }),
      proofFile('SYSTEM', 'trusted-settlement-importer', {
        status: 'UPLOADED',
      }),
    ]) {
      expect(() => validateSellerSettlementProofFile(
        file,
        1,
        'staff-1',
      )).toThrow(SellerSettlementError);
    }
  });

  it('allows the current Staff-owned proof to upload, complete and link', () => {
    const resource = proofResource('STAFF', 'staff-1');
    expect(() => sellerSettlementFileAuthorization.assertCanCreateUpload(
      staffActor,
      { purpose: 'SELLER_SETTLEMENT_PROOF', visibility: 'INTERNAL_ONLY' },
    )).not.toThrow();
    expect(() => sellerSettlementFileAuthorization.assertCanUpload(
      staffActor,
      resource,
    )).not.toThrow();
    expect(() => sellerSettlementFileAuthorization.assertCanCompleteUpload(
      staffActor,
      resource,
    )).not.toThrow();
    expect(() => sellerSettlementFileAuthorization.assertCanLink(
      staffActor,
      resource,
    )).not.toThrow();
  });

  it('allows a trusted persisted SYSTEM proof to be linked by Staff', () => {
    expect(() => sellerSettlementFileAuthorization.assertCanLink(
      staffActor,
      proofResource('SYSTEM', 'trusted-settlement-importer'),
    )).not.toThrow();
  });

  it('does not let a client actor create or upload as SYSTEM', () => {
    expect(() => sellerSettlementFileAuthorization.assertCanCreateUpload(
      { type: 'SYSTEM', id: 'fake-client-system', roles: [] },
      { purpose: 'SELLER_SETTLEMENT_PROOF', visibility: 'INTERNAL_ONLY' },
    )).toThrow('FORBIDDEN');
    expect(() => sellerSettlementFileAuthorization.assertCanUpload(
      staffActor,
      proofResource('SYSTEM', 'trusted-settlement-importer'),
    )).toThrow('FORBIDDEN');
  });

  it('rejects another Staff, Buyer, Seller and non-proof ownership', () => {
    for (const resource of [
      proofResource('STAFF', 'staff-2'),
      proofResource('BUYER_CUSTOMER', 'buyer-1'),
      proofResource('SELLER_MEMBER', 'seller-member-1'),
      proofResource('STAFF', 'staff-1', 'SUPPORT_ATTACHMENT'),
    ]) {
      expect(() => sellerSettlementFileAuthorization.assertCanLink(
        staffActor,
        resource,
      )).toThrow('FORBIDDEN');
    }
  });

  it('keeps every settlement proof unreadable through legacy authorization', () => {
    expect(() => sellerSettlementFileAuthorization.assertCanRead(
      staffActor,
      proofResource('STAFF', 'staff-1'),
    )).toThrow('FORBIDDEN');
    expect(() => sellerSettlementFileAuthorization.assertCanRead(
      { type: 'BUYER_CUSTOMER', id: 'buyer-1', roles: [] },
      proofResource('SYSTEM', 'trusted-settlement-importer'),
    )).toThrow('FORBIDDEN');
    expect(() => sellerSettlementFileAuthorization.assertCanRead(
      { type: 'SELLER_MEMBER', id: 'member-1', roles: [] },
      proofResource('SYSTEM', 'trusted-settlement-importer'),
    )).toThrow('FORBIDDEN');
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
      memberTeamIds: [] as string[],
      leaderTeamIds: [] as string[],
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