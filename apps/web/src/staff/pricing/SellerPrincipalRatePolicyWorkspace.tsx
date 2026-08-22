import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { isFrontendApiError } from '../../api/errors';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import {
  Alert,
  Button,
  Card,
  FormField,
  RequestIdDisplay,
  Select,
  StatusBadge,
  TextInput,
} from '../../ui/primitives';
import { staffApi } from '../api/client';
import { staffWorkbenchKeys } from '../queries/keys';
import {
  StaffMutationAuthority,
  type StaffMutationRequest,
} from '../mutations/StaffMutationAuthority';
import { formatShanghai } from '../shared/format';

type Policy = NonNullable<
  Awaited<ReturnType<typeof staffApi.sellerPrincipalRatePolicies>>['data']['default_policy']
>;
type PolicyRead = Awaited<ReturnType<typeof staffApi.sellerPrincipalRatePolicies>>['data'];
type PolicyMutationResult = Awaited<ReturnType<typeof staffApi.submitSellerPrincipalRatePolicy>>;
type RateCenter = Awaited<ReturnType<typeof staffApi.rateCenter>>['data'];

export function SellerPrincipalRatePolicyWorkspace(): React.JSX.Element {
  const session = useCurrentStaffSession();
  const client = useQueryClient();
  // Marketplace-wide organization ids are NOT preselected: the backend only
  // treats organizations assigned to this staff member as readable, and a
  // preselected unassigned organization made the whole page 404.  The first
  // backend-visible organization is selected after the read succeeds.
  const [organizationId, setOrganizationId] = useState('');
  const [businessDate, setBusinessDate] = useState(() => chinaDate());
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
  const [sourceCurrencyCode, setSourceCurrencyCode] = useState('JPY');
  const [scopeType, setScopeType] = useState<'CURRENCY_PAIR_DEFAULT' | 'SELLER_ORGANIZATION'>(
    isGlobalOwner ? 'CURRENCY_PAIR_DEFAULT' : 'SELLER_ORGANIZATION',
  );
  const [markup, setMarkup] = useState('0.004');
  const [effectiveAt, setEffectiveAt] = useState(() => futureDateTime());
  const [message, setMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const authority = useMemo(() => new StaffMutationAuthority<PolicyMutationResult>(), []);
  const selectedOrganizationId = organizationId.length > 0 ? organizationId : null;
  const rateCenter = useQuery({
    queryKey: staffWorkbenchKeys.rateCenter(
      session.authorization_version,
      businessDate,
      selectedOrganizationId,
    ),
    queryFn: ({ signal }) =>
      staffApi
        .rateCenter(client, businessDate, selectedOrganizationId, signal)
        .then((response) => response.data),
    enabled: canRead,
    retry: false,
  });
  const query = useQuery({
    queryKey: staffWorkbenchKeys.sellerPrincipalRatePolicies(
      session.authorization_version,
      selectedOrganizationId,
    ),
    queryFn: ({ signal }) =>
      staffApi
        .sellerPrincipalRatePolicies(client, sourceCurrencyCode, selectedOrganizationId, signal)
        .then((response) => response.data),
    enabled: canRead && (isGlobalOwner || selectedOrganizationId !== null),
    retry: false,
  });
  const serviceFees = useQuery({
    queryKey: staffWorkbenchKeys.sellerServiceFees(
      session.authorization_version,
      selectedOrganizationId ?? '',
    ),
    queryFn: ({ signal }) =>
      staffApi
        .sellerServiceFees(client, selectedOrganizationId!, signal)
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

  if (!canRead)
    return (
      <main className="staff-pricing-workspace">
        <Alert tone="danger">当前员工没有此权限，后端会拒绝访问。</Alert>
      </main>
    );
  return (
    <main className="staff-pricing-workspace">
      <section aria-labelledby="seller-principal-rate-title">
        <p className="eyebrow">财务配置 · 仅 Staff</p>
        <h2 id="seller-principal-rate-title">汇率中心</h2>
        <Alert tone="warning">
          订单日基础汇率是买家返款与卖家本金共同基础；卖家加点是绝对汇率增量，不是百分比。所有正式订单冻结确认时的版本和值，历史不回写。
        </Alert>
        <form
          className="staff-filter-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void query.refetch();
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
          <FormField label="Amazon 订单日期" htmlFor="order-day-base-rate-date">
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
              onChange={(event) => setSourceCurrencyCode(event.target.value)}
            >
              <option value="JPY">JPY → CNY</option>
            </Select>
          </FormField>
          <Button
            type="submit"
            className="secondary"
            disabled={(!isGlobalOwner && !organizationId) || query.isFetching}
          >
            读取策略
          </Button>
        </form>
      </section>
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
        <p role="status">正在读取策略事实</p>
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
            <Card className="sensitive-action">
              <h3>提交新策略</h3>
              <form onSubmit={submit}>
                <FormField label="策略范围" htmlFor="principal-rate-scope">
                  <Select
                    id="principal-rate-scope"
                    value={scopeType}
                    onChange={(event) => setScopeType(event.target.value as typeof scopeType)}
                  >
                    {canSubmitDefault ? (
                      <option value="CURRENCY_PAIR_DEFAULT">币种对默认加点</option>
                    ) : null}
                    {selectedOrganizationId !== null || !isGlobalOwner ? (
                      <option value="SELLER_ORGANIZATION">卖家组织专属覆盖</option>
                    ) : null}
                  </Select>
                </FormField>
                <FormField
                  label="卖家本金汇率加点（例如 +0.004 或 0）"
                  htmlFor="principal-rate-markup"
                >
                  <TextInput
                    id="principal-rate-markup"
                    value={markup}
                    onChange={(event) => setMarkup(event.target.value)}
                    inputMode="decimal"
                    required
                  />
                </FormField>
                <FormField label="生效时间（北京时间）" htmlFor="principal-rate-effective">
                  <TextInput
                    id="principal-rate-effective"
                    type="datetime-local"
                    value={effectiveAt}
                    onChange={(event) => setEffectiveAt(event.target.value)}
                    required
                  />
                </FormField>
                <p className="hint">
                  {scopeType === 'CURRENCY_PAIR_DEFAULT'
                    ? '生效时间必须晚于当前时间；默认加点提交即确认生效，无需 Owner 二次确认。'
                    : '生效时间必须晚于当前时间；组织专属提交后需在生效前由另一名 Owner 确认（提交人不能自确）。'}
                </p>
                <Button
                  className="danger"
                  disabled={
                    authority.canRetry() ||
                    (scopeType === 'CURRENCY_PAIR_DEFAULT'
                      ? !canSubmitDefault
                      : !canSubmitOverride) ||
                    (scopeType === 'CURRENCY_PAIR_DEFAULT'
                      ? Boolean(query.data.default_pending_policy)
                      : Boolean(query.data.seller_override_pending_policy))
                  }
                >
                  {scopeType === 'CURRENCY_PAIR_DEFAULT' ? '提交并生效' : '提交待确认策略'}
                </Button>
              </form>
            </Card>
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
        <Alert tone="info">选择卖家组织后可配置该组织的卖家服务费。</Alert>
      )}
      {message ? (
        <Alert tone={message.includes('未完成') ? 'danger' : 'success'}>{message}</Alert>
      ) : null}
      <RequestIdDisplay requestId={requestId} />
    </main>
  );
}

function OrderDayBaseRateCard({
  value,
  canSubmit,
  canConfirm,
  refresh,
}: {
  value: RateCenter;
  canSubmit: boolean;
  canConfirm: boolean;
  refresh: () => Promise<void>;
}): React.JSX.Element {
  const client = useQueryClient();
  const [rateValue, setRateValue] = useState('0.047');
  const [message, setMessage] = useState<string | null>(null);
  const submit = useMutation({
    mutationFn: () =>
      staffApi.submitOrderDayBaseRate(
        client,
        {
          business_date: value.business_date,
          rate_value: rateValue.trim(),
          expected_version: value.base_rate.next_version - 1,
        },
        crypto.randomUUID(),
      ),
    onSuccess: async () => {
      setMessage('订单日基础汇率已提交，等待 Owner 确认。');
      await refresh();
    },
    onError: (error) => setMessage(baseRateErrorMessage('提交', error)),
  });
  const confirm = useMutation({
    mutationFn: () =>
      staffApi.confirmOrderDayBaseRate(
        client,
        value.base_rate.pending_rate!.rate_id,
        { expected_version: value.base_rate.pending_rate!.decision_version },
        crypto.randomUUID(),
      ),
    onSuccess: async () => {
      setMessage('订单日基础汇率已确认。');
      await refresh();
    },
    onError: (error) => {
      setMessage(baseRateErrorMessage('确认', error));
      if (
        isFrontendApiError(error)
        && (error.code === 'VERSION_CONFLICT' || error.code === 'NOT_FOUND')
      ) {
        void refresh();
      }
    },
  });
  const confirmed = value.base_rate.confirmed_rate;
  const pending = value.base_rate.pending_rate;
  return (
    <Card className="sensitive-action">
      <h3>订单日基础汇率（JPY → CNY）</h3>
      <p>订单日期：{value.business_date}。买家返款和卖家本金共同使用该基础汇率。</p>
      <p>
        已确认：
        {confirmed ? `${rateLabel(confirmed.cny_per_jpy_e8)} · v${confirmed.version_no}` : '暂无'}
        {pending ? `；待确认：${rateLabel(pending.cny_per_jpy_e8)} · v${pending.version_no}` : ''}
      </p>
      {canSubmit && !confirmed && !pending ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit.mutate();
          }}
        >
          <FormField
            label="基础汇率（1 JPY = ? CNY，最多 8 位小数）"
            htmlFor="order-day-base-rate-value"
          >
            <TextInput
              id="order-day-base-rate-value"
              value={rateValue}
              onChange={(event) => setRateValue(event.target.value)}
              inputMode="decimal"
              required
            />
          </FormField>
          <Button disabled={submit.isPending}>提交待确认基础汇率</Button>
        </form>
      ) : null}
      {canConfirm && pending ? (
        <Button className="danger" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
          确认订单日基础汇率
        </Button>
      ) : null}
      {message ? (
        <Alert tone={message.includes('未完成') ? 'danger' : 'success'}>{message}</Alert>
      ) : null}
    </Card>
  );
}

