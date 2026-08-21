import { useQueryClient } from '@tanstack/react-query';
import {
  BriefcaseBusiness,
  ChartNoAxesCombined,
  PackageSearch,
  Settings,
  Sparkles,
  UserCog,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useRef, useState, type ReactNode } from 'react';
import { useCurrentStaffSession } from '../auth/staff/StaffSessionBoundary';
import { StaffAuthController } from '../auth/staff/staff-auth-controller';
import { Button, Dialog, IdentityShell, RequestIdDisplay } from '../ui/primitives';

const MARKET_LABELS: Record<string, string> = {
  AMAZON_JP: '亚马逊日本站',
  AMAZON_US: '亚马逊美国站',
  COUPANG_KR: 'Coupang 韩国站',
  RAKUTEN_JP: '乐天日本站',
  TIKTOK_JP: 'TikTok 日本站',
};

function StaffAccountActions(): React.JSX.Element {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const controller = useRef<StaffAuthController | null>(null);
  controller.current ??= new StaffAuthController(client);
  async function finishLogout(all: boolean): Promise<void> {
    setBusy(true);
    setMessage(null);
    const result = all ? await controller.current!.logoutAll() : await controller.current!.logout();
    setRequestId(result.requestId);
    if (result.kind === 'LOGGED_OUT') navigate('/staff/login', { replace: true });
    else
      setMessage(
        result.kind === 'IDEMPOTENCY_CONFLICT'
          ? '操作冲突，请结束后重新发起。'
          : result.kind === 'REQUEST_IN_PROGRESS' || result.kind === 'ALREADY_SUBMITTING'
            ? '操作处理中，不要重复提交。'
            : '退出没成功，再试一次。',
      );
    setBusy(false);
  }
  const cancel = (): void => {
    if (!busy) {
      controller.current!.cancelLogoutAll();
      setConfirming(false);
      setMessage(null);
    }
  };
  return (
    <section className="staff-account-actions" aria-label="账户">
      <Button
        className="secondary"
        disabled={busy}
        onClick={() => {
          void finishLogout(false);
        }}
      >
        退出登录
      </Button>
      <Button className="danger" disabled={busy} onClick={() => setConfirming(true)}>
        退出所有设备
      </Button>
      {message ? (
        <p className="inline-error" role="alert">
          {message}
        </p>
      ) : null}
      <RequestIdDisplay requestId={requestId} />
      <Dialog
        open={confirming}
        title="退出所有设备"
        description="这会使其他设备上的员工会话立即失效。"
        busy={busy}
        onClose={cancel}
      >
        <div className="entry-actions">
          <Button className="secondary" disabled={busy} onClick={cancel}>
            取消
          </Button>
          <Button
            className="danger"
            loading={busy}
            loadingLabel="退出中…"
            onClick={() => {
              void finishLogout(true);
            }}
          >
            确认退出所有设备
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

export function StaffShell({ children }: { children?: ReactNode } = {}): React.JSX.Element {
  const session = useCurrentStaffSession();
  const location = useLocation();
  const role = session.role.code;
  const acquisition = location.pathname.startsWith('/staff/acquisition');
  const buyerCustomers = location.pathname.startsWith('/staff/buyer-customers');
  const sellerCustomers = location.pathname.startsWith('/staff/seller-customers');
  const dashboard = location.pathname.startsWith('/staff/admin-business-dashboard');
  const access = location.pathname.startsWith('/staff/access-management');
  const pricing = location.pathname.startsWith('/staff/seller-principal-rate-policies');
  const products =
    location.pathname.startsWith('/staff/products') ||
    /^\/staff\/demands\/[^/]+\/reservations$/u.test(location.pathname);
  const workQueue =
    !acquisition &&
    !buyerCustomers &&
    !sellerCustomers &&
    !dashboard &&
    !access &&
    !pricing &&
    !products;
  const owner = role === 'owner';
  const home = role === 'acquisition' ? '/staff/acquisition' : '/staff';
  const mayProducts = owner || role === 'pre_sales' || role === 'seller_ops';
  const title = access
    ? '员工管理'
    : pricing
      ? '卖家本金汇率策略'
      : dashboard
        ? '经营看板'
        : products
          ? '产品库'
          : acquisition
            ? '客户开发'
            : buyerCustomers
              ? '买家客户'
              : sellerCustomers
                ? '卖家客户'
                : '员工工作台';
  const context = access
    ? '邮箱、岗位、负责站点与状态'
    : pricing
      ? '默认加点、卖家覆盖与总管理员决策'
      : dashboard
        ? '经营与利润数据'
        : products
          ? '产品库、版本与预约排期'
          : acquisition
            ? '渠道、潜在线索与自动开发入口'
            : buyerCustomers
              ? '售前：接入买家并确认渠道'
              : sellerCustomers
                ? '卖家对接：接入卖家并确认渠道'
                : '队列、业务事实与受控操作';
  const scope =
    session.data_scope.type === 'GLOBAL'
      ? '全部站点'
      : session.data_scope.marketplaceCodes
          .map((code) => MARKET_LABELS[code] ?? '未命名站点')
          .join(' · ') || '未配置站点';
  return (
    <IdentityShell identity="staff" className="staff-business-shell">
      <aside className="staff-sidebar">
        <NavLink className="staff-sidebar-brand" to={home} aria-label="月光白员工首页">
          月光白
        </NavLink>
        <nav className="staff-primary-nav" aria-label="员工工作台导航">
          {role !== 'acquisition' ? (
            <NavLink
              to="/staff"
              end
              className={workQueue ? 'active' : ''}
              {...(workQueue ? { 'aria-current': 'page' as const } : {})}
            >
              <BriefcaseBusiness aria-hidden="true" />
              <span>工作队列</span>
            </NavLink>
          ) : null}
          {owner || role === 'acquisition' ? (
            <NavLink to="/staff/acquisition">
              <Sparkles aria-hidden="true" />
              <span>客户开发</span>
            </NavLink>
          ) : null}
          {owner || role === 'pre_sales' ? (
            <NavLink to="/staff/buyer-customers">
              <UsersRound aria-hidden="true" />
              <span>买家客户</span>
            </NavLink>
          ) : null}
          {owner || role === 'seller_ops' ? (
            <NavLink to="/staff/seller-customers">
              <UsersRound aria-hidden="true" />
              <span>卖家客户</span>
            </NavLink>
          ) : null}
          {mayProducts ? (
            <NavLink to="/staff/products">
              <PackageSearch aria-hidden="true" />
              <span>产品库</span>
            </NavLink>
          ) : null}
          {owner ? (
            <NavLink to="/staff/admin-business-dashboard">
              <ChartNoAxesCombined aria-hidden="true" />
              <span>经营看板</span>
            </NavLink>
          ) : null}
          {(owner || role === 'seller_ops') && session.permissions.includes('SELLER_MANAGE') ? (
            <NavLink to="/staff/seller-principal-rate-policies">
              <Settings aria-hidden="true" />
              <span>本金汇率策略</span>
            </NavLink>
          ) : null}
          {owner && session.permissions.includes('STAFF_MANAGE') ? (
            <NavLink to="/staff/access-management">
              <UserCog aria-hidden="true" />
              <span>员工管理</span>
            </NavLink>
          ) : null}
        </nav>
        <div className="staff-sidebar-person">
          <UserRound aria-hidden="true" />
          <span>
            <strong>{session.display_name}</strong>
            <small>{session.role.display_name}</small>
          </span>
        </div>
      </aside>
      <div className="staff-work-area">
        <header className="staff-context-bar">
          <NavLink className="staff-mobile-brand" to={home}>
            月光白
          </NavLink>
          <div>
            <p>{context}</p>
            <h1>{title}</h1>
          </div>
          <div className="staff-session-context">
            <span>{session.display_name}</span>
            <strong>{session.role.display_name}</strong>
            <small>{scope}</small>
          </div>
        </header>
        <div className="staff-main">{children ?? <Outlet />}</div>
        <footer className="staff-account-footer">
          <StaffAccountActions />
        </footer>
      </div>
    </IdentityShell>
  );
}
