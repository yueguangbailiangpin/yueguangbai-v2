// Deliberately .ts: extensionless imports resolve this compatibility entry before
// the legacy SellerPages.tsx implementation. The V2 implementation keeps the
// frozen Seller modules while using marketplace-local (Tokyo for current JP)
// date presentation. The legacy .tsx remains only as a comparison artifact for
// local Codex and is not the active import target.
export {
  SellerDashboardPage,
  SellerDemandsPage,
  SellerOrdersPage,
  SellerProductApplicationDetailPage,
  SellerProductsPage,
  SellerReviewsPage,
  SellerSettlementsPage,
  SellerSettingsPage,
} from './SellerPagesMarketplace';
