import { ClipboardCheck, Tag, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { BottomNavigation, IdentityShell } from '../../ui/primitives';

export const BUYER_NAVIGATION = Object.freeze([
  { path: '/buyer/products', label: '产品', icon: Tag },
  { path: '/buyer/tasks', label: '任务', icon: ClipboardCheck },
  { path: '/buyer/me', label: '我的', icon: UserRound },
] as const);

export type BuyerNavigationPath = typeof BUYER_NAVIGATION[number]['path'];

export function buyerNavigationOwner(pathname: string): BuyerNavigationPath {
  if (/^\/buyer\/(?:products|demands)(?:\/|$)/u.test(pathname) || pathname === '/buyer') {
    return '/buyer/products';
  }
  if (/^\/buyer\/(?:tasks|reservations|order-materials|orders|reviews|refunds)(?:\/|$)/u.test(pathname)) {
    return '/buyer/tasks';
  }
  return '/buyer/me';
}

export function BuyerFrame({ children }: { children?: ReactNode } = {}): React.JSX.Element {
  const owner = buyerNavigationOwner(useLocation().pathname);
  return <IdentityShell identity="buyer" className="buyer-shell buyer-business-shell">
    <header className="buyer-brand-bar"><div className="buyer-brand-inner"><strong>月光白</strong></div></header>
    <main className="buyer-main">{children ?? <Outlet />}</main>
    <BottomNavigation label="买家导航">{BUYER_NAVIGATION.map((item) => {
      const Icon = item.icon;
      return <Link key={item.path} to={item.path} aria-current={owner === item.path ? 'page' : undefined}>
        <Icon aria-hidden="true" /><span>{item.label}</span>
      </Link>;
    })}</BottomNavigation>
  </IdentityShell>;
}
