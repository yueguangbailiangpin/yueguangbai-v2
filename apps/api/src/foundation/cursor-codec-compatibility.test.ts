import { describe, expect, it } from 'vitest';
import {
  decodeDemandCursor,
  encodeDemandCursor,
  decodeReservationCursor,
  encodeReservationCursor,
} from '../buyer-portal/pagination';
import {
  decodeEligibleReservationCursor,
  decodeOrderEvidenceCursor,
  encodeEligibleReservationCursor,
  encodeOrderEvidenceCursor,
} from '../buyer-order-evidence-portal/pagination';
import {
  decodeBuyerFormalOrderCursor,
  encodeBuyerFormalOrderCursor,
} from '../buyer-formal-orders/pagination';
import {
  decodeBuyerRefundPortalCursor,
  encodeBuyerRefundPortalCursor,
} from '../buyer-refund-status/pagination';
import {
  decodeBuyerReviewCursor,
  decodeEligibleReviewOrderCursor,
  encodeBuyerReviewCursor,
  encodeEligibleReviewOrderCursor,
} from '../buyer-reviews/pagination';
import { decodeSellerPortalCursor, encodeSellerPortalCursor } from '../seller-portal/pagination';
import {
  decodeStaffWorkItemCursor,
  encodeStaffWorkItemCursor,
} from '../staff-assignment/pagination';
import {
  decodeScheduleCursor,
  encodeScheduleCursor,
} from '../product-reservation-scheduling/shared';
import {
  decodeCursor as decodeStaffEvidenceCursor,
  encodeCursor as encodeStaffEvidenceCursor,
} from '../order-evidence/staff-routes';
import {
  decodeCursor as decodeStaffRefundCursor,
  encodeCursor as encodeStaffRefundCursor,
} from '../buyer-refunds/staff-routes';
import {
  decodeCursor as decodeStaffOrderCursor,
  encodeCursor as encodeStaffOrderCursor,
} from '../staff-order-detail/routes';
import {
  decodeCursor as decodeSettlementBatchCursor,
  decodeMemberCursor as decodeSettlementMemberCursor,
  encodeCursor as encodeSettlementBatchCursor,
  encodeMemberCursor as encodeSettlementMemberCursor,
} from '../seller-settlements/batches';
import { encodeBase64UrlJson } from './cursor-codec';

