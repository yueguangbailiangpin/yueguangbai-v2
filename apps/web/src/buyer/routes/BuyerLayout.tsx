import {
  ClipboardList,
  FolderOpen,
  Home,
  MessageSquareText,
  UserRound,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { BottomNavigation, IdentityShell } from '../../ui/primitives';

export const BUYER_NAVIGATION = Object.freeze([
  { path: '/buyer', label: '首页', icon: Home, end: true },
  { path: '/buyer/tasks', label: '任务', icon: ClipboardList, end: false },
  { path: '/buyer/order-materials', label: '订单资料', icon: FolderOpen, end: false },
  { path: '/buyer/reviews', label: '评论', icon: MessageSquareText, end: false },
  { path: '/buyer/me', label: '我的', icon: UserRound, end: false },
] as const);

export type BuyerNavigationPath = typeof BUYER_NAVIGATION[number]['path'];

export function buyerNavigationOwner(pathname: string): BuyerNavigationPath {
  if (pathname === '/buyer') return '/buyer';
  if (/^\/buyer\/(?:tasks|demands|reservations)(?:\/|$)/u.test(pathname)) return '/buyer/tasks';
  if (/^\/buyer\/(?:order-materials|orders)(?:\/|$)/u.test(pathname)) return '/buyer/order-materials';
  if (/^\/buyer\/reviews(?:\/|$)/u.test(pathname)) return '/buyer/reviews';
  return '/buyer/me';
}

export function BuyerLayout({ children }: { children?: ReactNode } = {}): React.JSX.Element {
  const owner = buyerNavigationOwner(useLocation().pathname);
  return <IdentityShell identity="buyer" className="buyer-shell buyer-business-shell">
    <header className="buyer-brand-bar"><strong>月光白</strong><span>买家服务</span></header>
    <main className="buyer-main">{children ?? <Outlet />}</main>
    <BottomNavigation label="买家导航">{BUYER_NAVIGATION.map((item) => {
      const Icon = item.icon;
      return <Link key={item.path} to={item.path} aria-current={owner === item.path ? 'page' : undefined}>
        <Icon aria-hidden="true" /><span>{item.label}</span>
      </Link>;
    })}</BottomNavigation>
  </IdentityShell>;
}
