import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { identityApiRequest } from '../../api/identity-request';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import { Alert, Button, Card } from '../../ui/primitives';
import { staffApi } from '../api/client';
import { formatCny } from '../shared/format';
import { OperatingIntegrityCenter } from './OperatingIntegrityCenter';

const financialSchema = z
  .object({
    financial_projection: z
      .object({
        from_date: z.string(),
        to_date: z.string(),
        timezone: z.literal('Asia/Shanghai'),
        data_as_of: z.number().int().nonnegative(),
        seller_cash_in_cny_fen: z.string(),
        buyer_cash_out_cny_fen: z.string(),
        net_cash_flow_cny_fen: z.string(),
        seller_payable_due_cny_fen: z.string(),
        seller_payable_paid_cny_fen: z.string(),
        seller_payable_outstanding_cny_fen: z.string(),
        buyer_refund_due_cny_fen: z.string(),
        buyer_refund_paid_cny_fen: z.string(),
        buyer_refund_outstanding_cny_fen: z.string(),
        projected_profit_cny_fen: z.string(),
        completed_profit_cny_fen: z.string(),
        projected_profit_adjustment_cny_fen: z.string(),
        completed_profit_adjustment_cny_fen: z.string(),
      })
      .strict(),
  })
  .strict();
type WindowKey = 'TODAY' | 'WEEK' | 'MONTH';
const WINDOWS: readonly [WindowKey, string][] = [
  ['TODAY', '今日'],
  ['WEEK', '本周'],
  ['MONTH', '本月'],
];

