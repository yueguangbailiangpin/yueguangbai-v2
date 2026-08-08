import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { isFrontendApiError } from '../../api/errors';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import {
  Alert, Button, Card, DataTable, EmptyState, RequestIdDisplay, Select,
  StatusBadge,
} from '../../ui/primitives';
import { staffApi } from '../api/client';
import type {
  AdminDashboardSummary,
} from '../contracts/runtime';
import { staffWorkbenchKeys } from '../queries/keys';

type WindowKey = 'TODAY'|'WEEK'|'MONTH';
type Granularity = 'DAY'|'WEEK'|'MONTH';
type DrillMetric = 'NEW_BUYERS'|'RESERVATIONS'|'FORMAL_ORDERS'|'BUSINESS_COMPLETIONS'
  |'PROJECTED_PROFIT_CONFLICTS'|'COMPLETED_PROFIT_CONFLICTS';

const windowLabels: Record<WindowKey, string> = {
  TODAY: '今日', WEEK: '本周', MONTH: '本月',
};
const drillLabels: Record<DrillMetric, string> = {
  NEW_BUYERS: '新增买家', RESERVATIONS: '新增预约', FORMAL_ORDERS: '正式订单',
  BUSINESS_COMPLETIONS: '业务完成', PROJECTED_PROFIT_CONFLICTS: '预计利润冲突',
  COMPLETED_PROFIT_CONFLICTS: '已完成利润冲突',
};

