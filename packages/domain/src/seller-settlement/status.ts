export type SellerPayableDerivedStatus =
  | 'UNPAID'
  | 'PARTIALLY_PAID'
  | 'PAID';

export type SellerPaymentDerivedStatus =
  | 'REVERSED'
  | 'UNALLOCATED'
  | 'PARTIALLY_ALLOCATED'
  | 'FULLY_ALLOCATED';

export function sellerPayableStatus(
  amountCnyFen: bigint,
  paidCnyFen: bigint,
): SellerPayableDerivedStatus {
  assertNonNegative(amountCnyFen);
  assertNonNegative(paidCnyFen);
  if (paidCnyFen > amountCnyFen) throw new RangeError('PAYABLE_OVERPAID');
  if (amountCnyFen === 0n || paidCnyFen === amountCnyFen) return 'PAID';
  if (paidCnyFen === 0n) return 'UNPAID';
  return 'PARTIALLY_PAID';
}

export function sellerPaymentStatus(
  amountCnyFen: bigint,
  allocatedCnyFen: bigint,
  reversed: boolean,
): SellerPaymentDerivedStatus {
  if (amountCnyFen <= 0n) throw new RangeError('INVALID_PAYMENT_AMOUNT');
  assertNonNegative(allocatedCnyFen);
  if (allocatedCnyFen > amountCnyFen) {
    throw new RangeError('PAYMENT_OVERALLOCATED');
  }
  if (reversed) {
    if (allocatedCnyFen !== 0n) throw new RangeError('REVERSED_PAYMENT_ALLOCATED');
    return 'REVERSED';
  }
  if (allocatedCnyFen === 0n) return 'UNALLOCATED';
  if (allocatedCnyFen === amountCnyFen) return 'FULLY_ALLOCATED';
  return 'PARTIALLY_ALLOCATED';
}

function assertNonNegative(value: bigint): void {
  if (value < 0n) throw new RangeError('NEGATIVE_FINANCIAL_FACT');
}