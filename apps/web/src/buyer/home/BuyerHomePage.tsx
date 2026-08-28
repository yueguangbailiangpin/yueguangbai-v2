import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  ChevronRight,
  MessageSquareCheck,
  Package,
  RefreshCw,
  ShoppingBag,
  Sparkles,
} from 'lucide-react';
import { Link } from 'react-router';
import { buyerApi } from '../api/client';
import { buyerQueryKeys, cursorQuery } from '../queries/keys';
import { formatJpy } from '../shared/format';
import { BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { marketplaceLabel } from '../shared/status';

/**
 * 买家首页（阶段 7B）：模板 buyer-home 布局 ——
 * 下一步 / 进行中的订单 / 当前可预约 + 侧栏账户摘要。
 * 不做 KPI 面板；所有数据来自既有买家端查询，
 * 未提供对接员工信息，因此不展示“需要帮助”区块。
 */

const ACTIVE_EVIDENCE_STATUSES = ['CHANGES_REQUESTED', 'PENDING_VERIFICATION'];
const ACTIVE_REVIEW_STATUSES = ['CHANGES_REQUESTED', 'PENDING_REVIEW'];
const ORDER_STEPS = ['资料确认', '付款截图', '订单审核', '评论任务', '买家返款'] as const;

type OrderCard = Readonly<{
  key: string;
  productName: string;
  meta: string;
  chipLabel: string;
  chipTone: 'amber' | 'blue' | 'green' | 'neutral';
  currentStep: number; // 0-4，进行到哪一步
  note: string;
  href: string;
}>;

function todayLabel(): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
}

