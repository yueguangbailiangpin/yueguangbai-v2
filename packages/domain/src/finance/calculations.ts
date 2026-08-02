import type {
  InternalFinanceTotalsDto,
  InternalOrderFinancePositionDto,
} from '@ygb/contracts';
import {
  parseSignedIntegerString,
  signedIntegerString,
} from '../money/signed-integer';

export function projectedGrossProfit(input: {
  sellerExpectedPrincipalCnyFen: string;
  serviceFeeCnyFen: string;
  buyerExpectedPrincipalCnyFen: string;
}): bigint {
  return parseSignedIntegerString(input.sellerExpectedPrincipalCnyFen)
    + parseSignedIntegerString(input.serviceFeeCnyFen)
    - parseSignedIntegerString(input.buyerExpectedPrincipalCnyFen);
}

export function completedGrossProfit(input: {
  sellerPrincipalPayableCnyFen: string;
  sellerServiceFeePayableCnyFen: string;
  buyerRefundDueCnyFen: string;
}): bigint {
  return parseSignedIntegerString(input.sellerPrincipalPayableCnyFen)
    + parseSignedIntegerString(input.sellerServiceFeePayableCnyFen)
    - parseSignedIntegerString(input.buyerRefundDueCnyFen);
}

export function attributedCashNet(input: {
  sellerAllocatedNetCnyFen: string;
  buyerRefundNetPaidCnyFen: string;
}): bigint {
  return parseSignedIntegerString(input.sellerAllocatedNetCnyFen)
    - parseSignedIntegerString(input.buyerRefundNetPaidCnyFen);
}

export function sumFinancePositions(
  positions: readonly InternalOrderFinancePositionDto[],
): InternalFinanceTotalsDto {
  const sums = {
    projected: 0n,
    completed: 0n,
    cash: 0n,
    principalDue: 0n,
    principalCollected: 0n,
    principalOutstanding: 0n,
    feeDue: 0n,
    feeCollected: 0n,
    feeOutstanding: 0n,
    refundDue: 0n,
    refundPaid: 0n,
    refundOutstanding: 0n,
    refundOverpaid: 0n,
  };
  let projectedCount = 0;
  let completedCount = 0;
  let conflictCount = 0;
  for (const row of positions) {
    if (row.projected_gross_profit_cny_fen !== null) {
      sums.projected += parseSignedIntegerString(
        row.projected_gross_profit_cny_fen,
      );
      projectedCount += 1;
    }
    if (row.completed_gross_profit_cny_fen !== null) {
      sums.completed += parseSignedIntegerString(
        row.completed_gross_profit_cny_fen,
      );
      completedCount += 1;
    }
    if (row.finance_status !== 'PROJECTED_ONLY'
      && row.finance_status !== 'COMPLETED') {
      conflictCount += 1;
    }
    sums.cash += parseSignedIntegerString(row.attributed_cash_net_cny_fen);
    sums.principalDue += parseSignedIntegerString(
      row.seller_principal_due_cny_fen,
    );
    sums.principalCollected += parseSignedIntegerString(
      row.seller_principal_collected_cny_fen,
    );
    sums.principalOutstanding += parseSignedIntegerString(
      row.seller_principal_outstanding_cny_fen,
    );
    sums.feeDue += parseSignedIntegerString(
      row.seller_service_fee_due_cny_fen,
    );
    sums.feeCollected += parseSignedIntegerString(
      row.seller_service_fee_collected_cny_fen,
    );
    sums.feeOutstanding += parseSignedIntegerString(
      row.seller_service_fee_outstanding_cny_fen,
    );
    sums.refundDue += parseSignedIntegerString(
      row.buyer_refund_due_cny_fen,
    );
    sums.refundPaid += parseSignedIntegerString(
      row.buyer_refund_net_paid_cny_fen,
    );
    sums.refundOutstanding += parseSignedIntegerString(
      row.buyer_refund_outstanding_cny_fen,
    );
    sums.refundOverpaid += parseSignedIntegerString(
      row.buyer_refund_overpaid_cny_fen,
    );
  }
  return Object.freeze({
    order_count: positions.length,
    projected_order_count: projectedCount,
    completed_order_count: completedCount,
    conflict_order_count: conflictCount,
    projected_gross_profit_cny_fen: signedIntegerString(sums.projected),
    completed_gross_profit_cny_fen: signedIntegerString(sums.completed),
    attributed_cash_net_cny_fen: signedIntegerString(sums.cash),
    seller_principal_due_cny_fen: signedIntegerString(sums.principalDue),
    seller_principal_collected_cny_fen: signedIntegerString(
      sums.principalCollected,
    ),
    seller_principal_outstanding_cny_fen: signedIntegerString(
      sums.principalOutstanding,
    ),
    seller_service_fee_due_cny_fen: signedIntegerString(sums.feeDue),
    seller_service_fee_collected_cny_fen: signedIntegerString(
      sums.feeCollected,
    ),
    seller_service_fee_outstanding_cny_fen: signedIntegerString(
      sums.feeOutstanding,
    ),
    buyer_refund_due_cny_fen: signedIntegerString(sums.refundDue),
    buyer_refund_net_paid_cny_fen: signedIntegerString(sums.refundPaid),
    buyer_refund_outstanding_cny_fen: signedIntegerString(
      sums.refundOutstanding,
    ),
    buyer_refund_overpaid_cny_fen: signedIntegerString(sums.refundOverpaid),
  });
}
