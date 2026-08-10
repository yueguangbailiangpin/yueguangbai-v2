import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { isFrontendApiError } from '../../api/errors';
import { CUSTOMER_TRANSPORT_INVALIDATION_GROUP } from '../../auth/customer-transport-invalidation';
import { customerAuthApi } from '../../auth/customer/customer-auth-api';
import { Alert, Button, Card, MetricCard, PageHeader, RequestIdDisplay, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys } from '../queries/keys';
import { BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { marketplaceLabel } from '../shared/status';

export function BuyerMePage(): React.JSX.Element {
  const client = useQueryClient(); const navigate = useNavigate();
  const query = useQuery({ queryKey: buyerQueryKeys.me(), queryFn: ({ signal }) => buyerApi.me(client, signal).then((r) => r.data) });
  const summaries = useQueries({ queries: [
    { queryKey: buyerQueryKeys.reservationsPage({ limit: 20, cursor: null }), queryFn: ({ signal }) => buyerApi.reservations(client, 'limit=20', signal).then((r) => r.data) },
    { queryKey: buyerQueryKeys.formalOrdersPage({ limit: 20, cursor: null, marketplace: null, productName: null, reviewType: null, confirmedBusinessDate: null, formalOrderId: null, amazonOrderNumber: null }), queryFn: ({ signal }) => buyerApi.formalOrders(client, 'limit=20', signal).then((r) => r.data) },
    { queryKey: buyerQueryKeys.refundsPage({ limit: 20, cursor: null }), queryFn: ({ signal }) => buyerApi.refunds(client, 'limit=20', signal).then((r) => r.data) },
  ] });
  const logout = useMutation({ mutationFn: async () => { const result = await customerAuthApi.logout(); await CUSTOMER_TRANSPORT_INVALIDATION_GROUP.clear(client); return result; },
    onSuccess: () => navigate('/buyer/login', { replace: true }) });
  if (query.isPending) return <BuyerLoading />; if (query.isError) return <BuyerQueryError error={query.error} />;
  const me = query.data;
  return <section className="buyer-page buyer-account-page buyer-business-center">
    <PageHeader eyebrow="我的" title={me.buyer.display_name} description="账户、业务进度和常用服务都在这里。">
      <StatusBadge tone={me.buyer.identity_review_status === 'CLEAR' ? 'success' : 'warning'}>{me.buyer.identity_review_status === 'CLEAR' ? '身份状态正常' : '需要身份复核'}</StatusBadge>
    </PageHeader>
    {me.buyer.identity_review_status === 'REVIEW_REQUIRED' ? <Alert tone="warning">当前账号需要完成身份复核，部分业务操作会受到限制。请联系工作人员。</Alert> : null}
    <Card className="buyer-summary-card buyer-account-summary"><div><p className="eyebrow">业务身份</p><h2>{me.buyer.display_name}</h2></div>
      <dl className="buyer-facts"><div><dt>市场</dt><dd>{marketplaceLabel(me.buyer.marketplace_code)}</dd></div><div><dt>当前状态</dt><dd>{me.buyer.identity_review_status === 'CLEAR' ? '正常' : '待复核'}</dd></div></dl></Card>
    <section className="buyer-business-metrics" aria-label="业务摘要">
      <MetricCard label="预约" value={pageCount(summaries[0]?.data)} detail="预约记录" />
      <MetricCard label="正式订单" value={pageCount(summaries[1]?.data)} detail="已确认订单" />
      <MetricCard label="返款" value={pageCount(summaries[2]?.data)} detail="返款记录" />
    </section>
    <nav className="buyer-me-links buyer-service-links" aria-label="我的服务入口">
      <Link to="/buyer/tasks">任务中心</Link><Link to="/buyer/orders">正式订单</Link><Link to="/buyer/refunds">返款记录</Link>
      <Link to="/buyer/reservations">我的预约</Link><Link to="/buyer/change-password">修改密码</Link>
    </nav>
    {summaries.some((item) => item.isError) ? <Alert tone="warning">部分业务摘要暂时无法加载，不影响进入对应业务页面查看。</Alert> : null}
    {logout.isError ? <Alert tone="danger">退出未完成，请重试。</Alert> : null}
    <RequestIdDisplay requestId={logout.isError && isFrontendApiError(logout.error) ? logout.error.requestId : null} />
    <Button className="secondary" loading={logout.isPending} loadingLabel="正在退出" onClick={() => logout.mutate()}>退出登录</Button>
  </section>;
}

function pageCount(page: { items: readonly unknown[]; next_cursor: string | null } | undefined): string {
  if (!page) return '—';
  return `${page.items.length}${page.next_cursor ? '+' : ''}`;
}
