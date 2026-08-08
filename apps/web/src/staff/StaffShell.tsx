import { useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useRef, useState, type ReactNode } from 'react';
import { useCurrentStaffSession } from '../auth/staff/StaffSessionBoundary';
import { StaffAuthController } from '../auth/staff/staff-auth-controller';
import { Button, Dialog, IdentityShell, PageHeader, RequestIdDisplay } from '../ui/primitives';

function StaffAccountActions(): React.JSX.Element {
  const client = useQueryClient(); const navigate = useNavigate(); const [confirming, setConfirming] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<string | null>(null); const [requestId, setRequestId] = useState<string | null>(null); const controller = useRef<StaffAuthController | null>(null); controller.current ??= new StaffAuthController(client);
  async function finishLogout(all: boolean): Promise<void> { setBusy(true); setMessage(null); const result = all ? await controller.current!.logoutAll() : await controller.current!.logout(); setRequestId(result.requestId); if (result.kind === 'LOGGED_OUT') navigate('/staff/login', { replace: true }); else setMessage(result.kind === 'IDEMPOTENCY_CONFLICT' ? '该操作发生冲突，请结束后重新发起。' : result.kind === 'REQUEST_IN_PROGRESS' || result.kind === 'ALREADY_SUBMITTING' ? '操作正在处理中，请勿重复提交。' : '退出未完成，请由您决定是否重试。'); setBusy(false); }
  const cancel = (): void => { if (!busy) { controller.current!.cancelLogoutAll(); setConfirming(false); setMessage(null); } };
  return <section className="staff-account-actions" aria-label="账户操作"><Button className="secondary" disabled={busy} onClick={() => { void finishLogout(false); }}>退出登录</Button><Button className="danger" disabled={busy} onClick={() => setConfirming(true)}>退出所有设备</Button>{message ? <p className="inline-error" role="alert">{message}</p> : null}<RequestIdDisplay requestId={requestId} /><Dialog open={confirming} title="退出所有设备" description="这会使其他设备上的员工会话失效。" busy={busy} onClose={cancel}><div className="entry-actions"><Button className="secondary" disabled={busy} onClick={cancel}>取消</Button><Button className="danger" loading={busy} loadingLabel="正在退出" onClick={() => { void finishLogout(true); }}>确认退出所有设备</Button></div></Dialog></section>;
}

export function StaffShell({ children }: { children?: ReactNode } = {}): React.JSX.Element {
  const session = useCurrentStaffSession();
  const location = useLocation();
  const acquisition = location.pathname.startsWith('/staff/acquisition');
  const dashboard = location.pathname.startsWith('/staff/admin-business-dashboard');
  const productScheduling = location.pathname.startsWith('/staff/products')
    || /^\/staff\/demands\/[^/]+\/reservations$/u.test(location.pathname);
  const mayViewProducts = session.permissions.includes('PRODUCT_VIEW');
  const mayViewDashboard = session.role.code === 'owner'
    && session.permissions.includes('FINANCIAL_VIEW');
  return <IdentityShell identity="staff" className="staff-shell">
    <header className="staff-context"><strong>月光白</strong>
      <span>{session.display_name} · {session.role.display_name}</span></header>
    <nav className="staff-primary-nav" aria-label="员工工作台导航">
      <NavLink to="/staff" end>工作队列</NavLink>
      <NavLink to="/staff/acquisition">获客登记</NavLink>
      {mayViewProducts ? <NavLink to="/staff/products">产品预约</NavLink> : null}
      {mayViewDashboard ? <NavLink to="/staff/admin-business-dashboard">经营看板</NavLink> : null}
    </nav>
    <PageHeader
      eyebrow="内部操作"
      title={dashboard ? '经营看板' : productScheduling ? '产品预约排期'
        : acquisition ? '获客登记' : '员工工作台'}
      description={dashboard ? '按北京时间核对获客、订单与内部利润事实。'
        : productScheduling ? '按不可变预约顺序查看排名，并以北京时间自然日维护下单排期。'
          : acquisition ? '添加微信后登记单人线索；渠道由后端自动带入。'
          : '队列、详情与操作保持清晰的阅读和处理顺序。'}
    />
    {children ?? <Outlet />}
    <footer className="staff-account-footer"><StaffAccountActions /></footer>
  </IdentityShell>;
}
