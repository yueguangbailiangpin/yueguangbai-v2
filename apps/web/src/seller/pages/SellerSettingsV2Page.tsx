import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { isFrontendApiError } from '../../api/errors';
import { Alert, Button, Card, FormField, PageHeader, RequestIdDisplay, StatusBadge, TextInput } from '../../ui/primitives';
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
      {me.data ? (
        <SettlementAccountCard
          initialName={me.data.organization.settlement_account_name}
          initialIdentifier={me.data.organization.settlement_account_identifier}
          canEdit={
            me.data.member.role === 'OWNER'
            || me.data.member.role === 'OPERATIONS'
            || me.data.member.role === 'FINANCE'
          }
        />
      ) : null}
      <SellerMemberManagement isOwner={me.data?.member.role === 'OWNER'} />
    </section>
  );
}

/**
 * 结算收款账户（P16）：收款人姓名+支付宝账号，保存后可改；员工登记打款时
 * 直接带出。未填不拦截业务，员工结算面板温和提示（卖家结算无承诺期限）。
 */
function SettlementAccountCard({
  initialName,
  initialIdentifier,
  canEdit,
}: {
  initialName: string | null;
  initialIdentifier: string | null;
  canEdit: boolean;
}): React.JSX.Element {
  const client = useQueryClient();
  const [name, setName] = useState(initialName ?? '');
  const [identifier, setIdentifier] = useState(initialIdentifier ?? '');
  const mutation = useMutation({
    mutationFn: () =>
      sellerApi.updateSettlementAccount(client, name.trim(), identifier.trim()),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: sellerQueryKeys.me });
    },
  });
  const filled = initialName !== null && initialIdentifier !== null;
  const nameValid = name.trim().length >= 1 && name.trim().length <= 100;
  const identifierValid = identifier.trim().length >= 3 && identifier.trim().length <= 128;
  const submittable = canEdit && nameValid && identifierValid && !mutation.isPending;
  return (
    <Card className="seller-settlement-account-card">
      <h3>
        结算收款账户{' '}
        <StatusBadge tone={filled ? 'success' : 'warning'}>
          {filled ? '已填写' : '未填写'}
        </StatusBadge>
      </h3>
      {!filled ? (
        <p>填写支付宝收款账户后，结算打款时工作人员可以直接带出，不用每次再确认。</p>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (submittable) mutation.mutate();
        }}
      >
        <FormField label="收款人姓名" htmlFor="settlement-account-name">
          <TextInput
            id="settlement-account-name"
            value={name}
            maxLength={100}
            required
            readOnly={!canEdit}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField label="支付宝账号（手机号或邮箱）" htmlFor="settlement-account-identifier">
          <TextInput
            id="settlement-account-identifier"
            value={identifier}
            maxLength={128}
            required
            readOnly={!canEdit}
            onChange={(event) => setIdentifier(event.target.value)}
          />
        </FormField>
        {canEdit ? (
          <Button disabled={!submittable} loading={mutation.isPending}>
            保存收款账户
          </Button>
        ) : (
          <p>当前角色只读；如需修改请联系组织负责人。</p>
        )}
      </form>
      {mutation.isSuccess ? <Alert tone="success">收款账户已保存。</Alert> : null}
      {mutation.isError ? (
        <>
          <Alert tone="danger">
            保存未完成，请稍后重试。
            {isFrontendApiError(mutation.error) && mutation.error.code === 'VALIDATION_ERROR'
              ? '（姓名 1-100 字，支付宝账号 3-128 字符）'
              : ''}
          </Alert>
          <RequestIdDisplay
            requestId={isFrontendApiError(mutation.error) ? mutation.error.requestId : null}
          />
        </>
      ) : null}
    </Card>
  );
}
