import type { FileActor } from '@ygb/contracts';
import type {
  FileAuthorizationResource,
  FileAuthorizationService,
} from '../files/authorization';
import { FileStorageError } from '../files/file-error';

/** Allows only the product-application command to link its submitter's images. */
export const productApplicationFileAuthorization: FileAuthorizationService = {
  assertCanCreateUpload: deny,
  assertCanUpload: deny,
  assertCanCompleteUpload: deny,
  assertCanRead: deny,
  assertCanLink(actor: FileActor, resource: FileAuthorizationResource): void {
    if (actor.type !== 'SELLER_MEMBER'
      || resource.ownerActorType !== 'SELLER_MEMBER'
      || resource.ownerActorId !== actor.id
      || resource.purpose !== 'PRODUCT_APPLICATION_IMAGE'
      || resource.visibility !== 'SELLER_VISIBLE'
      || resource.entityType !== 'PRODUCT_APPLICATION'
      || !resource.fileObjectId
      || !resource.entityId) deny();
  },
};

function deny(): never {
  throw new FileStorageError('FORBIDDEN', 403);
}
