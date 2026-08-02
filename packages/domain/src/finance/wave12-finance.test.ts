import { describe, expect, it } from 'vitest';
import type { InternalOrderFinancePositionDto } from '@ygb/contracts';
import {
  attributedCashNet,
  completedGrossProfit,
  projectedGrossProfit,
  sumFinancePositions,
} from './calculations';
import { serializeFinancialCsv } from './csv';

describe('Wave 12 exact financial formulas', () => {
  it.each([
    [{ sellerExpectedPrincipalCnyFen: '50000', serviceFeeCnyFen: '3000', buyerExpectedPrincipalCnyFen: '48000' }, 5000n],
    [{ sellerExpectedPrincipalCnyFen: '45000', serviceFeeCnyFen: '1000', buyerExpectedPrincipalCnyFen: '48000' }, -2000n],
    [{ sellerExpectedPrincipalCnyFen: '47000', serviceFeeCnyFen: '1000', buyerExpectedPrincipalCnyFen: '48000' }, 0n],
  ])('derives projected gross profit from the frozen snapshot', (
    input,
    expected,
  ) => {
    expect(projectedGrossProfit(input)).toBe(expected);
  });

  it('does not deduct buyer self-pay twice', () => {
    expect(projectedGrossProfit({
      sellerExpectedPrincipalCnyFen: '50000',
      serviceFeeCnyFen: '3000',
      buyerExpectedPrincipalCnyFen: '45000',
    })).toBe(8000n);
  });

  it('derives completed gross profit only from payable/refund facts', () => {
    expect(completedGrossProfit({
      sellerPrincipalPayableCnyFen: '50000',
      sellerServiceFeePayableCnyFen: '3000',
      buyerRefundDueCnyFen: '48000',
    })).toBe(5000n);
  });

  it('keeps attributed cash separate from completed gross profit', () => {
    expect(attributedCashNet({
      sellerAllocatedNetCnyFen: '20000',
      buyerRefundNetPaidCnyFen: '48001',
    })).toBe(-28001n);
  });

  it('excludes incomplete completed gross profit and counts conflicts', () => {
    const projectedOnly = {
      ...position('100'),
      completed_gross_profit_cny_fen: null,
      finance_status: 'PROJECTED_ONLY' as const,
    };
    const conflict = {
      ...position('-50'),
      completed_gross_profit_cny_fen: null,
      finance_status: 'AMOUNT_MISMATCH' as const,
    };
    const total = sumFinancePositions([projectedOnly, conflict]);
    expect(total.projected_order_count).toBe(2);
    expect(total.completed_order_count).toBe(0);
    expect(total.conflict_order_count).toBe(1);
    expect(total.projected_gross_profit_cny_fen).toBe('50');
    expect(total.completed_gross_profit_cny_fen).toBe('0');
  });

  it('sums beyond Number.MAX_SAFE_INTEGER with BigInt', () => {
    const huge = '9007199254740991';
    const total = sumFinancePositions([position(huge), position(huge)]);
    expect(total.projected_gross_profit_cny_fen).toBe('18014398509481982');
    expect(total.attributed_cash_net_cny_fen).toBe('18014398509481982');
  });
});

describe('Wave 12 audited CSV safety', () => {
  it('writes BOM, CRLF, RFC 4180 quoting and formula protection', () => {
    const bytes = serializeFinancialCsv([
      {
        text: '=SUM(1,1)', plus: '+cmd', minus: '-calc', at: '@evil',
        tab: '\tbad', cr: '\rbad', quote: 'a"b', comma: 'a,b',
        newline: 'a\nb', cn: '中文', amount: '-123',
      },
    ], [
      { header: 'text', value: (row) => row.text },
      { header: 'plus', value: (row) => row.plus },
      { header: 'minus', value: (row) => row.minus },
      { header: 'at', value: (row) => row.at },
      { header: 'tab', value: (row) => row.tab },
      { header: 'cr', value: (row) => row.cr },
      { header: 'quote', value: (row) => row.quote },
      { header: 'comma', value: (row) => row.comma },
      { header: 'newline', value: (row) => row.newline },
      { header: 'cn', value: (row) => row.cn },
      { header: 'amount', value: (row) => row.amount, kind: 'FEN' },
    ]);
    const csv = new TextDecoder().decode(bytes);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv).toContain("'=SUM(1,1)");
    expect(csv).toContain("'+cmd");
    expect(csv).toContain("'-calc");
    expect(csv).toContain("'@evil");
    expect(csv).toContain('"a""b"');
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"a\nb"');
    expect(csv).toContain('中文');
    expect(csv).toContain(',-123');
  });

  it('accepts the 50000-row boundary with stable columns', () => {
    const bytes = serializeFinancialCsv(
      Array.from({ length: 50_000 }, (_, index) => ({ value: String(index) })),
      [{ header: 'value', value: (row) => row.value, kind: 'INTEGER' }],
    );
    expect(bytes.byteLength).toBeGreaterThan(50_000);
  });

  it('rejects more than 50000 rows', () => {
    expect(() => serializeFinancialCsv(
      Array.from({ length: 50_001 }, () => ({ value: 'x' })),
      [{ header: 'value', value: (row) => row.value }],
    )).toThrow('EXPORT_TOO_LARGE');
  });
});

function position(value: string): InternalOrderFinancePositionDto {
  return {
    formal_order_id: crypto.randomUUID(),
    amazon_order_number: '123-1234567-1234567',
    seller_organization_id: 'seller', store_id: 'store', product_id: 'product',
    asin: 'B000000001', product_name: '产品', review_type: 'TEXT',
    confirmed_at: 1, confirmed_business_date: '2026-08-01',
    review_approved_at: 2, review_approved_business_date: '2026-08-01',
    last_cash_business_date: '2026-08-01', final_paid_jpy: '1',
    financial_snapshot_id: 'snapshot', buyer_self_pay_bps: 0,
    buyer_self_pay_jpy: '0', buyer_expected_principal_cny_fen: '0',
    seller_expected_principal_cny_fen: value,
    service_fee_snapshot_cny_fen: '0',
    projected_gross_profit_cny_fen: value,
    completed_gross_profit_cny_fen: value,
    seller_principal_due_cny_fen: '0',
    seller_principal_collected_cny_fen: '0',
    seller_principal_outstanding_cny_fen: '0',
    seller_service_fee_due_cny_fen: '0',
    seller_service_fee_collected_cny_fen: '0',
    seller_service_fee_outstanding_cny_fen: '0',
    buyer_refund_due_cny_fen: '0', buyer_refund_net_paid_cny_fen: '0',
    buyer_refund_outstanding_cny_fen: '0',
    buyer_refund_overpaid_cny_fen: '0',
    attributed_cash_net_cny_fen: value, finance_status: 'COMPLETED',
  };
}