function PolicyFacts({ value }: { value: PolicyRead }): React.JSX.Element {
  return (
    <section className="staff-pricing-policy-grid" aria-label="当前策略">
      <PolicyCard
        title="币种对默认加点"
        policy={value.default_policy}
        pending={value.default_pending_policy}
        nextVersion={value.default_next_version}
      />
      <PolicyCard
        title="卖家组织专属覆盖"
        policy={value.seller_override_policy}
        pending={value.seller_override_pending_policy}
        nextVersion={value.seller_override_next_version}
      />
      <Card className="customer-visible">
        <h3>确认时采用</h3>
        <p>
          {value.selected_policy
            ? `${value.selected_policy.scope_type === 'SELLER_ORGANIZATION' ? '卖家组织覆盖' : '币种对默认'} · ${markupLabel(value.selected_policy.markup_rate_value)} · v${value.selected_policy.version_no}`
            : '当前没有已生效策略'}
        </p>
      </Card>
    </section>
  );
}

function PolicyCard({
  title,
  policy,
  pending,
  nextVersion,
}: {
  title: string;
  policy: Policy | null;
  pending: Policy | null;
  nextVersion: number | null;
}): React.JSX.Element {
  return (
    <Card className="customer-visible">
      <h3>{title}</h3>
      <p>下一版本：{nextVersion === null ? '选择组织后读取' : `v${nextVersion}`}</p>
      {policy ? (
        <>
          <StatusBadge tone={policy.status === 'CONFIRMED' ? 'success' : 'neutral'}>
            {policy.status === 'CONFIRMED' ? '已确认' : policy.status}
          </StatusBadge>
          <p>
            加点：{markupLabel(policy.markup_rate_value)} · 生效：
            {formatShanghai(policy.effective_from)}
          </p>
          <p>
            版本 v{policy.version_no} · 确认：
            {policy.confirmed_at === null ? '—' : formatShanghai(policy.confirmed_at)}
          </p>
        </>
      ) : (
        <p>暂无当前生效策略</p>
      )}
      {pending ? (
        <p className="inline-warning">
          待 Owner 决策：{markupLabel(pending.markup_rate_value)} ·{' '}
          {formatShanghai(pending.effective_from)} · v{pending.version_no}
        </p>
      ) : null}
    </Card>
  );
}

