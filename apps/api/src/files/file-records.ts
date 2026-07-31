import type {
  FileEntityType,
  FileObjectStatus,
  FilePurpose,
  FileVisibility,
  SupportedFileExtension,
  SupportedFileMime,
} from '@ygb/contracts';

export interface FileIntentRow {
  id: string;
  owner_actor_type: string;
  owner_actor_id: string;
  purpose: FilePurpose;
  visibility: FileVisibility;
  status: string;
  requested_file_count: number;
  version: number;
  expires_at: number;
}

export interface FileObjectRow {
  id: string;
  upload_intent_id: string;
  slot_no: number;
  purpose: FilePurpose;
  visibility: FileVisibility;
  object_key: string;
  client_file_name: string;
  extension: SupportedFileExtension;
  declared_mime: SupportedFileMime;
  expected_byte_size: number;
  status: FileObjectStatus;
  upload_token_hash: string;
  upload_expires_at: number;
  uploaded_byte_size: number | null;
  detected_mime: SupportedFileMime | null;
  uploaded_sha256: string | null;
  version: number;
  owner_actor_type: string;
  owner_actor_id: string;
  intent_status: string;
  intent_version: number;
  intent_expires_at: number;
}

export interface FileLinkRow {
  entity_type: FileEntityType;
  entity_id: string;
}

export function cleanFileIdentifier(
  value: string,
  maximum = 200,
): string {
  if (typeof value !== 'string') throw new Error('invalid_file_identifier');
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1
    || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new Error('invalid_file_identifier');
  }
  return normalized;
}
