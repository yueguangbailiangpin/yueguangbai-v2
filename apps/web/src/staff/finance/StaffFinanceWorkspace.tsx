import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { isFrontendApiError } from '../../api/errors';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import {
  Alert,
  Button,
  Card,
  FormField,
  RequestIdDisplay,
  Select,
  TextInput,
} from '../../ui/primitives';
import { staffApi } from '../api/client';
import { staffWorkbenchKeys } from '../queries/keys';
import {
  StaffMutationAuthority,
  type StaffMutationRequest,
} from '../mutations/StaffMutationAuthority';
import { PricingBreakdownCard } from '../shared/PricingBreakdownCard';
import { SettlementBatchesSection } from '../SettlementBatchesSection';
import { formatCny, formatShanghai } from '../shared/format';
import {
  BaseRateBlock,
  FinanceAlertStrip,
  FinanceExampleCard,
  MarkupBlock,
  PolicyError,
  ServiceFeeBlock,
} from './FinanceBlocks';
import { chinaDate, lookupAsOf, shiftChinaDate } from './finance-format';

type PolicyMutationResult = Awaited<ReturnType<typeof staffApi.saveSellerPrincipalRatePolicy>>;

const SERVICE_FEE_REVIEW_TYPE_LABELS: Record<string, string> = {
  RATING: '评分单',
  TEXT: '文字评论',
  IMAGE: '图片评论',
  VIDEO: '视频评论',
};

const SECTION_ANCHORS: Record<string, string> = {
  'base-rate': 'finance-section-base-rate',
  'seller-markup': 'finance-section-seller-markup',
  'service-fee': 'finance-section-service-fee',
};

/**
 * /staff/finance — settlement facts first, followed by the three pricing
 * rules (base rate / markup / service fee). Every save is immediately effective
 * (D-056 single-save model); browser rendering never derives order amounts.
 */