export function AdminBusinessDashboard(): React.JSX.Element {
  const client = useQueryClient();
  const session = useCurrentStaffSession();
  const authorized = session.role.code === 'owner'
    && session.permissions.includes('FINANCIAL_VIEW');
  const [window, setWindow] = useState<WindowKey>('TODAY');
  const [granularity, setGranularity] = useState<Granularity>('DAY');
  const [customFrom, setCustomFrom] = useState<string | null>(null);
  const [customTo, setCustomTo] = useState<string | null>(null);
  const [drillMetric, setDrillMetric] = useState<DrillMetric | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([]);

  useEffect(() => () => {
    client.removeQueries({ queryKey: staffWorkbenchKeys.adminDashboard });
  }, [client]);

  const summary = useQuery({
    queryKey: staffWorkbenchKeys.adminDashboardSummary(session.authorization_version, window),
    queryFn: ({ signal }) => staffApi.adminDashboardSummary(client, window, signal)
      .then((response) => response.data.summary),
    enabled: authorized,
    retry: false,
  });
  const from = customFrom ?? summary.data?.window.from_date ?? '';
  const to = customTo ?? summary.data?.window.to_date ?? '';
  const trend = useQuery({
    queryKey: staffWorkbenchKeys.adminDashboardTrend(
      session.authorization_version, from, to, granularity,
    ),
    queryFn: ({ signal }) => staffApi.adminDashboardTrend(client, {
      from, to, granularity,
    }, signal).then((response) => response.data.trend),
    enabled: authorized && from !== '' && to !== '',
    retry: false,
  });
  const drill = useQuery({
    queryKey: staffWorkbenchKeys.adminDashboardDrillDown(
      session.authorization_version, drillMetric ?? '', from, to, cursor,
    ),
    queryFn: ({ signal }) => staffApi.adminDashboardDrillDown(client, {
      metric: drillMetric!, from, to, cursor,
    }, signal).then((response) => response.data.drill_down),
    enabled: authorized && drillMetric !== null && from !== '' && to !== '',
    retry: false,
  });

  function selectWindow(next: WindowKey): void {
    setWindow(next);
    setCustomFrom(null);
    setCustomTo(null);
    closeDrillDown();
  }
  function openDrillDown(metric: DrillMetric): void {
    setDrillMetric(metric);
    setCursor(null);
    setCursorHistory([]);
  }
  function closeDrillDown(): void {
    setDrillMetric(null);
    setCursor(null);
    setCursorHistory([]);
  }

  if (!authorized) {
    return <main className="admin-dashboard"><Alert tone="danger">
      当前员工身份没有经营看板权限。后端仍会重新校验总管理员、财务查看权限和个人禁用。
    </Alert></main>;
  }
  if (summary.isPending) return <main className="admin-dashboard"><p role="status">正在加载经营数据</p></main>;
  if (summary.isError) return <main className="admin-dashboard"><DashboardError error={summary.error} retry={() => { void summary.refetch(); }} /></main>;

  const value = summary.data;
  return <main className="admin-dashboard">
    <section className="dashboard-toolbar" aria-label="看板统计窗口">
      <div className="dashboard-window-switch" role="group" aria-label="统计窗口">
        {(Object.keys(windowLabels) as WindowKey[]).map((key) => <Button
          key={key} className={key === window ? '' : 'secondary'}
          aria-pressed={key === window} onClick={() => selectWindow(key)}
        >{windowLabels[key]}</Button>)}
      </div>
      <p>{value.window.from_date} 至 {value.window.to_date} · 北京时间 · 数据截至 {formatAsOf(value.window.data_as_of)}</p>
    </section>

    <section aria-labelledby="dashboard-cards-title">
      <h2 id="dashboard-cards-title">经营概览</h2>
      <div className="dashboard-metric-grid">
        <DashboardMetric label="新增买家" value={value.cards.new_buyers} onClick={() => openDrillDown('NEW_BUYERS')} />
        <DashboardMetric label="新增预约" value={value.cards.reservations} onClick={() => openDrillDown('RESERVATIONS')} />
        <DashboardMetric label="正式订单" value={value.cards.formal_orders} onClick={() => openDrillDown('FORMAL_ORDERS')} />
        <DashboardMetric label="业务完成" value={value.cards.business_completions} onClick={() => openDrillDown('BUSINESS_COMPLETIONS')} />
        <DashboardMetric label="预计利润" value={formatCny(value.projected_profit.amount_cny_fen)}
          detail={`${value.projected_profit.valid_order_count} 单有效 · ${value.projected_profit.conflict_order_count} 单冲突`}
          onClick={() => openDrillDown('PROJECTED_PROFIT_CONFLICTS')} />
        <DashboardMetric label="已完成利润" value={formatCny(value.completed_profit.amount_cny_fen)}
          detail={`${value.completed_profit.valid_order_count} 单有效 · ${value.completed_profit.conflict_order_count} 单冲突`}
          onClick={() => openDrillDown('COMPLETED_PROFIT_CONFLICTS')} />
      </div>
      {value.projected_profit.conflict_order_count + value.completed_profit.conflict_order_count > 0
        ? <Alert tone="warning">存在财务事实缺失或冲突；冲突订单未按零计入利润。</Alert> : null}
    </section>

    {isEmpty(value) ? <EmptyState title="当前窗口暂无经营事实" description="看板不会用假数据填充空窗口。" /> : <>
      <section className="dashboard-two-column" aria-label="获客漏斗">
        <Funnel title="买家漏斗" stages={value.buyer_funnel.stages}
          footer={`未参加：${value.buyer_funnel.no_participation_count}`} />
        <Funnel title="卖家漏斗" stages={value.seller_funnel.stages} />
      </section>
      <PerformanceTable title="员工来源业绩" rows={value.staff_performance} staff />
      <PerformanceTable title="渠道业绩" rows={value.channel_performance} />
    </>}

    <section aria-labelledby="dashboard-trend-title">
      <div className="dashboard-section-heading"><h2 id="dashboard-trend-title">经营趋势</h2>
        <label htmlFor="dashboard-granularity">粒度</label>
        <Select id="dashboard-granularity" value={granularity}
          onChange={(event) => setGranularity(event.target.value as Granularity)}>
          <option value="DAY">日</option><option value="WEEK">周</option><option value="MONTH">月</option>
        </Select></div>
      <div className="dashboard-date-range">
        <label htmlFor="dashboard-from">开始日期</label><input id="dashboard-from" type="date" value={from}
          onChange={(event) => { setCustomFrom(event.target.value); closeDrillDown(); }} />
        <label htmlFor="dashboard-to">结束日期</label><input id="dashboard-to" type="date" value={to}
          onChange={(event) => { setCustomTo(event.target.value); closeDrillDown(); }} />
      </div>
      {trend.isPending ? <p role="status">正在加载趋势</p>
        : trend.isError ? <DashboardError error={trend.error} retry={() => { void trend.refetch(); }} />
        : trend.data.points.length === 0 ? <EmptyState title="暂无趋势" description="所选范围没有可展示的时间段。" />
        : <DataTable caption="经营趋势（服务端按北京时间分组）"><thead><tr>
          <th scope="col">日期</th><th scope="col">买家</th><th scope="col">预约</th>
          <th scope="col">订单</th><th scope="col">完成</th><th scope="col">预计利润</th><th scope="col">已完成利润</th>
        </tr></thead><tbody>{trend.data.points.map((point) => <tr key={`${point.from_date}-${point.to_date}`}>
          <td>{point.from_date === point.to_date ? point.from_date : `${point.from_date} 至 ${point.to_date}`}</td>
          <td>{point.new_buyers}</td><td>{point.reservations}</td><td>{point.formal_orders}</td>
          <td>{point.business_completions}</td><td>{formatCny(point.projected_profit.amount_cny_fen)}</td>
          <td>{formatCny(point.completed_profit.amount_cny_fen)}</td>
        </tr>)}</tbody></DataTable>}
    </section>

    {drillMetric ? <section aria-labelledby="dashboard-drill-title" className="dashboard-drill-down">
      <div className="dashboard-section-heading"><h2 id="dashboard-drill-title">{drillLabels[drillMetric]}明细</h2>
        <Button className="secondary" onClick={closeDrillDown}>关闭明细</Button></div>
      {drill.isPending ? <p role="status">正在加载明细</p>
        : drill.isError ? <DashboardError error={drill.error} retry={() => { void drill.refetch(); }} />
        : drill.data.items.length === 0 ? <EmptyState title="没有明细" description="该窗口没有对应事实或冲突。" />
        : <><DataTable caption={`${drillLabels[drillMetric]}受控明细`}><thead><tr>
          <th scope="col">受控编号</th><th scope="col">业务日期</th><th scope="col">状态</th>
        </tr></thead><tbody>{drill.data.items.map((item) => <tr key={item.reference_id}>
          <td>{item.reference_id}</td><td>{item.business_date}</td><td><StatusBadge tone={item.status.includes('CONFLICT') || item.status.includes('MISSING') ? 'conflict' : 'neutral'}>{statusLabel(item.status)}</StatusBadge></td>
        </tr>)}</tbody></DataTable><nav className="pagination-actions" aria-label="明细分页">
          <Button className="secondary" disabled={cursorHistory.length === 0} onClick={() => {
            const previous = cursorHistory.at(-1) ?? null; setCursor(previous);
            setCursorHistory((all) => all.slice(0, -1));
          }}>上一页</Button>
          <Button className="secondary" disabled={!drill.data.next_cursor} onClick={() => {
            setCursorHistory((all) => [...all, cursor]); setCursor(drill.data.next_cursor);
          }}>下一页</Button>
        </nav></>}
    </section> : null}
  </main>;
}

