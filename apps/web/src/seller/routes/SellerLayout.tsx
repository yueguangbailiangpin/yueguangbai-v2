import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleUserRound, ClipboardList, Home, MessageSquareText, PackageSearch, ReceiptText, Settings } from 'lucide-react';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { BottomNavigation, Button, Card, DataTable, Drawer, EmptyState, IdentityShell, MetricCard, PageHeader, SearchInput, Select, Sidebar, StatusBadge } from '../../ui/primitives';
import { sellerApi } from '../api/client';
import { sellerQueryKeys } from '../queries/keys';

const navigation = [
  { path: '/seller', label: '首页', icon: Home }, { path: '/seller/products', label: '商品', icon: PackageSearch },
  { path: '/seller/demands', label: '需求', icon: ClipboardList }, { path: '/seller/orders', label: '订单', icon: ReceiptText },
  { path: '/seller/reviews', label: '评论', icon: MessageSquareText }, { path: '/seller/settlements', label: '结算', icon: ReceiptText },
  { path: '/seller/settings', label: '我的', icon: Settings },
] as const;

const foundationNavigation = [
  { id: 'overview', label: '概览', href: '/seller', end: true },
  { id: 'products', label: '商品', href: '/seller/products' },
  { id: 'demands', label: '需求', href: '/seller/demands' },
  { id: 'orders', label: '订单', href: '/seller/orders' },
  { id: 'reviews', label: '评论', href: '/seller/reviews' },
  { id: 'settlements', label: '结算', href: '/seller/settlements' },
  { id: 'settings', label: '设置', href: '/seller/settings' },
] as const;

const SellerContext = createContext<{ storeId: string | null }>({ storeId: null });
export function useSellerStoreContext(): { storeId: string | null } { return useContext(SellerContext); }

export function SellerLayout({ children }: { children?: ReactNode } = {}): React.JSX.Element {
  const client = useQueryClient();
  const [storeId, setStoreId] = useState<string | null>(null);
  const me = useQuery({ queryKey: sellerQueryKeys.me, queryFn: ({ signal }) => sellerApi.me(client, signal).then((r) => r.data.me) });
  const stores = useQuery({ queryKey: sellerQueryKeys.stores, queryFn: ({ signal }) => sellerApi.stores(client, signal).then((r) => r.data.items) });
  const value = useMemo(() => ({ storeId }), [storeId]);
  return <SellerContext.Provider value={value}><IdentityShell identity="seller" className="seller-business-shell">
    <header className="seller-brand-bar"><div><strong>月光白</strong></div>
      <label>店铺<Select aria-label="店铺" value={storeId ?? ''} onChange={(event) => setStoreId(event.target.value || null)}>
        <option value="">全部授权店铺</option>{stores.data?.map((store) => <option key={store.id} value={store.id} disabled={store.marketplace_status !== 'ACTIVE' || store.adapter_status !== 'AVAILABLE'}>{store.display_name}</option>)}</Select></label>
      <small>{me.data ? `${me.data.organization.name} · ${me.data.organization.seller_code}` : '正在核验卖家身份'}</small>
    </header>
    <main className="seller-main">{children ?? <Outlet />}</main>
    <BottomNavigation label="卖家导航">{navigation.map((item) => { const Icon = item.icon; return <NavLink key={item.path} to={item.path} end={item.path === '/seller'}><Icon aria-hidden="true" /><span>{item.label}</span></NavLink>; })}</BottomNavigation>
  </IdentityShell></SellerContext.Provider>;
}

export function SellerShell(): React.JSX.Element {
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  return <IdentityShell identity="seller" className="work-shell seller-shell">
    <Sidebar label="卖家导航" items={foundationNavigation} collapsed={collapsed} onCollapsedChange={setCollapsed} />
    <main className="work-content">
      <header className="context" aria-label="组织和店铺上下文"><span><CircleUserRound aria-hidden="true" />组织与店铺</span><small>业务上下文将在卖家业务模块开放</small></header>
      <PageHeader title="业务进度"><Button onClick={() => setDrawer(true)}>查看详情结构</Button></PageHeader>
      <section id="foundation" className="seller-workspace">
        <section className="seller-metrics" aria-labelledby="seller-metrics-title"><h2 id="seller-metrics-title" className="visually-hidden">业务指标摘要</h2>{['订单', '评论', '结算'].map((label) => <MetricCard key={label} label={label} value="—" detail="业务模块开放后显示" />)}</section>
        <div className="filter-bar" role="search" aria-label="列表筛选"><SearchInput label="搜索当前列表" placeholder="搜索（业务模块开放后可用）" /><label htmlFor="seller-status">状态</label><Select id="seller-status" defaultValue="all"><option value="all">全部状态</option><option value="pending">待处理</option></Select></div>
        <Card className="seller-list-card"><div className="section-heading"><div><p className="eyebrow">列表结构</p><h2>工作列表</h2></div><StatusBadge tone="neutral">尚无业务数据</StatusBadge></div><DataTable caption="卖家工作列表基础容器" className="desktop-table"><thead><tr><th scope="col">项目</th><th scope="col">状态</th><th scope="col">更新时间</th><th scope="col">操作</th></tr></thead><tbody><tr><td colSpan={4}><EmptyState title="暂无列表内容" description="该功能将在卖家业务模块开放" /></td></tr></tbody></DataTable><div className="mobile-list"><EmptyState title="暂无列表内容" description="该功能将在卖家业务模块开放" /></div></Card>
      </section>
    </main>
    <Drawer open={drawer} title="详情结构" description="列表上下文会在关闭详情后保留。" onClose={() => setDrawer(false)}><EmptyState title="暂无详情" description="该功能将在卖家业务模块开放" /></Drawer>
  </IdentityShell>;
}
