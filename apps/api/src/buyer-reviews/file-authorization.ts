import type {
  FileActor,
} from '@ygb/contracts';
import type {
  FileAuthorizationResource,
  FileAuthorizationService,
} from '../files/authorization';
import { FileStorageError } from '../files/file-error';

/**
 * Narrow adapter required by Phase 5A's atomic explicit-audience link builder.
 * It grants no generic file capability: only a buyer may link their own
 * VERIFIED REVIEW_EVIDENCE object to a REVIEW entity. Phase 5A independently
 * validates the formal order, review type, file state/version/purpose/owner,
 * and derives all audience authorities from the formal order.
 */
export const buyerReviewFileAuthorization: FileAuthorizationService = {
  assertCanCreateUpload: deny,
  assertCanUpload: deny,
  assertCanCompleteUpload: deny,
  assertCanRead: deny,
  assertCanLink(
    actor: FileActor,
    resource: FileAuthorizationResource,
  ): void {
    if (actor.type !== 'BUYER_CUSTOMER'
      || resource.ownerActorType !== 'BUYER_CUSTOMER'
      || resource.ownerActorId !== actor.id
      || resource.purpose !== 'REVIEW_EVIDENCE'
      || resource.entityType !== 'REVIEW'
      || !resource.fileObjectId
      || !resource.entityId) {
      deny();
    }
  },
};

function deny(): never {
  throw new FileStorageError('FORBIDDEN', 403);
}
