import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardList,
  Home,
  Menu,
  MessageSquareText,
  PackageSearch,
  ReceiptText,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import type { SellerMemberRole } from '@ygb/contracts';
import type { z } from 'zod';
import { sellerStoresSchema } from '../contracts/runtime';

type SellerStoreSummary = z.infer<typeof sellerStoresSchema>['items'][number];
type SellerStoresPageState = ReturnType<typeof useSellerCursorPages<SellerStoreSummary>>;
import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { BottomNavigation, Button, IdentityShell, Select } from '../../ui/primitives';
import { CursorPagination } from '../../ui/CursorPagination';
import { sellerApi } from '../api/client';
import { sellerQueryKeys } from '../queries/keys';
import { useSellerCursorPages } from '../queries/useSellerCursorPages';

/* ---- 导航定义（只映射真实存在的路由） ---- */

interface SellerNavItem {
  path: string;
  label: string;
  icon: typeof Home;
  end: boolean;
}

const SELLER_SIDEBAR_NAVIGATION: readonly SellerNavItem[] = [
  { path: '/seller', label: '首页', icon: Home, end: true },
  { path: '/seller/products', label: '产品', icon: PackageSearch, end: false },
  { path: '/seller/demands', label: '需求', icon: ClipboardList, end: false },
  { path: '/seller/orders', label: '订单与沟通', icon: ReceiptText, end: false },
  { path: '/seller/reviews', label: '评论', icon: MessageSquareText, end: false },
  { path: '/seller/settlements', label: '结算', icon: WalletCards, end: false },
  { path: '/seller/settings', label: '成员与组织设置', icon: Users, end: false },
] as const;

/** 移动端底部导航（模板 4 项；7.5R-2 起全部角色可读结算批次，固定含“结算”）。 */
function sellerMobileNavigation(): readonly SellerNavItem[] {
  return [
    { path: '/seller', label: '首页', icon: Home, end: true },
    { path: '/seller/products', label: '产品', icon: PackageSearch, end: false },
    { path: '/seller/orders', label: '订单', icon: ReceiptText, end: false },
    { path: '/seller/settlements', label: '结算', icon: WalletCards, end: false },
  ];
}

function sellerMobileOwner(pathname: string): string {
  if (pathname === '/seller') return '/seller';
  if (/^\/seller\/(?:products|demands)(?:\/|$)/u.test(pathname)) return '/seller/products';
  if (/^\/seller\/settlements(?:\/|$)/u.test(pathname)) return '/seller/settlements';
  if (/^\/seller\/settings(?:\/|$)/u.test(pathname)) return '/seller/settings';
  return '/seller/orders';
}

const marketplaceLabels = {
  AMAZON_JP: '日本站',
  AMAZON_US: '美国站',
  COUPANG_KR: '韩国站',
  RAKUTEN_JP: '乐天日本站（未接入）',
  TIKTOK_JP: 'TikTok 日本站（未接入）',
} as const;

const roleLabels = {
  OWNER: '负责人',
  OPERATIONS: '运营',
  FINANCE: '财务',
  VIEWER: '查看成员',
} as const;

interface SellerContextValue {
  storeId: string | null;
  memberRole: SellerMemberRole | undefined;
  readScope: 'ORGANIZATION' | 'ASSIGNED_STORES' | undefined;
  identityPending: boolean;
  identityError: boolean;
}
const SellerContext = createContext<SellerContextValue>({
  storeId: null,
  memberRole: undefined,
  readScope: undefined,
  identityPending: true,
  identityError: false,
});
export function useSellerStoreContext(): SellerContextValue {
  return useContext(SellerContext);
}

/* ---- 侧栏导航内容（桌面侧边栏 + 移动抽屉共用） ---- */

function SellerNavigationContent({ onNavigate }: {
  onNavigate?: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <nav className="mws-nav-list" aria-label="卖家导航">
      {SELLER_SIDEBAR_NAVIGATION.map((item) => {
        const Icon = item.icon;
        return (
          <Fragment key={item.path}>
            {item.path === '/seller/settings' ? <hr className="mws-nav-divider" /> : null}
            <NavLink
              to={item.path}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) => (isActive ? 'mws-nav-link active' : 'mws-nav-link')}
            >
              <Icon aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          </Fragment>
        );
      })}
    </nav>
  );
}

/* ---- 店铺筛选（功能保留：侧栏 + 抽屉共用） ---- */

function SellerStoreFilterContent({
  stores,
  storeId,
  setStoreId,
}: {
  stores: SellerStoresPageState;
  storeId: string | null;
  setStoreId: (value: string | null) => void;
}): React.JSX.Element | null {
  if (stores.items.length === 0 && stores.isInitialPending) return null;
  return (
    <div className="mws-store-filter">
      <label htmlFor="seller-store">店铺</label>
      <Select
        id="seller-store"
        aria-label="店铺"
        value={storeId ?? ''}
        onChange={(event) => setStoreId(event.target.value || null)}
      >
        <option value="">全部店铺</option>
        {stores.items.map((store) => (
          <option
            key={store.id}
            value={store.id}
            disabled={
              store.marketplace_status !== 'ACTIVE' || store.adapter_status !== 'AVAILABLE'
            }
          >
            {marketplaceLabels[store.canonical_marketplace_code]} · {store.display_name}
          </option>
        ))}
      </Select>
    </div>
  );
}

