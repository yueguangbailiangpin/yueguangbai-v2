import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { startStaffBinding } from './staff-auth-api';
import { Alert, Button, Card } from '../../ui/primitives';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const FEISHU_AUTHORIZATION_ORIGIN = 'https://accounts.feishu.cn';

export function StaffBindingPage(): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const token = new URLSearchParams(location.search).get('invite') ?? '';
  const valid = TOKEN_PATTERN.test(token);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function bind(): Promise<void> {
    if (!valid || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await startStaffBinding(token);
      const destination = new URL(response.data.authorization_url);
      if (destination.origin !== FEISHU_AUTHORIZATION_ORIGIN) {
        throw new Error('unexpected_staff_binding_provider_origin');
      }
      window.location.assign(destination.toString());
    } catch {
      setMessage('邀请无效、已过期或暂时无法绑定。请联系总管理员重新发送邀请。');
      setBusy(false);
    }
  }

  return <main className="login-page identity-staff">
    <Card className="login-card staff-login-card">
      <div className="login-brand"><span className="brand-mark" aria-hidden="true">月</span><strong>月光白</strong></div>
      <div className="login-heading">
        <p className="eyebrow">员工身份绑定</p>
        <h1>加入员工工作台</h1>
        <p>请使用您本人的飞书账号完成验证。角色和权限由月光白总管理员分配。</p>
      </div>
      {!valid ? <Alert tone="danger">邀请链接不完整，请联系总管理员重新发送。</Alert> : null}
      {message ? <Alert tone="danger">{message}</Alert> : null}
      <div className="entry-actions">
        <Button disabled={!valid || busy} loading={busy} loadingLabel="正在前往飞书"
          onClick={() => { void bind(); }}>使用飞书完成绑定</Button>
        <Button className="secondary" disabled={busy} onClick={() => navigate('/staff/login')}>返回员工登录</Button>
      </div>
      <p className="security-note">邀请只能使用一次；飞书不会成为业务、财务或权限数据的存储方。</p>
    </Card>
  </main>;
}
