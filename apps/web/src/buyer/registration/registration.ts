import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '../../api/transport';
import { CUSTOMER_TRANSPORT_INVALIDATION_GROUP } from '../../auth/customer-transport-invalidation';
import {
  customerAuthApi,
  type CustomerAuthApiAdapter,
  type CustomerSession,
} from '../../auth/customer/customer-auth-api';
import { CustomerMismatchCleanupCoordinator } from '../../auth/customer/customer-mismatch-cleanup';
import { queryKeys } from '../../api/query-client';

const registrationResponseSchema = z.object({
  identity: z.object({
    buyer_number: z.string().min(1),
    wechat_id: z.string().min(1),
  }).strict(),
  session_established: z.literal(true),
  must_change_password: z.literal(false),
  next_path: z.literal('/buyer'),
}).strict();

export interface HumanVerificationProvider {
  token(signal: AbortSignal): Promise<string | null>;
}

export const disconnectedHumanVerificationProvider: HumanVerificationProvider = Object.freeze({
  token: async () => null,
});

export type RegistrationResult =
  | Readonly<{ kind: 'AUTHENTICATED'; session: CustomerSession }>
  | Readonly<{ kind: 'MISMATCH_CLEANED' }>
  | Readonly<{ kind: 'MISMATCH_CLEANUP_FAILED'; requestId: string | null }>;

export class BuyerRegistrationController {
  private readonly cleanup: CustomerMismatchCleanupCoordinator;

  constructor(
    private readonly client: QueryClient,
    private readonly provider: HumanVerificationProvider = disconnectedHumanVerificationProvider,
    private readonly auth: CustomerAuthApiAdapter = customerAuthApi,
  ) {
    this.cleanup = new CustomerMismatchCleanupCoordinator(client, auth);
  }

  async register(
    body: Readonly<{
      wechat_id: string;
      password: string;
      password_confirmation: string;
    }>,
    signal: AbortSignal,
  ): Promise<RegistrationResult> {
    this.cleanup.beginCycle();
    const token = await this.provider.token(signal);
    const requestBody = {
      ...body,
      ...(token === null ? {} : { human_verification_token: token }),
    };
    await apiRequest({
      path: '/api/buyer-auth/register',
      method: 'POST',
      schema: registrationResponseSchema,
      body: requestBody,
      signal,
    });

    await CUSTOMER_TRANSPORT_INVALIDATION_GROUP.clear(this.client);
    const session = await this.auth.readSession(signal);
    if (session.data.session.account_type !== 'BUYER') {
      const cleaned = await this.cleanup.clean();
      return cleaned.state === 'CLEANED'
        ? { kind: 'MISMATCH_CLEANED' }
        : { kind: 'MISMATCH_CLEANUP_FAILED', requestId: cleaned.requestId };
    }
    this.client.setQueryData(queryKeys.buyer.session, session.data.session);
    return { kind: 'AUTHENTICATED', session: session.data.session };
  }
}