export function BuyerHomePage(): React.JSX.Element {
  const client = useQueryClient();
  const me = useQuery({
    queryKey: buyerQueryKeys.me(),
    queryFn: ({ signal }) => buyerApi.me(client, signal).then((r) => r.data),
  });
  const demands = useQuery({
    queryKey: buyerQueryKeys.demandsPage({ limit: 6, cursor: null }),
    queryFn: ({ signal }) =>
      buyerApi.demands(client, cursorQuery({ limit: 6, cursor: null }), signal).then((r) => r.data),
  });
  const eligibleEvidence = useQuery({
    queryKey: buyerQueryKeys.evidenceEligiblePage({ limit: 6, cursor: null }),
    queryFn: ({ signal }) =>
      buyerApi
        .evidenceEligible(client, cursorQuery({ limit: 6, cursor: null }), signal)
        .then((r) => r.data),
  });
  const evidence = useQuery({
    queryKey: buyerQueryKeys.evidenceListPage({
      limit: 6,
      cursor: null,
      status: ACTIVE_EVIDENCE_STATUSES,
    }),
    queryFn: ({ signal }) =>
      buyerApi
        .evidenceList(
          client,
          cursorQuery({ limit: 6, cursor: null, status: ACTIVE_EVIDENCE_STATUSES }),
          signal,
        )
        .then((r) => r.data),
  });
  const eligibleReviews = useQuery({
    queryKey: buyerQueryKeys.reviewEligiblePage({ limit: 6, cursor: null }),
    queryFn: ({ signal }) =>
      buyerApi
        .reviewEligible(client, cursorQuery({ limit: 6, cursor: null }), signal)
        .then((r) => r.data),
  });
  const reviews = useQuery({
    queryKey: buyerQueryKeys.reviewsPage({
      limit: 6,
      cursor: null,
      status: ACTIVE_REVIEW_STATUSES,
    }),
    queryFn: ({ signal }) =>
      buyerApi
        .reviews(client, cursorQuery({ limit: 6, cursor: null, status: ACTIVE_REVIEW_STATUSES }), signal)
        .then((r) => r.data),
  });
  const refunds = useQuery({
    queryKey: buyerQueryKeys.refundsPage({ limit: 6, cursor: null }),
    queryFn: ({ signal }) =>
      buyerApi.refunds(client, cursorQuery({ limit: 6, cursor: null }), signal).then((r) => r.data),
  });

  if (demands.isError) return <BuyerQueryError error={demands.error} />;

  const displayName = me.data?.buyer.display_name ?? '买家';
  const uploadable = eligibleEvidence.data?.items.filter((item) =>
    item.allowed_actions.includes('SUBMIT'),
  ) ?? [];
  const reviewable = eligibleReviews.data?.items.filter((item) =>
    item.allowed_actions.includes('SUBMIT'),
  ) ?? [];
  const evidenceChanges = evidence.data?.items.filter(
    (item) => item.status === 'CHANGES_REQUESTED',
  ) ?? [];
  const reviewChanges = reviews.data?.items.filter(
    (item) => item.status === 'CHANGES_REQUESTED',
  ) ?? [];

  // 下一步：优先“需要修改”，其次“待上传付款截图”，再“待提交评论”。
  const nextStep =
    evidenceChanges[0]
      ? {
          title: '修改订单付款截图',
          detail: `${evidenceChanges[0].reservation.product_name} · 按工作人员的意见更新截图`,
          small: `订单 ${evidenceChanges[0].amazon_order_number_display}`,
          href: `/buyer/order-materials/${encodeURIComponent(evidenceChanges[0].submission_id)}`,
          action: '修改截图',
          icon: <Camera aria-hidden="true" />,
          chipLabel: '等待你修改',
        }
      : uploadable[0]
        ? {
            title: '上传订单付款截图',
            detail: `${uploadable[0].product_name} · 一笔订单一张完整截图`,
            small: `预约 ${uploadable[0].reservation_id}`,
            href: `/buyer/reservations/${encodeURIComponent(uploadable[0].reservation_id)}/instruction`,
            action: '查看下单步骤',
            icon: <Camera aria-hidden="true" />,
            chipLabel: '等待你操作',
          }
        : reviewable[0]
          ? {
              title: '提交评论资料',
              detail: `${reviewable[0].order.product_name} · 按订单要求的评论类型提交`,
              small: `订单 ${reviewable[0].order.amazon_order_number}`,
              href: `/buyer/reviews/new?formal_order_id=${encodeURIComponent(
                reviewable[0].order.formal_order_id,
              )}`,
              action: '提交评论',
              icon: <MessageSquareCheck aria-hidden="true" />,
              chipLabel: '等待你操作',
            }
          : null;

  // 进行中的订单卡片（真实状态 → 5 步迷你进度）。
  const orderCards: OrderCard[] = [
    ...uploadable.map((item): OrderCard => ({
      key: `upload-${item.reservation_id}`,
      productName: item.product_name,
      meta: item.store_display_name,
      chipLabel: '等待付款截图',
      chipTone: 'amber',
      currentStep: 1,
      note: '请先查看下单步骤，再上传一张完整付款截图',
      href: `/buyer/reservations/${encodeURIComponent(item.reservation_id)}/instruction`,
    })),
    ...evidenceChanges.map((item): OrderCard => ({
      key: `change-${item.submission_id}`,
      productName: item.reservation.product_name,
      meta: item.amazon_order_number_display,
      chipLabel: '截图需要修改',
      chipTone: 'amber',
      currentStep: 1,
      note: item.public_change_reason ?? '工作人员要求更新付款截图',
      href: `/buyer/order-materials/${encodeURIComponent(item.submission_id)}`,
    })),
    ...(evidence.data?.items ?? [])
      .filter((item) => item.status === 'PENDING_VERIFICATION')
      .map((item): OrderCard => ({
        key: `verify-${item.submission_id}`,
        productName: item.reservation.product_name,
        meta: `${item.amazon_order_number_display} · ${formatJpy(item.final_paid_jpy)}`,
        chipLabel: '订单审核中',
        chipTone: 'blue',
        currentStep: 2,
        note: '付款截图已提交，等待工作人员核验',
        href: `/buyer/order-materials/${encodeURIComponent(item.submission_id)}`,
      })),
    ...reviewChanges.map((item): OrderCard => ({
      key: `review-change-${item.review_case_id}`,
      productName: item.order.product_name,
      meta: item.order.amazon_order_number,
      chipLabel: '评论需要修改',
      chipTone: 'amber',
      currentStep: 3,
      note: item.public_change_reason ?? '工作人员要求更新评论资料',
      href: `/buyer/reviews/${encodeURIComponent(item.review_case_id)}`,
    })),
    ...(reviews.data?.items ?? [])
      .filter((item) => item.status === 'PENDING_REVIEW')
      .map((item): OrderCard => ({
        key: `review-pending-${item.review_case_id}`,
        productName: item.order.product_name,
        meta: item.order.amazon_order_number,
        chipLabel: '评论审核中',
        chipTone: 'blue',
        currentStep: 3,
        note: '评论资料已提交，等待工作人员核验',
        href: `/buyer/reviews/${encodeURIComponent(item.review_case_id)}`,
      })),
  ];
  const actionableCount =
    evidenceChanges.length + reviewChanges.length + uploadable.length + reviewable.length;
  const refundCount = refunds.data?.items.length ?? 0;
  const reservable = (demands.data?.items ?? []).filter(
    (item) => item.reservation_eligibility === 'ELIGIBLE',
  );

  const tasksPending = eligibleEvidence.isPending || evidence.isPending
    || eligibleReviews.isPending || reviews.isPending;

  return (
    <section className="mwb-page buyer-page">
      <div className="mwb-heading">
        <div>
          <p>{todayLabel()}</p>
          <h1>你好，{displayName}</h1>
          <span>你的预约、订单和返款进度都在这里。</span>
        </div>
        <Link className="mwb-primary" to="/buyer/products">
          <ShoppingBag aria-hidden="true" />
          查看可预约产品
        </Link>
      </div>

      <div className="mwb-home-grid">
        <div className="mwb-main-column">
          <section className="mwb-surface" aria-label="下一步">
            <div className="mwb-section-heading">
              <div>
                <h2>下一步</h2>
                <p>完成后订单才能继续</p>
              </div>
              {nextStep ? <span className="mwb-chip amber">{nextStep.chipLabel}</span> : null}
            </div>
            {tasksPending ? (
              <div className="mwb-next-row">
                <span className="mwb-circle blue"><RefreshCw aria-hidden="true" /></span>
                <div><h3>正在整理你的待办…</h3></div>
              </div>
            ) : nextStep ? (
              <article className="mwb-next-row">
                <span className="mwb-circle blue">{nextStep.icon}</span>
                <div>
                  <h3>{nextStep.title}</h3>
                  <p>{nextStep.detail}</p>
                  <small>{nextStep.small}</small>
                </div>
                <Link className="mwb-primary" to={nextStep.href}>{nextStep.action}</Link>
              </article>
            ) : (
              <article className="mwb-next-row">
                <span className="mwb-circle blue"><Sparkles aria-hidden="true" /></span>
                <div>
                  <h3>暂时没有需要你操作的事情</h3>
                  <p>新的预约、付款截图或评论任务会出现在这里。</p>
                </div>
              </article>
            )}
          </section>

          <section className="mwb-surface" aria-label="进行中的订单">
            <div className="mwb-section-heading">
              <div>
                <h2>进行中的订单</h2>
                <p>共 {orderCards.length} 笔</p>
              </div>
              <Link className="mwb-text" to="/buyer/orders">查看全部</Link>
            </div>
            {tasksPending ? (
              <BuyerLoading label="正在读取订单进度…" />
            ) : orderCards.length === 0 ? (
              <p className="mwb-home-empty">暂无进行中的订单，先去“产品与预约”看看可预约的商品吧。</p>
            ) : (
              orderCards.map((card, index) => (
                <Link className="mwb-order-card" key={card.key} to={card.href}>
                  <span
                    className={`mwb-product-thumb ${index % 2 === 0 ? 'warm' : 'cool'}`}
                    aria-hidden="true"
                  >
                    <Package />
                  </span>
                  <div>
                    <span className={`mwb-chip ${card.chipTone}`}>{card.chipLabel}</span>
                    <h3>{card.productName}</h3>
                    <p>{card.meta}</p>
                    <div className="mwb-mini-steps" aria-hidden="true">
                      {ORDER_STEPS.map((_, step) => (
                        <span
                          key={step}
                          className={
                            step < card.currentStep ? 'done' : step === card.currentStep ? 'current' : ''
                          }
                        />
                      ))}
                    </div>
                    <small>{card.note}</small>
                  </div>
                  <ChevronRight aria-hidden="true" />
                </Link>
              ))
            )}
          </section>

          <section className="mwb-surface" aria-label="当前可预约">
            <div className="mwb-section-heading">
              <div>
                <h2>当前可预约</h2>
                <p>根据你的账号和预约资格展示</p>
              </div>
              <Link className="mwb-text" to="/buyer/products">全部产品</Link>
            </div>
            {demands.isPending ? (
              <BuyerLoading label="正在读取产品…" />
            ) : reservable.length === 0 ? (
              <p className="mwb-home-empty">现在没有可预约的产品，上架后会第一时间显示在这里。</p>
            ) : (
              <div className="mwb-product-grid">
                {reservable.map((item, index) => (
                  <article key={item.demand_id}>
                    <div
                      className={`mwb-product-tile ${
                        ['cream', 'mint', 'lavender'][index % 3] ?? 'cream'
                      }`}
                      aria-hidden="true"
                    >
                      <Sparkles />
                    </div>
                    <span className={`mwb-chip ${item.remaining_quantity > 0 ? 'green' : 'neutral'}`}>
                      {item.remaining_quantity > 0 ? `剩余 ${item.remaining_quantity} 个名额` : '名额已满'}
                    </span>
                    <h3>{item.product_name}</h3>
                    <p>
                      {marketplaceLabel(item.marketplace_code)} · 预计自费{' '}
                      {formatJpy(item.estimated_buyer_self_pay_jpy)}
                    </p>
                    <Link className="mwb-tonal" to={`/buyer/demands/${encodeURIComponent(item.demand_id)}`}>
                      查看详情
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="mwb-side-column">
          <section className="mwb-surface" aria-label="账户摘要">
            <div className="mwb-account-head">
              <span aria-hidden="true">{displayName.slice(0, 1)}</span>
              <div>
                <strong>{me.data?.buyer.customer_number ?? displayName}</strong>
                <small>
                  {me.data?.buyer.identity_review_status === 'REVIEW_REQUIRED'
                    ? '账号待复核'
                    : '账号状态正常'}
                </small>
              </div>
            </div>
            <dl className="mwb-summary-dl">
              <div>
                <dt>进行中订单</dt>
                <dd>{orderCards.length}</dd>
              </div>
              <div>
                <dt>待完成任务</dt>
                <dd>{actionableCount}</dd>
              </div>
              <div>
                <dt>返款记录</dt>
                <dd>{refundCount}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </section>
  );
}
