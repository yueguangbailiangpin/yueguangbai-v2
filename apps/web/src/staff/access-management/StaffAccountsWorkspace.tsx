import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { identityApiRequest } from '../../api/identity-request';
import { operationHeaders } from '../../api/idempotency';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  FormField,
  Select,
  StatusBadge,
  TextInput,
} from '../../ui/primitives';

const roleSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('owner'), display_name: z.literal('总管理员') }).strict(),
  z.object({ code: z.literal('acquisition'), display_name: z.literal('获客') }).strict(),
  z.object({ code: z.literal('pre_sales'), display_name: z.literal('售前') }).strict(),
  z.object({ code: z.literal('seller_ops'), display_name: z.literal('卖家对接') }).strict(),
  z.object({ code: z.literal('buyer_refund'), display_name: z.literal('买家返款') }).strict(),
]);
const employeeSchema = z
  .object({
    staff_id: z.string(),
    display_name: z.string(),
    email: z.string().nullable(),
    status: z.enum(['ACTIVE', 'DISABLED']),
    version: z.number().int().positive(),
    role: roleSchema,
    marketplace_codes: z.array(z.string()),
    marketplace_scopes: z
      .array(z.object({ code: z.string(), scope_kind: z.enum(['PRIMARY', 'SUPPORT']) }).strict())
      .optional(),
    last_login_at: z.number().int().nonnegative().nullable(),
    updated_at: z.number().int().nonnegative(),
  })
  .strict();
const overviewSchema = z
  .object({
    employees: z.array(employeeSchema),
    available_marketplaces: z.array(
      z
        .object({
          code: z.string(),
          display_name: z.string(),
          status: z.enum(['ACTIVE', 'DISABLED']),
        })
        .strict(),
    ),
  })
  .strict();
const mutationSchema = z.object({ employee: employeeSchema, replayed: z.boolean() }).strict();
const sellerOrganizationManagerSchema = z
  .object({
    seller_organization_id: z.string(),
    seller_organization_name: z.string(),
    marketplace_code: z.string(),
    manager: z
      .object({
        assignment_id: z.string(),
        staff_id: z.string(),
        staff_display_name: z.string(),
        version: z.number().int().positive(),
      })
      .strict()
      .nullable(),
  })
  .strict();
const sellerOrganizationManagersSchema = z
  .object({ seller_organizations: z.array(sellerOrganizationManagerSchema) })
  .strict();
const sellerOrganizationManagerMutationSchema = z
  .object({ seller_organization: sellerOrganizationManagerSchema, replayed: z.boolean() })
  .strict();
type Employee = z.output<typeof employeeSchema>;
type SellerOrganizationManager = z.output<typeof sellerOrganizationManagerSchema>;
type Role = Employee['role']['code'];
const ROLES: readonly [Role, string][] = [
  ['owner', '总管理员'],
  ['acquisition', '获客'],
  ['pre_sales', '售前'],
  ['seller_ops', '卖家对接'],
  ['buyer_refund', '买家返款'],
];

