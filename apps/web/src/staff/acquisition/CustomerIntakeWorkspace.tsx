import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { identityApiRequest } from '../../api/identity-request';
import { operationHeaders } from '../../api/idempotency';
import { isFrontendApiError } from '../../api/errors';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  FormField,
  Select,
  StatusBadge,
  TextInput,
} from '../../ui/primitives';
import { acquisitionApi } from './api';
import { RateSummaryCard } from '../shared/RateSummaryCard';
import type { AcquisitionChannel, AcquisitionHandoff } from './runtime';

const MARKET_LABELS: Record<string, string> = {
  AMAZON_JP: '亚马逊日本站',
  AMAZON_US: '亚马逊美国站',
  COUPANG_KR: 'Coupang 韩国站',
  RAKUTEN_JP: '乐天日本站',
  TIKTOK_JP: 'TikTok 日本站',
};
const matchSchema = z
  .object({
    customer_type: z.enum(['BUYER', 'SELLER']),
    subject_id: z.string(),
    display_name: z.string(),
    marketplace_code: z.string(),
    has_portal_account: z.boolean(),
    historical_order_count: z.number().int().nonnegative(),
    source_status: z.literal('HISTORICAL_UNKNOWN'),
  })
  .strict();
const lookupSchema = z
  .object({
    matches: z.array(matchSchema),
    resolution_required: z.boolean(),
    manual_resolution_applied: z.boolean(),
  })
  .strict();
