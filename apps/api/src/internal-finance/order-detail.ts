import type {
  FinanceExceptionAction,
  FinanceStatus,
  InternalFinanceOrderDetailDto,
  InternalFinanceRateDetailDto,
  InternalOrderFinancePositionDto,
} from '@ygb/contracts';
import {
  databaseIntegerToBigInt,
  signedIntegerString,
} from '@ygb/domain';

export function buildFinanceOrderDetail(
  position: InternalOrderFinancePositionDto,
  rateDetail: InternalFinanceRateDetailDto | null = null,
): InternalFinanceOrderDetailDto {
  const sellerAllocated = signedIntegerString(
    databaseIntegerToBigInt(position.attributed_cash_net_cny_fen)
      + databaseIntegerToBigInt(position.buyer_refund_net_paid_cny_fen),
  );
  const hasException = position.finance_status !== 'PROJECTED_ONLY'
    && position.finance_status !== 'COMPLETED';
  return Object.freeze({
    position,
    frozen_snapshot: Object.freeze({
      financial_snapshot_id: position.financial_snapshot_id,
      buyer_self_pay_bps: position.buyer_self_pay_bps,
      buyer_self_pay_jpy: position.buyer_self_pay_jpy,
      buyer_expected_principal_cny_fen:
        position.buyer_expected_principal_cny_fen,
      seller_expected_principal_cny_fen:
        position.seller_expected_principal_cny_fen,
      service_fee_cny_fen: position.service_fee_snapshot_cny_fen,
      rate_detail: rateDetail === null ? null : Object.freeze(rateDetail),
    }),
    seller_payables: Object.freeze({
      principal_due_cny_fen: position.seller_principal_due_cny_fen,
      principal_collected_cny_fen:
        position.seller_principal_collected_cny_fen,
      principal_outstanding_cny_fen:
        position.seller_principal_outstanding_cny_fen,
      service_fee_due_cny_fen: position.seller_service_fee_due_cny_fen,
      service_fee_collected_cny_fen:
        position.seller_service_fee_collected_cny_fen,
      service_fee_outstanding_cny_fen:
        position.seller_service_fee_outstanding_cny_fen,
    }),
    buyer_refund: Object.freeze({
      due_cny_fen: position.buyer_refund_due_cny_fen,
      net_paid_cny_fen: position.buyer_refund_net_paid_cny_fen,
      outstanding_cny_fen: position.buyer_refund_outstanding_cny_fen,
      overpaid_cny_fen: position.buyer_refund_overpaid_cny_fen,
    }),
    attributed_cash: Object.freeze({
      seller_allocated_net_cny_fen: sellerAllocated,
      buyer_refund_net_paid_cny_fen:
        position.buyer_refund_net_paid_cny_fen,
      net_cny_fen: position.attributed_cash_net_cny_fen,
    }),
    calculations: Object.freeze({
      projected_gross_profit: Object.freeze({
        formula:
          'SELLER_EXPECTED_PRINCIPAL_PLUS_SERVICE_FEE_MINUS_BUYER_EXPECTED_PRINCIPAL' as const,
        seller_expected_principal_cny_fen:
          position.seller_expected_principal_cny_fen,
        service_fee_cny_fen: position.service_fee_snapshot_cny_fen,
        buyer_expected_principal_cny_fen:
          position.buyer_expected_principal_cny_fen,
        result_cny_fen: position.projected_gross_profit_cny_fen,
      }),
      completed_gross_profit: Object.freeze({
        formula:
          'SELLER_PRINCIPAL_PAYABLE_PLUS_SERVICE_FEE_PAYABLE_MINUS_BUYER_REFUND_DUE' as const,
        eligible: position.finance_status === 'COMPLETED',
        seller_principal_payable_cny_fen:
          position.seller_principal_due_cny_fen,
        seller_service_fee_payable_cny_fen:
          position.seller_service_fee_due_cny_fen,
        buyer_refund_due_cny_fen: position.buyer_refund_due_cny_fen,
        result_cny_fen: position.completed_gross_profit_cny_fen,
      }),
      current_attributed_cash: Object.freeze({
        formula:
          'SELLER_CURRENT_NET_ALLOCATION_MINUS_BUYER_REFUND_NET_PAID' as const,
        seller_current_net_allocation_cny_fen: sellerAllocated,
        buyer_refund_net_paid_cny_fen:
          position.buyer_refund_net_paid_cny_fen,
        result_cny_fen: position.attributed_cash_net_cny_fen,
      }),
    }),
    finance_status: position.finance_status,
    exception_codes: Object.freeze(
      hasException ? [position.finance_status] : [],
    ),
    suggested_actions: Object.freeze(
      hasException ? [financeExceptionAction(position.finance_status)] : [],
    ),
  });
}

function financeExceptionAction(
  status: FinanceStatus,
): FinanceExceptionAction {
  if (status === 'MISSING_FINANCIAL_SNAPSHOT'
    || status === 'MULTIPLE_FINANCIAL_SNAPSHOTS') {
    return 'REVIEW_FORMAL_ORDER_SNAPSHOT';
  }
  if (status === 'MISSING_PRINCIPAL_PAYABLE'
    || status === 'MISSING_SERVICE_FEE_PAYABLE') {
    return 'RUN_SELLER_PAYABLE_RECONCILIATION';
  }
  if (status === 'MISSING_BUYER_REFUND_OBLIGATION') {
    return 'REVIEW_BUYER_REFUND_OBLIGATION';
  }
  return 'MANUAL_INTERNAL_INVESTIGATION';
}