export function StaffAccountsWorkspace(): React.JSX.Element {
  const session = useCurrentStaffSession(),
    client = useQueryClient(),
    authorized = session.role.code === 'owner' && session.permissions.includes('STAFF_MANAGE');
  const [creating, setCreating] = useState(false),
    [editing, setEditing] = useState<Employee | null>(null),
    [disabling, setDisabling] = useState<Employee | null>(null);
  const query = useQuery({
    queryKey: ['staff', 'staff-accounts', session.authorization_version],
    queryFn: ({ signal }) =>
      identityApiRequest('staff', client, {
        path: '/api/staff/access-management',
        method: 'GET',
        schema: overviewSchema,
        signal,
      }).then((r) => r.data),
    enabled: authorized,
    retry: false,
  });
  const sellerOrganizationAssignmentsQuery = useQuery({
    queryKey: ['staff', 'seller-organization-assignments', session.authorization_version],
    queryFn: ({ signal }) =>
      identityApiRequest('staff', client, {
        path: '/api/staff/access-management/seller-organization-assignments',
        method: 'GET',
        schema: sellerOrganizationManagersSchema,
        signal,
      }).then((r) => r.data),
    enabled: authorized,
    retry: false,
  });
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ['staff', 'staff-accounts'] }),
      client.invalidateQueries({ queryKey: ['staff', 'seller-organization-assignments'] }),
    ]);
  const createMutation = useMutation({
    mutationFn: (body: unknown) => write(client, '/api/staff/access-management/employees', body),
    onSuccess: async () => {
      setCreating(false);
      await refresh();
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) =>
      write(
        client,
        `/api/staff/access-management/employees/${encodeURIComponent(id)}/update`,
        body,
      ),
    onSuccess: async () => {
      setEditing(null);
      await refresh();
    },
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) =>
      write(
        client,
        `/api/staff/access-management/employees/${encodeURIComponent(id)}/status`,
        body,
      ),
    onSuccess: async () => {
      setDisabling(null);
      await refresh();
    },
  });
  const sellerOrganizationManagerMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) =>
      identityApiRequest('staff', client, {
        path: `/api/staff/access-management/seller-organization-assignments/${encodeURIComponent(id)}/manager`,
        method: 'POST',
        schema: sellerOrganizationManagerMutationSchema,
        body,
        headers: operationHeaders({ key: crypto.randomUUID(), body }),
      }),
    onSuccess: refresh,
  });
  if (!authorized)
    return (
      <main className="staff-access-management">
        <Alert tone="danger">仅总管理员可以管理员工账号。</Alert>
      </main>
    );
  if (query.isPending)
    return (
      <main className="staff-access-management">
        <p role="status">正在加载员工</p>
      </main>
    );
  if (query.isError)
    return (
      <main className="staff-access-management">
        <Alert tone="danger">员工列表暂时加载不了。</Alert>
      </main>
    );
  return (
    <main className="staff-access-management staff-accounts-simple">
      <section className="staff-access-heading">
        <div>
          <p className="eyebrow">仅总管理员</p>
          <h2>员工管理</h2>
          <p>
            岗位决定能做什么，站点决定能看什么。同岗位同站点可以多人覆盖，但系统只保留一个主负责人。
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>新增员工</Button>
      </section>
      <Alert tone="info">
        第一个进入某“岗位 ×
        站点”的员工自动成为主负责人；后续员工自动显示“协助”。主负责人停用时，系统会自动提升一名协助员工，不增加排班页面。
      </Alert>
      <section
        className="staff-seller-organization-assignments"
        aria-labelledby="seller-organization-manager-heading"
      >
        <div>
          <p className="eyebrow">卖家对接</p>
          <h3 id="seller-organization-manager-heading">负责卖家组织</h3>
          <p>
            为每个卖家组织指定一名“卖家对接”负责人。更换后只影响后续业务，历史任务与财务快照不会改写。
          </p>
        </div>
        {sellerOrganizationAssignmentsQuery.isPending ? (
          <p role="status">正在读取卖家负责人</p>
        ) : null}
        {sellerOrganizationAssignmentsQuery.isError ? (
          <Alert tone="danger">卖家负责人列表暂时加载不了。</Alert>
        ) : null}
        {sellerOrganizationAssignmentsQuery.data ? (
          sellerOrganizationAssignmentsQuery.data.seller_organizations.length === 0 ? (
            <EmptyState title="暂无卖家组织" description="卖家客户开通后会显示在这里。" />
          ) : (
            <DataTable caption="卖家组织与负责卖家对接员工">
              <thead>
                <tr>
                  <th>卖家组织</th>
                  <th>站点</th>
                  <th>当前负责人</th>
                  <th>更换负责人</th>
                </tr>
              </thead>
              <tbody>
                {sellerOrganizationAssignmentsQuery.data.seller_organizations.map((assignment) => (
                  <SellerOrganizationManagerRow
                    key={`${assignment.seller_organization_id}:${assignment.manager?.assignment_id ?? 'none'}`}
                    assignment={assignment}
                    candidates={sellerOpsCandidates(
                      query.data.employees,
                      assignment.marketplace_code,
                    )}
                    busy={sellerOrganizationManagerMutation.isPending}
                    onAssign={(body) =>
                      sellerOrganizationManagerMutation.mutate({
                        id: assignment.seller_organization_id,
                        body,
                      })
                    }
                  />
                ))}
              </tbody>
            </DataTable>
          )
        ) : null}
      </section>
      {query.data.employees.length === 0 ? (
        <EmptyState title="暂无员工" description="请先创建业务员工。" />
      ) : (
        <DataTable caption="员工账号、岗位与负责站点">
          <thead>
            <tr>
              <th>员工</th>
              <th>登录邮箱</th>
              <th>岗位</th>
              <th>负责站点</th>
              <th>状态</th>
              <th>最后登录</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {query.data.employees.map((employee) => (
              <tr key={employee.staff_id}>
                <td>
                  <strong>{employee.display_name}</strong>
                  <small>{employee.staff_id}</small>
                </td>
                <td>{employee.email ?? '尚未绑定邮箱'}</td>
                <td>{employee.role.display_name}</td>
                <td>
                  {employee.role.code === 'owner'
                    ? '全部站点'
                    : scopeLabels(employee, query.data.available_marketplaces)}
                </td>
                <td>
                  <StatusBadge tone={employee.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {employee.status === 'ACTIVE' ? '正常' : '已停用'}
                  </StatusBadge>
                </td>
                <td>
                  {employee.last_login_at === null
                    ? '从未登录'
                    : formatTime(employee.last_login_at)}
                </td>
                <td>
                  <div className="entry-actions">
                    <Button
                      className="secondary"
                      disabled={employee.staff_id === session.staff_id}
                      onClick={() => setEditing(employee)}
                    >
                      管理
                    </Button>
                    {employee.staff_id !== session.staff_id ? (
                      <Button
                        className={employee.status === 'ACTIVE' ? 'danger' : 'secondary'}
                        onClick={() =>
                          employee.status === 'ACTIVE'
                            ? setDisabling(employee)
                            : statusMutation.mutate({
                                id: employee.staff_id,
                                body: { status: 'ACTIVE', expected_version: employee.version },
                              })
                        }
                      >
                        {employee.status === 'ACTIVE' ? '停用' : '启用'}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      <AccountDialog
        key="create-staff"
        title="新增员工"
        open={creating}
        employee={undefined}
        marketplaces={query.data.available_marketplaces}
        busy={createMutation.isPending}
        onClose={() => setCreating(false)}
        onSubmit={(body) => createMutation.mutate(body)}
      />
      <AccountDialog
        key={editing?.staff_id ?? 'edit-none'}
        title="管理员工"
        open={editing !== null}
        employee={editing ?? undefined}
        marketplaces={query.data.available_marketplaces}
        busy={updateMutation.isPending}
        onClose={() => setEditing(null)}
        onSubmit={(body) =>
          editing &&
          updateMutation.mutate({
            id: editing.staff_id,
            body: { ...body, expected_version: editing.version },
          })
        }
      />
      <Dialog
        open={disabling !== null}
        title="确认停用员工"
        description={
          disabling
            ? `停用后，${disabling.display_name} 的现有会话会立即失效；如果TA是某站点主负责人，系统会自动从协助人员中提升一人。`
            : ''
        }
        busy={statusMutation.isPending}
        onClose={() => setDisabling(null)}
      >
        <div className="staff-disable-summary">
          {disabling ? (
            <>
              <p>
                <strong>{disabling.display_name}</strong>
              </p>
              <p>{disabling.email}</p>
              <p>{disabling.role.display_name}</p>
            </>
          ) : null}
        </div>
        <div className="entry-actions">
          <Button className="secondary" onClick={() => setDisabling(null)}>
            取消
          </Button>
          <Button
            className="danger"
            loading={statusMutation.isPending}
            onClick={() =>
              disabling &&
              statusMutation.mutate({
                id: disabling.staff_id,
                body: { status: 'DISABLED', expected_version: disabling.version },
              })
            }
          >
            确认停用
          </Button>
        </div>
      </Dialog>
    </main>
  );
}

function SellerOrganizationManagerRow({
  assignment,
  candidates,
  busy,
  onAssign,
}: {
  assignment: SellerOrganizationManager;
  candidates: readonly Employee[];
  busy: boolean;
  onAssign: (body: { assigned_staff_id: string; expected_assignment_version: number }) => void;
}) {
  const [staffId, setStaffId] = useState(
    candidates.some((candidate) => candidate.staff_id === assignment.manager?.staff_id)
      ? (assignment.manager?.staff_id ?? '')
      : '',
  );
  const expectedVersion = assignment.manager?.version ?? 0;
  return (
    <tr>
      <td>
        <strong>{assignment.seller_organization_name}</strong>
      </td>
      <td>{assignment.marketplace_code}</td>
      <td>{assignment.manager?.staff_display_name ?? '尚未分配'}</td>
      <td>
        {candidates.length === 0 ? (
          <span>暂无符合该站点主负责人条件的卖家对接员工</span>
        ) : (
          <div className="entry-actions">
            <Select
              aria-label={`${assignment.seller_organization_name} 负责人`}
              value={staffId}
              onChange={(event) => setStaffId(event.target.value)}
            >
              <option value="">请选择卖家对接负责人</option>
              {candidates.map((candidate) => (
                <option key={candidate.staff_id} value={candidate.staff_id}>
                  {candidate.display_name}
                </option>
              ))}
            </Select>
            <Button
              className="secondary"
              loading={busy}
              disabled={!staffId || staffId === assignment.manager?.staff_id}
              onClick={() =>
                onAssign({
                  assigned_staff_id: staffId,
                  expected_assignment_version: expectedVersion,
                })
              }
            >
              {assignment.manager ? '更换负责人' : '指定负责人'}
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

function AccountDialog({
  title,
  open,
  employee,
  marketplaces,
  busy,
  onClose,
  onSubmit,
}: {
  title: string;
  open: boolean;
  employee: Employee | undefined;
  marketplaces: readonly { code: string; display_name: string; status: 'ACTIVE' | 'DISABLED' }[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (body: {
    display_name: string;
    email: string;
    role_code: Role;
    marketplace_codes: string[];
  }) => void;
}) {
  const [role, setRole] = useState<Role>(employee?.role.code ?? 'pre_sales');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSubmit({
      display_name: String(data.get('display_name')),
      email: String(data.get('email')),
      role_code: role,
      marketplace_codes: role === 'owner' ? [] : data.getAll('marketplace_codes').map(String),
    });
  }
  return (
    <Dialog
      open={open}
      title={title}
      description="一个员工只选一个岗位；站点可与同岗位其他员工重复，系统自动决定主负责人/协助。"
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={submit} className="staff-account-form">
        <FormField label="员工姓名" htmlFor={`${title}-name`}>
          <TextInput
            id={`${title}-name`}
            name="display_name"
            defaultValue={employee?.display_name ?? ''}
            required
          />
        </FormField>
        <FormField label="登录邮箱" htmlFor={`${title}-email`}>
          <TextInput
            id={`${title}-email`}
            name="email"
            type="email"
            defaultValue={employee?.email ?? ''}
            required
          />
        </FormField>
        <FormField label="岗位" htmlFor={`${title}-role`}>
          <Select
            id={`${title}-role`}
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
          >
            {ROLES.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </FormField>
        {role !== 'owner' ? (
          <fieldset className="staff-marketplace-options">
            <legend>负责站点</legend>
            {marketplaces
              .filter((market) => market.status === 'ACTIVE')
              .map((market) => (
                <label key={market.code}>
                  <input
                    type="checkbox"
                    name="marketplace_codes"
                    value={market.code}
                    defaultChecked={
                      employee?.marketplace_codes.includes(market.code) ??
                      market.code === 'AMAZON_JP'
                    }
                  />
                  <span>{market.display_name}</span>
                </label>
              ))}
          </fieldset>
        ) : (
          <Alert tone="info">总管理员自动拥有全部站点。</Alert>
        )}
        <div className="entry-actions">
          <Button type="button" className="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" loading={busy}>
            保存
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function write(client: ReturnType<typeof useQueryClient>, path: string, body: unknown) {
  return identityApiRequest('staff', client, {
    path,
    method: 'POST',
    schema: mutationSchema,
    body,
    headers: operationHeaders({ key: crypto.randomUUID(), body }),
  });
}
function scopeLabels(
  employee: Employee,
  markets: readonly { code: string; display_name: string }[],
) {
  const scopes =
    employee.marketplace_scopes ??
    employee.marketplace_codes.map((code) => ({ code, scope_kind: 'PRIMARY' as const }));
  return (
    scopes
      .map(
        (scope) =>
          `${marketLabel(markets, scope.code)} · ${scope.scope_kind === 'PRIMARY' ? '主负责人' : '协助'}`,
      )
      .join(' / ') || '未配置'
  );
}
function sellerOpsCandidates(
  employees: readonly Employee[],
  marketplaceCode: string,
): readonly Employee[] {
  return employees.filter(
    (employee) =>
      employee.status === 'ACTIVE' &&
      employee.role.code === 'seller_ops' &&
      (employee.marketplace_scopes ?? []).some(
        (scope) => scope.code === marketplaceCode && scope.scope_kind === 'PRIMARY',
      ),
  );
}
function marketLabel(markets: readonly { code: string; display_name: string }[], code: string) {
  return markets.find((market) => market.code === code)?.display_name ?? code;
}
function formatTime(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
