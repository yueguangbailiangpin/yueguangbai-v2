import { useLocation } from 'react-router';
import { SellerProductCampaignFlowPage } from '../pages/SellerSubmissionPages';

export default function SellerSubmissionRoutePage(): React.JSX.Element {
  const { pathname } = useLocation();
  return <SellerProductCampaignFlowPage initialMode={
    pathname === '/seller/demands/new' ? 'demand' : 'product'
  } />;
}
