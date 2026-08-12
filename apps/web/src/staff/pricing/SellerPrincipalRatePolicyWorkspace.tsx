import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { isFrontendApiError } from '../../api/errors';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import { Alert, Button, Card, FormField, RequestIdDisplay, Select, StatusBadge, TextInput } from '../../ui/primitives';
import { staffApi } from '../api/client';
import { staffWorkbenchKeys } from '../queries/keys';
import { StaffMutationAuthority, type StaffMutationRequest } from '../mutations/StaffMutationAuthority';
import { formatShanghai } from '../shared/format';

type Policy = NonNullable<Awaited<ReturnType<typeof staffApi.sellerPrincipalRatePolicies>>['data']['default_policy']>;
type PolicyRead = Awaited<ReturnType<typeof staffApi.sellerPrincipalRatePolicies>>['data'];
type PolicyMutationResult = Awaited<ReturnType<typeof staffApi.submitSellerPrincipalRatePolicy>>;

export function SellerPrincipalRatePolicyWorkspace(): React.JSX.Element {
  const session = useCurrentStaffSession();
  const client = useQueryClient();
  const [organizationId, setOrganizationId] = useState(session.data_scope.sellerOrganizationIds[0] ?? '');
  const canRead = (session.role.code === 'owner' || session.role.code === 'seller_ops')
    && session.permissions.includes('SELLER_MANAGE');
  const hasManage = session.permissions.includes('SELLER_MANAGE');
  const isGlobalOwner = session.role.code === 'owner'
    && hasManage
    && session.data_scope.type === 'GLOBAL';
  const canSubmitOverride = organizationId.length > 0
    && hasManage
    && (isGlobalOwner
      || (session.role.code === 'seller_ops'
        && session.data_scope.sellerOrganizationIds.includes(organizationId)));
  const canSubmitDefault = isGlobalOwner;
  const canDecide = session.role.code === 'owner' && session.permissions.includes('FINANCIAL_CORRECT');
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
  const query = useQuery({
    queryKey: staffWorkbenchKeys.sellerPrincipalRatePolicies(session.authorization_version, selectedOrganizationId),
    queryFn: ({ signal }) => staffApi.sellerPrincipalRatePolicies(
      client, sourceCurrencyCode, selectedOrganizationId, signal,
    ).then((response) => response.data),
    enabled: canRead && (isGlobalOwner || selectedOrganizationId !== null),
    retry: false,
  });

  async function execute(request: StaffMutationRequest | null): Promise<void> {
    setMessage(null); setRequestId(null);
    try {
      const response = request === null ? await authority.retry() : await authority.execute(
        request,
        ({ action, path, body }, key) => action === 'submit'
          ? staffApi.submitSellerPrincipalRatePolicy(client, body, key)
          : action === 'confirm'
            ? staffApi.confirmSellerPrincipalRatePolicy(client, path.split('/').at(-2)!, body, key)
            : staffApi.rejectSellerPrincipalRatePolicy(client, path.split('/').at(-2)!, body, key),
      );
      setRequestId(response.requestId);
      setMessage('策略操作已记录；正式订单只会使用确认时可解析到的生效策略。');
      await query.refetch();
    } catch (error) {
      setRequestId(isFrontendApiError(error) ? error.requestId : null);
      setMessage(isFrontendApiError(error) ? `操作未完成（${error.code}），请刷新后重试。` : '操作未完成，请稍后重试。');
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const canSubmit = scopeType === 'CURRENCY_PAIR_DEFAULT'
      ? canSubmitDefault
      : canSubmitOverride;
    if (!query.data || !canSubmit) return;
    if (scopeType === 'SELLER_ORGANIZATION' && selectedOrganizationId === null) return;
    const currentVersion = scopeType === 'CURRENCY_PAIR_DEFAULT'
      ? query.data.default_next_version - 1
      : query.data.seller_override_next_version === null
        ? null
        : query.data.seller_override_next_version - 1;
    if (currentVersion === null) return;
    const pending = scopeType === 'CURRENCY_PAIR_DEFAULT'
      ? query.data.default_pending_policy : query.data.seller_override_pending_policy;
    if (pending) return;
    const effective = parseBeijingDateTime(effectiveAt);
    if (!Number.isSafeInteger(effective)) {
      setMessage('生效时间格式不正确。');
      return;
    }
    execute({
      action: 'submit', path: '/api/staff/seller-principal-rate-policies/submit',
      body: {
        scope_type: scopeType,
        seller_organization_id: scopeType === 'CURRENCY_PAIR_DEFAULT'
          ? null
          : selectedOrganizationId,
        source_currency_code: sourceCurrencyCode,
        markup_rate_value: markup.trim(), effective_from: effective,
        expected_version: currentVersion,
      },
    });
  }

  if (!canRead) return <main className="staff-pricing-workspace">
    <Alert tone="danger">当前员工没有此权限，后端会拒绝访问。</Alert>
  </main>;
  return <main className="staff-pricing-workspace">
    <section aria-labelledby="seller-principal-rate-title">
      <p className="eyebrow">财务配置 · 仅 Staff</p><h2 id="seller-principal-rate-title">卖家本金汇率策略</h2>
      <Alert tone="warning">“卖家本金汇率加点”是绝对汇率增量，不是百分比。确认后的策略按生效时间作用于新正式订单，历史快照不回写。</Alert>
      <form className="staff-filter-grid" onSubmit={(event) => { event.preventDefault(); void query.refetch(); }}>
        <FormField label="卖家组织编号" htmlFor="principal-rate-organization"><TextInput
          id="principal-rate-organization" value={organizationId} onChange={(event) => {
            const value = event.target.value.trim();
            setOrganizationId(value);
            if (value.length === 0 && isGlobalOwner) {
              setScopeType('CURRENCY_PAIR_DEFAULT');
            }
          }}
          placeholder={isGlobalOwner ? '配置默认加点时可留空' : '输入已授权的组织编号'}
          required={!isGlobalOwner} /></FormField>
        <FormField label="币种对" htmlFor="principal-rate-source"><Select id="principal-rate-source" value={sourceCurrencyCode} onChange={(event) => setSourceCurrencyCode(event.target.value)}>
          <option value="JPY">JPY → CNY</option>
        </Select></FormField>
        <Button type="submit" className="secondary" disabled={(!isGlobalOwner && !organizationId) || query.isFetching}>读取策略</Button>
      </form>
    </section>
    {query.isPending ? <p role="status">正在读取策略事实</p>
      : query.isError ? <PolicyError error={query.error} retry={() => { void query.refetch(); }} />
      : query.data ? <>
        <PolicyFacts value={query.data} />
        {(canSubmitDefault || canSubmitOverride) ? <Card className="sensitive-action"><h3>提交新策略</h3>
          <form onSubmit={submit}>
            <FormField label="策略范围" htmlFor="principal-rate-scope"><Select id="principal-rate-scope" value={scopeType} onChange={(event) => setScopeType(event.target.value as typeof scopeType)}>
              {canSubmitDefault ? <option value="CURRENCY_PAIR_DEFAULT">币种对默认加点</option> : null}
              {selectedOrganizationId !== null || !isGlobalOwner
                ? <option value="SELLER_ORGANIZATION">卖家组织专属覆盖</option>
                : null}
            </Select></FormField>
            <FormField label="卖家本金汇率加点（例如 +0.004 或 0）" htmlFor="principal-rate-markup"><TextInput id="principal-rate-markup" value={markup} onChange={(event) => setMarkup(event.target.value)} inputMode="decimal" required /></FormField>
            <FormField label="生效时间（北京时间）" htmlFor="principal-rate-effective"><TextInput id="principal-rate-effective" type="datetime-local" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} required /></FormField>
            <Button className="danger" disabled={authority.canRetry()
              || (scopeType === 'CURRENCY_PAIR_DEFAULT' ? !canSubmitDefault : !canSubmitOverride)
              || (scopeType === 'CURRENCY_PAIR_DEFAULT' ? Boolean(query.data.default_pending_policy) : Boolean(query.data.seller_override_pending_policy))}>提交待确认策略</Button>
          </form>
        </Card> : null}
        {canDecide ? <DecisionCards value={query.data} execute={execute} busy={authority.canRetry()} /> : null}
      </> : <Alert tone="info">请输入已授权的卖家组织编号读取默认与覆盖策略。</Alert>}
    {message ? <Alert tone={message.includes('未完成') ? 'danger' : 'success'}>{message}</Alert> : null}
    <RequestIdDisplay requestId={requestId} />
  </main>;
}

