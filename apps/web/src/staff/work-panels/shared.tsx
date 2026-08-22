import { useState } from 'react';
import { isFrontendApiError } from '../../api/errors';
import { Alert, Card, StatusBadge } from '../../ui/primitives';
import type { StaffWorkItem } from '../contracts/runtime';

export const workTypeLabels: Record<StaffWorkItem['work_type'], string> = {
  PRODUCT_APPLICATION_REVIEW: '商品申请审核',
  DEMAND_REVIEW: '需求审核',
  RESERVATION_DECISION: '预约处理',
  ORDER_INSTRUCTION_PUBLISH: '下单指引发布',
  ORDER_EVIDENCE_REVIEW: '订单资料核对',
  REVIEW_DECISION: '评论审核',
  BUYER_REFUND_PROCESSING: '买家返款',
};

export function PaneTitle({ item }: { item: StaffWorkItem }): React.JSX.Element {
  return (
    <div className="pane-heading">
      <div>
        <p className="eyebrow">业务事实与证据</p>
        <h2>{workTypeLabels[item.work_type]}</h2>
      </div>
      <StatusBadge tone={item.status === 'OPEN' ? 'processing' : 'success'}>
        {item.status === 'OPEN' ? '待处理' : '已完成'}
      </StatusBadge>
    </div>
  );
}

export function CustomerContext({ item }: { item: StaffWorkItem }): React.JSX.Element {
  return (
    <Card className="staff-current-customer">
      <h3>当前客户</h3>
      {item.buyer_customer_id ? (
        <>
          <Fact label="买家" value={item.buyer_customer_id} />
          <Fact label="业务范围" value="按当前 Marketplace 权限过滤" />
        </>
      ) : item.seller_organization_id ? (
        <>
          <Fact label="卖家组织" value={item.seller_organization_id} />
          <Fact label="业务范围" value="按当前 Marketplace 权限过滤" />
        </>
      ) : (
        <Fact label="来源" value={item.source_entity_id} />
      )}
    </Card>
  );
}

export function Audit(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Card className="staff-audit-collapsed">
      <button type="button" className="audit-toggle" onClick={() => setOpen((value) => !value)}>
        操作记录 <span>{open ? '收起' : '展开'}</span>
      </button>
      {open ? (
        <div className="audit-list">
          <p>当前页面只展示已冻结的操作结果；完整审计事实由后端 Audit Log 保存。</p>
        </div>
      ) : null}
    </Card>
  );
}

export function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <dl className="fact-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </dl>
  );
}

export function PanelMutationState({
  error,
}: {
  error: unknown;
}): React.JSX.Element | null {
  if (error) {
    if (isFrontendApiError(error)) {
      const request = error.requestId ? `；请求编号：${error.requestId}` : '';
      return (
        <Alert tone="danger">
          操作失败（错误码：{error.code}
          {request}）。请按提示检查后重试。
        </Alert>
      );
    }
    return <Alert tone="danger">操作失败（错误码：UNKNOWN）。请刷新后重试。</Alert>;
  }
  return null;
}
