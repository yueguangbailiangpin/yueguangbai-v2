import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { isFrontendApiError } from '../../api/errors';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import { Alert, Button, Card, FormField, RequestIdDisplay, Select, TextInput } from '../../ui/primitives';
import { staffApi } from '../api/client';
import { staffWorkbenchKeys } from '../queries/keys';
import {
  StaffMutationAuthority,
  type StaffMutationRequest,
} from '../mutations/StaffMutationAuthority';
import { EffectTimeline, type EffectTimelineEntry } from '../shared/EffectTimeline';
import { PricingBreakdownCard } from '../shared/PricingBreakdownCard';
import {
  DecisionCards,
  OrderDayBaseRateCard,
  PolicyError,
  PolicyFacts,
  PolicySubmitCard,
  ServiceFeeCard,
} from './PolicyConfigurationCards';
import {
  chinaDate,
  fenToYuan,
  futureDateTime,
  lookupAsOf,
  markupLabel,
  parseBeijingDateTime,
  rateLabel,
} from './finance-format';

type PolicyMutationResult = Awaited<ReturnType<typeof staffApi.submitSellerPrincipalRatePolicy>>;

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
 * The unified finance configuration workspace (/staff/finance): summary card,
 * effective-time timeline, by-date lookup, and the three configuration
 * sections (base rate / markup / service fee).  The whole page sits inside a
 * market-group container so additional currency pairs need only one more
 * group — the single current group renders without a group header by design.
 */
