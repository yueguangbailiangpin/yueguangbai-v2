import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, MessageSquareText, Store, UserCheck, WalletCards } from 'lucide-react';
import { z } from 'zod';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
  Alert,
  Button,
  Card,
  Dialog,
  EmptyState,
  PageHeader,
  StatusBadge,
} from '../../ui/primitives';
import { useBuyerMutation } from '../../buyer/mutations/useBuyerMutation';
import { BuyerMutationRecovery } from '../../buyer/shared/BuyerMutationRecovery';
import { ProtectedImagePreview } from '../../files/ProtectedImagePreview';
import {
  SellerOrderChatScreenshotReadIntentAdapter,
} from '../../files/file-read-providers';
import { CursorPagination } from '../../ui/CursorPagination';
import { identityApiRequest } from '../../api/identity-request';
import { sellerApi } from '../api/client';
import { sellerFormalOrdersSchema } from '../contracts/runtime';
import { sellerQueryKeys } from '../queries/keys';
import { canViewSellerFinancials } from '../authorization';
import { useSellerCursorPages } from '../queries/useSellerCursorPages';
import { useSellerStoreContext } from '../routes/SellerLayout';

const shanghai = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const cny = (fen: string): string => {
  const value = BigInt(fen);
  return `¥${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
};
const money = (amount: string, currency: string, exponent: number): string => {
  const value = BigInt(amount);
  if (exponent === 0) return `${value} ${currency}`;
  const scale = 10n ** BigInt(exponent);
  return `${value / scale}.${(value % scale).toString().padStart(exponent, '0')} ${currency}`;
};
const rate = (value: string, scale: string, source: string): string => {
  const numerator = BigInt(value);
  const denominator = BigInt(scale);
  const precision = 6n;
  const multiplier = 10n ** precision;
  const scaled = (numerator * multiplier) / denominator;
  const fraction = (scaled % multiplier)
    .toString()
    .padStart(Number(precision), '0')
    .replace(/0+$/u, '');
  return `1 ${source} = ${scaled / multiplier}${fraction ? `.${fraction}` : ''} CNY`;
};
const formatShanghai = (value: number): string => `${shanghai.format(new Date(value))}（日本时间）`;
const componentLabel = { PENDING: '待完成', COMPLETE: '已完成', NOT_APPLICABLE: '不适用' } as const;
const productStatusLabel = { ACTIVE: '启用中', DISABLED: '已停用' } as const;
const applicationStatusLabel = {
  SUBMITTED: '待审核',
  APPROVED: '已通过',
  REJECTED: '未通过',
  WITHDRAWN: '已撤回',
} as const;
const demandStatusLabel = {
  SUBMITTED: '待审核',
  PUBLISHED: '已发布',
  REJECTED: '未通过',
  WITHDRAWN: '已撤回',
  CLOSED: '已关闭',
} as const;
const reviewStatusLabel = {
  PENDING_REVIEW: '待审核',
  CHANGES_REQUESTED: '需修改',
  REJECTED: '未通过',
  WITHDRAWN: '已撤回',
  APPROVED: '已通过',
} as const;
const payableStatusLabel = {
  UNPAID: '待结算',
  PARTIALLY_PAID: '部分结算',
  PAID: '已完成',
} as const;
const paymentStatusLabel = {
  REVERSED: '已冲正',
  UNALLOCATED: '待分配',
  PARTIALLY_ALLOCATED: '部分分配',
  FULLY_ALLOCATED: '已分配',
} as const;
const taskTypeLabel = {
  RATING: '评分评价',
  TEXT: '文字评价',
  IMAGE: '图文评价',
  VIDEO: '视频评价',
} as const;
const marketplaceLabel = {
  AMAZON_JP: '日本站',
  AMAZON_US: '美国站',
  COUPANG_KR: '韩国站',
  RAKUTEN_JP: '乐天日本站（未接入）',
  TIKTOK_JP: 'TikTok 日本站（未接入）',
} as const;
const roleLabel = {
  OWNER: '负责人',
  OPERATIONS: '运营成员',
  FINANCE: '财务成员',
  VIEWER: '查看成员',
} as const;
type Tone = 'neutral' | 'processing' | 'success' | 'warning' | 'danger';

function tone(status: string): Tone {
  if (['ACTIVE', 'APPROVED', 'PUBLISHED', 'PAID', 'COMPLETE'].includes(status)) return 'success';
  if (['REJECTED'].includes(status)) return 'danger';
  if (['CHANGES_REQUESTED', 'PARTIALLY_PAID'].includes(status)) return 'warning';
  if (['WITHDRAWN', 'CLOSED', 'DISABLED'].includes(status)) return 'neutral';
  return 'processing';
}

function RecordCard({
  title,
  meta,
  status,
  statusTone,
  children,
  actions,
}: {
  title: string;
  meta: string;
  status: string;
  statusTone: Tone;
  children: ReactNode;
  actions?: ReactNode;
}): React.JSX.Element {
  return (
    <Card as="article" className="seller-record-card">
      <header className="seller-record-heading">
        <div>
          <h2>{title}</h2>
          <p>{meta}</p>
        </div>
        <StatusBadge tone={statusTone}>{status}</StatusBadge>
      </header>
      {children}
      {actions ? <div className="seller-record-actions">{actions}</div> : null}
    </Card>
  );
}

function FactGrid({ children }: { children: ReactNode }): React.JSX.Element {
  return <dl className="seller-record-facts">{children}</dl>;
}

function Fact({ label, value }: { label: string; value: ReactNode }): React.JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

const homeDate = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
});

const homeMembersSchema = z
  .object({
    members: z.array(
      z
        .object({
          member_id: z.string(),
          display_name: z.string(),
          role: z.enum(['OWNER', 'OPERATIONS', 'FINANCE', 'VIEWER']),
          primary_owner: z.boolean(),
          status: z.string(),
          member_number: z.number().int(),
        })
        .strict(),
    ),
  })
  .strict();

export function SellerDashboardPage(): React.JSX.Element {
  const client = useQueryClient();
  const { storeId } = useSellerStoreContext();
  const me = useQuery({
    queryKey: sellerQueryKeys.me,
    queryFn: ({ signal }) => sellerApi.me(client, signal).then((r) => r.data.me),
  });
  const orders = useSellerCursorPages({
    resetKey: `seller-orders:${storeId ?? 'all'}:20`,
    queryKey: (cursor) => sellerQueryKeys.ordersPage(storeId, cursor),
    queryFn: (cursor, signal) => sellerApi.orders(client, storeId, cursor, signal),
  });
  // 首页的店铺与产品统计固定按组织口径读取，不受侧栏店铺筛选影响。
  const stores = useSellerCursorPages({
    resetKey: 'seller-stores:100',
    queryKey: sellerQueryKeys.storesPage,
    queryFn: (cursor, signal) => sellerApi.stores(client, cursor, signal),
  });
  const products = useSellerCursorPages({
    resetKey: 'seller-products:all:100',
    queryKey: (cursor) => sellerQueryKeys.productsPage(null, cursor),
    queryFn: (cursor, signal) => sellerApi.products(client, null, cursor, signal),
  });
  const memberRole = me.data?.member.role;
  const isOwner = memberRole === 'OWNER';
  const members = useQuery({
    queryKey: ['seller', 'members'],
    queryFn: ({ signal }) =>
      identityApiRequest('seller', client, {
        path: '/api/seller-portal/members',
        method: 'GET',
        schema: homeMembersSchema,
        signal,
      }).then((response) => response.data.members),
    enabled: isOwner,
    retry: false,
  });
  const canViewSettlement = canViewSellerFinancials(memberRole);
  const settlement = useQuery({
    queryKey: sellerQueryKeys.settlement,
    queryFn: ({ signal }) => sellerApi.settlement(client, signal).then((r) => r.data.settlement),
    enabled: canViewSettlement,
  });
  const organization = me.data?.organization;
  const ordersUnavailable = orders.initialError !== null;
  const chatScreenshotOrders = orders.items.filter(
    (item) => item.communication_screenshots.length > 0,
  );
  const inProgress = orders.items.filter(
    (item) => item.business_completion?.status === 'IN_PROGRESS',
  );
  const activeStores = stores.items.filter((store) => store.status === 'ACTIVE');
  const activeProducts = products.items.filter((item) => item.status === 'ACTIVE');
  const storeProductCount = (storeIdToCount: string): number =>
    activeProducts.filter((item) => item.store.id === storeIdToCount).length;
  const count = (value: number): string => `${value}${orders.hasMore ? '+' : ''}`;
  const hasSuggestions =
    (canViewSettlement &&
      settlement.data !== undefined &&
      settlement.data.total_outstanding_cny_fen !== '0') ||
    chatScreenshotOrders.length > 0 ||
    inProgress.length > 0;
  return (
    <section className="mws-page seller-page seller-dashboard-page">
      <div className="mws-heading">
        <div>
          <p>{homeDate.format(new Date())}</p>
          <h1>{organization?.name ?? '卖家中心'}</h1>
          <span>查看产品、店铺、订单沟通和结算进度。</span>
        </div>
        <div>
          {me.data?.access.can_submit_product_applications ? (
            <Link className="mws-primary" to="/seller/products/new">
              提交产品申请
            </Link>
          ) : null}
          {me.data?.access.can_submit_demand_batches ? (
            <Link className="mws-tonal" to="/seller/demands/new">
              提交数量计划
            </Link>
          ) : null}
        </div>
      </div>
      {orders.initialError || (canViewSettlement && settlement.isError) ? (
        <Alert tone="danger">业务摘要暂时无法完整读取，请刷新后重试。</Alert>
      ) : null}
      <div className="mws-home-grid">
        <div className="mws-main-column">
          <section className="mws-surface" aria-label="建议处理">
            <div className="mws-section-heading">
              <div>
                <h2>建议处理</h2>
                <p>与你的组织相关</p>
              </div>
              <Link className="mws-text" to="/seller/orders">
                查看全部
              </Link>
            </div>
            {orders.isInitialPending ? (
              <p role="status">正在读取建议处理事项…</p>
            ) : ordersUnavailable ? (
              <Alert tone="warning">订单进度暂时不可用，刷新后重试。</Alert>
            ) : !hasSuggestions ? (
              <p className="mws-action-empty">当前没有需要立即处理的事项。</p>
            ) : (
              <>
                {canViewSettlement &&
                settlement.data &&
                settlement.data.total_outstanding_cny_fen !== '0' ? (
                  <article className="mws-action-row">
                    <span className="mws-circle green">
                      <WalletCards aria-hidden="true" />
                    </span>
                    <div>
                      <strong>查看待结算款项</strong>
                      <small>
                        待结本金 {cny(settlement.data.outstanding_principal_cny_fen)} · 服务费{' '}
                        {cny(settlement.data.outstanding_service_fee_cny_fen)}
                      </small>
                    </div>
                    <span className="mws-chip amber">待处理</span>
                    <Link className="mws-tonal" to="/seller/settlements">
                      查看结算
                    </Link>
                  </article>
                ) : null}
                {chatScreenshotOrders.length > 0 ? (
                  <article className="mws-action-row">
                    <span className="mws-circle blue">
                      <MessageSquareText aria-hidden="true" />
                    </span>
                    <div>
                      <strong>查看 {chatScreenshotOrders.length} 笔订单沟通截图</strong>
                      <small>买家售后已上传订单沟通记录</small>
                    </div>
                    <span className="mws-chip blue">{chatScreenshotOrders.length} 条更新</span>
                    <Link className="mws-tonal" to="/seller/orders">
                      查看订单
                    </Link>
                  </article>
                ) : null}
                {inProgress.length > 0 ? (
                  <article className="mws-action-row">
                    <span className="mws-circle purple">
                      <UserCheck aria-hidden="true" />
                    </span>
                    <div>
                      <strong>跟进进行中的订单</strong>
                      <small>{inProgress.length} 笔订单业务尚未完成</small>
                    </div>
                    <span className="mws-chip neutral">进行中</span>
                    <Link className="mws-tonal" to="/seller/orders">
                      查看订单
                    </Link>
                  </article>
                ) : null}
              </>
            )}
          </section>
          <section className="mws-surface" aria-label="店铺与产品">
            <div className="mws-section-heading">
              <div>
                <h2>店铺与产品</h2>
                <p>
                  {stores.isInitialPending || products.isInitialPending
                    ? '正在统计店铺与产品…'
                    : `${activeStores.length} 个有效店铺 · ${activeProducts.length} 个在售产品`}
                </p>
              </div>
              <Link className="mws-text" to="/seller/products">
                管理全部
              </Link>
            </div>
            {stores.isInitialPending ? (
              <p role="status">店铺读取中…</p>
            ) : stores.initialError ? (
              <Alert tone="warning">店铺信息暂时不可用，刷新后重试。</Alert>
            ) : stores.items.length === 0 ? (
              <p className="mws-action-empty">组织还没有店铺。</p>
            ) : (
              stores.items.map((store) => {
                const active = store.status === 'ACTIVE';
                return (
                  <div className="mws-store-row" key={store.id}>
                    <span
                      className={active ? 'mws-store-icon' : 'mws-store-icon inactive'}
                      aria-hidden="true"
                    >
                      <Store />
                    </span>
                    <div>
                      <strong>{store.display_name}</strong>
                      <small>
                        {active
                          ? `ACTIVE · ${storeProductCount(store.id)} 个在售产品`
                          : 'DISABLED · 保留历史记录'}
                      </small>
                    </div>
                    <span className="mws-store-figure">
                      {active ? (
                        <>
                          <b>在售产品</b>
                          <strong>{storeProductCount(store.id)}</strong>
                        </>
                      ) : (
                        <>
                          <b>状态</b>
                          <strong>已停用</strong>
                        </>
                      )}
                    </span>
                  </div>
                );
              })
            )}
          </section>
        </div>
        <aside className="mws-side-column">
          <section className="mws-surface" aria-label="本月概览">
            <div className="mws-section-heading">
              <div>
                <h2>本月概览</h2>
                <p>按当前授权范围汇总</p>
              </div>
            </div>
            <dl className="mws-summary-dl">
              <div>
                <dt>已确认订单</dt>
                <dd>
                  {orders.isInitialPending || ordersUnavailable ? '—' : count(orders.items.length)}
                </dd>
              </div>
              {canViewSettlement ? (
                <>
                  <div>
                    <dt>待结本金</dt>
                    <dd>
                      {settlement.data ? cny(settlement.data.outstanding_principal_cny_fen) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>待结服务费</dt>
                    <dd>
                      {settlement.data ? cny(settlement.data.outstanding_service_fee_cny_fen) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>待认领转入款</dt>
                    <dd>
                      {settlement.data ? cny(settlement.data.unallocated_credit_cny_fen) : '—'}
                    </dd>
                  </div>
                </>
              ) : null}
            </dl>
          </section>
          {isOwner ? (
            <section className="mws-surface" aria-label="组织成员">
              <div className="mws-section-heading">
                <div>
                  <h2>组织成员</h2>
                  <p>{members.data ? `${members.data.length} 名成员` : '读取中…'}</p>
                </div>
                <Link className="mws-text" to="/seller/settings">
                  管理
                </Link>
              </div>
              {members.isError ? (
                <p className="mws-action-empty">成员列表暂时不可用。</p>
              ) : (
                (members.data ?? []).map((member) => (
                  <div className="mws-member-row" key={member.member_id}>
                    <span className="mws-member-avatar" aria-hidden="true">
                      {member.display_name.slice(0, 1)}
                    </span>
                    <p>
                      <strong>{member.display_name}</strong>
                      <small>{roleLabel[member.role]}</small>
                    </p>
                  </div>
                ))
              )}
            </section>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

export function SellerProductsPage(): React.JSX.Element {
  const client = useQueryClient();
  const { storeId } = useSellerStoreContext();
  const [pendingWithdraw, setPendingWithdraw] = useState<{ id: string; version: number } | null>(
    null,
  );
  const me = useQuery({
    queryKey: sellerQueryKeys.me,
    queryFn: ({ signal }) => sellerApi.me(client, signal).then((r) => r.data.me),
  });
  const products = useSellerCursorPages({
    resetKey: `seller-products:${storeId ?? 'all'}:100`,
    queryKey: (cursor) => sellerQueryKeys.productsPage(storeId, cursor),
    queryFn: (cursor, signal) => sellerApi.products(client, storeId, cursor, signal),
  });
  const applications = useSellerCursorPages({
    resetKey: `seller-applications:${storeId ?? 'all'}:100`,
    queryKey: (cursor) => sellerQueryKeys.applicationsPage(storeId, cursor),
    queryFn: (cursor, signal) => sellerApi.applications(client, storeId, cursor, signal),
  });
  const withdraw = useBuyerMutation({
    operation: (body: { id: string; version: number }, key, signal) =>
      sellerApi.withdrawApplication(client, body.id, body.version, key, signal),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: sellerQueryKeys.applications(storeId) });
      setPendingWithdraw(null);
    },
  });
  const pending = products.isInitialPending || applications.isInitialPending;
  const failed = products.initialError || applications.initialError;
  return (
    <section className="seller-page">
      <PageHeader title="商品与申请" eyebrow="商品资料">
        {me.data?.access.can_submit_product_applications ? (
          <Link className="button" to="/seller/products/new">
            提交产品申请
          </Link>
        ) : null}
      </PageHeader>
      {pending ? (
        <p role="status">加载中…</p>
      ) : failed ? (
        <>
          <Alert tone="danger">暂时加载不了商品与申请。</Alert>
          <Button
            type="button"
            className="secondary"
            onClick={() => {
              products.retryInitial();
              applications.retryInitial();
            }}
          >
            重新加载
          </Button>
        </>
      ) : products.items.length === 0 && applications.items.length === 0 ? (
        <EmptyState title="暂无商品与申请" description="提交后可以在这儿看审核状态。" />
      ) : (
        <div className="seller-record-list">
          {products.items.map((item) => (
            <RecordCard
              key={item.id}
              title={item.current_version.product_name}
              meta={`${item.store.display_name} · ${item.asin}`}
              status={productStatusLabel[item.status]}
              statusTone={tone(item.status)}
              actions={
                item.status === 'ACTIVE' && me.data?.access.can_submit_demand_batches ? (
                  <Link className="button" to={`/seller/demands/new?product_id=${encodeURIComponent(item.id)}`}>
                    创建数量计划
                  </Link>
                ) : null
              }
            >
              <FactGrid>
                <Fact label="类型" value="已通过商品" />
                <Fact label="版本" value={`v${item.current_version_no}`} />
                <Fact
                  label="主要对接人"
                  value={item.primary_contact_member_name ?? '未设置'}
                />
                <Fact
                  label="搜索词"
                  value={item.current_version.search_keywords.join('、') || '未填'}
                />
                <Fact
                  label="产品金额"
                  value={item.current_version.ordering_guide_expected_amount_jpy === null
                    ? '未设置'
                    : `${item.current_version.ordering_guide_expected_amount_jpy} JPY`}
                />
                <Fact label="更新时间" value={formatShanghai(item.updated_at)} />
              </FactGrid>
            </RecordCard>
          ))}
          {applications.items.map((item) => (
            <RecordCard
              key={item.id}
              title={item.product_name}
              meta={`${item.store.display_name} · ${item.asin}`}
              status={applicationStatusLabel[item.status]}
              statusTone={tone(item.status)}
              actions={
                <>
                  <Link className="button secondary" to={`/seller/products/${item.id}`}>
                    查看申请
                  </Link>
                  {item.status === 'SUBMITTED' &&
                  me.data?.access.can_submit_product_applications ? (
                    <Button
                      className="danger"
                      onClick={() => setPendingWithdraw({ id: item.id, version: item.version })}
                    >
                      撤回申请
                    </Button>
                  ) : null}
                </>
              }
            >
              <FactGrid>
                <Fact label="类型" value="产品申请" />
                <Fact label="提交时间" value={formatShanghai(item.submitted_at)} />
                <Fact label="搜索词" value={item.search_keywords.join('、') || '未填'} />
                <Fact
                  label="申请金额"
                  value={item.ordering_guide_expected_amount_jpy === null
                    ? '历史申请未填写'
                    : `${item.ordering_guide_expected_amount_jpy} JPY`}
                />
                <Fact label="审核说明" value={item.review_reason ?? '暂无'} />
              </FactGrid>
            </RecordCard>
          ))}
        </div>
      )}
      <CursorPagination
        {...products}
        onLoadMore={products.loadMore}
        onRetry={products.retryLater}
        loadLabel="加载更多商品"
        loadingLabel="正在加载更多商品"
        retryLabel="重试商品列表"
        errorMessage="后一页商品暂时无法读取，已加载商品仍会保留。"
      />
      <CursorPagination
        {...applications}
        onLoadMore={applications.loadMore}
        onRetry={applications.retryLater}
        loadLabel="加载更多申请"
        loadingLabel="正在加载更多申请"
        retryLabel="重试申请列表"
        errorMessage="后一页申请暂时无法读取，已加载申请仍会保留。"
      />
      <Dialog
        open={pendingWithdraw !== null}
        title="撤回产品申请"
        description="撤回后，这份申请就没法继续审核了。"
        busy={withdraw.isPending}
        onClose={() => setPendingWithdraw(null)}
      >
        <BuyerMutationRecovery
          mutation={withdraw}
          onRefresh={() => {
            setPendingWithdraw(null);
            applications.retryInitial();
          }}
        />
        <div className="entry-actions">
          <Button className="secondary" onClick={() => setPendingWithdraw(null)}>
            取消
          </Button>
          <Button
            className="danger"
            loading={withdraw.isPending}
            onClick={() => {
              if (pendingWithdraw) withdraw.mutate(pendingWithdraw);
            }}
          >
            确认撤回
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

export function SellerDemandsPage(): React.JSX.Element {
  const client = useQueryClient();
  const { storeId } = useSellerStoreContext();
  const [pendingWithdraw, setPendingWithdraw] = useState<{ id: string; version: number } | null>(
    null,
  );
  const me = useQuery({
    queryKey: sellerQueryKeys.me,
    queryFn: ({ signal }) => sellerApi.me(client, signal).then((r) => r.data.me),
  });
  const demands = useSellerCursorPages({
    resetKey: `seller-demands:${storeId ?? 'all'}:100`,
    queryKey: (cursor) => sellerQueryKeys.demandsPage(storeId, cursor),
    queryFn: (cursor, signal) => sellerApi.demands(client, storeId, cursor, signal),
  });
  const withdraw = useBuyerMutation({
    operation: (body: { id: string; version: number }, key, signal) =>
      sellerApi.withdrawDemand(client, body.id, body.version, key, signal),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: sellerQueryKeys.demands(storeId) });
      setPendingWithdraw(null);
    },
  });
  return (
    <section className="seller-page">
      <PageHeader title="数量计划" eyebrow="按评论类型要数量">
        {me.data?.access.can_submit_demand_batches ? (
          <Link className="button" to="/seller/demands/new">
            提交数量计划
          </Link>
        ) : null}
      </PageHeader>
      {demands.isInitialPending ? (
        <p role="status">加载中…</p>
      ) : demands.initialError ? (
        <>
          <Alert tone="danger">暂时加载不了数量计划。</Alert>
          <Button type="button" className="secondary" onClick={demands.retryInitial}>
            重新加载
          </Button>
        </>
      ) : demands.items.length === 0 ? (
        <EmptyState title="暂无数量计划" description="选好已通过的产品就能提交新的数量计划。" />
      ) : (
        <div className="seller-record-list">
          {demands.items.map((item) => (
            <RecordCard
              key={item.id}
              title={item.product.product_name}
              meta={`${item.store.display_name} · ${item.product.asin}`}
              status={demandStatusLabel[item.status]}
              statusTone={tone(item.status)}
              actions={
                item.status === 'SUBMITTED' && me.data?.access.can_submit_demand_batches ? (
                  <Button
                    className="danger"
                    onClick={() => setPendingWithdraw({ id: item.id, version: item.version })}
                  >
                    撤回计划
                  </Button>
                ) : null
              }
            >
              <FactGrid>
                <Fact label="评价类型" value={taskTypeLabel[item.task_type]} />
                <Fact label="目标数量" value={item.target_quantity} />
                <Fact label="已批准" value={item.approved_quantity} />
                <Fact label="剩余名额" value={item.remaining_quantity} />
                <Fact label="开放时间" value={formatShanghai(item.open_at)} />
                <Fact label="预约截止" value={formatShanghai(item.reservation_deadline)} />
                <Fact label="下单截止" value={formatShanghai(item.order_deadline)} />
                <Fact label="审核说明" value={item.review_reason ?? item.close_reason ?? '暂无'} />
              </FactGrid>
            </RecordCard>
          ))}
        </div>
      )}
      <CursorPagination
        {...demands}
        onLoadMore={demands.loadMore}
        onRetry={demands.retryLater}
        loadLabel="加载更多计划"
        loadingLabel="正在加载更多计划"
        retryLabel="重试计划列表"
        errorMessage="后一页计划暂时无法读取，已加载计划仍会保留。"
      />
      <Dialog
        open={pendingWithdraw !== null}
        title="撤回数量计划"
        description="撤回后这份计划将不再继续审核。"
        busy={withdraw.isPending}
        onClose={() => setPendingWithdraw(null)}
      >
        <BuyerMutationRecovery
          mutation={withdraw}
          onRefresh={() => {
            setPendingWithdraw(null);
            demands.retryInitial();
          }}
        />
        <div className="entry-actions">
          <Button className="secondary" onClick={() => setPendingWithdraw(null)}>
            取消
          </Button>
          <Button
            className="danger"
            loading={withdraw.isPending}
            onClick={() => {
              if (pendingWithdraw) withdraw.mutate(pendingWithdraw);
            }}
          >
            确认撤回
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

export function SellerProductApplicationDetailPage(): React.JSX.Element {
  const { applicationId = '' } = useParams();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: sellerQueryKeys.application(applicationId),
    queryFn: ({ signal }) =>
      sellerApi.application(client, applicationId, signal).then((r) => r.data.application),
    enabled: applicationId.length > 0,
  });
  if (query.isPending)
    return (
      <section className="seller-page">
        <p role="status">加载中…</p>
      </section>
    );
  if (query.isError || !query.data)
    return (
      <section className="seller-page">
        <EmptyState title="无法打开产品申请" description="请返回列表刷新后重试。" />
      </section>
    );
  const item = query.data;
  return (
    <section className="seller-page">
      <PageHeader title="产品申请" eyebrow="申请详情">
        <Link className="button secondary" to="/seller/products">
          返回商品与申请
        </Link>
      </PageHeader>
      <RecordCard
        title={item.product_name}
        meta={`${item.store.display_name} · ${item.asin}`}
        status={applicationStatusLabel[item.status]}
        statusTone={tone(item.status)}
        actions={
          item.status === 'APPROVED' && item.product_id ? (
            <Link
              className="button"
              to={`/seller/demands/new?product_id=${encodeURIComponent(item.product_id)}`}
            >
              创建数量计划
            </Link>
          ) : null
        }
      >
        <FactGrid>
          <Fact label="搜索词" value={item.search_keywords.join('、') || '未填写'} />
          <Fact
            label="申请金额"
            value={item.ordering_guide_expected_amount_jpy === null
              ? '历史申请未填写'
              : `${item.ordering_guide_expected_amount_jpy} JPY`}
          />
          <Fact label="提交时间" value={formatShanghai(item.submitted_at)} />
          <Fact label="更新时间" value={formatShanghai(item.updated_at)} />
          <Fact
            label="审核时间"
            value={item.reviewed_at ? formatShanghai(item.reviewed_at) : '暂无'}
          />
          <Fact
            label="产品链接"
            value={
              item.product_url ? (
                <a href={item.product_url} rel="noreferrer" target="_blank">
                  打开产品页面
                </a>
              ) : (
                '未填写'
              )
            }
          />
          <Fact label="审核说明" value={item.review_reason ?? '暂无'} />
          <Fact label="买家说明" value={item.buyer_visible_notes ?? '未填写'} />
          <Fact label="备注" value={item.seller_notes ?? '未填写'} />
        </FactGrid>
      </RecordCard>
    </section>
  );
}

export function SellerReviewsPage(): React.JSX.Element {
  const client = useQueryClient();
  const { storeId } = useSellerStoreContext();
  const reviews = useSellerCursorPages({
    resetKey: `seller-reviews:${storeId ?? 'all'}:100`,
    queryKey: (cursor) => sellerQueryKeys.reviewsPage(storeId, cursor),
    queryFn: (cursor, signal) => sellerApi.reviews(client, storeId, cursor, signal),
  });
  return (
    <section className="seller-page">
      <PageHeader title="评论" eyebrow="评论进度" />
      {reviews.isInitialPending ? (
        <p role="status">加载中…</p>
      ) : reviews.initialError ? (
        <Alert tone="danger">暂时加载不了评论。</Alert>
      ) : reviews.items.length === 0 ? (
        <EmptyState title="暂无评论" description="评论资料提交后会显示在这里。" />
      ) : (
        <div className="seller-record-list">
          {reviews.items.map((item) => (
            <RecordCard
              key={item.review_case_id}
              title={item.product_name}
              meta={`${item.store.display_name} · ${item.formal_order.amazon_order_number}`}
              status={reviewStatusLabel[item.status]}
              statusTone={tone(item.status)}
            >
              <FactGrid>
                <Fact label="产品标识" value={item.asin} />
                <Fact label="评价类型" value={taskTypeLabel[item.review_type]} />
                <Fact label="提交时间" value={formatShanghai(item.submitted_at)} />
                <Fact
                  label="通过时间"
                  value={item.approved_at ? formatShanghai(item.approved_at) : '暂无'}
                />
                <Fact label="资料数量" value={`${item.evidence.files.length} 份`} />
                <Fact
                  label="卖家服务费"
                  value={
                    item.service_fee_accrued
                      ? cny(item.service_fee_accrued.amount_cny_fen)
                      : '尚未产生'
                  }
                />
              </FactGrid>
            </RecordCard>
          ))}
        </div>
      )}
      <CursorPagination
        {...reviews}
        onLoadMore={reviews.loadMore}
        onRetry={reviews.retryLater}
        loadLabel="加载更多评论"
        loadingLabel="正在加载更多评论"
        retryLabel="重试评论列表"
        errorMessage="后一页评论暂时无法读取，已加载评论仍会保留。"
      />
    </section>
  );
}

export function SellerOrdersPage(): React.JSX.Element {
  const client = useQueryClient();
  const { storeId } = useSellerStoreContext();
  const query = useSellerCursorPages({
    resetKey: `seller-orders:${storeId ?? 'all'}:20`,
    queryKey: (cursor) => sellerQueryKeys.ordersPage(storeId, cursor),
    queryFn: (cursor, signal) => sellerApi.orders(client, storeId, cursor, signal),
  });
  return (
    <section className="seller-page">
      <PageHeader title="订单与业务完成" eyebrow="正式订单" />
      {query.isInitialPending ? (
        <p role="status">加载中…</p>
      ) : query.initialError ? (
        <Alert tone="danger">暂时加载不了正式订单。</Alert>
      ) : query.items.length === 0 ? (
        <EmptyState title="暂无正式订单" description="正式订单确认后会显示在这里。" />
      ) : (
        <div className="seller-record-list">
          {query.items.map((item) => (
            <RecordCard
              key={item.formal_order_id}
              title={item.product_name}
              meta={`${item.store.display_name} · ${item.platform_order_identifier}`}
              status={
                item.business_completion
                  ? item.business_completion.status === 'COMPLETE'
                    ? '业务完成'
                    : '进行中'
                  : '订单已确认'
              }
              statusTone={
                item.business_completion ? tone(item.business_completion.status) : 'neutral'
              }
            >
              {item.main_image ? (
                <ProtectedImagePreview
                  identity="seller"
                  reference={{
                    file_object_id: item.main_image.file_object_id,
                    file_version: item.main_image.file_version,
                    purpose: 'PRODUCT_IMAGE',
                    visibility: 'SELLER_VISIBLE',
                  }}
                  alt={`${item.product_name} 主图`}
                  className="protected-product-main-image"
                  fallback={<span className="protected-image-placeholder">主图加载中</span>}
                />
              ) : null}
              <details className="seller-order-details">
                <summary>订单明细（订单号、金额、汇率等，点开查看）</summary>
              {item.order_screenshot ? (
                <div className="seller-order-screenshot">
                  <span className="fact-label">订单截图（买家提交的订单资料）</span>
                  <ProtectedImagePreview
                    identity="seller"
                    reference={{
                      file_object_id: item.order_screenshot.file_object_id,
                      file_version: item.order_screenshot.file_version,
                      purpose: 'ORDER_EVIDENCE',
                      visibility: 'SELLER_VISIBLE',
                    }}
                    alt="订单截图"
                    className="protected-evidence-thumbnail"
                    fallback={<span className="protected-image-placeholder">订单截图加载中</span>}
                  />
                </div>
              ) : null}
              <div className="seller-order-communication-screenshots">
                <span className="fact-label">沟通截图（员工上传，一单可多张）</span>
                {item.communication_screenshots.length === 0 ? (
                  <p className="seller-communication-empty">暂无沟通截图</p>
                ) : (
                  <ul className="seller-communication-list">
                    {item.communication_screenshots.map((screenshot, index) => (
                      <li key={screenshot.file_object_id}>
                        <SellerCommunicationScreenshotControl
                          formalOrderId={item.formal_order_id}
                          index={index}
                          screenshot={screenshot}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <FactGrid>
                <Fact label="站点" value={marketplaceLabel[item.marketplace_code]} />
                <Fact label="亚马逊订单号" value={item.platform_order_identifier} />
                <Fact label="亚马逊产品号" value={item.platform_product_identifier} />
                {item.payment ? (
                  <Fact
                    label="买家支付"
                    value={money(
                      item.payment.amount_minor,
                      item.payment.currency_code,
                      item.payment.currency_exponent,
                    )}
                  />
                ) : (
                  <Fact label="买家支付" value="待后续导入" />
                )}
                {item.seller_expected_principal_cny_fen !== null ? (
                  <Fact label="卖家本金" value={cny(item.seller_expected_principal_cny_fen)} />
                ) : (
                  <Fact label="卖家本金" value="待后续导入" />
                )}
                {item.locked_service_fee_snapshot ? (
                  <Fact
                    label="卖家服务费"
                    value={cny(item.locked_service_fee_snapshot.service_fee_cny_fen)}
                  />
                ) : (
                  <Fact label="卖家服务费" value="待后续导入" />
                )}
                {item.seller_principal_rate_snapshot ? (
                  <>
                    <Fact
                      label="亚马逊下单日期"
                      value={item.seller_principal_rate_snapshot.platform_order_date}
                    />
                    <Fact
                      label="基础汇率"
                      value={rate(
                        item.seller_principal_rate_snapshot.base_rate_value,
                        item.seller_principal_rate_snapshot.base_rate_scale,
                        item.seller_principal_rate_snapshot.payment_currency_code,
                      )}
                    />
                    <Fact
                      label="汇率加点"
                      value={rate(
                        item.seller_principal_rate_snapshot.markup_rate_value,
                        item.seller_principal_rate_snapshot.markup_rate_scale,
                        item.seller_principal_rate_snapshot.payment_currency_code,
                      )}
                    />
                    <Fact
                      label="最终汇率"
                      value={rate(
                        item.seller_principal_rate_snapshot.final_rate_value,
                        item.seller_principal_rate_snapshot.final_rate_scale,
                        item.seller_principal_rate_snapshot.payment_currency_code,
                      )}
                    />
                    <Fact
                      label="加点版本"
                      value={`v${item.seller_principal_rate_snapshot.policy_version_no}`}
                    />
                  </>
                ) : (
                  <Fact label="汇率" value="待后续导入" />
                )}
                <Fact
                  label="评价类型"
                  value={item.review_type ? taskTypeLabel[item.review_type] : '待后续导入'}
                />
                <Fact label="确认时间" value={formatShanghai(item.confirmed_at)} />
              </FactGrid>
              </details>
              {item.business_completion ? (
                <ul className="completion-grid">
                  <li>
                    <span>评论</span>
                    <strong>{componentLabel[item.business_completion.review]}</strong>
                  </li>
                  <li>
                    <span>卖家本金</span>
                    <strong>{componentLabel[item.business_completion.seller_principal]}</strong>
                  </li>
                  <li>
                    <span>卖家服务费</span>
                    <strong>{componentLabel[item.business_completion.seller_service_fee]}</strong>
                  </li>
                </ul>
              ) : (
                <Alert tone="warning">
                  订单已确认；付款、汇率等财务数据还在接入中，接入后会自动显示。
                </Alert>
              )}
            </RecordCard>
          ))}
        </div>
      )}
      <CursorPagination
        {...query}
        onLoadMore={query.loadMore}
        onRetry={query.retryLater}
        loadLabel="加载更多正式订单"
        loadingLabel="正在加载更多正式订单"
        retryLabel="重试正式订单列表"
        errorMessage="后一页正式订单暂时无法读取，已加载订单仍会保留。"
      />
    </section>
  );
}

type SellerCommunicationScreenshot = z.infer<
  typeof sellerFormalOrdersSchema
>['items'][number]['communication_screenshots'][number];

function SellerCommunicationScreenshotControl({
  formalOrderId,
  index,
  screenshot,
}: {
  formalOrderId: string;
  index: number;
  screenshot: SellerCommunicationScreenshot;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const provider = useMemo(
    () =>
      new SellerOrderChatScreenshotReadIntentAdapter(
        formalOrderId,
        screenshot.file_object_id,
        screenshot.file_version,
      ),
    [formalOrderId, screenshot.file_object_id, screenshot.file_version],
  );
  return (
    <div className="seller-chat-screenshot-control">
      <span className="seller-chat-screenshot-meta">
        沟通截图 {index + 1} · 上传人：{screenshot.uploaded_by_staff_name ?? '未知员工'} ·
        上传时间：{formatShanghai(screenshot.uploaded_at)}
      </span>
      <Button
        className="secondary"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? `收起沟通截图 ${index + 1}` : `展开沟通截图 ${index + 1}`}
      </Button>
      {expanded ? (
        <ProtectedImagePreview
          provider={provider}
          alt={`订单沟通截图 ${index + 1}`}
          className="protected-evidence-thumbnail"
          fallback={<span>沟通截图加载中</span>}
        />
      ) : null}
    </div>
  );
}

export function SellerSettlementsPage(): React.JSX.Element {
  const client = useQueryClient();
  const { readScope } = useSellerStoreContext();
  const summary = useQuery({
    queryKey: sellerQueryKeys.settlement,
    queryFn: ({ signal }) => sellerApi.settlement(client, signal).then((r) => r.data.settlement),
  });
  const payables = useSellerCursorPages({
    resetKey: 'seller-payables:100',
    queryKey: sellerQueryKeys.payablesPage,
    queryFn: (cursor, signal) => sellerApi.payables(client, cursor, signal),
  });
  const payments = useSellerCursorPages({
    resetKey: 'seller-payments:100',
    queryKey: sellerQueryKeys.paymentsPage,
    queryFn: (cursor, signal) => sellerApi.settlementPayments(client, cursor, signal),
  });
  // 订单明细与计价规则展示固定按组织口径读取，不随店铺筛选变化。
  const orders = useSellerCursorPages({
    resetKey: 'seller-orders:all:20',
    queryKey: (cursor) => sellerQueryKeys.ordersPage(null, cursor),
    queryFn: (cursor, signal) => sellerApi.orders(client, null, cursor, signal),
  });
  const settlementScope =
    readScope === 'ORGANIZATION'
      ? '这里显示整个组织（含已停用店铺）的历史账目，不随上方店铺筛选变化。'
      : readScope === 'ASSIGNED_STORES'
        ? '这里按你有权限的店铺汇总，不随上方店铺筛选变化。'
        : '这里按你当前可见的范围汇总。';
  // 计价规则只展示后端按订单日冻结的快照值，绝不重新计算。
  const latestRateSnapshot = useMemo(() => {
    const withSnapshot = orders.items.filter(
      (item) => item.seller_principal_rate_snapshot !== null,
    );
    if (withSnapshot.length === 0) return null;
    return withSnapshot.reduce((latest, item) =>
      item.confirmed_at > latest.confirmed_at ? item : latest,
    ).seller_principal_rate_snapshot;
  }, [orders.items]);
  const summaryPending = summary.isPending;
  return (
    <section className="mws-page seller-page seller-settlement-page">
      <div className="mws-heading">
        <div>
          <p>财务与结算</p>
          <h1>卖家结算</h1>
          <span>{settlementScope}</span>
        </div>
      </div>
      {summary.isError || payables.initialError ? (
        <Alert tone="danger">结算信息暂时无法完整读取，请刷新后重试。</Alert>
      ) : null}
      <div className="mws-settlement-grid">
        <section className="mws-surface mws-span-all" aria-label="结算摘要">
          <div className="mws-section-heading">
            <div>
              <h2>结算摘要</h2>
              <p>仅展示本组织本金与服务费，不含平台内部数据</p>
            </div>
            {summary.data?.settlement_account_name ? (
              <span className="mws-chip green">收款账户已登记</span>
            ) : null}
          </div>
          <div className="mws-settlement-numbers">
            <div>
              <span>待结本金</span>
              <strong>{summary.data ? cny(summary.data.outstanding_principal_cny_fen) : '—'}</strong>
              <small>{summaryPending ? '读取中' : '基于订单快照'}</small>
            </div>
            <div>
              <span>待结服务费</span>
              <strong>
                {summary.data ? cny(summary.data.outstanding_service_fee_cny_fen) : '—'}
              </strong>
              <small>{summaryPending ? '读取中' : '按冻结快照展示'}</small>
            </div>
            <div>
              <span>待认领转入款</span>
              <strong>{summary.data ? cny(summary.data.unallocated_credit_cny_fen) : '—'}</strong>
              <small>{summaryPending ? '读取中' : '等待工作人员分配'}</small>
            </div>
            <div>
              <span>待结合计</span>
              <strong>{summary.data ? cny(summary.data.total_outstanding_cny_fen) : '—'}</strong>
              <small>{summaryPending ? '读取中' : '本金与服务费之和'}</small>
            </div>
          </div>
        </section>
        <section className="mws-surface" aria-label="结算项目">
          <div className="mws-section-heading">
            <div>
              <h2>结算项目</h2>
              <p>已完成金额不会被直接覆盖</p>
            </div>
            <Link className="mws-text" to="/seller/settings">
              收款账户设置
            </Link>
          </div>
          {payables.isInitialPending ? (
            <p role="status">加载中…</p>
          ) : payables.initialError ? (
            <Alert tone="warning">结算项目暂时用不了，刷新后重试。</Alert>
          ) : payables.items.length === 0 ? (
            <EmptyState title="暂无账目" description="产生本金或服务费后会显示在这里。" />
          ) : (
            payables.items.map((item) => (
              <div className="mws-settlement-row" key={item.payable_id}>
                <div>
                  <span
                    className={
                      item.status === 'PAID'
                        ? 'mws-chip green'
                        : item.status === 'PARTIALLY_PAID'
                          ? 'mws-chip amber'
                          : 'mws-chip neutral'
                    }
                  >
                    {payableStatusLabel[item.status]}
                  </span>
                  <strong>
                    {item.payable_type === 'SELLER_PRINCIPAL' ? '卖家本金' : '卖家服务费'} ·{' '}
                    {item.product.name}
                  </strong>
                  <small>
                    {item.store.display_name} · {item.amazon_order_number} · 应结时间{' '}
                    {formatShanghai(item.due_at)}
                  </small>
                </div>
                <dl>
                  <dt>应结</dt>
                  <dd>{cny(item.due_amount_cny_fen)}</dd>
                  <dt>已结</dt>
                  <dd>{cny(item.paid_amount_cny_fen)}</dd>
                  <dt>未结</dt>
                  <dd>{cny(item.outstanding_amount_cny_fen)}</dd>
                </dl>
              </div>
            ))
          )}
          <CursorPagination
            {...payables}
            onLoadMore={payables.loadMore}
            onRetry={payables.retryLater}
            loadLabel="加载更多结算项目"
            loadingLabel="正在加载更多结算项目"
            retryLabel="重试结算项目"
            errorMessage="后一页结算项目暂时无法读取，已加载项目仍会保留。"
          />
        </section>
        <aside className="mws-surface mws-rate-panel" aria-label="当前计价规则">
          <div className="mws-section-heading">
            <div>
              <h2>当前计价规则</h2>
              <p>按组织和订单日冻结</p>
            </div>
          </div>
          {latestRateSnapshot ? (
            <dl>
              <div>
                <dt>基础汇率</dt>
                <dd>
                  {rate(
                    latestRateSnapshot.base_rate_value,
                    latestRateSnapshot.base_rate_scale,
                    latestRateSnapshot.payment_currency_code,
                  )}
                </dd>
              </div>
              <div>
                <dt>汇率加点</dt>
                <dd>
                  {rate(
                    latestRateSnapshot.markup_rate_value,
                    latestRateSnapshot.markup_rate_scale,
                    latestRateSnapshot.payment_currency_code,
                  )}
                </dd>
              </div>
              <div>
                <dt>最终汇率</dt>
                <dd>
                  {rate(
                    latestRateSnapshot.final_rate_value,
                    latestRateSnapshot.final_rate_scale,
                    latestRateSnapshot.payment_currency_code,
                  )}
                </dd>
              </div>
              <div>
                <dt>加点版本</dt>
                <dd>v{latestRateSnapshot.policy_version_no}</dd>
              </div>
              <div>
                <dt>订单日</dt>
                <dd>{latestRateSnapshot.platform_order_date}</dd>
              </div>
            </dl>
          ) : (
            <p className="mws-action-empty">
              {orders.isInitialPending ? '读取订单快照中…' : '暂无已冻结的汇率快照。'}
            </p>
          )}
          <div className="mws-info-note">
            <Info aria-hidden="true" />
            <p>已形成正式订单的汇率和服务费快照不会因规则调整而改变；此处只展示冻结值。</p>
          </div>
        </aside>
        <section className="mws-surface mws-span-all" aria-label="订单明细">
          <div className="mws-section-heading">
            <div>
              <h2>订单明细</h2>
              <p>{orders.items.length > 0 ? `最近 ${orders.items.length} 笔` : '最近订单'}</p>
            </div>
            <Link className="mws-text" to="/seller/orders">
              打开完整明细
            </Link>
          </div>
          {orders.isInitialPending ? (
            <p role="status">订单明细加载中…</p>
          ) : orders.initialError ? (
            <Alert tone="warning">订单明细暂时不可用，刷新后重试。</Alert>
          ) : orders.items.length === 0 ? (
            <p className="mws-action-empty">暂无正式订单。</p>
          ) : (
            <div className="mws-table-scroll">
              <table className="mws-order-table">
                <thead>
                  <tr>
                    <th>订单</th>
                    <th>店铺</th>
                    <th>产品</th>
                    <th className="number">订单金额</th>
                    <th className="number">应结本金</th>
                    <th className="number">服务费</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.items.map((item) => (
                    <tr key={item.formal_order_id}>
                      <td>
                        <strong>{item.platform_order_identifier}</strong>
                        <small>{formatShanghai(item.confirmed_at)}</small>
                      </td>
                      <td>{item.store.display_name}</td>
                      <td>{item.product_name}</td>
                      <td className="number">
                        {item.payment
                          ? money(
                              item.payment.amount_minor,
                              item.payment.currency_code,
                              item.payment.currency_exponent,
                            )
                          : '—'}
                      </td>
                      <td className="number">
                        {item.seller_expected_principal_cny_fen !== null
                          ? cny(item.seller_expected_principal_cny_fen)
                          : '—'}
                      </td>
                      <td className="number">
                        {item.locked_service_fee_snapshot
                          ? cny(item.locked_service_fee_snapshot.service_fee_cny_fen)
                          : '—'}
                      </td>
                      <td>
                        <span
                          className={
                            item.business_completion?.status === 'COMPLETE'
                              ? 'mws-chip green'
                              : item.business_completion
                                ? 'mws-chip amber'
                                : 'mws-chip neutral'
                          }
                        >
                          {item.business_completion
                            ? item.business_completion.status === 'COMPLETE'
                              ? '业务完成'
                              : '进行中'
                            : '订单已确认'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <CursorPagination
            {...orders}
            onLoadMore={orders.loadMore}
            onRetry={orders.retryLater}
            loadLabel="加载更多订单"
            loadingLabel="正在加载更多订单"
            retryLabel="重试订单明细"
            errorMessage="后一页订单暂时无法读取，已加载明细仍会保留。"
          />
        </section>
        <Card className="seller-payment-history mws-span-all">
          <h3>打款记录</h3>
          <p>工作人员登记的每一笔结算打款；金额、时间与当期分配去向。</p>
          {payments.isInitialPending ? (
            <p role="status">打款记录加载中…</p>
          ) : payments.initialError ? (
            <Alert tone="warning">打款记录暂时用不了，刷新重试；不影响上方账目。</Alert>
          ) : payments.items.length === 0 ? (
            <p>暂无打款记录。</p>
          ) : (
            <div className="seller-record-list">
              {payments.items.map((payment) => (
                <RecordCard
                  key={payment.payment_id}
                  title={`${cny(payment.amount_cny_fen)} 打款`}
                  meta={formatShanghai(payment.paid_at)}
                  status={paymentStatusLabel[payment.status]}
                  statusTone={payment.status === 'REVERSED' ? 'warning' : 'success'}
                >
                  <FactGrid>
                    <Fact label="打款金额" value={cny(payment.amount_cny_fen)} />
                    <Fact label="打款时间" value={formatShanghai(payment.paid_at)} />
                    <Fact label="登记时间" value={formatShanghai(payment.recorded_at)} />
                    <Fact label="已分配" value={cny(payment.allocated_amount_cny_fen)} />
                    <Fact label="待分配" value={cny(payment.unallocated_amount_cny_fen)} />
                    {payment.allocations.map((allocation) => (
                      <Fact
                        key={allocation.allocation_id}
                        label={
                          allocation.payable_type === 'SELLER_PRINCIPAL'
                            ? '分配至本金'
                            : '分配至服务费'
                        }
                        value={`${cny(allocation.net_amount_cny_fen)} · ${formatShanghai(allocation.allocated_at)}`}
                      />
                    ))}
                  </FactGrid>
                </RecordCard>
              ))}
            </div>
          )}
          <CursorPagination
            {...payments}
            onLoadMore={payments.loadMore}
            onRetry={payments.retryLater}
            loadLabel="加载更多打款记录"
            loadingLabel="正在加载更多打款记录"
            retryLabel="重试打款记录"
            errorMessage="后一页打款记录暂时无法读取，已加载记录仍会保留。"
          />
        </Card>
      </div>
    </section>
  );
}

export function SellerSettingsPage(): React.JSX.Element {
  const client = useQueryClient();
  const me = useQuery({
    queryKey: sellerQueryKeys.me,
    queryFn: ({ signal }) => sellerApi.me(client, signal).then((r) => r.data.me),
  });
  return (
    <section className="seller-page">
      <PageHeader title="账户" eyebrow="账户安全" />
      <Card className="seller-account-card">
        <div>
          <h2>{me.data?.member.display_name ?? '正在读取账户'}</h2>
          <p>
            {me.data
              ? `${roleLabel[me.data.member.role]} · ${me.data.organization.name}`
              : '请稍候'}
          </p>
        </div>
        <Link className="button" to="/seller/change-password">
          修改密码
        </Link>
      </Card>
    </section>
  );
}
