import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Info, Package } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Breadcrumb } from '../../ui/primitives';
import { buyerApi } from '../api/client';
import { buyerQueryKeys } from '../queries/keys';
import {
  formatBps,
  formatCnyFen,
  formatCnyPerJpyE8,
  formatDateOnly,
  formatJpy,
  formatShanghai,
} from '../shared/format';
import { BuyerLoading, BuyerQueryError } from '../shared/BuyerStates';
import { marketplaceLabel, reviewTypeLabel } from '../shared/status';

/**
 * 正式订单详情（阶段 7B）：模板 buyer-order 布局 ——
 * 面包屑 + 状态标题、订单进度 5 步、下单指引 dl + 提示、
 * 侧栏订单摘要。订单确认后信息冻结，付款截图在
 * 订单资料阶段已上传并核验，因此这里只展示资料摘要，
 * 不再出现（也不允许出现）订单沟通截图内容。
 */
export function BuyerFormalOrderDetailPage(): React.JSX.Element {
  const { formalOrderId = '' } = useParams();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: buyerQueryKeys.formalOrder(formalOrderId),
    queryFn: ({ signal }) => buyerApi.formalOrder(client, formalOrderId, signal).then((r) => r.data.formal_order),
    enabled: formalOrderId.length > 0,
  });
  if (query.isPending) return <BuyerLoading />;
  if (query.isError) return <BuyerQueryError error={query.error} />;
  const item = query.data;
  const evidence = item.order_evidence_summary;
  return (
    <section className="mwb-page mwb-order-detail buyer-page">
      <Breadcrumb
        items={[
          { label: '我的订单', href: '/buyer/orders' },
          { label: item.formal_order_id },
        ]}
      />
      <div className="mwb-order-heading">
        <div>
          <span className="mwb-chip green">已确认</span>
          <h1>{item.product_name}</h1>
          <p>
            订单号 {item.amazon_order_number} · 下单金额 {formatJpy(item.final_paid_jpy)}
          </p>
        </div>
        <Link className="mwb-primary" to="/buyer/reviews">
          查看评论任务
        </Link>
      </div>

      <div className="mwb-order-layout">
        <div className="mwb-main-column">
          <section className="mwb-surface" aria-label="订单进度">
            <div className="mwb-section-heading">
              <div>
                <h2>订单进度</h2>
                <p>确认时间：{formatShanghai(item.confirmed_at)}</p>
              </div>
            </div>
            <div className="mwb-steps">
              <div className="done">
                <span><Check aria-hidden="true" /></span>
                <strong>资料确认</strong>
                <small>{formatShanghai(evidence.verified_at)}</small>
              </div>
              <div className="done">
                <span><Check aria-hidden="true" /></span>
                <strong>付款截图</strong>
                <small>{formatShanghai(evidence.submitted_at)}</small>
              </div>
              <div className="done">
                <span><Check aria-hidden="true" /></span>
                <strong>订单审核</strong>
                <small>{formatShanghai(item.confirmed_at)}</small>
              </div>
              <div>
                <span aria-hidden="true" />
                <strong>评论任务</strong>
                <small>在“评论任务”中跟进</small>
              </div>
              <div>
                <span aria-hidden="true" />
                <strong>买家返款</strong>
                <small>评论通过后处理</small>
              </div>
            </div>
          </section>

          <section className="mwb-surface" aria-label="下单指引">
            <div className="mwb-section-heading">
              <div>
                <h2>下单指引</h2>
                <p>已冻结的正式订单资料</p>
              </div>
              <span className="mwb-chip blue">已确认</span>
            </div>
            <dl className="mwb-instructions-dl">
              <div><dt>商品</dt><dd>{item.product_name}</dd></div>
              <div><dt>Amazon 订单号</dt><dd>{item.amazon_order_number}</dd></div>
              <div><dt>Amazon 下单日期</dt><dd>{formatDateOnly(item.amazon_order_date)}</dd></div>
              <div><dt>市场</dt><dd>{marketplaceLabel(item.marketplace)}</dd></div>
              <div><dt>评论类型</dt><dd>{reviewTypeLabel(item.review_type)}</dd></div>
              <div><dt>订单金额</dt><dd><strong>{formatJpy(item.final_paid_jpy)}</strong></dd></div>
              <div><dt>自费比例</dt><dd>{formatBps(item.buyer_self_pay_bps)}</dd></div>
              <div><dt>自费金额</dt><dd>{formatJpy(item.buyer_self_pay_jpy)}</dd></div>
              <div><dt>可返本金</dt><dd>{formatJpy(item.buyer_refundable_principal_jpy)}</dd></div>
              <div><dt>预计 CNY 本金</dt><dd>{formatCnyFen(item.buyer_expected_principal_cny_fen)}</dd></div>
              <div><dt>订单汇率</dt><dd>{formatCnyPerJpyE8(item.buyer_exchange_rate_snapshot.cny_per_jpy_e8)}</dd></div>
              <div><dt>汇率日期</dt><dd>{item.buyer_exchange_rate_snapshot.business_date}</dd></div>
            </dl>
            <div className="mwb-info-note">
              <Info aria-hidden="true" />
              <p>订单资料确认后会被冻结，不会因产品或汇率调整而变化；如发现与实际不一致，请联系工作人员核实。</p>
            </div>
          </section>
        </div>

        <aside className="mwb-side-column">
          <section className="mwb-surface mwb-order-summary" aria-label="订单摘要">
            <h2>订单摘要</h2>
            <div className="mwb-summary-product">
              <span className="mwb-product-thumb warm" aria-hidden="true"><Package /></span>
              <p>
                <strong>{item.product_name}</strong>
                <small>{marketplaceLabel(item.marketplace)}</small>
              </p>
            </div>
            <dl className="mwb-summary-dl">
              <div><dt>订单金额</dt><dd>{formatJpy(item.final_paid_jpy)}</dd></div>
              <div><dt>自费金额</dt><dd>{formatJpy(item.buyer_self_pay_jpy)}</dd></div>
              <div><dt>可返本金</dt><dd>{formatJpy(item.buyer_refundable_principal_jpy)}</dd></div>
              <div><dt>正式订单号</dt><dd>{item.formal_order_id}</dd></div>
            </dl>
          </section>
          <section className="mwb-surface mwb-order-summary" aria-label="订单资料摘要">
            <h2>付款截图</h2>
            <dl className="mwb-summary-dl">
              <div><dt>提交次数</dt><dd>{evidence.evidence_version_no}</dd></div>
              <div><dt>文件数量</dt><dd>{evidence.file_count}</dd></div>
              <div><dt>提交时间</dt><dd>{formatShanghai(evidence.submitted_at)}</dd></div>
              <div><dt>核验时间</dt><dd>{formatShanghai(evidence.verified_at)}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </section>
  );
}
