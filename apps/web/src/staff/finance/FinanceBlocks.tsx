import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { isFrontendApiError } from '../../api/errors';
import { Alert, Button, Card, FormField, Select, TextInput } from '../../ui/primitives';
import { staffApi } from '../api/client';
import { type StaffMutationRequest } from '../mutations/StaffMutationAuthority';
import { formatShanghai } from '../shared/format';
import {
  fenToYuan,
  futureDateTime,
  markupLabel,
  rateLabel,
  yuanToFen,
} from './finance-format';

export type Policy = NonNullable<
  Awaited<ReturnType<typeof staffApi.sellerPrincipalRatePolicies>>['data']['default_policy']
>;
export type PolicyRead = Awaited<ReturnType<typeof staffApi.sellerPrincipalRatePolicies>>['data'];
export type RateCenter = Awaited<ReturnType<typeof staffApi.rateCenter>>['data'];
export type ServiceFeeRead = Awaited<ReturnType<typeof staffApi.sellerServiceFees>>['data'];

export const DUAL_CONTROL_HINT =
  '自己提交的策略不能自己确认，请让提交人以外的管理员确认（全体卖家默认加点不受此限制）。';

const SERVICE_FEE_REVIEW_TYPE_LABELS: Record<string, string> = {
  RATING: '评分单',
  TEXT: '文字评论',
  IMAGE: '图片评论',
  VIDEO: '视频评论',
};

export interface PendingDecision {
  id: string;
  label: string;
  value: string;
  kind: 'markup' | 'fee';
  // Markup decisions reuse the StaffMutationAuthority flow.
  markupRequest?: StaffMutationRequest;
  feeVersionId?: string;
  feeExpectedVersion?: number;
}

/**
 * Top strip: only actionable problems — missing configuration that blocks
 * order approval, plus pending decisions waiting for this Owner.  Renders
 * nothing when everything is calm.
 */
export function FinanceAlertStrip({
  baseRateDate,
  baseRateMissing,
  feeOrgName,
  missingFeeTypes,
  pending,
  busy,
  onMarkupDecision,
  onFeeDecision,
  canDecide,
}: {
  baseRateDate: string;
  baseRateMissing: boolean;
  feeOrgName: string | null;
  missingFeeTypes: readonly string[];
  pending: readonly PendingDecision[];
  busy: boolean;
  onMarkupDecision: (request: StaffMutationRequest) => void;
  onFeeDecision: (decision: 'confirm' | 'reject', item: PendingDecision) => void;
  canDecide: boolean;
}): React.JSX.Element | null {
  const alerts: ReactNode[] = [];
  if (baseRateMissing) {
    alerts.push(
      <Alert tone="danger" key="base-rate-gap">
        订单日 {baseRateDate} 的基础汇率未确认（若更早日期已有已确认汇率，订单确认会自动回退采用）。{' '}
        <a href="#finance-section-base-rate">去设置</a>
      </Alert>,
    );
  }
  if (feeOrgName !== null && missingFeeTypes.length > 0) {
    alerts.push(
      <Alert tone="danger" key="fee-gap">
        服务费未配置：{feeOrgName} 还有 {missingFeeTypes.length}/4 类评价类型未配——
        未配齐前该组织的订单审核无法通过。 <a href="#finance-section-service-fee">去配置</a>
      </Alert>,
    );
  }
  if (canDecide) {
    for (const item of pending) {
      alerts.push(
        <Alert tone="warning" key={item.id}>
          <p>
            {item.label} · {item.value} 待你确认
          </p>
          <div className="entry-actions">
            <Button
              className="danger"
              disabled={busy}
              onClick={() =>
                item.kind === 'markup' && item.markupRequest
                  ? onMarkupDecision(item.markupRequest)
                  : onFeeDecision('confirm', item)
              }
            >
              确认生效
            </Button>
            <Button
              className="secondary"
              disabled={busy}
              onClick={() =>
                item.kind === 'markup' && item.markupRequest
                  ? onMarkupDecision({
                      ...item.markupRequest,
                      action: 'reject',
                      path: item.markupRequest.path.replace('/confirm', '/reject'),
                      body: {
                        expected_version: (item.markupRequest.body as { expected_version: number })
                          .expected_version,
                        rejection_reason: 'Owner 在 Staff 工作台拒绝',
                      },
                    })
                  : onFeeDecision('reject', item)
              }
            >
              拒绝
            </Button>
          </div>
        </Alert>,
      );
    }
  } else if (pending.length > 0) {
    alerts.push(
      <Alert tone="info" key="pending-readonly">
        {pending.length} 条变更待管理员确认后生效。
      </Alert>,
    );
  }
  if (alerts.length === 0) return null;
  return <section className="staff-finance-strip" aria-label="待处理">{alerts}</section>;
}