function DecisionCards({
  value,
  execute,
  busy,
}: {
  value: PolicyRead;
  execute: (request: StaffMutationRequest | null) => Promise<void>;
  busy: boolean;
}): React.JSX.Element {
  const pending = [value.default_pending_policy, value.seller_override_pending_policy].filter(
    (item): item is Policy => item !== null,
  );
  return (
    <Card className="sensitive-action">
      <h3>Owner 确认 / 拒绝</h3>
      {pending.length === 0 ? (
        <p>当前没有待决策略。</p>
      ) : (
        pending.map((policy) => (
          <section key={policy.policy_version_id}>
            <p>
              <strong>
                {policy.scope_type === 'CURRENCY_PAIR_DEFAULT' ? '币种对默认' : '卖家组织覆盖'}
              </strong>{' '}
              · {markupLabel(policy.markup_rate_value)} · v{policy.version_no}
            </p>
            <div className="entry-actions">
              <Button
                className="danger"
                disabled={busy}
                onClick={() =>
                  execute({
                    action: 'confirm',
                    path: `/api/staff/seller-principal-rate-policies/${encodeURIComponent(policy.policy_version_id)}/confirm`,
                    body: { expected_version: policy.decision_version },
                  })
                }
              >
                确认生效策略
              </Button>
              <Button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  execute({
                    action: 'reject',
                    path: `/api/staff/seller-principal-rate-policies/${encodeURIComponent(policy.policy_version_id)}/reject`,
                    body: {
                      expected_version: policy.decision_version,
                      rejection_reason: 'Owner 在 Staff 工作台拒绝',
                    },
                  })
                }
              >
                拒绝
              </Button>
            </div>
          </section>
        ))
      )}
    </Card>
  );
}

