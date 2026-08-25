import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  FormField,
  MetricCard,
  Select,
  StatusBadge,
  TextInput,
} from '../../ui/primitives';
import {
  acquisitionApi,
  type AcquisitionChannelStat,
  type SourceCorrectionCandidate,
} from './api';
import type { AcquisitionInternalChannel, AcquisitionProspect } from './runtime';

const MARKETPLACES = [
  ['AMAZON_JP', '亚马逊日本站'],
  ['AMAZON_US', '亚马逊美国站'],
  ['COUPANG_KR', 'Coupang 韩国站'],
  ['RAKUTEN_JP', '乐天日本站'],
  ['TIKTOK_JP', 'TikTok 日本站'],
] as const;
type Tab = 'overview' | 'prospects' | 'daily' | 'channels' | 'stats' | 'corrections';

const ACQUISITION_ROOT = ['staff', 'acquisition-v4'] as const;
const acquisitionKeys = Object.freeze({
  channels: [...ACQUISITION_ROOT, 'channels'] as const,
  prospects: [...ACQUISITION_ROOT, 'prospects'] as const,
  consultations: [...ACQUISITION_ROOT, 'consultations'] as const,
  funnel: [...ACQUISITION_ROOT, 'funnel'] as const,
  stats: [...ACQUISITION_ROOT, 'stats'] as const,
  corrections: [...ACQUISITION_ROOT, 'corrections'] as const,
  machines: [...ACQUISITION_ROOT, 'machines'] as const,
});

async function invalidateAcquisitionKeys(
  client: ReturnType<typeof useQueryClient>,
  keys: readonly (readonly string[])[],
): Promise<void> {
  await Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: [...key] })));
}

export function AcquisitionCoreWorkbench(): React.JSX.Element {
  const session = useCurrentStaffSession(),
    client = useQueryClient(),
    ownerRead = session.role.code === 'owner',
    canAdmin = ownerRead && session.permissions.includes('ACQUISITION_ADMIN'),
    canViewProfit = ownerRead && session.permissions.includes('FINANCIAL_VIEW'),
    operator = ownerRead || session.role.code === 'acquisition';
  const [tab, setTab] = useState<Tab>('overview'),
    range = useMemo(currentMonthRange, []);
  const channels = useQuery({
    queryKey: ['staff', 'acquisition-v4', 'channels', session.authorization_version],
    queryFn: ({ signal }) =>
      acquisitionApi
        .channels(client, signal)
        .then((r) =>
          r.data.channels.filter(
            (channel): channel is AcquisitionInternalChannel => channel.visibility === 'INTERNAL',
          ),
        ),
    enabled: operator,
    retry: false,
  });
  const [prospects, consultations, stats, corrections] = useQueries({
    queries: [
      {
        queryKey: ['staff', 'acquisition-v4', 'prospects', session.authorization_version],
        queryFn: ({ signal }) =>
          acquisitionApi
            .prospects(client, { leadType: null, status: null, cursor: null }, signal)
            .then((r) => r.data),
        enabled: operator,
        retry: false,
      },
      {
        queryKey: [
          'staff',
          'acquisition-v4',
          'consultations',
          range.from,
          range.to,
          session.authorization_version,
        ],
        queryFn: ({ signal }) =>
          acquisitionApi
            .consultations(client, range.from, range.to, signal)
            .then((r) => r.data.consultations),
        enabled: operator && tab === 'daily',
        retry: false,
      },
      {
        queryKey: [
          'staff',
          'acquisition-v4',
          'stats',
          range.from,
          range.to,
          session.authorization_version,
        ],
        queryFn: ({ signal }) =>
          acquisitionApi
            .channelStats(client, range.from, range.to, signal)
            .then((r) => r.data.channels),
        enabled: operator && tab === 'stats',
        retry: false,
      },
      {
        queryKey: ['staff', 'acquisition-v4', 'corrections', session.authorization_version],
        queryFn: ({ signal }) =>
          acquisitionApi.sourceCorrectionCandidates(client, signal).then((r) => r.data.items),
        enabled: operator && tab === 'corrections',
        retry: false,
      },
    ],
  });
  if (!operator)
    return (
      <main className="acquisition-workbench">
        <Alert tone="danger">当前岗位不使用客户开发中心。</Alert>
      </main>
    );
  const tabs: readonly (readonly [Tab, string])[] = [
    ['overview', '概览'],
    ['prospects', '潜在线索'],
    ['daily', '每日渠道数据'],
    ['channels', '渠道管理'],
    ['stats', '渠道统计'],
    ['corrections', '来源纠错'],
  ];
  return (
    <main className="acquisition-workbench acquisition-core">
      <header className="acquisition-core-heading">
        <div>
          <p className="eyebrow">月光白客户开发中心</p>
          <h2>客户开发中心</h2>
          <p>渠道的真实平台和开发方法只对总管理员、获客岗位可见；其他员工只看到渠道编号。</p>
        </div>
      </header>
      <nav className="acquisition-core-tabs" aria-label="客户开发中心导航">
        {tabs.map(([key, label]) => (
          <Button key={key} className={tab === key ? '' : 'secondary'} onClick={() => setTab(key)}>
            {label}
          </Button>
        ))}
      </nav>
      {channels.isError ||
      prospects.isError ||
      consultations.isError ||
      stats.isError ? (
        <Alert tone="warning">部分客户开发数据暂时无法加载。</Alert>
      ) : null}
      {tab === 'overview' ? (
        <Overview prospects={prospects.data?.items ?? []} />
      ) : null}
      {tab === 'prospects' ? (
        <Prospects channels={channels.data ?? []} items={prospects.data?.items ?? []} />
      ) : null}
      {tab === 'daily' ? (
        <Daily
          channels={channels.data ?? []}
          items={consultations.data ?? []}
          canAdmin={canAdmin}
        />
      ) : null}
      {tab === 'channels' ? <Channels items={channels.data ?? []} canAdmin={canAdmin} /> : null}
      {tab === 'stats' ? <Stats items={stats.data ?? []} canViewProfit={canViewProfit} /> : null}
      {tab === 'corrections' ? (
        <Corrections items={corrections.data ?? []} channels={channels.data ?? []} />
      ) : null}
    </main>
  );
}

