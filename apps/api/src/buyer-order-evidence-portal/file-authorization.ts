import type {
  FileActor,
} from '@ygb/contracts';
import type {
  FileAuthorizationResource,
  FileAuthorizationService,
} from '../files/authorization';
import { FileStorageError } from '../files/file-error';

export const buyerOrderEvidenceFileAuthorization: FileAuthorizationService = {
  assertCanCreateUpload: deny,
  assertCanUpload: deny,
  assertCanCompleteUpload: deny,
  assertCanLink: deny,
  assertCanRead(
    actor: FileActor,
    resource: FileAuthorizationResource,
  ): void {
    if (actor.type !== 'BUYER_CUSTOMER'
      || resource.ownerActorType !== 'BUYER_CUSTOMER'
      || resource.ownerActorId !== actor.id
      || resource.purpose !== 'ORDER_EVIDENCE'
      || resource.visibility !== 'BUYER_VISIBLE'
      || resource.entityType !== 'ORDER'
      || !resource.fileObjectId
      || !resource.entityId) {
      deny();
    }
  },
};

function deny(): never {
  throw new FileStorageError('FORBIDDEN', 403);
}
