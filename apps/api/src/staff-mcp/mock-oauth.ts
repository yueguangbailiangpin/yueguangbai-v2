import type {
  StaffMcpOAuthVerifier,
  StaffMcpVerifiedSession,
} from '@ygb/contracts';

/** Local-only OAuth boundary substitute. Tokens stay in memory and are never logged. */
export class MockStaffMcpOAuthVerifier implements StaffMcpOAuthVerifier {
  private readonly sessions = new Map<string, StaffMcpVerifiedSession>();
  unavailable = false;

  register(accessToken: string, session: StaffMcpVerifiedSession): void {
    if (!safeToken(accessToken) || this.sessions.has(accessToken)) {
      throw new Error('invalid_mock_oauth_registration');
    }
    this.sessions.set(accessToken, Object.freeze({
      ...session,
      scopes: Object.freeze([...session.scopes]),
    }));
  }

  revoke(accessToken: string): void {
    this.sessions.delete(accessToken);
  }

  async verifyAccessToken(
    accessToken: string,
    _now: number,
  ): Promise<StaffMcpVerifiedSession | null> {
    if (this.unavailable) throw new Error('oauth_provider_unavailable');
    if (!safeToken(accessToken)) return null;
    return this.sessions.get(accessToken) ?? null;
  }
}

function safeToken(value: string): boolean {
  return typeof value === 'string'
    && value.length >= 16
    && value.length <= 512
    && /^[A-Za-z0-9._~-]+$/u.test(value);
}
