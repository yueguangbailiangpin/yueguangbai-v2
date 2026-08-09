import { useLocation } from 'react-router';
import { BuyerLayout } from './BuyerLayout';
import { BuyerRouteProvider } from '../../routes/IdentityRouteSlots';
import { RouteChunkBoundary } from '../../routes/RouteChunkBoundary';
import { BuyerDashboardPage } from '../dashboard/BuyerDashboardPage';
import { BuyerDemandDetailPage } from '../demands/BuyerDemandDetailPage'; import { BuyerDemandsPage } from '../demands/BuyerDemandsPage';
import { BuyerReservationDetailPage } from '../reservations/BuyerReservationDetailPage'; import { BuyerReservationsPage } from '../reservations/BuyerReservationsPage';

const loadBuyerInstructionRoute = () => import('./BuyerInstructionRouteModule');
const loadBuyerOrderRoutes = () => import('./BuyerOrderRouteModule');
const loadBuyerAfterSalesRoutes = () => import('./BuyerAfterSalesRouteModule');

export { BuyerLayout };

export default function BuyerPortal(): React.JSX.Element {
  return <BuyerRouteProvider page={BuyerRoutePage}><BuyerLayout /></BuyerRouteProvider>;
}

export function BuyerRoutePage(): React.JSX.Element {
  const { pathname } = useLocation();
  if (/^\/buyer\/demands\/[^/]+$/u.test(pathname)) return <BuyerDemandDetailPage />;
  if (pathname === '/buyer/demands') return <BuyerDemandsPage />;
  if (/^\/buyer\/reservations\/[^/]+\/instruction$/u.test(pathname)) return <RouteChunkBoundary load={loadBuyerInstructionRoute} />;
  if (/^\/buyer\/reservations\/[^/]+$/u.test(pathname)) return <BuyerReservationDetailPage />;
  if (pathname === '/buyer/reservations') return <BuyerReservationsPage />;
  if (pathname.startsWith('/buyer/order-materials') || pathname.startsWith('/buyer/orders') || pathname === '/buyer/me') return <RouteChunkBoundary load={loadBuyerOrderRoutes} />;
  if (pathname.startsWith('/buyer/reviews') || pathname.startsWith('/buyer/refunds')) return <RouteChunkBoundary load={loadBuyerAfterSalesRoutes} />;
  return <BuyerDashboardPage />;
}
