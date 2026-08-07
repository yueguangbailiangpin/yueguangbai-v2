import { describe,expect,it } from 'vitest';
import { GoogleDriveArchiveAdapter } from './drive-adapter';
import { MockDriveArchiveAdapter } from './mock-drive-adapter';
import { driveArchiveRuntime,resolveDriveArchiveAdapter } from './runtime';

describe('Drive archive fail-closed runtime factory',()=>{
  it('stays disabled when the total switch or any secret/var is absent',()=>{
    expect(resolveDriveArchiveAdapter({DRIVE_ARCHIVE_ENABLED:'false',DRIVE_ARCHIVE_ADAPTER:new MockDriveArchiveAdapter()})).toBeNull();
    expect(resolveDriveArchiveAdapter({DRIVE_ARCHIVE_ENABLED:'true',GOOGLE_DRIVE_CLIENT_ID:'id'})).toBeNull();
  });
  it('keeps explicit adapter injection for tests only',()=>{
    const injected=new MockDriveArchiveAdapter();
    expect(resolveDriveArchiveAdapter({DRIVE_ARCHIVE_ENABLED:'true',DRIVE_ARCHIVE_ADAPTER:injected})).toBe(injected);
  });
  it('constructs the production adapter only from a complete named binding set without making a network call',()=>{
    const runtime=driveArchiveRuntime({DRIVE_ARCHIVE_ENABLED:'true',DRIVE_ARCHIVE_COPY_ENABLED:'true',
      DRIVE_ARCHIVE_PROXY_READ_ENABLED:'true',DRIVE_ARCHIVE_R2_DELETE_ENABLED:'false',
      GOOGLE_DRIVE_CLIENT_ID:'client-id',GOOGLE_DRIVE_CLIENT_SECRET:'client-secret',
      GOOGLE_DRIVE_REFRESH_TOKEN:'refresh-token',GOOGLE_DRIVE_FOLDER_ID:'folder-id',
      GOOGLE_DRIVE_OWNER_ACCOUNT_KEY:'owner-account-key'});
    expect(runtime.adapter).toBeInstanceOf(GoogleDriveArchiveAdapter);
    expect(runtime).toMatchObject({enabled:true,copyEnabled:true,proxyReadEnabled:true,r2DeleteEnabled:false});
  });
});
