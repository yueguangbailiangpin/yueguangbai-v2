import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Card, PageHeader } from '../../ui/primitives';
import { sellerApi } from '../api/client';
import { sellerQueryKeys } from '../queries/keys';
import { SellerMemberManagement } from './SellerMemberManagement';

const roleLabel = {
  OWNER: '负责人',
  OPERATIONS: '运营成员',
  FINANCE: '财务成员',
  VIEWER: '查看成员',
} as const;

export function SellerSettingsV2Page(): React.JSX.Element {
  const client = useQueryClient();
  const me = useQuery({
    queryKey: sellerQueryKeys.me,
    queryFn: ({ signal }) => sellerApi.me(client, signal).then((r) => r.data.me),
  });
  return (
    <section className="seller-page">
      <PageHeader title="账户与团队" eyebrow="账户安全" />
      <Card className="seller-account-card">
        <div>
          <h2>{me.data?.member.display_name ?? '正在读取账户'}</h2>
          <p>
            {me.data
              ? `${roleLabel[me.data.member.role]} · ${me.data.organization.name}`
              : '请稍候'}
          </p>
        </div>
        <Link className="button" to="/seller/change-password">
          修改密码
        </Link>
      </Card>
      <SellerMemberManagement isOwner={me.data?.member.role === 'OWNER'} />
    </section>
  );
}
