import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { identityApiRequest } from '../../api/identity-request';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  FormField,
  StatusBadge,
  TextInput,
} from '../../ui/primitives';
import { acquisitionApi } from '../acquisition/api';
import { staffApi } from '../api/client';
import { formatCny } from '../shared/format';
import { OperatingIntegrityCenter } from './OperatingIntegrityCenter';

const dailySchema = z
  .object({
    from_date: z.string(),
    to_date: z.string(),
    timezone: z.literal('Asia/Shanghai'),
    data_as_of: z.number().int().nonnegative(),
    reporting_precision: z
      .object({ configured: z.boolean(), business_date: z.string().nullable() })
      .strict(),
    anomalies: z
      .object({
        identity_conflicts: z.number().int().nonnegative(),
        attribution_anomalies: z.number().int().nonnegative(),
        buyer_attribution_gaps: z.number().int().nonnegative(),
        seller_attribution_gaps: z.number().int().nonnegative(),
        finance_conflicts: z.number().int().nonnegative(),
      })
      .strict(),
    totals: z
      .object({
        new_buyer_customers: z.number().int().nonnegative(),
        new_seller_customers: z.number().int().nonnegative(),
        buyer_portal_registrations: z.number().int().nonnegative(),
        seller_portal_registrations: z.number().int().nonnegative(),
        formal_orders: z.number().int().nonnegative(),
        buyer_historical_unknown_orders: z.number().int().nonnegative(),
        seller_historical_unknown_orders: z.number().int().nonnegative(),
        buyer_attribution_anomaly_orders: z.number().int().nonnegative(),
        seller_attribution_anomaly_orders: z.number().int().nonnegative(),
      })
      .strict(),
    daily: z.array(
      z
        .object({
          business_date: z.string(),
          new_buyer_customers: z.number().int().nonnegative(),
          new_seller_customers: z.number().int().nonnegative(),
          buyer_portal_registrations: z.number().int().nonnegative(),
          seller_portal_registrations: z.number().int().nonnegative(),
          formal_orders: z.number().int().nonnegative(),
          buyer_historical_unknown_orders: z.number().int().nonnegative(),
          seller_historical_unknown_orders: z.number().int().nonnegative(),
          buyer_attribution_anomaly_orders: z.number().int().nonnegative(),
          seller_attribution_anomaly_orders: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    channel_daily: z.array(
      z
        .object({
          business_date: z.string(),
          channel_id: z.string(),
          channel_name: z.string(),
          channel_label: z.string(),
          platform_name: z.string(),
          channel_status: z.enum(['ACTIVE', 'DISABLED']),
          lead_type: z.enum(['BUYER', 'SELLER']),
          marketplace_code: z.string(),
          new_customer_count: z.number().int().nonnegative(),
          formal_order_count: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();
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
const MARKETS: Record<string, string> = {
  AMAZON_JP: '亚马逊日本站',
  AMAZON_US: '亚马逊美国站',
  COUPANG_KR: 'Coupang 韩国站',
  RAKUTEN_JP: '乐天日本站',
  TIKTOK_JP: 'TikTok 日本站',
};

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
  const acquisition = useQuery({
    queryKey: [
      'staff',
      'frozen-dashboard',
      'acquisition-daily',
      session.authorization_version,
      from,
      to,
    ],
    queryFn: ({ signal }) =>
      identityApiRequest('staff', client, {
        path: `/api/staff/admin-business-dashboard/acquisition-daily?from_date=${encodeURIComponent(from)}&to_date=${encodeURIComponent(to)}`,
        method: 'GET',
        schema: dailySchema,
        signal,
      }).then((r) => r.data),
    enabled: authorized && from !== '' && to !== '',
    retry: false,
  });
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
  const precision = useQuery({
    queryKey: ['staff', 'frozen-dashboard', 'precision-config', session.authorization_version],
    queryFn: ({ signal }) =>
      acquisitionApi.reportingConfig(client, signal).then((r) => r.data.config),
    enabled: authorized,
    retry: false,
  });
  const activate = useMutation({
    mutationFn: ({ date, version }: { date: string; version: number }) =>
      acquisitionApi.activateReportingConfig(
        client,
        { business_date: date, expected_version: version },
        crypto.randomUUID(),
      ),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['staff', 'frozen-dashboard'] }),
        client.invalidateQueries({ queryKey: ['staff', 'acquisition-core'] }),
      ]);
    },
  });
  if (!authorized)
    return (
      <main className="admin-dashboard">
        <Alert tone="danger">只有总管理员可以查看经营看板。</Alert>
      </main>
    );
  if (summary.isPending || acquisition.isPending || financial.isPending || precision.isPending)
    return (
      <main className="admin-dashboard">
        <p role="status">加载中…</p>
      </main>
    );
  if (summary.isError || acquisition.isError || financial.isError || precision.isError)
    return (
      <main className="admin-dashboard">
        <Alert tone="danger">数据加载失败，请重试。</Alert>
      </main>
    );
  const business = summary.data,
    value = acquisition.data,
    money = financial.data,
    config = precision.data;
  const historicalUnknown =
    value.totals.buyer_historical_unknown_orders + value.totals.seller_historical_unknown_orders;
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
          {value.from_date} 至 {value.to_date} · 北京时间
        </p>
      </section>
      {config.precision_started_business_date === null ? (
        <PrecisionActivation
          version={config.version}
          busy={activate.isPending}
          onActivate={(date) => activate.mutate({ date, version: config.version })}
        />
      ) : (
        <Alert tone="success">
          精确渠道统计起始日：{config.precision_started_business_date}
          。起始日前已有客户统一视为“历史客户 / 来源未知”；起始日后的来源缺失会作为异常处理。
        </Alert>
      )}
      <OperatingIntegrityCenter anomalies={value.anomalies} />
      <section>
        <div className="dashboard-section-heading">
          <div>
            <h2>资金与经营口径</h2>
            <p>
              这是现有权威账本的只读汇总，不新增第二套财务账。实际现金流按真实付款/冲正时间统计。
            </p>
          </div>
        </div>
        <div className="dashboard-metric-grid">
          <Metric
            label="卖家实际入账"
            value={formatCny(money.seller_cash_in_cny_fen)}
            detail="Seller Payment，已完全冲正付款不计入"
          />
          <Metric
            label="买家实际支出"
            value={formatCny(money.buyer_cash_out_cny_fen)}
            detail="正常返款 + 提前本金，自动抵扣不重复算现金"
          />
          <Metric
            label="实际净现金流"
            value={formatCny(money.net_cash_flow_cny_fen)}
            detail="卖家实际入账 − 买家实际支出"
          />
          <Metric
            label="本期卖家应结"
            value={formatCny(money.seller_payable_due_cny_fen)}
            detail={`当前已匹配 ${formatCny(money.seller_payable_paid_cny_fen)} · 未结 ${formatCny(money.seller_payable_outstanding_cny_fen)}`}
          />
          <Metric
            label="本期买家应返"
            value={formatCny(money.buyer_refund_due_cny_fen)}
            detail={`当前已返 ${formatCny(money.buyer_refund_paid_cny_fen)} · 未返 ${formatCny(money.buyer_refund_outstanding_cny_fen)}`}
          />
          <Metric
            label="预计利润（投影）"
            value={formatCny(money.projected_profit_cny_fen)}
            detail={`含利润补偿 ${formatCny(money.projected_profit_adjustment_cny_fen)}`}
          />
          <Metric
            label="已完成利润（投影）"
            value={formatCny(money.completed_profit_cny_fen)}
            detail={`含利润补偿 ${formatCny(money.completed_profit_adjustment_cny_fen)}`}
          />
        </div>
      </section>
      <section>
        <h2>客户与订单概览</h2>
        <div className="dashboard-metric-grid">
          <Metric
            label="新增买家客户"
            value={value.totals.new_buyer_customers}
            detail="保存成功后成为不可变经营事实"
          />
          <Metric
            label="新增卖家客户"
            value={value.totals.new_seller_customers}
            detail="保存成功即建立正式卖家业务主体"
          />
          <Metric
            label="买家网站注册"
            value={value.totals.buyer_portal_registrations}
            detail="实际完成注册链接"
          />
          <Metric
            label="卖家网站开通"
            value={value.totals.seller_portal_registrations}
            detail="卖家主账号实际开通"
          />
          <Metric
            label="新增正式订单"
            value={value.totals.formal_orders}
            detail="按正式订单确认日期统计"
          />
          <Metric label="新增预约" value={business.cards.reservations} />
          <Metric label="业务完成" value={business.cards.business_completions} />
          <Metric
            label="预计利润"
            value={formatCny(business.projected_profit.amount_cny_fen)}
            detail={`${business.projected_profit.valid_order_count} 单有效`}
          />
          <Metric
            label="已完成利润"
            value={formatCny(business.completed_profit.amount_cny_fen)}
            detail={`${business.completed_profit.valid_order_count} 单有效`}
          />
        </div>
        {historicalUnknown > 0 ? (
          <Alert tone="info">
            历史客户 / 来源未知：买家视角 {value.totals.buyer_historical_unknown_orders}{' '}
            单，卖家视角 {value.totals.seller_historical_unknown_orders}{' '}
            单。这是历史资料没有来源的正常分类，不属于系统错误。
          </Alert>
        ) : null}
        {value.anomalies.attribution_anomalies > 0 ? (
          <Alert tone="danger">
            精确统计期内有 {value.anomalies.attribution_anomalies}{' '}
            张正式订单存在来源归因异常；其中买家归因缺口 {value.anomalies.buyer_attribution_gaps}{' '}
            个、卖家归因缺口 {value.anomalies.seller_attribution_gaps}{' '}
            个。同一订单两边都缺来源时，异常订单只算 1 张。
          </Alert>
        ) : null}
      </section>
      <section>
        <div className="dashboard-section-heading">
          <div>
            <h2>每日新增</h2>
            <p>过去某天的新增客户不会因为客户后来无效、渠道后来停用而回写变化。</p>
          </div>
        </div>
        {value.daily.length === 0 ? (
          <EmptyState title="暂无每日数据" description="所选时间范围没有新增客户或订单。" />
        ) : (
          <DataTable caption="每日不可变新增客户、网站开通与订单">
            <thead>
              <tr>
                <th>日期</th>
                <th>新增买家</th>
                <th>新增卖家</th>
                <th>买家网站注册</th>
                <th>卖家网站开通</th>
                <th>正式订单</th>
                <th>历史买家未知</th>
                <th>历史卖家未知</th>
                <th>买家归因异常</th>
                <th>卖家归因异常</th>
              </tr>
            </thead>
            <tbody>
              {[...value.daily].reverse().map((row) => (
                <tr key={row.business_date}>
                  <td>{row.business_date}</td>
                  <td>{row.new_buyer_customers}</td>
                  <td>{row.new_seller_customers}</td>
                  <td>{row.buyer_portal_registrations}</td>
                  <td>{row.seller_portal_registrations}</td>
                  <td>
                    <strong>{row.formal_orders}</strong>
                  </td>
                  <td>{row.buyer_historical_unknown_orders}</td>
                  <td>{row.seller_historical_unknown_orders}</td>
                  <td>{row.buyer_attribution_anomaly_orders || '—'}</td>
                  <td>{row.seller_attribution_anomaly_orders || '—'}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>
      <section>
        <div className="dashboard-section-heading">
          <div>
            <h2>每天各渠道新增</h2>
            <p>
              来源纠错后按最后确认来源展示；原始来源仍永久保留在审计记录。已停用渠道的历史成绩不会消失。
            </p>
          </div>
        </div>
        {value.channel_daily.length === 0 ? (
          <EmptyState
            title="暂无渠道归因数据"
            description="新系统客户形成订单后按确认来源自动汇总。"
          />
        ) : (
          <DataTable caption="每日渠道新增客户与订单">
            <thead>
              <tr>
                <th>日期</th>
                <th>类型</th>
                <th>员工渠道</th>
                <th>真实渠道</th>
                <th>平台</th>
                <th>站点</th>
                <th>渠道状态</th>
                <th>新增客户</th>
                <th>新增订单</th>
              </tr>
            </thead>
            <tbody>
              {[...value.channel_daily].reverse().map((row) => (
                <tr key={`${row.business_date}:${row.channel_id}:${row.lead_type}`}>
                  <td>{row.business_date}</td>
                  <td>{row.lead_type === 'BUYER' ? '买家' : '卖家'}</td>
                  <td>{row.channel_label}</td>
                  <td>
                    <strong>{row.channel_name}</strong>
                  </td>
                  <td>{row.platform_name}</td>
                  <td>{MARKETS[row.marketplace_code] ?? row.marketplace_code}</td>
                  <td>
                    <StatusBadge tone={row.channel_status === 'ACTIVE' ? 'success' : 'neutral'}>
                      {row.channel_status === 'ACTIVE' ? '启用' : '已停用'}
                    </StatusBadge>
                  </td>
                  <td>{row.new_customer_count}</td>
                  <td>
                    <strong>{row.formal_order_count}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>
      <section className="dashboard-two-column" aria-label="业务漏斗">
        <Funnel title="买家漏斗" stages={business.buyer_funnel.stages} />
        <Funnel title="卖家漏斗" stages={business.seller_funnel.stages} />
      </section>
      <Alert tone="info">
        漏斗这里只展示事实数量。咨询人数是否完整请到“客户开发 →
        渠道统计”查看；数据未完整时系统不会在这里展示容易误导的转化率。
      </Alert>
    </main>
  );
}
function PrecisionActivation({
  version,
  busy,
  onActivate,
}: {
  version: number;
  busy: boolean;
  onActivate: (date: string) => void;
}) {
  const [date, setDate] = useState('');
  return (
    <Card className="dashboard-drill-down">
      <h2>启用精确渠道统计</h2>
      <Alert tone="warning">
        这是一次性经营口径分界。启用时系统会把当前已有买家和卖家快照为“历史客户 /
        来源未知”；此后新增客户必须有准确渠道，缺失会进入异常待处理。
      </Alert>
      <FormField label="精确统计起始日" htmlFor="reporting-precision-date">
        <TextInput
          id="reporting-precision-date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </FormField>
      <Button disabled={!date} loading={busy} onClick={() => onActivate(date)}>
        确认启用
      </Button>
      <small>当前配置版本 v{version}</small>
    </Card>
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
function Funnel({
  title,
  stages,
}: {
  title: string;
  stages: readonly {
    code: string;
    label: string;
    count: number;
    conversion_rate_bps: number | null;
  }[];
}) {
  return (
    <Card>
      <h2>{title}</h2>
      <ol className="dashboard-funnel">
        {stages.map((stage) => (
          <li key={stage.code}>
            <span>{stage.label}</span>
            <strong>{stage.count}</strong>
          </li>
        ))}
      </ol>
    </Card>
  );
}