export function StaffFinanceWorkspace(): React.JSX.Element {
  const session = useCurrentStaffSession();
  const client = useQueryClient();
  const [searchParams] = useSearchParams();
  const deepLinkBusinessDate = searchParams.get('business_date');
  const deepLinkOrganizationId = searchParams.get('seller_organization_id');
  const deepLinkSection = searchParams.get('section');
  // Marketplace-wide organization ids are NOT preselected: the backend only
  // treats organizations assigned to this staff member as readable, and a
  // preselected unassigned organization made the whole page 404.  The first
  // backend-visible organization is selected after the read succeeds.
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
  const hasFinancialCorrection = session.permissions.includes('FINANCIAL_CORRECT');
  const canSubmitOverride =
    organizationId.length > 0 &&
    hasManage &&
    (isGlobalOwner ||
      (session.role.code === 'seller_ops' &&
        session.data_scope.sellerOrganizationIds.includes(organizationId)));
  const canSubmitDefault = isGlobalOwner;
  const canDecide = session.role.code === 'owner' && hasFinancialCorrection;
  const [sourceCurrencyCode] = useState('JPY');
  const [scopeType, setScopeType] = useState<'CURRENCY_PAIR_DEFAULT' | 'SELLER_ORGANIZATION'>(
    isGlobalOwner ? 'CURRENCY_PAIR_DEFAULT' : 'SELLER_ORGANIZATION',
  );
  const [markup, setMarkup] = useState('0.004');
  const [effectiveAt, setEffectiveAt] = useState(() => futureDateTime());
  const [message, setMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const authority = useMemo(() => new StaffMutationAuthority<PolicyMutationResult>(), []);
  const selectedOrganizationId = organizationId.length > 0 ? organizationId : null;
  // By-date lookup: a past business date rewinds the policy/fee resolution
  // to that Beijing business day; today resolves at the present moment.
  const today = chinaDate();
  const lookupAsOfValue = businessDate < today ? lookupAsOf(businessDate) : null;
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
          sourceCurrencyCode,
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

  async function execute(request: StaffMutationRequest | null): Promise<void> {
    setMessage(null);
    setRequestId(null);
    try {
      const response =
        request === null
          ? await authority.retry()
          : await authority.execute(request, ({ action, path, body }, key) =>
              action === 'submit'
                ? staffApi.submitSellerPrincipalRatePolicy(client, body, key)
                : action === 'confirm'
                  ? staffApi.confirmSellerPrincipalRatePolicy(
                      client,
                      path.split('/').at(-2)!,
                      body,
                      key,
                    )
                  : staffApi.rejectSellerPrincipalRatePolicy(
                      client,
                      path.split('/').at(-2)!,
                      body,
                      key,
                    ),
            );
      setRequestId(response.requestId);
      setMessage('策略操作已记录；正式订单只会使用确认时可解析到的生效策略。');
      await query.refetch();
    } catch (error) {
      setRequestId(isFrontendApiError(error) ? error.requestId : null);
      setMessage(
        isFrontendApiError(error)
          ? `操作未完成（${error.code}），请刷新后重试。`
          : '操作未完成，请稍后重试。',
      );
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const canSubmit = scopeType === 'CURRENCY_PAIR_DEFAULT' ? canSubmitDefault : canSubmitOverride;
    if (!query.data || !canSubmit) return;
    if (scopeType === 'SELLER_ORGANIZATION' && selectedOrganizationId === null) return;
    const currentVersion =
      scopeType === 'CURRENCY_PAIR_DEFAULT'
        ? query.data.default_next_version - 1
        : query.data.seller_override_next_version === null
          ? null
          : query.data.seller_override_next_version - 1;
    if (currentVersion === null) return;
    const pending =
      scopeType === 'CURRENCY_PAIR_DEFAULT'
        ? query.data.default_pending_policy
        : query.data.seller_override_pending_policy;
    if (pending) return;
    const effective = parseBeijingDateTime(effectiveAt);
    if (!Number.isSafeInteger(effective)) {
      setMessage('生效时间格式不正确。');
      return;
    }
    execute({
      action: 'submit',
      path: '/api/staff/seller-principal-rate-policies/submit',
      body: {
        scope_type: scopeType,
        seller_organization_id:
          scopeType === 'CURRENCY_PAIR_DEFAULT' ? null : selectedOrganizationId,
        source_currency_code: sourceCurrencyCode,
        markup_rate_value: markup.trim(),
        effective_from: effective,
        expected_version: currentVersion,
      },
    });
  }

  const timelineEntries = useMemo<EffectTimelineEntry[]>(() => {
    const entries: EffectTimelineEntry[] = [];
    const rateData = rateCenter.data;
    if (rateData?.base_rate.pending_rate) {
      entries.push({
        id: `base-rate:${rateData.base_rate.pending_rate.rate_id}`,
        kind: '基础汇率',
        value: rateLabel(rateData.base_rate.pending_rate.cny_per_jpy_e8),
        effectiveAt: rateData.base_rate.pending_rate.confirmed_at ?? Date.now(),
        state: 'PENDING_CONFIRM',
      });
    }
    const policyData = query.data;
    if (policyData) {
      for (const [kind, pending, upcoming] of [
        ['默认加点', policyData.default_pending_policy, policyData.default_upcoming_policy],
        [
          '组织专属加点',
          policyData.seller_override_pending_policy,
          policyData.seller_override_upcoming_policy,
        ],
      ] as const) {
        if (pending) {
          entries.push({
            id: `markup-pending:${pending.policy_version_id}`,
            kind,
            value: markupLabel(pending.markup_rate_value),
            effectiveAt: pending.effective_from,
            state: 'PENDING_CONFIRM',
          });
        }
        if (upcoming) {
          entries.push({
            id: `markup-upcoming:${upcoming.policy_version_id}`,
            kind,
            value: markupLabel(upcoming.markup_rate_value),
            effectiveAt: upcoming.effective_from,
            state: 'CONFIRMED_WAITING',
          });
        }
      }
    }
    for (const entry of serviceFees.data?.fees ?? []) {
      if (entry.pending_fee) {
        entries.push({
          id: `fee-pending:${entry.pending_fee.fee_version_id}`,
          kind: `服务费 · ${SERVICE_FEE_REVIEW_TYPE_LABELS[entry.review_type]}`,
          value: fenToYuan(entry.pending_fee.fee_cny_fen),
          effectiveAt: entry.pending_fee.effective_from,
          state: 'PENDING_CONFIRM',
        });
      }
      if (entry.upcoming_fee) {
        entries.push({
          id: `fee-upcoming:${entry.upcoming_fee.fee_version_id}`,
          kind: `服务费 · ${SERVICE_FEE_REVIEW_TYPE_LABELS[entry.review_type]}`,
          value: fenToYuan(entry.upcoming_fee.fee_cny_fen),
          effectiveAt: entry.upcoming_fee.effective_from,
          state: 'CONFIRMED_WAITING',
        });
      }
    }
    return entries;
  }, [rateCenter.data, query.data, serviceFees.data]);

  if (!canRead)
    return (
      <main className="staff-finance-workspace">
        <Alert tone="danger">当前员工没有此权限，后端会拒绝访问。</Alert>
      </main>
    );
  const lookupHint = businessDate < today;
  return (
    <main className="staff-finance-workspace">
      <section aria-labelledby="staff-finance-title">
        <p className="eyebrow">财务配置 · 仅 Staff</p>
        <h2 id="staff-finance-title">财务配置</h2>
        <Alert tone="warning">
          订单日基础汇率是买家返款与卖家本金共同基础；卖家加点是绝对汇率增量，不是百分比；服务费按组织×评价类型配置。所有正式订单冻结确认时的版本和值，历史不回写。
        </Alert>
        <form
          className="staff-filter-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void query.refetch();
            void rateCenter.refetch();
            void serviceFees.refetch();
          }}
        >
          <FormField label="卖家组织" htmlFor="principal-rate-organization">
            <Select
              id="principal-rate-organization"
              value={organizationId}
              onChange={(event) => {
                const value = event.target.value.trim();
                setOrganizationId(value);
                if (value.length === 0 && isGlobalOwner) {
                  setScopeType('CURRENCY_PAIR_DEFAULT');
                }
              }}
              required={!isGlobalOwner}
            >
              {isGlobalOwner ? <option value="">默认加点（所有卖家）</option> : null}
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
          <FormField label="订单日期（回查）" htmlFor="order-day-base-rate-date">
            <TextInput
              id="order-day-base-rate-date"
              type="date"
              value={businessDate}
              onChange={(event) => setBusinessDate(event.target.value)}
              required
            />
          </FormField>
          <FormField label="币种对" htmlFor="principal-rate-source">
            <Select
              id="principal-rate-source"
              value={sourceCurrencyCode}
              onChange={() => undefined}
              disabled
            >
              <option value="JPY">JPY → CNY</option>
            </Select>
          </FormField>
          <Button
            type="submit"
            className="secondary"
            disabled={(!isGlobalOwner && !organizationId) || query.isFetching}
          >
            读取配置
          </Button>
        </form>
      </section>
      <div className="staff-finance-market-group" data-market="JPY→CNY">
        {lookupHint ? (
          <Alert tone="info">
            正在回查 {businessDate}（北京时间当日末）当时生效的配置，仅供参考与对账；新提交仍按当前时间生效。
          </Alert>
        ) : null}
        <FinanceSummaryCard
          rateCenterData={rateCenter.data}
          policyData={query.data}
          serviceFeesData={serviceFees.data}
          organizationName={
            visibleOrganizations.find(
              (organization) => organization.seller_organization_id === selectedOrganizationId,
            )?.seller_organization_name ?? null
          }
          businessDate={businessDate}
        />
        <Card className="customer-visible">
          <h3>生效时间线</h3>
          <EffectTimeline entries={timelineEntries} />
        </Card>
        {rateCenter.data ? (
          <OrderDayBaseRateCard
            value={rateCenter.data}
            canSubmit={isGlobalOwner && hasFinancialCorrection}
            canConfirm={canDecide}
            refresh={async () => {
              await rateCenter.refetch();
              await query.refetch();
            }}
          />
        ) : rateCenter.isError ? (
          <Alert tone="danger">订单日基础汇率读取失败，请重试。</Alert>
        ) : null}
        {query.isPending ? (
          <p role="status">正在读取加点策略</p>
        ) : query.isError ? (
          <PolicyError
            error={query.error}
            retry={() => {
              void query.refetch();
            }}
          />
        ) : query.data ? (
          <>
            <PolicyFacts value={query.data} />
            {canSubmitDefault || canSubmitOverride ? (
              <PolicySubmitCard
                canSubmitDefault={canSubmitDefault}
                canSubmitOverride={canSubmitOverride}
                selectedOrganizationId={selectedOrganizationId}
                isGlobalOwner={isGlobalOwner}
                queryData={query.data}
                scopeType={scopeType}
                setScopeType={setScopeType}
                markup={markup}
                setMarkup={setMarkup}
                effectiveAt={effectiveAt}
                setEffectiveAt={setEffectiveAt}
                authority={authority}
                onSubmit={submit}
              />
            ) : null}
            {canDecide ? (
              <DecisionCards value={query.data} execute={execute} busy={authority.canRetry()} />
            ) : null}
          </>
        ) : (
          <Alert tone="info">选择负责的卖家组织后可读取默认加点与组织专属覆盖。</Alert>
        )}
        {selectedOrganizationId !== null ? (
          serviceFees.isPending ? (
            <p role="status">正在读取卖家服务费</p>
          ) : serviceFees.isError ? (
            <PolicyError
              error={serviceFees.error}
              retry={() => {
                void serviceFees.refetch();
              }}
            />
          ) : serviceFees.data ? (
            <ServiceFeeCard
              organizationId={selectedOrganizationId}
              organizationName={
                visibleOrganizations.find(
                  (organization) =>
                    organization.seller_organization_id === selectedOrganizationId,
                )?.seller_organization_name ?? selectedOrganizationId
              }
              value={serviceFees.data}
              canSubmit={hasManage && (isGlobalOwner || session.role.code === 'seller_ops')}
              canDecide={canDecide}
              refresh={async () => {
                await serviceFees.refetch();
              }}
            />
          ) : null
        ) : (
          <Alert tone="info">选择卖家组织后可配置该组织的服务费。</Alert>
        )}
        {isGlobalOwner && session.permissions.includes('FINANCIAL_VIEW') ? (
          <OrderPricingLookup />
        ) : null}
      </div>
      {message ? (
        <Alert tone={message.includes('未完成') ? 'danger' : 'success'}>{message}</Alert>
      ) : null}
      <RequestIdDisplay requestId={requestId} />
    </main>
  );
}

