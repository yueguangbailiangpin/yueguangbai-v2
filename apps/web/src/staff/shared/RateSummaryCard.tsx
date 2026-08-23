import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import { Card } from '../../ui/primitives';
import { staffApi } from '../api/client';
import { staffWorkbenchKeys } from '../queries/keys';
import { chinaDate, fenToYuan, markupLabel, rateLabel } from '../finance/finance-format';

const SERVICE_FEE_REVIEW_TYPE_LABELS: Record<string, string> = {
  RATING: '评分单',
  TEXT: '文字评论',
  IMAGE: '图片评论',
  VIDEO: '视频评论',
};

/**
 * Read-only current-effective rate summary (P2 compromise): today's base
 * rate, the selected markup, and — when an organization context exists —
 * the per-review-type service fees, with missing facts highlighted.
 * Configuration changes live only on /staff/finance (single source of
 * truth); this card always links there.
 */
export function RateSummaryCard({
  organizationId,
}: {
  organizationId: string | null;
}): React.JSX.Element | null {
  const session = useCurrentStaffSession();
  const client = useQueryClient();
  const canRead =
    (session.role.code === 'owner' || session.role.code === 'seller_ops') &&
    session.permissions.includes('SELLER_MANAGE');
  const today = chinaDate();
  // The rate read always lets the backend resolve the scope-appropriate
  // selection (GLOBAL -> market default; assigned -> first visible org): the
  // caller-provided organization comes from directories that may list orgs
  // outside this account's rate-center visibility, which 404s the whole read.
  const rateCenter = useQuery({
    queryKey: staffWorkbenchKeys.rateCenter(
      session.authorization_version,
      today,
      null,
    ),
    queryFn: ({ signal }) =>
      staffApi
        .rateCenter(client, today, null, signal)
        .then((response) => response.data),
    enabled: canRead,
    retry: false,
  });
  // Service fees are organization-scoped: prefer the caller's organization
  // when it is rate-center visible, else the first visible organization.
  const visibleOrganizations = rateCenter.data?.seller_organizations ?? [];
  const feeOrganizationId =
    visibleOrganizations.find(
      (organization) => organization.seller_organization_id === organizationId,
    )?.seller_organization_id
    ?? visibleOrganizations[0]?.seller_organization_id
    ?? null;
  const serviceFees = useQuery({
    queryKey: staffWorkbenchKeys.sellerServiceFees(
      session.authorization_version,
      feeOrganizationId ?? '',
    ),
    queryFn: ({ signal }) =>
      staffApi
        .sellerServiceFees(client, feeOrganizationId!, signal)
        .then((response) => response.data),
    enabled: canRead && feeOrganizationId !== null,
    retry: false,
  });
  if (!canRead) return null;
  const baseRate = rateCenter.data?.base_rate ?? null;
  const policy = rateCenter.data?.policies.selected_policy ?? null;
  return (
    <Card className="customer-visible staff-rate-summary">
      <h3>当前生效费率</h3>
      <p>
        <strong>今日基础汇率：</strong>
        {baseRate?.confirmed_rate
          ? rateLabel(baseRate.confirmed_rate.cny_per_jpy_e8)
          : <span className="inline-warning">今日未确认</span>}
      </p>
      <p>
        <strong>加点：</strong>
        {policy
          ? `${policy.scope_type === 'SELLER_ORGANIZATION' ? '组织专属' : '默认'} ${markupLabel(policy.markup_rate_value)} · v${policy.version_no}`
          : <span className="inline-warning">未配置</span>}
      </p>
      {feeOrganizationId !== null ? (
        <p>
          <strong>
            服务费（
            {visibleOrganizations.find(
              (organization) =>
                organization.seller_organization_id === feeOrganizationId,
            )?.seller_organization_name ?? feeOrganizationId}
            ）：
          </strong>
          {serviceFees.data
            ? serviceFees.data.fees.map((entry) => (
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
            : '读取中'}
        </p>
      ) : null}
      <p className="hint">
        <Link to="/staff/finance">管理财务配置</Link>
        （修改动作只在财务配置页进行）。
      </p>
    </Card>
  );
}
