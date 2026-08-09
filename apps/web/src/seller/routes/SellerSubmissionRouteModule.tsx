import { useLocation } from 'react-router';
import {
  SellerDemandFormPage,
  SellerProductApplicationFormPage,
} from '../pages/SellerSubmissionPages';

export default function SellerSubmissionRoutePage(): React.JSX.Element {
  const { pathname } = useLocation();
  return pathname === '/seller/products/new'
    ? <SellerProductApplicationFormPage />
    : <SellerDemandFormPage />;
}
