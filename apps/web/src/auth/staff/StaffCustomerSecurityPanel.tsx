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

export function StaffCustomerSecurityPanel(): React.JSX.Element {
  const client = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

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
    {message ? <Alert tone={link ? 'success' : 'danger'}>{message}</Alert> : null}
    {link ? <FormField label="一次性链接" htmlFor="staff-security-link">
      <TextInput id="staff-security-link" value={link} readOnly aria-label="一次性链接" />
    </FormField> : null}
    <RequestIdDisplay requestId={requestId} />
  </section>;
}