function PolicyFacts({ value }: { value: PolicyRead }): React.JSX.Element {
  return <section className="staff-pricing-policy-grid" aria-label="当前策略">
    <PolicyCard title="币种对默认加点" policy={value.default_policy} pending={value.default_pending_policy} nextVersion={value.default_next_version} />
    <PolicyCard title="卖家组织专属覆盖" policy={value.seller_override_policy} pending={value.seller_override_pending_policy} nextVersion={value.seller_override_next_version} />
    <Card className="customer-visible"><h3>确认时采用</h3><p>{value.selected_policy ? `${value.selected_policy.scope_type === 'SELLER_ORGANIZATION' ? '卖家组织覆盖' : '币种对默认'} · ${markupLabel(value.selected_policy.markup_rate_value)} · v${value.selected_policy.version_no}` : '当前没有已生效策略'}</p></Card>
  </section>;
}

function PolicyCard({ title, policy, pending, nextVersion }: { title: string; policy: Policy | null; pending: Policy | null; nextVersion: number | null }): React.JSX.Element {
  return <Card className="customer-visible"><h3>{title}</h3><p>下一版本：{nextVersion === null ? '选择组织后读取' : `v${nextVersion}`}</p>
    {policy ? <><StatusBadge tone={policy.status === 'CONFIRMED' ? 'success' : 'neutral'}>{policy.status === 'CONFIRMED' ? '已确认' : policy.status}</StatusBadge><p>加点：{markupLabel(policy.markup_rate_value)} · 生效：{formatShanghai(policy.effective_from)}</p><p>版本 v{policy.version_no} · 确认：{policy.confirmed_at === null ? '—' : formatShanghai(policy.confirmed_at)}</p></> : <p>暂无当前生效策略</p>}
    {pending ? <p className="inline-warning">待 Owner 决策：{markupLabel(pending.markup_rate_value)} · {formatShanghai(pending.effective_from)} · v{pending.version_no}</p> : null}
  </Card>;
}

