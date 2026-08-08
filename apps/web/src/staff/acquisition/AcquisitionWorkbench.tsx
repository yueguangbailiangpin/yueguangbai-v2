import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { isFrontendApiError } from '../../api/errors';
import { useCurrentStaffSession } from '../../auth/staff/StaffSessionBoundary';
import {
  Alert, Button, Card, EmptyState, FormField, MetricCard,
  RequestIdDisplay, Select, TextInput,
} from '../../ui/primitives';
import { staffApi } from '../api/client';
import type {
  AcquisitionChannel,
  AcquisitionConsultation,
  AcquisitionLead,
} from '../contracts/runtime';
import { staffWorkbenchKeys } from '../queries/keys';
import { formatCny, formatShanghai } from '../shared/format';

export function AcquisitionWorkbench(): React.JSX.Element {
  const session = useCurrentStaffSession();
  const client = useQueryClient();
  const [range] = useState(currentMonthRange);
  const canAdmin = session.role.code === 'owner'
    && session.permissions.includes('ACQUISITION_ADMIN');
  const canBuyer = session.permissions.includes('ACQUISITION_BUYER_LEAD')
    && (session.role.code === 'owner' || session.role.code === 'pre_sales');
  const canSeller = session.permissions.includes('ACQUISITION_SELLER_LEAD')
    && (session.role.code === 'owner' || session.role.code === 'seller_ops');
  const leadType = canBuyer && canSeller ? null : canBuyer ? 'BUYER' : canSeller ? 'SELLER' : null;
  const enabled = canBuyer || canSeller;
  const leads = useQuery({
    queryKey: staffWorkbenchKeys.acquisitionLeads(leadType),
    queryFn: ({ signal }) => staffApi.acquisitionLeads(client, leadType, signal)
      .then((response) => response.data),
    enabled,
  });
  const funnel = useQuery({
    queryKey: staffWorkbenchKeys.acquisitionFunnel(range.from, range.to),
    queryFn: ({ signal }) => staffApi.acquisitionFunnel(client, range.from, range.to, signal)
      .then((response) => response.data.funnel),
    enabled,
  });

  if (!enabled && !canAdmin) {
    return <main className="acquisition-workbench"><EmptyState
      title="当前角色不参与获客登记"
      description="买家返款及被个人禁用获客权限的员工不会看到登记控件；后端接口同样拒绝访问。"
    /></main>;
  }

  return <main className="acquisition-workbench">
    <section className="acquisition-summary" aria-label="本月获客事实摘要">
      <MetricCard label="咨询人数" value={funnel.data?.buyer?.consultation_count
        ?? funnel.data?.seller?.consultation_count ?? '—'} detail="北京时间本月渠道汇总" />
      <MetricCard label="添加微信" value={(funnel.data?.buyer?.wechat_added_count ?? 0)
        + (funnel.data?.seller?.wechat_added_count ?? 0)} detail="有效单人线索自动汇总" />
      {funnel.data?.buyer ? <MetricCard label="未参加" value={funnel.data.buyer.no_participation_count}
        detail="建立有效买家线索后从未提交预约" /> : null}
      {funnel.data?.seller ? <MetricCard label="卖家合作" value={funnel.data.seller.cooperation_count}
        detail="首次成为有效组织 ACTIVE 成员" /> : null}
      {funnel.data?.buyer?.projected_gross_profit_cny_fen !== null
        && funnel.data?.buyer?.projected_gross_profit_cny_fen !== undefined
        ? <MetricCard label="预计利润" value={formatCny(funnel.data.buyer.projected_gross_profit_cny_fen)}
          detail="仅 Buyer 初始来源；Seller 不重复累计" /> : null}
    </section>

    <section className="acquisition-columns">
      <Card className="acquisition-register"><h2>添加微信后登记</h2>
        <p>渠道由后端按员工、线索类型和登记时间自动解析，页面不提供渠道选择。</p>
        <LeadForm canBuyer={canBuyer} canSeller={canSeller} />
      </Card>
      <Card className="acquisition-leads"><div className="pane-heading"><h2>线索</h2>
        <span>{leads.data?.items.length ?? 0} 条</span></div>
        {leads.isPending ? <p role="status">正在加载线索</p>
          : leads.isError ? <QueryError error={leads.error} retry={() => { void leads.refetch(); }} />
          : leads.data.items.length === 0 ? <EmptyState title="暂无线索" description="添加私人微信后在左侧登记。" />
          : <ol className="acquisition-lead-list">{leads.data.items.map((lead) =>
            <LeadCard key={lead.lead_id} lead={lead} />)}</ol>}
      </Card>
    </section>
    {canAdmin ? <AdminPanel from={range.from} to={range.to} /> : null}
  </main>;
}