const SERVICE_FEE_REVIEW_TYPE_LABELS: Record<string, string> = {
  RATING: '评分单',
  TEXT: '文字评论',
  IMAGE: '图片评论',
  VIDEO: '视频评论',
};

function serviceFeeErrorMessage(action: string, error: unknown): string {
  if (!isFrontendApiError(error)) return `服务费${action}未完成，请稍后重试。`;
  if (error.code === 'FORBIDDEN') {
    return `当前账号无权${action}卖家服务费（确认需要 Owner 且具备财务纠正权限）。`;
  }
  if (error.code === 'VERSION_CONFLICT' || error.code === 'NOT_FOUND') {
    return `服务费${action}未完成：数据已变化，请刷新后重试。`;
  }
  return `服务费${action}未完成（${error.code}），请刷新后重试。`;
}

function yuanToFen(value: string): string | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(value.trim());
  if (!match) return null;
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return String(Number(match[1]) * 100 + Number(fraction));
}

function fenToYuan(value: string): string {
  const fen = Number(value);
  return `¥${(fen / 100).toFixed(2)}`;
}

function ServiceFeeCard({
  organizationId,
  organizationName,
  value,
  canSubmit,
  canDecide,
  refresh,
}: {
  organizationId: string;
  organizationName: string;
  value: Awaited<ReturnType<typeof staffApi.sellerServiceFees>>['data'];
  canSubmit: boolean;
  canDecide: boolean;
  refresh: () => Promise<void>;
}): React.JSX.Element {
  const client = useQueryClient();
  const [reviewType, setReviewType] = useState<'RATING' | 'TEXT' | 'IMAGE' | 'VIDEO'>('RATING');
  const [feeYuan, setFeeYuan] = useState('');
  const [effectiveAt, setEffectiveAt] = useState(() => futureDateTime());
  const [message, setMessage] = useState<string | null>(null);
  const entry = value.fees.find((candidate) => candidate.review_type === reviewType);

  const submit = useMutation({
    mutationFn: () => {
      const fen = yuanToFen(feeYuan);
      const effective = parseBeijingDateTime(effectiveAt);
      if (fen === null || !Number.isSafeInteger(effective)) {
        throw new Error('invalid fee input');
      }
      return staffApi.submitSellerServiceFee(
        client,
        {
          seller_organization_id: organizationId,
          review_type: reviewType,
          fee_cny_fen: fen,
          effective_from: effective,
          expected_version: (entry?.next_version ?? 1) - 1,
        },
        crypto.randomUUID(),
      );
    },
    onSuccess: async () => {
      setMessage('卖家服务费已提交，等待 Owner 确认。');
      await refresh();
    },
    onError: (error) => setMessage(serviceFeeErrorMessage('提交', error)),
  });
  const confirm = useMutation({
    mutationFn: (input: { feeVersionId: string; expectedVersion: number }) =>
      staffApi.confirmSellerServiceFee(
        client,
        input.feeVersionId,
        { expected_version: input.expectedVersion },
        crypto.randomUUID(),
      ),
    onSuccess: async () => {
      setMessage('卖家服务费已确认。');
      await refresh();
    },
    onError: (error) => setMessage(serviceFeeErrorMessage('确认', error)),
  });
  const reject = useMutation({
    mutationFn: (input: { feeVersionId: string; expectedVersion: number }) =>
      staffApi.rejectSellerServiceFee(
        client,
        input.feeVersionId,
        {
          expected_version: input.expectedVersion,
          rejection_reason: 'Owner 在 Staff 工作台拒绝',
        },
        crypto.randomUUID(),
      ),
    onSuccess: async () => {
      setMessage('卖家服务费已拒绝。');
      await refresh();
    },
    onError: (error) => setMessage(serviceFeeErrorMessage('拒绝', error)),
  });

  return (
    <Card className="sensitive-action">
      <h3>卖家服务费（{organizationName}）</h3>
      <p>按评价类型配置每单服务费（人民币）。正式订单冻结确认时生效中的版本，历史不回写。</p>
      {value.fees.map((candidate) => (
        <p key={candidate.review_type}>
          <strong>{SERVICE_FEE_REVIEW_TYPE_LABELS[candidate.review_type]}</strong>
          {' '}已生效：
          {candidate.effective_fee
            ? `${fenToYuan(candidate.effective_fee.fee_cny_fen)} · v${candidate.effective_fee.version_no}`
            : '未配置'}
          {candidate.pending_fee
            ? `；待确认：${fenToYuan(candidate.pending_fee.fee_cny_fen)} · v${candidate.pending_fee.version_no} · 生效 ${formatShanghai(candidate.pending_fee.effective_from)}`
            : ''}
          {canDecide && candidate.pending_fee ? (
            <>
              {' '}
              <Button
                className="danger"
                disabled={confirm.isPending || reject.isPending}
                onClick={() =>
                  confirm.mutate({
                    feeVersionId: candidate.pending_fee!.fee_version_id,
                    expectedVersion: candidate.pending_fee!.decision_version,
                  })
                }
              >
                确认
              </Button>
              {' '}
              <Button
                className="secondary"
                disabled={confirm.isPending || reject.isPending}
                onClick={() =>
                  reject.mutate({
                    feeVersionId: candidate.pending_fee!.fee_version_id,
                    expectedVersion: candidate.pending_fee!.decision_version,
                  })
                }
              >
                拒绝
              </Button>
            </>
          ) : null}
        </p>
      ))}
      {canSubmit ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (entry?.pending_fee) return;
            if (yuanToFen(feeYuan) === null) {
              setMessage('服务费金额格式不正确（例如 12.50）。');
              return;
            }
            submit.mutate();
          }}
        >
          <FormField label="评价类型" htmlFor="service-fee-review-type">
            <Select
              id="service-fee-review-type"
              value={reviewType}
              onChange={(event) => setReviewType(event.target.value as typeof reviewType)}
            >
              {value.fees.map((candidate) => (
                <option key={candidate.review_type} value={candidate.review_type}>
                  {SERVICE_FEE_REVIEW_TYPE_LABELS[candidate.review_type]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="服务费（元，例如 12.50）" htmlFor="service-fee-value">
            <TextInput
              id="service-fee-value"
              value={feeYuan}
              onChange={(event) => setFeeYuan(event.target.value)}
              inputMode="decimal"
              required
            />
          </FormField>
          <FormField label="生效时间（北京时间）" htmlFor="service-fee-effective">
            <TextInput
              id="service-fee-effective"
              type="datetime-local"
              value={effectiveAt}
              onChange={(event) => setEffectiveAt(event.target.value)}
              required
            />
          </FormField>
          <p className="hint">
            生效时间必须晚于当前时间；提交后需在生效前完成 Owner 确认，确认后到点即生效。
          </p>
          <Button className="danger" disabled={submit.isPending || Boolean(entry?.pending_fee)}>
            提交待确认服务费
          </Button>
        </form>
      ) : null}
      {message ? (
        <Alert tone={message.includes('未完成') || message.includes('不正确') ? 'danger' : 'success'}>
          {message}
        </Alert>
      ) : null}
    </Card>
  );
}

function PolicyError({ error, retry }: { error: unknown; retry: () => void }): React.JSX.Element {
  const code = isFrontendApiError(error) ? error.code : 'NETWORK_FAILURE';
  return (
    <Alert tone="danger">
      读取失败（{code}）。
      <Button className="secondary" onClick={retry}>
        重试
      </Button>
    </Alert>
  );
}

function baseRateErrorMessage(action: string, error: unknown): string {
  if (!isFrontendApiError(error)) return `基础汇率${action}未完成，请稍后重试。`;
  if (error.code === 'FORBIDDEN') {
    return `当前账号无权${action}订单日基础汇率（需要 Owner 且具备财务纠正权限）。`;
  }
  if (error.code === 'VERSION_CONFLICT' || error.code === 'NOT_FOUND') {
    return `基础汇率${action}未完成：数据已变化，已自动刷新，请重试。`;
  }
  return `基础汇率${action}未完成（${error.code}），请刷新后重试。`;
}

function markupLabel(value: string): string {
  const raw = BigInt(value);
  const integer = raw / 100_000_000n;
  const fraction = (raw % 100_000_000n).toString().padStart(8, '0').replace(/0+$/u, '');
  return `+${integer}.${fraction || '0'}`;
}

function rateLabel(value: string): string {
  const raw = BigInt(value);
  const integer = raw / 100_000_000n;
  const fraction = (raw % 100_000_000n).toString().padStart(8, '0').replace(/0+$/u, '');
  return `${integer}.${fraction || '0'} CNY / JPY`;
}

function chinaDate(): string {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts()
      .map((part) => [part.type, part.value]),
  );
  return `${values['year']}-${values['month']}-${values['day']}`;
}

// The rule engine refuses to confirm a version whose effective time has
// already passed, so the submit form defaults to a few minutes ahead: submit,
// confirm, and the rule becomes effective almost immediately.
function futureDateTime(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + 5 * 60 * 1000));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values['year']}-${values['month']}-${values['day']}T${values['hour']}:${values['minute']}`;
}

function parseBeijingDateTime(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return Number.NaN;
  return Date.parse(`${value}:00+08:00`);
}