function DashboardMetric({ label, value, detail, onClick }: {
  label: string; value: string|number; detail?: string; onClick: () => void;
}): React.JSX.Element {
  return <Card className="dashboard-metric"><p>{label}</p><strong>{value}</strong>
    {detail ? <small>{detail}</small> : null}<Button className="secondary" onClick={onClick}>查看明细</Button></Card>;
}

function Funnel({ title, stages, footer }: {
  title: string; stages: AdminDashboardSummary['buyer_funnel']['stages']; footer?: string;
}): React.JSX.Element {
  return <Card><h2>{title}</h2><ol className="dashboard-funnel">{stages.map((stage) => <li key={stage.code}>
    <span>{stage.label}</span><strong>{stage.count}</strong>
    <small>{stage.conversion_rate_bps === null ? '转化率—' : `转化率 ${formatRate(stage.conversion_rate_bps)}`}</small>
  </li>)}</ol>{footer ? <p>{footer}</p> : null}</Card>;
}

function PerformanceTable({ title, rows, staff = false }: {
  title: string; rows: AdminDashboardSummary['staff_performance']; staff?: boolean;
}): React.JSX.Element {
  return <section aria-labelledby={`${staff ? 'staff' : 'channel'}-performance-title`}><h2 id={`${staff ? 'staff' : 'channel'}-performance-title`}>{title}</h2>
    {rows.length === 0 ? <EmptyState title={`暂无${title}`} description="所选窗口没有可归因事实。" />
      : <DataTable caption={`${title}，来源贡献与当前工作量分开`}><thead><tr>
        <th scope="col">{staff ? '员工' : '渠道'}</th><th scope="col">咨询</th><th scope="col">买家线索</th>
        <th scope="col">注册</th><th scope="col">预约</th><th scope="col">订单</th><th scope="col">完成</th>
        <th scope="col">未参加</th><th scope="col">卖家线索</th><th scope="col">卖家合作</th>{staff ? <th scope="col">当前负责</th> : null}
        <th scope="col">预计利润</th><th scope="col">已完成利润</th>
      </tr></thead><tbody>{rows.map((row) => <tr key={row.dimension_id}>
        <th scope="row">{row.dimension_name}</th><td>{row.consultation_count ?? '—'}</td>
        <td>{row.buyer_lead_count}</td><td>{row.buyer_registered_count}</td><td>{row.buyer_reservation_count}</td>
        <td>{row.buyer_formal_order_count}</td><td>{row.buyer_business_completed_count}</td>
        <td>{row.buyer_no_participation_count}</td><td>{row.seller_lead_count}</td>
        <td>{row.seller_cooperation_count}</td>
        {staff ? <td>{row.current_owner_active_lead_count ?? '—'}</td> : null}
        <td>{formatCny(row.projected_profit.amount_cny_fen)}</td><td>{formatCny(row.completed_profit.amount_cny_fen)}</td>
      </tr>)}</tbody></DataTable>}
  </section>;
}

