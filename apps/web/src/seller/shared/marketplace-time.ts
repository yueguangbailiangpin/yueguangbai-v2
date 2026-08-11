import { MARKETPLACE_RUNTIME_DEFINITIONS,type CanonicalMarketplaceCode } from '@ygb/contracts';

const formatters=new Map<CanonicalMarketplaceCode,Intl.DateTimeFormat>();

export function formatSellerMarketplaceDateTime(
  value:number,
  marketplaceCode:CanonicalMarketplaceCode='AMAZON_JP',
):string{
  if(!Number.isSafeInteger(value)||value<0)return '—';
  let formatter=formatters.get(marketplaceCode);
  if(!formatter){
    formatter=new Intl.DateTimeFormat('zh-CN',{
      timeZone:MARKETPLACE_RUNTIME_DEFINITIONS[marketplaceCode].business_timezone,
      year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,
    });
    formatters.set(marketplaceCode,formatter);
  }
  return `${formatter.format(new Date(value))}（站点当地时间）`;
}
