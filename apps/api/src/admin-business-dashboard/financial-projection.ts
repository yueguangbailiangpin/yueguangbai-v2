import type { FinancialReportingProjectionDto,SqlDatabase } from '@ygb/contracts';
import { dashboardDateRange } from './time';

type AmountRow={amount:string|number|null};
type ThreeAmountRow={due:string|number|null;paid:string|number|null;outstanding:string|number|null};
type ProfitRow={projected:string|number|null;completed:string|number|null};
type AdjustmentRow={projected:string|number|null;completed:string|number|null};

export async function readFinancialReportingProjection(
  database:SqlDatabase,
  input:{fromDate:string;toDate:string},
  now=Date.now(),
):Promise<FinancialReportingProjectionDto>{
  const range=dashboardDateRange(input.fromDate,input.toDate);
  const [sellerCash,buyerCash,advanceCash,sellerPayables,buyerRefunds,profit,adjustments]=await Promise.all([
    database.prepare(`SELECT CAST(COALESCE(SUM(flow.amount_cny_fen),0) AS TEXT) AS amount FROM (
        SELECT payment.amount_cny_fen AS amount_cny_fen
        FROM seller_payments payment
        WHERE payment.paid_at>=? AND payment.paid_at<? AND payment.paid_at<=?
        UNION ALL
        SELECT -reversal.amount_cny_fen AS amount_cny_fen
        FROM seller_payment_reversals reversal
        WHERE reversal.reversed_at>=? AND reversal.reversed_at<? AND reversal.reversed_at<=?
      ) flow`).bind(
        range.fromEpoch,range.toExclusiveEpoch,now,
        range.fromEpoch,range.toExclusiveEpoch,now,
      ).first<AmountRow>(),
    database.prepare(`SELECT CAST(COALESCE(SUM(CASE entry.entry_type WHEN 'PAYMENT' THEN entry.amount_cny_fen ELSE -entry.amount_cny_fen END),0) AS TEXT) AS amount
      FROM buyer_refund_payment_entries entry
      WHERE NOT EXISTS(SELECT 1 FROM buyer_advance_principal_settlements settlement WHERE settlement.buyer_refund_payment_entry_id=entry.id)
        AND ((entry.entry_type='PAYMENT' AND entry.paid_at>=? AND entry.paid_at<? AND entry.paid_at<=?)
          OR (entry.entry_type='REVERSAL' AND entry.reversed_at>=? AND entry.reversed_at<? AND entry.reversed_at<=?))`).bind(
        range.fromEpoch,range.toExclusiveEpoch,now,range.fromEpoch,range.toExclusiveEpoch,now,
      ).first<AmountRow>(),
    database.prepare(`SELECT CAST(COALESCE(SUM(CASE entry.entry_type WHEN 'PAYMENT' THEN entry.amount_cny_fen ELSE -entry.amount_cny_fen END),0) AS TEXT) AS amount
      FROM buyer_advance_principal_entries entry
      WHERE ((entry.entry_type='PAYMENT' AND entry.paid_at>=? AND entry.paid_at<? AND entry.paid_at<=?)
        OR (entry.entry_type='REVERSAL' AND entry.reversed_at>=? AND entry.reversed_at<? AND entry.reversed_at<=?))`).bind(
        range.fromEpoch,range.toExclusiveEpoch,now,range.fromEpoch,range.toExclusiveEpoch,now,
      ).first<AmountRow>(),
    database.prepare(`SELECT
        CAST(COALESCE(SUM(balance.amount_cny_fen),0) AS TEXT) AS due,
        CAST(COALESCE(SUM(balance.paid_amount_cny_fen),0) AS TEXT) AS paid,
        CAST(COALESCE(SUM(balance.outstanding_amount_cny_fen),0) AS TEXT) AS outstanding
      FROM seller_payable_balances balance
      WHERE balance.due_at>=? AND balance.due_at<? AND balance.due_at<=?`).bind(range.fromEpoch,range.toExclusiveEpoch,now).first<ThreeAmountRow>(),
    database.prepare(`SELECT
        CAST(COALESCE(SUM(ledger.due_amount_cny_fen),0) AS TEXT) AS due,
        CAST(COALESCE(SUM(ledger.net_paid_cny_fen),0) AS TEXT) AS paid,
        CAST(COALESCE(SUM(CASE WHEN ledger.due_amount_cny_fen>ledger.net_paid_cny_fen THEN ledger.due_amount_cny_fen-ledger.net_paid_cny_fen ELSE 0 END),0) AS TEXT) AS outstanding
      FROM buyer_refund_ledger_balances ledger
      WHERE ledger.created_at>=? AND ledger.created_at<? AND ledger.created_at<=?`).bind(range.fromEpoch,range.toExclusiveEpoch,now).first<ThreeAmountRow>(),
    database.prepare(`SELECT
        CAST(COALESCE(SUM(CASE WHEN finance_status IN('PROJECTED_ONLY','COMPLETED') AND confirmed_business_date BETWEEN ? AND ? THEN projected_gross_profit_cny_fen ELSE 0 END),0) AS TEXT) AS projected,
        CAST(COALESCE(SUM(CASE WHEN finance_status='COMPLETED' AND review_approved_business_date BETWEEN ? AND ? AND review_approved_at<=? THEN completed_gross_profit_cny_fen ELSE 0 END),0) AS TEXT) AS completed
      FROM internal_order_finance_positions WHERE confirmed_at<=?`).bind(
        range.fromDate,range.toDate,range.fromDate,range.toDate,now,now,
      ).first<ProfitRow>(),
    database.prepare(`SELECT
        CAST(COALESCE(SUM(CASE WHEN adjustment_scope='PROJECTED_GROSS_PROFIT' THEN amount_cny_fen ELSE 0 END),0) AS TEXT) AS projected,
        CAST(COALESCE(SUM(CASE WHEN adjustment_scope='COMPLETED_GROSS_PROFIT' THEN amount_cny_fen ELSE 0 END),0) AS TEXT) AS completed
      FROM formal_order_financial_adjustments WHERE created_at>=? AND created_at<? AND created_at<=?`).bind(range.fromEpoch,range.toExclusiveEpoch,now).first<AdjustmentRow>(),
  ]);
  const sellerCashIn=money(sellerCash?.amount);
  const buyerCashOut=money(buyerCash?.amount)+money(advanceCash?.amount);
  const projectedAdjustment=money(adjustments?.projected),completedAdjustment=money(adjustments?.completed);
  return Object.freeze({
    from_date:range.fromDate,to_date:range.toDate,timezone:'Asia/Shanghai',data_as_of:now,
    seller_cash_in_cny_fen:sellerCashIn.toString(),
    buyer_cash_out_cny_fen:buyerCashOut.toString(),
    net_cash_flow_cny_fen:(sellerCashIn-buyerCashOut).toString(),
    seller_payable_due_cny_fen:money(sellerPayables?.due).toString(),
    seller_payable_paid_cny_fen:money(sellerPayables?.paid).toString(),
    seller_payable_outstanding_cny_fen:money(sellerPayables?.outstanding).toString(),
    buyer_refund_due_cny_fen:money(buyerRefunds?.due).toString(),
    buyer_refund_paid_cny_fen:money(buyerRefunds?.paid).toString(),
    buyer_refund_outstanding_cny_fen:money(buyerRefunds?.outstanding).toString(),
    projected_profit_cny_fen:(money(profit?.projected)+projectedAdjustment).toString(),
    completed_profit_cny_fen:(money(profit?.completed)+completedAdjustment).toString(),
    projected_profit_adjustment_cny_fen:projectedAdjustment.toString(),
    completed_profit_adjustment_cny_fen:completedAdjustment.toString(),
  });
}

function money(value:string|number|null|undefined):bigint{
  const normalized=value===null||value===undefined?'0':String(value);
  if(!/^-?(?:0|[1-9][0-9]*)$/u.test(normalized))throw new Error('invalid_financial_projection_amount');
  return BigInt(normalized);
}
