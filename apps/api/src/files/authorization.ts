import type {
  FileActor,
  FileEntityType,
  FileLinkAuthorizationMode,
  FilePurpose,
  FileVisibility,
} from '@ygb/contracts';

export interface FileAuthorizationResource {
  uploadIntentId: string;
  fileObjectId: string | null;
  ownerActorType: string;
  ownerActorId: string;
  purpose: FilePurpose;
  visibility: FileVisibility;
  entityType: FileEntityType | null;
  entityId: string | null;
  fileEntityLinkId?: string | null;
  linkAuthorizationMode?: FileLinkAuthorizationMode;
  linkExpiresAt?: number | null;
  linkRevokedAt?: number | null;
}

export interface FileAuthorizationService {
  assertCanCreateUpload(
    actor: FileActor,
    input: {
      purpose: FilePurpose;
      visibility: FileVisibility;
    },
  ): Promise<void> | void;
  assertCanUpload(
    actor: FileActor,
    resource: FileAuthorizationResource,
  ): Promise<void> | void;
  assertCanCompleteUpload(
    actor: FileActor,
    resource: FileAuthorizationResource,
  ): Promise<void> | void;
  assertCanLink(
    actor: FileActor,
    resource: FileAuthorizationResource,
  ): Promise<void> | void;
  assertCanRead(
    actor: FileActor,
    resource: FileAuthorizationResource,
  ): Promise<void> | void;
}

export class DenyAllFileAuthorizationService
implements FileAuthorizationService {
  assertCanCreateUpload(): never {
    throw new Error('file_authorization_required');
  }
  assertCanUpload(): never {
    throw new Error('file_authorization_required');
  }
  assertCanCompleteUpload(): never {
    throw new Error('file_authorization_required');
  }
  assertCanLink(): never {
    throw new Error('file_authorization_required');
  }
  assertCanRead(): never {
    throw new Error('file_authorization_required');
  }
}