/**
 * P5 entry point on the finance page: paste a formal order id (or arrive
 * from the order detail page) to see the frozen pricing configuration and
 * arithmetic for that single order.  Owner + FINANCIAL_VIEW only — the
 * backing API is the internal-finance read.
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
    <Card className="customer-visible" id="finance-section-order-lookup">
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

function FinanceSummaryCard({
  rateCenterData,
  policyData,
  serviceFeesData,
  organizationName,
  businessDate,
}: {
  rateCenterData: Awaited<ReturnType<typeof staffApi.rateCenter>>['data'] | undefined;
  policyData: Awaited<ReturnType<typeof staffApi.sellerPrincipalRatePolicies>>['data'] | undefined;
  serviceFeesData: Awaited<ReturnType<typeof staffApi.sellerServiceFees>>['data'] | undefined;
  organizationName: string | null;
  businessDate: string;
}): React.JSX.Element {
  const confirmedRate = rateCenterData?.base_rate.confirmed_rate ?? null;
  const pendingRate = rateCenterData?.base_rate.pending_rate ?? null;
  const selectedPolicy = policyData?.selected_policy ?? null;
  return (
    <Card id="finance-section-summary" className="customer-visible">
      <h3>当前生效摘要</h3>
      <p>
        <strong>基础汇率（{businessDate}）：</strong>
        {confirmedRate ? (
          `${rateLabel(confirmedRate.cny_per_jpy_e8)} · v${confirmedRate.version_no}`
        ) : (
          <span className="inline-warning">未确认</span>
        )}
        {pendingRate ? `；待确认 ${rateLabel(pendingRate.cny_per_jpy_e8)}` : ''}
      </p>
      <p>
        <strong>加点：</strong>
        {selectedPolicy
          ? `${selectedPolicy.scope_type === 'SELLER_ORGANIZATION' ? `组织专属（${organizationName ?? '未知组织'}）` : '默认'} ${markupLabel(selectedPolicy.markup_rate_value)} · v${selectedPolicy.version_no}`
          : <span className="inline-warning">未配置</span>}
      </p>
      <p>
        <strong>服务费{organizationName ? `（${organizationName}）` : ''}：</strong>
        {serviceFeesData ? (
          serviceFeesData.fees.map((entry) => (
            <span key={entry.review_type}>
              {' '}
              {SERVICE_FEE_REVIEW_TYPE_LABELS[entry.review_type]}
              {entry.effective_fee ? (
                ` ${fenToYuan(entry.effective_fee.fee_cny_fen)}；`
              ) : (
                <span className="inline-warning"> 未配置；</span>
              )}
            </span>
          ))
        ) : (
          '选择卖家组织后显示'
        )}
      </p>
    </Card>
  );
}