function LeadForm({ canBuyer, canSeller }: { canBuyer: boolean; canSeller: boolean }) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: unknown) => staffApi.createAcquisitionLead(
      client, body, crypto.randomUUID(),
    ),
    onSuccess: () => client.invalidateQueries({ queryKey: staffWorkbenchKeys.acquisition }),
  });
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget; const data = new FormData(form);
    mutation.mutate({
      lead_type: String(data.get('lead_type')),
      wechat_id: String(data.get('wechat_id')),
      display_name: nullable(data.get('display_name')),
      note: nullable(data.get('note')),
    }, { onSuccess: () => form.reset() });
  }
  return <form onSubmit={submit} className="acquisition-form">
    <label htmlFor="acquisition-lead-type">线索类型</label>
    <Select id="acquisition-lead-type" name="lead_type" defaultValue={canBuyer ? 'BUYER' : 'SELLER'}>
      {canBuyer ? <option value="BUYER">买家线索</option> : null}
      {canSeller ? <option value="SELLER">卖家线索</option> : null}
    </Select>
    <FormField label="微信号" htmlFor="acquisition-wechat"><TextInput
      id="acquisition-wechat" name="wechat_id" minLength={3} maxLength={128}
      autoComplete="off" required /></FormField>
    <FormField label="称呼（可选）" htmlFor="acquisition-name"><TextInput
      id="acquisition-name" name="display_name" maxLength={100} /></FormField>
    <FormField label="跟进备注（可选）" htmlFor="acquisition-note"><TextInput
      id="acquisition-note" name="note" maxLength={1000} /></FormField>
    <Button loading={mutation.isPending} loadingLabel="正在登记">登记线索</Button>
    {mutation.isError ? <QueryError error={mutation.error} retry={() => mutation.reset()} retryLabel="关闭提示" /> : null}
  </form>;
}

function LeadCard({ lead }: { lead: AcquisitionLead }) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (reason: string) => staffApi.invalidateAcquisitionLead(client,
      lead.lead_id, { expected_version: lead.version, reason }, crypto.randomUUID()),
    onSuccess: () => client.invalidateQueries({ queryKey: staffWorkbenchKeys.acquisition }),
  });
  return <li><article className="acquisition-lead-card">
    <header><strong>{lead.display_name ?? lead.wechat_masked}</strong>
      <span>{lead.lead_type === 'BUYER' ? '买家' : '卖家'} · {lead.status}</span></header>
    <dl><dt>来源</dt><dd>{lead.origin_channel_name} · {lead.origin_staff_id}</dd>
      <dt>微信</dt><dd>{lead.wechat_masked}</dd>
      <dt>登记</dt><dd>{lead.created_business_date}（北京时间）</dd>
      {lead.lead_type === 'BUYER' ? <><dt>转化</dt><dd>{lead.registered ? '已注册' : '未注册'} / {lead.reservation_submitted ? '已提交预约' : '未参加'} / {lead.formal_order_count} 单</dd></>
        : <><dt>合作</dt><dd>{lead.seller_cooperation ? '已确认合作' : '尚未合作'}</dd></>}
    </dl>
    {lead.status === 'ACTIVE' ? <form onSubmit={(event) => {
      event.preventDefault(); const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
      if (reason) mutation.mutate(reason);
    }}><FormField label="作废/重复更正原因" htmlFor={`invalidate-${lead.lead_id}`}><TextInput
        id={`invalidate-${lead.lead_id}`} name="reason" maxLength={1000} required /></FormField>
      <Button className="secondary" loading={mutation.isPending}>作废线索</Button></form> : null}
    {mutation.isError ? <QueryError error={mutation.error} retry={() => mutation.reset()} retryLabel="关闭提示" /> : null}
  </article></li>;
}

