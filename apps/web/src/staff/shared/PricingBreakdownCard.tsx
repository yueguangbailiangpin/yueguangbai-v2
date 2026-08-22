import { Card } from '../../ui/primitives';
import { fenToYuan, markupLabel, rateLabel } from '../finance/finance-format';
import { formatShanghai } from './format';

export type FinanceOrderDetail = Awaited<
  ReturnType<typeof import('../api/client').staffApi.financeOrderDetail>
>['data'];

const CALCULATION_LABELS: Record<string, string> = {
  SELLER_EXPECTED_PRINCIPAL_PLUS_SERVICE_FEE_MINUS_BUYER_EXPECTED_PRINCIPAL:
    '预估毛利 = 卖家应收本金 + 服务费 − 买家应收本金',
  SELLER_PRINCIPAL_PAYABLE_PLUS_SERVICE_FEE_PAYABLE_MINUS_BUYER_REFUND_DUE:
    '已完成毛利 = 卖家应付本金 + 应付服务费 − 买家应返',
  SELLER_CURRENT_NET_ALLOCATION_MINUS_BUYER_REFUND_NET_PAID:
    '当前归集现金净额 = 卖家当前净归集 − 买家返款净付',
};

const POLICY_SCOPE_LABELS: Record<string, string> = {
  CURRENCY_PAIR_DEFAULT: '币种对默认加点',
  SELLER_ORGANIZATION: '卖家组织专属加点',
};

function jpyLabel(value: string): string {
  return `¥${Number(value)} JPY`;
}

/**
 * P5 pricing breakdown card: which frozen configuration an order was priced
 * with, the arithmetic, and the resulting amounts.  Consumes the
 * owner-only /api/staff/finance/orders/:id read; renderers are responsible
 * for gating visibility by role.
 */
export function PricingBreakdownCard({
  detail,
  orderId,
}: {
  detail: FinanceOrderDetail;
  orderId: string;
}): React.JSX.Element {
  const position = detail.position;
  const rate = detail.frozen_snapshot.rate_detail;
  const calculations = [
    detail.calculations.projected_gross_profit,
    detail.calculations.completed_gross_profit,
    detail.calculations.current_attributed_cash,
  ];
  return (
    <Card className="customer-visible staff-pricing-breakdown">
      <h3>计价明细</h3>
      <p className="staff-pricing-breakdown-order">
        订单 {position.amazon_order_number} · ASIN {position.asin} · {position.product_name}
        （{position.review_type}，确认于 {formatShanghai(position.confirmed_at)}）
      </p>
      <section aria-label="计价要素">
        <h4>这一单采用的配置（确认时冻结）</h4>
        <ul className="staff-pricing-breakdown-facts">
          <li>
            基础汇率：
            {rate?.buyer_cny_per_jpy_e8
              ? `${rateLabel(rate.buyer_cny_per_jpy_e8)}（${rate.buyer_rate_business_date ?? '订单日'} 生效）`
              : '快照缺失'}
          </li>
          <li>
            加点：
            {rate?.markup_rate_value
              ? `${markupLabel(rate.markup_rate_value)}（${rate.policy_scope_type ? POLICY_SCOPE_LABELS[rate.policy_scope_type] : ''} v${rate.policy_version_no ?? '—'}）`
              : '快照缺失'}
          </li>
          <li>
            卖家侧最终汇率：
            {rate?.final_rate_value ? rateLabel(rate.final_rate_value) : '快照缺失'}
          </li>
          <li>
            服务费：
            {detail.frozen_snapshot.service_fee_cny_fen
              ? fenToYuan(detail.frozen_snapshot.service_fee_cny_fen)
              : '快照缺失'}
          </li>
        </ul>
      </section>
      <section aria-label="冻结金额">
        <h4>冻结金额</h4>
        <ul className="staff-pricing-breakdown-facts">
          <li>实付金额：{jpyLabel(position.final_paid_jpy)}</li>
          <li>
            买家自付：
            {detail.frozen_snapshot.buyer_self_pay_jpy
              ? `${jpyLabel(detail.frozen_snapshot.buyer_self_pay_jpy)}（${((detail.frozen_snapshot.buyer_self_pay_bps ?? 0) / 100).toFixed(2)}%）`
              : '—'}
          </li>
          <li>
            买家应收（返款）本金：
            {detail.frozen_snapshot.buyer_expected_principal_cny_fen
              ? fenToYuan(detail.frozen_snapshot.buyer_expected_principal_cny_fen)
              : '—'}
          </li>
          <li>
            卖家应收本金：
            {detail.frozen_snapshot.seller_expected_principal_cny_fen
              ? fenToYuan(detail.frozen_snapshot.seller_expected_principal_cny_fen)
              : '—'}
          </li>
        </ul>
      </section>
      <section aria-label="算式">
        <h4>算式</h4>
        <ul className="staff-pricing-breakdown-facts">
          {calculations.map((calculation) => (
            <li key={calculation.formula}>
              {CALCULATION_LABELS[calculation.formula] ?? calculation.formula}
              {' ＝ '}
              <strong>
                {calculation.result_cny_fen === null
                  ? '未完成'
                  : fenToYuan(calculation.result_cny_fen)}
              </strong>
            </li>
          ))}
        </ul>
      </section>
      <p className="hint">
        正式订单 ID：{orderId} · <a href={`/staff/orders/${encodeURIComponent(orderId)}`}>查看订单详情</a>
        ；历史快照不回写。
      </p>
    </Card>
  );
}
