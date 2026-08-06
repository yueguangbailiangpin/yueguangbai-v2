import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, FormField, PageHeader, Select, TextInput } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys } from '../queries/keys';
import { formatDateOnly, formatJpy } from '../shared/format';
import { BuyerEmpty, BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';

export function BuyerFormalOrdersPage(): React.JSX.Element {
  const client = useQueryClient();
  const [filters, setFilters] = useState('limit=20');
  const query = useQuery({
    queryKey: buyerQueryKeys.formalOrders(filters),
    queryFn: ({ signal }) => buyerApi.formalOrders(client, filters, signal).then((r) => r.data),
  });
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const params = new URLSearchParams({ limit: '20' });
    for (const key of ['marketplace', 'product_name', 'review_type', 'confirmed_business_date', 'formal_order_id', 'amazon_order_number'] as const) {
      const value = String(values.get(key) ?? '').trim();
      if (value) params.set(key, value);
    }
    setFilters(params.toString());
  }
  return <section className="buyer-page"><PageHeader eyebrow="正式订单" title="正式订单" description="这里显示确认时保存的只读财务快照。" />
    <form className="buyer-filter-form" role="search" onSubmit={submit} aria-label="正式订单筛选">
      <FormField label="市场" htmlFor="order-market"><Select name="marketplace" defaultValue=""><option value="">全部</option><option value="JP">日本</option></Select></FormField>
      <FormField label="产品名称" htmlFor="order-product"><TextInput name="product_name" /></FormField>
      <FormField label="评论类型" htmlFor="order-review-type"><Select name="review_type" defaultValue=""><option value="">全部</option>{['RATING', 'TEXT', 'IMAGE', 'VIDEO'].map((value) => <option key={value}>{value}</option>)}</Select></FormField>
      <FormField label="确认业务日期" htmlFor="order-confirmed-date"><TextInput name="confirmed_business_date" type="date" /></FormField>
      <FormField label="正式订单号" htmlFor="order-id"><TextInput name="formal_order_id" /></FormField>
      <FormField label="Amazon 订单号" htmlFor="order-amazon"><TextInput name="amazon_order_number" /></FormField>
      <Button type="submit">筛选</Button>
    </form>
    {query.isPending ? <BuyerLoading /> : query.isError ? <BuyerQueryError error={query.error} />
      : query.data.items.length === 0 ? <BuyerEmpty title="暂无正式订单" description="资料确认后会显示正式订单。" />
        : <div className="buyer-card-list">{query.data.items.map((item) => <Link className="buyer-record-card" key={item.formal_order_id} to={`/buyer/orders/${item.formal_order_id}`}>
          <strong>{item.product_name}</strong><dl className="compact-facts"><div><dt>Amazon 下单日期</dt><dd>{formatDateOnly(item.amazon_order_date)}</dd></div>
            <div><dt>确认业务日期</dt><dd>{item.confirmed_business_date}</dd></div><div><dt>最终支付</dt><dd>{formatJpy(item.final_paid_jpy)}</dd></div></dl>
        </Link>)}</div>}
    {query.data?.next_cursor ? <Button className="secondary" onClick={() => setFilters(`${filters}&cursor=${encodeURIComponent(query.data.next_cursor!)}`)}>下一页</Button> : null}
  </section>;
}
