import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { identityApiRequest } from '../../api/identity-request';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import { Button, EmptyState } from '../../ui/primitives';
import type { StaffWorkItem } from '../contracts/runtime';
import { SellerSettlementPanel, sellerSettlementCapabilities } from '../SellerSettlementPanel';
import { staffWorkbenchKeys } from '../queries/keys';
import { StaffPanelError } from '../shared/StaffPanelError';
import { DemandReviewPanel } from './DemandReviewPanel';
import { OrderEvidenceReviewPanel } from './OrderEvidenceReviewPanel';
import { OrderInstructionPublishPanel } from './OrderInstructionPublishPanel';
import { ProductApplicationReviewPanel } from './ProductApplicationReviewPanel';
import { ReservationDecisionPanel } from './ReservationDecisionPanel';
import { ReviewDecisionPanel } from './ReviewDecisionPanel';

const workItemDetailSchema = z
  .object({
    work_item: z
      .object({
        work_item_id: z.string(),
        work_type: z.enum([
          'PRODUCT_APPLICATION_REVIEW',
          'DEMAND_REVIEW',
          'RESERVATION_DECISION',
          'ORDER_INSTRUCTION_PUBLISH',
          'ORDER_EVIDENCE_REVIEW',
          'REVIEW_DECISION',
          'BUYER_REFUND_PROCESSING',
        ]),
        source_entity_type: z.string(),
        source_entity_id: z.string(),
        buyer_customer_id: z.string().nullable(),
        seller_organization_id: z.string().nullable(),
        store_id: z.string().nullable(),
        assigned_staff_id: z.string(),
        status: z.enum(['OPEN', 'COMPLETED', 'CANCELLED']),
        version: z.number().int().positive(),
        created_at: z.number().int(),
        updated_at: z.number().int(),
        completed_at: z.number().int().nullable(),
        cancelled_at: z.number().int().nullable(),
      })
      .passthrough(),
  })
  .passthrough();

/** /staff/work/:workItemId — 按待办类型分发到处理面板。 */
export function WorkItemPage(): React.JSX.Element {
  const client = useQueryClient();
  const navigate = useNavigate();
  const params = useParams();
  const workItemId = params['workItemId'];
  const session = useCurrentStaffSession();
  const effectiveScopeFingerprint = JSON.stringify({
    role: session.role.code,
    permissions: [...session.permissions].sort(),
    data_scope: {
      type: session.data_scope.type,
      marketplaceCodes: [...session.data_scope.marketplaceCodes].sort(),
      buyerCustomerIds: [...session.data_scope.buyerCustomerIds].sort(),
      sellerOrganizationIds: [...session.data_scope.sellerOrganizationIds].sort(),
      teamIds: [...session.data_scope.teamIds].sort(),
    },
  });
  const query = useQuery({
    queryKey: [
      ...staffWorkbenchKeys.workItem(workItemId ?? ''),
      session.staff_id,
      session.authorization_version,
      effectiveScopeFingerprint,
    ],
    enabled: Boolean(workItemId),
    queryFn: ({ signal }) =>
      identityApiRequest('staff', client, {
        path: `/api/staff/me/work-items/${encodeURIComponent(workItemId!)}`,
        method: 'GET',
        schema: workItemDetailSchema,
        signal,
      }).then((response) => response.data.work_item as StaffWorkItem),
    retry: false,
    staleTime: 0,
  });
  const settlementVisible = useMemo(
    () =>
      Boolean(query.data?.seller_organization_id) &&
      sellerSettlementCapabilities(session).canView,
    [query.data, session],
  );
  function onCompleted(): void {
    // 命令响应已确认成功：只失效队列缓存并返回任务队列。
    // 不得失效详情前缀（root），否则正在卸载的面板会把已完成的审核事实
    // 再读一次，后端按已完工作项返回 404，把成功显示成失败。
    void client.invalidateQueries({ queryKey: staffWorkbenchKeys.queueRoot });
    void navigate('/staff');
  }
  if (!workItemId)
    return (
      <main className="sp-detail-sections">
        <section style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <EmptyState title="缺少待办编号" description="请从任务队列重新进入。" />
        </section>
      </main>
    );
  if (query.isPending)
    return (
      <main className="sp-detail-sections">
        <section style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <p role="status">正在加载待办</p>
        </section>
      </main>
    );
  if (query.isError)
    return (
      <main className="sp-detail-sections">
        <section style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <StaffPanelError
            error={query.error}
            retry={() => {
              void query.refetch();
            }}
          />
        </section>
      </main>
    );
  const item = query.data;
  if (item.status !== 'OPEN')
    return (
      <main className="sp-detail-sections">
        <section style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <EmptyState
            title={item.status === 'COMPLETED' ? '该待办已处理完成' : '该待办已取消'}
            description="已完成或已取消的工作项不再展示处理面板。"
          />
          <Button className="secondary" onClick={() => void navigate('/staff')}>
            返回任务队列
          </Button>
        </section>
      </main>
    );
  return (
    <main className="sp-detail-sections">
      {item.work_type === 'PRODUCT_APPLICATION_REVIEW' ? (
        <ProductApplicationReviewPanel item={item} onCompleted={onCompleted} />
      ) : item.work_type === 'DEMAND_REVIEW' ? (
        <DemandReviewPanel item={item} onCompleted={onCompleted} />
      ) : item.work_type === 'RESERVATION_DECISION' ? (
        <ReservationDecisionPanel item={item} onCompleted={onCompleted} />
      ) : item.work_type === 'ORDER_INSTRUCTION_PUBLISH' ? (
        <OrderInstructionPublishPanel item={item} onCompleted={onCompleted} />
      ) : item.work_type === 'ORDER_EVIDENCE_REVIEW' ? (
        <OrderEvidenceReviewPanel item={item} onCompleted={onCompleted} />
      ) : item.work_type === 'REVIEW_DECISION' ? (
        <ReviewDecisionPanel item={item} onCompleted={onCompleted} />
      ) : item.work_type === 'BUYER_REFUND_PROCESSING' ? (
        // P7b：返款待办不再有独立面板，直达返款工作台对应记录。
        <Navigate
          to={`/staff/refunds/${encodeURIComponent(item.source_entity_id)}`}
          replace
        />
      ) : null}
      {settlementVisible ? <SellerSettlementPanel item={item} /> : null}
    </main>
  );
}