function DashboardError({ error, retry }: { error: unknown; retry: () => void }): React.JSX.Element {
  const requestId = isFrontendApiError(error) ? error.requestId : null;
  return <Alert tone="danger"><p>经营数据加载失败，请重试。</p><RequestIdDisplay requestId={requestId} />
    <Button className="secondary" onClick={retry}>重试</Button></Alert>;
}

function isEmpty(value: AdminDashboardSummary): boolean {
  return Object.values(value.cards).every((count) => count === 0)
    && value.staff_performance.length === 0 && value.channel_performance.length === 0;
}

function formatRate(bps: number): string {
  return `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, '0')}%`;
}

function formatCny(value: string): string {
  const amount = BigInt(value);
  const sign = amount < 0n ? '-' : '';
  const absolute = amount < 0n ? -amount : amount;
  return `${sign}¥${(absolute / 100n).toLocaleString('zh-CN')}.${String(absolute % 100n).padStart(2, '0')}`;
}

function formatAsOf(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function statusLabel(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    ACTIVE: '有效', PENDING_REVIEW: '待审核', APPROVED: '已批准', REJECTED: '已拒绝',
    CANCELLED: '已取消', EXPIRED: '已过期', CONFIRMED: '已确认', CLOSED: '已完成',
    MISSING_FINANCIAL_SNAPSHOT: '缺少财务快照',
    MULTIPLE_FINANCIAL_SNAPSHOTS: '财务快照冲突',
    MISSING_PRINCIPAL_PAYABLE: '缺少卖家本金事实',
    MISSING_SERVICE_FEE_PAYABLE: '缺少服务费事实',
    MISSING_BUYER_REFUND_OBLIGATION: '缺少买家返款事实',
    REVIEW_APPROVAL_CONFLICT: '评论批准事实冲突',
    SELLER_ORGANIZATION_MISMATCH: '卖家组织不一致',
    AMOUNT_MISMATCH: '金额不一致', LEDGER_CONFLICT: '账本冲突',
  };
  return labels[value] ?? '需要核对';
}
