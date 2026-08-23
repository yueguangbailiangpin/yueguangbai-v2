import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardList,
  Home,
  MessageSquareText,
  PackageSearch,
  ReceiptText,
  Settings,
  ShoppingBag,
  UserRound,
} from 'lucide-react';
import type { SellerMemberRole } from '@ygb/contracts';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { BottomNavigation, IdentityShell, Select } from '../../ui/primitives';
import { CursorPagination } from '../../ui/CursorPagination';
import { sellerApi } from '../api/client';
import { sellerQueryKeys } from '../queries/keys';
import { useSellerCursorPages } from '../queries/useSellerCursorPages';
import { canViewSellerFinancials } from '../authorization';

const navigation = [
  { path: '/seller', label: '首页', icon: Home },
  { path: '/seller/products', label: '商品', icon: PackageSearch },
  { path: '/seller/demands', label: '需求', icon: ClipboardList },
  { path: '/seller/orders', label: '订单', icon: ShoppingBag },
  { path: '/seller/reviews', label: '评论', icon: MessageSquareText },
  { path: '/seller/settlements', label: '结算', icon: ReceiptText },
  { path: '/seller/settings', label: '我的', icon: Settings },
] as const;

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

function SellerNavigation({
  mobile = false,
  memberRole,
}: {
  mobile?: boolean;
  memberRole: SellerMemberRole | undefined;
}): React.JSX.Element {
  const links = navigation
    .filter((item) => item.path !== '/seller/settlements' || canViewSellerFinancials(memberRole))
    .map((item) => {
      const Icon = item.icon;
      return (
        <NavLink key={item.path} to={item.path} end={item.path === '/seller'}>
          <Icon aria-hidden="true" />
          <span>{item.label}</span>
        </NavLink>
      );
    });
  return mobile ? (
    <BottomNavigation label="卖家导航">{links}</BottomNavigation>
  ) : (
    <nav className="seller-side-navigation" aria-label="卖家导航">
      {links}
    </nav>
  );
}

export function SellerLayout({ children }: { children?: ReactNode } = {}): React.JSX.Element {
  const client = useQueryClient();
  const [storeId, setStoreId] = useState<string | null>(null);
  const me = useQuery({
    queryKey: sellerQueryKeys.me,
    queryFn: ({ signal }) => sellerApi.me(client, signal).then((r) => r.data.me),
  });
  const stores = useSellerCursorPages({
    resetKey: 'seller-stores:100',
    queryKey: sellerQueryKeys.storesPage,
    queryFn: (cursor, signal) => sellerApi.stores(client, cursor, signal),
  });
  const selectedStore = stores.items.find((store) => store.id === storeId) ?? null;
  const organization = me.data?.organization;
  const member = me.data?.member;
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
  return (
    <SellerContext.Provider value={value}>
      <IdentityShell identity="seller" className="seller-business-shell">
        <aside className="seller-sidebar">
          <NavLink className="seller-sidebar-brand" to="/seller" aria-label="月光白首页">
            月光白
          </NavLink>
          <SellerNavigation memberRole={member?.role} />
          <div className="seller-sidebar-member">
            <UserRound aria-hidden="true" />
            <span>
              <strong>{member?.display_name ?? '验证身份中…'}</strong>
              {member ? <small>{roleLabels[member.role]}</small> : null}
            </span>
          </div>
        </aside>
        <div className="seller-work-area">
          <header className="seller-context-bar" aria-label="组织和店铺">
            <NavLink className="seller-mobile-brand" to="/seller">
              月光白
            </NavLink>
            <div className="seller-context-summary">
              <strong>
                {selectedStore
                  ? marketplaceLabels[selectedStore.canonical_marketplace_code]
                  : '全部站点'}
              </strong>
              <span>{organization?.name ?? '正在核验卖家身份'}</span>
              {organization ? <small>{organization.seller_code}</small> : null}
            </div>
            <label className="seller-store-selector" htmlFor="seller-store">
              <span>店铺</span>
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
            </label>
            {stores.initialError ? (
              <button type="button" className="button secondary" onClick={stores.retryInitial}>
                重试
              </button>
            ) : (
              <CursorPagination
                {...stores}
                onLoadMore={stores.loadMore}
                onRetry={stores.retryLater}
                loadLabel="加载更多"
                loadingLabel="加载中…"
                retryLabel="重试"
                errorMessage="后一页店铺暂时加载不出来，已经加载的还能继续用。"
              />
            )}
            <div className="seller-context-member">
              <UserRound aria-hidden="true" />
              <span>
                <strong>{member?.display_name ?? '核验中'}</strong>
                {member ? <small>{roleLabels[member.role]}</small> : null}
              </span>
            </div>
          </header>
          <main className="seller-main">{children ?? <Outlet />}</main>
        </div>
        <SellerNavigation mobile memberRole={member?.role} />
      </IdentityShell>
    </SellerContext.Provider>
  );
}
