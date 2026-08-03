import type { QueryClient } from '@tanstack/react-query';
import { isFrontendApiError } from '../../api/errors';
import { CUSTOMER_TRANSPORT_INVALIDATION_GROUP } from '../customer-transport-invalidation';
import type { CustomerAuthApiAdapter } from './customer-auth-api';

export type CustomerMismatchCleanupState = 'IDLE' | 'CLEANING' | 'CLEANED' | 'FAILED';

export type CustomerMismatchCleanupResult = Readonly<{
  state: 'CLEANED' | 'FAILED';
  requestId: string | null;
}>;

export class CustomerMismatchCleanupCoordinator {
  private cleanupState: CustomerMismatchCleanupState = 'IDLE';
  private activeCleanup: Promise<CustomerMismatchCleanupResult> | null = null;
  private settledResult: CustomerMismatchCleanupResult | null = null;

  constructor(
    private readonly client: QueryClient,
    private readonly api: CustomerAuthApiAdapter,
  ) {}

  state(): CustomerMismatchCleanupState {
    return this.cleanupState;
  }

  beginCycle(): void {
    if (this.cleanupState === 'CLEANING') return;
    this.cleanupState = 'IDLE';
    this.settledResult = null;
  }

  clean(): Promise<CustomerMismatchCleanupResult> {
    if (this.activeCleanup) return this.activeCleanup;
    if (this.settledResult) return Promise.resolve(this.settledResult);

    this.cleanupState = 'CLEANING';
    this.activeCleanup = this.performCleanup();
    return this.activeCleanup;
  }

  retry(): Promise<CustomerMismatchCleanupResult> {
    if (this.cleanupState !== 'FAILED') return this.clean();
    this.cleanupState = 'IDLE';
    this.settledResult = null;
    return this.clean();
  }

  private async performCleanup(): Promise<CustomerMismatchCleanupResult> {
    await CUSTOMER_TRANSPORT_INVALIDATION_GROUP.clear(this.client);
    try {
      const response = await this.api.logout();
      return this.settle({ state: 'CLEANED', requestId: response.requestId });
    } catch (error: unknown) {
      return this.settle({
        state: 'FAILED',
        requestId: isFrontendApiError(error) ? error.requestId : null,
      });
    }
  }

  private settle(result: CustomerMismatchCleanupResult): CustomerMismatchCleanupResult {
    this.cleanupState = result.state;
    this.settledResult = result;
    this.activeCleanup = null;
    return result;
  }
}