/** 3,000 JPY — the fixed illustrative order used across the example card. */
const EXAMPLE_ORDER_JPY = 3_000n;

function jpyTimesRateToFen(jpy: bigint, rateE8: bigint): bigint {
  const scaled = jpy * rateE8 * 100n;
  return (scaled + 50_000_000n) / 100_000_000n;
}

/**
 * The comprehension anchor of the page: what is effective today, and what it
 * means for a concrete order — how much the buyer gets back, the seller
 * receives, and the platform earns.
 */
export function FinanceExampleCard({
  baseRate,
  markup,
  markupScopeLabel,
  feeFen,
  feeNote,
  dateLabel,
}: {
  baseRate: string | null;
  markup: string | null;
  markupScopeLabel: string;
  feeFen: string | null;
  feeNote: string | null;
  dateLabel: string;
}): React.JSX.Element {
  const baseE8 = baseRate === null ? null : BigInt(baseRate);
  const markupE8 = markup === null ? null : BigInt(markup);
  const buyerFen = baseE8 === null ? null : jpyTimesRateToFen(EXAMPLE_ORDER_JPY, baseE8);
  const sellerFen =
    baseE8 === null || markupE8 === null
      ? null
      : jpyTimesRateToFen(EXAMPLE_ORDER_JPY, baseE8 + markupE8);
  const profitFen =
    sellerFen !== null && feeFen !== null
      ? sellerFen + BigInt(feeFen) - (buyerFen ?? 0n)
      : null;
  return (
    <Card className="customer-visible" id="finance-section-summary">
      <h3>{dateLabel}生效</h3>
      <p>
        基础汇率 {baseRate === null ? <span className="inline-warning">未确认</span> : rateLabel(baseRate)}
        {' · '}加点{' '}
        {markup === null ? (
          <span className="inline-warning">未配置</span>
        ) : (
          `${markupScopeLabel} ${markupLabel(markup)}`
        )}
        {' · '}服务费 {feeFen === null ? <span className="inline-warning">未配置</span> : fenToYuan(feeFen)}
        {feeNote === null ? '' : <span className="inline-info">（{feeNote}）</span>}
      </p>
      <div className="staff-finance-example">
        <p className="hint">一单 ¥{EXAMPLE_ORDER_JPY.toLocaleString('zh-CN')} 日元（评分单）为例：</p>
        <p>
          买家返 {buyerFen === null ? '¥—' : fenToYuan(buyerFen.toString())}
          {' ｜ '}卖家收 {sellerFen === null ? '¥—' : fenToYuan(sellerFen.toString())}
          {' ｜ '}服务费 {feeFen === null ? '¥—' : fenToYuan(feeFen)}
        </p>
        <p>
          平台毛利{' '}
          {profitFen === null ? (
            <span className="inline-warning">配齐后自动显示</span>
          ) : (
            <strong>{fenToYuan(profitFen.toString())}</strong>
          )}
        </p>
      </div>
      <p className="hint">订单确认时冻结这三项，之后的修改不影响已确认订单。</p>
    </Card>
  );
}

export function BaseRateBlock({
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
  const [open, setOpen] = useState(false);
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
      setMessage('已提交，等待确认。');
      setOpen(false);
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
      setMessage('已确认。');
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
    <Card id="finance-section-base-rate" className="sensitive-action staff-finance-config-block">
      <h3>基础汇率（JPY → CNY）· {value.business_date}</h3>
      <div className="staff-finance-config-row">
        <span className="kind">当日汇率</span>
        <strong>{confirmed ? rateLabel(confirmed.cny_per_jpy_e8) : <span className="inline-warning">未确认</span>}</strong>
        {pending ? (
          <span className="inline-info">待确认 {rateLabel(pending.cny_per_jpy_e8)}</span>
        ) : null}
        {canConfirm && pending ? (
          <Button className="danger" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
            确认
          </Button>
        ) : null}
        {canSubmit && !confirmed ? (
          <Button className="secondary" onClick={() => setOpen((previous) => !previous)}>
            {open ? '收起' : pending ? '重新填写' : '设置'}
          </Button>
        ) : null}
      </div>
      {open && canSubmit && !confirmed ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit.mutate();
          }}
        >
          <FormField
            label="基础汇率（1 日元 = ? 人民币，最多 8 位小数）"
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
          <p className="hint">提交后需管理员确认；每天只需确认一次，缺当日汇率时订单会自动回退最近一个已生效汇率。</p>
          <Button disabled={submit.isPending}>提交待确认</Button>
        </form>
      ) : null}
      {message ? (
        <Alert tone={message.includes('未完成') ? 'danger' : 'success'}>{message}</Alert>
      ) : null}
    </Card>
  );
}

