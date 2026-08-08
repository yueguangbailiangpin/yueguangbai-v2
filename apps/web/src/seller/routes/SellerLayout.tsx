import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Home, MessageSquareText, PackageSearch, ReceiptText, Settings, ShoppingBag, UserRound } from 'lucide-react';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { BottomNavigation, IdentityShell, Select } from '../../ui/primitives';
import { sellerApi } from '../api/client';
import { sellerQueryKeys } from '../queries/keys';

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
} as const;

const roleLabels = { OWNER: '负责人', OPERATOR: '运营成员' } as const;

const SellerContext = createContext<{ storeId: string | null }>({ storeId: null });
export function useSellerStoreContext(): { storeId: string | null } { return useContext(SellerContext); }

function SellerNavigation({ mobile = false }: { mobile?: boolean }): React.JSX.Element {
  const links = navigation.map((item) => {
    const Icon = item.icon;
    return <NavLink key={item.path} to={item.path} end={item.path === '/seller'}>
      <Icon aria-hidden="true" /><span>{item.label}</span>
    </NavLink>;
  });
  return mobile
    ? <BottomNavigation label="卖家导航">{links}</BottomNavigation>
    : <nav className="seller-side-navigation" aria-label="卖家导航">{links}</nav>;
}

export function SellerLayout({ children }: { children?: ReactNode } = {}): React.JSX.Element {
  const client = useQueryClient();
  const [storeId, setStoreId] = useState<string | null>(null);
  const me = useQuery({ queryKey: sellerQueryKeys.me, queryFn: ({ signal }) => sellerApi.me(client, signal).then((r) => r.data.me) });
  const stores = useQuery({ queryKey: sellerQueryKeys.stores, queryFn: ({ signal }) => sellerApi.stores(client, signal).then((r) => r.data.items) });
  const selectedStore = stores.data?.find((store) => store.id === storeId) ?? null;
  const value = useMemo(() => ({ storeId }), [storeId]);
  const organization = me.data?.organization;
  const member = me.data?.member;
  return <SellerContext.Provider value={value}>
    <IdentityShell identity="seller" className="seller-business-shell">
      <aside className="seller-sidebar">
        <NavLink className="seller-sidebar-brand" to="/seller" aria-label="月光白首页">月光白</NavLink>
        <SellerNavigation />
        <div className="seller-sidebar-member">
          <UserRound aria-hidden="true" />
          <span><strong>{member?.display_name ?? '正在核验身份'}</strong>{member ? <small>{roleLabels[member.role]}</small> : null}</span>
        </div>
      </aside>
      <div className="seller-work-area">
        <header className="seller-context-bar" aria-label="组织和店铺上下文">
          <NavLink className="seller-mobile-brand" to="/seller">月光白</NavLink>
          <div className="seller-context-summary">
            <strong>{selectedStore ? marketplaceLabels[selectedStore.canonical_marketplace_code] : '全部站点'}</strong>
            <span>{organization?.name ?? '正在核验卖家身份'}</span>
            {organization ? <small>{organization.seller_code}</small> : null}
          </div>
          <label className="seller-store-selector" htmlFor="seller-store">
            <span>店铺</span>
            <Select id="seller-store" aria-label="店铺" value={storeId ?? ''} onChange={(event) => setStoreId(event.target.value || null)}>
              <option value="">全部授权店铺</option>
              {stores.data?.map((store) => <option key={store.id} value={store.id} disabled={store.marketplace_status !== 'ACTIVE' || store.adapter_status !== 'AVAILABLE'}>
                {marketplaceLabels[store.canonical_marketplace_code]} · {store.display_name}
              </option>)}
            </Select>
          </label>
          <div className="seller-context-member">
            <UserRound aria-hidden="true" /><span><strong>{member?.display_name ?? '核验中'}</strong>{member ? <small>{roleLabels[member.role]}</small> : null}</span>
          </div>
        </header>
        <main className="seller-main">{children ?? <Outlet />}</main>
      </div>
      <SellerNavigation mobile />
    </IdentityShell>
  </SellerContext.Provider>;
}
