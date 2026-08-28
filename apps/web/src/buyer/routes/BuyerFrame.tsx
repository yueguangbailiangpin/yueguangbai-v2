import {
  HandCoins,
  Home,
  Menu,
  MessageSquareCheck,
  ReceiptText,
  ShoppingBag,
  UserRound,
  X,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { BottomNavigation, Button, IdentityShell } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys } from '../queries/keys';
import { marketplaceLabel } from '../shared/status';

/* ---- 导航定义 ---- */

/** 移动端底部导航（模板 4 项）。 */
export const BUYER_NAVIGATION = Object.freeze([
  { path: '/buyer', label: '首页', icon: Home },
  { path: '/buyer/products', label: '产品', icon: ShoppingBag },
  { path: '/buyer/orders', label: '订单', icon: ReceiptText },
  { path: '/buyer/me', label: '我的', icon: UserRound },
] as const);

export type BuyerNavigationPath = typeof BUYER_NAVIGATION[number]['path'];

/** 桌面侧边栏 / 抽屉完整导航（模板买家侧栏）。 */
export const BUYER_SIDEBAR_NAVIGATION = Object.freeze([
  { path: '/buyer', label: '首页', icon: Home, end: true },
  { path: '/buyer/products', label: '产品与预约', icon: ShoppingBag, end: false },
  { path: '/buyer/orders', label: '我的订单', icon: ReceiptText, end: false },
  { path: '/buyer/reviews', label: '评论任务', icon: MessageSquareCheck, end: false },
  { path: '/buyer/refunds', label: '返款记录', icon: HandCoins, end: false },
  { path: '/buyer/me', label: '账户资料', icon: UserRound, end: false },
] as const);

export function buyerNavigationOwner(pathname: string): BuyerNavigationPath {
  if (pathname === '/buyer') return '/buyer';
  if (/^\/buyer\/(?:products|demands)(?:\/|$)/u.test(pathname)) return '/buyer/products';
  if (
    /^\/buyer\/(?:orders|order-materials|reservations|tasks|reviews|refunds)(?:\/|$)/u.test(
      pathname,
    )
  ) {
    return '/buyer/orders';
  }
  return '/buyer/me';
}

/** 侧栏完整导航的高亮归属（评论任务 / 返款记录独立成组）。 */
export function buyerSidebarOwner(pathname: string): string {
  if (pathname === '/buyer') return '/buyer';
  if (/^\/buyer\/(?:products|demands)(?:\/|$)/u.test(pathname)) return '/buyer/products';
  if (/^\/buyer\/(?:reviews|tasks)(?:\/|$)/u.test(pathname)) return '/buyer/reviews';
  if (/^\/buyer\/refunds(?:\/|$)/u.test(pathname)) return '/buyer/refunds';
  if (
    /^\/buyer\/(?:orders|order-materials|reservations)(?:\/|$)/u.test(pathname)
  ) {
    return '/buyer/orders';
  }
  return '/buyer/me';
}

/* ---- 侧栏底部：买家编号 + 市场（来自 /me 会话，读取失败时隐藏） ---- */

function BuyerNavFooterContent(): React.JSX.Element | null {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: buyerQueryKeys.me(),
    queryFn: ({ signal }) => buyerApi.me(client, signal).then((r) => r.data),
    staleTime: 60_000,
    retry: false,
  });
  if (!query.isSuccess) return null;
  const me = query.data;
  return <>
    <strong>{me.buyer.customer_number ?? me.buyer.display_name}</strong>
    <small>{marketplaceLabel(me.buyer.marketplace_code)}</small>
  </>;
}

/* ---- 侧栏导航内容（桌面侧边栏 + 移动抽屉共用） ---- */

function BuyerNavigationContent({ onNavigate }: { onNavigate?: () => void }): React.JSX.Element {
  const owner = buyerSidebarOwner(useLocation().pathname);
  return (
    <nav className="mwb-nav-list" aria-label="买家主导航">
      {BUYER_SIDEBAR_NAVIGATION.map((item) => {
        const Icon = item.icon;
        return (
          <Fragment key={item.path}>
            {item.path === '/buyer/me' ? (
              <hr className="mwb-nav-divider" />
            ) : null}
            <Link
              to={item.path}
              aria-current={owner === item.path ? 'page' : undefined}
              className={owner === item.path ? 'mwb-nav-link active' : 'mwb-nav-link'}
              onClick={onNavigate}
            >
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}

/* ---- 移动端抽屉（308px，焦点圈定 + Escape 关闭） ---- */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function BuyerMobileDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.JSX.Element | null {
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
    <div className="mwb-drawer-overlay" role="presentation" onClick={onClose}>
      <aside
        className="mwb-drawer"
        id="buyer-mobile-drawer"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="买家导航菜单"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mwb-drawer-header">
          <span className="mwb-moon small" aria-hidden="true">
            <span />
          </span>
          <strong>买家中心</strong>
          <Button
            className="secondary icon-only mwb-drawer-close"
            aria-label="关闭导航菜单"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="mwb-drawer-body">
          <BuyerNavigationContent onNavigate={onClose} />
        </div>
        <div className="mwb-drawer-footer">
          <BuyerNavFooterContent />
        </div>
      </aside>
    </div>
  );
}

/* ---- 主 Shell ---- */

export function BuyerFrame({ children }: { children?: ReactNode } = {}): React.JSX.Element {
  const pathname = useLocation().pathname;
  const owner = buyerNavigationOwner(pathname);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 路由变化时关闭抽屉
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <IdentityShell identity="buyer" className="buyer-shell buyer-business-shell mwb-portal">
      {/* 64px 顶栏：品牌区 + 买家中心标签 + 头像（Material 3 / Google Workspace） */}
      <header className="mwb-appbar">
        <div className="mwb-brand">
          <Button
            className="secondary icon-only mwb-menu-btn"
            aria-label="打开导航菜单"
            aria-expanded={drawerOpen}
            aria-controls="buyer-mobile-drawer"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu aria-hidden="true" />
          </Button>
          <Link className="mwb-brand-link" to="/buyer" aria-label="月光白买家首页">
            <span className="mwb-moon" aria-hidden="true">
              <span />
            </span>
            <strong>月光白</strong>
          </Link>
          <em>买家中心</em>
        </div>
        <div className="mwb-appbar-side">
          <span className="mwb-avatar" aria-hidden="true">买</span>
        </div>
      </header>

      <div className="mwb-shell-body">
        {/* 桌面端侧边栏（230px 胶囊导航） */}
        <aside className="mwb-nav" aria-label="买家端侧边栏">
          <BuyerNavigationContent />
          <div className="mwb-nav-footer">
            <BuyerNavFooterContent />
          </div>
        </aside>

        {/* 内容区 */}
        <main className="mwb-content" id="buyer-main-content">
          {children ?? <Outlet />}
        </main>
      </div>

      {/* 移动端抽屉 */}
      <BuyerMobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      {/* 移动端底部导航（<1024px） */}
      <BottomNavigation label="买家导航">{BUYER_NAVIGATION.map((item) => {
        const Icon = item.icon;
        return <Link key={item.path} to={item.path} aria-current={owner === item.path ? 'page' : undefined}>
          <Icon aria-hidden="true" /><span>{item.label}</span>
        </Link>;
      })}</BottomNavigation>
    </IdentityShell>
  );
}
