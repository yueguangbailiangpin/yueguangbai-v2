import type { DriveArchiveAdapter } from '@ygb/contracts';
import { GoogleDriveArchiveAdapter } from './drive-adapter';

export interface DriveArchiveRuntimeBindings {
  DRIVE_ARCHIVE_ADAPTER?: DriveArchiveAdapter;
  DRIVE_ARCHIVE_ENABLED?: string;
  DRIVE_ARCHIVE_COPY_ENABLED?: string;
  DRIVE_ARCHIVE_PROXY_READ_ENABLED?: string;
  DRIVE_ARCHIVE_R2_DELETE_ENABLED?: string;
  GOOGLE_DRIVE_CLIENT_ID?: string;
  GOOGLE_DRIVE_CLIENT_SECRET?: string;
  GOOGLE_DRIVE_REFRESH_TOKEN?: string;
  GOOGLE_DRIVE_FOLDER_ID?: string;
  GOOGLE_DRIVE_OWNER_ACCOUNT_KEY?: string;
}

export function resolveDriveArchiveAdapter(bindings:DriveArchiveRuntimeBindings):DriveArchiveAdapter|null {
  if(bindings.DRIVE_ARCHIVE_ENABLED!=='true') return null;
  if(bindings.DRIVE_ARCHIVE_ADAPTER) return bindings.DRIVE_ARCHIVE_ADAPTER;
  const values=[bindings.GOOGLE_DRIVE_CLIENT_ID,bindings.GOOGLE_DRIVE_CLIENT_SECRET,
    bindings.GOOGLE_DRIVE_REFRESH_TOKEN,bindings.GOOGLE_DRIVE_FOLDER_ID,
    bindings.GOOGLE_DRIVE_OWNER_ACCOUNT_KEY];
  if(values.some((value)=>typeof value!=='string'||value.length<1)) return null;
  try{
    return new GoogleDriveArchiveAdapter({clientId:values[0]!,clientSecret:values[1]!,refreshToken:values[2]!,
      folderId:values[3]!,ownerAccountKey:values[4]!});
  }catch{return null;}
}

export function driveArchiveRuntime(bindings:DriveArchiveRuntimeBindings){
  return {adapter:resolveDriveArchiveAdapter(bindings),enabled:bindings.DRIVE_ARCHIVE_ENABLED==='true',
    copyEnabled:bindings.DRIVE_ARCHIVE_COPY_ENABLED==='true',
    proxyReadEnabled:bindings.DRIVE_ARCHIVE_PROXY_READ_ENABLED==='true',
    r2DeleteEnabled:bindings.DRIVE_ARCHIVE_R2_DELETE_ENABLED==='true'};
}
