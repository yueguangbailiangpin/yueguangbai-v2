import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { isFrontendApiError } from '../../api/errors';
import { Alert, Button, Card, FormField, Select, StatusBadge, TextInput } from '../../ui/primitives';
import { staffApi } from '../api/client';
import {
  type StaffMutationRequest,
} from '../mutations/StaffMutationAuthority';
import { formatShanghai } from '../shared/format';
import { fenToYuan, futureDateTime, markupLabel, parseBeijingDateTime, rateLabel, yuanToFen } from './finance-format';

export type Policy = NonNullable<
  Awaited<ReturnType<typeof staffApi.sellerPrincipalRatePolicies>>['data']['default_policy']
>;
export type PolicyRead = Awaited<ReturnType<typeof staffApi.sellerPrincipalRatePolicies>>['data'];
export type RateCenter = Awaited<ReturnType<typeof staffApi.rateCenter>>['data'];

export function OrderDayBaseRateCard({
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
    <Card id="finance-section-base-rate" className="sensitive-action">
      <h3>基础汇率（JPY → CNY）</h3>
      <p>订单日期：{value.business_date}。买家返款和卖家本金共同使用该订单日基础汇率。</p>
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

export function PolicyFacts({ value }: { value: PolicyRead }): React.JSX.Element {
  return (
    <section id="finance-section-seller-markup" className="staff-pricing-policy-grid" aria-label="当前加点策略">
      <PolicyCard
        title="币种对默认加点"
        policy={value.default_policy}
        pending={value.default_pending_policy}
        upcoming={value.default_upcoming_policy}
        nextVersion={value.default_next_version}
      />
      <PolicyCard
        title="卖家组织专属覆盖"
        policy={value.seller_override_policy}
        pending={value.seller_override_pending_policy}
        upcoming={value.seller_override_upcoming_policy}
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
  upcoming,
  nextVersion,
}: {
  title: string;
  policy: Policy | null;
  pending: Policy | null;
  upcoming: Policy | null;
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
      {upcoming ? (
        <p className="inline-info">
          下一个变更：{markupLabel(upcoming.markup_rate_value)} ·{' '}
          {formatShanghai(upcoming.effective_from)} · v{upcoming.version_no}
        </p>
      ) : null}
    </Card>
  );
}

export function DecisionCards({
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
        <p>当前没有待决加点策略（默认加点提交即生效，只有组织专属覆盖需要确认）。</p>
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
    return `当前账号无权${action}卖家服务费（确认需要 Owner 且具备财务纠正权限；提交人不能自确）。`;
  }
  if (error.code === 'VERSION_CONFLICT' || error.code === 'NOT_FOUND') {
    return `服务费${action}未完成：数据已变化，请刷新后重试。`;
  }
  return `服务费${action}未完成（${error.code}），请刷新后重试。`;
}

export function ServiceFeeCard({
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
    <Card id="finance-section-service-fee" className="sensitive-action">
      <h3>服务费（{organizationName}）</h3>
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
          {candidate.upcoming_fee
            ? `；下一个变更：${fenToYuan(candidate.upcoming_fee.fee_cny_fen)} · ${formatShanghai(candidate.upcoming_fee.effective_from)}`
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
            生效时间必须晚于当前时间；提交后需在生效前由另一名 Owner 确认（提交人不能自确）。
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

export function PolicyError({ error, retry }: { error: unknown; retry: () => void }): React.JSX.Element {
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

export function PolicySubmitCard({
  canSubmitDefault,
  canSubmitOverride,
  selectedOrganizationId,
  isGlobalOwner,
  queryData,
  scopeType,
  setScopeType,
  markup,
  setMarkup,
  effectiveAt,
  setEffectiveAt,
  authority,
  onSubmit,
}: {
  canSubmitDefault: boolean;
  canSubmitOverride: boolean;
  selectedOrganizationId: string | null;
  isGlobalOwner: boolean;
  queryData: PolicyRead;
  scopeType: 'CURRENCY_PAIR_DEFAULT' | 'SELLER_ORGANIZATION';
  setScopeType: (value: 'CURRENCY_PAIR_DEFAULT' | 'SELLER_ORGANIZATION') => void;
  markup: string;
  setMarkup: (value: string) => void;
  effectiveAt: string;
  setEffectiveAt: (value: string) => void;
  authority: { canRetry: () => boolean };
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}): React.JSX.Element {
  return (
    <Card className="sensitive-action">
      <h3>提交新加点</h3>
      <form onSubmit={onSubmit}>
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
              ? Boolean(queryData.default_pending_policy)
              : Boolean(queryData.seller_override_pending_policy))
          }
        >
          {scopeType === 'CURRENCY_PAIR_DEFAULT' ? '提交并生效' : '提交待确认策略'}
        </Button>
      </form>
    </Card>
  );
}
