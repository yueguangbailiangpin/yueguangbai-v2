export interface FinancialReportingProjectionDto {
  from_date: string;
  to_date: string;
  timezone: 'Asia/Shanghai';
  data_as_of: number;
  seller_cash_in_cny_fen: string;
  buyer_cash_out_cny_fen: string;
  net_cash_flow_cny_fen: string;
  seller_payable_due_cny_fen: string;
  seller_payable_paid_cny_fen: string;
  seller_payable_outstanding_cny_fen: string;
  buyer_refund_due_cny_fen: string;
  buyer_refund_paid_cny_fen: string;
  buyer_refund_outstanding_cny_fen: string;
  projected_profit_cny_fen: string;
  completed_profit_cny_fen: string;
  projected_profit_adjustment_cny_fen: string;
  completed_profit_adjustment_cny_fen: string;
}