const sellerDirectorySchema = z
  .object({
    items: z.array(
      z
        .object({
          seller_organization_id: z.string(),
          seller_code: z.string(),
          display_name: z.string(),
          wechat_masked: z.string(),
          marketplace_code: z.string(),
          source_status: z.enum(['HISTORICAL_FROZEN_IMPORT', 'CURRENT_OR_NEW']),
          source_file_count: z.number().int().nonnegative(),
          product_names: z.array(z.string()),
          active_offering_count: z.number().int().nonnegative(),
          has_portal_account: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();
type SellerDirectoryItem = z.output<typeof sellerDirectorySchema>['items'][number];
const buyerInvitationSchema = z
  .object({
    invitation: z
      .object({
        invitation_id: z.string(),
        registration_token: z.string(),
        registration_path: z.string(),
        wechat_id: z.string(),
        marketplace_code: z.string(),
        status: z.literal('ACTIVE'),
        version: z.number().int().positive(),
        expires_at: z.number().int(),
        replayed: z.boolean(),
      })
      .passthrough(),
  })
  .strict();
const sellerInvitationSchema = z
  .object({
    invitation: z
      .object({
        invitation_id: z.string(),
        registration_token: z.string(),
        registration_path: z.string(),
        wechat_id: z.string(),
        marketplace_code: z.string(),
        seller_organization_id: z.string(),
        seller_name: z.string(),
        onboarding_kind: z.enum(['NEW_CUSTOMER', 'HISTORICAL_ACCOUNT_ONLY']),
        status: z.literal('ACTIVE'),
        version: z.number().int().positive(),
        expires_at: z.number().int(),
        replayed: z.boolean(),
      })
      .passthrough(),
  })
  .strict();
const currentSellerInvitationSchema = z
  .object({
    invitation: z
      .object({
        invitation_id: z.string(),
        wechat_id: z.string(),
        marketplace_code: z.string(),
        seller_organization_id: z.string(),
        seller_member_id: z.string().nullable(),
        onboarding_kind: z.enum(['NEW_CUSTOMER', 'HISTORICAL_ACCOUNT_ONLY']),
        issued_by_staff_id: z.string(),
        status: z.enum(['ACTIVE', 'CONSUMED', 'REVOKED', 'EXPIRED']),
        version: z.number().int().positive(),
        issued_at: z.number().int(),
        expires_at: z.number().int(),
        consumed_at: z.number().int().nullable(),
        revoked_at: z.number().int().nullable(),
        registration_link_recoverable: z.literal(false),
      })
      .strict()
      .nullable(),
  })
  .strict();
const revokeSchema = z
  .object({
    invitation: z
      .object({
        invitation_id: z.string(),
        status: z.literal('REVOKED'),
        version: z.number().int().positive(),
        revoked_at: z.number().int(),
      })
      .passthrough(),
  })
  .strict();
const resetSchema = z
  .object({
    password_reset: z
      .object({
        reset_id: z.string(),
        reset_token: z.string(),
        reset_path: z.string(),
        expires_at: z.number().int(),
        affected_personas: z.array(z.enum(['BUYER', 'SELLER_MEMBER'])),
        replayed: z.boolean(),
      })
      .passthrough(),
  })
  .strict();
const resolutionCaseSchema = z
  .object({
    case: z
      .object({
        id: z.string(),
        identity_masked: z.string(),
        customer_type: z.enum(['BUYER', 'SELLER']),
        marketplace_code: z.string(),
        reason_code: z.string(),
        staff_note: z.string().nullable(),
        status: z.enum(['OPEN', 'RESOLVED', 'CANCELLED']),
        reported_by_staff_id: z.string(),
        resolved_subject_id: z.string().nullable(),
        resolution_note: z.string().nullable(),
        resolved_by_staff_id: z.string().nullable(),
        created_at: z.number().int(),
        resolved_at: z.number().int().nullable(),
      })
      .strict(),
  })
  .strict();

type HistoricalMatch = z.output<typeof matchSchema>;
type SavedLead = { leadId: string; wechatId: string; marketplaceCode: string; displayName: string };
type InvitationState = {
  kind: 'BUYER' | 'SELLER';
  id: string;
  version: number;
  link: string;
  status: 'ACTIVE' | 'REVOKED';
  recoverable: boolean;
};

export function BuyerCustomersWorkspace(): React.JSX.Element {
  return <CustomerIntakeWorkspace leadType="BUYER" />;
}
export function SellerCustomersWorkspace(): React.JSX.Element {
  return <CustomerIntakeWorkspace leadType="SELLER" />;
}

function CustomerIntakeWorkspace({
  leadType,
}: {
  leadType: 'BUYER' | 'SELLER';
}): React.JSX.Element {
  const session = useCurrentStaffSession();
  const client = useQueryClient();
  const buyer = leadType === 'BUYER';
  const allowed =
    session.role.code === 'owner' ||
    (buyer ? session.role.code === 'pre_sales' : session.role.code === 'seller_ops');
  const channels = useQuery({
    queryKey: ['staff', 'customer-intake', 'channels', leadType, session.authorization_version],
    queryFn: ({ signal }) => acquisitionApi.channels(client, signal).then((r) => r.data.channels),
    enabled: allowed,
    retry: false,
  });
  const sellerDirectory = useQuery({
    queryKey: ['staff', 'customer-intake', 'seller-directory', session.authorization_version],
    queryFn: ({ signal }) =>
      identityApiRequest('staff', client, {
        path: '/api/staff/customer-onboarding/seller-directory',
        method: 'GET',
        schema: sellerDirectorySchema,
        signal,
      }).then((r) => r.data.items),
    enabled: allowed && !buyer,
    retry: false,
  });
  const [leads, handoffs] = useQueries({
    queries: [
      {
        queryKey: ['staff', 'customer-intake', 'leads', leadType, session.authorization_version],
        queryFn: ({ signal }) => acquisitionApi.leads(client, leadType, signal).then((r) => r.data),
        enabled: allowed,
        retry: false,
      },
      {
        queryKey: ['staff', 'customer-intake', 'handoffs', leadType, session.authorization_version],
        queryFn: ({ signal }) =>
          acquisitionApi.handoffs(client, leadType, signal).then((r) => r.data.items),
        enabled: allowed,
        retry: false,
      },
    ],
  });
  if (!allowed)
    return (
      <main className="customer-intake-workspace">
        <Alert tone="danger">当前岗位不能处理{buyer ? '买家' : '卖家'}客户。</Alert>
      </main>
    );
  return (
    <main className="customer-intake-workspace">
      <header className="staff-customer-heading">
        <div>
          <p className="eyebrow">{buyer ? '买家客户接入' : '卖家客户接入'}</p>
          <h2>{buyer ? '买家客户' : '卖家客户'}</h2>
          <p>先查历史客户，再新增。账号开通、密码恢复都从具体客户记录发起。</p>
        </div>
      </header>
      <Alert tone="info">
        历史客户不补渠道、不计入新增；身份不明确时提交总管理员处理，不要自行猜测绑定。
      </Alert>
      <HistoricalCustomerOnboarding leadType={leadType} />
      {handoffs.data && handoffs.data.length > 0 ? (
        <HandoffStrip leadType={leadType} items={handoffs.data} />
      ) : null}
      <div className="customer-intake-grid">
        <LeadCreateCard
          leadType={leadType}
          channels={channels.data ?? []}
          handoffs={handoffs.data ?? []}
        />
        {buyer ? (
          <Card className="customer-intake-list">
            <h3>正式买家客户登记</h3>
            {leads.isPending ? (
              <p role="status">加载中…</p>
            ) : leads.isError ? (
              <Alert tone="danger">客户记录暂时加载不了。</Alert>
            ) : leads.data.items.length === 0 ? (
              <EmptyState title="暂无买家客户" description="加微信后在左侧保存新客户。" />
            ) : (
              <DataTable caption="买家客户与业务进度">
                <thead>
                  <tr>
                    <th>客户</th>
                    <th>站点</th>
                    <th>渠道</th>
                    <th>业务进度</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.data.items.map((lead) => (
                    <tr key={lead.lead_id}>
                      <td>
                        <strong>{lead.display_name ?? lead.wechat_masked}</strong>
                        <small>{lead.wechat_masked}</small>
                      </td>
                      <td>{marketLabel(lead.marketplace_code)}</td>
                      <td>
                        <StatusBadge tone="neutral">{lead.channel_label}</StatusBadge>
                      </td>
                      <td>{`${lead.registered ? '网站已开通' : '网站未开通'} · ${lead.formal_order_count} 单`}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </Card>
        ) : (
          <Card className="customer-intake-list">
            <h3>
              全部卖家客户{sellerDirectory.data ? `（${sellerDirectory.data.length} 个）` : ''}
            </h3>
            <RateSummaryCard
              organizationId={sellerDirectory.data?.[0]?.seller_organization_id ?? null}
            />
            {sellerDirectory.isPending ? (
              <p role="status">加载中…</p>
            ) : sellerDirectory.isError ? (
              <Alert tone="danger">卖家客户目录暂时加载不了。</Alert>
            ) : sellerDirectory.data.length === 0 ? (
              <EmptyState
                title="暂无卖家客户"
                description="历史资料导入或新增客户后会显示在这里。"
              />
            ) : (
              <DataTable caption="卖家客户、合作产品、历史来源与网站账号">
                <thead>
                  <tr>
                    <th>客户</th>
                    <th>站点</th>
                    <th>合作产品</th>
                    <th>来源</th>
                    <th>网站账号</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sellerDirectory.data.map((seller) => (
                    <tr key={seller.seller_organization_id}>
                      <td>
                        <strong>{seller.display_name}</strong>
                        <small>{seller.wechat_masked}</small>
                      </td>
                      <td>{marketLabel(seller.marketplace_code)}</td>
                      <td>
                        {seller.product_names.length > 0
                          ? seller.product_names.join('、')
                          : '未录入产品'}
                      </td>
                      <td>
                        {seller.source_status === 'HISTORICAL_FROZEN_IMPORT' ? (
                          <StatusBadge tone="neutral">
                            历史资料 · {seller.source_file_count} 个文件
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="success">当前 / 新增</StatusBadge>
                        )}
                      </td>
                      <td>{seller.has_portal_account ? '已开通' : '未开通'}</td>
                      <td>
                        <div className="customer-registration-success">
                          <SellerPortalAccessAction seller={seller} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </Card>
        )}
      </div>
    </main>
  );
}

function HistoricalCustomerOnboarding({ leadType }: { leadType: 'BUYER' | 'SELLER' }) {
  const client = useQueryClient();
  const buyer = leadType === 'BUYER';
  const [wechat, setWechat] = useState('');
  const [invitation, setInvitation] = useState<InvitationState | null>(null);
  const [resetTarget, setResetTarget] = useState<HistoricalMatch | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const lookup = useMutation({
    mutationFn: (value: string) =>
      identityApiRequest('staff', client, {
        path: `/api/staff/customer-onboarding/lookup?customer_type=${leadType}&wechat_id=${encodeURIComponent(value)}`,
        method: 'GET',
        schema: lookupSchema,
      }),
  });
  const invite = useMutation({
    mutationFn: async (match: HistoricalMatch) => {
      if (buyer) {
        const response = await issueHistoricalBuyerInvite(client, wechat, match.marketplace_code);
        return toInvitation('BUYER', response.data.invitation);
      }
      const current = await readCurrentSellerInvitation(client, {
        sellerOrganizationId: match.subject_id,
        leadId: null,
      });
      if (current.data.invitation?.status === 'ACTIVE')
        return toExistingSellerInvitation(current.data.invitation);
      const response = await issueSellerInvite(client, {
        leadId: null,
        sellerOrganizationId: match.subject_id,
        wechatId: wechat,
        marketplaceCode: match.marketplace_code,
      });
      return toInvitation('SELLER', response.data.invitation);
    },
    onSuccess: setInvitation,
  });
  const revoke = useMutation({
    mutationFn: (state: InvitationState) => revokeInvitation(client, state),
    onSuccess: () =>
      setInvitation((current) =>
        current ? { ...current, status: 'REVOKED', link: '', recoverable: false } : current,
      ),
  });
  const reset = useMutation({
    mutationFn: ({ match, note }: { match: HistoricalMatch; note: string }) =>
      issueScopedReset(client, match, note),
    onSuccess: (response) =>
      setResetLink(`${window.location.origin}${response.data.password_reset.reset_path}`),
  });
  const report = useMutation({
    mutationFn: (marketplaceCode: string) =>
      reportIdentityConflict(client, { customerType: leadType, marketplaceCode, wechatId: wechat }),
    onSuccess: () => void lookup.mutate(wechat),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInvitation(null);
    setResetLink(null);
    setResetTarget(null);
    const value = String(new FormData(event.currentTarget).get('wechat_id') ?? '').trim();
    setWechat(value);
    if (value) lookup.mutate(value);
  }
  const data = lookup.data?.data;
  const matches = data?.matches ?? [];
  const ambiguousMarkets = ambiguousMarketplaceCodes(matches);
  return (
    <Card className="historical-customer-onboarding">
      <div className="staff-section-toolbar">
        <div>
          <h3>历史客户 / 已有客户查询</h3>
          <p>先查微信，避免重复新增；已开通账号也从这里做密码恢复。</p>
        </div>
        <StatusBadge tone="neutral">不计新增客户</StatusBadge>
      </div>
      <form onSubmit={submit} className="historical-customer-search">
        <FormField label="微信号" htmlFor={`${leadType}-historical-wechat`}>
          <TextInput
            id={`${leadType}-historical-wechat`}
            name="wechat_id"
            autoComplete="off"
            required
          />
        </FormField>
        <Button className="secondary" loading={lookup.isPending}>
          查询已有客户
        </Button>
      </form>
      {data?.manual_resolution_applied ? (
        <Alert tone="success">已应用总管理员确认过的历史身份绑定。</Alert>
      ) : null}
      {data?.resolution_required ? (
        <Alert tone="warning">
          同一站点匹配到多个历史客户，已停止账号操作。请提交总管理员核对，普通员工不要选择其中任何一个。
        </Alert>
      ) : null}
      {ambiguousMarkets.map((market) => (
        <Button
          key={market}
          className="secondary"
          loading={report.isPending}
          onClick={() => report.mutate(market)}
        >
          提交 {marketLabel(market)} 身份冲突给总管理员
        </Button>
      ))}
      {lookup.isSuccess && !data?.resolution_required && matches.length === 0 ? (
        <Alert tone="info">
          没有找到已有{buyer ? '买家' : '卖家'}客户，可以按下方“新客户”流程保存。
        </Alert>
      ) : null}
      {!data?.resolution_required
        ? matches.map((match) => (
            <div
              className="historical-customer-result"
              key={`${match.customer_type}:${match.marketplace_code}:${match.subject_id}`}
            >
              <div>
                <strong>{match.display_name}</strong>
                <p>
                  {marketLabel(match.marketplace_code)} · 历史订单 {match.historical_order_count} 单
                  · 历史客户 / 来源未知
                </p>
              </div>
              <div className="entry-actions">
                {match.has_portal_account ? (
                  <>
                    <StatusBadge tone="success">网站账号已开通</StatusBadge>
                    <Button
                      className="secondary"
                      onClick={() => {
                        setResetTarget(match);
                        setResetLink(null);
                      }}
                    >
                      密码恢复
                    </Button>
                  </>
                ) : (
                  <Button loading={invite.isPending} onClick={() => invite.mutate(match)}>
                    {buyer ? '开通买家网站' : '检查 / 开通卖家网站'}
                  </Button>
                )}
              </div>
            </div>
          ))
        : null}
      {invitation ? (
        <InvitationResult
          state={invitation}
          revokeBusy={revoke.isPending}
          onRevoke={() => revoke.mutate(invitation)}
          onClear={() => setInvitation(null)}
        />
      ) : null}
      {resetTarget ? (
        <PasswordResetForm
          target={resetTarget}
          busy={reset.isPending}
          link={resetLink}
          onSubmit={(note) => reset.mutate({ match: resetTarget, note })}
          onClose={() => {
            setResetTarget(null);
            setResetLink(null);
          }}
        />
      ) : null}
      {invite.isError || reset.isError ? (
        <Alert tone="danger">操作未完成。若页面提示身份冲突，请提交总管理员处理。</Alert>
      ) : null}
    </Card>
  );
}

function LeadCreateCard({
  leadType,
  channels,
  handoffs,
}: {
  leadType: 'BUYER' | 'SELLER';
  channels: readonly AcquisitionChannel[];
  handoffs: readonly AcquisitionHandoff[];
}) {
  const client = useQueryClient();
  const session = useCurrentStaffSession();
  const buyer = leadType === 'BUYER';
  const [handoffId, setHandoffId] = useState('');
  const [marketplaceCode, setMarketplaceCode] = useState('');
  const [saved, setSaved] = useState<SavedLead | null>(null);
  const [invitation, setInvitation] = useState<InvitationState | null>(null);
  const handoff = handoffs.find((item) => item.prospect_id === handoffId) ?? null;
  const eligibleChannels = channels.filter(
    (channel) =>
      channel.status === 'ACTIVE' &&
      (channel.lead_type === leadType || channel.lead_type === 'BOTH') &&
      (channel.visibility === 'STAFF' || channel.intake_wechat_label !== null),
  );
  const markets = useMemo(() => {
    if (session.data_scope.type !== 'GLOBAL' && session.data_scope.marketplaceCodes.length > 0)
      return session.data_scope.marketplaceCodes;
    return [...new Set(eligibleChannels.map((channel) => channel.marketplace_code))];
  }, [eligibleChannels, session.data_scope.marketplaceCodes, session.data_scope.type]);
  const marketplaceChannels = useMemo(
    () => eligibleChannels.filter((channel) => channel.marketplace_code === marketplaceCode),
    [eligibleChannels, marketplaceCode],
  );
  useEffect(() => {
    if (handoff || markets.includes(marketplaceCode)) return;
    setMarketplaceCode(markets[0] ?? '');
  }, [handoff, marketplaceCode, markets]);
  const create = useMutation({
    mutationFn: (input: { body: unknown; draft: Omit<SavedLead, 'leadId'> }) =>
      acquisitionApi
        .createLead(client, input.body, crypto.randomUUID())
        .then((response) => ({ response, draft: input.draft })),
    onSuccess: ({ response, draft }) => {
      setSaved({ leadId: response.data.lead.lead_id, ...draft });
      setInvitation(null);
      void client.invalidateQueries({ queryKey: ['staff', 'customer-intake'] });
    },
    onError: (error) => {
      if (isFrontendApiError(error) && error.code === 'DUPLICATE_LEAD') {
        void client.invalidateQueries({ queryKey: ['staff', 'customer-intake'] });
      }
    },
  });
  const invite = useMutation({
    mutationFn: async (value: SavedLead) => {
      if (buyer) {
        const response = await issueNewBuyerInvite(client, value);
        return toInvitation('BUYER', response.data.invitation);
      }
      const current = await readCurrentSellerInvitation(client, {
        sellerOrganizationId: null,
        leadId: value.leadId,
      });
      if (current.data.invitation?.status === 'ACTIVE')
        return toExistingSellerInvitation(current.data.invitation);
      const response = await issueSellerInvite(client, {
        leadId: value.leadId,
        sellerOrganizationId: null,
        wechatId: value.wechatId,
        marketplaceCode: value.marketplaceCode,
      });
      return toInvitation('SELLER', response.data.invitation);
    },
    onSuccess: setInvitation,
  });
  const revoke = useMutation({
    mutationFn: (state: InvitationState) => revokeInvitation(client, state),
    onSuccess: () =>
      setInvitation((current) =>
        current ? { ...current, status: 'REVOKED', link: '', recoverable: false } : current,
      ),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(null);
    setInvitation(null);
    const form = event.currentTarget,
      data = new FormData(form);
    const selected =
      handoffs.find((item) => item.prospect_id === String(data.get('handoff_id'))) ?? null;
    const marketplaceCode = selected?.marketplace_code ?? String(data.get('marketplace_code'));
    const wechatId = String(data.get('wechat_id'));
    const displayName = String(data.get('display_name') ?? '').trim() || wechatId;
    create.mutate(
      {
        body: {
          lead_type: leadType,
          marketplace_code: marketplaceCode,
          channel_id: selected?.origin_channel_id ?? String(data.get('channel_id')),
          prospect_id: selected?.prospect_id ?? null,
          wechat_id: wechatId,
          display_name: nullable(data.get('display_name')),
          note: nullable(data.get('note')),
        },
        draft: { wechatId, marketplaceCode, displayName },
      },
      {
        onSuccess: () => {
          form.reset();
          setHandoffId('');
        },
      },
    );
  }
  return (
    <Card className="customer-intake-create">
      <h3>新{buyer ? '买家' : '卖家'}客户</h3>
      <p>
        保存成功就计入新增客户；{buyer ? '买家' : '卖家'}网站账号是否开通是后续独立步骤。
      </p>
      <form onSubmit={submit}>
        {handoffs.length > 0 ? (
          <FormField
            label="待接入客户（可选）"
            htmlFor={`${leadType}-handoff`}
            description="获客岗位交接的客户会自动继承渠道编号"
          >
            <Select
              id={`${leadType}-handoff`}
              name="handoff_id"
              value={handoffId}
              onChange={(event) => setHandoffId(event.target.value)}
            >
              <option value="">不是交接客户</option>
              {handoffs.map((item) => (
                <option key={item.prospect_id} value={item.prospect_id}>
                  {item.display_name} · {item.channel_label}
                </option>
              ))}
            </Select>
          </FormField>
        ) : (
          <input type="hidden" name="handoff_id" value="" />
        )}
        <FormField label="站点" htmlFor={`${leadType}-market`}>
          {handoff ? (
            <>
              <input type="hidden" name="marketplace_code" value={handoff.marketplace_code} />
              <TextInput
                id={`${leadType}-market`}
                value={marketLabel(handoff.marketplace_code)}
                readOnly
              />
            </>
          ) : (
            <Select
              id={`${leadType}-market`}
              name="marketplace_code"
              value={marketplaceCode}
              onChange={(event) => setMarketplaceCode(event.target.value)}
              disabled={markets.length === 0}
              required
            >
              {markets.length === 0 ? <option value="">暂无可用站点</option> : null}
              {markets.map((market) => (
                <option key={market} value={market}>
                  {marketLabel(market)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        {!handoff && marketplaceChannels.length === 0 ? (
          <Alert tone="warning">
            当前没有可用的{buyer ? '买家' : '卖家'}接入渠道，请先在“客户开发”配置渠道。
          </Alert>
        ) : null}
        <FormField label="渠道" htmlFor={`${leadType}-channel`}>
          {handoff ? (
            <>
              <input type="hidden" name="channel_id" value={handoff.origin_channel_id} />
              <TextInput id={`${leadType}-channel`} value={handoff.channel_label} readOnly />
            </>
          ) : (
            <Select
              id={`${leadType}-channel`}
              name="channel_id"
              disabled={marketplaceCode.length === 0}
              required
            >
              <option value="">请选择渠道</option>
              {marketplaceChannels.map((channel) => (
                <option key={channel.channel_id} value={channel.channel_id}>
                  {channel.staff_label}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label="微信号" htmlFor={`${leadType}-wechat`}>
          <TextInput id={`${leadType}-wechat`} name="wechat_id" required autoComplete="off" />
        </FormField>
        <FormField
          label="客户编号"
          htmlFor={`${leadType}-name`}
          description="线下台账里的客户编号"
        >
          <TextInput id={`${leadType}-name`} name="display_name" required />
        </FormField>
        <FormField label="备注（可选）" htmlFor={`${leadType}-note`}>
          <TextInput id={`${leadType}-note`} name="note" />
        </FormField>
        <Button
          loading={create.isPending}
          disabled={!handoff && (marketplaceCode.length === 0 || marketplaceChannels.length === 0)}
        >
          保存新{buyer ? '买家' : '卖家'}客户
        </Button>
        {create.isError ? (
          <Alert tone={isDuplicateLeadError(create.error) ? 'warning' : 'danger'}>
            {isDuplicateLeadError(create.error)
              ? '这个微信在当前站点已经保存过，不需要重复新增。请查看右侧客户目录，或使用上方历史客户查询。'
              : '保存未完成。如果这个微信在当前站点属于历史客户，请使用上方历史客户查询。'}
          </Alert>
        ) : null}
      </form>
      {saved ? (
        <div className="customer-registration-success">
          <Alert tone="success">
            <strong>{saved.displayName}</strong> 已成功登记。
            {buyer ? '买家客户已保存。' : '卖家客户已保存，卖家组织同步建立。'}{' '}
            网站账号可以现在开通，也可以以后再开。
          </Alert>
          <Button loading={invite.isPending} onClick={() => invite.mutate(saved)}>
            检查 / 生成{buyer ? '买家' : '卖家'}注册链接
          </Button>
        </div>
      ) : null}
      {invitation ? (
        <InvitationResult
          state={invitation}
          revokeBusy={revoke.isPending}
          onRevoke={() => revoke.mutate(invitation)}
          onClear={() => setInvitation(null)}
        />
      ) : null}
      {invite.isError ? (
        <Alert tone="danger">
          注册链接操作失败；如果客户已经有网站账号或身份存在冲突，请先查询历史客户。
        </Alert>
      ) : null}
    </Card>
  );
}

function isDuplicateLeadError(error: unknown): boolean {
  return isFrontendApiError(error) && error.code === 'DUPLICATE_LEAD';
}

function SellerPortalAccessAction({ seller }: { seller: SellerDirectoryItem }) {
  const client = useQueryClient();
  const [invitation, setInvitation] = useState<InvitationState | null>(null);
  const invite = useMutation({
    mutationFn: async () => {
      const current = await readCurrentSellerInvitation(client, {
        sellerOrganizationId: seller.seller_organization_id,
        leadId: null,
      });
      if (current.data.invitation?.status === 'ACTIVE') {
        return toExistingSellerInvitation(current.data.invitation);
      }
      const response = await issueSellerInvite(client, {
        leadId: null,
        sellerOrganizationId: seller.seller_organization_id,
        wechatId: seller.wechat_masked,
        marketplaceCode: seller.marketplace_code,
      });
      return toInvitation('SELLER', response.data.invitation);
    },
    onSuccess: setInvitation,
  });
  const revoke = useMutation({
    mutationFn: (state: InvitationState) => revokeInvitation(client, state),
    onSuccess: () =>
      setInvitation((current) =>
        current ? { ...current, status: 'REVOKED', link: '', recoverable: false } : current,
      ),
  });
  if (seller.has_portal_account) return null;
  return (
    <div className="customer-registration-success">
      <Button type="button" loading={invite.isPending} onClick={() => invite.mutate()}>
        生成卖家开通链接
      </Button>
      {invitation ? (
        <InvitationResult
          state={invitation}
          revokeBusy={revoke.isPending}
          onRevoke={() => revoke.mutate(invitation)}
          onClear={() => setInvitation(null)}
        />
      ) : null}
      {invite.isError || revoke.isError ? (
        <Alert tone="danger">开通链接操作未完成，请重试。</Alert>
      ) : null}
    </div>
  );
}

function InvitationResult({
  state,
  revokeBusy,
  onRevoke,
  onClear,
}: {
  state: InvitationState;
  revokeBusy: boolean;
  onRevoke: () => void;
  onClear: () => void;
}) {
  if (state.status === 'REVOKED')
    return (
      <Alert tone="info">
        原注册链接已撤销。再次点击上方的生成按钮即可生成一条全新的链接。
      </Alert>
    );
  if (!state.recoverable)
    return (
      <div className="customer-registration-success">
        <Alert tone="warning">
          系统中已经存在一个仍有效的卖家邀请。出于安全设计，原注册链接明文不会被保存，也无法恢复。请先撤销旧邀请，再重新生成新链接。
        </Alert>
        <div className="entry-actions">
          <Button className="danger" loading={revokeBusy} onClick={onRevoke}>
            撤销旧邀请
          </Button>
          <Button className="secondary" onClick={onClear}>
            暂不处理
          </Button>
        </div>
      </div>
    );
  return (
    <div className="customer-registration-success">
      <FormField
        label={`${state.kind === 'BUYER' ? '买家' : '卖家'}注册链接`}
        htmlFor={`invite-${state.id}`}
        description="7 天一次有效；复制后通过私人微信发送"
      >
        <TextInput id={`invite-${state.id}`} value={state.link} readOnly />
      </FormField>
      <div className="entry-actions">
        <Button className="danger" loading={revokeBusy} onClick={onRevoke}>
          撤销此链接
        </Button>
        <Button className="secondary" onClick={onClear}>
          我已复制
        </Button>
      </div>
    </div>
  );
}
function PasswordResetForm({
  target,
  busy,
  link,
  onSubmit,
  onClose,
}: {
  target: HistoricalMatch;
  busy: boolean;
  link: string | null;
  onSubmit: (note: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  return (
    <div className="customer-registration-success">
      <h4>{target.display_name} · 密码恢复</h4>
      <Alert tone="warning">
        密码属于月光白登录账号。如果该账号同时拥有买家和卖家身份，修改密码会同时影响这些身份的旧登录会话。
      </Alert>
      <FormField
        label="人工核验记录"
        htmlFor={`reset-${target.subject_id}`}
        description="写明核验时间和依据，至少 8 个字"
      >
        <TextInput
          id={`reset-${target.subject_id}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </FormField>
      {link ? (
        <FormField label="一次性密码恢复链接" htmlFor={`reset-link-${target.subject_id}`}>
          <TextInput id={`reset-link-${target.subject_id}`} value={link} readOnly />
        </FormField>
      ) : (
        <Button loading={busy} disabled={note.trim().length < 8} onClick={() => onSubmit(note)}>
          生成密码恢复链接
        </Button>
      )}
      <Button className="secondary" onClick={onClose}>
        关闭
      </Button>
    </div>
  );
}

async function issueHistoricalBuyerInvite(
  client: ReturnType<typeof useQueryClient>,
  wechatId: string,
  marketplaceCode: string,
) {
  const body = { wechat_id: wechatId, marketplace_code: marketplaceCode };
  return identityApiRequest('staff', client, {
    path: '/api/staff/customer-security/buyer-invitations',
    method: 'POST',
    schema: buyerInvitationSchema,
    body,
    headers: operationHeaders({ key: crypto.randomUUID(), body }),
  });
}
async function issueNewBuyerInvite(client: ReturnType<typeof useQueryClient>, value: SavedLead) {
  const body = {
    lead_id: value.leadId,
    wechat_id: value.wechatId,
    marketplace_code: value.marketplaceCode,
  };
  return identityApiRequest('staff', client, {
    path: '/api/staff/customer-onboarding/buyer-registration-invitations',
    method: 'POST',
    schema: buyerInvitationSchema,
    body,
    headers: operationHeaders({ key: crypto.randomUUID(), body }),
  });
}
async function issueSellerInvite(
  client: ReturnType<typeof useQueryClient>,
  input: {
    leadId: string | null;
    sellerOrganizationId: string | null;
    wechatId: string;
    marketplaceCode: string;
  },
) {
  const body = {
    lead_id: input.leadId,
    seller_organization_id: input.sellerOrganizationId,
    wechat_id: input.wechatId,
    marketplace_code: input.marketplaceCode,
  };
  return identityApiRequest('staff', client, {
    path: '/api/staff/customer-security/seller-invitations',
    method: 'POST',
    schema: sellerInvitationSchema,
    body,
    headers: operationHeaders({ key: crypto.randomUUID(), body }),
  });
}
async function readCurrentSellerInvitation(
  client: ReturnType<typeof useQueryClient>,
  input: { leadId: string | null; sellerOrganizationId: string | null },
) {
  const query = new URLSearchParams();
  if (input.leadId) query.set('lead_id', input.leadId);
  if (input.sellerOrganizationId) query.set('seller_organization_id', input.sellerOrganizationId);
  return identityApiRequest('staff', client, {
    path: `/api/staff/customer-security/seller-invitations/current?${query}`,
    method: 'GET',
    schema: currentSellerInvitationSchema,
  });
}
async function revokeInvitation(client: ReturnType<typeof useQueryClient>, state: InvitationState) {
  const body = { expected_version: state.version };
  return identityApiRequest('staff', client, {
    path: `/api/staff/customer-security/${state.kind === 'BUYER' ? 'buyer' : 'seller'}-invitations/${encodeURIComponent(state.id)}/revoke`,
    method: 'POST',
    schema: revokeSchema,
    body,
    headers: operationHeaders({ key: crypto.randomUUID(), body }),
  });
}
async function issueScopedReset(
  client: ReturnType<typeof useQueryClient>,
  match: HistoricalMatch,
  note: string,
) {
  const body = { verification_note: note };
  return identityApiRequest('staff', client, {
    path: `/api/staff/customer-onboarding/${match.customer_type}/${encodeURIComponent(match.subject_id)}/password-reset`,
    method: 'POST',
    schema: resetSchema,
    body,
    headers: operationHeaders({ key: crypto.randomUUID(), body }),
  });
}
async function reportIdentityConflict(
  client: ReturnType<typeof useQueryClient>,
  input: { customerType: 'BUYER' | 'SELLER'; marketplaceCode: string; wechatId: string },
) {
  const body = {
    customer_type: input.customerType,
    marketplace_code: input.marketplaceCode,
    wechat_id: input.wechatId,
    reason_code: 'AMBIGUOUS_HISTORY',
    note: '员工查询历史客户时同一站点匹配到多个业务主体，请总管理员人工核对。',
  };
  return identityApiRequest('staff', client, {
    path: '/api/staff/customer-identity-resolution/cases',
    method: 'POST',
    schema: resolutionCaseSchema,
    body,
    headers: operationHeaders({ key: crypto.randomUUID(), body }),
  });
}
function toInvitation(
  kind: 'BUYER' | 'SELLER',
  value: { invitation_id: string; registration_path: string; version: number },
) {
  return {
    kind,
    id: value.invitation_id,
    version: value.version,
    link: `${window.location.origin}${value.registration_path}`,
    status: 'ACTIVE' as const,
    recoverable: true,
  };
}
function toExistingSellerInvitation(
  value: z.output<typeof currentSellerInvitationSchema>['invitation'],
) {
  if (!value) throw new Error('seller_invitation_missing');
  return {
    kind: 'SELLER' as const,
    id: value.invitation_id,
    version: value.version,
    link: '',
    status: 'ACTIVE' as const,
    recoverable: false,
  };
}
function ambiguousMarketplaceCodes(matches: readonly HistoricalMatch[]) {
  const map = new Map<string, Set<string>>();
  for (const match of matches) {
    const set = map.get(match.marketplace_code) ?? new Set<string>();
    set.add(match.subject_id);
    map.set(match.marketplace_code, set);
  }
  return [...map.entries()].filter(([, set]) => set.size > 1).map(([market]) => market);
}
function HandoffStrip({
  leadType,
  items,
}: {
  leadType: 'BUYER' | 'SELLER';
  items: readonly AcquisitionHandoff[];
}) {
  return (
    <section className="customer-handoff-strip">
      <div>
        <strong>待人工接入 {items.length}</strong>
        <span>
          获客岗位已筛选并交给{leadType === 'BUYER' ? '售前' : '卖家对接'}；这里只显示渠道编号。
        </span>
      </div>
      <div>
        {items.slice(0, 4).map((item) => (
          <span className="handoff-chip" key={item.prospect_id}>
            {item.display_name} · {item.channel_label}
          </span>
        ))}
      </div>
    </section>
  );
}
function nullable(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  return text ? text : null;
}
function marketLabel(code: string) {
  return MARKET_LABELS[code] ?? '未命名站点';
}