export function MarkupBlock({
  value,
  isGlobalOwner,
  selectedOrgName,
  selectedOrgId,
  canSubmitDefault,
  canSubmitOverride,
  busy,
  onSubmit,
}: {
  value: PolicyRead;
  isGlobalOwner: boolean;
  selectedOrgName: string | null;
  selectedOrgId: string | null;
  canSubmitDefault: boolean;
  canSubmitOverride: boolean;
  busy: boolean;
  onSubmit: (
    scope: 'CURRENCY_PAIR_DEFAULT' | 'SELLER_ORGANIZATION',
    input: { markup: string; effectiveAt: string },
  ) => void;
}): React.JSX.Element {
  const [openDefault, setOpenDefault] = useState(false);
  const [openOverride, setOpenOverride] = useState(false);
  const [defaultMarkup, setDefaultMarkup] = useState('0.004');
  const [overrideMarkup, setOverrideMarkup] = useState('0.004');
  const [defaultAt, setDefaultAt] = useState(() => futureDateTime());
  const [overrideAt, setOverrideAt] = useState(() => futureDateTime());
  const submitDefault = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmit('CURRENCY_PAIR_DEFAULT', { markup: defaultMarkup, effectiveAt: defaultAt });
  };
  const submitOverride = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmit('SELLER_ORGANIZATION', { markup: overrideMarkup, effectiveAt: overrideAt });
  };
  return (
    <Card id="finance-section-seller-markup" className="staff-finance-config-block">
      <h3>加点（在基础汇率上加收的部分）</h3>
      <div className="staff-finance-config-row">
        <span className="kind">全体卖家</span>
        <strong>
          {value.default_policy ? markupLabel(value.default_policy.markup_rate_value) : <span className="inline-warning">未设置</span>}
        </strong>
        {value.default_upcoming_policy ? (
          <span className="inline-info">
            待生效 {markupLabel(value.default_upcoming_policy.markup_rate_value)} ·{' '}
            {formatShanghai(value.default_upcoming_policy.effective_from)} 起
          </span>
        ) : null}
        {canSubmitDefault ? (
          <Button className="secondary" onClick={() => setOpenDefault((previous) => !previous)}>
            {openDefault ? '收起' : '修改'}
          </Button>
        ) : null}
      </div>
      {openDefault && canSubmitDefault && !value.default_pending_policy ? (
        <form onSubmit={submitDefault}>
          <FormField label="加点（例如 +0.004 或 0）" htmlFor="finance-default-markup">
            <TextInput
              id="finance-default-markup"
              value={defaultMarkup}
              onChange={(event) => setDefaultMarkup(event.target.value)}
              inputMode="decimal"
              required
            />
          </FormField>
          <FormField label="生效时间（默认 5 分钟后）" htmlFor="finance-default-markup-at">
            <TextInput
              id="finance-default-markup-at"
              type="datetime-local"
              value={defaultAt}
              onChange={(event) => setDefaultAt(event.target.value)}
              required
            />
          </FormField>
          <p className="hint">全体卖家的加点提交后立即确认，到生效时间自动生效，无需他人确认。</p>
          <Button className="danger" disabled={busy}>
            提交并生效
          </Button>
        </form>
      ) : null}
      {selectedOrgId !== null ? (
        <>
          <div className="staff-finance-config-row">
            <span className="kind">{selectedOrgName ?? selectedOrgId} 单独</span>
            <strong>
              {value.seller_override_policy ? (
                markupLabel(value.seller_override_policy.markup_rate_value)
              ) : (
                <span className="inline-info">未单独设置（用全体值）</span>
              )}
            </strong>
            {value.seller_override_pending_policy ? (
              <span className="inline-warning">待确认（页面顶部处理）</span>
            ) : null}
            {value.seller_override_upcoming_policy ? (
              <span className="inline-info">
                待生效 {markupLabel(value.seller_override_upcoming_policy.markup_rate_value)} ·{' '}
                {formatShanghai(value.seller_override_upcoming_policy.effective_from)} 起
              </span>
            ) : null}
            {canSubmitOverride && !value.seller_override_pending_policy ? (
              <Button className="secondary" onClick={() => setOpenOverride((previous) => !previous)}>
                {openOverride ? '收起' : '单独设置'}
              </Button>
            ) : null}
          </div>
          {openOverride && canSubmitOverride && !value.seller_override_pending_policy ? (
            <form onSubmit={submitOverride}>
              <FormField label="加点（例如 +0.005 或 0）" htmlFor="finance-override-markup">
                <TextInput
                  id="finance-override-markup"
                  value={overrideMarkup}
                  onChange={(event) => setOverrideMarkup(event.target.value)}
                  inputMode="decimal"
                  required
                />
              </FormField>
              <FormField label="生效时间（默认 5 分钟后）" htmlFor="finance-override-markup-at">
                <TextInput
                  id="finance-override-markup-at"
                  type="datetime-local"
                  value={overrideAt}
                  onChange={(event) => setOverrideAt(event.target.value)}
                  required
                />
              </FormField>
              <p className="hint">单独设置需另一名管理员确认后才会生效；提交人不能自己确认（含 Owner）。</p>
              <Button className="danger" disabled={busy}>
                提交待确认
              </Button>
            </form>
          ) : null}
        </>
      ) : isGlobalOwner ? (
        <p className="hint">在上方选择某个卖家组织后，可为它单独设置加点。</p>
      ) : null}
    </Card>
  );
}

