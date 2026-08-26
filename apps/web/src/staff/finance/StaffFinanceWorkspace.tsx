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
 * /staff/finance — what a single order costs and earns, in plain terms:
 * the three pricing rules (base rate / markup / service fee) and where to
 * fix gaps.  Every save is immediately effective (D-056 single-save model).
 * Editing lives inside each block; reconciliation tools are folded away at
 * the bottom.
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

  const missingFeeTypes = useMemo(
    () =>
      (serviceFees.data?.fees ?? [])
        .filter((entry) => entry.effective_fee === null)
        .map((entry) => SERVICE_FEE_REVIEW_TYPE_LABELS[entry.review_type] ?? entry.review_type),
    [serviceFees.data],
  );

  if (!canRead)
    return (
      <main className="staff-finance-workspace">
        <Alert tone="danger">当前员工没有此权限，后端会拒绝访问。</Alert>
      </main>
    );

  const exampleFeeEntry = serviceFees.data?.fees.find((entry) => entry.review_type === 'RATING');
  const exampleMarkup = query.data?.selected_policy ?? null;

  return (
    <main className="staff-finance-workspace">
      <section aria-labelledby="staff-finance-title">
        <p className="eyebrow">财务配置 · 仅 Staff</p>
        <h2 id="staff-finance-title">财务配置</h2>
        <p className="hint">
          基础汇率、加点、服务费共同决定每一单：买家返多少、卖家收多少、平台赚多少。
        </p>
      </section>
      <FinanceAlertStrip
        baseRateDate={businessDate}
        baseRateMissing={
          rateCenter.data !== undefined && rateCenter.data.base_rate.active_version === null
        }
        feeOrgName={selectedOrg?.seller_organization_name ?? null}
        missingFeeTypes={missingFeeTypes}
      />
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
