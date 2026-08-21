import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentStaffSession } from '../auth/staff/StaffSessionBoundary';
import type { StaffSession } from '../auth/staff/staff-auth-api';
import { useFileUpload } from '../buyer/shared/useFileUpload';
import { Alert, Button, Card, FormField, Select, TextInput } from '../ui/primitives';
import { staffApi } from './api/client';
import type { StaffWorkItem } from './contracts/runtime';
import {
  StaffMutationAuthority,
  type StaffMutationRequest,
} from './mutations/StaffMutationAuthority';
import { staffWorkbenchKeys } from './queries/keys';
import { formatCny, formatShanghai } from './shared/format';
import { StaffPanelError } from './shared/StaffPanelError';
import { StaffProtectedFileButton } from './shared/StaffProtectedFileButton';

export type SellerSettlementCapabilities = Readonly<{
  canView: boolean;
  canRecord: boolean;
  canReverse: boolean;
}>;

export function sellerSettlementCapabilities(session: StaffSession): SellerSettlementCapabilities {
  const roleAllowed = session.role.code === 'owner' || session.role.code === 'seller_ops';
  const canView = roleAllowed && session.permissions.includes('SELLER_SETTLEMENT_VIEW');
  const canRecord = canView && session.permissions.includes('SELLER_SETTLEMENT_RECORD');
  return Object.freeze({
    canView,
    canRecord,
    canReverse: canRecord && session.permissions.includes('FINANCIAL_CORRECT'),
  });
}

