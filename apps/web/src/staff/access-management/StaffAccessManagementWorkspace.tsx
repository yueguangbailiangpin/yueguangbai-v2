import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { isFrontendApiError } from '../../api/errors';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import {
  Alert, Button, Card, DataTable, Dialog, EmptyState, FormField,
  RequestIdDisplay, Select, StatusBadge, TextInput,
} from '../../ui/primitives';
import { staffApi } from '../api/client';
import type {
  StaffAccessEmployee,
  StaffBindingInvitation,
} from '../contracts/runtime';
import { staffWorkbenchKeys } from '../queries/keys';

type RoleCode = 'owner' | 'pre_sales' | 'seller_ops' | 'buyer_refund';
const ROLES: readonly { code: RoleCode; label: string }[] = [
  { code: 'owner', label: '总管理员' },
  { code: 'pre_sales', label: '售前' },
  { code: 'seller_ops', label: '卖家对接' },
  { code: 'buyer_refund', label: '买家返款' },
];

export function StaffAccessManagementWorkspace(): React.JSX.Element {
  const client = useQueryClient();
  const session = useCurrentStaffSession();
  const authorized = session.role.code === 'owner'
    && session.permissions.includes('STAFF_MANAGE')
    && session.permissions.includes('PERMISSION_MANAGE');
  const [displayName, setDisplayName] = useState('');
  const [inviteRole, setInviteRole] = useState<RoleCode>('pre_sales');
  const [inviteTeamId, setInviteTeamId] = useState('');
  const [invitationPath, setInvitationPath] = useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, RoleCode>>({});
  const [confirmStatus, setConfirmStatus] = useState<StaffAccessEmployee | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  useEffect(() => () => {
    client.removeQueries({ queryKey: staffWorkbenchKeys.accessManagement });
  }, [client]);

  const overview = useQuery({
    queryKey: staffWorkbenchKeys.accessManagement,
    queryFn: ({ signal }) => staffApi.accessManagement(client, signal)
      .then((response) => response.data),
    enabled: authorized,
    retry: false,
  });
  const issuedInvitations = useMemo(() =>
    overview.data?.invitations.filter((item) => item.status === 'ISSUED') ?? [],
  [overview.data]);
  useEffect(() => {
    if (!inviteTeamId && overview.data?.available_teams[0]) {
      setInviteTeamId(overview.data.available_teams[0].team_id);
    }
  }, [inviteTeamId, overview.data]);

  async function refresh(): Promise<void> {
    await client.invalidateQueries({ queryKey: staffWorkbenchKeys.accessManagement });
  }

  async function createInvitation(): Promise<void> {
    const name = displayName.normalize('NFKC').trim();
    if (name.length < 1 || busyKey) return;
    setBusyKey('invite-create'); setMessage(null); setRequestId(null);
    try {
      const response = await staffApi.createStaffBindingInvitation(client, {
        display_name: name, role_code: inviteRole,
        team_id: inviteRole === 'owner' ? null : inviteTeamId,
      }, crypto.randomUUID());
      setInvitationPath(response.data.invitation_path);
      setDisplayName('');
      setMessage(response.data.invitation_path
        ? '邀请已创建。请把下方链接单独发送给该员工。'
        : '该邀请此前已创建成功；安全起见不会再次显示原链接，请取消后重新创建。');
      await refresh();
    } catch (error) { reportError(error); }
    finally { setBusyKey(null); }
  }

  async function cancelInvitation(invitation: StaffBindingInvitation): Promise<void> {
    if (busyKey) return;
    setBusyKey(`invite-${invitation.invitation_id}`); setMessage(null); setRequestId(null);
    try {
      await staffApi.cancelStaffBindingInvitation(client, invitation.invitation_id, {
        expected_version: invitation.version,
      }, crypto.randomUUID());
      setMessage('邀请已取消，原链接不能再绑定员工。');
      await refresh();
    } catch (error) { reportError(error); }
    finally { setBusyKey(null); }
  }

  async function saveRole(employee: StaffAccessEmployee): Promise<void> {
    const roleCode = roleDrafts[employee.staff_id] ?? employee.role.code;
    if (roleCode === employee.role.code || busyKey) return;
    setBusyKey(`role-${employee.staff_id}`); setMessage(null); setRequestId(null);
    try {
      await staffApi.changeStaffRole(client, employee.staff_id, {
        role_code: roleCode, expected_version: employee.version,
      }, crypto.randomUUID());
      setMessage(`${employee.display_name}的角色已更新，旧会话已失效。`);
      setRoleDrafts((current) => {
        const next = { ...current }; delete next[employee.staff_id]; return next;
      });
      await refresh();
    } catch (error) { reportError(error); }
    finally { setBusyKey(null); }
  }

  async function changeStatus(): Promise<void> {
    const employee = confirmStatus;
    if (!employee || busyKey) return;
    const status = employee.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    setBusyKey(`status-${employee.staff_id}`); setMessage(null); setRequestId(null);
    try {
      await staffApi.changeStaffAccessStatus(client, employee.staff_id, {
        status, expected_version: employee.version,
      }, crypto.randomUUID());
      setMessage(`${employee.display_name}已${status === 'ACTIVE' ? '启用' : '停用'}，旧会话已失效。`);
      setConfirmStatus(null);
      await refresh();
    } catch (error) { reportError(error); }
    finally { setBusyKey(null); }
  }

  function reportError(error: unknown): void {
    setRequestId(isFrontendApiError(error) ? error.requestId : null);
    setMessage(isFrontendApiError(error) && error.category === 'CONFLICT'
      ? '数据或状态已经变化，请刷新后再操作。'
      : '操作没有完成，请稍后重试。');
  }

  async function copyInvitation(): Promise<void> {
    if (!invitationPath) return;
    try {
      await navigator.clipboard.writeText(
        new URL(invitationPath, window.location.origin).toString(),
      );
      setMessage('邀请链接已复制。');
    } catch {
      setMessage('无法自动复制，请手动复制下方链接。');
    }
  }

  if (!authorized) return <main className="staff-access-management">
    <Alert tone="danger">当前员工身份没有员工管理权限，后端也会拒绝直接访问。</Alert>
  </main>;
  if (overview.isPending) return <main className="staff-access-management"><p role="status">正在加载员工权限</p></main>;
  if (overview.isError) return <main className="staff-access-management">
    <Alert tone="danger">员工权限暂时无法加载。</Alert>
    <Button className="secondary" onClick={() => { void overview.refetch(); }}>重试</Button>
  </main>;

  return <main className="staff-access-management">
    <section className="staff-access-heading">
      <div><p className="eyebrow">仅总管理员可操作</p><h2>员工权限与飞书绑定</h2>
        <p>月光白保存角色与权限真值；飞书只用于员工本人验证和协作入口。</p></div>
      <div className="staff-access-counts"><strong>{overview.data.employees.length}</strong><span>员工</span>
        <strong>{issuedInvitations.length}</strong><span>待绑定邀请</span></div>
    </section>

    {message ? <Alert tone={message.includes('没有完成') || message.includes('无法') ? 'danger' : 'success'}>{message}<RequestIdDisplay requestId={requestId} /></Alert> : null}

    <Card className="staff-invite-card">
      <div><h3>邀请新员工</h3><p>员工本人打开链接并用飞书验证后，账号才会生效。</p></div>
      <form onSubmit={(event) => { event.preventDefault(); void createInvitation(); }}>
        <FormField label="员工姓名" htmlFor="staff-invite-name" required>
          <TextInput id="staff-invite-name" maxLength={100} autoComplete="off"
            value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </FormField>
        <FormField label="唯一角色" htmlFor="staff-invite-role" required>
          <Select id="staff-invite-role" value={inviteRole}
            onChange={(event) => setInviteRole(event.target.value as RoleCode)}>
            {ROLES.map((role) => <option key={role.code} value={role.code}>{role.label}</option>)}
          </Select>
        </FormField>
        {inviteRole !== 'owner' ? <FormField label="所属团队" htmlFor="staff-invite-team" required>
          <Select id="staff-invite-team" value={inviteTeamId}
            onChange={(event) => setInviteTeamId(event.target.value)}>
            {overview.data.available_teams.map((team) => <option key={team.team_id} value={team.team_id}>
              {team.department_name} · {team.team_name}
            </option>)}
          </Select>
        </FormField> : null}
        <Button type="submit" loading={busyKey === 'invite-create'} loadingLabel="正在创建"
          disabled={displayName.trim().length === 0
            || (inviteRole !== 'owner' && inviteTeamId.length === 0)}>创建绑定邀请</Button>
      </form>
      {invitationPath ? <div className="staff-invitation-link" role="status">
        <label htmlFor="staff-invitation-url">仅显示一次的邀请链接</label>
        <div><TextInput id="staff-invitation-url" readOnly value={new URL(invitationPath, window.location.origin).toString()} />
          <Button className="secondary" onClick={() => { void copyInvitation(); }}>复制</Button></div>
      </div> : null}
    </Card>

    <section aria-labelledby="staff-employee-list-title">
      <div className="staff-access-section-title"><h3 id="staff-employee-list-title">员工账号</h3>
        <span>角色变化与启停都会立即使旧会话失效</span></div>
      {overview.data.employees.length === 0
        ? <EmptyState title="暂无员工" description="请先创建绑定邀请。" />
        : <DataTable caption="员工角色、飞书绑定与账号状态">
          <thead><tr><th scope="col">员工</th><th scope="col">账号状态</th><th scope="col">飞书绑定</th>
            <th scope="col">唯一角色</th><th scope="col">操作</th></tr></thead>
          <tbody>{overview.data.employees.map((employee) => {
            const self = employee.staff_id === session.staff_id;
            const draft = roleDrafts[employee.staff_id] ?? employee.role.code;
            return <tr key={employee.staff_id}>
              <td><strong>{employee.display_name}</strong><small>更新于 {formatTime(employee.updated_at)}</small></td>
              <td><StatusBadge tone={employee.status === 'ACTIVE' ? 'success' : 'neutral'}>
                {employee.status === 'ACTIVE' ? '已启用' : '已停用'}</StatusBadge></td>
              <td><StatusBadge tone={employee.feishu_binding.status === 'ACTIVE' ? 'success' : 'warning'}>
                {bindingLabel(employee.feishu_binding.status)}</StatusBadge></td>
              <td><div className="staff-role-editor"><Select aria-label={`${employee.display_name}的角色`}
                value={draft} disabled={self || busyKey !== null}
                onChange={(event) => setRoleDrafts((current) => ({
                  ...current, [employee.staff_id]: event.target.value as RoleCode,
                }))}>{ROLES.map((role) => <option key={role.code} value={role.code}>{role.label}</option>)}</Select>
                <Button className="secondary" disabled={self || draft === employee.role.code || busyKey !== null}
                  loading={busyKey === `role-${employee.staff_id}`} loadingLabel="保存中"
                  onClick={() => { void saveRole(employee); }}>保存角色</Button></div></td>
              <td><Button className={employee.status === 'ACTIVE' ? 'danger' : 'secondary'}
                disabled={self || busyKey !== null || (employee.status === 'DISABLED' && employee.feishu_binding.status !== 'ACTIVE')}
                onClick={() => setConfirmStatus(employee)}>{self ? '当前账号' : employee.status === 'ACTIVE' ? '停用' : '启用'}</Button></td>
            </tr>;
          })}</tbody>
        </DataTable>}
    </section>

    <section aria-labelledby="staff-invitation-list-title">
      <div className="staff-access-section-title"><h3 id="staff-invitation-list-title">待绑定邀请</h3>
        <span>邀请 24 小时内有效且只能使用一次</span></div>
      {issuedInvitations.length === 0 ? <EmptyState title="没有待绑定邀请" description="已消费、取消或过期的邀请不会再次生效。" />
        : <div className="staff-invitation-grid">{issuedInvitations.map((invitation) => <Card key={invitation.invitation_id}>
          <div><strong>{invitation.display_name}</strong><StatusBadge tone="processing">待绑定</StatusBadge></div>
          <p>{invitation.role.display_name}{invitation.team
            ? ` · ${invitation.team.department_name}/${invitation.team.team_name}` : ''}
            {' · '}{formatTime(invitation.expires_at)} 到期</p>
          <Button className="secondary" disabled={busyKey !== null}
            loading={busyKey === `invite-${invitation.invitation_id}`} loadingLabel="正在取消"
            onClick={() => { void cancelInvitation(invitation); }}>取消邀请</Button>
        </Card>)}</div>}
    </section>

    <Dialog open={confirmStatus !== null}
      title={confirmStatus?.status === 'ACTIVE' ? '停用员工账号' : '启用员工账号'}
      description={confirmStatus?.status === 'ACTIVE'
        ? `停用后，${confirmStatus?.display_name ?? '该员工'}的现有会话会立即失效。`
        : `启用后，${confirmStatus?.display_name ?? '该员工'}可重新使用飞书登录。`}
      busy={busyKey?.startsWith('status-') ?? false}
      onClose={() => setConfirmStatus(null)}>
      <div className="entry-actions"><Button className="secondary" onClick={() => setConfirmStatus(null)}>取消</Button>
        <Button className={confirmStatus?.status === 'ACTIVE' ? 'danger' : ''}
          loading={busyKey?.startsWith('status-') ?? false} loadingLabel="正在更新"
          onClick={() => { void changeStatus(); }}>确认{confirmStatus?.status === 'ACTIVE' ? '停用' : '启用'}</Button></div>
    </Dialog>
  </main>;
}

function bindingLabel(status: 'ACTIVE' | 'REVOKED' | 'MISSING'): string {
  if (status === 'ACTIVE') return '已绑定';
  if (status === 'REVOKED') return '绑定已撤销';
  return '未绑定';
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}
