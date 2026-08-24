import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { isFrontendApiError } from '../../api/errors';
import { CUSTOMER_TRANSPORT_INVALIDATION_GROUP } from '../../auth/customer-transport-invalidation';
import { customerAuthApi } from '../../auth/customer/customer-auth-api';
import {
  Alert,
  Button,
  Card,
  FormField,
  MetricCard,
  PageHeader,
  RequestIdDisplay,
  StatusBadge,
  TextInput,
} from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys } from '../queries/keys';
import { BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { marketplaceLabel } from '../shared/status';

export function BuyerMePage(): React.JSX.Element {
  const client = useQueryClient();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: buyerQueryKeys.me(),
    queryFn: ({ signal }) => buyerApi.me(client, signal).then((r) => r.data),
  });
  const summaries = useQueries({
    queries: [
      {
        queryKey: buyerQueryKeys.reservationsPage({ limit: 20, cursor: null }),
        queryFn: ({ signal }) =>
          buyerApi.reservations(client, 'limit=20', signal).then((r) => r.data),
      },
      {
        queryKey: buyerQueryKeys.formalOrdersPage({
          limit: 20,
          cursor: null,
          marketplace: null,
          productName: null,
          reviewType: null,
          confirmedBusinessDate: null,
          formalOrderId: null,
          amazonOrderNumber: null,
        }),
        queryFn: ({ signal }) =>
          buyerApi.formalOrders(client, 'limit=20', signal).then((r) => r.data),
      },
      {
        queryKey: buyerQueryKeys.refundsPage({ limit: 20, cursor: null }),
        queryFn: ({ signal }) => buyerApi.refunds(client, 'limit=20', signal).then((r) => r.data),
      },
    ],
  });
  const logout = useMutation({
    mutationFn: async () => {
      const result = await customerAuthApi.logout();
      await CUSTOMER_TRANSPORT_INVALIDATION_GROUP.clear(client);
      return result;
    },
    onSuccess: () => navigate('/buyer/login', { replace: true }),
  });
  if (query.isPending) return <BuyerLoading />;
  if (query.isError) return <BuyerQueryError error={query.error} />;
  const me = query.data;
  return (
    <section className="buyer-page buyer-account-page buyer-business-center">
      <PageHeader
        eyebrow="我的"
        title={me.buyer.display_name}
        description="账户、业务进度和常用服务都在这里。"
      >
        <StatusBadge tone={me.buyer.identity_review_status === 'CLEAR' ? 'success' : 'warning'}>
          {me.buyer.identity_review_status === 'CLEAR' ? '身份状态正常' : '需复核'}
        </StatusBadge>
      </PageHeader>
      {me.buyer.identity_review_status === 'REVIEW_REQUIRED' ? (
        <Alert tone="warning">
          当前账号需要完成身份复核，部分业务操作会受到限制。请联系工作人员。
        </Alert>
      ) : null}
      <Card className="buyer-summary-card buyer-account-summary">
        <div>
          <p className="eyebrow">身份</p>
          <h2>{me.buyer.display_name}</h2>
        </div>
        <dl className="buyer-facts">
          <div>
            <dt>市场</dt>
            <dd>{marketplaceLabel(me.buyer.marketplace_code)}</dd>
            <dt>客户编码</dt>
            <dd>{me.buyer.customer_number ?? '首单确认后分配'}</dd>
          </div>
          <div>
            <dt>当前状态</dt>
            <dd>{me.buyer.identity_review_status === 'CLEAR' ? '正常' : '待复核'}</dd>
          </div>
        </dl>
      </Card>
      <RefundAccountCard
        initialName={me.buyer.refund_account_name}
        initialIdentifier={me.buyer.refund_account_identifier}
      />
      <section className="buyer-business-metrics" aria-label="业务摘要">
        <MetricCard label="预约" value={pageCount(summaries[0]?.data)} detail="预约记录" />
        <MetricCard label="正式订单" value={pageCount(summaries[1]?.data)} detail="已确认订单" />
        <MetricCard label="返款" value={pageCount(summaries[2]?.data)} detail="返款记录" />
      </section>
      <nav className="buyer-me-links buyer-service-links" aria-label="我的服务入口">
        <Link to="/buyer/tasks">任务中心</Link>
        <Link to="/buyer/orders">正式订单</Link>
        <Link to="/buyer/refunds">返款记录</Link>
        <Link to="/buyer/reservations">我的预约</Link>
        <Link to="/buyer/change-password">修改密码</Link>
      </nav>
      {summaries.some((item) => item.isError) ? (
        <Alert tone="warning">部分业务摘要暂时无法加载，不影响进入对应业务页面查看。</Alert>
      ) : null}
      {logout.isError ? <Alert tone="danger">退出未完成，请重试。</Alert> : null}
      <RequestIdDisplay
        requestId={
          logout.isError && isFrontendApiError(logout.error) ? logout.error.requestId : null
        }
      />
      <Button
        className="secondary"
        loading={logout.isPending}
        loadingLabel="正在退出"
        onClick={() => logout.mutate()}
      >
        退出登录
      </Button>
    </section>
  );
}

