import { describe, expect, it } from 'vitest';
import {
  BUYER_REFUND_ENTRY_TYPES,
  BUYER_REFUND_EVENT_TYPES,
  BUYER_REFUND_PAYMENT_CHANNELS,
  BUYER_REFUND_STATUSES,
  isBuyerRefundPaymentChannel,
  isBuyerRefundStatus,
} from './buyer-refund';

describe('buyer refund contracts', () => {
  it('publishes only the derived ledger states', () => {
    expect(BUYER_REFUND_STATUSES).toEqual([
      'DUE',
      'PARTIALLY_PAID',
      'PAID',
      'OVERPAID',
    ]);
    expect(isBuyerRefundStatus('OVERPAID')).toBe(true);
    expect(isBuyerRefundStatus('MANUALLY_PAID')).toBe(false);
  });

  it('publishes only manual payment channels', () => {
    expect(BUYER_REFUND_PAYMENT_CHANNELS).toEqual([
      'WECHAT',
      'ALIPAY',
      'BANK_TRANSFER',
      'OTHER_MANUAL',
    ]);
    expect(isBuyerRefundPaymentChannel('WECHAT')).toBe(true);
    expect(isBuyerRefundPaymentChannel('AUTO_TRANSFER')).toBe(false);
  });

  it('keeps payment/reversal and event vocabulary append-only', () => {
    expect(BUYER_REFUND_ENTRY_TYPES).toEqual(['PAYMENT', 'REVERSAL']);
    expect(BUYER_REFUND_EVENT_TYPES).toEqual([
      'BUYER_REFUND_OBLIGATION_CREATED',
      'BUYER_REFUND_PAYMENT_RECORDED',
      'BUYER_REFUND_PAYMENT_REVERSED',
    ]);
  });
});