describe('cursor codec compatibility fixtures', () => {
  it('keeps legacy buyer portal cursor tokens byte-compatible', () => {
    const demand = {
      reservationDeadline: 1_700_000_000_000,
      submittedAt: 1_700_000_000_100,
      id: 'demand-1',
    };
    const demandToken =
      'eyJrIjoiZGVtYW5kIiwicmVzZXJ2YXRpb25fZGVhZGxpbmUiOjE3MDAwMDAwMDAwMDAsInN1Ym1pdHRlZF9hdCI6MTcwMDAwMDAwMDEwMCwiaWQiOiJkZW1hbmQtMSJ9';
    expect(decodeDemandCursor(demandToken)).toEqual(demand);
    expect(encodeDemandCursor(demand)).toBe(demandToken);

    const reservation = {
      submittedAt: 1_700_000_000_100,
      id: 'reservation-1',
    };
    const reservationToken =
      'eyJrIjoicmVzZXJ2YXRpb24iLCJzdWJtaXR0ZWRfYXQiOjE3MDAwMDAwMDAxMDAsImlkIjoicmVzZXJ2YXRpb24tMSJ9';
    expect(decodeReservationCursor(reservationToken)).toEqual(reservation);
    expect(encodeReservationCursor(reservation)).toBe(reservationToken);
  });

  it('keeps legacy buyer order-evidence cursor tokens byte-compatible', () => {
    const eligible = {
      orderDeadline: 1_700_000_000_200,
      submittedAt: 1_700_000_000_100,
      id: 'demand-1',
    };
    const eligibleToken =
      'eyJrIjoiYnV5ZXItb3JkZXItZXZpZGVuY2UtZWxpZ2libGUiLCJvcmRlcl9kZWFkbGluZSI6MTcwMDAwMDAwMDIwMCwic3VibWl0dGVkX2F0IjoxNzAwMDAwMDAwMTAwLCJpZCI6ImRlbWFuZC0xIn0';
    expect(decodeEligibleReservationCursor(eligibleToken)).toEqual(eligible);
    expect(encodeEligibleReservationCursor(eligible)).toBe(eligibleToken);

    const evidence = { updatedAt: 1_700_000_000_300, id: 'evidence-1' };
    const evidenceToken =
      'eyJrIjoiYnV5ZXItb3JkZXItZXZpZGVuY2UiLCJ1cGRhdGVkX2F0IjoxNzAwMDAwMDAwMzAwLCJpZCI6ImV2aWRlbmNlLTEifQ';
    expect(decodeOrderEvidenceCursor(evidenceToken)).toEqual(evidence);
    expect(encodeOrderEvidenceCursor(evidence)).toBe(evidenceToken);
  });

  it('keeps versioned UTF-8 JSON cursor tokens byte-compatible', () => {
    const formalOrder = { confirmedAt: 1_700_000_000_400, id: 'formal-order-1' };
    const formalOrderToken =
      'eyJ2IjoxLCJjb25maXJtZWRfYXQiOjE3MDAwMDAwMDA0MDAsImlkIjoiZm9ybWFsLW9yZGVyLTEifQ';
    expect(decodeBuyerFormalOrderCursor(formalOrderToken)).toEqual(formalOrder);
    expect(encodeBuyerFormalOrderCursor(formalOrder)).toBe(formalOrderToken);

    const refund = { updatedAt: 1_700_000_000_500, id: 'refund-1' };
    const refundToken =
      'eyJ2IjoxLCJraW5kIjoiYnV5ZXItcmVmdW5kIiwiYXQiOjE3MDAwMDAwMDA1MDAsImlkIjoicmVmdW5kLTEifQ';
    expect(decodeBuyerRefundPortalCursor(refundToken)).toEqual(refund);
    expect(encodeBuyerRefundPortalCursor(refund)).toBe(refundToken);

    const eligibleReview = { confirmedAt: 1_700_000_000_600, id: 'formal-order-2' };
    const eligibleReviewToken =
      'eyJ2IjoxLCJraW5kIjoiZWxpZ2libGUtb3JkZXIiLCJhdCI6MTcwMDAwMDAwMDYwMCwiaWQiOiJmb3JtYWwtb3JkZXItMiJ9';
    expect(decodeEligibleReviewOrderCursor(eligibleReviewToken)).toEqual(eligibleReview);
    expect(encodeEligibleReviewOrderCursor(eligibleReview)).toBe(eligibleReviewToken);

    const review = { updatedAt: 1_700_000_000_700, id: 'review-1' };
    const reviewToken =
      'eyJ2IjoxLCJraW5kIjoicmV2aWV3IiwiYXQiOjE3MDAwMDAwMDA3MDAsImlkIjoicmV2aWV3LTEifQ';
    expect(decodeBuyerReviewCursor(reviewToken)).toEqual(review);
    expect(encodeBuyerReviewCursor(review)).toBe(reviewToken);
  });

  it('keeps generic seller and typed staff cursor tokens compatible', () => {
    const seller = { confirmed_at: 1_700_000_000_400, formal_order_id: 'formal-order-1' };
    const sellerToken =
      'eyJjb25maXJtZWRfYXQiOjE3MDAwMDAwMDA0MDAsImZvcm1hbF9vcmRlcl9pZCI6ImZvcm1hbC1vcmRlci0xIn0';
    const sellerGuard = (value: unknown): value is typeof seller => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const record = value as Record<string, unknown>;
      return (
        typeof record['confirmed_at'] === 'number' && typeof record['formal_order_id'] === 'string'
      );
    };
    expect(decodeSellerPortalCursor(sellerToken, sellerGuard)).toEqual(seller);
    expect(encodeSellerPortalCursor(seller)).toBe(sellerToken);

    const staff = {
      createdAt: 1_700_000_000_800,
      id: 'work-1',
      status: 'OPEN' as const,
      workType: 'ORDER_EVIDENCE_REVIEW' as const,
    };
    const staffToken =
      'eyJ2IjoxLCJraW5kIjoic3RhZmYtd29yay1pdGVtIiwiYXQiOjE3MDAwMDAwMDA4MDAsImlkIjoid29yay0xIiwic3RhdHVzIjoiT1BFTiIsIndvcmtfdHlwZSI6Ik9SREVSX0VWSURFTkNFX1JFVklFVyJ9';
    expect(
      decodeStaffWorkItemCursor(staffToken, {
        status: 'OPEN',
        workType: 'ORDER_EVIDENCE_REVIEW',
      }),
    ).toEqual(staff);
    expect(encodeStaffWorkItemCursor(staff)).toBe(staffToken);
  });

  it('keeps scheduling cursor tokens compatible by kind', () => {
    const cursor = { at: 1_700_000_000_900, id: 'product-1' };
    const token =
      'eyJ2IjoxLCJraW5kIjoicHJvZHVjdCIsImF0IjoxNzAwMDAwMDAwOTAwLCJpZCI6InByb2R1Y3QtMSJ9';
    expect(decodeScheduleCursor('product', token)).toEqual(cursor);
    expect(encodeScheduleCursor('product', cursor)).toBe(token);
  });

  it('keeps staff and settlement route cursor tokens compatible', () => {
    const evidenceToken =
      'eyJ2IjoxLCJzdWJtaXR0ZWRfYXQiOjE3MDAwMDAwMDAxMDAsImlkIjoiZXZpZGVuY2UtMSJ9';
    const evidence = { submittedAt: 1_700_000_000_100, id: 'evidence-1' };
    expect(decodeStaffEvidenceCursor(evidenceToken)).toEqual(evidence);
    expect(encodeStaffEvidenceCursor(evidence.submittedAt, evidence.id)).toBe(evidenceToken);

    const refundToken =
      'eyJ2IjoyLCJyZXZpZXdfYXBwcm92ZWRfYXQiOjE3MDAwMDAwMDA1MDAsInNldHRsZWQiOjEsImlkIjoicmVmdW5kLTEifQ';
    const refund = {
      settled: 1,
      reviewApprovedAt: 1_700_000_000_500,
      id: 'refund-1',
    };
    expect(decodeStaffRefundCursor(refundToken)).toEqual(refund);
    expect(encodeStaffRefundCursor(refund.reviewApprovedAt, true, refund.id)).toBe(refundToken);

    const emptyOrderFilters = {
      amazonOrderNumberPrefix: null,
      buyerCustomerNo: null,
      sellerOrganizationId: null,
      storeId: null,
      stage: null,
      exceptionState: null,
      responsibleStaffId: null,
      confirmedFrom: null,
      confirmedTo: null,
    };
    const orderToken =
      'eyJ2IjoxLCJraW5kIjoic3RhZmYtb3JkZXItbGlzdCIsImF0IjoxNzAwMDAwMDAwNDAwLCJpZCI6Im9yZGVyLTEiLCJlY2hvIjoiW251bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsXSJ9';
    expect(decodeStaffOrderCursor(orderToken)).toEqual({
      confirmedAt: 1_700_000_000_400,
      id: 'order-1',
      echo: '[null,null,null,null,null,null,null,null,null]',
    });
    expect(encodeStaffOrderCursor(emptyOrderFilters, 1_700_000_000_400, 'order-1')).toBe(
      orderToken,
    );

    const batchToken = 'eyJhdCI6MTcwMDAwMDAwMDEwMCwiaWQiOiJiYXRjaC0xIn0';
    expect(decodeSettlementBatchCursor(batchToken)).toEqual({
      createdAt: 1_700_000_000_100,
      id: 'batch-1',
    });
    expect(encodeSettlementBatchCursor(1_700_000_000_100, 'batch-1')).toBe(batchToken);

    const memberToken = 'eyJ0IjoiUEFZQUJMRSIsIm4iOiJBTVotMSIsImlkIjoibWVtYmVyLTEifQ';
    expect(decodeSettlementMemberCursor(memberToken)).toEqual({
      type: 'PAYABLE',
      number: 'AMZ-1',
      id: 'member-1',
    });
    expect(encodeSettlementMemberCursor('PAYABLE', 'AMZ-1', 'member-1')).toBe(memberToken);
  });

  it('preserves each typed codec boundary for empty, malformed, version, and fields', () => {
    expect(decodeDemandCursor('')).toBeNull();
    expect(decodeReservationCursor('')).toBeNull();
    expect(decodeEligibleReservationCursor('')).toBeNull();
    expect(() => decodeDemandCursor(encodeBase64UrlJson({ k: 'unknown' }))).toThrow();
    expect(() => decodeEligibleReservationCursor('***')).toThrow();

    expect(() => decodeBuyerFormalOrderCursor('')).toThrow();
    expect(() =>
      decodeBuyerFormalOrderCursor(
        encodeBase64UrlJson({
          v: 2,
          confirmed_at: 1,
          id: 'formal-order-1',
        }),
      ),
    ).toThrow();
    expect(() =>
      decodeBuyerFormalOrderCursor(
        encodeBase64UrlJson({
          v: 1,
          confirmed_at: -1,
          id: 'formal-order-1',
        }),
      ),
    ).toThrow();

    expect(() => decodeBuyerRefundPortalCursor('')).toThrow();
    expect(() =>
      decodeBuyerRefundPortalCursor(
        encodeBase64UrlJson({
          v: 2,
          kind: 'buyer-refund',
          at: 1,
          id: 'refund-1',
        }),
      ),
    ).toThrow();
    expect(() => decodeBuyerReviewCursor('')).toThrow();
    expect(() =>
      decodeBuyerReviewCursor(
        encodeBase64UrlJson({
          v: 1,
          kind: 'review',
          at: -1,
          id: 'review-1',
        }),
      ),
    ).toThrow();

    const guard = (value: unknown): value is Record<string, unknown> =>
      !!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof (value as Record<string, unknown>)['confirmed_at'] === 'number' &&
      typeof (value as Record<string, unknown>)['formal_order_id'] === 'string';
    expect(() => decodeSellerPortalCursor('', guard)).toThrow();
    expect(() =>
      decodeSellerPortalCursor(
        encodeBase64UrlJson({
          confirmed_at: 1,
        }),
        guard,
      ),
    ).toThrow();
    expect(() =>
      decodeStaffWorkItemCursor('', {
        status: 'OPEN',
        workType: null,
      }),
    ).toThrow();
    expect(() =>
      decodeStaffWorkItemCursor(
        encodeBase64UrlJson({
          v: 2,
          kind: 'staff-work-item',
          at: 1,
          id: 'work-1',
          status: 'OPEN',
          work_type: null,
        }),
        { status: 'OPEN', workType: null },
      ),
    ).toThrow();
    expect(() => decodeScheduleCursor('product', '')).toThrow();
    expect(() =>
      decodeScheduleCursor(
        'product',
        encodeBase64UrlJson({
          v: 1,
          kind: 'product',
          at: -1,
          id: 'product-1',
        }),
      ),
    ).toThrow();

    expect(() => decodeStaffEvidenceCursor('')).toThrow();
    expect(() => decodeStaffRefundCursor('')).toThrow();
    expect(() => decodeStaffOrderCursor('')).toThrow();
    expect(() => decodeSettlementBatchCursor('')).toThrow();
    expect(() => decodeSettlementMemberCursor('')).toThrow();
  });
});