function DecisionCards({ value, execute, busy }: { value: PolicyRead; execute: (request: StaffMutationRequest | null) => Promise<void>; busy: boolean }): React.JSX.Element {
  const pending = [value.default_pending_policy, value.seller_override_pending_policy].filter((item): item is Policy => item !== null);
  return <Card className="sensitive-action"><h3>Owner 确认 / 拒绝</h3>{pending.length === 0 ? <p>当前没有待决策略。</p> : pending.map((policy) => <section key={policy.policy_version_id}><p><strong>{policy.scope_type === 'CURRENCY_PAIR_DEFAULT' ? '币种对默认' : '卖家组织覆盖'}</strong> · {markupLabel(policy.markup_rate_value)} · v{policy.version_no}</p><div className="entry-actions"><Button className="danger" disabled={busy} onClick={() => execute({ action: 'confirm', path: `/api/staff/seller-principal-rate-policies/${encodeURIComponent(policy.policy_version_id)}/confirm`, body: { expected_version: policy.decision_version } })}>确认生效策略</Button><Button className="secondary" disabled={busy} onClick={() => execute({ action: 'reject', path: `/api/staff/seller-principal-rate-policies/${encodeURIComponent(policy.policy_version_id)}/reject`, body: { expected_version: policy.decision_version, rejection_reason: 'Owner 在 Staff 工作台拒绝' } })}>拒绝</Button></div></section>)}</Card>;
}

function PolicyError({ error, retry }: { error: unknown; retry: () => void }): React.JSX.Element {
  const code = isFrontendApiError(error) ? error.code : 'NETWORK_FAILURE';
  return <Alert tone="danger">读取失败（{code}）。<Button className="secondary" onClick={retry}>重试</Button></Alert>;
}

function markupLabel(value: string): string {
  const raw = BigInt(value);
  const integer = raw / 100_000_000n;
  const fraction = (raw % 100_000_000n).toString().padStart(8, '0').replace(/0+$/u, '');
  return `+${integer}.${fraction || '0'}`;
}

function futureDateTime(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values['year']}-${values['month']}-${values['day']}T${values['hour']}:${values['minute']}`;
}

function parseBeijingDateTime(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return Number.NaN;
  return Date.parse(`${value}:00+08:00`);
}
