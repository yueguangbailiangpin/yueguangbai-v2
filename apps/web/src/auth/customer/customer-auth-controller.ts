import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/query-client';
import { CUSTOMER_TRANSPORT_INVALIDATION_GROUP } from '../customer-transport-invalidation';
import type {
  CustomerAuthApiAdapter,
  CustomerLoginBody,
  CustomerSession,
  CustomerTarget,
} from './customer-auth-api';
import { expectedAccountType } from './customer-auth-api';
import {
  CustomerMismatchCleanupCoordinator,
  type CustomerMismatchCleanupResult,
} from './customer-mismatch-cleanup';

export type CustomerLoginResult =
  | Readonly<{ kind: 'AUTHENTICATED'; session: CustomerSession }>
  | Readonly<{ kind: 'PASSWORD_CHANGE_REQUIRED' }>
  | Readonly<{ kind: 'MISMATCH_CLEANED' }>
  | Readonly<{ kind: 'MISMATCH_CLEANUP_FAILED'; requestId: string | null }>;

export class CustomerAuthController {
  private readonly mismatchCleanup: CustomerMismatchCleanupCoordinator;

  constructor(
    private readonly client: QueryClient,
    private readonly api: CustomerAuthApiAdapter,
  ) {
    this.mismatchCleanup = new CustomerMismatchCleanupCoordinator(client, api);
  }

  async login(target: CustomerTarget, body: CustomerLoginBody, signal?: AbortSignal): Promise<CustomerLoginResult> {
    this.mismatchCleanup.beginCycle();
    const response = await this.api.login(body, signal);
    if (response.data.session.account_type !== expectedAccountType(target)) {
      return this.cleanupResult(await this.mismatchCleanup.clean());
    }

    await CUSTOMER_TRANSPORT_INVALIDATION_GROUP.clear(this.client);
    if (response.data.session.password_change_required) {
      return { kind: 'PASSWORD_CHANGE_REQUIRED' };
    }
    this.client.setQueryData(queryKeys[target].session, response.data.session);
    return { kind: 'AUTHENTICATED', session: response.data.session };
  }

  async retryMismatchCleanup(): Promise<CustomerLoginResult> {
    return this.cleanupResult(await this.mismatchCleanup.retry());
  }

  private cleanupResult(result: CustomerMismatchCleanupResult): CustomerLoginResult {
    return result.state === 'CLEANED'
      ? { kind: 'MISMATCH_CLEANED' }
      : { kind: 'MISMATCH_CLEANUP_FAILED', requestId: result.requestId };
  }
}
