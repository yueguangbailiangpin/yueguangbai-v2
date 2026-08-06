import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { identityApiRequest } from '../../api/identity-request';
import { isFrontendApiError } from '../../api/errors';
import {
  Alert, Button, FormField, RequestIdDisplay, Select, TextInput,
} from '../../ui/primitives';

const invitationSchema = z.object({
  invitation: z.object({
    invitation_id: z.string(), registration_token: z.string(),
    registration_path: z.string(), wechat_id: z.string(),
    marketplace_code: z.enum(['AMAZON_JP', 'AMAZON_US', 'COUPANG_KR']),
    status: z.literal('ACTIVE'), version: z.number().int(),
    expires_at: z.number().int(), replayed: z.boolean(),
  }).strict(),
}).strict();

const resetSchema = z.object({
  password_reset: z.object({
    reset_id: z.string(), reset_token: z.string(), reset_path: z.string(),
    expires_at: z.number().int(), replayed: z.boolean(),
  }).strict(),
}).strict();

const invitationViewSchema = z.object({ invitation: z.object({
  invitation_id: z.string(), wechat_id: z.string(),
  marketplace_code: z.enum(['AMAZON_JP', 'AMAZON_US', 'COUPANG_KR']),
  issued_by_staff_id: z.string(), status: z.enum(['ACTIVE', 'CONSUMED', 'REVOKED', 'EXPIRED']),
  version: z.number().int().positive(), issued_at: z.number().int(), expires_at: z.number().int(),
  consumed_at: z.number().int().nullable(), revoked_at: z.number().int().nullable(),
}).strict() }).strict();

