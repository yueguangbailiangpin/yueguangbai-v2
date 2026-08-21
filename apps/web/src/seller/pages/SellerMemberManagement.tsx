import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { identityApiRequest } from '../../api/identity-request';
import { operationHeaders } from '../../api/idempotency';
import {
  Alert,
  Button,
  Card,
  DataTable,
  FormField,
  Select,
  StatusBadge,
  TextInput,
} from '../../ui/primitives';
import { sellerApi } from '../api/client';

const membersSchema = z
  .object({
    members: z.array(
      z
        .object({
          member_id: z.string(),
          display_name: z.string(),
          role: z.enum(['OWNER', 'OPERATIONS', 'FINANCE', 'VIEWER']),
          wechat_id: z.string().nullable(),
          primary_owner: z.boolean(),
          status: z.string(),
          member_number: z.number().int(),
        })
        .strict(),
    ),
  })
  .strict();
const invitationsSchema = z
  .object({
    invitations: z.array(
      z
        .object({
          invitation_id: z.string(),
          wechat_id: z.string(),
          display_name: z.string(),
          role: z.enum(['OPERATIONS', 'FINANCE', 'VIEWER']),
          store_ids: z.array(z.string()),
          status: z.enum(['ACTIVE', 'CONSUMED', 'REVOKED', 'EXPIRED']),
          version: z.number().int(),
          issued_at: z.number().int(),
          expires_at: z.number().int(),
          consumed_at: z.number().int().nullable(),
          revoked_at: z.number().int().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
const issueSchema = z
  .object({
    invitation: z
      .object({
        invitation_id: z.string(),
        registration_token: z.string(),
        registration_path: z.string(),
        wechat_id: z.string(),
        display_name: z.string(),
        role: z.enum(['OPERATIONS', 'FINANCE', 'VIEWER']),
        store_ids: z.array(z.string()),
        status: z.literal('ACTIVE'),
        version: z.number().int(),
        expires_at: z.number().int(),
      })
      .strict(),
  })
  .strict();
const revokeSchema = z.object({ revoked: z.literal(true), revoked_at: z.number().int() }).strict();
const roleLabel = {
  OWNER: '负责人',
  OPERATIONS: '运营成员',
  FINANCE: '财务成员',
  VIEWER: '查看成员',
} as const;

export function SellerMemberManagement({ isOwner }: { isOwner: boolean }) {
  const client = useQueryClient(),
    [link, setLink] = useState<string | null>(null),
    [role, setRole] = useState<'OPERATIONS' | 'FINANCE' | 'VIEWER'>('OPERATIONS');
  const members = useQuery({
    queryKey: ['seller', 'members'],
    queryFn: ({ signal }) =>
      identityApiRequest('seller', client, {
        path: '/api/seller-portal/members',
        method: 'GET',
        schema: membersSchema,
        signal,
      }).then((r) => r.data.members),
    enabled: isOwner,
    retry: false,
  });
  const invitations = useQuery({
    queryKey: ['seller', 'member-invitations'],
    queryFn: ({ signal }) =>
      identityApiRequest('seller', client, {
        path: '/api/seller-portal/member-invitations',
        method: 'GET',
        schema: invitationsSchema,
        signal,
      }).then((r) => r.data.invitations),
    enabled: isOwner,
    retry: false,
  });
  const stores = useQuery({
    queryKey: ['seller', 'member-stores'],
    queryFn: ({ signal }) => sellerApi.stores(client, null, signal).then((r) => r.data.items),
    enabled: isOwner,
    retry: false,
  });
  const issue = useMutation({
    mutationFn: (body: unknown) =>
      identityApiRequest('seller', client, {
        path: '/api/seller-portal/member-invitations',
        method: 'POST',
        schema: issueSchema,
        body,
        headers: operationHeaders({ key: crypto.randomUUID(), body }),
      }),
    onSuccess: async (response) => {
      setLink(`${window.location.origin}${response.data.invitation.registration_path}`);
      await client.invalidateQueries({ queryKey: ['seller', 'member-invitations'] });
    },
  });
  const revoke = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) => {
      const body = { expected_version: version };
      return identityApiRequest('seller', client, {
        path: `/api/seller-portal/member-invitations/${encodeURIComponent(id)}/revoke`,
        method: 'POST',
        schema: revokeSchema,
        body,
        headers: operationHeaders({ key: crypto.randomUUID(), body }),
      });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['seller', 'member-invitations'] }),
  });
  if (!isOwner) return null;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLink(null);
    const data = new FormData(event.currentTarget),
      body = {
        wechat_id: String(data.get('wechat_id')),
        display_name: String(data.get('display_name')),
        role,
        store_ids: data.getAll('store_ids').map(String),
      };
    issue.mutate(body);
  }
  return (
    <section className="seller-member-management">
      <Card>
        <div className="seller-section-heading">
          <div>
            <h2>团队成员</h2>
            <p>主账号可以邀请运营、财务或查看成员；主账号权限不能通过邀请转让。</p>
          </div>
        </div>
        {members.isError ? (
          <Alert tone="danger">成员列表暂时无法读取。</Alert>
        ) : members.data ? (
          <DataTable caption="卖家团队成员">
            <thead>
              <tr>
                <th>成员</th>
                <th>微信</th>
                <th>角色</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {members.data.map((member) => (
                <tr key={member.member_id}>
                  <td>
                    <strong>{member.display_name}</strong>
                    {member.primary_owner ? <small>主账号</small> : null}
                  </td>
                  <td>{member.wechat_id ?? '—'}</td>
                  <td>{roleLabel[member.role]}</td>
                  <td>
                    <StatusBadge tone={member.status === 'ACTIVE' ? 'success' : 'neutral'}>
                      {member.status === 'ACTIVE' ? '正常' : '停用'}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <p role="status">正在读取成员</p>
        )}
      </Card>
      <Card>
        <h2>邀请新成员</h2>
        <form onSubmit={submit}>
          <FormField label="微信号" htmlFor="member-wechat">
            <TextInput id="member-wechat" name="wechat_id" required />
          </FormField>
          <FormField label="成员姓名" htmlFor="member-name">
            <TextInput id="member-name" name="display_name" required />
          </FormField>
          <FormField label="成员角色" htmlFor="member-role">
            <Select
              id="member-role"
              value={role}
              onChange={(event) => setRole(event.target.value as typeof role)}
            >
              <option value="OPERATIONS">运营成员</option>
              <option value="FINANCE">财务成员</option>
              <option value="VIEWER">查看成员</option>
            </Select>
          </FormField>
          <fieldset className="staff-marketplace-options">
            <legend>可以访问的店铺</legend>
            {stores.data?.map((store) => (
              <label key={store.id}>
                <input type="checkbox" name="store_ids" value={store.id} />
                <span>{store.display_name}</span>
              </label>
            ))}
          </fieldset>
          <Button loading={issue.isPending}>生成成员邀请链接</Button>
        </form>
        {issue.isError ? (
          <Alert tone="danger">
            邀请未生成。请确认微信未属于其他卖家成员，并至少选择一个店铺。
          </Alert>
        ) : null}
        {link ? (
          <FormField
            label="成员注册链接"
            htmlFor="seller-member-link"
            description="链接只在本次生成时显示；复制后通过微信发给成员"
          >
            <TextInput id="seller-member-link" value={link} readOnly />
          </FormField>
        ) : null}
      </Card>
      {invitations.data && invitations.data.length > 0 ? (
        <Card>
          <h2>成员邀请记录</h2>
          <DataTable caption="卖家成员邀请">
            <thead>
              <tr>
                <th>成员</th>
                <th>角色</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {invitations.data.map((invite) => (
                <tr key={invite.invitation_id}>
                  <td>
                    <strong>{invite.display_name}</strong>
                    <small>{invite.wechat_id}</small>
                  </td>
                  <td>{roleLabel[invite.role]}</td>
                  <td>
                    {invite.status === 'ACTIVE'
                      ? '待使用'
                      : invite.status === 'CONSUMED'
                        ? '已加入'
                        : invite.status === 'REVOKED'
                          ? '已撤销'
                          : '已过期'}
                  </td>
                  <td>
                    {invite.status === 'ACTIVE' ? (
                      <Button
                        className="danger"
                        loading={revoke.isPending}
                        onClick={() =>
                          revoke.mutate({ id: invite.invitation_id, version: invite.version })
                        }
                      >
                        撤销邀请
                      </Button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
      ) : null}
    </section>
  );
}