export function ServiceFeeBlock({
  organizationId,
  organizationName,
  value,
  canSubmit,
  refresh,
}: {
  organizationId: string;
  organizationName: string;
  value: ServiceFeeRead;
  canSubmit: boolean;
  refresh: () => Promise<void>;
}): React.JSX.Element {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reviewType, setReviewType] = useState<'RATING' | 'TEXT' | 'IMAGE' | 'VIDEO'>('RATING');
  const [feeYuan, setFeeYuan] = useState('');
  const [effectiveAt, setEffectiveAt] = useState(() => futureDateTime());
  const [message, setMessage] = useState<string | null>(null);
  const entry = value.fees.find((candidate) => candidate.review_type === reviewType);
  const submit = useMutation({
    mutationFn: () => {
      const fen = yuanToFen(feeYuan);
      const effective = Date.parse(`${effectiveAt}:00+08:00`);
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
      setMessage('已提交，等待确认。');
      setOpen(false);
      await refresh();
    },
    onError: (error) =>
      setMessage(
        isFrontendApiError(error) && error.code === 'FORBIDDEN'
          ? DUAL_CONTROL_HINT
          : serviceFeeErrorMessage('提交', error),
      ),
  });
  return (
    <Card id="finance-section-service-fee" className="sensitive-action staff-finance-config-block">
      <h3>服务费 · {organizationName}（按评价类型，一单收多少）</h3>
      {value.fees.map((candidate) => (
        <div className="staff-finance-config-row" key={candidate.review_type}>
          <span className="kind">{SERVICE_FEE_REVIEW_TYPE_LABELS[candidate.review_type]}</span>
          <strong>
            {candidate.effective_fee ? fenToYuan(candidate.effective_fee.fee_cny_fen) : <span className="inline-warning">未配置</span>}
          </strong>
          {candidate.pending_fee ? (
            <span className="inline-warning">待确认 {fenToYuan(candidate.pending_fee.fee_cny_fen)}</span>
          ) : null}
          {candidate.upcoming_fee ? (
            <span className="inline-info">
              待生效 {fenToYuan(candidate.upcoming_fee.fee_cny_fen)} ·{' '}
              {formatShanghai(candidate.upcoming_fee.effective_from)} 起
            </span>
          ) : null}
          {canSubmit && !candidate.pending_fee ? (
            <Button
              className="secondary"
              onClick={() => {
                setReviewType(candidate.review_type);
                setOpen((previous) => !previous);
              }}
            >
              {open && reviewType === candidate.review_type ? '收起' : candidate.effective_fee ? '修改' : '设置'}
            </Button>
          ) : null}
        </div>
      ))}
      {open && canSubmit ? (
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
          <FormField label="生效时间（默认 5 分钟后）" htmlFor="service-fee-effective">
            <TextInput
              id="service-fee-effective"
              type="datetime-local"
              value={effectiveAt}
              onChange={(event) => setEffectiveAt(event.target.value)}
              required
            />
          </FormField>
          <p className="hint">需另一名管理员确认后生效；提交人不能自己确认（含 Owner）。</p>
          <Button className="danger" disabled={submit.isPending || Boolean(entry?.pending_fee)}>
            提交待确认
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
    return `当前账号无权${action}基础汇率（需要 Owner 且具备财务纠正权限）。`;
  }
  if (error.code === 'VERSION_CONFLICT' || error.code === 'NOT_FOUND') {
    return `基础汇率${action}未完成：数据已变化，已自动刷新，请重试。`;
  }
  return `基础汇率${action}未完成（${error.code}），请刷新后重试。`;
}

function serviceFeeErrorMessage(action: string, error: unknown): string {
  if (!isFrontendApiError(error)) return `服务费${action}未完成，请稍后重试。`;
  if (error.code === 'FORBIDDEN') {
    return `当前账号无权${action}服务费。`;
  }
  if (error.code === 'VERSION_CONFLICT' || error.code === 'NOT_FOUND') {
    return `服务费${action}未完成：数据已变化，请刷新后重试。`;
  }
  return `服务费${action}未完成（${error.code}），请刷新后重试。`;
}
