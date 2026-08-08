import { useLocation } from 'react-router';
import { BuyerRefundDetailPage } from '../refunds/BuyerRefundDetailPage';
import { BuyerRefundsPage } from '../refunds/BuyerRefundsPage';
import { BuyerReviewDetailPage } from '../reviews/BuyerReviewDetailPage';
import { BuyerReviewFormPage } from '../reviews/BuyerReviewFormPage';
import { BuyerReviewsPage } from '../reviews/BuyerReviewsPage';

export default function BuyerAfterSalesRouteModule(): React.JSX.Element {
  const { pathname } = useLocation();
  if (pathname === '/buyer/reviews/new') return <BuyerReviewFormPage />;
  if (/^\/buyer\/reviews\/[^/]+$/u.test(pathname)) return <BuyerReviewDetailPage />;
  if (pathname === '/buyer/reviews') return <BuyerReviewsPage />;
  if (/^\/buyer\/refunds\/[^/]+$/u.test(pathname)) return <BuyerRefundDetailPage />;
  return <BuyerRefundsPage />;
}
