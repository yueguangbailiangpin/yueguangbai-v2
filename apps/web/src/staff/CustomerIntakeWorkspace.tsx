import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { z } from 'zod';
import { identityApiRequest } from '../api/identity-request';
import { operationHeaders } from '../api/idempotency';
import { isFrontendApiError } from '../api/errors';
import { useCurrentStaffSession } from '../auth/staff/StaffSessionBoundary';
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
} from '../ui/primitives';
import { RateSummaryCard } from './shared/RateSummaryCard';
import { formatShanghai } from './shared/format';

const MARKET_LABELS: Record<string, string> = {
  AMAZON_JP: '亚马逊日本站',
  AMAZON_US: '亚马逊美国站',
  COUPANG_KR: 'Coupang 韩国站',
};
const matchSchema = z
  .object({
    customer_type: z.enum(['BUYER', 'SELLER']),
    subject_id: z.string(),
    display_name: z.string(),
    customer_number: z.string().nullable(),
    marketplace_code: z.string(),
    has_portal_account: z.boolean(),
    historical_order_count: z.number().int().nonnegative(),
    orders: z.array(z.object({
      formal_order_id: z.string(),
      product_name: z.string(),
      platform_order_identifier: z.string().nullable(),
      confirmed_at: z.number().int().nonnegative(),
    }).strict()).default([]),
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
const createBuyerResultSchema = z
  .object({
    buyer_customer: z
      .object({
        buyer_customer_id: z.string(),
        buyer_number: z.string(),
        access_status: z.string(),
        activated: z.boolean(),
        initial_pre_sales_owner: z
          .object({
            assignment_id: z.string(),
            staff_id: z.string(),
            staff_display_name: z.string(),
            version: z.number().int().positive(),
          })
          .nullable(),
      })
      .strict(),
    replayed: z.boolean(),
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
type InvitationState = {
  kind: 'BUYER' | 'SELLER';
  id: string;
  version: number;
  link: string;
  status: 'ACTIVE' | 'REVOKED';
  recoverable: boolean;
};

export function BuyerCustomersWorkspace(): React.JSX.Element {
  return <CustomerManagementWorkspace customerKind="BUYER" />;
}
export function SellerCustomersWorkspace(): React.JSX.Element {
  return <CustomerManagementWorkspace customerKind="SELLER" />;
}

/**
 * 买家管理 / 卖家管理（D-056：获客中心与线索体系退役后的客户接入）：
 * 先查历史客户避免重复，再为新客户生成注册链接；买家编号在受邀注册
 * 建档时立即生成并永久保留。
 */
function CustomerManagementWorkspace({
  customerKind,
}: {
  customerKind: 'BUYER' | 'SELLER';
}): React.JSX.Element {
  const session = useCurrentStaffSession();
  const buyer = customerKind === 'BUYER';
  const allowed =
    session.role.code === 'owner' ||
    (buyer ? session.role.code === 'pre_sales' : session.role.code === 'seller_ops');
  const client = useQueryClient();
  const sellerDirectory = useQuery({
    queryKey: ['staff', 'customer-management', 'seller-directory', session.authorization_version],
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
          <p className="eyebrow">{buyer ? '买家管理' : '卖家管理'}</p>
          <h2>{buyer ? '买家客户' : '卖家客户'}</h2>
          <p>先查历史客户，再邀请新客户。账号开通、密码恢复都从具体客户记录发起。</p>
        </div>
      </header>
      <Alert tone="info">
        历史客户不重复建档；身份不明确时提交总管理员处理，不要自行猜测绑定。
      </Alert>
      <HistoricalCustomerLookup customerKind={customerKind} />
      <div className="customer-intake-grid">
        <NewCustomerCard customerKind={customerKind} />
        {buyer ? (
          <Card className="customer-intake-list">
            <h3>买家客户列表</h3>
            <EmptyState
              title="客户列表随阶段 7A-2 工作台上线"
              description="先为左侧新客户生成注册链接；完整客户列表与业务进度视图在工作台重构后提供。"
            />
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

function HistoricalCustomerLookup({ customerKind }: { customerKind: 'BUYER' | 'SELLER' }) {
  const client = useQueryClient();
  const buyer = customerKind === 'BUYER';
  const [wechat, setWechat] = useState('');
  const [invitation, setInvitation] = useState<InvitationState | null>(null);
  const [resetTarget, setResetTarget] = useState<HistoricalMatch | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const lookup = useMutation({
    mutationFn: (value: string) =>
      identityApiRequest('staff', client, {
        path: `/api/staff/customer-onboarding/lookup?customer_type=${customerKind}&wechat_id=${encodeURIComponent(value)}`,
        method: 'GET',
        schema: lookupSchema,
      }),
  });
  const invite = useMutation({
    mutationFn: async (match: HistoricalMatch) => {
      if (buyer) {
        const response = await issueBuyerInvitation(client, {
          buyerCustomerId: match.subject_id,
          wechatId: wechat,
          marketplaceCode: match.marketplace_code,
        });
        return toInvitation('BUYER', response.data.invitation);
      }
      const current = await readCurrentSellerInvitation(client, match.subject_id);
      if (current.data.invitation?.status === 'ACTIVE')
        return toExistingSellerInvitation(current.data.invitation);
      const response = await issueSellerInvite(client, {
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
      reportIdentityConflict(client, { customerType: customerKind, marketplaceCode, wechatId: wechat }),
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
          <p>先查微信，避免重复建档；已开通账号也从这里做密码恢复。</p>
        </div>
        <StatusBadge tone="neutral">不计新增客户</StatusBadge>
      </div>
      <form onSubmit={submit} className="historical-customer-search">
        <FormField label="微信号" htmlFor={`${customerKind}-historical-wechat`}>
          <TextInput
            id={`${customerKind}-historical-wechat`}
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
          没有找到已有{buyer ? '买家' : '卖家'}客户，可以按下方“邀请新客户”流程生成注册链接。
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
                  {match.customer_number !== null ? `客户编码 ${match.customer_number} · ` : ''}
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
              {match.customer_type === 'BUYER' ? (
                <BuyerOrderHistory match={match} />
              ) : null}
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

function NewCustomerCard({ customerKind }: { customerKind: 'BUYER' | 'SELLER' }) {
  const client = useQueryClient();
  const session = useCurrentStaffSession();
  const buyer = customerKind === 'BUYER';
  const [marketplaceCode, setMarketplaceCode] = useState('');
  const [wechatId, setWechatId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [invitation, setInvitation] = useState<InvitationState | null>(null);
  const [registeredNote, setRegisteredNote] = useState<string | null>(null);
  const markets = useMemo(() => {
    if (session.data_scope.type !== 'GLOBAL' && session.data_scope.marketplaceCodes.length > 0)
      return session.data_scope.marketplaceCodes;
    return ['AMAZON_JP'];
  }, [session.data_scope.marketplaceCodes, session.data_scope.type]);
  const [buyerChannelId, setBuyerChannelId] = useState('buyer-channel-wechat-b');
  const [createdBuyer, setCreatedBuyer] = useState<z.output<typeof createBuyerResultSchema>['buyer_customer'] | null>(null);
  const createBuyer = useMutation({
    mutationFn: () =>
      createBuyerCustomerProfile(client, {
        displayName: displayName.trim(),
        wechatId: wechatId.trim(),
        buyerChannelId,
        marketplaceCode,
      }),
    onSuccess: (response) => setCreatedBuyer(response.data.buyer_customer),
  });
  const invite = useMutation({
    mutationFn: async () => {
      if (buyer) {
        if (!createdBuyer) throw new Error('buyer_profile_required');
        const response = await issueBuyerInvitation(client, {
          buyerCustomerId: createdBuyer.buyer_customer_id,
          wechatId: wechatId.trim(),
          marketplaceCode,
        });
        return toInvitation('BUYER', response.data.invitation);
      }
      const response = await issueSellerInvite(client, {
        sellerOrganizationId: null,
        wechatId,
        marketplaceCode,
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
    setInvitation(null);
    setRegisteredNote(null);
    if (buyer) {
      setCreatedBuyer(null);
      createBuyer.mutate(undefined, {
        onSuccess: () => {
          setRegisteredNote(
            '买家档案已建立，永久买家编号已分配。下方“签发注册邀请”把链接发给买家本人完成激活。',
          );
        },
      });
      return;
    }
    invite.mutate(undefined, {
      onSuccess: () => {
        setRegisteredNote('卖家通过链接完成注册后即建立卖家组织与成员账号。');
      },
    });
  }
  return (
    <Card className="customer-intake-create">
      <h3>录入新{buyer ? '买家' : '卖家'}客户</h3>
      <p>
        {buyer
          ? '先建立买家档案：编号（录入日期 + 渠道码 + 流水号）建档即分配，之后可为该买家签发注册邀请。'
          : '生成一次性注册链接并通过私人微信发送。'}
      </p>
      <form onSubmit={submit}>
        <FormField label="站点" htmlFor={`${customerKind}-market`}>
          <Select
            id={`${customerKind}-market`}
            value={marketplaceCode}
            onChange={(event) => setMarketplaceCode(event.target.value)}
            required
          >
            {markets.map((market) => (
              <option key={market} value={market}>
                {marketLabel(market)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="微信号" htmlFor={`${customerKind}-wechat`}>
          <TextInput
            id={`${customerKind}-wechat`}
            value={wechatId}
            onChange={(event) => setWechatId(event.target.value)}
            required
            autoComplete="off"
          />
        </FormField>
        <FormField
          label={buyer ? '买家名称' : '线下备注名（可选）'}
          htmlFor={`${customerKind}-name`}
          description={buyer
            ? '用于识别买家；系统会立即分配永久买家编号'
            : '仅帮助员工识别，客户编号以系统生成结果为准'}
        >
          <TextInput
            id={`${customerKind}-name`}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required={buyer}
          />
        </FormField>
        {buyer ? (
          <FormField label="来源渠道" htmlFor="buyer-channel">
            <Select
              id="buyer-channel"
              value={buyerChannelId}
              onChange={(event) => setBuyerChannelId(event.target.value)}
            >
              <option value="buyer-channel-wechat-b">微信对接渠道 B</option>
              <option value="buyer-channel-wechat-c">微信对接渠道 C</option>
            </Select>
          </FormField>
        ) : null}
        {buyer ? (
          <>
            <Button
              loading={createBuyer.isPending}
              disabled={
                marketplaceCode.length === 0
                || wechatId.trim().length === 0
                || displayName.trim().length === 0
              }
            >
              建立买家档案
            </Button>
            {createBuyer.isError ? (
              <Alert tone={isDuplicateCustomerError(createBuyer.error) ? 'warning' : 'danger'}>
                {isDuplicateCustomerError(createBuyer.error)
                  ? '这个微信在当前站点可能已经保存过。请先使用上方历史客户查询确认。'
                  : '买家建档未完成。请核对微信号、渠道与站点后重试。'}
              </Alert>
            ) : null}
          </>
        ) : (
          <>
            <Button
              loading={invite.isPending}
              disabled={marketplaceCode.length === 0 || wechatId.trim().length === 0}
            >
              生成卖家注册链接
            </Button>
            {invite.isError ? (
              <Alert tone="danger">注册链接生成未完成。如果这个微信在当前站点属于历史客户，请使用上方历史客户查询。</Alert>
            ) : null}
          </>
        )}
      </form>
      {createdBuyer ? (
        <Alert tone="success">
          <p>
            买家编号 <strong>{createdBuyer.buyer_number}</strong>
            （未激活，暂不能登录）
            {createdBuyer.initial_pre_sales_owner
              ? ` · 售前负责人 ${createdBuyer.initial_pre_sales_owner.staff_display_name}`
              : ''}
          </p>
          <Button
            className="secondary"
            loading={invite.isPending}
            onClick={() => invite.mutate(undefined)}
          >
            签发注册邀请
          </Button>
          {invite.isError ? (
            <p>邀请签发未完成，可稍后从该买家记录重试；买家编号保持不变。</p>
          ) : null}
        </Alert>
      ) : null}
      {registeredNote ? <Alert tone="info">{registeredNote}</Alert> : null}
      {invitation ? (
        <InvitationResult
          state={invitation}
          revokeBusy={revoke.isPending}
          onRevoke={() => revoke.mutate(invitation)}
          onClear={() => setInvitation(null)}
        />
      ) : null}
    </Card>
  );
}

function isDuplicateCustomerError(error: unknown): boolean {
  return (
    isFrontendApiError(error) &&
    (error.code === 'DUPLICATE_LEAD' || error.code === 'CONFLICT')
  );
}

function SellerPortalAccessAction({ seller }: { seller: SellerDirectoryItem }) {
  const client = useQueryClient();
  const [invitation, setInvitation] = useState<InvitationState | null>(null);
  const invite = useMutation({
    mutationFn: async () => {
      const current = await readCurrentSellerInvitation(client, seller.seller_organization_id);
      if (current.data.invitation?.status === 'ACTIVE') {
        return toExistingSellerInvitation(current.data.invitation);
      }
      const response = await issueSellerInvite(client, {
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
}): React.JSX.Element {
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
        <Button
          className="secondary"
          onClick={() => {
            // 一键复制（D1）：优先剪贴板 API，失败时回退选中只读输入框。
            void navigator.clipboard?.writeText(state.link).catch(() => {
              const input = document.getElementById(`invite-${state.id}`);
              if (input instanceof HTMLInputElement) input.select();
            });
          }}
        >
          一键复制链接
        </Button>
        <Button className="secondary" onClick={onClear}>
          我已发送
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

/** 买家历史订单只读列表；订单沟通截图在统一订单详情上传（D-056 §4.1）。 */
function BuyerOrderHistory({ match }: {
  match: HistoricalMatch;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (match.historical_order_count === 0 && match.orders.length === 0) return null;
  if (!open) {
    return <div className="buyer-order-history-toggle">
      <Button className="secondary" onClick={() => setOpen(true)}>
        查看历史订单（{match.historical_order_count} 单）
      </Button>
    </div>;
  }
  return <details className="buyer-order-history" open>
    <summary onClick={(event) => { event.preventDefault(); setOpen(false); }}>
      历史订单（最近 {match.orders.length} 单{match.historical_order_count > match.orders.length
        ? `，共 ${match.historical_order_count} 单` : ''}，点此收起）
    </summary>
    {match.orders.length === 0
      ? <p>暂无订单记录。</p>
      : <ul>
      {match.orders.map((order) => (
        <li key={order.formal_order_id}>
          <Link to={`/staff/orders/${encodeURIComponent(order.formal_order_id)}`}>
            {order.product_name}
            {order.platform_order_identifier ? ` · ${order.platform_order_identifier}` : ''}
          </Link>
          <small>{formatShanghai(order.confirmed_at)} 确认</small>
        </li>
      ))}
    </ul>}
    <p>沟通截图请在订单详情页上传与查看。</p>
  </details>;
}

async function issueBuyerInvitation(
  client: ReturnType<typeof useQueryClient>,
  input: { buyerCustomerId: string; wechatId: string; marketplaceCode: string },
) {
  const body = {
    buyer_customer_id: input.buyerCustomerId,
    wechat_id: input.wechatId,
    marketplace_code: input.marketplaceCode,
  };
  return identityApiRequest('staff', client, {
    path: '/api/staff/customer-onboarding/buyer-registration-invitations',
    method: 'POST',
    schema: buyerInvitationSchema,
    body,
    headers: operationHeaders({ key: crypto.randomUUID(), body }),
  });
}

/**
 * 阶段 6.6E：员工买家建档。编号（录入日期 + B/C 渠道码 + 流水）在建档
 * 事务内立即分配；新档案默认未激活，注册邀请只负责认领激活。
 */
async function createBuyerCustomerProfile(
  client: ReturnType<typeof useQueryClient>,
  input: {
    displayName: string;
    wechatId: string;
    buyerChannelId: string;
    marketplaceCode: string;
  },
) {
  const body = {
    display_name: input.displayName,
    wechat_id: input.wechatId,
    buyer_channel_id: input.buyerChannelId,
    marketplace_code: input.marketplaceCode,
  };
  return identityApiRequest('staff', client, {
    path: '/api/staff/buyer-customers',
    method: 'POST',
    schema: createBuyerResultSchema,
    body,
    headers: operationHeaders({ key: crypto.randomUUID(), body }),
  });
}
async function issueSellerInvite(
  client: ReturnType<typeof useQueryClient>,
  input: {
    sellerOrganizationId: string | null;
    wechatId: string;
    marketplaceCode: string;
  },
) {
  const body = {
    // D-056：获客线索退役，lead_id 恒为 null。
    lead_id: null,
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
  sellerOrganizationId: string,
) {
  return identityApiRequest('staff', client, {
    path: `/api/staff/customer-security/seller-invitations/current?seller_organization_id=${encodeURIComponent(sellerOrganizationId)}`,
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
function marketLabel(code: string) {
  return MARKET_LABELS[code] ?? '未命名站点';
}
