import type { QueryClient } from '@tanstack/react-query';
import { isFrontendApiError } from '../../api/errors';
import { clearStaffTransport } from '../customer-transport-invalidation';
import { staffAuthApi, type StaffAuthApiAdapter } from './staff-auth-api';

export type StaffLogoutResult = Readonly<{
  kind: 'LOGGED_OUT' | 'FAILED' | 'IDEMPOTENCY_CONFLICT' | 'REQUEST_IN_PROGRESS' | 'ALREADY_SUBMITTING';
  requestId: string | null;
  sessionVersion?: number;
}>;

export class StaffAuthController {
  private logoutAllKey: string | null = null;
  private submittingLogoutAll = false;

  constructor(
    private readonly client: QueryClient,
    private readonly api: StaffAuthApiAdapter = staffAuthApi,
    private readonly keyFactory: () => string = () => crypto.randomUUID(),
  ) {}

  async logout(signal?: AbortSignal): Promise<StaffLogoutResult> {
    try {
      const response = await this.api.logout(signal);
      await clearStaffTransport(this.client);
      return { kind: 'LOGGED_OUT', requestId: response.requestId };
    } catch (error: unknown) {
      if (isFrontendApiError(error) && error.httpStatus === 401) {
        await clearStaffTransport(this.client);
        return { kind: 'LOGGED_OUT', requestId: error.requestId };
      }
      return {
        kind: 'FAILED',
        requestId: isFrontendApiError(error) ? error.requestId : null,
      };
    }
  }

  async logoutAll(signal?: AbortSignal): Promise<StaffLogoutResult> {
    if (this.submittingLogoutAll) return { kind: 'ALREADY_SUBMITTING', requestId: null };
    this.logoutAllKey ??= this.keyFactory();
    this.submittingLogoutAll = true;
    try {
      const response = await this.api.logoutAll(this.logoutAllKey, signal);
      await clearStaffTransport(this.client);
      this.logoutAllKey = null;
      return {
        kind: 'LOGGED_OUT',
        requestId: response.requestId,
        sessionVersion: response.data.session_version,
      };
    } catch (error: unknown) {
      const requestId = isFrontendApiError(error) ? error.requestId : null;
      if (isFrontendApiError(error) && error.httpStatus === 401) {
        await clearStaffTransport(this.client);
        this.logoutAllKey = null;
        return { kind: 'LOGGED_OUT', requestId };
      }
      if (isFrontendApiError(error) && error.code === 'IDEMPOTENCY_CONFLICT') {
        this.logoutAllKey = null;
        return { kind: 'IDEMPOTENCY_CONFLICT', requestId };
      }
      if (isFrontendApiError(error) && error.code === 'REQUEST_IN_PROGRESS') {
        return { kind: 'REQUEST_IN_PROGRESS', requestId };
      }
      return { kind: 'FAILED', requestId };
    } finally {
      this.submittingLogoutAll = false;
    }
  }

  cancelLogoutAll(): void {
    if (!this.submittingLogoutAll) this.logoutAllKey = null;
  }
}
