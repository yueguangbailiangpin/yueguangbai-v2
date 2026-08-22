import { ArrowRight, Clock3, Tag, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Button, PageHeader, SearchInput, Select, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys, cursorQuery } from '../queries/keys';
import { useCursorPages } from '../queries/useCursorPages';
import { formatBps, formatJpy, formatShanghai } from '../shared/format';
import { BuyerEmpty, BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { ProtectedImage } from '../shared/ProtectedImage';
import { reviewTypeLabel } from '../shared/status';

const PAGE_SIZE = 6;
type Filter = 'ALL' | 'IMAGE' | 'TEXT' | 'RATING' | 'VIDEO' | 'TONIGHT';

export function BuyerDemandsPage(): React.JSX.Element {
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [page, setPage] = useState(1);
  const pages = useCursorPages({
    resetKey: 'demands:100',
    queryKey: (cursor) => buyerQueryKeys.demandsPage({ limit: 100, cursor }),
    queryFn: (cursor, signal) =>
      buyerApi.demands(client, cursorQuery({ limit: 100, cursor }), signal).then((r) => r.data),
  });
  const filtered = useMemo(() => {
    const query = search.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
    const today = shanghaiDateKey(Date.now());
    return pages.items.filter((item) => {
      if (
        query &&
        !`${item.product_name}\u0000${item.store_display_name}`
          .toLocaleLowerCase('zh-CN')
          .includes(query)
      )
        return false;
      if (filter === 'TONIGHT') return shanghaiDateKey(item.reservation_deadline) === today;
      if (filter !== 'ALL' && item.task_type !== filter) return false;
      return true;
    });
  }, [filter, pages.items, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  function changeSearch(value: string): void {
    setSearch(value);
    setPage(1);
  }
  function changeFilter(value: Filter): void {
    setFilter(value);
    setPage(1);
  }

  return (
    <section className="buyer-page buyer-products-page buyer-products-s3">
      <PageHeader
        eyebrow="买家产品"
        title="当前开放产品"
        description="产品页只展示可以预约的商品；需要您处理的事情都收在“任务”里～"
      />
      <div className="buyer-product-toolbar">
        <SearchInput
          value={search}
          onChange={(event) => changeSearch(event.target.value)}
          placeholder="搜产品或店铺"
          label="搜产品或店铺"
        />
        <Select
          aria-label="筛选任务类型"
          value={filter}
          onChange={(event) => changeFilter(event.target.value as Filter)}
        >
          <option value="ALL">全部</option>
          <option value="IMAGE">图文</option>
          <option value="TEXT">文字</option>
          <option value="RATING">评分</option>
          <option value="VIDEO">视频</option>
          <option value="TONIGHT">今晚截止</option>
        </Select>
      </div>
      {pages.isInitialPending ? (
        <BuyerLoading />
      ) : pages.initialError ? (
        <BuyerQueryError error={pages.initialError} />
      ) : filtered.length === 0 ? (
        <BuyerEmpty title="暂时还没找到合适的产品～" description="要不换个关键词再搜搜看？" />
      ) : (
        <div className="buyer-product-rows">
          {visible.map((item) => (
            <Link
              className="buyer-product-row"
              key={item.demand_id}
              to={`/buyer/demands/${item.demand_id}`}
            >
              <div className="buyer-product-icon">
                {item.main_image ? <ProtectedImage
                  reference={item.main_image}
                  alt=""
                  className="buyer-product-main-image"
                  fallback={<Tag />}
                /> : <Tag />}
              </div>
              <div className="buyer-product-row-main">
                <div className="buyer-product-row-title">
                  <div>
                    <p>{item.store_display_name}</p>
                    <h2>{item.product_name}</h2>
                  </div>
                  <StatusBadge tone={item.reservation_eligibility === 'ELIGIBLE' ? 'processing' : 'warning'}>
                    {item.reservation_eligibility === 'ELIGIBLE'
                      ? reviewTypeLabel(item.task_type)
                      : '该店铺已有预约'}
                  </StatusBadge>
                </div>
                <div className="buyer-product-row-facts">
                  <span>{formatJpy(item.reference_order_amount_jpy)}</span>
                  <span>自费 {formatBps(item.buyer_self_pay_bps)}</span>
                  <span>
                    <UsersRound aria-hidden="true" />剩 {item.remaining_quantity}
                  </span>
                  <span>
                    <Clock3 aria-hidden="true" />
                    {formatShanghai(item.reservation_deadline)}
                  </span>
                </div>
              </div>
              <ArrowRight className="buyer-product-row-arrow" aria-hidden="true" />
            </Link>
          ))}
        </div>
      )}
      {!pages.isInitialPending && !pages.initialError && filtered.length > 0 ? (
        <nav className="buyer-local-pagination" aria-label="产品分页">
          <Button
            className="secondary"
            disabled={currentPage <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            上一页
          </Button>
          <span>
            第 {currentPage} / {totalPages} 页
          </span>
          <Button
            className="secondary"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
          >
            下一页
          </Button>
        </nav>
      ) : null}
      {pages.hasMore ? (
        <div className="buyer-server-pagination">
          <Button
            className="secondary"
            loading={pages.isLoadingMore}
            loadingLabel="加载中…"
            onClick={pages.loadMore}
          >
            加载更多
          </Button>
        </div>
      ) : null}
      {pages.laterError ? (
        <div className="buyer-server-pagination">
          <Button className="secondary" onClick={pages.retryLater}>
            重新加载
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function shanghaiDateKey(epoch: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epoch));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value['year']}-${value['month']}-${value['day']}`;
}
