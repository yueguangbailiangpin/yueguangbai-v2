import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useCursorPages } from '../../api/useCursorPages';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import { Alert, Button, Card, StatusBadge } from '../../ui/primitives';
import { staffApi } from '../api/client';
import type { StaffBuyerRefundListItem } from '../contracts/runtime';
import { staffWorkbenchKeys } from '../queries/keys';
import { formatCny, formatShanghai } from '../shared/format';

const REFUND_STATUS_LABELS: Record<StaffBuyerRefundListItem['status'], string> = {
  DUE: '待返款',
  PARTIALLY_PAID: '部分返款',
  PAID: '已结清',
  OVERPAID: '多付待核',
};

const MS_PER_DAY = 86_400_000;

/**
 * P7c 承诺期限徽标：已超期（红）> 临期 ≤2 天（黄）> 正常；仅提醒口径
 * （P13-A：周一至周五计 7 个工作日，非合同承诺）。
 */
function describePromiseDeadline(
  deadline: number | null,
  now: number,
): { label: string; tone: 'danger' | 'warning' | 'neutral' } | null {
  if (deadline === null) return { label: '期限未起算', tone: 'neutral' };
  const diff = deadline - now;
  if (diff < 0)
    return { label: `已超期 ${Math.floor(-diff / MS_PER_DAY) + 1} 天`, tone: 'danger' };
  const daysLeft = Math.floor(diff / MS_PER_DAY) + 1;
  return daysLeft <= 2
    ? { label: `剩 ${daysLeft} 天`, tone: 'warning' }
    : { label: `剩 ${daysLeft} 天`, tone: 'neutral' };
}

/**
 * 返款工作台列表（/staff/refunds，P7b）。数据来自既有
 * GET /api/staff/buyer-refunds（后端零改动）；每行直达 /staff/refunds/:id
 * 处理视图（登记多笔转账流水 + 凭证，累计到账=应返即结清）。
 */
export function StaffRefundsPage(): React.JSX.Element {
  const session = useCurrentStaffSession();
  const client = useQueryClient();
  const pages = useCursorPages<StaffBuyerRefundListItem>({
    resetKey: 'refunds',
    queryKey: (cursor) => staffWorkbenchKeys.refundsPage(cursor),
    queryFn: (cursor, signal) =>
      staffApi.buyerRefunds(client, cursor, signal).then((response) => response.data),
  });
  const outstanding = pages.items.filter((item) => item.status !== 'PAID').length;
  return (
    <main className="staff-refunds">
      <section aria-labelledby="staff-refunds-title">
        <p className="eyebrow">买家与订单 · 返款</p>
        <h2 id="staff-refunds-title">返款工作台</h2>
        <p>
          待结清 {outstanding} 笔，超期和临期排最前（承诺期限 = 评论通过 + 7 个工作日，
          仅提醒口径）；登记转账流水（可多笔），累计到账等于应返金额即自动结清，
          买家端即时可见。
        </p>
        <Button
          className="secondary"
          onClick={() => {
            void client.invalidateQueries({ queryKey: staffWorkbenchKeys.refundsRoot });
          }}
        >
          刷新
        </Button>
      </section>
      {pages.isInitialPending ? (
        <p role="status">正在加载返款列表</p>
      ) : pages.initialError ? (
        <Alert tone="danger">
          返款列表读取失败，请刷新重试（角色需为 owner 或 buyer_refund，当前
          {session.role.display_name}）。
        </Alert>
      ) : pages.items.length === 0 ? (
        <Card className="customer-visible">
          <p>暂无返款记录。评论通过后返款义务会自动出现在这里。</p>
        </Card>
      ) : (
        <Card className="customer-visible">
          <h3>返款记录</h3>
          <div className="staff-refund-rows">
            {pages.items.map((item) => (
              <StaffRefundRow key={item.obligation_id} item={item} />
            ))}
          </div>
          {pages.laterError ? (
            <p className="inline-error" role="alert">后续页加载失败，请重试。</p>
          ) : null}
          {pages.hasMore ? (
            <Button
              className="secondary"
              disabled={pages.isLoadingMore}
              onClick={pages.loadMore}
            >
              {pages.isLoadingMore ? '加载中…' : '加载更多'}
            </Button>
          ) : null}
        </Card>
      )}
    </main>
  );
}

function StaffRefundRow({ item }: { item: StaffBuyerRefundListItem }): React.JSX.Element {
  const settled = item.status === 'PAID';
  const deadline = settled ? null : describePromiseDeadline(item.promise_deadline_at, Date.now());
  return (
    <div className={`staff-refund-row${settled ? ' is-settled' : ''}${deadline?.tone === 'danger' ? ' is-overdue' : ''}`}>
      <div className="staff-refund-row-main">
        <strong>
          {item.buyer.buyer_customer_no ?? '未分配编码'} ·{' '}
          {item.order.amazon_order_number_normalized}
        </strong>
        <span>
          ASIN {item.order.asin} · 应返 {formatCny(item.due_amount_cny_fen)} · 已返{' '}
          {formatCny(item.net_paid_cny_fen)} · 待返 {formatCny(item.outstanding_amount_cny_fen)}
        </span>
        <span>
          {item.promise_deadline_at === null
            ? '承诺期限未起算'
            : `承诺期限 ${formatShanghai(item.promise_deadline_at)}`}
          {' · '}
          义务生成 {formatShanghai(item.created_at)}
          {item.reminder_count > 0
            ? ` · 买家催办 ${item.reminder_count} 次${
                item.last_reminded_at !== null
                  ? `（最近 ${formatShanghai(item.last_reminded_at)}）`
                  : ''
              }`
            : ''}
        </span>
      </div>
      <div className="staff-refund-row-side">
        {deadline ? (
          <StatusBadge tone={deadline.tone}>{deadline.label}</StatusBadge>
        ) : null}
        <StatusBadge tone={settled ? 'success' : item.status === 'DUE' ? 'warning' : 'processing'}>
          {REFUND_STATUS_LABELS[item.status]}
        </StatusBadge>
        <Link className="staff-refund-open" to={`/staff/refunds/${encodeURIComponent(item.obligation_id)}`}>
          {settled ? '查看' : '去处理'}
        </Link>
      </div>
    </div>
  );
}
