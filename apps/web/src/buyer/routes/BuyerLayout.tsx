import type { ReactNode } from 'react';
import { BuyerFrame } from './BuyerFrame';

export {
  BUYER_NAVIGATION,
  BUYER_SIDEBAR_NAVIGATION,
  buyerNavigationOwner,
  buyerSidebarOwner,
  type BuyerNavigationPath,
} from './BuyerFrame';

export function BuyerLayout({ children }: { children?: ReactNode } = {}): React.JSX.Element {
  return <BuyerFrame>{children}</BuyerFrame>;
}
