import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Button, FormField, PageHeader, Select, TextInput } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys, formalOrderQuery, type FormalOrderPageParameters } from '../queries/keys';
import { useCursorPages } from '../queries/useCursorPages';
import { formatDateOnly, formatJpy } from '../shared/format';
import { BuyerPagination } from '../shared/BuyerPagination';
import { BuyerEmpty, BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { BuyerJourney } from '../shared/BuyerJourney';
import { reviewTypeLabel } from '../shared/status';

export function BuyerFormalOrdersPage(): React.JSX.Element {
  const client = useQueryClient();
  const emptyFilters = {
    marketplace: null,
    productName: null,
    reviewType: null,
    confirmedBusinessDate: null,
    formalOrderId: null,
    amazonOrderNumber: null,
  } as const;
  const [filters, setFilters] =
    useState<Omit<FormalOrderPageParameters, 'limit' | 'cursor'>>(emptyFilters);
  const resetKey = JSON.stringify(filters);
  const query = useCursorPages({
    resetKey,
    queryKey: (cursor) => buyerQueryKeys.formalOrdersPage({ ...filters, limit: 20, cursor }),
    queryFn: (cursor, signal) =>
      buyerApi
        .formalOrders(client, formalOrderQuery({ ...filters, limit: 20, cursor }), signal)
        .then((r) => r.data),
  });
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const read = (key: string): string | null => String(values.get(key) ?? '').trim() || null;
    setFilters({
      marketplace: read('marketplace'),
      productName: read('product_name'),
      reviewType: read('review_type'),
      confirmedBusinessDate: read('confirmed_business_date'),
      formalOrderId: read('formal_order_id'),
      amazonOrderNumber: read('amazon_order_number'),
    });
  }
  return (
    <section className="buyer-page buyer-flow-page buyer-list-page">
      <BuyerJourney current="evidence" />
      <PageHeader
        eyebrow="订单资料阶段"
        title="正式订单"
        description="这里显示确认订单时保存的信息，之后不会变。"
      />
      <form className="buyer-filter-form" role="search" onSubmit={submit} aria-label="正式订单筛选">
        <FormField label="市场" htmlFor="order-market">
          <Select name="marketplace" defaultValue="">
            <option value="">全部</option>
            <option value="JP">日本</option>
          </Select>
        </FormField>
        <FormField label="产品名称" htmlFor="order-product">
          <TextInput name="product_name" />
        </FormField>
        <FormField label="评论类型" htmlFor="order-review-type">
          <Select name="review_type" defaultValue="">
            <option value="">全部</option>
            {['RATING', 'TEXT', 'IMAGE', 'VIDEO'].map((value) => (
              <option key={value} value={value}>
                {reviewTypeLabel(value)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="确认日期" htmlFor="order-confirmed-date">
          <TextInput name="confirmed_business_date" type="date" />
        </FormField>
        <FormField label="正式订单号" htmlFor="order-id">
          <TextInput name="formal_order_id" />
        </FormField>
        <FormField label="Amazon 订单号" htmlFor="order-amazon">
          <TextInput name="amazon_order_number" />
        </FormField>
        <Button type="submit">筛选</Button>
      </form>
      {query.isInitialPending ? (
        <BuyerLoading />
      ) : query.initialError ? (
        <BuyerQueryError error={query.initialError} />
      ) : query.items.length === 0 ? (
        <BuyerEmpty title="暂无正式订单" description="资料确认后会显示正式订单。" />
      ) : (
        <div className="buyer-card-list">
          {query.items.map((item) => (
            <Link
              className="buyer-record-card buyer-stage-card"
              key={item.formal_order_id}
              to={`/buyer/orders/${item.formal_order_id}`}
            >
              <strong>{item.product_name}</strong>
              <dl className="compact-facts">
                <div>
                  <dt>Amazon 下单日期</dt>
                  <dd>{formatDateOnly(item.amazon_order_date)}</dd>
                </div>
                <div>
                  <dt>确认日期</dt>
                  <dd>{item.confirmed_business_date}</dd>
                </div>
                <div>
                  <dt>最终支付金额</dt>
                  <dd>{formatJpy(item.final_paid_jpy)}</dd>
                </div>
              </dl>
            </Link>
          ))}
        </div>
      )}
      <BuyerPagination
        hasMore={query.hasMore}
        isLoadingMore={query.isLoadingMore}
        laterError={query.laterError}
        onLoadMore={query.loadMore}
        onRetry={query.retryLater}
      />
    </section>
  );
}
