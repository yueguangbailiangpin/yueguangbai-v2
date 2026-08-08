import { useLocation } from 'react-router';
import { BuyerFormalOrderDetailPage } from '../formal-orders/BuyerFormalOrderDetailPage';
import { BuyerFormalOrdersPage } from '../formal-orders/BuyerFormalOrdersPage';
import { BuyerMePage } from '../me/BuyerMePage';
import { BuyerOrderEvidenceDetailPage } from '../order-evidence/BuyerOrderEvidenceDetailPage';
import { BuyerOrderEvidenceFormPage } from '../order-evidence/BuyerOrderEvidenceFormPage';
import { BuyerOrderMaterialsPage } from '../order-evidence/BuyerOrderMaterialsPage';

export default function BuyerOrderRouteModule(): React.JSX.Element {
  const { pathname } = useLocation();
  if (pathname === '/buyer/order-materials/new') return <BuyerOrderEvidenceFormPage />;
  if (/^\/buyer\/order-materials\/[^/]+$/u.test(pathname)) return <BuyerOrderEvidenceDetailPage />;
  if (pathname === '/buyer/order-materials') return <BuyerOrderMaterialsPage />;
  if (/^\/buyer\/orders\/[^/]+$/u.test(pathname)) return <BuyerFormalOrderDetailPage />;
  if (pathname === '/buyer/orders') return <BuyerFormalOrdersPage />;
  return <BuyerMePage />;
}