function AdminPanel({ from, to }: { from: string; to: string }) {
  const client = useQueryClient();
  const channels = useQuery({ queryKey: staffWorkbenchKeys.acquisitionChannels,
    queryFn: ({ signal }) => staffApi.acquisitionChannels(client, signal).then((r) => r.data.channels) });
  const assignments = useQuery({ queryKey: staffWorkbenchKeys.acquisitionAssignments,
    queryFn: ({ signal }) => staffApi.acquisitionAssignments(client, signal).then((r) => r.data.assignments) });
  const consultations = useQuery({ queryKey: staffWorkbenchKeys.acquisitionConsultations(from,to),
    queryFn: ({ signal }) => staffApi.acquisitionConsultations(client,from,to,signal).then((r) => r.data.consultations) });
  const refresh = () => client.invalidateQueries({ queryKey: staffWorkbenchKeys.acquisition });
  const channelMutation = useMutation({ mutationFn: (body: unknown) =>
    staffApi.createAcquisitionChannel(client,body,crypto.randomUUID()), onSuccess: refresh });
  const disableChannelMutation = useMutation({ mutationFn: (input: { channel: AcquisitionChannel; reason: string }) =>
    staffApi.disableAcquisitionChannel(client,input.channel.channel_id,
      { expected_version:input.channel.version,reason:input.reason },crypto.randomUUID()), onSuccess: refresh });
  const assignmentMutation = useMutation({ mutationFn: (body: unknown) =>
    staffApi.createAcquisitionAssignment(client,body,crypto.randomUUID()), onSuccess: refresh });
  const revokeAssignmentMutation = useMutation({ mutationFn: (input: { id:string; version:number; reason:string }) =>
    staffApi.revokeAcquisitionAssignment(client,input.id,
      { expected_version:input.version,reason:input.reason },crypto.randomUUID()), onSuccess: refresh });
  const consultationMutation = useMutation({ mutationFn: (body: unknown) =>
    staffApi.recordAcquisitionConsultation(client,body,crypto.randomUUID()), onSuccess: refresh });
  const activeChannels = channels.data?.filter((channel) => channel.status === 'ACTIVE') ?? [];
  return <section className="acquisition-admin" aria-labelledby="acquisition-admin-title">
    <h2 id="acquisition-admin-title">总管理员配置</h2>
    <Alert tone="info">咨询人数按渠道和北京时间自然日录入；同一人在同一渠道同一天只计一次。</Alert>
    <div className="acquisition-admin-grid">
      <Card><h3>新增渠道</h3><form onSubmit={(event) => {
        event.preventDefault(); const form=event.currentTarget; const data=new FormData(form);
        channelMutation.mutate({ code:String(data.get('code')), channel_type:String(data.get('type')),
          display_name:String(data.get('name')) }, { onSuccess:()=>form.reset() });
      }} className="acquisition-form"><FormField label="渠道代码" htmlFor="channel-code"><TextInput id="channel-code" name="code" required pattern="[A-Za-z0-9_-]{2,40}" /></FormField>
        <label htmlFor="channel-type">渠道类型</label><Select id="channel-type" name="type"><option value="XIAOHONGSHU">小红书</option><option value="PRIVATE_WECHAT">私人微信</option><option value="REFERRAL">转介绍</option><option value="OTHER">其他</option></Select>
        <FormField label="显示名称" htmlFor="channel-name"><TextInput id="channel-name" name="name" required maxLength={100} /></FormField><Button loading={channelMutation.isPending}>新增渠道</Button></form>
        <ul className="compact-list">{channels.data?.map((channel) => <li key={channel.channel_id}>{channel.display_name} · {channel.code} · v{channel.version}
          {channel.status==='ACTIVE' ? <form onSubmit={(event)=>{event.preventDefault();const reason=String(new FormData(event.currentTarget).get('reason')??'').trim();if(reason)disableChannelMutation.mutate({channel,reason});}}>
            <FormField label="停用原因" htmlFor={`disable-channel-${channel.channel_id}`}><TextInput id={`disable-channel-${channel.channel_id}`} name="reason" required maxLength={1000} /></FormField>
            <Button className="secondary" loading={disableChannelMutation.isPending}>停用渠道</Button>
          </form> : <span> · 已停用</span>}</li>)}</ul></Card>

      <Card><h3>员工渠道有效期</h3><form onSubmit={(event) => {
        event.preventDefault(); const form=event.currentTarget; const data=new FormData(form);
        assignmentMutation.mutate({ staff_id:String(data.get('staff_id')), lead_type:String(data.get('lead_type')),
          channel_id:String(data.get('channel_id')), effective_from:shanghaiInputEpoch(String(data.get('from'))),
          effective_until:nullableEpoch(data.get('until')) }, { onSuccess:()=>form.reset() });
      }} className="acquisition-form"><FormField label="员工 ID" htmlFor="assignment-staff"><TextInput id="assignment-staff" name="staff_id" required /></FormField>
        <label htmlFor="assignment-lead-type">职责</label><Select id="assignment-lead-type" name="lead_type"><option value="BUYER">买家线索</option><option value="SELLER">卖家线索</option></Select>
        <label htmlFor="assignment-channel">渠道</label><Select id="assignment-channel" name="channel_id" required><option value="">请选择</option>{activeChannels.map((channel)=><option key={channel.channel_id} value={channel.channel_id}>{channel.display_name}</option>)}</Select>
        <FormField label="生效时间（北京时间）" htmlFor="assignment-from"><TextInput id="assignment-from" name="from" type="datetime-local" required /></FormField>
        <FormField label="结束时间（可选，北京时间）" htmlFor="assignment-until"><TextInput id="assignment-until" name="until" type="datetime-local" /></FormField><Button loading={assignmentMutation.isPending}>保存有效期</Button></form>
        <ul className="compact-list">{assignments.data?.map((item)=><li key={item.assignment_id}>{item.staff_id} · {item.lead_type} · {item.channel_name} · {formatShanghai(item.effective_from)}
          {item.status==='ACTIVE' ? <form onSubmit={(event)=>{event.preventDefault();const reason=String(new FormData(event.currentTarget).get('reason')??'').trim();if(reason)revokeAssignmentMutation.mutate({id:item.assignment_id,version:item.version,reason});}}>
            <FormField label="撤销原因" htmlFor={`revoke-assignment-${item.assignment_id}`}><TextInput id={`revoke-assignment-${item.assignment_id}`} name="reason" required maxLength={1000} /></FormField>
            <Button className="secondary" loading={revokeAssignmentMutation.isPending}>撤销有效期</Button>
          </form> : <span> · 已撤销</span>}</li>)}</ul></Card>

      <Card><h3>每日咨询汇总与更正</h3><form onSubmit={(event) => {
        event.preventDefault(); const data=new FormData(event.currentTarget);
        const channelId=String(data.get('channel_id')); const date=String(data.get('date'));
        const existing=consultations.data?.find((item)=>item.channel_id===channelId&&item.business_date===date);
        consultationMutation.mutate({ channel_id:channelId,business_date:date,
          person_count:Number(data.get('count')),expected_version:existing?.version??0,
          reason:String(data.get('reason')) });
      }} className="acquisition-form"><label htmlFor="consultation-channel">渠道</label><Select id="consultation-channel" name="channel_id" required><option value="">请选择</option>{activeChannels.map((channel)=><option key={channel.channel_id} value={channel.channel_id}>{channel.display_name}</option>)}</Select>
        <FormField label="业务日期（北京时间）" htmlFor="consultation-date"><TextInput id="consultation-date" name="date" type="date" required /></FormField>
        <FormField label="去重咨询人数" htmlFor="consultation-count"><TextInput id="consultation-count" name="count" type="number" min={0} max={1000000} required /></FormField>
        <FormField label="录入/更正原因" htmlFor="consultation-reason"><TextInput id="consultation-reason" name="reason" maxLength={1000} required /></FormField><Button loading={consultationMutation.isPending}>保存汇总</Button></form>
        {consultations.data?.length ? <ul className="compact-list">{consultations.data.map((item)=><li key={item.consultation_id}><strong>{item.business_date} · {item.lead_type==='BUYER'?'买家':'卖家'} · {channelName(activeChannels,item.channel_id)} · {item.person_count} 人 · v{item.version}</strong><ConsultationHistory consultation={item} /></li>)}</ul>
          : <EmptyState title="本月暂无咨询汇总" description="选择渠道和北京时间日期开始录入。" />}</Card>
    </div>
    {[channels,assignments,consultations].some((query)=>query.isError)
      ? <QueryError error={[channels,assignments,consultations].find((query)=>query.isError)?.error} retry={() => { void refresh(); }} /> : null}
    {[channelMutation,disableChannelMutation,assignmentMutation,revokeAssignmentMutation,
      consultationMutation].some((mutation)=>mutation.isError)
      ? <QueryError error={[channelMutation,disableChannelMutation,assignmentMutation,
          revokeAssignmentMutation,consultationMutation].find((mutation)=>mutation.isError)?.error}
        retry={()=>{channelMutation.reset();disableChannelMutation.reset();assignmentMutation.reset();
          revokeAssignmentMutation.reset();consultationMutation.reset();}} retryLabel="关闭提示" /> : null}
  </section>;
}

