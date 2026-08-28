import { Navigate, useLocation } from 'react-router';
import { BuyerFrame as BuyerLayout } from './BuyerFrame';
import { BuyerRouteProvider } from '../../routes/IdentityRouteSlots';
import { RouteChunkBoundary } from '../../routes/RouteChunkBoundary';
import { BuyerHomePage } from '../home/BuyerHomePage';
import { BuyerDemandDetailPage } from '../demands/BuyerDemandDetailPage';
import { BuyerDemandsPage } from '../demands/BuyerDemandsPage';
import { BuyerReservationDetailPage } from '../reservations/BuyerReservationDetailPage';
import { BuyerReservationsPage } from '../reservations/BuyerReservationsPage';

const loadBuyerInstructionRoute = () => import('./BuyerInstructionRouteModule');
const loadBuyerOrderRoutes = () => import('./BuyerOrderRouteModule');
const loadBuyerAfterSalesRoutes = () => import('./BuyerAfterSalesRouteModule');
const loadBuyerTasksRoute = () => import('./BuyerTasksRouteModule');


export default function BuyerPortal(): React.JSX.Element {
  return (
    <BuyerRouteProvider page={BuyerRoutePage}>
      <BuyerLayout />
    </BuyerRouteProvider>
  );
}

export function BuyerRoutePage(): React.JSX.Element {
  const { pathname } = useLocation();
  if (pathname === '/buyer') return <BuyerHomePage />;
  if (pathname === '/buyer/products' || pathname === '/buyer/demands') return <BuyerDemandsPage />;
  if (pathname === '/buyer/tasks')
    return <RouteChunkBoundary key={pathname} load={loadBuyerTasksRoute} />;
  if (/^\/buyer\/demands\/[^/]+$/u.test(pathname)) return <BuyerDemandDetailPage />;
  if (/^\/buyer\/reservations\/[^/]+\/instruction$/u.test(pathname))
    return <RouteChunkBoundary key={pathname} load={loadBuyerInstructionRoute} />;
  if (/^\/buyer\/reservations\/[^/]+$/u.test(pathname)) return <BuyerReservationDetailPage />;
  if (pathname === '/buyer/reservations') return <BuyerReservationsPage />;
  if (
    pathname.startsWith('/buyer/order-materials') ||
    pathname.startsWith('/buyer/orders') ||
    pathname === '/buyer/me'
  )
    return <RouteChunkBoundary key={pathname} load={loadBuyerOrderRoutes} />;
  if (pathname.startsWith('/buyer/reviews') || pathname.startsWith('/buyer/refunds'))
    return <RouteChunkBoundary key={pathname} load={loadBuyerAfterSalesRoutes} />;
  return <Navigate to="/buyer/products" replace />;
}