// Stage 4 simplified owner dashboard (inventory §3.2): counting cards, pending
// financial workload, abnormal signals, and the owner financial summary that
// reuses the formal internal finance formulas. Machine-era funnels, daily
// drill-downs and the attribution precision switch are retired; the visual
// redesign lands in stage 7.
export function FrozenAdminBusinessDashboard(): React.JSX.Element {
  const client = useQueryClient(),
    session = useCurrentStaffSession();
  const [window, setWindow] = useState<WindowKey>('TODAY');
  const authorized =
    session.role.code === 'owner' && session.permissions.includes('FINANCIAL_VIEW');
  const summary = useQuery({
    queryKey: ['staff', 'frozen-dashboard', 'summary', session.authorization_version, window],
    queryFn: ({ signal }) =>
      staffApi.adminDashboardSummary(client, window, signal).then((r) => r.data.summary),
    enabled: authorized,
    retry: false,
  });
  const from = summary.data?.window.from_date ?? '',
    to = summary.data?.window.to_date ?? '';
  const financial = useQuery({
    queryKey: [
      'staff',
      'frozen-dashboard',
      'financial-projection',
      session.authorization_version,
      from,
      to,
    ],
    queryFn: ({ signal }) =>
      identityApiRequest('staff', client, {
        path: `/api/staff/admin-business-dashboard/financial-projection?from_date=${encodeURIComponent(from)}&to_date=${encodeURIComponent(to)}`,
        method: 'GET',
        schema: financialSchema,
        signal,
      }).then((r) => r.data.financial_projection),
    enabled: authorized && from !== '' && to !== '',
    retry: false,
  });
  if (!authorized)
    return (
      <main className="admin-dashboard">
        <Alert tone="danger">只有总管理员可以查看经营看板。</Alert>
      </main>
    );
  if (summary.isPending)
    return (
      <main className="admin-dashboard">
        <p role="status">加载中…</p>
      </main>
    );
  if (summary.isError)
    return (
      <main className="admin-dashboard">
        <Alert tone="danger">数据加载失败，请重试。</Alert>
      </main>
    );
  const business = summary.data,
    money = financial.data;
  return (
    <main className="admin-dashboard frozen-admin-dashboard">
      <section className="dashboard-toolbar">
        <div className="dashboard-window-switch">
          {WINDOWS.map(([key, label]) => (
            <Button
              key={key}
              className={window === key ? '' : 'secondary'}
              onClick={() => setWindow(key)}
            >
              {label}
            </Button>
          ))}
        </div>
        <p>
          {business.window.from_date} 至 {business.window.to_date} · 北京时间
        </p>
      </section>
      <section>
        <div className="dashboard-section-heading">
          <div>
            <h2>本期赚了多少</h2>
            <p>账本的只读汇总，按真实付款时间统计；撤回的付款不算。</p>
          </div>
        </div>
        {money ? (
          <div className="dashboard-metric-grid">
            <Metric
              label="预计净赚"
              value={formatCny(money.projected_profit_cny_fen)}
              detail={`按已确认订单算，含人工调整 ${formatCny(money.projected_profit_adjustment_cny_fen)}`}
            />
            <Metric
              label="已落袋净赚"
              value={formatCny(money.completed_profit_cny_fen)}
              detail={`评论返款全部完成的订单利润，含人工调整 ${formatCny(money.completed_profit_adjustment_cny_fen)}`}
            />
            <Metric
              label="现金净流入"
              value={formatCny(money.net_cash_flow_cny_fen)}
              detail={`卖家转入 ${formatCny(money.seller_cash_in_cny_fen)} − 已付买家 ${formatCny(money.buyer_cash_out_cny_fen)}`}
            />
            <Metric
              label="待返买家"
              value={formatCny(money.buyer_refund_due_cny_fen)}
              detail={`已返 ${formatCny(money.buyer_refund_paid_cny_fen)} · 未返 ${formatCny(money.buyer_refund_outstanding_cny_fen)}`}
            />
            <Metric
              label="待结卖家"
              value={formatCny(money.seller_payable_due_cny_fen)}
              detail={`已结 ${formatCny(money.seller_payable_paid_cny_fen)} · 未结 ${formatCny(money.seller_payable_outstanding_cny_fen)}`}
            />
          </div>
        ) : financial.isPending ? (
          <p role="status">财务汇总加载中…</p>
        ) : (
          <Alert tone="danger">财务汇总加载失败，请重试。</Alert>
        )}
      </section>
      <section>
        <h2>客户与订单</h2>
        <div className="dashboard-metric-grid">
          <Metric
            label="新增买家客户"
            value={business.cards.new_customers_buyer}
            detail="保存后立即计入，以后不会变"
          />
          <Metric
            label="新增卖家客户"
            value={business.cards.new_customers_seller}
            detail="保存后即建立卖家档案，服务费按默认配好"
          />
          <Metric label="新增预约" value={business.cards.reservations} />
          <Metric
            label="新增订单"
            value={business.cards.formal_orders}
            detail="按订单确认日期统计"
          />
          <Metric
            label="待处理买家返款"
            value={business.pending.buyer_refunds}
            detail="返款金额以账本为准"
          />
          <Metric
            label="待处理卖家结算"
            value={business.pending.seller_settlements}
            detail="结算金额以账本为准"
          />
          <Metric
            label="预计净赚"
            value={formatCny(business.owner_summary.projected_profit.amount_cny_fen)}
            detail={`${business.owner_summary.projected_profit.valid_order_count} 单有效`}
          />
          <Metric
            label="已落袋净赚"
            value={formatCny(business.owner_summary.completed_profit.amount_cny_fen)}
            detail={`${business.owner_summary.completed_profit.valid_order_count} 单有效`}
          />
        </div>
      </section>
      <section>
        <div className="dashboard-section-heading">
          <div>
            <h2>需要你处理的</h2>
            <p>需要人工确认的事项；全为 0 时下面只显示「正常」。</p>
          </div>
        </div>
        <OperatingIntegrityCenter
          openWorkItems={business.overdue.open_work_items}
          financeExceptions={business.overdue.finance_exceptions}
        />
      </section>
    </main>
  );
}
function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <Card className="dashboard-metric">
      <p>{label}</p>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </Card>
  );
}