function Overview({
  prospects,
}: {
  prospects: readonly AcquisitionProspect[];
}) {
  const buyer = prospects.filter(
      (p) => p.lead_type === 'BUYER' && !['CONVERTED', 'LOST'].includes(p.status),
    ).length,
    seller = prospects.filter(
      (p) => p.lead_type === 'SELLER' && !['CONVERTED', 'LOST'].includes(p.status),
    ).length;
  return (
    <>
      <section className="acquisition-summary">
        <MetricCard label="买家潜在线索" value={buyer} />
        <MetricCard label="卖家潜在线索" value={seller} />
      </section>
      <Card>
        <h3>客户从哪来，到哪一步</h3>
        <p>
          渠道 → 潜在线索（可选）→ 正式客户登记 → 订单 →
          利润。客户登记和来源记录保存后不会改动。
        </p>
      </Card>
    </>
  );
}
function Prospects({
  channels,
  items,
}: {
  channels: readonly AcquisitionInternalChannel[];
  items: readonly AcquisitionProspect[];
}) {
  const client = useQueryClient(),
    [show, setShow] = useState(false);
  const create = useMutation({
    mutationFn: (body: unknown) => acquisitionApi.createProspect(client, body, crypto.randomUUID()),
    onSuccess: async () => {
      await invalidateAcquisitionKeys(client, [acquisitionKeys.prospects, acquisitionKeys.stats]);
    },
  });
  const handoff = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) =>
      acquisitionApi.updateProspect(client, id, body, crypto.randomUUID()),
    onSuccess: async () => {
      await invalidateAcquisitionKeys(client, [acquisitionKeys.prospects]);
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    create.mutate(
      {
        lead_type: String(data.get('lead_type')),
        marketplace_code: String(data.get('marketplace_code')),
        channel_id: String(data.get('channel_id')),
        display_name: String(data.get('display_name')),
        contact_value: nullable(data.get('contact_value')),
        source_url: nullable(data.get('source_url')),
        origin_mode: 'HUMAN',
        note: nullable(data.get('note')),
        ai_score: null,
      },
      {
        onSuccess: () => {
          form.reset();
          setShow(false);
        },
      },
    );
  }
  return (
    <section>
      <div className="staff-section-toolbar">
        <div>
          <h3>潜在线索</h3>
          <p>还没加微信的主动开发对象先放这里。</p>
        </div>
        <Button onClick={() => setShow(!show)}>{show ? '取消' : '新增线索'}</Button>
      </div>
      {show ? (
        <Card>
          <form onSubmit={submit}>
            <FormField label="客户类型" htmlFor="p-type">
              <Select id="p-type" name="lead_type">
                <option value="SELLER">卖家</option>
                <option value="BUYER">买家</option>
              </Select>
            </FormField>
            <FormField label="站点" htmlFor="p-market">
              <Select id="p-market" name="marketplace_code">
                {MARKETPLACES.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="真实来源渠道" htmlFor="p-channel">
              <Select id="p-channel" name="channel_id" required>
                <option value="">请选择</option>
                {channels
                  .filter((c) => c.status === 'ACTIVE' && c.lead_type !== 'BOTH')
                  .map((c) => (
                    <option key={c.channel_id} value={c.channel_id}>
                      {c.display_name}（员工：{c.staff_label}）
                    </option>
                  ))}
              </Select>
            </FormField>
            <FormField label="客户 / 公司名称" htmlFor="p-name">
              <TextInput id="p-name" name="display_name" required />
            </FormField>
            <FormField label="联系方式（可空）" htmlFor="p-contact">
              <TextInput id="p-contact" name="contact_value" />
            </FormField>
            <FormField label="来源链接（可空）" htmlFor="p-url">
              <TextInput id="p-url" name="source_url" />
            </FormField>
            <FormField label="备注" htmlFor="p-note">
              <TextInput id="p-note" name="note" />
            </FormField>
            <Button loading={create.isPending}>保存线索</Button>
          </form>
        </Card>
      ) : null}
      {items.length === 0 ? (
        <EmptyState title="暂无潜在线索" description="人工建立的潜在客户会出现在这里。" />
      ) : (
        <DataTable caption="潜在线索">
          <thead>
            <tr>
              <th>客户</th>
              <th>类型</th>
              <th>站点</th>
              <th>真实来源</th>
              <th>开发方式</th>
              <th>评分</th>
              <th>交接</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.prospect_id}>
                <td>
                  <strong>{p.display_name}</strong>
                </td>
                <td>{p.lead_type === 'BUYER' ? '买家' : '卖家'}</td>
                <td>{marketLabel(p.marketplace_code)}</td>
                <td>{p.origin_channel_name}</td>
                <td>
                  {!['HUMAN_HANDOFF', 'CONVERTED', 'LOST'].includes(p.status) ? (
                    <Button
                      className="secondary"
                      loading={handoff.isPending}
                      onClick={() =>
                        handoff.mutate({
                          id: p.prospect_id,
                          body: {
                            expected_version: p.version,
                            status: 'HUMAN_HANDOFF',
                            note: p.note,
                          },
                        })
                      }
                    >
                      交给业务员工
                    </Button>
                  ) : (
                    statusLabel(p.status)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </section>
  );
}
function Daily({
  channels,
  items,
  canAdmin,
}: {
  channels: readonly AcquisitionInternalChannel[];
  items: readonly {
    channel_id: string;
    business_date: string;
    person_count: number;
    version: number;
  }[];
  canAdmin: boolean;
}) {
  const client = useQueryClient(),
    today = shanghaiDate(Date.now());
  const mutation = useMutation({
    mutationFn: (body: unknown) =>
      acquisitionApi.recordConsultation(client, body, crypto.randomUUID()),
    onSuccess: async () => {
      await invalidateAcquisitionKeys(client, [
        acquisitionKeys.consultations,
        acquisitionKeys.funnel,
        acquisitionKeys.stats,
      ]);
    },
  });
  return (
    <div className="acquisition-daily-grid">
      <Card>
        <h3>今天的渠道数据</h3>
        {channels
          .filter((c) => c.status === 'ACTIVE' && c.lead_type !== 'BOTH')
          .map((c) => {
            const row = items.find(
              (v) => v.channel_id === c.channel_id && v.business_date === today,
            );
            return (
              <div className="compact-row" key={c.channel_id}>
                <span>
                  <strong>{c.display_name}</strong>
                  <small>
                    {c.staff_label} · {audienceLabel(c.lead_type)}
                  </small>
                </span>
                <b>{row === undefined ? '未填' : row.person_count}</b>
              </div>
            );
          })}
      </Card>
      {canAdmin ? (
        <Card>
          <h3>填写 / 更正今天数据</h3>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget),
                id = String(data.get('channel_id')),
                existing = items.find((v) => v.channel_id === id && v.business_date === today);
              mutation.mutate({
                channel_id: id,
                business_date: today,
                person_count: Number(data.get('person_count')),
                expected_version: existing?.version ?? 0,
                reason: existing ? '更新当日咨询人数' : '记录当日咨询人数',
              });
            }}
          >
            <FormField label="真实渠道" htmlFor="daily-channel">
              <Select id="daily-channel" name="channel_id" required>
                <option value="">请选择</option>
                {channels
                  .filter((c) => c.status === 'ACTIVE' && c.lead_type !== 'BOTH')
                  .map((c) => (
                    <option key={c.channel_id} value={c.channel_id}>
                      {c.display_name}（{c.staff_label}）
                    </option>
                  ))}
              </Select>
            </FormField>
            <FormField label="咨询人数" htmlFor="daily-count">
              <TextInput id="daily-count" name="person_count" type="number" min="0" required />
            </FormField>
            <Button loading={mutation.isPending}>保存</Button>
          </form>
        </Card>
      ) : (
        <Card>
          <h3>日咨询只读</h3>
          <Alert tone="info">
            日咨询人数由具备当前管理权限的总管理员登记或更正；此会话仅可读取当前范围的数据。
          </Alert>
        </Card>
      )}
    </div>
  );
}
function Channels({
  items,
  canAdmin,
}: {
  items: readonly AcquisitionInternalChannel[];
  canAdmin: boolean;
}) {
  const client = useQueryClient(),
    [show, setShow] = useState(false),
    [editing, setEditing] = useState<AcquisitionInternalChannel | null>(null);
  const create = useMutation({
      mutationFn: (body: unknown) =>
        acquisitionApi.createChannel(client, body, crypto.randomUUID()),
      onSuccess: async () => {
        setShow(false);
        await invalidateAcquisitionKeys(client, [acquisitionKeys.channels, acquisitionKeys.stats]);
      },
    }),
    privacy = useMutation({
      mutationFn: ({ id, body }: { id: string; body: unknown }) =>
        acquisitionApi.updateChannelPrivacy(client, id, body, crypto.randomUUID()),
      onSuccess: async () => {
        setEditing(null);
        await invalidateAcquisitionKeys(client, [acquisitionKeys.channels]);
      },
    }),
    disable = useMutation({
      mutationFn: (channel: AcquisitionInternalChannel) =>
        acquisitionApi.disableChannel(
          client,
          channel.channel_id,
          { expected_version: channel.version, reason: 'Owner 停用获客渠道' },
          crypto.randomUUID(),
        ),
      onSuccess: async () => {
        await invalidateAcquisitionKeys(client, [acquisitionKeys.channels, acquisitionKeys.stats]);
      },
    });
  return (
    <section>
      <div className="staff-section-toolbar">
        <div>
          <h3>渠道管理</h3>
          <p>渠道编号创建后不会更改；总管理员只能更换对应接待微信或停用渠道。</p>
        </div>
        {canAdmin ? (
          <Button onClick={() => setShow(!show)}>{show ? '取消' : '新增真实渠道'}</Button>
        ) : null}
      </div>
      {show && canAdmin ? (
        <Card>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget,
                data = new FormData(form);
              create.mutate(
                {
                  code: `CHANNEL_${Date.now()}`,
                  platform_name: String(data.get('platform_name')),
                  lead_type: String(data.get('lead_type')),
                  marketplace_code: String(data.get('marketplace_code')),
                  display_name: String(data.get('display_name')),
                },
                { onSuccess: () => form.reset() },
              );
            }}
          >
            <FormField label="真实平台" htmlFor="channel-platform">
              <TextInput id="channel-platform" name="platform_name" required />
            </FormField>
            <FormField label="真实渠道名称" htmlFor="channel-name">
              <TextInput id="channel-name" name="display_name" required />
            </FormField>
            <FormField label="客户类型" htmlFor="channel-type">
              <Select id="channel-type" name="lead_type">
                <option value="BUYER">买家</option>
                <option value="SELLER">卖家</option>
              </Select>
            </FormField>
            <FormField label="站点" htmlFor="channel-market">
              <Select id="channel-market" name="marketplace_code">
                {MARKETPLACES.map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
            <Button loading={create.isPending}>建立渠道</Button>
          </form>
        </Card>
      ) : null}
      {items.length === 0 ? (
        <EmptyState title="暂无渠道" description="先建立真实来源渠道。" />
      ) : (
        <DataTable caption="真实渠道与员工匿名编号">
          <thead>
            <tr>
              <th>员工看到</th>
              <th>真实平台 / 渠道</th>
              <th>类型 / 站点</th>
              <th>接待微信</th>
              <th>状态</th>
              {canAdmin ? <th>操作</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.channel_id}>
                <td>
                  <strong>{c.staff_label}</strong>
                  <small>编号永久固定</small>
                </td>
                <td>
                  <strong>{c.display_name}</strong>
                  <small>{c.platform_name}</small>
                </td>
                <td>
                  {audienceLabel(c.lead_type)} · {marketLabel(c.marketplace_code)}
                </td>
                <td>{c.intake_wechat_label ?? '未配置'}</td>
                <td>{c.status === 'ACTIVE' ? '启用' : '已停用'}</td>
                {canAdmin ? (
                  <td>
                    <div className="entry-actions">
                      <Button className="secondary" onClick={() => setEditing(c)}>
                        配置接待微信
                      </Button>
                      {c.status === 'ACTIVE' ? (
                        <Button
                          className="danger"
                          loading={disable.isPending}
                          onClick={() => disable.mutate(c)}
                        >
                          停用
                        </Button>
                      ) : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      {editing && canAdmin ? (
        <Card>
          <h3>配置 {editing.staff_label}</h3>
          <Alert tone="info">“{editing.staff_label}”不能修改，避免渠道编号和历史记录对不上。</Alert>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              privacy.mutate({
                id: editing.channel_id,
                body: {
                  expected_version: editing.profile_version,
                  intake_wechat_label: String(data.get('intake_wechat_label')),
                },
              });
            }}
          >
            <FormField label="员工渠道编号" htmlFor="fixed-label">
              <TextInput id="fixed-label" value={editing.staff_label} readOnly />
            </FormField>
            <FormField label="对应接待微信" htmlFor="intake-wechat">
              <TextInput
                id="intake-wechat"
                name="intake_wechat_label"
                defaultValue={editing.intake_wechat_label ?? ''}
                required
              />
            </FormField>
            <Button loading={privacy.isPending}>保存</Button>
            <Button type="button" className="secondary" onClick={() => setEditing(null)}>
              取消
            </Button>
          </form>
        </Card>
      ) : null}
    </section>
  );
}
function Stats({
  items,
  canViewProfit,
}: {
  items: readonly AcquisitionChannelStat[];
  canViewProfit: boolean;
}) {
  if (items.length === 0)
    return <EmptyState title="暂无渠道统计" description="产生渠道数据后会自动汇总。" />;
  return (
    <DataTable caption="渠道统计">
      <thead>
        <tr>
          <th>真实渠道</th>
          <th>类型</th>
          <th>咨询</th>
          <th>正式客户</th>
          <th>订单</th>
          {canViewProfit ? <th>来源利润</th> : null}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.channel_id}>
            <td>
              <strong>{item.channel_name}</strong>
              <small>
                {item.platform_name} · {marketLabel(item.marketplace_code)}
              </small>
            </td>
            <td>{audienceLabel(item.lead_type)}</td>
            <td>
              {item.consultation_data_complete ? (
                item.consultation_count
              ) : (
                <StatusBadge tone="warning">
                  未填完整 {item.consultation_days_recorded}/{item.consultation_days_expected}
                </StatusBadge>
              )}
            </td>
            <td>{item.lead_count}</td>
            <td>
              {item.lead_type === 'BUYER'
                ? item.buyer_formal_order_count
                : item.lead_type === 'SELLER'
                  ? item.seller_formal_order_count
                  : item.formal_order_count}
            </td>
            {canViewProfit ? (
              <td>
                {item.lead_type === 'BUYER'
                  ? money(item.buyer_projected_gross_profit_cny_fen)
                  : item.lead_type === 'SELLER'
                    ? money(item.seller_projected_gross_profit_cny_fen)
                    : '历史共用渠道（买家卖家）不合并利润'}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
function Corrections({
  items,
  channels,
}: {
  items: readonly SourceCorrectionCandidate[];
  channels: readonly AcquisitionInternalChannel[];
}) {
  const client = useQueryClient(),
    [selected, setSelected] = useState<SourceCorrectionCandidate | null>(null);
  const mutation = useMutation({
    mutationFn: ({
      leadId,
      channelId,
      expectedSequence,
      reason,
    }: {
      leadId: string;
      channelId: string;
      expectedSequence: number;
      reason: string;
    }) =>
      acquisitionApi.correctSource(
        client,
        {
          lead_id: leadId,
          new_channel_id: channelId,
          expected_correction_sequence: expectedSequence,
          reason,
        },
        crypto.randomUUID(),
      ),
    onSuccess: async () => {
      setSelected(null);
      await invalidateAcquisitionKeys(client, [acquisitionKeys.stats, acquisitionKeys.corrections]);
    },
  });
  return (
    <section>
      <div className="staff-section-toolbar">
        <div>
          <h3>来源纠错</h3>
          <p>误选渠道时在这里更正；更正会留记录，原始来源不会被删除。</p>
        </div>
      </div>
      {items.length === 0 ? (
        <EmptyState title="暂无客户来源记录" description="新客户登记后会显示。" />
      ) : (
        <DataTable caption="客户来源">
          <thead>
            <tr>
              <th>客户</th>
              <th>类型 / 站点</th>
              <th>原始来源</th>
              <th>当前有效来源</th>
              <th>更正</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.lead_id}>
                <td>{item.display_name ?? item.wechat_masked}</td>
                <td>
                  {audienceLabel(item.lead_type)} · {marketLabel(item.marketplace_code)}
                </td>
                <td>{item.original_channel_name}</td>
                <td>
                  {item.effective_channel_name}
                  {item.correction_count > 0 ? `（已更正 ${item.correction_count} 次）` : ''}
                </td>
                <td>
                  <Button className="secondary" onClick={() => setSelected(item)}>
                    修正
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      {selected ? (
        <CorrectionForm
          item={selected}
          channels={channels}
          busy={mutation.isPending}
          onSubmit={(id, reason) =>
            mutation.mutate({
              leadId: selected.lead_id,
              channelId: id,
              expectedSequence: selected.correction_count,
              reason,
            })
          }
          onClose={() => setSelected(null)}
        />
      ) : null}
    </section>
  );
}
function CorrectionForm({
  item,
  channels,
  busy,
  onSubmit,
  onClose,
}: {
  item: SourceCorrectionCandidate;
  channels: readonly AcquisitionInternalChannel[];
  busy: boolean;
  onSubmit: (id: string, reason: string) => void;
  onClose: () => void;
}) {
  const eligible = channels.filter(
    (c) =>
      c.marketplace_code === item.marketplace_code &&
      c.lead_type === item.lead_type &&
      c.channel_id !== item.effective_channel_id,
  );
  return (
    <Card>
      <h3>修正来源 · {item.display_name ?? item.wechat_masked}</h3>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onSubmit(String(data.get('channel_id')), String(data.get('reason')));
        }}
      >
        <FormField label="新的真实渠道" htmlFor="correction-channel">
          <Select id="correction-channel" name="channel_id" required>
            <option value="">请选择</option>
            {eligible.map((c) => (
              <option key={c.channel_id} value={c.channel_id}>
                {c.display_name}（{c.staff_label}）
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="更正原因" htmlFor="correction-reason">
          <TextInput id="correction-reason" name="reason" minLength={3} required />
        </FormField>
        <Button loading={busy}>确认追加更正</Button>
        <Button type="button" className="secondary" onClick={onClose}>
          取消
        </Button>
      </form>
    </Card>
  );
}
function nullable(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  return text ? text : null;
}
function currentMonthRange() {
  const now = new Date(),
    y = now.getFullYear(),
    m = now.getMonth();
  return { from: `${y}-${String(m + 1).padStart(2, '0')}-01`, to: shanghaiDate(Date.now()) };
}
function shanghaiDate(epoch: number) {
  return new Date(epoch + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function marketLabel(code: string) {
  return MARKETPLACES.find(([value]) => value === code)?.[1] ?? code;
}
function audienceLabel(value: string) {
  return value === 'BUYER' ? '买家' : value === 'SELLER' ? '卖家' : '历史双向渠道';
}
function statusLabel(value: string) {
  return (
    (
      {
        NEW: '新发现',
        RESEARCHING: '研究中',
        QUALIFIED: '已筛选',
        READY_CONTACT: '可联系',
        CONTACTED: '已联系',
        HUMAN_HANDOFF: '已交接',
        CONVERTED: '已转正式客户',
        LOST: '不再跟进',
      } as Record<string, string>
    )[value] ?? value
  );
}
function money(value: string | null) {
  if (value === null) return '—';
  const n = BigInt(value),
    a = n < 0n ? -n : n;
  return `${n < 0n ? '-' : ''}¥${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`;
}