function ConsultationHistory({ consultation }: { consultation: AcquisitionConsultation }) {
  const client=useQueryClient();
  const history=useQuery({ queryKey:staffWorkbenchKeys.acquisitionConsultationHistory(consultation.consultation_id),
    queryFn:({signal})=>staffApi.acquisitionConsultationHistory(client,consultation.consultation_id,signal).then((r)=>r.data.history) });
  if (!history.data) return null;
  return <details><summary>查看更正历史</summary><ol>{history.data.map((event)=><li key={event.event_id}>{formatShanghai(event.created_at)} · {event.previous_count===null?'首次录入':`${event.previous_count} → ${event.next_count}`} · {event.reason} · {event.actor_staff_id}</li>)}</ol></details>;
}

function QueryError({ error, retry, retryLabel='重试' }: { error: unknown; retry:()=>void; retryLabel?:string }) {
  const requestId=isFrontendApiError(error)?error.requestId:null;
  return <div className="inline-error" role="alert"><p>{acquisitionErrorMessage(error)}</p><RequestIdDisplay requestId={requestId} /><Button className="secondary" onClick={retry}>{retryLabel}</Button></div>;
}

function acquisitionErrorMessage(error: unknown): string {
  if (!isFrontendApiError(error)) return '当前内容加载失败';
  if (error.code === 'CHANNEL_CONFIGURATION_MISSING') return '当前没有生效的获客渠道配置';
  if (error.code === 'CHANNEL_CONFIGURATION_AMBIGUOUS') return '当前获客渠道配置存在冲突';
  if (error.code === 'DUPLICATE_LEAD') return '该微信身份已有同类型有效线索';
  if (error.code === 'VERSION_CONFLICT') return '记录已更新，请刷新后重试';
  if (error.code === 'IDEMPOTENCY_CONFLICT') return '该幂等操作与已有请求冲突';
  if (error.code === 'REQUEST_IN_PROGRESS') return '相同请求正在处理中';
  if (error.httpStatus === 404) return '记录不存在或不在当前数据范围';
  if (error.httpStatus === 403) return '当前角色或个人权限不允许此操作';
  return '获客服务暂时不可用';
}

function currentMonthRange() {
  const now=new Date(); const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const year=parts.find((part)=>part.type==='year')!.value; const month=parts.find((part)=>part.type==='month')!.value;
  const day=parts.find((part)=>part.type==='day')!.value;
  return { from:`${year}-${month}-01`,to:`${year}-${month}-${day}` };
}
function nullable(value: FormDataEntryValue|null): string|null { const text=String(value??'').trim(); return text||null; }
function shanghaiInputEpoch(value: string): number { return new Date(`${value}:00+08:00`).getTime(); }
function nullableEpoch(value: FormDataEntryValue|null): number|null { const text=String(value??'').trim(); return text?shanghaiInputEpoch(text):null; }
function channelName(channels: AcquisitionChannel[], id: string): string { return channels.find((channel)=>channel.channel_id===id)?.display_name??id; }
