import { describe, expect, it } from 'vitest';
import {
  decodeBuyerRefundPortalCursor,
  encodeBuyerRefundPortalCursor,
  parseBuyerRefundPortalPageLimit,
} from './pagination';

describe('buyer refund portal pagination', () => {
  it('round-trips the stable keyset cursor', () => {
    const cursor = { updatedAt: 1234, id: 'refund-obligation-1' };
    expect(decodeBuyerRefundPortalCursor(
      encodeBuyerRefundPortalCursor(cursor),
    )).toEqual(cursor);
  });

  it('enforces page bounds and rejects tampered cursors', () => {
    expect(parseBuyerRefundPortalPageLimit(undefined)).toBe(20);
    expect(parseBuyerRefundPortalPageLimit('100')).toBe(100);
    expect(() => parseBuyerRefundPortalPageLimit('0')).toThrowError();
    expect(() => parseBuyerRefundPortalPageLimit('101')).toThrowError();
    expect(() => decodeBuyerRefundPortalCursor('***')).toThrowError();
  });
});
