import { useLocation } from 'react-router';
import { SellerLayout,useSellerStoreContext } from './SellerLayout';
import { SellerRouteProvider } from '../../routes/IdentityRouteSlots';
import { RouteChunkBoundary } from '../../routes/RouteChunkBoundary';
import { SellerDashboardPage, SellerDemandsPage, SellerOrdersPage, SellerProductApplicationDetailPage, SellerProductsPage, SellerReviewsPage, SellerSettlementsPage } from '../pages/SellerPages';
import { SellerSettingsV2Page } from '../pages/SellerSettingsV2Page';
import { canViewSellerFinancials } from '../authorization';
import { Alert } from '../../ui/primitives';

const loadSellerSubmissionRoutes = () => import('./SellerSubmissionRouteModule');

export { SellerLayout };

export default function SellerPortal(): React.JSX.Element {
  return <SellerRouteProvider page={SellerRoutePage}><SellerLayout /></SellerRouteProvider>;
}

export function SellerRoutePage(): React.JSX.Element {
  const { pathname } = useLocation();
  const {memberRole,identityPending,identityError}=useSellerStoreContext();
  if (pathname === '/seller/products/new' || pathname === '/seller/demands/new') {
    return <RouteChunkBoundary load={loadSellerSubmissionRoutes} />;
  }
  if (/^\/seller\/products\/[^/]+$/u.test(pathname)) return <SellerProductApplicationDetailPage />;
  if (pathname === '/seller/products') return <SellerProductsPage />;
  if (pathname === '/seller/demands') return <SellerDemandsPage />;
  if (pathname === '/seller/orders') return <SellerOrdersPage />;
  if (pathname === '/seller/reviews') return <SellerReviewsPage />;
  if (pathname === '/seller/settlements') {
    if(identityPending)return <p role="status">正在核验结算权限…</p>;
    if(identityError)return <Alert tone="danger">暂时无法核验当前账号的结算权限，请刷新后重试。</Alert>;
    if(!canViewSellerFinancials(memberRole))return <Alert tone="warning">当前成员角色不能查看财务结算。</Alert>;
    return <SellerSettlementsPage />;
  }
  if (pathname === '/seller/settings') return <SellerSettingsV2Page />;
  return <SellerDashboardPage />;
}
