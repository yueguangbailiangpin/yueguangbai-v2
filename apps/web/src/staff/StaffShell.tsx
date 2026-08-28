import { useQueryClient } from '@tanstack/react-query';
import { Menu, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useCurrentStaffSession } from '../auth/staff/StaffSessionBoundary';
import { StaffAuthController } from '../auth/staff/staff-auth-controller';
import {
  Breadcrumb,
  Button,
  Dialog,
  IdentityShell,
  RequestIdDisplay,
} from '../ui/primitives';
import { GlobalSearchDropdown } from './shared/GlobalSearchDropdown';
import {
  formatMarketplaceScope,
  getBreadcrumbForPath,
  getPageTitleForPath,
  getVisibleNavItems,
  type StaffNavItem,
} from './staff-navigation';

/* ---- 账户操作（退出登录） ---- */

function StaffAccountActions({ compact = false }: { compact?: boolean }): React.JSX.Element {
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
    <section className="staff-account-actions" aria-label="账户操作">
      <Button
        className="secondary"
        disabled={busy}
        onClick={() => {
          void finishLogout(false);
        }}
      >
        退出登录
      </Button>
      {!compact ? (
        <Button className="danger" disabled={busy} onClick={() => setConfirming(true)}>
          退出所有设备
        </Button>
      ) : null}
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

/* ---- 导航链接 ---- */

function NavItemLink({
  item,
  onNavigate,
}: {
  item: StaffNavItem;
  onNavigate?: (() => void) | undefined;
}): React.JSX.Element {
  const Icon = item.icon;
  if (item.upcoming) {
    return (
      <span className="staff-nav-link staff-nav-upcoming" aria-disabled="true">
        <Icon aria-hidden="true" />
        <span>{item.label}</span>
        <small className="staff-nav-badge">规划中</small>
      </span>
    );
  }
  if (!item.path) return <></>;
  return (
    <NavLink
      to={item.path}
      end={item.path === '/staff'}
      className={({ isActive }) => (isActive ? 'staff-nav-link active' : 'staff-nav-link')}
      onClick={onNavigate}
    >
      <Icon aria-hidden="true" />
      <span>{item.label}</span>
    </NavLink>
  );
}

function NavGroup({
  item,
  onNavigate,
}: {
  item: StaffNavItem;
  onNavigate?: (() => void) | undefined;
}): React.JSX.Element {
  const session = useCurrentStaffSession();
  const Icon = item.icon;
  const visibleChildren = item.children!.filter((c) => c.visible(session));
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="staff-nav-group">
      <button
        type="button"
        className={expanded ? 'staff-nav-group-trigger expanded' : 'staff-nav-group-trigger'}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <Icon aria-hidden="true" />
        <span>{item.label}</span>
      </button>
      {expanded ? (
        <div className="staff-nav-group-children">
          {visibleChildren.map((child) => {
            const ChildIcon = child.icon;
            return (
              <NavLink
                key={child.id}
                to={child.path}
                className={({ isActive }) =>
                  isActive ? 'staff-nav-child-link active' : 'staff-nav-child-link'
                }
                onClick={onNavigate}
              >
                {ChildIcon ? <ChildIcon aria-hidden="true" /> : null}
                <span>{child.label}</span>
              </NavLink>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ---- 侧边导航内容（桌面侧边栏 + 移动 Drawer 共用） ---- */

function StaffNavigationContent({ onNavigate }: { onNavigate?: () => void }): React.JSX.Element {
  const session = useCurrentStaffSession();
  const items = getVisibleNavItems(session);

  return (
    <nav className="staff-primary-nav" aria-label="员工工作台主导航">
      {items.map((item) =>
        item.children ? (
          <NavGroup key={item.id} item={item} onNavigate={onNavigate} />
        ) : (
          <NavItemLink key={item.id} item={item} onNavigate={onNavigate} />
        ),
      )}
    </nav>
  );
}

/* ---- 移动端 Drawer ---- */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function StaffMobileDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.JSX.Element | null {
  const session = useCurrentStaffSession();
  const panelRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = (): HTMLElement[] =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    requestAnimationFrame(() => {
      (focusable()[0] ?? panel)?.focus();
    });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = focusable();
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) {
        e.preventDefault();
        panel.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      if (openerRef.current?.isConnected) openerRef.current.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="staff-drawer-overlay" role="presentation" onClick={onClose}>
      <aside
        className="staff-drawer"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="员工导航菜单"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="staff-drawer-header">
          <span className="staff-drawer-brand">
            <span className="staff-brand-mark small" aria-hidden="true">
              <span />
            </span>
            <strong>月光白</strong>
          </span>
          <Button
            className="secondary icon-only"
            aria-label="关闭导航菜单"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="staff-drawer-body">
          <StaffNavigationContent onNavigate={onClose} />
        </div>
        <div className="staff-drawer-footer">
          <div
            className="staff-sidebar-person"
            aria-label={`${session.display_name}（${session.role.display_name}）`}
          >
            <span className="staff-person-avatar" aria-hidden="true">
              {session.display_name.slice(0, 1)}
            </span>
            <div className="staff-person-info">
              <strong>{session.display_name}</strong>
              {/* 姓名与角色文案相同时省略重复的角色文字，角色语义由容器 aria-label 保留。 */}
              <small>
                {session.display_name === session.role.display_name
                  ? formatMarketplaceScope(session)
                  : `${session.role.display_name} · ${formatMarketplaceScope(session)}`}
              </small>
            </div>
          </div>
          <StaffAccountActions compact />
        </div>
      </aside>
    </div>
  );
}

/* ---- 主 Shell ---- */

export function StaffShell({ children }: { children?: ReactNode } = {}): React.JSX.Element {
  const session = useCurrentStaffSession();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const breadcrumb = getBreadcrumbForPath(location.pathname, session);
  const pageTitle = getPageTitleForPath(location.pathname, session);
  const scope = formatMarketplaceScope(session);

  // 路由变化时关闭 drawer
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  return (
    <IdentityShell identity="staff" className="staff-business-shell">
      {/* 64px 顶栏：品牌区 + 全局搜索胶囊 + 会话区（Material 3 控制台） */}
      <header className="staff-topbar">
        <div className="staff-topbar-brand">
          <Button
            className="secondary icon-only staff-mobile-menu-btn"
            aria-label="打开导航菜单"
            aria-expanded={drawerOpen}
            aria-controls="staff-mobile-drawer"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu aria-hidden="true" />
          </Button>
          <NavLink className="staff-brand" to="/staff" aria-label="月光白员工首页">
            <span className="staff-brand-mark" aria-hidden="true">
              <span />
            </span>
            <strong>月光白</strong>
          </NavLink>
        </div>
        <div className="staff-topbar-search">
          <GlobalSearchDropdown />
        </div>
        <div className="staff-topbar-actions">
          {/* 姓名与角色文案相同时（如"总管理员"）视觉只显示一次，
              角色语义经容器 aria-label 保留。 */}
          <div
            className="staff-session-context"
            aria-label={`当前会话信息：${session.display_name}（${session.role.display_name}）`}
          >
            <span className="staff-session-name">{session.display_name}</span>
            {session.display_name === session.role.display_name ? null : (
              <span className="staff-session-role">{session.role.display_name}</span>
            )}
            <span className="staff-session-scope">{scope}</span>
          </div>
          <span className="staff-session-avatar" aria-hidden="true">
            {session.display_name.slice(0, 1)}
          </span>
        </div>
      </header>

      <div className="staff-shell-body">
        {/* 桌面端侧边栏（240px 胶囊导航） */}
        <aside className="staff-sidebar" aria-label="员工端侧边栏">
          <StaffNavigationContent />
          <div className="staff-sidebar-footer">
            <div className="staff-sidebar-scope">{scope}</div>
            {/* 身份（头像+姓名+角色）由顶栏会话区唯一呈现，桌面侧栏不再重复整块；
                移动端由 Drawer 底部的 staff-sidebar-person 覆盖。 */}
            <StaffAccountActions />
          </div>
        </aside>

        {/* 工作区 */}
        <div className="staff-work-area">
          {/* 面包屑 + 页面标题（内容区顶部）。单一面包屑（首页只有"工作台"）
              会与页面标题逐字重复，此时只保留标题一个可见上下文。 */}
          <div className="staff-content-heading">
            {breadcrumb.length > 1 ? <Breadcrumb items={breadcrumb} /> : null}
            <h1>{pageTitle}</h1>
          </div>

          {/* 内容区 */}
          <main className="staff-main-content" id="staff-main-content">
            {children ?? <Outlet />}
          </main>
        </div>
      </div>

      {/* 移动端 Drawer */}
      <StaffMobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </IdentityShell>
  );
}
