import { describe, expect, it } from 'vitest';
import {
  sellerPayableStatus,
  sellerPaymentStatus,
} from './status';

describe('Wave 11 seller settlement derived status', () => {
  it('derives payable states including zero amount', () => {
    expect(sellerPayableStatus(0n, 0n)).toBe('PAID');
    expect(sellerPayableStatus(100n, 0n)).toBe('UNPAID');
    expect(sellerPayableStatus(100n, 40n)).toBe('PARTIALLY_PAID');
    expect(sellerPayableStatus(100n, 100n)).toBe('PAID');
  });

  it('rejects overpaid or negative payable facts', () => {
    expect(() => sellerPayableStatus(100n, 101n)).toThrow('PAYABLE_OVERPAID');
    expect(() => sellerPayableStatus(-1n, 0n)).toThrow('NEGATIVE_FINANCIAL_FACT');
  });

  it('derives payment allocation states', () => {
    expect(sellerPaymentStatus(100n, 0n, false)).toBe('UNALLOCATED');
    expect(sellerPaymentStatus(100n, 30n, false)).toBe('PARTIALLY_ALLOCATED');
    expect(sellerPaymentStatus(100n, 100n, false)).toBe('FULLY_ALLOCATED');
    expect(sellerPaymentStatus(100n, 0n, true)).toBe('REVERSED');
  });

  it('rejects reversed payments that retain allocation', () => {
    expect(() => sellerPaymentStatus(100n, 1n, true))
      .toThrow('REVERSED_PAYMENT_ALLOCATED');
  });
});