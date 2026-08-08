import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Clock3, Tag, UsersRound } from 'lucide-react';
import { Link } from 'react-router';
import { buyerApi } from '../api/client';
import type { Demand } from '../contracts/runtime';
import { buyerQueryKeys, cursorQuery } from '../queries/keys';
import { formatShanghai } from '../shared/format';
import { BuyerEmpty, BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { BuyerPagination } from '../shared/BuyerPagination';
import { useCursorPages } from '../queries/useCursorPages';

function BuyerProductCard({ product, featured = false }: { product: Demand; featured?: boolean }): React.JSX.Element {
  return <Link
    className={`buyer-product-card${featured ? ' buyer-featured-product' : ''}`}
    to={`/buyer/demands/${product.demand_id}`}
  ><div className="buyer-product-heading"><span className="buyer-product-icon" aria-hidden="true"><Tag /></span>
    <div><p>{product.store_display_name}</p><h2>{product.product_name}</h2></div></div>
    <dl className="buyer-product-meta"><div><dt><Clock3 aria-hidden="true" />预约截止</dt>
      <dd>{formatShanghai(product.reservation_deadline)}</dd></div>
      <div><dt><UsersRound aria-hidden="true" />剩余名额</dt><dd>{product.remaining_quantity}</dd></div></dl>
    <span className="buyer-product-action">查看产品 <ArrowRight aria-hidden="true" /></span>
  </Link>;
}

export function BuyerDashboardPage(): React.JSX.Element {
  const client = useQueryClient();
  const pages = useCursorPages({
    resetKey: 'products:20',
    queryKey: (cursor) => buyerQueryKeys.demandsPage({ limit: 20, cursor }),
    queryFn: (cursor, signal) => buyerApi.demands(
      client,
      cursorQuery({ limit: 20, cursor }),
      signal,
    ).then((result) => result.data),
  });

  const primaryProduct = pages.items[0];
  const otherProducts = pages.items.slice(1);

  return <section className="buyer-page buyer-dashboard-page">
    <section className="buyer-journey" aria-label="业务流程">
      <ol>
        <li aria-current="step"><span>1</span><strong>产品</strong></li>
        <li><span>2</span><strong>订单资料</strong></li>
        <li><span>3</span><strong>评论</strong></li>
        <li><span>4</span><strong>完成</strong></li>
      </ol>
    </section>
    {!primaryProduct ? <h1 className="buyer-dashboard-status-title">当前开放产品</h1> : null}
    {pages.isInitialPending ? <BuyerLoading label="正在读取产品" /> : null}
    {pages.initialError ? <BuyerQueryError error={pages.initialError} title="产品暂时无法读取" /> : null}
    {!pages.isInitialPending && !pages.initialError && pages.items.length === 0
      ? <BuyerEmpty title="暂无可预约产品" description="有可预约产品时会显示在这里。" />
      : primaryProduct ? <div className="buyer-dashboard-content">
        <section className="buyer-featured-products" aria-labelledby="buyer-featured-products-title">
          <h1 id="buyer-featured-products-title">当前开放产品</h1>
          <BuyerProductCard product={primaryProduct} featured />
        </section>
        <section className="buyer-next-step" aria-labelledby="buyer-next-step-title">
          <h2 id="buyer-next-step-title">下一步</h2>
          <Link className="buyer-next-card" to={`/buyer/demands/${primaryProduct.demand_id}`}>
            <span className="buyer-next-icon" aria-hidden="true"><Clock3 /></span>
            <span className="buyer-next-copy"><strong>查看预约信息</strong>
              <span>{primaryProduct.product_name}</span>
              <small>剩余名额 {primaryProduct.remaining_quantity} · 截止 {formatShanghai(primaryProduct.reservation_deadline)}</small>
            </span>
            <ArrowRight aria-hidden="true" />
          </Link>
        </section>
        {otherProducts.length > 0 ? <section className="buyer-other-products" aria-labelledby="buyer-other-products-title">
          <h2 id="buyer-other-products-title">更多可预约产品</h2>
          <div className="buyer-product-grid">{otherProducts.map((product) => <BuyerProductCard key={product.demand_id} product={product} />)}</div>
        </section> : null}
      </div> : null}
    {!pages.isInitialPending && !pages.initialError ? <BuyerPagination {...pages} onLoadMore={pages.loadMore} onRetry={pages.retryLater} /> : null}
  </section>;
}
