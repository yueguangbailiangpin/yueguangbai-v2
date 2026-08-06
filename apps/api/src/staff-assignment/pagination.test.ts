import { describe, expect, it } from 'vitest';
import { decodeStaffWorkItemCursor, encodeStaffWorkItemCursor } from './pagination';

describe('Staff work item cursor', () => {
  it('round trips a cursor bound to status and work type', () => {
    const encoded = encodeStaffWorkItemCursor({
      createdAt: 1_787_000_000_000,
      id: 'work-002',
      status: 'OPEN',
      workType: 'ORDER_EVIDENCE_REVIEW',
    });
    expect(decodeStaffWorkItemCursor(encoded, {
      status: 'OPEN', workType: 'ORDER_EVIDENCE_REVIEW',
    })).toEqual({
      createdAt: 1_787_000_000_000,
      id: 'work-002',
      status: 'OPEN',
      workType: 'ORDER_EVIDENCE_REVIEW',
    });
  });

  it('rejects malformed and cross-filter cursor reuse', () => {
    const encoded = encodeStaffWorkItemCursor({
      createdAt: 10, id: 'work-1', status: 'OPEN', workType: null,
    });
    expect(() => decodeStaffWorkItemCursor(encoded, {
      status: 'COMPLETED', workType: null,
    })).toThrow();
    expect(() => decodeStaffWorkItemCursor('not-json', {
      status: 'OPEN', workType: null,
    })).toThrow();
  });
});
