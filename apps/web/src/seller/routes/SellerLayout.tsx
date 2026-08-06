import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Home, MessageSquareText, PackageSearch, ReceiptText, Settings } from 'lucide-react';
import { createContext, useContext, useMemo, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { BottomNavigation, IdentityShell, Select } from '../../ui/primitives';
import { sellerApi } from '../api/client';
import { sellerQueryKeys } from '../queries/keys';

const navigation = [
  { path: '/seller', label: '首页', icon: Home }, { path: '/seller/products', label: '商品', icon: PackageSearch },
  { path: '/seller/demands', label: '需求', icon: ClipboardList }, { path: '/seller/orders', label: '订单', icon: ReceiptText },
  { path: '/seller/reviews', label: '评论', icon: MessageSquareText }, { path: '/seller/settlements', label: '结算', icon: ReceiptText },
  { path: '/seller/settings', label: '我的', icon: Settings },
] as const;

const SellerContext = createContext<{ storeId: string | null }>({ storeId: null });
export function useSellerStoreContext(): { storeId: string | null } { return useContext(SellerContext); }

export function SellerLayout(): React.JSX.Element {
  const client = useQueryClient();
  const location = useLocation();
  const [storeId, setStoreId] = useState<string | null>(null);
  const me = useQuery({ queryKey: sellerQueryKeys.me, queryFn: ({ signal }) => sellerApi.me(client, signal).then((r) => r.data.me) });
  const stores = useQuery({ queryKey: sellerQueryKeys.stores, queryFn: ({ signal }) => sellerApi.stores(client, signal).then((r) => r.data.items) });
  const value = useMemo(() => ({ storeId }), [storeId]);
  return <SellerContext.Provider value={value}><IdentityShell identity="seller" className="seller-business-shell">
    <header className="seller-brand-bar"><div><strong>月光白</strong><span>卖家工作台</span></div>
      <label>店铺与站点<Select aria-label="店铺与站点" value={storeId ?? ''} onChange={(event) => setStoreId(event.target.value || null)}>
        <option value="">全部授权店铺</option>{stores.data?.map((store) => <option key={store.id} value={store.id}>{store.display_name} · 日本站</option>)}</Select></label>
      <small>{me.data ? `${me.data.organization.name} · ${me.data.organization.seller_code}` : '正在核验卖家身份'}</small>
    </header>
    <main className="seller-main"><Outlet /></main>
    <BottomNavigation label="卖家导航">{navigation.map((item) => { const Icon = item.icon; const active = item.path === '/seller' ? location.pathname === item.path : location.pathname.startsWith(item.path); return <Link key={item.path} to={item.path} aria-current={active ? 'page' : undefined}><Icon aria-hidden="true" /><span>{item.label}</span></Link>; })}</BottomNavigation>
  </IdentityShell></SellerContext.Provider>;
}
