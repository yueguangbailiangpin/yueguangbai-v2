import { useQueryClient } from '@tanstack/react-query';
import { BriefcaseBusiness, CalendarDays, ChartNoAxesCombined, UserCog, UserPlus, UserRound } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useRef, useState, type ReactNode } from 'react';
import { useCurrentStaffSession } from '../auth/staff/StaffSessionBoundary';
import { StaffAuthController } from '../auth/staff/staff-auth-controller';
import { Button, Dialog, IdentityShell, RequestIdDisplay } from '../ui/primitives';

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
  const accessManagement = location.pathname.startsWith('/staff/access-management');
  const productScheduling = location.pathname.startsWith('/staff/products')
    || /^\/staff\/demands\/[^/]+\/reservations$/u.test(location.pathname);
  const mayViewProducts = session.permissions.includes('PRODUCT_VIEW');
  const mayViewDashboard = session.role.code === 'owner'
    && session.permissions.includes('FINANCIAL_VIEW');
  const mayManageStaff = session.role.code === 'owner'
    && session.permissions.includes('STAFF_MANAGE')
    && session.permissions.includes('PERMISSION_MANAGE');
  const mayViewAcquisition = session.role.code === 'owner'
    ? session.permissions.some((permission) => ['ACQUISITION_ADMIN', 'ACQUISITION_BUYER_LEAD', 'ACQUISITION_SELLER_LEAD'].includes(permission))
    : session.role.code === 'pre_sales'
      ? session.permissions.includes('ACQUISITION_BUYER_LEAD')
      : session.role.code === 'seller_ops'
        && session.permissions.includes('ACQUISITION_SELLER_LEAD');
  const workQueue = !acquisition && !dashboard && !productScheduling && !accessManagement;
  const title = accessManagement ? '员工权限' : dashboard ? '经营看板' : productScheduling ? '产品预约排期'
    : acquisition ? '获客登记' : '员工工作台';
  const context = accessManagement ? '角色、启停与飞书绑定' : dashboard ? '经营与利润事实' : productScheduling ? '产品、预约与排期'
    : acquisition ? '渠道与线索' : '队列、详情与受控操作';
  return <IdentityShell identity="staff" className="staff-business-shell">
    <aside className="staff-sidebar">
      <NavLink className="staff-sidebar-brand" to="/staff" aria-label="月光白员工首页">月光白</NavLink>
      <nav className="staff-primary-nav" aria-label="员工工作台导航">
        <NavLink to="/staff" end className={workQueue ? 'active' : ''} {...(workQueue ? { 'aria-current': 'page' as const } : {})}>
          <BriefcaseBusiness aria-hidden="true" /><span>工作队列</span>
        </NavLink>
        {mayViewAcquisition ? <NavLink to="/staff/acquisition">
          <UserPlus aria-hidden="true" /><span>获客登记</span>
        </NavLink> : null}
        {mayViewProducts ? <NavLink to="/staff/products">
          <CalendarDays aria-hidden="true" /><span>产品预约</span>
        </NavLink> : null}
        {mayViewDashboard ? <NavLink to="/staff/admin-business-dashboard">
          <ChartNoAxesCombined aria-hidden="true" /><span>经营看板</span>
        </NavLink> : null}
        {mayManageStaff ? <NavLink to="/staff/access-management">
          <UserCog aria-hidden="true" /><span>员工权限</span>
        </NavLink> : null}
      </nav>
      <div className="staff-sidebar-person">
        <UserRound aria-hidden="true" />
        <span><strong>{session.display_name}</strong><small>{session.role.display_name}</small></span>
      </div>
    </aside>
    <div className="staff-work-area">
      <header className="staff-context-bar">
        <NavLink className="staff-mobile-brand" to="/staff">月光白</NavLink>
        <div><p>{context}</p><h1>{title}</h1></div>
        <div className="staff-session-context">
          <span>{session.display_name}</span><strong>{session.role.display_name}</strong><small>时间口径：北京时间</small>
        </div>
      </header>
      <div className="staff-main">{children ?? <Outlet />}</div>
      <footer className="staff-account-footer"><StaffAccountActions /></footer>
    </div>
  </IdentityShell>;
}
