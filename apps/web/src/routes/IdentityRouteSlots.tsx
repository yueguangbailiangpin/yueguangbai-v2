import { createContext, useContext, type ComponentType, type ReactNode } from 'react';

type RoutePage = ComponentType;

function createRouteSlot(): readonly [
  ({ children, page }: { children: ReactNode; page: RoutePage }) => React.JSX.Element,
  () => React.JSX.Element,
] {
  const Context = createContext<RoutePage | null>(null);
  function Provider({ children, page }: { children: ReactNode; page: RoutePage }): React.JSX.Element {
    return <Context.Provider value={page}>{children}</Context.Provider>;
  }
  function Slot(): React.JSX.Element {
    const Page = useContext(Context);
    if (!Page) throw new Error('identity_route_slot_missing');
    return <Page />;
  }
  return [Provider, Slot];
}

export const [BuyerRouteProvider, BuyerRouteSlot] = createRouteSlot();
export const [SellerRouteProvider, SellerRouteSlot] = createRouteSlot();
export const [StaffRouteProvider, StaffRouteSlot] = createRouteSlot();