export function StaffCustomerSecurityPanel(): React.JSX.Element {
  const client = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<z.output<typeof invitationViewSchema>['invitation'] | null>(null);

  async function issueInvitation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true); setMessage(null); setRequestId(null); setLink(null);
    try {
      const response = await identityApiRequest('staff', client, {
        path: '/api/staff/customer-security/buyer-invitations', method: 'POST',
        schema: invitationSchema,
        headers: { 'Idempotency-Key': `staff-buyer-invite:${crypto.randomUUID()}` },
        body: {
          wechat_id: String(values.get('wechat_id') ?? ''),
          marketplace_code: String(values.get('marketplace_code') ?? ''),
        },
      });
      setLink(`${window.location.origin}${response.data.invitation.registration_path}`);
      setMessage('邀请已签发。请通过私人微信发送，并提醒客户不要转发。');
    } catch (error: unknown) { showError(error); }
    finally { setBusy(false); }
  }

  async function issueReset(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true); setMessage(null); setRequestId(null); setLink(null);
    try {
      const response = await identityApiRequest('staff', client, {
        path: '/api/staff/customer-security/password-resets', method: 'POST',
        schema: resetSchema,
        headers: { 'Idempotency-Key': `staff-password-reset:${crypto.randomUUID()}` },
        body: {
          wechat_id: String(values.get('reset_wechat_id') ?? ''),
          manual_verification_confirmed: true,
          verification_note: String(values.get('verification_note') ?? ''),
        },
      });
      setLink(`${window.location.origin}${response.data.password_reset.reset_path}`);
      setMessage('恢复链接已签发，30 分钟内一次有效。员工不会看到客户的新密码。');
    } catch (error: unknown) { showError(error); }
    finally { setBusy(false); }
  }

  function showError(error: unknown): void {
    setRequestId(isFrontendApiError(error) ? error.requestId : null);
    setMessage('操作未完成，请核对微信号、站点和人工核验记录。');
  }

  async function readInvitation(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    const id = String(values.get('invitation_id') ?? '').trim();
    setBusy(true); setMessage(null); setRequestId(null); setInvitation(null);
    try {
      const response = await identityApiRequest('staff', client, {
        path: `/api/staff/customer-security/buyer-invitations/${encodeURIComponent(id)}`,
        method: 'GET', schema: invitationViewSchema,
      });
      setInvitation(response.data.invitation); setRequestId(response.requestId);
    } catch (error: unknown) { showError(error); }
    finally { setBusy(false); }
  }

  async function revokeInvitation(): Promise<void> {
    if (!invitation || invitation.status !== 'ACTIVE') return;
    setBusy(true); setMessage(null); setRequestId(null);
    try {
      const body = { expected_version: invitation.version };
      const response = await identityApiRequest('staff', client, {
        path: `/api/staff/customer-security/buyer-invitations/${encodeURIComponent(invitation.invitation_id)}/revoke`,
        method: 'POST', schema: invitationViewSchema, body,
        headers: { 'Idempotency-Key': `staff-invite-revoke:${crypto.randomUUID()}` },
      });
      setInvitation(response.data.invitation); setRequestId(response.requestId);
      setMessage('邀请已撤销，原链接不能再用于注册。');
    } catch (error: unknown) { showError(error); }
    finally { setBusy(false); }
  }

  return <section className="staff-customer-security" aria-labelledby="customer-security-title">
    <h3 id="customer-security-title">客户邀请与账号恢复</h3>
    <form onSubmit={(event) => { void issueInvitation(event); }}>
      <FormField label="买家微信号" htmlFor="staff-invite-wechat" required>
        <TextInput id="staff-invite-wechat" name="wechat_id" autoComplete="off" required />
      </FormField>
      <FormField label="绑定站点" htmlFor="staff-invite-marketplace" required>
        <Select id="staff-invite-marketplace" name="marketplace_code" defaultValue="AMAZON_JP">
          <option value="AMAZON_JP">日本亚马逊</option>
          <option value="AMAZON_US">美国亚马逊</option>
        </Select>
      </FormField>
      <Button type="submit" loading={busy} loadingLabel="正在签发">签发七天买家邀请</Button>
    </form>
    <form onSubmit={(event) => { void issueReset(event); }}>
      <FormField label="已人工核验的微信号" htmlFor="staff-reset-wechat" required>
        <TextInput id="staff-reset-wechat" name="reset_wechat_id" autoComplete="off" required />
      </FormField>
      <FormField label="核验记录" htmlFor="staff-reset-note" description="请写明核验时间和依据，至少 8 个字" required>
        <TextInput id="staff-reset-note" name="verification_note"
          minLength={8} maxLength={1000} required />
      </FormField>
      <Button type="submit" className="secondary" loading={busy} loadingLabel="正在签发">
        签发一次性密码恢复链接
      </Button>
    </form>
    <form onSubmit={(event) => { void readInvitation(event); }}>
      <FormField label="邀请编号" htmlFor="staff-invitation-id" description="查询状态并在使用前撤销">
        <TextInput id="staff-invitation-id" name="invitation_id" autoComplete="off" required />
      </FormField>
      <Button type="submit" className="secondary" disabled={busy}>查询邀请</Button>
    </form>
    {invitation ? <section className="invitation-status" aria-live="polite">
      <p>微信号：{invitation.wechat_id}</p><p>站点：{invitation.marketplace_code}</p>
      <p>状态：{invitation.status} · 版本 v{invitation.version}</p>
      {invitation.status === 'ACTIVE' ? <Button className="danger" disabled={busy} onClick={() => { void revokeInvitation(); }}>撤销邀请</Button> : null}
    </section> : null}
    {message ? <Alert tone={link ? 'success' : 'danger'}>{message}</Alert> : null}
    {link ? <FormField label="一次性链接" htmlFor="staff-security-link">
      <TextInput id="staff-security-link" value={link} readOnly aria-label="一次性链接" />
    </FormField> : null}
    {link ? <Button type="button" className="secondary" onClick={() => setLink(null)}>我已安全复制，立即隐藏</Button> : null}
    <RequestIdDisplay requestId={requestId} />
  </section>;
}
