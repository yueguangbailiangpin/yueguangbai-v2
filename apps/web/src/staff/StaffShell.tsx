import { useQueryClient } from '@tanstack/react-query';
import { Menu, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useCurrentStaffSession } from '../auth/staff/StaffSessionBoundary';
import { StaffAuthController } from '../auth/staff/staff-auth-controller';
import { Breadcrumb } from '../ui/primitives';
import { GlobalSearchDropdown } from './shared/GlobalSearchDropdown';
import {
  formatMarketplaceScope,
  getBreadcrumbForPath,
  getPageTitleForPath,
  getVisibleNavItems,
  staffNavSectionLabel,
  type StaffNavItem,
} from './staff-navigation';

/* ---- 账户操作（退出登录） ---- */

function StaffAccountActions({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const controller = useRef<StaffAuthController | null>(null);
  controller.current ??= new StaffAuthController(client);

  async function finishLogout(all: boolean): Promise<void> {
    setBusy(true);
    setMessage(null);
    const result = all ? await controller.current!.logoutAll() : await controller.current!.logout();
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
    <section aria-label="账户操作" className="sa-sidebar__actions">
      <button type="button" className="sa-btn sa-btn--ghost sa-btn--small" disabled={busy} onClick={() => void finishLogout(false)}>
        退出登录
      </button>
      {!compact ? (
        <button type="button" className="sa-btn sa-btn--secondary sa-btn--small" disabled={busy} onClick={() => setConfirming(true)}>
          退出所有设备
        </button>
      ) : null}
      {message ? (
        <p role="alert" className="sp-inline-error">
          {message}
        </p>
      ) : null}
      {confirming ? (
        <div className="sa-drawer-overlay" role="presentation" onClick={cancel}>
          <div
            className="sa-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="退出所有设备"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>退出所有设备</h3>
            <p className="sp-page-head__meta">这会使其他设备上的员工会话立即失效。</p>
            <div className="sp-dialog-actions">
              <button type="button" className="sa-btn sa-btn--secondary sa-btn--small" disabled={busy} onClick={cancel}>
                取消
              </button>
              <button type="button" className="sa-btn sa-btn--danger sa-btn--small" disabled={busy} onClick={() => void finishLogout(true)}>
                确认退出所有设备
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
  return (
    <NavLink
      to={item.path!}
      end={item.path === '/staff'}
      className={({ isActive }) => (isActive ? 'sa-nav__link is-active' : 'sa-nav__link')}
      onClick={onNavigate}
    >
      <Icon aria-hidden="true" size={18} />
      <span>{item.label}</span>
    </NavLink>
  );
}

/* ---- 侧边导航内容（桌面侧栏 + 移动 Drawer 共用） ---- */

function StaffNavigationContent({ onNavigate }: { onNavigate?: () => void }): React.JSX.Element {
  const session = useCurrentStaffSession();
  const items = getVisibleNavItems(session);
  const groups: Array<{ section: string | undefined; items: StaffNavItem[] }> = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
  }

  return (
    <nav className="sa-nav" aria-label="员工工作台主导航">
      {groups.map((group, index) => (
        <div key={group.section ?? `group-${index}`} className="sa-nav__group">
          {index > 0 && group.section ? (
            <p className="sa-nav__group-label">{staffNavSectionLabel(group.section)}</p>
          ) : null}
          {group.items.map((item) =>
            item.children ? (
              <div key={item.id} className="sa-nav__subgroup">
                <p className="sa-nav__group-label">{item.label}</p>
                {item.children
                  .filter((child) => child.visible(session))
                  .map((child) => (
                    <NavLink
                      key={child.id}
                      to={child.path}
                      end={child.path === '/staff'}
                      className={({ isActive }) =>
                        isActive ? 'sa-nav__link sa-nav__child is-active' : 'sa-nav__link sa-nav__child'
                      }
                      onClick={onNavigate}
                    >
                      {child.icon ? <child.icon aria-hidden="true" size={16} /> : null}
                      <span>{child.label}</span>
                    </NavLink>
                  ))}
              </div>
            ) : (
              <NavItemLink key={item.id} item={item} onNavigate={onNavigate} />
            ),
          )}
        </div>
      ))}
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

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = (): HTMLElement[] =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const frame = requestAnimationFrame(() => {
      (focusable()[0] ?? panel)?.focus();
    });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes = focusable();
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      if (opener?.isConnected) opener.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="sa-drawer-overlay" role="presentation" onClick={onClose}>
      <aside
        className="sa-drawer"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="员工导航菜单"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sa-drawer__header">
          <span className="sa-topbar__brand">
            <span className="sa-topbar__mark" aria-hidden="true">
              月
            </span>
            <strong>月光白</strong>
          </span>
          <button
            type="button"
            className="sa-btn sa-btn--ghost sa-btn--small"
            aria-label="关闭导航菜单"
            onClick={onClose}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <StaffNavigationContent onNavigate={onClose} />
        <div className="sa-sidebar__footer">
          <p className="sp-workitem__meta">
            {session.display_name} · {formatMarketplaceScope(session)}
          </p>
          <StaffAccountActions compact />
        </div>
      </aside>
    </div>
  );
}

/* ---- 主 Shell（7F-1 新基础层：sa- 命名空间，64px 顶栏 + 248px 侧栏） ---- */

export function StaffShell({ children }: { children?: ReactNode } = {}): React.JSX.Element {
  const session = useCurrentStaffSession();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const breadcrumb = getBreadcrumbForPath(location.pathname, session);
  const pageTitle = getPageTitleForPath(location.pathname, session);
  const scope = formatMarketplaceScope(session);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  return (
    <div className="staff-app sa-shell" data-identity="staff">
      <header className="sa-topbar">
        <button
          type="button"
          className="sa-btn sa-btn--ghost sa-btn--small sa-menu-btn"
          aria-label="打开导航菜单"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <Menu aria-hidden="true" size={20} />
        </button>
        <NavLink className="sa-topbar__brand" to="/staff" aria-label="月光白员工首页">
          <span className="sa-topbar__mark" aria-hidden="true">
            月
          </span>
          <strong>月光白</strong>
        </NavLink>
        <div className="sa-topbar__search">
          <GlobalSearchDropdown />
        </div>
        <div className="sa-topbar__session">
          <span
            className="sa-topbar__session-context"
            aria-label={`当前会话信息：${session.display_name}（${session.role.display_name}）`}
          >
            <span className="sa-topbar__session-name">{session.display_name}</span>
            {session.display_name === session.role.display_name
            || session.display_name.endsWith(session.role.display_name) ? null : (
              <span className="sa-topbar__session-role">{session.role.display_name}</span>
            )}
            <span className="sa-topbar__session-role">{scope}</span>
          </span>
          <span className="sa-topbar__avatar" aria-hidden="true">
            {session.display_name.slice(0, 1)}
          </span>
        </div>
      </header>

      <div className="sa-body">
        <aside className="sa-sidebar" aria-label="员工端侧边栏">
          <StaffNavigationContent />
          <div className="sa-sidebar__footer">
            <p className="sp-workitem__meta">{scope}</p>
            <StaffAccountActions />
          </div>
        </aside>

        <div className="sa-main">
          <div className="sa-content sa-content--wide">
            <div className="sp-page-head">
              <div>
                <h1 className="sp-page-head__title">{pageTitle}</h1>
                {breadcrumb.length > 1 ? <Breadcrumb items={breadcrumb} /> : null}
              </div>
            </div>
            <main id="staff-main-content">{children ?? <Outlet />}</main>
          </div>
        </div>
      </div>

      <StaffMobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
