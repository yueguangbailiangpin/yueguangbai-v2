import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { isFrontendApiError } from '../../api/errors';
import { CUSTOMER_TRANSPORT_INVALIDATION_GROUP } from '../../auth/customer-transport-invalidation';
import { customerAuthApi } from '../../auth/customer/customer-auth-api';
import { Alert, Button, Card, PageHeader, RequestIdDisplay, StatusBadge } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys } from '../queries/keys';
import { BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';

export function BuyerMePage(): React.JSX.Element {
  const client = useQueryClient(); const navigate = useNavigate();
  const query = useQuery({ queryKey: buyerQueryKeys.me(), queryFn: ({ signal }) => buyerApi.me(client, signal).then((r) => r.data) });
  const logout = useMutation({ mutationFn: async () => { const result = await customerAuthApi.logout(); await CUSTOMER_TRANSPORT_INVALIDATION_GROUP.clear(client); return result; },
    onSuccess: () => navigate('/buyer/login', { replace: true }) });
  if (query.isPending) return <BuyerLoading />; if (query.isError) return <BuyerQueryError error={query.error} />;
  const me = query.data;
  return <section className="buyer-page"><PageHeader eyebrow="我的" title={me.buyer.display_name}>
    <StatusBadge tone={me.buyer.identity_review_status === 'CLEAR' ? 'success' : 'warning'}>{me.buyer.identity_review_status === 'CLEAR' ? '身份状态正常' : '需要身份复核'}</StatusBadge></PageHeader>
    {me.buyer.identity_review_status === 'REVIEW_REQUIRED' ? <Alert tone="warning">当前账号需要完成身份复核，部分业务操作会受到限制。请联系工作人员。</Alert> : null}
    <Card><dl className="buyer-facts"><div><dt>市场</dt><dd>{me.buyer.marketplace_code}</dd></div></dl></Card>
    <nav className="buyer-me-links" aria-label="我的服务入口"><Link to="/buyer/orders">正式订单</Link><Link to="/buyer/refunds">返款记录</Link>
      <Link to="/buyer/reservations">我的预约</Link><Link to="/buyer/change-password">修改密码</Link></nav>
    {logout.isError ? <Alert tone="danger">退出未完成，请重试。</Alert> : null}
    <RequestIdDisplay requestId={logout.isError && isFrontendApiError(logout.error) ? logout.error.requestId : null} />
    <Button className="secondary" loading={logout.isPending} loadingLabel="正在退出" onClick={() => logout.mutate()}>退出登录</Button>
  </section>;
}
