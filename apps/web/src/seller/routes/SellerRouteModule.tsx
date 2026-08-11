import { useLocation } from 'react-router';
import { SellerLayout } from './SellerLayout';
import { SellerRouteProvider } from '../../routes/IdentityRouteSlots';
import { RouteChunkBoundary } from '../../routes/RouteChunkBoundary';
import { SellerDashboardPage, SellerDemandsPage, SellerOrdersPage, SellerProductApplicationDetailPage, SellerProductsPage, SellerReviewsPage, SellerSettlementsPage } from '../pages/SellerPages';
import { SellerSettingsV2Page } from '../pages/SellerSettingsV2Page';

const loadSellerSubmissionRoutes = () => import('./SellerSubmissionRouteModule');

export { SellerLayout };

export default function SellerPortal(): React.JSX.Element {
  return <SellerRouteProvider page={SellerRoutePage}><SellerLayout /></SellerRouteProvider>;
}

export function SellerRoutePage(): React.JSX.Element {
  const { pathname } = useLocation();
  if (pathname === '/seller/products/new' || pathname === '/seller/demands/new') {
    return <RouteChunkBoundary load={loadSellerSubmissionRoutes} />;
  }
  if (/^\/seller\/products\/[^/]+$/u.test(pathname)) return <SellerProductApplicationDetailPage />;
  if (pathname === '/seller/products') return <SellerProductsPage />;
  if (pathname === '/seller/demands') return <SellerDemandsPage />;
  if (pathname === '/seller/orders') return <SellerOrdersPage />;
  if (pathname === '/seller/reviews') return <SellerReviewsPage />;
  if (pathname === '/seller/settlements') return <SellerSettlementsPage />;
  if (pathname === '/seller/settings') return <SellerSettingsV2Page />;
  return <SellerDashboardPage />;
}