export function SellerSettlementPanel({ item }: { item: StaffWorkItem }): React.JSX.Element | null {
  const client = useQueryClient();
  const session = useCurrentStaffSession();
  const capabilities = sellerSettlementCapabilities(session);
  const organizationId = item.seller_organization_id;
  const enabled = capabilities.canView && organizationId !== null;
  const [uploader, upload] = useFileUpload();
  const authority = useMemo(() => new StaffMutationAuthority(), []);
  const summary = useQuery({
    queryKey: staffWorkbenchKeys.settlement(organizationId ?? 'unavailable'),
    queryFn: ({ signal }) =>
      staffApi
        .settlementSummary(client, organizationId!, signal)
        .then((response) => response.data.settlement),
    enabled,
    retry: false,
  });
  const payables = useQuery({
    queryKey: staffWorkbenchKeys.payables(organizationId ?? 'unavailable'),
    queryFn: ({ signal }) =>
      staffApi
        .settlementPayables(client, organizationId!, signal)
        .then((response) => response.data.items),
    enabled,
    retry: false,
  });
  const payments = useQuery({
    queryKey: staffWorkbenchKeys.payments(organizationId ?? 'unavailable'),
    queryFn: ({ signal }) =>
      staffApi
        .settlementPayments(client, organizationId!, signal)
        .then((response) => response.data.items),
    enabled,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (request: StaffMutationRequest | null) =>
      request === null
        ? authority.retry()
        : authority.execute(request, ({ action, path, body }, key) => {
            const paymentId = decodeURIComponent(path.split('/').at(-2)!);
            if (action === 'record-seller-payment')
              return staffApi.recordSellerPayment(client, organizationId!, body, key);
            if (action === 'allocate-seller-payment')
              return staffApi.allocateSellerPayment(client, paymentId, body, key);
            if (action === 'reverse-seller-payment')
              return staffApi.reverseSellerPayment(client, paymentId, body, key);
            throw new Error('INVALID_SETTLEMENT_ACTION');
          }),
    onSuccess: () => {
      void Promise.all([summary.refetch(), payables.refetch(), payments.refetch()]);
    },
  });

  if (!enabled || organizationId === null) return null;

  return (
    <>
      <section className="staff-detail">
        <div className="pane-heading">
          <div>
            <p className="eyebrow">业务事实与证据</p>
            <h2>卖家结算</h2>
          </div>
        </div>
        <Card className="customer-visible">
          <h3>组织和店铺</h3>
          <Fact label="组织" value={organizationId} />
          <Fact label="店铺" value={item.store_id ?? '当前工作项未绑定店铺'} />
          <Fact label="Marketplace" value="以业务详情返回数据为准；韩国站不可用" />
        </Card>
        {summary.isError ? (
          <StaffPanelError
            error={summary.error}
            retry={() => {
              void summary.refetch();
            }}
          />
        ) : (
          <div className="finance-separation">
            <Card>
              <h3>卖家本金</h3>
              <p>
                {summary.data ? formatCny(summary.data.outstanding_principal_cny_fen) : '加载中'}
              </p>
            </Card>
            <Card>
              <h3>卖家服务费</h3>
              <p>
                {summary.data ? formatCny(summary.data.outstanding_service_fee_cny_fen) : '加载中'}
              </p>
            </Card>
          </div>
        )}
        {payables.isError ? (
          <StaffPanelError
            error={payables.error}
            retry={() => {
              void payables.refetch();
            }}
          />
        ) : (
          <Card className="internal-note">
            <h3>应结项目</h3>
            {payables.data?.map((row) => (
              <section key={row.payable_id}>
                <strong>{row.payable_type === 'SELLER_PRINCIPAL' ? '本金' : '服务费'}</strong>
                <p>
                  {formatCny(row.outstanding_amount_cny_fen)} · {row.status}
                </p>
              </section>
            ))}
          </Card>
        )}
        {payments.isError ? (
          <StaffPanelError
            error={payments.error}
            retry={() => {
              void payments.refetch();
            }}
          />
        ) : (
          <Card className="internal-note">
            <h3>付款、分配与凭证</h3>
            {payments.data?.length === 0 ? (
              <p>暂无付款记录。</p>
            ) : (
              payments.data?.map((payment) => (
                <section key={payment.payment_id}>
                  <Fact
                    label="付款"
                    value={`${formatCny(payment.amount_cny_fen)} · ${formatShanghai(payment.paid_at)} · ${payment.status}`}
                  />
                  <StaffProtectedFileButton reference={payment.proof} label="查看凭证" />
                  {capabilities.canRecord &&
                  payment.status !== 'REVERSED' &&
                  payment.unallocated_amount_cny_fen !== '0' ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const data = new FormData(event.currentTarget);
                        mutation.mutate({
                          action: 'allocate-seller-payment',
                          path: `/api/staff/seller-payments/${encodeURIComponent(payment.payment_id)}/allocations`,
                          body: {
                            payable_id: String(data.get('payable_id')),
                            amount_cny_fen: String(data.get('amount')),
                            expected_payment_version: payment.version,
                          },
                        });
                      }}
                    >
                      <label htmlFor={`payable-${payment.payment_id}`}>
                        分配至本金或服务费项目
                      </label>
                      <Select id={`payable-${payment.payment_id}`} name="payable_id" required>
                        <option value="">请选择</option>
                        {payables.data
                          ?.filter((row) => row.status !== 'PAID')
                          .map((row) => (
                            <option key={row.payable_id} value={row.payable_id}>
                              {row.payable_type === 'SELLER_PRINCIPAL' ? '本金' : '服务费'} ·{' '}
                              {row.amazon_order_number} ·{' '}
                              {formatCny(row.outstanding_amount_cny_fen)}
                            </option>
                          ))}
                      </Select>
                      <FormField
                        label="分配金额（人民币分）"
                        htmlFor={`allocation-${payment.payment_id}`}
                      >
                        <TextInput
                          id={`allocation-${payment.payment_id}`}
                          name="amount"
                          inputMode="numeric"
                          required
                        />
                      </FormField>
                      <Button className="danger" disabled={mutation.isPending}>
                        确认分配
                      </Button>
                    </form>
                  ) : null}
                  {capabilities.canReverse &&
                  payment.status !== 'REVERSED' &&
                  payment.allocated_amount_cny_fen === '0' ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const reason = String(new FormData(event.currentTarget).get('reason'));
                        mutation.mutate({
                          action: 'reverse-seller-payment',
                          path: `/api/staff/seller-payments/${encodeURIComponent(payment.payment_id)}/reverse`,
                          body: { expected_version: payment.version, reason },
                        });
                      }}
                    >
                      <FormField
                        label="整笔冲正原因"
                        htmlFor={`payment-reason-${payment.payment_id}`}
                      >
                        <TextInput
                          id={`payment-reason-${payment.payment_id}`}
                          name="reason"
                          required
                        />
                      </FormField>
                      <Button className="danger" disabled={mutation.isPending}>
                        整笔冲正
                      </Button>
                    </form>
                  ) : null}
                </section>
              ))
            )}
          </Card>
        )}
      </section>
      <aside className="staff-actions">
        <Card className="staff-current-customer">
          <h3>当前客户</h3>
          <Fact label="卖家组织" value={organizationId} />
          <Fact label="业务范围" value="按当前 Marketplace 权限过滤" />
        </Card>
        {capabilities.canRecord ? (
          <Card className="sensitive-action">
            <h3>记录卖家付款</h3>
            <Alert tone="info">付款入账后再明确分配到本金或服务费；两类应结事实不会合并。</Alert>
            <input
              aria-label="卖家结算付款凭证"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploader.start('staffSellerSettlementProof', [file]);
              }}
            />
            <p role="status">凭证状态：{upload.state}</p>
            <form
              onChange={() => {
                if (!mutation.isPending) {
                  authority.release();
                  mutation.reset();
                }
              }}
              onSubmit={(event) => {
                event.preventDefault();
                const file = upload.manifest?.files[0];
                if (!file) return;
                const data = new FormData(event.currentTarget);
                mutation.mutate({
                  action: 'record-seller-payment',
                  path: `/api/staff/seller-settlements/${encodeURIComponent(organizationId)}/payments`,
                  body: {
                    amount_cny_fen: String(data.get('amount')),
                    paid_at: Date.now(),
                    proof_file: {
                      file_object_id: file.file_object_id,
                      expected_file_version: file.file_version,
                    },
                  },
                });
              }}
            >
              <FormField label="付款金额（人民币分）" htmlFor="seller-payment-amount">
                <TextInput id="seller-payment-amount" name="amount" inputMode="numeric" required />
              </FormField>
              <Button
                className="danger"
                disabled={upload.state !== 'VERIFIED' || mutation.isPending}
              >
                确认记录卖家付款
              </Button>
            </form>
            {mutation.isError ? (
              <StaffPanelError
                error={mutation.error}
                retry={
                  authority.canRetry()
                    ? () => mutation.mutate(null)
                    : () => {
                        mutation.reset();
                        void Promise.all([
                          summary.refetch(),
                          payables.refetch(),
                          payments.refetch(),
                        ]);
                      }
                }
                retryLabel={authority.canRetry() ? '重试原请求' : '刷新服务器事实'}
              />
            ) : null}
          </Card>
        ) : (
          <Alert tone="info">当前权限仅可查看结算事实，不能记录或分配付款。</Alert>
        )}
        <Card className="staff-audit-collapsed">
          <p>
            完整付款、分配、冲正、幂等与审计事实由后端保存；页面只显示服务器返回或重新读取的事实。
          </p>
        </Card>
      </aside>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <dl className="fact-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </dl>
  );
}