export function StaffFinanceWorkspace(): React.JSX.Element {
  const session = useCurrentStaffSession();
  const client = useQueryClient();
  const [searchParams] = useSearchParams();
  const deepLinkBusinessDate = searchParams.get('business_date');
  const deepLinkOrganizationId = searchParams.get('seller_organization_id');
  const deepLinkSection = searchParams.get('section');
  // Marketplace-wide organization ids are NOT preselected: the backend only
  // treats organizations assigned to this staff member as readable.  The
  // first backend-visible organization is selected after the read succeeds.
  const [organizationId, setOrganizationId] = useState(() => deepLinkOrganizationId ?? '');
  const [businessDate, setBusinessDate] = useState(() =>
    deepLinkBusinessDate && /^\d{4}-\d{2}-\d{2}$/u.test(deepLinkBusinessDate)
      ? deepLinkBusinessDate
      : chinaDate(),
  );
  const canRead =
    (session.role.code === 'owner' || session.role.code === 'seller_ops') &&
    session.permissions.includes('SELLER_MANAGE');
  const canViewLedger =
    session.role.code === 'owner' && session.permissions.includes('FINANCIAL_VIEW');
  const hasManage = session.permissions.includes('SELLER_MANAGE');
  const isGlobalOwner =
    session.role.code === 'owner' && hasManage && session.data_scope.type === 'GLOBAL';
  // Stage 6.6A (D-056): owner and seller_ops share identical maintenance
  // rights (SELLER_MANAGE) — there is no dual approval and no FINANCIAL_CORRECT
  // requirement any more.
  const canSubmitDefault = isGlobalOwner;
  const canSubmitOverride =
    organizationId.length > 0 &&
    hasManage &&
    (isGlobalOwner ||
      (session.role.code === 'seller_ops' &&
        session.data_scope.sellerOrganizationIds.includes(organizationId)));
  const canSubmitFee = hasManage && (isGlobalOwner || session.role.code === 'seller_ops');
  const authority = useMemo(() => new StaffMutationAuthority<PolicyMutationResult>(), []);
  const selectedOrganizationId = organizationId.length > 0 ? organizationId : null;
  // A past business date rewinds reads to that Beijing business day; today
  // resolves at the present moment.
  const today = chinaDate();
  const isLookup = businessDate < today;
  const lookupAsOfValue = isLookup ? lookupAsOf(businessDate) : null;
  const yesterdayDate = isLookup ? null : shiftChinaDate(businessDate, -1);
  const tomorrowDate = isLookup ? null : shiftChinaDate(businessDate, 1);
  const rateCenter = useQuery({
    queryKey: staffWorkbenchKeys.rateCenter(
      session.authorization_version,
      businessDate,
      selectedOrganizationId,
      lookupAsOfValue,
    ),
    queryFn: ({ signal }) =>
      staffApi
        .rateCenter(client, businessDate, selectedOrganizationId, signal, lookupAsOfValue ?? undefined)
        .then((response) => response.data),
    enabled: canRead,
    retry: false,
  });
  // Yesterday's confirmed rate is context only ("昨天 0.042"); tomorrow's read
  // powers the 提前设明天 preset flow.  Both are org-independent base rates.
  const yesterdayRate = useQuery({
    queryKey: staffWorkbenchKeys.rateCenter(
      session.authorization_version,
      yesterdayDate ?? '',
      null,
    ),
    queryFn: ({ signal }) =>
      staffApi
        .rateCenter(client, yesterdayDate!, null, signal)
        .then((response) => response.data),
    enabled: canRead && yesterdayDate !== null,
    retry: false,
  });
  const tomorrowRate = useQuery({
    queryKey: staffWorkbenchKeys.rateCenter(
      session.authorization_version,
      tomorrowDate ?? '',
      null,
    ),
    queryFn: ({ signal }) =>
      staffApi
        .rateCenter(client, tomorrowDate!, null, signal)
        .then((response) => response.data),
    enabled: canRead && isGlobalOwner && tomorrowDate !== null,
    retry: false,
  });
  const query = useQuery({
    queryKey: staffWorkbenchKeys.sellerPrincipalRatePolicies(
      session.authorization_version,
      selectedOrganizationId,
      lookupAsOfValue,
    ),
    queryFn: ({ signal }) =>
      staffApi
        .sellerPrincipalRatePolicies(
          client,
          'JPY',
          selectedOrganizationId,
          signal,
          lookupAsOfValue ?? undefined,
        )
        .then((response) => response.data),
    enabled: canRead && (isGlobalOwner || selectedOrganizationId !== null),
    retry: false,
  });
  const serviceFees = useQuery({
    queryKey: staffWorkbenchKeys.sellerServiceFees(
      session.authorization_version,
      selectedOrganizationId ?? '',
      lookupAsOfValue,
    ),
    queryFn: ({ signal }) =>
      staffApi
        .sellerServiceFees(client, selectedOrganizationId!, signal, lookupAsOfValue ?? undefined)
        .then((response) => response.data),
    enabled: canRead && selectedOrganizationId !== null,
    retry: false,
  });
  // The organization list survives rate-center refetches so the dropdown
  // never flashes empty while an organization selection re-queries.
  const lastOrganizations = useRef(rateCenter.data?.seller_organizations);
  if (rateCenter.data?.seller_organizations) {
    lastOrganizations.current = rateCenter.data.seller_organizations;
  }
  const visibleOrganizations = rateCenter.data?.seller_organizations
    ?? lastOrganizations.current
    ?? [];
  const financeOrganizationId =
    selectedOrganizationId ?? visibleOrganizations[0]?.seller_organization_id ?? null;
  const settlementSummary = useQuery({
    queryKey: ['staff', 'finance-settlement-summary', financeOrganizationId],
    queryFn: ({ signal }) =>
      staffApi.settlementSummary(client, financeOrganizationId!, signal).then((response) => response.data),
    enabled: canViewLedger && financeOrganizationId !== null,
    retry: false,
  });
  const settlementPayables = useQuery({
    queryKey: ['staff', 'finance-settlement-payables', financeOrganizationId],
    queryFn: ({ signal }) =>
      staffApi.settlementPayables(client, financeOrganizationId!, signal).then((response) => response.data),
    enabled: canViewLedger && financeOrganizationId !== null,
    retry: false,
  });
  const settlementPayments = useQuery({
    queryKey: ['staff', 'finance-settlement-payments', financeOrganizationId],
    queryFn: ({ signal }) =>
      staffApi.settlementPayments(client, financeOrganizationId!, signal).then((response) => response.data),
    enabled: canViewLedger && financeOrganizationId !== null,
    retry: false,
  });
  useEffect(() => {
    if (isGlobalOwner || organizationId.length > 0) return;
    const first = visibleOrganizations[0];
    if (first) setOrganizationId(first.seller_organization_id);
  }, [isGlobalOwner, organizationId, visibleOrganizations]);
  useEffect(() => {
    if (deepLinkSection && SECTION_ANCHORS[deepLinkSection]) {
      const anchor = document.getElementById(SECTION_ANCHORS[deepLinkSection]);
      anchor?.scrollIntoView?.({ block: 'start' });
    }
  }, [deepLinkSection, rateCenter.data, query.data, serviceFees.data]);

  const [message, setMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  async function execute(request: StaffMutationRequest | null): Promise<void> {
    setMessage(null);
    setRequestId(null);
    try {
      const response =
        request === null
          ? await authority.retry()
          : await authority.execute(request, (_request, key) =>
              staffApi.saveSellerPrincipalRatePolicy(client, _request.body, key),
            );
      setRequestId(response.requestId);
      setMessage('已保存，立即生效。');
      await query.refetch();
      await rateCenter.refetch();
    } catch (error) {
      setRequestId(isFrontendApiError(error) ? error.requestId : null);
      setMessage(
        isFrontendApiError(error)
          ? `操作未完成（${error.code}），请刷新后重试。`
          : '操作未完成，请稍后重试。',
      );
    }
  }

  function submitMarkup(
    scope: 'CURRENCY_PAIR_DEFAULT' | 'SELLER_ORGANIZATION',
    input: { markup: string },
  ): void {
    const canSubmit = scope === 'CURRENCY_PAIR_DEFAULT' ? canSubmitDefault : canSubmitOverride;
    if (!query.data || !canSubmit) return;
    if (scope === 'SELLER_ORGANIZATION' && selectedOrganizationId === null) return;
    const currentVersion =
      scope === 'CURRENCY_PAIR_DEFAULT'
        ? query.data.default_next_version - 1
        : query.data.seller_override_next_version === null
          ? null
          : query.data.seller_override_next_version - 1;
    if (currentVersion === null) return;
    void execute({
      action: 'save',
      path: '/api/staff/seller-principal-rate-policies/save',
      body: {
        scope_type: scope,
        seller_organization_id:
          scope === 'CURRENCY_PAIR_DEFAULT' ? null : selectedOrganizationId,
        source_currency_code: 'JPY',
        markup_rate_value: input.markup.trim(),
        expected_version: currentVersion,
      },
    });
  }

  const selectedOrg = visibleOrganizations.find(
    (organization) => organization.seller_organization_id === selectedOrganizationId,
  );
  const financeOrg = visibleOrganizations.find(
    (organization) => organization.seller_organization_id === financeOrganizationId,
  );

  const missingFeeTypes = useMemo(
    () =>
      (serviceFees.data?.fees ?? [])
        .filter((entry) => entry.effective_fee === null)
        .map((entry) => SERVICE_FEE_REVIEW_TYPE_LABELS[entry.review_type] ?? entry.review_type),
    [serviceFees.data],
  );

  if (!canRead)
    return (
      <main className="sp-finance-page">
        <Alert tone="danger">当前员工没有此权限，后端会拒绝访问。</Alert>
      </main>
    );

  const exampleFeeEntry = serviceFees.data?.fees.find((entry) => entry.review_type === 'RATING');
  const exampleMarkup = query.data?.selected_policy ?? null;

  return (
    <main className="sp-finance-page">
      <header className="sp-finance-hero">
        <div>
          <p className="sp-finance-hero__eyebrow">资金与结算</p>
          <strong>订单资金工作区</strong>
          <p>基础汇率、加点、服务费共同决定订单配置；应付、付款进度和结算批次均来自后端账本。</p>
        </div>
        <div className="sp-finance-hero__actions">
          <label>
            业务日
            <TextInput
              aria-label="财务业务日"
              type="date"
              value={businessDate}
              onChange={(event) => setBusinessDate(event.target.value)}
            />
          </label>
          <Button
            className="secondary"
            onClick={() => {
              void Promise.all([
                rateCenter.refetch(),
                query.refetch(),
                serviceFees.refetch(),
                canViewLedger ? settlementSummary.refetch() : Promise.resolve(),
                canViewLedger ? settlementPayables.refetch() : Promise.resolve(),
                canViewLedger ? settlementPayments.refetch() : Promise.resolve(),
              ]);
            }}
          >
            刷新数据
          </Button>
        </div>
      </header>
      <FinanceAlertStrip
        baseRateDate={businessDate}
        baseRateMissing={
          rateCenter.data !== undefined && rateCenter.data.base_rate.active_version === null
        }
        feeOrgName={selectedOrg?.seller_organization_name ?? null}
        missingFeeTypes={missingFeeTypes}
      />
      {canViewLedger ? (
        <FinanceSettlementWorkspace
          organizationId={financeOrganizationId}
          organizationName={selectedOrg?.seller_organization_name ?? financeOrg?.seller_organization_name ?? null}
          summary={settlementSummary}
          payables={settlementPayables}
          payments={settlementPayments}
        />
      ) : null}
      <FinanceExampleCard
        baseRate={rateCenter.data?.base_rate.active_version?.rate_value ?? null}
        markup={exampleMarkup?.markup_rate_value ?? null}
        markupScopeLabel={
          exampleMarkup?.scope_type === 'SELLER_ORGANIZATION'
            ? `${selectedOrg?.seller_organization_name ?? '该卖家'}单独`
            : '全体卖家'
        }
        feeFen={exampleFeeEntry?.effective_fee?.fee_cny_fen ?? null}
        feeNote={selectedOrganizationId === null ? '按各卖家组织配置' : null}
        dateLabel={isLookup ? `回查 ${businessDate} ` : '今天'}
      />
      <section className="staff-finance-config" aria-label="配置区">
        <FormField label="针对卖家组织" htmlFor="finance-org">
          <Select
            id="finance-org"
            value={organizationId}
            onChange={(event) => {
              setOrganizationId(event.target.value.trim());
            }}
            required={!isGlobalOwner}
          >
            {isGlobalOwner ? <option value="">全体卖家（默认）</option> : null}
            {visibleOrganizations.map((organization) => (
              <option
                key={organization.seller_organization_id}
                value={organization.seller_organization_id}
              >
                {organization.seller_organization_name} · {organization.marketplace_code}
              </option>
            ))}
          </Select>
        </FormField>
        {rateCenter.data ? (
          <BaseRateBlock
            value={rateCenter.data}
            yesterdayRate={yesterdayRate.data?.base_rate.active_version?.rate_value ?? null}
            tomorrow={tomorrowRate.data ?? null}
            canSubmit={isGlobalOwner}
            refresh={async () => {
              await rateCenter.refetch();
              await query.refetch();
              if (tomorrowDate !== null) await tomorrowRate.refetch();
            }}
          />
        ) : rateCenter.isError ? (
          <Alert tone="danger">基础汇率读取失败，请重试。</Alert>
        ) : (
          <p role="status">正在读取基础汇率…</p>
        )}
        {query.isPending ? (
          <p role="status">正在读取加点…</p>
        ) : query.isError ? (
          <PolicyError
            error={query.error}
            retry={() => {
              void query.refetch();
            }}
          />
        ) : query.data ? (
          <MarkupBlock
            value={query.data}
            isGlobalOwner={isGlobalOwner}
            selectedOrgName={selectedOrg?.seller_organization_name ?? null}
            selectedOrgId={selectedOrganizationId}
            canSubmitDefault={canSubmitDefault}
            canSubmitOverride={canSubmitOverride}
            busy={authority.canRetry()}
            onSubmit={submitMarkup}
          />
        ) : (
          <Alert tone="info">选择负责的卖家组织后可读取加点。</Alert>
        )}
        {selectedOrganizationId !== null ? (
          serviceFees.isPending ? (
            <p role="status">正在读取服务费…</p>
          ) : serviceFees.isError ? (
            <PolicyError
              error={serviceFees.error}
              retry={() => {
                void serviceFees.refetch();
              }}
            />
          ) : serviceFees.data ? (
            <ServiceFeeBlock
              organizationId={selectedOrganizationId}
              organizationName={
                selectedOrg?.seller_organization_name ?? selectedOrganizationId
              }
              value={serviceFees.data}
              canSubmit={canSubmitFee}
              refresh={async () => {
                await serviceFees.refetch();
              }}
            />
          ) : null
        ) : (
          <Alert tone="info">选择卖家组织后可配置该组织的服务费。</Alert>
        )}
      </section>
      <details className="staff-finance-recon">
        <summary>对账工具（按日期回查 · 按订单查计价）</summary>
        <div className="staff-finance-recon-body">
          <FormField label="订单日期（回查）" htmlFor="order-day-base-rate-date">
            <TextInput
              id="order-day-base-rate-date"
              type="date"
              value={businessDate}
              onChange={(event) => setBusinessDate(event.target.value)}
              required
            />
          </FormField>
          {isLookup ? (
            <Alert tone="info">
              正在回查 {businessDate}（北京时间当日末）当时生效的配置；新提交仍按当前时间生效。
            </Alert>
          ) : null}
          {isGlobalOwner && session.permissions.includes('FINANCIAL_VIEW') ? (
            <OrderPricingLookup />
          ) : null}
        </div>
      </details>
      {message ? (
        <Alert tone={message.includes('未完成') || message.includes('不正确') ? 'danger' : 'success'}>
          {message}
        </Alert>
      ) : null}
      <RequestIdDisplay requestId={requestId} />
    </main>
  );
}

const SETTLEMENT_STATUS_LABELS: Record<string, string> = {
  UNPAID: '待付款',
  PARTIALLY_PAID: '部分付款',
  PAID: '已付清',
  REVERSED: '已冲销',
  UNALLOCATED: '待分配',
  PARTIALLY_ALLOCATED: '部分分配',
  FULLY_ALLOCATED: '已分配',
};

const PAYABLE_TYPE_LABELS: Record<string, string> = {
  SELLER_PRINCIPAL: '卖家本金',
  SELLER_SERVICE_FEE: '卖家服务费',
};

type SettlementSummaryQuery = ReturnType<typeof useQuery<Awaited<ReturnType<typeof staffApi.settlementSummary>>['data']>>;
type SettlementPayablesQuery = ReturnType<typeof useQuery<Awaited<ReturnType<typeof staffApi.settlementPayables>>['data']>>;
type SettlementPaymentsQuery = ReturnType<typeof useQuery<Awaited<ReturnType<typeof staffApi.settlementPayments>>['data']>>;

function FinanceSettlementWorkspace({
  organizationId,
  organizationName,
  summary,
  payables,
  payments,
}: {
  organizationId: string | null;
  organizationName: string | null;
  summary: SettlementSummaryQuery;
  payables: SettlementPayablesQuery;
  payments: SettlementPaymentsQuery;
}): React.JSX.Element {
  const summaryValue = summary.data?.settlement;
  const payableItems = payables.data?.items ?? [];
  const paymentItems = payments.data?.items ?? [];
  return (
    <section className="sp-finance-ledger" aria-labelledby="staff-finance-settlement-title">
      <div className="sp-finance-ledger__heading">
        <div>
          <p className="sp-finance-kicker">卖家组织账本</p>
          <h2 id="staff-finance-settlement-title">结算概览</h2>
          <p>{organizationName ?? (organizationId ? '当前组织' : '选择卖家组织后显示')}</p>
        </div>
        {organizationId ? <span className="sp-finance-ledger__scope">后端权威余额</span> : null}
      </div>
      {organizationId === null ? (
        <p className="sp-finance-state">当前账号没有可读取的卖家组织。</p>
      ) : summary.isPending ? (
        <p className="sp-finance-state" role="status">正在读取结算概览</p>
      ) : summary.isError ? (
        <p className="sp-finance-state sp-finance-state--error">结算概览读取失败，请刷新重试。</p>
      ) : summaryValue ? (
        <div className="sp-finance-summary" aria-label="结算余额摘要">
          <div>
            <span>应付本金</span>
            <strong>{formatCny(summaryValue.outstanding_principal_cny_fen)}</strong>
          </div>
          <div>
            <span>应付服务费</span>
            <strong>{formatCny(summaryValue.outstanding_service_fee_cny_fen)}</strong>
          </div>
          <div className="is-emphasis">
            <span>待结算合计</span>
            <strong>{formatCny(summaryValue.total_outstanding_cny_fen)}</strong>
          </div>
          <div>
            <span>未分配到账</span>
            <strong>{formatCny(summaryValue.unallocated_credit_cny_fen)}</strong>
          </div>
        </div>
      ) : null}
      <div className="sp-finance-ledger__columns">
        <section className="sp-finance-ledger__section" aria-labelledby="staff-finance-payables-title">
          <div className="sp-section-heading">
            <div>
              <h3 id="staff-finance-payables-title">应付明细</h3>
              <p>按后端状态与金额显示</p>
            </div>
            <span className="sp-section-count">{payableItems.length} 笔</span>
          </div>
          {payables.isPending ? (
            <p className="sp-finance-state" role="status">正在读取应付明细</p>
          ) : payables.isError ? (
            <p className="sp-finance-state sp-finance-state--error">应付明细读取失败，请刷新重试。</p>
          ) : payableItems.length === 0 ? (
            <p className="sp-finance-state">暂无应付明细。</p>
          ) : (
            <div className="sp-finance-payables-table-wrap">
              <table className="sp-finance-payables-table">
                <thead>
                  <tr><th>订单 / 产品</th><th>类型</th><th className="number">应付</th><th className="number">未付</th><th>状态</th></tr>
                </thead>
                <tbody>
                  {payableItems.map((item) => (
                    <tr key={item.payable_id}>
                      <td><strong>{item.amazon_order_number}</strong><small>{item.product.name}</small></td>
                      <td>{PAYABLE_TYPE_LABELS[item.payable_type] ?? item.payable_type}</td>
                      <td className="number">{formatCny(item.due_amount_cny_fen)}</td>
                      <td className="number">{formatCny(item.outstanding_amount_cny_fen)}</td>
                      <td><span className={`sp-finance-status sp-finance-status--${item.status.toLowerCase()}`}>{SETTLEMENT_STATUS_LABELS[item.status] ?? item.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="sp-finance-ledger__section" aria-labelledby="staff-finance-payments-title">
          <div className="sp-section-heading">
            <div>
              <h3 id="staff-finance-payments-title">付款进度</h3>
              <p>付款与分配状态来自账本</p>
            </div>
            <span className="sp-section-count">{paymentItems.length} 笔</span>
          </div>
          {payments.isPending ? (
            <p className="sp-finance-state" role="status">正在读取付款记录</p>
          ) : payments.isError ? (
            <p className="sp-finance-state sp-finance-state--error">付款记录读取失败，请刷新重试。</p>
          ) : paymentItems.length === 0 ? (
            <p className="sp-finance-state">暂无付款记录。</p>
          ) : (
            <ul className="sp-finance-payment-list">
              {paymentItems.map((payment) => (
                <li key={payment.payment_id}>
                  <div>
                    <strong>{formatCny(payment.amount_cny_fen)}</strong>
                    <small>{formatShanghai(payment.paid_at)}</small>
                  </div>
                  <div className="sp-finance-payment-values">
                    <span>已分配 {formatCny(payment.allocated_amount_cny_fen)}</span>
                    <span>未分配 {formatCny(payment.unallocated_amount_cny_fen)}</span>
                  </div>
                  <span className="sp-finance-status sp-finance-status--payment">{SETTLEMENT_STATUS_LABELS[payment.status] ?? payment.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {organizationId ? <SettlementBatchesSection organizationId={organizationId} /> : null}
    </section>
  );
}

/**
 * P5 entry point on the finance page: paste a formal order id to see the
 * frozen pricing configuration and arithmetic for that single order.
 * Owner + FINANCIAL_VIEW only — the backing API is the internal-finance read.
 */
function OrderPricingLookup(): React.JSX.Element {
  const client = useQueryClient();
  const [input, setInput] = useState('');
  const [orderId, setOrderId] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ['staff', 'finance-order-detail', orderId],
    queryFn: ({ signal }) =>
      staffApi
        .financeOrderDetail(client, orderId!, signal)
        .then((response) => response.data),
    enabled: orderId !== null,
    retry: false,
  });
  return (
    <Card className="customer-visible">
      <h3>按订单查计价</h3>
      <p>输入正式订单 ID，查看该单确认时冻结的汇率 / 加点 / 服务费与算式（仅 Owner）。</p>
      <form
        className="staff-filter-grid"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = input.trim();
          setOrderId(trimmed.length > 0 ? trimmed : null);
        }}
      >
        <FormField label="正式订单 ID" htmlFor="finance-order-id">
          <TextInput
            id="finance-order-id"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            required
          />
        </FormField>
        <Button type="submit" className="secondary" disabled={detail.isFetching}>
          查询计价
        </Button>
      </form>
      {detail.isError ? (
        <Alert tone="danger">读取失败：订单不存在或当前账号无权查看内部财务。</Alert>
      ) : null}
      {detail.data ? <PricingBreakdownCard detail={detail.data} orderId={orderId ?? ''} /> : null}
    </Card>
  );
}