function pageCount(
  page: { items: readonly unknown[]; next_cursor: string | null } | undefined,
): string {
  if (!page) return '—';
  return `${page.items.length}${page.next_cursor ? '+' : ''}`;
}

/**
 * 返款收款账户（P7a）：支付宝账号+收款人姓名，保存后可改；返款时员工
 * 直接带出，不再每单微信里问。未填不拦截业务，返款工作台对缺失标红。
 */
function RefundAccountCard({
  initialName,
  initialIdentifier,
}: {
  initialName: string | null;
  initialIdentifier: string | null;
}): React.JSX.Element {
  const client = useQueryClient();
  const [name, setName] = useState(initialName ?? '');
  const [identifier, setIdentifier] = useState(initialIdentifier ?? '');
  const mutation = useMutation({
    mutationFn: () => buyerApi.updateRefundAccount(client, name.trim(), identifier.trim()),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: buyerQueryKeys.me() });
    },
  });
  const filled = initialName !== null && initialIdentifier !== null;
  const nameValid = name.trim().length >= 1 && name.trim().length <= 100;
  const identifierValid = identifier.trim().length >= 3 && identifier.trim().length <= 128;
  const submittable = nameValid && identifierValid && !mutation.isPending;
  return (
    <Card className="buyer-refund-account-card">
      <h3>
        返款收款账户{' '}
        <StatusBadge tone={filled ? 'success' : 'warning'}>
          {filled ? '已填写' : '未填写'}
        </StatusBadge>
      </h3>
      {!filled ? (
        <p>填写支付宝收款账户后，返款时工作人员可以直接带出，不用每次再确认。</p>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (submittable) mutation.mutate();
        }}
      >
        <FormField label="收款人姓名" htmlFor="refund-account-name">
          <TextInput
            id="refund-account-name"
            value={name}
            maxLength={100}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField label="支付宝账号（手机号或邮箱）" htmlFor="refund-account-identifier">
          <TextInput
            id="refund-account-identifier"
            value={identifier}
            maxLength={128}
            required
            onChange={(event) => setIdentifier(event.target.value)}
          />
        </FormField>
        <Button disabled={!submittable} loading={mutation.isPending}>
          保存收款账户
        </Button>
      </form>
      {mutation.isSuccess ? <Alert tone="success">收款账户已保存。</Alert> : null}
      {mutation.isError ? (
        <>
          <Alert tone="danger">
            保存未完成，请稍后重试。
            {isFrontendApiError(mutation.error) && mutation.error.code === 'VALIDATION_ERROR'
              ? '（姓名 1-100 字，支付宝账号 3-128 字符）'
              : ''}
          </Alert>
          <RequestIdDisplay
            requestId={isFrontendApiError(mutation.error) ? mutation.error.requestId : null}
          />
        </>
      ) : null}
    </Card>
  );
}