/* ---- 移动端抽屉（308px，绿色胶囊导航，焦点圈定 + Escape） ---- */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function SellerMobileDrawer({
  open,
  onClose,
  organizationName,
  memberRoleLabel,
  stores,
  storeId,
  setStoreId,
}: {
  open: boolean;
  onClose: () => void;
  organizationName: string | null;
  memberRoleLabel: string | null;
  stores: SellerStoresPageState;
  storeId: string | null;
  setStoreId: (value: string | null) => void;
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
    <div className="mws-drawer-overlay" role="presentation" onClick={onClose}>
      <aside
        className="mws-drawer"
        id="seller-mobile-drawer"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="卖家导航菜单"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mws-drawer-header">
          <span className="mws-moon small" aria-hidden="true">
            <span />
          </span>
          <strong>卖家中心</strong>
          <Button
            className="secondary icon-only mws-drawer-close"
            aria-label="关闭导航菜单"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="mws-drawer-body">
          <SellerNavigationContent onNavigate={onClose} />
          <SellerStoreFilterContent stores={stores} storeId={storeId} setStoreId={setStoreId} />
          {stores.hasMore ? (
            <div className="mws-store-more">
              <CursorPagination
                {...stores}
                onLoadMore={stores.loadMore}
                onRetry={stores.retryLater}
                loadLabel="加载更多"
                loadingLabel="加载中…"
                retryLabel="重试"
                errorMessage="后一页店铺暂时加载不出来，已经加载的还能继续用。"
              />
            </div>
          ) : null}
        </div>
        <div className="mws-drawer-footer">
          <strong>{organizationName ?? '正在核验卖家身份'}</strong>
          <small>{memberRoleLabel ?? '核验中'}</small>
        </div>
      </aside>
    </div>
  );
}

/* ---- 主 Shell ---- */

export function SellerLayout({ children }: { children?: ReactNode } = {}): React.JSX.Element {
  const client = useQueryClient();
  const pathname = useLocation().pathname;
  const [storeId, setStoreId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const me = useQuery({
    queryKey: sellerQueryKeys.me,
    queryFn: ({ signal }) => sellerApi.me(client, signal).then((r) => r.data.me),
  });
  const stores = useSellerCursorPages({
    resetKey: 'seller-stores:100',
    queryKey: sellerQueryKeys.storesPage,
    queryFn: (cursor, signal) => sellerApi.stores(client, cursor, signal),
  });
  const organization = me.data?.organization;
  const member = me.data?.member;
  const memberRoleLabel = member ? roleLabels[member.role] : null;
  const mobileOwner = sellerMobileOwner(pathname);
  const mobileNavigation = sellerMobileNavigation();
  const value = useMemo<SellerContextValue>(
    () => ({
      storeId,
      memberRole: member?.role,
      readScope: me.data?.access.read_scope,
      identityPending: me.isPending,
      identityError: me.isError,
    }),
    [storeId, member?.role, me.data?.access.read_scope, me.isPending, me.isError],
  );

  // 路由变化时关闭抽屉
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <SellerContext.Provider value={value}>
      <IdentityShell identity="seller" className="seller-business-shell mws-portal">
        {/* 64px 顶栏：品牌区（绿色月亮印记）+ 会话区（Material 3 / Google Workspace） */}
        <header className="mws-appbar">
          <div className="mws-brand">
            <Button
              className="secondary icon-only mws-menu-btn"
              aria-label="打开导航菜单"
              aria-expanded={drawerOpen}
              aria-controls="seller-mobile-drawer"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu aria-hidden="true" />
            </Button>
            <NavLink className="mws-brand-link" to="/seller" aria-label="月光白卖家首页">
              <span className="mws-moon" aria-hidden="true">
                <span />
              </span>
              <strong>月光白</strong>
            </NavLink>
            <em>卖家中心</em>
          </div>
          <div className="mws-appbar-side">
            <span className="mws-session-name">{member?.display_name ?? '核验中'}</span>
            <span className="mws-session-role">
              {organization ? `${organization.name} · ${memberRoleLabel ?? ''}` : '正在核验卖家身份'}
            </span>
            <span className="mws-avatar" aria-hidden="true">
              {member ? member.display_name.slice(0, 1) : '…'}
            </span>
          </div>
        </header>

        <div className="mws-shell-body">
          {/* 桌面端侧边栏（230px 绿色胶囊导航） */}
          <aside className="mws-nav" aria-label="卖家端侧边栏">
            <SellerNavigationContent />
            <SellerStoreFilterContent stores={stores} storeId={storeId} setStoreId={setStoreId} />
            {stores.hasMore ? (
              <div className="mws-store-more">
                <CursorPagination
                  {...stores}
                  onLoadMore={stores.loadMore}
                  onRetry={stores.retryLater}
                  loadLabel="加载更多"
                  loadingLabel="加载中…"
                  retryLabel="重试"
                  errorMessage="后一页店铺暂时加载不出来，已经加载的还能继续用。"
                />
              </div>
            ) : null}
            <div className="mws-nav-footer">
              <strong>{organization?.name ?? '正在核验卖家身份'}</strong>
              <small>{member ? memberRoleLabel : '成员角色核验中'}</small>
            </div>
          </aside>

          {/* 内容区 */}
          <main className="mws-content" id="seller-main-content">
            {children ?? <Outlet />}
          </main>
        </div>

        {/* 移动端抽屉 */}
        <SellerMobileDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          organizationName={organization?.name ?? null}
          memberRoleLabel={memberRoleLabel}
          stores={stores}
          storeId={storeId}
          setStoreId={setStoreId}
        />

        {/* 移动端底部导航（<1024px） */}
        <BottomNavigation label="卖家导航">
          {mobileNavigation.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                aria-current={mobileOwner === item.path ? 'page' : undefined}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </BottomNavigation>
      </IdentityShell>
    </SellerContext.Provider>
  );
}
