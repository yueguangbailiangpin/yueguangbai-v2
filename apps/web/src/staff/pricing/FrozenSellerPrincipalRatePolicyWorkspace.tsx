import { SellerPrincipalRatePolicyWorkspace } from './SellerPrincipalRatePolicyWorkspace';

export function FrozenSellerPrincipalRatePolicyWorkspace():React.JSX.Element{
  return <div className="frozen-principal-rate-boundary" onClickCapture={(event)=>{
    const target=event.target instanceof Element?event.target.closest('button'):null;
    if(!target||target.textContent?.trim()!=='确认生效策略')return;
    const accepted=window.confirm('确认让这条卖家本金汇率策略生效？\n\n它会影响生效时间之后的新正式订单，历史订单不会回写。');
    if(!accepted){event.preventDefault();event.stopPropagation();}
  }}><SellerPrincipalRatePolicyWorkspace/></div>;
}
